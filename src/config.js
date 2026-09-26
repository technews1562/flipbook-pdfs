const path = require('path');
require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 8080,
  nodeEnv: process.env.NODE_ENV || 'development',
  appUrl: process.env.APP_URL || 'http://localhost:8080',
  publicViewerBaseUrl: (process.env.PUBLIC_VIEWER_BASE_URL || process.env.APP_URL || 'https://flipviewpdf.com').replace(/\/+$/, ''),

  getPublicViewerUrl(publicationId) {
    const base = (process.env.PUBLIC_VIEWER_BASE_URL || process.env.APP_URL || 'https://flipviewpdf.com').replace(/\/+$/, '');
    return `${base}/view/${publicationId}`;
  },

  // Database
  databaseUrl: process.env.DATABASE_URL || path.join(__dirname, '../../data/flipview.db'),

  // Cloudflare R2 / S3 Storage
  storage: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucketName: process.env.R2_BUCKET_NAME || 'flipview-pdfs',
    publicUrl: (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, ''),
    endpoint: process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : ''),
    localStorageDir: path.join(__dirname, '../../data/uploads')
  },

  // Google Blogger Integration
  blogger: {
    blogId: process.env.BLOGGER_BLOG_ID || process.env.BLOG_ID || '5830475951713053686',
    blogDomain: process.env.BLOG_DOMAIN || 'flipviewpdf.blogspot.com',
    clientId: process.env.BLOGGER_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.BLOGGER_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '',
    refreshToken: process.env.BLOGGER_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN || '',
    accessToken: process.env.BLOGGER_ACCESS_TOKEN || '',
    resendApiKey: process.env.RESEND_API_KEY || '',
    postEmail: process.env.BLOGGER_POST_EMAIL || '',
    smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
    smtpPort: parseInt(process.env.SMTP_PORT, 10) || 587,
    smtpUser: process.env.SMTP_USER || 'technews1562@gmail.com',
    smtpPass: process.env.SMTP_PASS || 'unxkuzpunhknpadt'
  },

  // Email Notification Settings
  email: {
    smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
    smtpPort: parseInt(process.env.SMTP_PORT, 10) || 587,
    smtpUser: process.env.SMTP_USER || 'technews1562@gmail.com',
    smtpPass: process.env.SMTP_PASS || 'unxkuzpunhknpadt',
    resendApiKey: process.env.RESEND_API_KEY || '',
    fromAddress: process.env.EMAIL_FROM || '"FlipView" <technews1562@gmail.com>'
  },

  // Admin Security
  adminApiKey: process.env.ADMIN_API_KEY || 'flipview-admin-secret-key',

  // JWT Authentication
  jwt: {
    secret: process.env.JWT_SECRET || 'flipview-jwt-secret-key-2026-production',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'flipview-jwt-refresh-secret-key-2026-production',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresInDays: parseInt(process.env.JWT_REFRESH_EXPIRES_DAYS, 10) || 30
  },

  // Upload Settings
  upload: {
    chunkSize: parseInt(process.env.UPLOAD_CHUNK_SIZE, 10) || 2097152, // 2 MB standard chunk
    sessionTtlMinutes: parseInt(process.env.UPLOAD_SESSION_TTL_MINUTES, 10) || 30,
    tempDir: process.env.UPLOAD_TEMP_DIR || path.join(__dirname, '../../data/tmp_uploads')
  },

  // Legacy Migration Settings
  legacyGithub: {
    repo: process.env.GITHUB_REPO || 'technews1562/flipbook-pdfs',
    token: process.env.GITHUB_TOKEN || ''
  }
};
