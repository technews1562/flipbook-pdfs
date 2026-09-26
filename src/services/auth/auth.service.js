const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const db = require('../../db/database');
const emailService = require('../email/email.service');

class AuthService {
  /**
   * Hash a raw password with bcrypt
   */
  async hashPassword(password) {
    if (!password || typeof password !== 'string' || password.length < 6) {
      throw new Error('Password must be at least 6 characters long.');
    }
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(password, salt);
  }

  /**
   * Verify raw password against stored hash
   */
  async verifyPassword(password, hash) {
    if (!password || !hash) return false;
    return await bcrypt.compare(password, hash);
  }

  /**
   * Compute SHA-256 hash of a refresh token for safe database persistence
   */
  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generate short-lived Access Token & long-lived Refresh Token
   */
  generateTokens(user) {
    const payload = {
      id: user.id,
      email: user.email,
      role: user.role || 'USER',
      plan_id: user.plan_id || 'free',
      full_name: user.full_name || ''
    };

    const accessToken = jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.accessExpiresIn || '15m'
    });

    const rawRefreshToken = crypto.randomBytes(40).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);

    const expiresAt = new Date(Date.now() + (config.jwt.refreshExpiresInDays || 30) * 24 * 60 * 60 * 1000).toISOString();

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      tokenHash,
      expiresAt
    };
  }

  /**
   * Strip sensitive fields from user object
   */
  sanitizeUser(user) {
    if (!user) return null;
    const { password_hash, ...safeUser } = user;
    // Attach plan details
    const plan = db.getPlanById(safeUser.plan_id);
    return {
      ...safeUser,
      plan: plan || null
    };
  }

  /**
   * Register a new user
   */
  async register({ email, password, full_name, client_type = 'WEB', ip_address = '', user_agent = '' }) {
    if (!email || !email.includes('@')) {
      throw new Error('Please provide a valid email address.');
    }
    const cleanEmail = email.trim().toLowerCase();

    const existing = db.getUserByEmail(cleanEmail);
    if (existing) {
      throw new Error('An account with this email address already exists.');
    }

    const password_hash = await this.hashPassword(password);
    const userId = `usr_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 7)}`;

    const user = db.createUser({
      id: userId,
      email: cleanEmail,
      password_hash,
      full_name: (full_name || '').trim(),
      role: 'USER',
      plan_id: 'free'
    });

    const { accessToken, refreshToken, tokenHash, expiresAt } = this.generateTokens(user);

    db.createSession({
      user_id: user.id,
      token_hash: tokenHash,
      client_type,
      ip_address,
      user_agent,
      expires_at: expiresAt
    });

    return {
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken
    };
  }

  /**
   * Authenticate user by email and password
   */
  async login({ email, password, client_type = 'WEB', ip_address = '', user_agent = '' }) {
    if (!email || !password) {
      throw new Error('Email and password are required.');
    }
    const cleanEmail = email.trim().toLowerCase();

    const user = db.getUserByEmail(cleanEmail);
    if (!user) {
      throw new Error('Invalid email or password.');
    }

    const isValid = await this.verifyPassword(password, user.password_hash);
    if (!isValid) {
      throw new Error('Invalid email or password.');
    }

    const { accessToken, refreshToken, tokenHash, expiresAt } = this.generateTokens(user);

    db.createSession({
      user_id: user.id,
      token_hash: tokenHash,
      client_type,
      ip_address,
      user_agent,
      expires_at: expiresAt
    });

    return {
      user: this.sanitizeUser(user),
      accessToken,
      refreshToken
    };
  }

  /**
   * Refresh access token using valid refresh token
   */
  async refresh({ refreshToken, client_type = 'WEB', ip_address = '', user_agent = '' }) {
    if (!refreshToken) {
      throw new Error('Refresh token is required.');
    }

    const tokenHash = this.hashToken(refreshToken);
    const session = db.getSessionByTokenHash(tokenHash);

    if (!session) {
      throw new Error('Invalid or expired refresh token. Please log in again.');
    }

    const user = db.getUserById(session.user_id);
    if (!user) {
      db.deleteSessionByTokenHash(tokenHash);
      throw new Error('User account not found.');
    }

    // Generate fresh tokens & rotate session
    const tokens = this.generateTokens(user);

    db.deleteSessionByTokenHash(tokenHash);
    db.createSession({
      user_id: user.id,
      token_hash: tokens.tokenHash,
      client_type: client_type || session.client_type,
      ip_address: ip_address || session.ip_address,
      user_agent: user_agent || session.user_agent,
      expires_at: tokens.expiresAt
    });

    return {
      user: this.sanitizeUser(user),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    };
  }

  /**
   * Logout user by revoking refresh token session
   */
  async logout(refreshToken) {
    if (refreshToken) {
      const tokenHash = this.hashToken(refreshToken);
      db.deleteSessionByTokenHash(tokenHash);
    }
    return true;
  }

  /**
   * Generate short-lived Viewer Token for Password Protected publications
   */
  generateViewerToken(publicationId, expiresIn = '15m') {
    return jwt.sign(
      {
        type: 'viewer_grant',
        publicationId: publicationId
      },
      config.jwt.secret,
      { expiresIn }
    );
  }

  /**
   * Verify Viewer Token for a specific publication
   */
  verifyViewerToken(token, publicationId) {
    if (!token) return false;
    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      return decoded.type === 'viewer_grant' && decoded.publicationId === publicationId;
    } catch (e) {
      return false;
    }
  }

  /**
   * Request a 6-digit password reset verification code
   */
  async requestPasswordReset(email) {
    if (!email || !email.includes('@')) {
      throw new Error('Please provide a valid email address.');
    }
    const cleanEmail = email.trim().toLowerCase();
    const user = db.getUserByEmail(cleanEmail);

    if (!user) {
      // Do not reveal whether user exists for security, return positive message
      return {
        message: 'If an account with that email exists, a verification code has been sent.'
      };
    }

    // Generate cryptographically secure 6-digit code
    const code = Math.floor(100000 + crypto.randomInt(0, 900000)).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    db.createPasswordReset({
      email: cleanEmail,
      code,
      expires_at: expiresAt
    });

    // Send email asynchronously
    emailService.sendPasswordResetEmail(cleanEmail, code, user.full_name).catch(err => {
      console.error('[AuthService] Failed to send password reset email:', err.message);
    });

    return {
      message: 'If an account with that email exists, a verification code has been sent.'
    };
  }

  /**
   * Reset user password using verification code
   */
  async resetPasswordWithCode({ email, code, new_password, client_type = 'WEB', ip_address = '', user_agent = '' }) {
    if (!email || !email.includes('@')) {
      throw new Error('Please provide a valid email address.');
    }
    if (!code || String(code).trim().length !== 6) {
      throw new Error('Please provide a valid 6-digit verification code.');
    }
    if (!new_password || typeof new_password !== 'string' || new_password.length < 6) {
      throw new Error('New password must be at least 6 characters long.');
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = String(code).trim();

    const resetRecord = db.getPasswordReset(cleanEmail, cleanCode);
    if (!resetRecord) {
      throw new Error('Invalid or expired verification code. Please request a new code.');
    }

    const user = db.getUserByEmail(cleanEmail);
    if (!user) {
      throw new Error('User account not found.');
    }

    // Hash new password and update user
    const newPasswordHash = await this.hashPassword(new_password);
    db.updateUser(user.id, { password_hash: newPasswordHash });

    // Revoke previous sessions & remove used reset code
    db.deleteUserSessions(user.id);
    db.deletePasswordReset(cleanEmail);

    // Automatically generate new session & tokens for seamless user experience
    const updatedUser = db.getUserById(user.id);
    const tokens = this.generateTokens(updatedUser);

    db.createSession({
      user_id: user.id,
      token_hash: tokens.tokenHash,
      client_type,
      ip_address,
      user_agent,
      expires_at: tokens.expiresAt
    });

    return {
      user: this.sanitizeUser(updatedUser),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      message: 'Password reset successfully. You are now logged in.'
    };
  }
}

module.exports = new AuthService();
