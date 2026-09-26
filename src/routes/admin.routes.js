const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const migrationService = require('../services/migration/migration.service');
const db = require('../db/database');

router.use(requireAdmin);

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

// -------------------------------------------------------------
// GET /api/admin/stats
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

module.exports = router;
