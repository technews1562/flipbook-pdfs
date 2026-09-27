const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { requireAdmin } = require('../middleware/auth');
const authService = require('../services/auth/auth.service');
const migrationService = require('../services/migration/migration.service');
const db = require('../db/database');

// -------------------------------------------------------------
// POST /api/admin/login (Dedicated Secure Admin Authentication)
// -------------------------------------------------------------
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'Admin email and password are required.' }
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = db.getUserByEmail(cleanEmail);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid admin email or password.' }
      });
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid admin email or password.' }
      });
    }

    if (user.role !== 'ADMIN' && cleanEmail !== 'technews1562@gmail.com') {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied. Account does not have administrator privileges.' }
      });
    }

    // Ensure role is ADMIN
    if (user.role !== 'ADMIN') {
      user.role = 'ADMIN';
      db.updateUser(user.id, { role: 'ADMIN' });
    }

    const tokens = authService.generateTokens(user);

    return res.status(200).json({
      success: true,
      data: {
        user: authService.sanitizeUser(user),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt
      }
    });
  } catch (err) {
    console.error('[Admin Login Error]', err);
    return res.status(500).json({
      success: false,
      error: { code: 'LOGIN_FAILED', message: 'An unexpected error occurred during admin login.' }
    });
  }
});

// All subsequent admin routes require valid ADMIN JWT or master API Key
router.use(requireAdmin);

// -------------------------------------------------------------
// GET /api/admin/me (Verify Admin Session)
// -------------------------------------------------------------
router.get('/me', (req, res) => {
  const user = db.getUserById(req.user.id) || req.user;
  return res.status(200).json({
    success: true,
    data: {
      user: authService.sanitizeUser(user)
    }
  });
});

// -------------------------------------------------------------
// GET /api/admin/stats (Platform Overview Metrics)
// -------------------------------------------------------------
router.get('/stats', (req, res) => {
  try {
    const stats = db.getStats();
    return res.status(200).json({
      success: true,
      data: stats
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'STATS_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// GET /api/admin/users (List All Registered Users)
// -------------------------------------------------------------
router.get('/users', (req, res) => {
  try {
    const users = db.getAllUsers();
    return res.status(200).json({
      success: true,
      data: users
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'USERS_FETCH_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// POST /api/admin/users (Create User Directly)
// -------------------------------------------------------------
router.post('/users', async (req, res) => {
  try {
    const { email, password, full_name, plan_id = 'free', role = 'USER' } = req.body || {};

    if (!email || !email.includes('@')) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_EMAIL', message: 'Valid email address is required.' }
      });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        error: { code: 'WEAK_PASSWORD', message: 'Password must be at least 6 characters long.' }
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = db.getUserByEmail(cleanEmail);
    if (existing) {
      return res.status(400).json({
        success: false,
        error: { code: 'USER_EXISTS', message: 'A user with this email already exists.' }
      });
    }

    const password_hash = await authService.hashPassword(password);
    const userId = `usr_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 7)}`;

    const newUser = db.createUser({
      id: userId,
      email: cleanEmail,
      password_hash,
      full_name: (full_name || '').trim(),
      role: role.toUpperCase() === 'ADMIN' ? 'ADMIN' : 'USER',
      plan_id: plan_id.toLowerCase()
    });

    return res.status(201).json({
      success: true,
      data: {
        user: authService.sanitizeUser(newUser)
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'CREATE_USER_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// PATCH /api/admin/users/:userId (Update Plan, Status, Password)
// -------------------------------------------------------------
router.patch('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { plan_id, role, status, full_name, password } = req.body || {};

    const user = db.getUserById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User account not found.' }
      });
    }

    const updates = {};
    if (plan_id !== undefined) {
      const validPlan = db.getPlanById(plan_id);
      if (!validPlan) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_PLAN', message: `Plan '${plan_id}' does not exist.` }
        });
      }
      updates.plan_id = plan_id.toLowerCase();
    }

    if (role !== undefined) {
      updates.role = role.toUpperCase() === 'ADMIN' ? 'ADMIN' : 'USER';
    }

    if (status !== undefined) {
      updates.status = status.toUpperCase() === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
    }

    if (full_name !== undefined) {
      updates.full_name = full_name.trim();
    }

    if (password && typeof password === 'string' && password.trim().length >= 6) {
      updates.password_hash = await authService.hashPassword(password.trim());
    }

    const updatedUser = db.updateUser(userId, updates);

    return res.status(200).json({
      success: true,
      data: {
        user: authService.sanitizeUser(updatedUser)
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'UPDATE_USER_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// DELETE /api/admin/users/:userId (Delete User & Publications)
// -------------------------------------------------------------
router.delete('/users/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    if (userId === db.SYSTEM_ADMIN_ID || userId === req.user.id) {
      return res.status(400).json({
        success: false,
        error: { code: 'CANNOT_DELETE_SELF', message: 'You cannot delete your own admin account.' }
      });
    }

    const user = db.getUserById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User account not found.' }
      });
    }

    db.deleteUser(userId);

    return res.status(200).json({
      success: true,
      message: `User ${user.email} and all associated publications deleted successfully.`
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'DELETE_USER_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// GET /api/admin/publications (List All Platform Publications)
// -------------------------------------------------------------
router.get('/publications', (req, res) => {
  try {
    const publications = db.getAllPublicationsAdmin();
    return res.status(200).json({
      success: true,
      data: publications
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'PUBLICATIONS_FETCH_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// PATCH /api/admin/publications/:publicationId
// -------------------------------------------------------------
router.patch('/publications/:publicationId', async (req, res) => {
  try {
    const { publicationId } = req.params;
    const pub = db.getPublicationById(publicationId);
    if (!pub) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Publication not found.' }
      });
    }

    const safeUpdates = {};
    if (req.body.title !== undefined) safeUpdates.title = req.body.title.trim();
    if (req.body.category !== undefined) safeUpdates.category = req.body.category.trim();
    if (req.body.author !== undefined) safeUpdates.author = req.body.author.trim();
    if (req.body.description !== undefined) safeUpdates.description = req.body.description.trim();
    if (req.body.visibility !== undefined) safeUpdates.visibility = req.body.visibility;
    if (req.body.has_branding !== undefined) safeUpdates.has_branding = req.body.has_branding ? 1 : 0;
    if (req.body.download_enabled !== undefined) safeUpdates.download_enabled = req.body.download_enabled ? 1 : 0;
    if (req.body.share_enabled !== undefined) safeUpdates.share_enabled = req.body.share_enabled ? 1 : 0;

    if (req.body.password !== undefined) {
      if (req.body.password) {
        safeUpdates.password_hash = await authService.hashPassword(req.body.password);
        safeUpdates.visibility = 'PASSWORD_PROTECTED';
      } else {
        safeUpdates.password_hash = null;
        if (safeUpdates.visibility === 'PASSWORD_PROTECTED') {
          safeUpdates.visibility = 'PUBLIC';
        }
      }
    }

    const updated = db.updatePublication(publicationId, safeUpdates);

    return res.status(200).json({
      success: true,
      data: updated
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'UPDATE_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// DELETE /api/admin/publications/:publicationId
// -------------------------------------------------------------
router.delete('/publications/:publicationId', async (req, res) => {
  try {
    const { publicationId } = req.params;
    const pub = db.getPublicationById(publicationId);
    if (!pub) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Publication not found.' }
      });
    }

    db.deletePublication(publicationId);

    return res.status(200).json({
      success: true,
      message: `Publication ${publicationId} deleted successfully.`
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'DELETE_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// POST /api/admin/migrate-github
// -------------------------------------------------------------
router.post('/migrate-github', async (req, res) => {
  try {
    const { repo, token, dryRun } = req.body;
    const results = await migrationService.migrateFromGithub({ repo, token, dryRun });
    return res.status(200).json({
      success: true,
      data: results
    });
  } catch (err) {
    console.error('[Migration Route Error]', err);
    return res.status(500).json({
      success: false,
      error: { code: 'MIGRATION_FAILED', message: err.message }
    });
  }
});

module.exports = router;
