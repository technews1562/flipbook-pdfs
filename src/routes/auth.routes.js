const express = require('express');
const router = express.Router();
const authService = require('../services/auth/auth.service');
const { requireAuth } = require('../middleware/auth');
const db = require('../db/database');

// -------------------------------------------------------------
// POST /api/auth/register
// -------------------------------------------------------------
router.post('/register', async (req, res) => {
  try {
    const { email, password, full_name, client_type } = req.body;
    const ip_address = req.ip || req.headers['x-forwarded-for'] || '';
    const user_agent = req.headers['user-agent'] || '';

    const result = await authService.register({
      email,
      password,
      full_name,
      client_type,
      ip_address,
      user_agent
    });

    return res.status(201).json({
      success: true,
      data: result
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: { code: 'REGISTRATION_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// POST /api/auth/login
// -------------------------------------------------------------
router.post('/login', async (req, res) => {
  try {
    const { email, password, client_type } = req.body;
    const ip_address = req.ip || req.headers['x-forwarded-for'] || '';
    const user_agent = req.headers['user-agent'] || '';

    const result = await authService.login({
      email,
      password,
      client_type,
      ip_address,
      user_agent
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: { code: 'AUTH_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// GET /api/auth/me
// -------------------------------------------------------------
router.get('/me', requireAuth, (req, res) => {
  try {
    const user = db.getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User account not found.' }
      });
    }

    return res.status(200).json({
      success: true,
      data: authService.sanitizeUser(user)
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'FETCH_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// POST /api/auth/refresh
// -------------------------------------------------------------
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken, client_type } = req.body;
    const ip_address = req.ip || req.headers['x-forwarded-for'] || '';
    const user_agent = req.headers['user-agent'] || '';

    const result = await authService.refresh({
      refreshToken,
      client_type,
      ip_address,
      user_agent
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: { code: 'REFRESH_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// POST /api/auth/logout
// -------------------------------------------------------------
router.post('/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    await authService.logout(refreshToken);

    return res.status(200).json({
      success: true,
      data: { message: 'Logged out successfully.' }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'LOGOUT_FAILED', message: err.message }
    });
  }
});

// -------------------------------------------------------------
// GET /api/auth/plans (Public Plans Information)
// -------------------------------------------------------------
router.get('/plans', (req, res) => {
  try {
    const plans = db.listPlans();
    return res.status(200).json({
      success: true,
      data: plans
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'PLANS_FETCH_FAILED', message: err.message }
    });
  }
});

module.exports = router;
