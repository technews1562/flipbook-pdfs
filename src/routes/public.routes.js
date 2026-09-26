const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const config = require('../config');
const db = require('../db/database');
const authService = require('../services/auth/auth.service');
const storageService = require('../services/storage/storage.service');

// Rate limiting for password verification against brute force
const passwordVerifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30, // 30 attempts per 5 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many password attempts. Please try again in 5 minutes.'
    }
  }
});

// -------------------------------------------------------------
// GET /api/public/:publicationId (Sanitized Reader Metadata DTO)
// -------------------------------------------------------------
router.get('/:publicationId', (req, res) => {
  try {
    const { publicationId } = req.params;
    const pub = db.getPublicationById(publicationId);

    if (!pub) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Flipbook "${publicationId}" not found.`
        }
      });
    }

    // Enforce Visibility Rules
    if (pub.visibility === 'PRIVATE') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PUBLICATION_PRIVATE',
          message: 'This flipbook is private.'
        }
      });
    }

    const publicDto = db.getPublicPublicationById(publicationId);

    return res.status(200).json({
      success: true,
      data: {
        publication: publicDto
      }
    });
  } catch (err) {
    console.error('[Public Metadata Error]', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Unable to retrieve publication details.'
      }
    });
  }
});

// -------------------------------------------------------------
// POST /api/public/:publicationId/verify-password
// -------------------------------------------------------------
router.post('/:publicationId/verify-password', passwordVerifyLimiter, async (req, res) => {
  try {
    const { publicationId } = req.params;
    const { password } = req.body || {};

    const pub = db.getPublicationById(publicationId);
    if (!pub) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Flipbook not found.' }
      });
    }

    if (pub.visibility !== 'PASSWORD_PROTECTED') {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_PASSWORD_REQUIRED', message: 'This publication is not password protected.' }
      });
    }

    if (!pub.password_hash) {
      // If marked protected but no hash set, allow access
      const token = authService.generateViewerToken(publicationId, '15m');
      return res.status(200).json({
        success: true,
        data: {
          viewerToken: token,
          expiresIn: 900,
          publicationId
        }
      });
    }

    if (!password || typeof password !== 'string') {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_PASSWORD', message: 'Incorrect password.' }
      });
    }

    const isValid = await authService.verifyPassword(password, pub.password_hash);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_PASSWORD', message: 'Incorrect password.' }
      });
    }

    const viewerToken = authService.generateViewerToken(publicationId, '15m');

    return res.status(200).json({
      success: true,
      data: {
        viewerToken,
        expiresIn: 900,
        publicationId
      }
    });
  } catch (err) {
    console.error('[Password Verify Error]', err);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'An unexpected error occurred verifying password.' }
    });
  }
});

// -------------------------------------------------------------
// GET /api/public/:publicationId/pdf (CORS-enabled Range Streaming)
// -------------------------------------------------------------
router.all('/:publicationId/pdf', async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      return res.status(405).send('Method Not Allowed');
    }

    // CORS Headers for PDF.js canvas streaming
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Authorization, Content-Type, Accept');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, ETag, Last-Modified');

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    const { publicationId } = req.params;
    const pub = db.getPublicationById(publicationId);

    if (!pub) {
      return res.status(404).send('Flipbook not found');
    }

    // Enforce Visibility
    if (pub.visibility === 'PRIVATE') {
      return res.status(403).send('This publication is private.');
    }

    // Enforce Password Protection
    if (pub.visibility === 'PASSWORD_PROTECTED') {
      let token = req.query.token;
      if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.substring(7);
      }

      const isAuthorized = authService.verifyViewerToken(token, publicationId);
      if (!isAuthorized) {
        return res.status(401).send('Viewer authorization token required for password protected publication.');
      }
    }

    // Enforce Download Setting
    if (req.query.download === '1' && pub.download_enabled === 0) {
      return res.status(403).send('Direct download is disabled for this publication.');
    }

    // Common PDF Streaming Headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Accept-Ranges', 'bytes');
    const isAttachment = req.query.download === '1' && pub.download_enabled !== 0;
    const disposition = isAttachment ? 'attachment' : 'inline';
    const filename = pub.pdf_filename || `${pub.id}.pdf`;
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(filename)}"`);

    // Cache headers
    if (pub.visibility === 'PASSWORD_PROTECTED' || pub.visibility === 'PRIVATE') {
      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    }

    const range = req.headers.range;
    const streamResult = await storageService.getReadStream(pub.storage_key, range);

    if (streamResult.eTag) res.setHeader('ETag', streamResult.eTag);
    if (streamResult.lastModified) res.setHeader('Last-Modified', new Date(streamResult.lastModified).toUTCString());

    if (req.method === 'HEAD') {
      if (streamResult.contentLength) res.setHeader('Content-Length', streamResult.contentLength);
      return res.status(200).end();
    }

    if (streamResult.isRange && streamResult.contentRange) {
      res.setHeader('Content-Range', streamResult.contentRange);
      res.setHeader('Content-Length', streamResult.contentLength);
      res.status(206);
    } else {
      if (streamResult.contentLength) res.setHeader('Content-Length', streamResult.contentLength);
      res.status(200);
    }

    // Pipe stream to client
    streamResult.stream.on('error', (streamErr) => {
      console.warn('[PDF ReadStream Error]', streamErr.message);
      if (!res.headersSent) {
        res.status(500).send('Error streaming PDF');
      }
    });

    return streamResult.stream.pipe(res);
  } catch (err) {
    console.error('[Public PDF Stream Error]', err.message);
    if (!res.headersSent) {
      return res.status(500).send('Error retrieving PDF stream');
    }
  }
});

// -------------------------------------------------------------
// GET /api/public/:publicationId/cover (Cover Image Stream)
// -------------------------------------------------------------
router.get('/:publicationId/cover', async (req, res) => {
  try {
    const { publicationId } = req.params;
    const pub = db.getPublicationById(publicationId);

    if (!pub) {
      return res.status(404).send('Publication not found');
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    if (pub.cover_url) {
      if (pub.cover_url.startsWith('http://') || pub.cover_url.startsWith('https://')) {
        return res.redirect(302, pub.cover_url);
      }
      if (pub.cover_url.startsWith('data:image/svg+xml')) {
        const svgData = decodeURIComponent(pub.cover_url.split(',')[1] || '');
        res.setHeader('Content-Type', 'image/svg+xml');
        return res.send(svgData);
      }
    }

    // Fallback: Check R2 namespaced cover or generate default SVG
    const coverKey = `users/${pub.user_id}/publications/${pub.id}/cover.webp`;
    try {
      const exists = await storageService.exists(coverKey);
      if (exists) {
        const streamResult = await storageService.getReadStream(coverKey);
        res.setHeader('Content-Type', 'image/webp');
        return streamResult.stream.pipe(res);
      }
    } catch (e) {}

    // Fallback SVG placeholder
    res.setHeader('Content-Type', 'image/svg+xml');
    const title = (pub.title || 'Publication').slice(0, 30);
    const category = pub.category || 'Magazine';
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
    console.error('[Public Cover Stream Error]', err);
    return res.status(500).send('Error loading cover');
  }
});

module.exports = router;
