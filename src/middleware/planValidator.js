const db = require('../db/database');

/**
 * Helper to fetch user's active plan
 */
function getUserPlan(user) {
  if (!user || !user.plan_id) return db.getPlanById('free');
  return db.getPlanById(user.plan_id);
}

/**
 * Middleware: Check if user has reached their maximum allowed active publications
 */
function checkPublicationLimit(req, res, next) {
  if (!req.user) return next();
  if (req.user.role === 'ADMIN') return next();

  const user = db.getUserById(req.user.id);
  const plan = getUserPlan(user);

  if (plan.max_publications !== -1 && (user.publication_count || 0) >= plan.max_publications) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'PUBLICATION_LIMIT_REACHED',
        message: `You have reached your limit of ${plan.max_publications} publications on the ${plan.name} plan. Please upgrade to Pro for higher limits.`,
        currentCount: user.publication_count,
        maxAllowed: plan.max_publications,
        plan: plan.name
      }
    });
  }

  return next();
}

/**
 * Middleware: Check if upload will exceed user's allocated storage quota
 */
function checkStorageQuota(req, res, next) {
  if (!req.user) return next();
  if (req.user.role === 'ADMIN') return next();

  const user = db.getUserById(req.user.id);
  const plan = getUserPlan(user);
  const incomingSize = req.file ? req.file.size : (req.body.fileSize ? parseInt(req.body.fileSize, 10) : 0);

  if ((user.storage_used_bytes || 0) + incomingSize > plan.max_storage_bytes) {
    const usedMb = ((user.storage_used_bytes || 0) / (1024 * 1024)).toFixed(1);
    const maxMb = (plan.max_storage_bytes / (1024 * 1024)).toFixed(1);
    return res.status(403).json({
      success: false,
      error: {
        code: 'STORAGE_QUOTA_EXCEEDED',
        message: `Uploading this file exceeds your storage limit (${usedMb} MB used of ${maxMb} MB). Please upgrade your plan.`,
        storageUsedBytes: user.storage_used_bytes,
        maxStorageBytes: plan.max_storage_bytes,
        plan: plan.name
      }
    });
  }

  return next();
}

/**
 * Middleware: Check single PDF upload file size limit against plan
 */
function checkPdfSizeLimit(req, res, next) {
  if (!req.user) return next();
  if (req.user.role === 'ADMIN') return next();

  const plan = getUserPlan(req.user);
  const fileSize = req.file ? req.file.size : (req.body.fileSize ? parseInt(req.body.fileSize, 10) : 0);

  if (fileSize > plan.max_pdf_size_bytes) {
    const maxMb = (plan.max_pdf_size_bytes / (1024 * 1024)).toFixed(0);
    return res.status(413).json({
      success: false,
      error: {
        code: 'FILE_TOO_LARGE_FOR_PLAN',
        message: `This PDF exceeds the maximum file size limit of ${maxMb} MB for the ${plan.name} plan.`,
        maxPdfSizeBytes: plan.max_pdf_size_bytes,
        plan: plan.name
      }
    });
  }

  return next();
}

/**
 * Middleware Factory: Enforce plan-gated features (e.g. password protection, custom branding)
 */
function requirePlanFeature(featureKey) {
  return (req, res, next) => {
    if (!req.user) return next();
    if (req.user.role === 'ADMIN') return next();

    const plan = getUserPlan(req.user);
    if (!plan[featureKey]) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FEATURE_NOT_IN_PLAN',
          message: `The feature "${featureKey}" is not included in your ${plan.name} plan. Please upgrade to unlock this feature.`,
          feature: featureKey,
          plan: plan.name
        }
      });
    }

    return next();
  };
}

module.exports = {
  getUserPlan,
  checkPublicationLimit,
  checkStorageQuota,
  checkPdfSizeLimit,
  requirePlanFeature
};
