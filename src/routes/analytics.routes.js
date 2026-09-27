const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { getUserPlan } = require('../middleware/planValidator');

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
      publication_id,
      id,
      eventType,
      event_type,
      pageNumber,
      page_number,
      duration,
      referrer
    } = req.body || {};

    const targetPubId = publicationId || publication_id || id;
    if (!targetPubId) {
      return res.status(200).json({ success: true, data: { recorded: false } });
    }

    const rawType = eventType || event_type || 'VIEW';
    const normalizedEventType = (rawType || 'VIEW').toUpperCase();
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
      page_number: pageNumber || page_number,
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

// -------------------------------------------------------------
// GET /api/analytics/:publicationId (Pro & Business Tier Analytics Dashboard)
// -------------------------------------------------------------
router.get('/:publicationId', requireAuth, (req, res) => {
  try {
    const { publicationId } = req.params;
    const pub = db.getPublicationById(publicationId);

    if (!pub) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Publication not found.' }
      });
    }

    const isAdmin = req.user && req.user.role === 'ADMIN';
    const isOwner = pub.user_id === req.user.id;

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You do not have permission to access analytics for this publication.' }
      });
    }

    // Enforce Pro / Business Analytics Entitlement
    const user = db.getUserById(req.user.id);
    const plan = getUserPlan(user);

    if (!plan.allow_analytics && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PLAN_UPGRADE_REQUIRED',
          message: `Detailed analytics are not available on the ${plan.name} plan. Please upgrade to Pro or Business.`
        }
      });
    }

    const rawEvents = db.getPublicationAnalytics(pub.id) || [];

    // Aggregate telemetry metrics
    const eventTypeCounts = { VIEW: 0, PAGE_TURN: 0, DOWNLOAD: 0, SHARE: 0, QR_SCAN: 0 };
    const pageViews = {};
    const referrerMap = {};
    const countryMap = {};

    for (const ev of rawEvents) {
      if (eventTypeCounts[ev.event_type] !== undefined) {
        eventTypeCounts[ev.event_type]++;
      }
      if (ev.page_number) {
        pageViews[ev.page_number] = (pageViews[ev.page_number] || 0) + 1;
      }
      if (ev.referrer) {
        referrerMap[ev.referrer] = (referrerMap[ev.referrer] || 0) + 1;
      }
      if (ev.country) {
        countryMap[ev.country] = (countryMap[ev.country] || 0) + 1;
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        publicationId: pub.id,
        title: pub.title,
        viewCount: pub.view_count || 0,
        totalEvents: rawEvents.length,
        eventTypes: eventTypeCounts,
        pageViews,
        referrers: referrerMap,
        countries: countryMap,
        recentEvents: rawEvents.slice(0, 100)
      }
    });
  } catch (err) {
    console.error('[Get Analytics Error]', err);
    return res.status(500).json({
      success: false,
      error: { code: 'ANALYTICS_FETCH_FAILED', message: err.message }
    });
  }
});

module.exports = router;
