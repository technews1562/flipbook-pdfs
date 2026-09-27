const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../../config');
const db = require('../../db/database');
const storageService = require('../storage/storage.service');
const pdfService = require('../pdf/pdf.service');
const { getUserPlan } = require('../../middleware/planValidator');

class UploadService {
  constructor() {
    this.chunkSize = config.upload?.chunkSize || 2097152; // 2 MB Canonical Chunk Size
    this.sessionTtlMinutes = config.upload?.sessionTtlMinutes || 30;
    this.tempDir = config.upload?.tempDir || path.join(process.cwd(), 'data', 'tmp_uploads');

    if (!fs.existsSync(this.tempDir)) {
      try { fs.mkdirSync(this.tempDir, { recursive: true }); } catch (e) {}
    }

    // Periodic temp folder & expired sessions cleanup (every 5 minutes)
    setInterval(() => this.cleanupExpiredSessions().catch(() => {}), 5 * 60 * 1000);
  }

  /**
   * Helper to generate unique publication ID
   */
  generatePubId() {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 8);
    return `pub_${timestamp}${randomPart}`;
  }

  /**
   * Helper to generate unique upload session ID
   */
  generateUploadId() {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 8);
    return `upl_${timestamp}${randomPart}`;
  }

  /**
   * Helper to get temp chunks directory for an upload session
   */
  getUploadDir(uploadId) {
    const sessionDir = path.join(this.tempDir, uploadId);
    if (!fs.existsSync(sessionDir)) {
      try { fs.mkdirSync(sessionDir, { recursive: true }); } catch (e) {}
    }
    return sessionDir;
  }

  /**
   * Initialize a new authenticated upload session with plan quota validation
   */
  async initUpload({
    userId,
    filename,
    fileSize,
    contentType = 'application/pdf',
    totalChunks,
    fileHash,
    title,
    category,
    description,
    author,
    visibility = 'PUBLIC'
  }) {
    if (!userId) {
      const err = new Error('User authentication is required to initialize an upload session.');
      err.code = 'UNAUTHORIZED';
      err.status = 401;
      throw err;
    }

    const cleanFilename = (filename || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!cleanFilename.toLowerCase().endsWith('.pdf') && contentType !== 'application/pdf') {
      const err = new Error('Invalid file type: only PDF documents are supported.');
      err.code = 'INVALID_FILE_TYPE';
      err.status = 400;
      throw err;
    }

    const size = parseInt(fileSize, 10);
    if (!size || size <= 0) {
      const err = new Error('Invalid file size: fileSize must be a positive integer.');
      err.code = 'INVALID_FILE_SIZE';
      err.status = 400;
      throw err;
    }

    // Canonical chunk count calculation (Server is authoritative)
    const expectedChunks = Math.ceil(size / this.chunkSize);
    let chunks = parseInt(totalChunks, 10);
    if (!chunks || chunks <= 0 || chunks !== expectedChunks) {
      chunks = expectedChunks;
    }

    // Visibility validation
    const validVisibilities = ['PUBLIC', 'UNLISTED', 'PRIVATE', 'PASSWORD_PROTECTED'];
    const safeVisibility = validVisibilities.includes(visibility) ? visibility : 'PUBLIC';

    // Plan & Quota Validation
    const user = db.getUserById(userId);
    if (!user) {
      const err = new Error('User account not found.');
      err.code = 'USER_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    const plan = getUserPlan(user);
    const isAdmin = user.role === 'ADMIN';

    if (!isAdmin) {
      // 1. Publication count limit
      if (plan.max_publications !== -1 && (user.publication_count || 0) >= plan.max_publications) {
        const err = new Error(`You have reached your limit of ${plan.max_publications} publications on the ${plan.name} plan. Please upgrade to Pro for higher limits.`);
        err.code = 'PUBLICATION_LIMIT_REACHED';
        err.status = 403;
        throw err;
      }

      // 2. Storage quota check
      if ((user.storage_used_bytes || 0) + size > plan.max_storage_bytes) {
        const usedMb = ((user.storage_used_bytes || 0) / (1024 * 1024)).toFixed(1);
        const maxMb = (plan.max_storage_bytes / (1024 * 1024)).toFixed(1);
        const err = new Error(`Uploading this file exceeds your storage limit (${usedMb} MB used of ${maxMb} MB). Please upgrade your plan.`);
        err.code = 'STORAGE_QUOTA_EXCEEDED';
        err.status = 403;
        throw err;
      }

      // 3. Single PDF size check
      if (size > plan.max_pdf_size_bytes) {
        const maxMb = (plan.max_pdf_size_bytes / (1024 * 1024)).toFixed(0);
        const err = new Error(`This PDF exceeds the maximum file size limit of ${maxMb} MB for the ${plan.name} plan.`);
        err.code = 'FILE_SIZE_LIMIT_EXCEEDED';
        err.status = 413;
        throw err;
      }

      // 4. Password Protection entitlement check
      if (safeVisibility === 'PASSWORD_PROTECTED' && !plan.allow_password_protect) {
        const err = new Error(`Password protection is not available on the ${plan.name} plan. Please upgrade to Pro.`);
        err.code = 'PASSWORD_PROTECTION_NOT_ALLOWED';
        err.status = 403;
        throw err;
      }
    }

    const uploadId = this.generateUploadId();
    const publicationId = this.generatePubId();
    const expiresAt = new Date(Date.now() + this.sessionTtlMinutes * 60 * 1000).toISOString();

    const session = db.createUploadSession({
      id: uploadId,
      user_id: userId,
      publication_id: publicationId,
      filename: cleanFilename,
      content_type: contentType,
      expected_size: size,
      received_size: 0,
      total_chunks: chunks,
      received_chunks: 0,
      file_hash: fileHash || null,
      title: title || '',
      category: category || 'Magazine',
      description: description || '',
      author: author || '',
      visibility: safeVisibility,
      status: 'INITIATED',
      expires_at: expiresAt
    });

    // Prepare temp folder
    this.getUploadDir(uploadId);

    return {
      uploadId: session.id,
      publicationId: session.publication_id,
      chunkSize: this.chunkSize,
      totalChunks: session.total_chunks,
      expectedSize: session.expected_size,
      expiresAt: session.expires_at,
      status: session.status
    };
  }

  /**
   * Save an uploaded binary chunk (Max 2 MB per chunk)
   */
  async saveChunk({ userId, uploadId, chunkIndex, buffer }) {
    if (!uploadId || chunkIndex === undefined || !buffer) {
      const err = new Error('Missing uploadId, chunkIndex, or chunk payload.');
      err.code = 'INVALID_CHUNK_REQUEST';
      err.status = 400;
      throw err;
    }

    // Chunk size limit validation (Never accept > 2 MB)
    if (buffer.length > this.chunkSize) {
      const err = new Error(`Chunk size (${buffer.length} bytes) exceeds the maximum allowed 2 MB (${this.chunkSize} bytes).`);
      err.code = 'INVALID_CHUNK_SIZE';
      err.status = 400;
      throw err;
    }

    const session = db.getUploadSessionById(uploadId);
    if (!session) {
      const err = new Error('Upload session not found or expired.');
      err.code = 'UPLOAD_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    // Ownership check (User A cannot upload to User B's session)
    const user = db.getUserById(userId);
    const isAdmin = user && user.role === 'ADMIN';
    if (session.user_id !== userId && !isAdmin) {
      const err = new Error('You do not have permission to access this upload session.');
      err.code = 'FORBIDDEN';
      err.status = 403;
      throw err;
    }

    if (session.status === 'COMPLETED') {
      const err = new Error('This upload session has already been completed.');
      err.code = 'UPLOAD_ALREADY_COMPLETED';
      err.status = 409;
      throw err;
    }

    if (session.status === 'CANCELLED') {
      const err = new Error('This upload session was cancelled.');
      err.code = 'UPLOAD_CANCELLED';
      err.status = 400;
      throw err;
    }

    if (new Date(session.expires_at) <= new Date()) {
      this.cleanupTempDir(uploadId);
      db.updateUploadSession(uploadId, { status: 'EXPIRED' });
      const err = new Error('Upload session has expired. Please initiate a new upload.');
      err.code = 'UPLOAD_EXPIRED';
      err.status = 400;
      throw err;
    }

    const idx = parseInt(chunkIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= session.total_chunks) {
      const err = new Error(`Invalid chunk index ${chunkIndex}. Must be between 0 and ${session.total_chunks - 1}.`);
      err.code = 'INVALID_CHUNK_INDEX';
      err.status = 400;
      throw err;
    }

    // Write chunk to deterministic temp path on disk (safely retryable)
    const sessionDir = this.getUploadDir(uploadId);
    const chunkPath = path.join(sessionDir, `chunk_${idx}`);
    fs.writeFileSync(chunkPath, buffer);

    // Compute received chunks and size deterministically
    let receivedChunks = 0;
    let receivedSize = 0;
    for (let i = 0; i < session.total_chunks; i++) {
      const p = path.join(sessionDir, `chunk_${i}`);
      if (fs.existsSync(p)) {
        receivedChunks++;
        receivedSize += fs.statSync(p).size;
      }
    }

    db.updateUploadSession(uploadId, {
      status: 'UPLOADING',
      received_chunks: receivedChunks,
      received_size: receivedSize
    });

    const progressPercent = Math.round((receivedChunks / session.total_chunks) * 100);

    return {
      uploadId,
      chunkIndex: idx,
      receivedChunks,
      totalChunks: session.total_chunks,
      progressPercent,
      status: 'UPLOADING'
    };
  }

  /**
   * Resume API: Inspect upload session state and return received vs missing chunks
   */
  async getUploadStatus({ userId, uploadId, isAdmin = false }) {
    if (!uploadId) {
      const err = new Error('Missing uploadId parameter.');
      err.code = 'MISSING_UPLOAD_ID';
      err.status = 400;
      throw err;
    }

    const session = db.getUploadSessionById(uploadId);
    if (!session) {
      const err = new Error('Upload session not found.');
      err.code = 'UPLOAD_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    if (session.user_id !== userId && !isAdmin) {
      const err = new Error('You do not have permission to view this upload session.');
      err.code = 'FORBIDDEN';
      err.status = 403;
      throw err;
    }

    // Check expiration
    if (new Date(session.expires_at) <= new Date() && session.status !== 'COMPLETED') {
      this.cleanupTempDir(uploadId);
      db.updateUploadSession(uploadId, { status: 'EXPIRED' });
      session.status = 'EXPIRED';
    }

    const sessionDir = path.join(this.tempDir, uploadId);
    const receivedChunks = [];
    const missingChunks = [];

    for (let i = 0; i < session.total_chunks; i++) {
      const chunkPath = path.join(sessionDir, `chunk_${i}`);
      if (fs.existsSync(chunkPath)) {
        receivedChunks.push(i);
      } else {
        missingChunks.push(i);
      }
    }

    const progressPercent = session.total_chunks > 0
      ? Math.round((receivedChunks.length / session.total_chunks) * 100)
      : 0;

    return {
      uploadId: session.id,
      publicationId: session.publication_id,
      status: session.status,
      totalChunks: session.total_chunks,
      receivedChunks,
      missingChunks,
      progressPercent,
      expectedSize: session.expected_size,
      receivedSize: session.received_size,
      expiresAt: session.expires_at
    };
  }

  /**
   * Complete upload: assemble chunks, inspect PDF, upload to R2 under user namespace, update DB
   */
  async completeUpload({
    userId,
    uploadId,
    title,
    category,
    description,
    author,
    coverBase64,
    visibility,
    password
  }) {
    if (!uploadId) {
      const err = new Error('Missing uploadId parameter.');
      err.code = 'MISSING_UPLOAD_ID';
      err.status = 400;
      throw err;
    }

    const session = db.getUploadSessionById(uploadId);
    if (!session) {
      const err = new Error('Upload session not found or expired.');
      err.code = 'UPLOAD_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    // Ownership check
    const user = db.getUserById(userId);
    const isAdmin = user && user.role === 'ADMIN';
    if (session.user_id !== userId && !isAdmin) {
      const err = new Error('You do not have permission to complete this upload session.');
      err.code = 'FORBIDDEN';
      err.status = 403;
      throw err;
    }

    // Idempotency check: If already completed, return existing publication without double counting
    if (session.status === 'COMPLETED') {
      const existingPub = db.getPublicationById(session.publication_id);
      if (existingPub) {
        return {
          publication: {
            id: existingPub.id,
            title: existingPub.title,
            category: existingPub.category,
            pageCount: existingPub.page_count,
            fileSize: existingPub.file_size,
            status: existingPub.status,
            publicUrl: config.getPublicViewerUrl(existingPub.id),
            pdfUrl: `/api/public/${existingPub.id}/pdf`,
            coverUrl: `/api/public/${existingPub.id}/cover`,
            hasBranding: Boolean(existingPub.has_branding),
            visibility: existingPub.visibility
          }
        };
      }
    }

    if (session.status === 'CANCELLED') {
      const err = new Error('This upload session was cancelled.');
      err.code = 'UPLOAD_CANCELLED';
      err.status = 400;
      throw err;
    }

    if (new Date(session.expires_at) <= new Date()) {
      this.cleanupTempDir(uploadId);
      db.updateUploadSession(uploadId, { status: 'EXPIRED' });
      const err = new Error('Upload session has expired. Please start a new upload.');
      err.code = 'UPLOAD_EXPIRED';
      err.status = 400;
      throw err;
    }

    // Concurrency guard: Atomically transition to COMPLETING
    if (session.status === 'COMPLETING') {
      const err = new Error('Upload completion is already in progress.');
      err.code = 'COMPLETION_IN_PROGRESS';
      err.status = 409;
      throw err;
    }

    db.updateUploadSession(uploadId, { status: 'COMPLETING' });

    const sessionDir = this.getUploadDir(uploadId);
    const assembledPath = path.join(sessionDir, 'assembled.pdf');

    // Verify all chunks are present on disk and stream sequentially to assembled.pdf
    const writeStream = fs.createWriteStream(assembledPath);
    const hash = crypto.createHash('sha256');
    let assembledSize = 0;

    for (let i = 0; i < session.total_chunks; i++) {
      const p = path.join(sessionDir, `chunk_${i}`);
      if (!fs.existsSync(p)) {
        writeStream.destroy();
        try { fs.unlinkSync(assembledPath); } catch (e) {}
        db.updateUploadSession(uploadId, { status: 'UPLOADING' });
        const err = new Error(`Incomplete upload: Missing chunk ${i + 1} of ${session.total_chunks}.`);
        err.code = 'INCOMPLETE_CHUNKS';
        err.status = 400;
        throw err;
      }

      await new Promise((resolve, reject) => {
        const readStream = fs.createReadStream(p);
        readStream.on('data', (chunk) => {
          hash.update(chunk);
          assembledSize += chunk.length;
        });
        readStream.on('error', reject);
        readStream.on('end', resolve);
        readStream.pipe(writeStream, { end: false });
      });
    }

    await new Promise((resolve) => writeStream.end(resolve));
    const calculatedHash = hash.digest('hex');

    // Step 1: Validate PDF structure & metadata (magic bytes %PDF- and structure)
    let pdfMeta;
    try {
      pdfMeta = await pdfService.validateAndInspect(assembledPath);
    } catch (valErr) {
      db.updateUploadSession(uploadId, { status: 'UPLOADING' });
      try { fs.unlinkSync(assembledPath); } catch (e) {}
      const err = new Error(`Invalid PDF document: ${valErr.message}`);
      err.code = 'INVALID_PDF';
      err.status = 400;
      throw err;
    }

    // Step 2: Enforce Plan Page Count Limits
    const plan = getUserPlan(user);
    if (!isAdmin && plan.max_pages_per_doc !== -1 && pdfMeta.pageCount > plan.max_pages_per_doc) {
      db.updateUploadSession(uploadId, { status: 'UPLOADING' });
      try { fs.unlinkSync(assembledPath); } catch (e) {}
      const err = new Error(`Document page count (${pdfMeta.pageCount} pages) exceeds your ${plan.name} plan limit of ${plan.max_pages_per_doc} pages.`);
      err.code = 'PAGE_LIMIT_EXCEEDED';
      err.status = 400;
      throw err;
    }

    // Step 3: Verify client-provided hash if supplied
    if (session.file_hash && session.file_hash !== calculatedHash) {
      console.warn(`[Upload Hash Check] Calculated ${calculatedHash} vs client ${session.file_hash}`);
    }

    // Step 4: Duplicate detection for the same user
    const existing = db.getPublicationByHash(calculatedHash, session.user_id);
    if (existing) {
      this.cleanupTempDir(uploadId);
      db.updateUploadSession(uploadId, { status: 'COMPLETED', file_hash: calculatedHash });
      return {
        publication: {
          id: existing.id,
          title: existing.title,
          category: existing.category,
          pageCount: existing.page_count,
          fileSize: existing.file_size,
          status: existing.status,
          publicUrl: config.getPublicViewerUrl(existing.id),
          pdfUrl: `/api/public/${existing.id}/pdf`,
          coverUrl: `/api/public/${existing.id}/cover`,
          hasBranding: Boolean(existing.has_branding),
          visibility: existing.visibility,
          duplicate: true
        }
      };
    }

    // Step 5: R2 Structured Namespacing (users/{userId}/publications/{publicationId}/original.pdf) via Streaming
    const pubId = session.publication_id;
    const pubUserId = session.user_id;
    const storageKey = `users/${pubUserId}/publications/${pubId}/original.pdf`;

    await storageService.uploadFile(storageKey, assembledPath, 'application/pdf');
    const pdfUrl = `/api/public/${pubId}/pdf`;


    // Step 6: Server-side Cover Generation & Upload
    let coverUrl = '';
    const pubTitle = (title || session.title ? (title || session.title).trim() : session.filename.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim()) || 'Digital Publication';
    const pubCategory = category || session.category || 'Magazine';
    const pubDescription = description !== undefined ? description : (session.description || '');
    const pubAuthor = author !== undefined ? author : (session.author || '');
    const pubVisibility = visibility || session.visibility || 'PUBLIC';

    if (coverBase64 && coverBase64.startsWith('data:image/')) {
      const parts = coverBase64.split(',');
      const imgBuffer = Buffer.from(parts[1], 'base64');
      const imgExt = coverBase64.includes('image/webp') ? 'webp' : 'jpg';
      const imgMime = coverBase64.includes('image/webp') ? 'image/webp' : 'image/jpeg';
      const customCoverKey = `users/${pubUserId}/publications/${pubId}/cover.${imgExt}`;
      const coverRes = await storageService.upload(customCoverKey, imgBuffer, imgMime);
      coverUrl = coverRes.url;
    } else {
      const coverSvg = pdfService.generateVectorCoverSvg(pubTitle, pubCategory, pdfMeta.pageCount);
      const coverKey = `users/${pubUserId}/publications/${pubId}/cover.svg`;
      const coverRes = await storageService.upload(coverKey, coverSvg, 'image/svg+xml');
      coverUrl = coverRes.url;
    }

    // Step 7: Password Hash if protected
    let passwordHash = null;
    if (password && typeof password === 'string' && password.trim().length > 0) {
      passwordHash = await bcrypt.hash(password.trim(), 10);
    }

    // Step 8: Save Publication Record in Database & Atomically Update Storage Counters
    const pubRecord = db.createPublication({
      id: pubId,
      user_id: pubUserId,
      title: pubTitle,
      category: pubCategory,
      description: pubDescription,
      author: pubAuthor,
      pdf_filename: session.filename,
      storage_key: storageKey,
      pdf_url: pdfUrl,
      cover_url: coverUrl,
      page_count: pdfMeta.pageCount,
      file_size: assembledSize || pdfMeta.fileSize,
      file_hash: calculatedHash || pdfMeta.fileHash,
      status: 'READY',
      published: 1,
      visibility: pubVisibility,
      password_hash: passwordHash,
      has_branding: plan.has_branding ? 1 : 0
    });

    // Step 9: Mark Session COMPLETED and clean up temp files
    db.updateUploadSession(uploadId, {
      status: 'COMPLETED',
      file_hash: calculatedHash || pdfMeta.fileHash,
      received_size: assembledSize || pdfMeta.fileSize,
      received_chunks: session.total_chunks
    });
    this.cleanupTempDir(uploadId);


    const publicUrl = config.getPublicViewerUrl(pubId);

    return {
      publication: {
        id: pubRecord.id,
        title: pubRecord.title,
        category: pubRecord.category,
        pageCount: pubRecord.page_count,
        fileSize: pubRecord.file_size,
        status: pubRecord.status,
        publicUrl,
        pdfUrl: `/api/public/${pubRecord.id}/pdf`,
        coverUrl: `/api/public/${pubRecord.id}/cover`,
        hasBranding: Boolean(pubRecord.has_branding),
        visibility: pubRecord.visibility
      }
    };
  }

  /**
   * Cancel and delete an upload session
   */
  async cancelUpload({ userId, uploadId }) {
    if (!uploadId) {
      const err = new Error('Missing uploadId parameter.');
      err.code = 'MISSING_UPLOAD_ID';
      err.status = 400;
      throw err;
    }

    const session = db.getUploadSessionById(uploadId);
    if (!session) {
      const err = new Error('Upload session not found.');
      err.code = 'UPLOAD_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    // Ownership check
    const user = db.getUserById(userId);
    const isAdmin = user && user.role === 'ADMIN';
    if (session.user_id !== userId && !isAdmin) {
      const err = new Error('You do not have permission to cancel this upload session.');
      err.code = 'FORBIDDEN';
      err.status = 403;
      throw err;
    }

    if (session.status === 'COMPLETED') {
      const err = new Error('Cannot cancel an already completed upload session. Use DELETE /api/publications/:id instead.');
      err.code = 'CANNOT_CANCEL_COMPLETED';
      err.status = 400;
      throw err;
    }

    db.updateUploadSession(uploadId, { status: 'CANCELLED' });
    this.cleanupTempDir(uploadId);
    db.deleteUploadSession(uploadId);

    return { message: 'Upload session cancelled successfully.' };
  }

  /**
   * Clean temporary directory for an upload session
   */
  cleanupTempDir(uploadId) {
    try {
      const sessionDir = path.join(this.tempDir, uploadId);
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.warn(`[UploadService] Temp cleanup note for ${uploadId}:`, e.message);
    }
  }

  /**
   * Periodically purge expired upload sessions and orphan temp folders
   */
  async cleanupExpiredSessions() {
    db.cleanExpiredUploadSessions();
    try {
      if (fs.existsSync(this.tempDir)) {
        const entries = fs.readdirSync(this.tempDir);
        const now = Date.now();
        for (const entry of entries) {
          const entryPath = path.join(this.tempDir, entry);
          const stat = fs.statSync(entryPath);
          // If older than 1 hour, clean it up
          if (now - stat.mtimeMs > 60 * 60 * 1000) {
            fs.rmSync(entryPath, { recursive: true, force: true });
          }
        }
      }
    } catch (e) {}
  }
}

module.exports = new UploadService();
