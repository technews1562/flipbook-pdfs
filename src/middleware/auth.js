const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db/database');

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Extract token from Authorization header (Bearer token)
 */
function extractBearerToken(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  return null;
}

/**
 * Check if request carries a valid legacy admin API key
 */
function verifyLegacyAdminKey(req) {
  const adminKey = req.headers['x-admin-key'] || extractBearerToken(req);
  if (!adminKey || !config.adminApiKey) return false;
  return timingSafeEqual(adminKey, config.adminApiKey);
}

/**
 * Middleware: Require valid JWT Authentication
 */
function requireAuth(req, res, next) {
  // Support legacy admin key as master override
  if (verifyLegacyAdminKey(req)) {
    req.user = {
      id: db.SYSTEM_ADMIN_ID,
      email: 'admin@flipviewpdf.com',
      role: 'ADMIN',
      plan_id: 'business',
      full_name: 'FlipView System Admin',
      isLegacyAdmin: true
    };
    return next();
  }

  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required. Please provide a Bearer access token.' }
    });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    const user = db.getUserById(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User account no longer exists.' }
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role || 'USER',
      plan_id: user.plan_id || 'free',
      full_name: user.full_name || ''
    };

    return next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Access token is invalid or has expired.' }
    });
  }
}

/**
 * Middleware: Optional Authentication (Extracts user if present, doesn't fail if anonymous)
 */
function optionalAuth(req, res, next) {
  if (verifyLegacyAdminKey(req)) {
    req.user = {
      id: db.SYSTEM_ADMIN_ID,
      email: 'admin@flipviewpdf.com',
      role: 'ADMIN',
      plan_id: 'business',
      full_name: 'FlipView System Admin',
      isLegacyAdmin: true
    };
    return next();
  }

  const token = extractBearerToken(req);
  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    const user = db.getUserById(decoded.id);
    if (user) {
      req.user = {
        id: user.id,
        email: user.email,
        role: user.role || 'USER',
        plan_id: user.plan_id || 'free',
        full_name: user.full_name || ''
      };
    } else {
      req.user = null;
    }
  } catch (e) {
    req.user = null;
  }

  return next();
}

/**
 * Middleware: Require ADMIN role or legacy admin key
 */
function requireAdmin(req, res, next) {
  if (verifyLegacyAdminKey(req)) {
    req.user = {
      id: db.SYSTEM_ADMIN_ID,
      email: 'admin@flipviewpdf.com',
      role: 'ADMIN',
      plan_id: 'business',
      full_name: 'FlipView System Admin',
      isLegacyAdmin: true
    };
    return next();
  }

  requireAuth(req, res, () => {
    if (req.user && req.user.role === 'ADMIN') {
      return next();
    }
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Administrative access required.' }
    });
  });
}

/**
 * Middleware: Require Publication Ownership or Admin
 */
function requirePublicationOwner(req, res, next) {
  requireAuth(req, res, () => {
    const { id } = req.params;
    const publication = db.getPublicationById(id);

    if (!publication) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `Publication "${id}" not found.` }
      });
    }

    const isOwner = req.user.id === publication.user_id;
    const isAdmin = req.user.role === 'ADMIN';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You do not have permission to modify or delete this publication.' }
      });
    }

    req.publication = publication;
    return next();
  });
}

// Backward compatibility for legacy adminAuth export
module.exports = requireAdmin;
module.exports.requireAuth = requireAuth;
module.exports.optionalAuth = optionalAuth;
module.exports.requireAdmin = requireAdmin;
module.exports.requirePublicationOwner = requirePublicationOwner;
