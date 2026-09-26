const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../db/database');
const storageService = require('../services/storage/storage.service');
const pdfService = require('../services/pdf/pdf.service');
const bloggerService = require('../services/blogger/blogger.service');
const { requireAuth, optionalAuth, requirePublicationOwner } = require('../middleware/auth');
const { getUserPlan } = require('../middleware/planValidator');
const config = require('../config');

// Configure Multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max per single request or chunk
});

// In-Memory Chunk Sessions Store (Auto-cleaned)
const chunkSessions = new Map();

function cleanOldSessions() {
  const now = Date.now();
  for (const [id, session] of chunkSessions.entries()) {
    if (now - session.createdAt > 600000) { // 10 minutes
      chunkSessions.delete(id);
    }
  }
}
setInterval(cleanOldSessions, 60000);

// Helper to generate Unique Publication ID
function generatePubId() {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 8);
  return `pub_${timestamp}${randomPart}`;
}

// -------------------------------------------------------------
// POST /api/upload-chunk (Chunked Streaming Upload)
// -------------------------------------------------------------
router.post('/upload-chunk', optionalAuth, upload.single('chunk'), (req, res) => {
  try {
    const { uploadId, chunkIndex, totalChunks, filename } = req.body;

    if (!uploadId || chunkIndex === undefined || !totalChunks || !req.file) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_CHUNK', message: 'Missing chunk metadata or binary payload.' }
      });
    }

    const idx = parseInt(chunkIndex, 10);
    const total = parseInt(totalChunks, 10);

    if (!chunkSessions.has(uploadId)) {
      chunkSessions.set(uploadId, {
        filename: filename || 'publication.pdf',
        totalChunks: total,
        chunks: new Array(total),
        userId: req.user ? req.user.id : db.SYSTEM_ADMIN_ID,
        createdAt: Date.now()
      });
    }

    const session = chunkSessions.get(uploadId);
    session.chunks[idx] = req.file.buffer;

    const receivedCount = session.chunks.filter(Boolean).length;

    return res.status(200).json({
      success: true,
      data: {
        uploadId,
        chunkIndex: idx,
        receivedChunks: receivedCount,
        totalChunks: total
      }
    });
  } catch (err) {
    console.error('[Upload Chunk Error]', err);
    return res.status(500).json({
      success: false,
      error: { code: 'CHUNK_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// POST /api/finalize-upload (Reassemble, Store in R2 & Save Record)
// -------------------------------------------------------------
router.post('/finalize-upload', optionalAuth, async (req, res) => {
  const startTime = Date.now();
  try {
    const { uploadId, filename, title, category, description, author, coverBase64, visibility, password } = req.body;

    if (!uploadId || !chunkSessions.has(uploadId)) {
      return res.status(404).json({
        success: false,
        error: { code: 'SESSION_NOT_FOUND', message: 'Upload session not found or expired. Please retry.' }
      });
    }

    const session = chunkSessions.get(uploadId);
    const missingIndex = session.chunks.findIndex(c => !c);

    if (missingIndex !== -1) {
      return res.status(400).json({
        success: false,
        error: { code: 'INCOMPLETE_CHUNKS', message: `Missing chunk ${missingIndex + 1} of ${session.totalChunks}.` }
      });
    }

    // Reassemble binary chunks
    const completeBuffer = Buffer.concat(session.chunks);
    const targetUserId = req.user ? req.user.id : (session.userId || db.SYSTEM_ADMIN_ID);
    chunkSessions.delete(uploadId); // free memory

    // Resolve User & Plan details
    const user = db.getUserById(targetUserId);
    const plan = getUserPlan(user);

    // Sanitize and prepare document details
    const rawFilename = (filename || session.filename || 'publication.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
    const pubTitle = title ? title.trim() : rawFilename.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
    const pubCategory = category || 'Magazine';
    const pubDescription = description || '';
    const pubAuthor = author || '';

    // Step 1: Validate PDF structure & extract metadata
    const pdfMeta = await pdfService.validateAndInspect(completeBuffer);

    // Step 2: Check for existing duplicate under same user
    const existing = db.getPublicationByHash(pdfMeta.fileHash, targetUserId);
    if (existing) {
      console.log(`[Upload] Duplicate detected for user ${targetUserId}: ${existing.id}`);
      return res.status(200).json({
        success: true,
        data: {
          duplicate: true,
          publicationId: existing.id,
          id: existing.id,
          user_id: existing.user_id || targetUserId,
          title: existing.title,
          pageCount: existing.page_count,
          pdfUrl: existing.pdf_url,
          coverUrl: existing.cover_url,
          postUrl: existing.blogger_post_url || `https://${config.blogger.blogDomain}/#doc=${existing.id}`,
          status: existing.status,
          message: 'Document already exists in your library.'
        }
      });
    }

    // Step 3: Generate Unique Publication ID & Storage Key
    const pubId = generatePubId();
    const datePrefix = new Date().toISOString().slice(0, 7).replace('-', '/'); // YYYY/MM
    const storageKey = `uploads/${datePrefix}/${pubId}/${rawFilename}`;

    // Step 4: Upload PDF to Cloudflare R2 / Object Storage
    const { url: pdfUrl } = await storageService.upload(storageKey, completeBuffer, 'application/pdf');

    // Step 5: Handle Cover Generation & Upload
    let coverUrl = '';
    const coverKey = `covers/${pubId}.svg`;
    if (coverBase64 && coverBase64.startsWith('data:image/')) {
      const parts = coverBase64.split(',');
      const imgBuffer = Buffer.from(parts[1], 'base64');
      const imgExt = coverBase64.includes('image/webp') ? 'webp' : 'jpg';
      const imgMime = coverBase64.includes('image/webp') ? 'image/webp' : 'image/jpeg';
      const customCoverKey = `covers/${pubId}.${imgExt}`;
      const coverRes = await storageService.upload(customCoverKey, imgBuffer, imgMime);
      coverUrl = coverRes.url;
    } else {
      const coverSvg = pdfService.generateVectorCoverSvg(pubTitle, pubCategory, pdfMeta.pageCount);
      const coverRes = await storageService.upload(coverKey, coverSvg, 'image/svg+xml');
      coverUrl = coverRes.url;
    }

    // Step 6: Save Publication Record in Database with Multi-Tenant Ownership
    const pubRecord = db.createPublication({
      id: pubId,
      user_id: targetUserId,
      title: pubTitle,
      category: pubCategory,
      description: pubDescription,
      author: pubAuthor,
      pdf_filename: rawFilename,
      storage_key: storageKey,
      pdf_url: pdfUrl,
      cover_url: coverUrl,
      page_count: pdfMeta.pageCount,
      file_size: pdfMeta.fileSize,
      file_hash: pdfMeta.fileHash,
      status: 'READY',
      published: 1,
      visibility: visibility || 'PUBLIC',
      has_branding: plan.has_branding ? 1 : 0
    });

    console.log(`[Upload Finalized] Publication ${pubId} (${pubTitle}) saved to R2 & DB (User: ${targetUserId}) in ${Date.now() - startTime}ms`);

    return res.status(200).json({
      success: true,
      data: {
        publicationId: pubId,
        id: pubId,
        user_id: targetUserId,
        title: pubTitle,
        category: pubCategory,
        pageCount: pdfMeta.pageCount,
        fileSize: pdfMeta.fileSize,
        pdfUrl: pdfUrl,
        pdf_url: pdfUrl,
        coverUrl: coverUrl,
        cover_url: coverUrl,
        postUrl: `https://${config.blogger.blogDomain}/#doc=${pubId}`,
        status: 'READY',
        has_branding: pubRecord.has_branding,
        timeElapsedMs: Date.now() - startTime
      }
    });

  } catch (err) {
    console.error('[Finalize Error]', err);
    return res.status(500).json({
      success: false,
      error: { code: 'FINALIZATION_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// POST /api/upload (Single multipart file upload)
// -------------------------------------------------------------
router.post('/upload', optionalAuth, upload.single('pdf'), async (req, res) => {
  const startTime = Date.now();
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_FILE', message: 'No PDF file attached to request.' }
      });
    }

    const fileBuffer = req.file.buffer;
    const rawFilename = (req.file.originalname || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
    const pubTitle = req.body.title ? req.body.title.trim() : rawFilename.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
    const pubCategory = req.body.category || 'Magazine';
    const pubDescription = req.body.description || '';
    const pubAuthor = req.body.author || '';
    const targetUserId = req.user ? req.user.id : db.SYSTEM_ADMIN_ID;

    const user = db.getUserById(targetUserId);
    const plan = getUserPlan(user);

    // Validate PDF
    const pdfMeta = await pdfService.validateAndInspect(fileBuffer);

    // Duplicate check
    const existing = db.getPublicationByHash(pdfMeta.fileHash, targetUserId);
    if (existing) {
      return res.status(200).json({
        success: true,
        data: {
          duplicate: true,
          publicationId: existing.id,
          id: existing.id,
          user_id: existing.user_id || targetUserId,
          title: existing.title,
          pageCount: existing.page_count,
          pdfUrl: existing.pdf_url,
          coverUrl: existing.cover_url,
          postUrl: existing.blogger_post_url || `https://${config.blogger.blogDomain}/#doc=${existing.id}`,
          status: existing.status
        }
      });
    }

    const pubId = generatePubId();
    const datePrefix = new Date().toISOString().slice(0, 7).replace('-', '/');
    const storageKey = `uploads/${datePrefix}/${pubId}/${rawFilename}`;

    const { url: pdfUrl } = await storageService.upload(storageKey, fileBuffer, 'application/pdf');

    const coverSvg = pdfService.generateVectorCoverSvg(pubTitle, pubCategory, pdfMeta.pageCount);
    const coverKey = `covers/${pubId}.svg`;
    const { url: coverUrl } = await storageService.upload(coverKey, coverSvg, 'image/svg+xml');

    const pubRecord = db.createPublication({
      id: pubId,
      user_id: targetUserId,
      title: pubTitle,
      category: pubCategory,
      description: pubDescription,
      author: pubAuthor,
      pdf_filename: rawFilename,
      storage_key: storageKey,
      pdf_url: pdfUrl,
      cover_url: coverUrl,
      page_count: pdfMeta.pageCount,
      file_size: pdfMeta.fileSize,
      file_hash: pdfMeta.fileHash,
      status: 'READY',
      published: 1,
      has_branding: plan.has_branding ? 1 : 0
    });

    console.log(`[Single Upload] Publication ${pubId} saved to R2 & DB (User: ${targetUserId}) in ${Date.now() - startTime}ms`);

    return res.status(200).json({
      success: true,
      data: {
        publicationId: pubId,
        id: pubId,
        user_id: targetUserId,
        title: pubTitle,
        category: pubCategory,
        pageCount: pdfMeta.pageCount,
        fileSize: pdfMeta.fileSize,
        pdfUrl,
        pdf_url: pdfUrl,
        coverUrl,
        cover_url: coverUrl,
        postUrl: `https://${config.blogger.blogDomain}/#doc=${pubId}`,
        status: 'READY',
        has_branding: pubRecord.has_branding,
        timeElapsedMs: Date.now() - startTime
      }
    });

  } catch (err) {
    console.error('[Single Upload Error]', err);
    return res.status(500).json({
      success: false,
      error: { code: 'UPLOAD_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// GET /api/publications (Authenticated User's list or Public Feed)
// -------------------------------------------------------------
router.get('/', optionalAuth, (req, res) => {
  try {
    const { category, search, page, limit, status, visibility } = req.query;
    const isUserAuth = Boolean(req.user);
    const isAdmin = req.user && req.user.role === 'ADMIN';

    const result = db.listPublications({
      userId: isUserAuth ? req.user.id : null,
      isAdmin,
      category,
      search,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 50,
      status,
      visibility
    });

    return res.status(200).json({
      success: true,
      data: result.publications,
      pagination: result.pagination
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'LIST_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// GET /api/publications/categories
// -------------------------------------------------------------
router.get('/categories', (req, res) => {
  try {
    const categories = db.getCategories();
    return res.status(200).json({
      success: true,
      data: categories
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'FETCH_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// GET /api/publications/:id (Public / Viewer & Editor Metadata)
// -------------------------------------------------------------
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const publication = db.getPublicationById(id);

    if (!publication) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `Publication "${id}" not found.` }
      });
    }

    // Do not leak password_hash in response
    const { password_hash, ...safePublication } = publication;

    return res.status(200).json({
      success: true,
      data: safePublication
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'FETCH_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// GET /api/publications/:id/pdf (Direct CORS-Enabled Stream)
// -------------------------------------------------------------
router.get('/:id/pdf', async (req, res) => {
  try {
    const { id } = req.params;
    const publication = db.getPublicationById(id);

    if (!publication) {
      return res.status(404).send('Publication not found');
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', `inline; filename="${publication.pdf_filename || 'document.pdf'}"`);

    const buffer = await storageService.getBuffer(publication.storage_key);
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (err) {
    console.error('[PDF Stream Error]', err.message);
    const pub = db.getPublicationById(req.params.id);
    if (pub && pub.pdf_url) return res.redirect(pub.pdf_url);
    return res.status(500).send('Error streaming PDF');
  }
});

// -------------------------------------------------------------
// GET /api/publications/proxy-pdf (Universal Cross-Origin PDF Proxy)
// -------------------------------------------------------------
router.get('/proxy-pdf', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send('Missing url');

    const fetchRes = await fetch(url);
    if (!fetchRes.ok) return res.status(fetchRes.status).send('Remote fetch failed');

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Accept-Ranges', 'bytes');

    const ab = await fetchRes.arrayBuffer();
    const buf = Buffer.from(ab);
    res.setHeader('Content-Length', buf.length);
    return res.send(buf);
  } catch (err) {
    return res.status(500).send('Proxy error: ' + err.message);
  }
});

// -------------------------------------------------------------
// GET /api/publications/:id/cover (Proxy/Stream Cover)
// -------------------------------------------------------------
router.get('/:id/cover', async (req, res) => {
  try {
    const { id } = req.params;
    const publication = db.getPublicationById(id);

    if (!publication) {
      return res.status(404).send('Cover not found');
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

    if (publication.cover_url) {
      if (publication.cover_url.startsWith('http://') || publication.cover_url.startsWith('https://')) {
        return res.redirect(302, publication.cover_url);
      }
      if (publication.cover_url.startsWith('data:image/svg+xml')) {
        const svgData = decodeURIComponent(publication.cover_url.split(',')[1] || '');
        res.setHeader('Content-Type', 'image/svg+xml');
        return res.send(svgData);
      }
    }

    // Check R2 keys
    const namespacedCoverKey = `users/${publication.user_id}/publications/${publication.id}/cover.webp`;
    try {
      const exists = await storageService.exists(namespacedCoverKey);
      if (exists) {
        const streamResult = await storageService.getReadStream(namespacedCoverKey);
        res.setHeader('Content-Type', 'image/webp');
        return streamResult.stream.pipe(res);
      }
    } catch (e) {}

    const legacyCoverKey = `covers/${publication.id}.svg`;
    try {
      const exists = await storageService.exists(legacyCoverKey);
      if (exists) {
        const buffer = await storageService.getBuffer(legacyCoverKey);
        res.setHeader('Content-Type', 'image/svg+xml');
        return res.send(buffer);
      }
    } catch (e) {}

    // Fallback SVG
    res.setHeader('Content-Type', 'image/svg+xml');
    const title = (publication.title || 'Publication').slice(0, 30);
    const category = publication.category || 'Magazine';
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="600" height="850" viewBox="0 0 600 850">
        <defs>
          <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0f172a"/>
            <stop offset="100%" stop-color="#1e293b"/>
          </linearGradient>
        </defs>
        <rect width="600" height="850" fill="url(#g)"/>
        <rect x="30" y="30" width="540" height="790" fill="none" stroke="#38bdf8" stroke-width="2" stroke-opacity="0.3" rx="12"/>
        <text x="50" y="100" fill="#38bdf8" font-family="sans-serif" font-size="20" font-weight="bold" letter-spacing="3">${category.toUpperCase()}</text>
        <text x="50" y="180" fill="#ffffff" font-family="sans-serif" font-size="34" font-weight="bold">${title}</text>
        <text x="50" y="780" fill="#94a3b8" font-family="sans-serif" font-size="16">FLIPVIEW PDF READER</text>
      </svg>
    `;
    return res.send(svg.trim());
  } catch (err) {
    return res.status(500).send('Error streaming cover');
  }
});

// -------------------------------------------------------------
// PATCH /api/publications/:id (Ownership Protected)
// -------------------------------------------------------------
router.patch('/:id', requirePublicationOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = req.publication || db.getPublicationById(id);

    const safeUpdates = {};
    if (req.body.title !== undefined) safeUpdates.title = req.body.title.trim();
    if (req.body.category !== undefined) safeUpdates.category = req.body.category;
    if (req.body.description !== undefined) safeUpdates.description = req.body.description;
    if (req.body.author !== undefined) safeUpdates.author = req.body.author;
    if (req.body.visibility !== undefined) safeUpdates.visibility = req.body.visibility;
    if (req.body.download_enabled !== undefined) safeUpdates.download_enabled = req.body.download_enabled ? 1 : 0;
    if (req.body.share_enabled !== undefined) safeUpdates.share_enabled = req.body.share_enabled ? 1 : 0;
    if (req.body.has_branding !== undefined && req.user && req.user.role === 'ADMIN') {
      safeUpdates.has_branding = req.body.has_branding ? 1 : 0;
    }

    const updated = db.updatePublication(id, safeUpdates);

    // If Blogger post exists and title/category changed, update Blogger post
    if (existing.blogger_post_id && (req.body.title || req.body.category || req.body.description)) {
      bloggerService.updatePost(existing.blogger_post_id, updated).catch(err => {
        console.warn('[Blogger Update Warning]', err.message);
      });
    }

    const { password_hash, ...safeResult } = updated;
    return res.status(200).json({
      success: true,
      data: safeResult
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'UPDATE_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// DELETE /api/publications/:id (Ownership Protected)
// -------------------------------------------------------------
router.delete('/:id', requirePublicationOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const { deleteBloggerPost } = req.query;
    const publication = req.publication || db.getPublicationById(id);

    // 1. Remove from Storage
    if (publication.storage_key) {
      await storageService.delete(publication.storage_key);
    }
    await storageService.delete(`covers/${publication.id}.svg`);
    await storageService.delete(`covers/${publication.id}.webp`);
    await storageService.delete(`covers/${publication.id}.jpg`);

    // 2. Optionally remove Blogger post
    if (deleteBloggerPost === 'true' && publication.blogger_post_id) {
      await bloggerService.deletePost(publication.blogger_post_id);
    }

    // 3. Delete from Database & Decrement User Storage
    db.deletePublication(id);

    return res.status(200).json({
      success: true,
      data: { message: `Publication "${id}" deleted successfully.` }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'DELETE_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// POST /api/publications/:id/republish (Ownership Protected)
// -------------------------------------------------------------
router.post('/:id/republish', requirePublicationOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const publication = req.publication || db.getPublicationById(id);

    const blogResult = await bloggerService.createPost(publication);
    const updated = db.updatePublication(id, {
      blogger_post_id: blogResult.postId,
      blogger_post_url: blogResult.postUrl,
      status: 'PUBLISHED',
      published_at: new Date().toISOString()
    });

    const { password_hash, ...safeResult } = updated;
    return res.status(200).json({
      success: true,
      data: {
        publicationId: id,
        postId: blogResult.postId,
        postUrl: blogResult.postUrl,
        status: 'PUBLISHED'
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'REPUBLISH_FAILED', message: `Blogger publishing failed: ${err.message}` }
    });
  }
});

module.exports = router;
