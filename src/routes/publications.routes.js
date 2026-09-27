const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../db/database');
const storageService = require('../services/storage/storage.service');
const pdfService = require('../services/pdf/pdf.service');
const uploadService = require('../services/upload/upload.service');
const authService = require('../services/auth/auth.service');
const bloggerService = require('../services/blogger/blogger.service');
const { requireAuth, optionalAuth, requirePublicationOwner } = require('../middleware/auth');
const { getUserPlan } = require('../middleware/planValidator');
const config = require('../config');

// Configure Multer for legacy fallback requests
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max per single request or chunk
});

// -------------------------------------------------------------
// POST /api/upload-chunk (@deprecated Legacy Blogger Compatibility)
// Delegates to canonical UploadService
// -------------------------------------------------------------
router.post('/upload-chunk', optionalAuth, upload.single('chunk'), async (req, res) => {
  try {
    const { uploadId, chunkIndex, totalChunks, filename } = req.body;

    if (!uploadId || chunkIndex === undefined || !req.file) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_CHUNK', message: 'Missing chunk metadata or binary payload.' }
      });
    }

    const targetUserId = req.user ? req.user.id : db.SYSTEM_ADMIN_ID;
    const idx = parseInt(chunkIndex, 10);
    const total = parseInt(totalChunks, 10) || 1;

    // Ensure session exists in database
    let session = db.getUploadSessionById(uploadId);
    if (!session) {
      const cleanFilename = (filename || 'publication.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
      const estSize = total * (config.upload?.chunkSize || 2097152);
      session = db.createUploadSession({
        id: uploadId,
        user_id: targetUserId,
        filename: cleanFilename,
        expected_size: estSize,
        total_chunks: total,
        status: 'INITIATED',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
      });
    }

    const result = await uploadService.saveChunk({
      userId: targetUserId,
      uploadId,
      chunkIndex: idx,
      buffer: req.file.buffer
    });

    return res.status(200).json({
      success: true,
      data: {
        uploadId,
        chunkIndex: result.chunkIndex,
        receivedChunks: result.receivedChunks,
        totalChunks: result.totalChunks,
        progressPercent: result.progressPercent
      }
    });
  } catch (err) {
    console.error('[Legacy Upload Chunk Error]', err);
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      error: { code: err.code || 'CHUNK_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// POST /api/finalize-upload (@deprecated Legacy Blogger Compatibility)
// Delegates to canonical UploadService
// -------------------------------------------------------------
router.post('/finalize-upload', optionalAuth, async (req, res) => {
  const startTime = Date.now();
  try {
    const { uploadId, filename, title, category, description, author, coverBase64, visibility, password } = req.body;

    if (!uploadId) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_UPLOAD_ID', message: 'Missing uploadId parameter.' }
      });
    }

    const session = db.getUploadSessionById(uploadId);
    const targetUserId = req.user ? req.user.id : (session ? session.user_id : db.SYSTEM_ADMIN_ID);

    const completionResult = await uploadService.completeUpload({
      userId: targetUserId,
      uploadId,
      title,
      category,
      description,
      author,
      coverBase64,
      visibility,
      password
    });

    const pub = completionResult.publication;
    const fullPub = db.getPublicationById(pub.id);

    return res.status(200).json({
      success: true,
      data: {
        publicationId: pub.id,
        id: pub.id,
        user_id: targetUserId,
        title: pub.title,
        category: pub.category,
        pageCount: pub.pageCount,
        fileSize: pub.fileSize,
        pdfUrl: pub.pdfUrl,
        pdf_url: pub.pdfUrl,
        coverUrl: pub.coverUrl,
        cover_url: pub.coverUrl,
        postUrl: fullPub && fullPub.blogger_post_url ? fullPub.blogger_post_url : `https://${config.blogger.blogDomain}/#doc=${pub.id}`,
        status: pub.status,
        has_branding: pub.hasBranding,
        timeElapsedMs: Date.now() - startTime
      }
    });

  } catch (err) {
    console.error('[Legacy Finalize Error]', err);
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      error: { code: err.code || 'FINALIZATION_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// POST /api/upload (@deprecated Legacy Single File Upload)
// Delegates to canonical UploadService
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

    const targetUserId = req.user ? req.user.id : db.SYSTEM_ADMIN_ID;
    const rawFilename = (req.file.originalname || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
    const pubTitle = req.body.title ? req.body.title.trim() : rawFilename.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
    const pubCategory = req.body.category || 'Magazine';
    const pubDescription = req.body.description || '';
    const pubAuthor = req.body.author || '';
    const visibility = req.body.visibility || 'PUBLIC';

    // 1. Initialize canonical session
    const initRes = await uploadService.initUpload({
      userId: targetUserId,
      filename: rawFilename,
      fileSize: req.file.buffer.length,
      totalChunks: 1,
      title: pubTitle,
      category: pubCategory,
      description: pubDescription,
      author: pubAuthor,
      visibility
    });

    // 2. Stream single chunk
    await uploadService.saveChunk({
      userId: targetUserId,
      uploadId: initRes.uploadId,
      chunkIndex: 0,
      buffer: req.file.buffer
    });

    // 3. Complete upload through canonical pipeline
    const completionRes = await uploadService.completeUpload({
      userId: targetUserId,
      uploadId: initRes.uploadId,
      title: pubTitle,
      category: pubCategory,
      description: pubDescription,
      author: pubAuthor,
      coverBase64: req.body.coverBase64,
      visibility
    });

    const pub = completionRes.publication;
    const fullPub = db.getPublicationById(pub.id);

    return res.status(200).json({
      success: true,
      data: {
        publicationId: pub.id,
        id: pub.id,
        user_id: targetUserId,
        title: pub.title,
        category: pub.category,
        pageCount: pub.pageCount,
        fileSize: pub.fileSize,
        pdfUrl: pub.pdfUrl,
        pdf_url: pub.pdfUrl,
        coverUrl: pub.coverUrl,
        cover_url: pub.coverUrl,
        postUrl: fullPub && fullPub.blogger_post_url ? fullPub.blogger_post_url : `https://${config.blogger.blogDomain}/#doc=${pub.id}`,
        status: pub.status,
        has_branding: pub.hasBranding,
        timeElapsedMs: Date.now() - startTime
      }
    });

  } catch (err) {
    console.error('[Legacy Single Upload Error]', err);
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      error: { code: err.code || 'UPLOAD_FAILED', message: err.message }
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
// -------------------------------------------------------------
// GET /api/publications/mine (Authenticated User's Management List)
// -------------------------------------------------------------
router.get('/mine', requireAuth, (req, res) => {
  try {
    const { category, search, page, limit, status, visibility } = req.query;
    const isAdmin = req.user && req.user.role === 'ADMIN';

    const result = db.listPublications({
      userId: req.user.id,
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
router.get('/:id', optionalAuth, (req, res) => {
  try {
    const { id } = req.params;
    const publication = db.getPublicationById(id);

    if (!publication) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `Publication "${id}" not found.` }
      });
    }

    // Enforce private visibility check
    const isOwner = req.user && publication.user_id === req.user.id;
    const isAdmin = req.user && req.user.role === 'ADMIN';
    if (publication.visibility === 'PRIVATE' && !isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'This publication is private.' }
      });
    }

    // Do not leak password_hash in response
    const { password_hash, storage_key, ...safePublication } = publication;

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
router.get('/:id/pdf', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const publication = db.getPublicationById(id);

    if (!publication) {
      return res.status(404).send('Publication not found');
    }

    // Enforce Private Visibility
    const isOwner = req.user && publication.user_id === req.user.id;
    const isAdmin = req.user && req.user.role === 'ADMIN';
    if (publication.visibility === 'PRIVATE' && !isOwner && !isAdmin) {
      return res.status(403).send('This publication is private.');
    }

    // Enforce Password Protection
    if (publication.visibility === 'PASSWORD_PROTECTED' && !isOwner && !isAdmin) {
      let token = req.query.token;
      if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.substring(7);
      }

      const isAuthorized = authService.verifyViewerToken(token, id);
      if (!isAuthorized) {
        return res.status(401).send('Viewer authorization token required for password protected publication.');
      }
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
