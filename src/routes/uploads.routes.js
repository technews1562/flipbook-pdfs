const express = require('express');
const router = express.Router();
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const uploadService = require('../services/upload/upload.service');
const { requireAuth } = require('../middleware/auth');

// Configure Multer for 2MB chunk streaming
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB safety margin per individual chunk request
});

// Rate Limiter for Upload Init & Complete (prevents spam session creation)
const uploadInitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60, // 60 session inits per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many upload sessions initiated. Please wait a few minutes before starting new uploads.'
    }
  }
});

// -------------------------------------------------------------
// POST /api/uploads/init (Start Authenticated Upload Session)
// -------------------------------------------------------------
router.post('/init', requireAuth, uploadInitLimiter, async (req, res) => {
  try {
    const {
      filename,
      fileSize,
      contentType,
      totalChunks,
      fileHash,
      title,
      category,
      description,
      author,
      visibility
    } = req.body;

    const result = await uploadService.initUpload({
      userId: req.user.id,
      filename,
      fileSize,
      contentType,
      totalChunks,
      fileHash,
      title,
      category,
      description,
      author,
      visibility
    });

    return res.status(201).json({
      success: true,
      data: result
    });
  } catch (err) {
    const status = err.status || 400;
    return res.status(status).json({
      success: false,
      error: {
        code: err.code || 'INIT_FAILED',
        message: err.message
      }
    });
  }
});

// -------------------------------------------------------------
// POST /api/uploads/chunk (Stream Single 2MB Binary Chunk)
// -------------------------------------------------------------
router.post('/chunk', requireAuth, upload.single('chunk'), async (req, res) => {
  try {
    const { uploadId, chunkIndex } = req.body;
    const chunkBuffer = req.file ? req.file.buffer : null;

    if (!chunkBuffer) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_CHUNK_PAYLOAD',
          message: 'No binary chunk attached under field "chunk".'
        }
      });
    }

    const result = await uploadService.saveChunk({
      userId: req.user.id,
      uploadId,
      chunkIndex,
      buffer: chunkBuffer
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    const status = err.status || 400;
    return res.status(status).json({
      success: false,
      error: {
        code: err.code || 'CHUNK_UPLOAD_FAILED',
        message: err.message
      }
    });
  }
});

// -------------------------------------------------------------
// POST /api/uploads/complete (Finalize, Assemble, R2 Upload & DB Save)
// -------------------------------------------------------------
router.post('/complete', requireAuth, uploadInitLimiter, async (req, res) => {
  try {
    const { uploadId, title, category, description, author, coverBase64, visibility, password } = req.body;

    const result = await uploadService.completeUpload({
      userId: req.user.id,
      uploadId,
      title,
      category,
      description,
      author,
      coverBase64,
      visibility,
      password
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    const status = err.status || 400;
    return res.status(status).json({
      success: false,
      error: {
        code: err.code || 'COMPLETION_FAILED',
        message: err.message
      }
    });
  }
});

// -------------------------------------------------------------
// GET /api/uploads/:id (Resume API: Check Upload Status & Chunks)
// -------------------------------------------------------------
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const isAdmin = req.user.role === 'ADMIN';

    const result = await uploadService.getUploadStatus({
      userId: req.user.id,
      uploadId: id,
      isAdmin
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({
      success: false,
      error: { code: err.code || 'FETCH_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// DELETE /api/uploads/:id (Cancel Upload Session & Clean Temp Chunks)
// -------------------------------------------------------------
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await uploadService.cancelUpload({
      userId: req.user.id,
      uploadId: id
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    const status = err.status || 400;
    return res.status(status).json({
      success: false,
      error: {
        code: err.code || 'CANCEL_FAILED',
        message: err.message
      }
    });
  }
});

module.exports = router;
