const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/database');

const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // 120 events per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: true, data: { recorded: false, throttled: true } }
});

// -------------------------------------------------------------
// POST /api/analytics/view & POST /api/analytics/event
// -------------------------------------------------------------
const handleEvent = (req, res) => {
  try {
    const {
      publicationId,
      id,
      eventType = 'VIEW',
      pageNumber,
      duration,
      referrer
    } = req.body || {};

    const targetPubId = publicationId || id;
    if (!targetPubId) {
      return res.status(200).json({ success: true, data: { recorded: false } });
    }

    const normalizedEventType = (eventType || 'VIEW').toUpperCase();
    const validEvents = ['VIEW', 'PAGE_TURN', 'DOWNLOAD', 'SHARE', 'QR_SCAN'];
    const safeType = validEvents.includes(normalizedEventType) ? normalizedEventType : 'VIEW';

    // Increment publication view count on VIEW events
    if (safeType === 'VIEW') {
      db.incrementPublicationView(targetPubId);
    }

    // Persist event record in database
    db.recordAnalyticsEvent({
      publication_id: targetPubId,
      event_type: safeType,
      page_number: pageNumber,
      duration_seconds: duration,
      referrer: (referrer || req.headers.referer || '').slice(0, 500),
      user_agent: (req.headers['user-agent'] || '').slice(0, 500),
      country: (req.headers['cf-ipcountry'] || req.headers['x-country'] || '').slice(0, 10)
    });

    return res.status(200).json({
      success: true,
      data: { recorded: true, eventType: safeType }
    });
  } catch (err) {
    // Analytics failure should never break viewer
    console.warn('[Analytics Event Notice]', err.message);
    return res.status(200).json({
      success: true,
      data: { recorded: false, notice: 'Saved gracefully' }
    });
  }
};

router.post('/view', analyticsLimiter, handleEvent);
router.post('/event', analyticsLimiter, handleEvent);

module.exports = router;
