const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const config = require('./src/config');
const authRouter = require('./src/routes/auth.routes');
const uploadsRouter = require('./src/routes/uploads.routes');
const publicRouter = require('./src/routes/public.routes');
const analyticsRouter = require('./src/routes/analytics.routes');
const publicationsRouter = require('./src/routes/publications.routes');
const adminRouter = require('./src/routes/admin.routes');
const storageService = require('./src/services/storage/storage.service');

const app = express();

// Trust proxy for Railway / Cloud reverse proxy deployments
app.set('trust proxy', 1);

// Enable CORS for all frontends (Blogger domain + localhost + Windows App + Standalone Viewer)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key', 'Range']
}));

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Rate Limiter for Authentication Endpoints (Brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many authentication attempts from this IP. Please try again in 15 minutes.'
    }
  }
});

// Serve Admin UI
app.use('/admin', express.static(path.join(__dirname, 'src/public/admin')));

// Serve Standalone Viewer Static Assets
app.use('/viewer', express.static(path.join(__dirname, 'src/public/viewer')));

// Serve Local Storage files (for dev/local fallback)
app.use('/api/storage', express.static(config.storage.localStorageDir));

// Standalone Public Viewer Route (/view/:publicationId)
app.get('/view/:publicationId*', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/public/viewer/index.html'));
});

// API Routes
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/public', publicRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/publications', publicationsRouter);
app.use('/api', publicationsRouter); // Backward compatibility for /api/upload-chunk, /api/finalize-upload, /api/upload
app.use('/api/admin', adminRouter);

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'FlipView Core API',
    version: '4.0.0',
    phase: 'Phase 4: Standalone Public FlipView Viewer & Public Publication API',
    storage: storageService.isR2Configured ? 'cloudflare_r2' : 'local_disk',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.redirect('/admin');
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Global Error Middleware]', err);
  res.status(err.status || 500).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'An unexpected server error occurred.'
    }
  });
});

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`\n========================================================`);
  console.log(`🚀 FlipView Production Core API running on port ${config.port}`);
  console.log(`🌐 Admin Dashboard : http://localhost:${config.port}/admin`);
  console.log(`🔐 Auth API        : http://localhost:${config.port}/api/auth`);
  console.log(`📤 Uploads API     : http://localhost:${config.port}/api/uploads`);
  console.log(`📦 Storage Engine  : ${storageService.isR2Configured ? 'Cloudflare R2 (' + config.storage.bucketName + ')' : 'Local Disk Fallback'}`);
  console.log(`📰 Blogger Blog ID : ${config.blogger.blogId}`);
  console.log(`========================================================\n`);
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;

module.exports = app;
