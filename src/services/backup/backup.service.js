const fs = require('fs');
const path = require('path');
const db = require('../../db/database');
const storageService = require('../storage/storage.service');

class BackupService {
  constructor() {
    this.backupDir = path.join(process.cwd(), 'data', 'backups');
    this.ensureBackupDir();
    this.timer = null;
    this.isBackingUp = false;
  }

  ensureBackupDir() {
    if (!fs.existsSync(this.backupDir)) {
      try {
        fs.mkdirSync(this.backupDir, { recursive: true });
      } catch (e) {
        console.error('[BackupService] Failed to create backup dir:', e);
      }
    }
  }

  /**
   * Start automated daily backup scheduler (runs every 24 hours)
   */
  startDailyScheduler() {
    console.log('[BackupService] Starting automated daily database backup scheduler...');
    
    // Check if we need an initial backup on startup
    this.checkAndRunInitialBackup();

    // 24 hours interval in milliseconds (86,400,000 ms)
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    
    if (this.timer) {
      clearInterval(this.timer);
    }

    this.timer = setInterval(() => {
      console.log('[BackupService] ⏰ Triggering scheduled daily database backup...');
      this.createBackup('SCHEDULED_DAILY').catch(err => {
        console.error('[BackupService] Scheduled backup error:', err);
      });
    }, TWENTY_FOUR_HOURS);
  }

  async checkAndRunInitialBackup() {
    try {
      const backups = this.listLocalBackups();
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      
      const hasRecentBackup = backups.some(b => new Date(b.created_at).getTime() > oneDayAgo);
      if (!hasRecentBackup) {
        console.log('[BackupService] No backup found in the last 24h. Creating initial database snapshot...');
        await this.createBackup('INITIAL_STARTUP');
      } else {
        console.log(`[BackupService] Recent backup exists (${backups[0].filename}). Next backup in 24 hours.`);
      }
    } catch (err) {
      console.error('[BackupService] Initial backup check error:', err);
    }
  }

  /**
   * Create a full database backup (Local Disk + Cloudflare R2)
   */
  async createBackup(triggerType = 'MANUAL') {
    if (this.isBackingUp) {
      return { success: false, message: 'A backup is already in progress.' };
    }

    this.isBackingUp = true;
    const now = new Date();
    const dateStr = now.toISOString().replace(/[:.]/g, '-');
    const filename = `flipview-db-backup-${dateStr}.json`;
    const localFilePath = path.join(this.backupDir, filename);
    const latestFilePath = path.join(this.backupDir, 'flipview-db-backup-latest.json');

    try {
      this.ensureBackupDir();

      // Collect complete database snapshot
      const rawData = db.getRawStores ? db.getRawStores() : {
        users: db.getAllUsers ? db.getAllUsers() : [],
        publications: db.getAllPublications ? db.getAllPublications() : [],
        plans: db.getAllPlans ? db.getAllPlans() : []
      };

      const backupPayload = {
        version: '1.0.0',
        trigger: triggerType,
        created_at: now.toISOString(),
        counts: {
          users: (rawData.users || []).length,
          publications: (rawData.publications || []).length,
          plans: (rawData.plans || []).length,
          analytics_events: (rawData.analytics || []).length,
          upload_sessions: (rawData.upload_sessions || []).length,
          password_resets: (rawData.password_resets || []).length
        },
        data: rawData
      };

      const jsonString = JSON.stringify(backupPayload, null, 2);
      const buffer = Buffer.from(jsonString, 'utf-8');

      // 1. Save locally with timestamp and update latest pointer
      fs.writeFileSync(localFilePath, jsonString, 'utf-8');
      fs.writeFileSync(latestFilePath, jsonString, 'utf-8');

      const fileSizeKb = (buffer.length / 1024).toFixed(2);
      console.log(`[BackupService] ✅ Local backup created: ${filename} (${fileSizeKb} KB)`);

      // 2. Upload and mirror to Cloudflare R2 cloud storage
      let r2Uploaded = false;
      let r2Url = '';
      try {
        if (storageService && storageService.isR2Configured) {
          const r2Key = `backups/database/${filename}`;
          const r2LatestKey = `backups/database/flipview-db-backup-latest.json`;
          
          const result = await storageService.upload(r2Key, buffer, 'application/json');
          await storageService.upload(r2LatestKey, buffer, 'application/json');
          
          r2Uploaded = true;
          r2Url = result.url || r2Key;
          console.log(`[BackupService] ☁️ Cloudflare R2 backup mirrored: ${r2Key}`);
        }
      } catch (r2Err) {
        console.warn(`[BackupService] Cloudflare R2 backup upload note: ${r2Err.message}`);
      }

      // 3. Prune old local backups (keep last 30)
      this.pruneOldBackups(30);

      return {
        success: true,
        filename,
        size_bytes: buffer.length,
        size_kb: fileSizeKb,
        created_at: now.toISOString(),
        trigger: triggerType,
        counts: backupPayload.counts,
        local_path: localFilePath,
        r2_mirrored: r2Uploaded,
        r2_url: r2Url
      };
    } catch (err) {
      console.error('[BackupService] Error creating backup:', err);
      throw err;
    } finally {
      this.isBackingUp = false;
    }
  }

  /**
   * List all locally saved database backups
   */
  listLocalBackups() {
    this.ensureBackupDir();
    try {
      const files = fs.readdirSync(this.backupDir);
      const backups = [];

      for (const f of files) {
        if (f.startsWith('flipview-db-backup-') && f.endsWith('.json') && f !== 'flipview-db-backup-latest.json') {
          const filePath = path.join(this.backupDir, f);
          const stats = fs.statSync(filePath);
          
          let counts = null;
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(content);
            counts = parsed.counts;
          } catch (e) {}

          backups.push({
            filename: f,
            size_bytes: stats.size,
            size_kb: (stats.size / 1024).toFixed(2),
            created_at: stats.mtime.toISOString(),
            counts: counts || { users: '—', publications: '—' }
          });
        }
      }

      // Sort newest first
      return backups.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } catch (err) {
      console.error('[BackupService] List backups error:', err);
      return [];
    }
  }

  /**
   * Get specific backup file stream or JSON
   */
  getBackupContent(filename) {
    // Sanitization to prevent path traversal
    const cleanName = path.basename(filename);
    const filePath = path.join(this.backupDir, cleanName);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    return {
      filePath,
      content: fs.readFileSync(filePath, 'utf-8')
    };
  }

  /**
   * Restore database from backup data
   */
  restoreFromData(backupPayload) {
    if (!backupPayload || !backupPayload.data) {
      throw new Error('Invalid backup file structure: missing data node.');
    }

    if (db.restoreRawStores) {
      return db.restoreRawStores(backupPayload.data);
    } else {
      throw new Error('Database does not support restore operation.');
    }
  }

  /**
   * Keep only last N backups
   */
  pruneOldBackups(keepCount = 30) {
    try {
      const backups = this.listLocalBackups();
      if (backups.length > keepCount) {
        const toDelete = backups.slice(keepCount);
        for (const item of toDelete) {
          const p = path.join(this.backupDir, item.filename);
          if (fs.existsSync(p)) {
            fs.unlinkSync(p);
            console.log(`[BackupService] Pruned old backup: ${item.filename}`);
          }
        }
      }
    } catch (err) {
      console.error('[BackupService] Prune error:', err);
    }
  }
}

module.exports = new BackupService();
