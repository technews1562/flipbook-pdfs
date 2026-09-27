const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('../config');

// Determine database storage path
const dbPath = config.databaseUrl || path.join(process.cwd(), 'data', 'flipview.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  try { fs.mkdirSync(dbDir, { recursive: true }); } catch (e) {}
}

const jsonDbPath = path.join(dbDir, 'publications-store.json');
const jsonUsersPath = path.join(dbDir, 'users-store.json');
const jsonSessionsPath = path.join(dbDir, 'sessions-store.json');
const jsonPlansPath = path.join(dbDir, 'plans-store.json');
const jsonUploadSessionsPath = path.join(dbDir, 'upload-sessions-store.json');
const jsonAnalyticsEventsPath = path.join(dbDir, 'analytics-events-store.json');
const jsonPasswordResetsPath = path.join(dbDir, 'password-resets-store.json');

// In-Memory Data Stores (Fallback & Sync)
let memoryStore = [];
let usersStore = [];
let sessionsStore = [];
let plansStore = [];
let uploadSessionsStore = [];
let analyticsEventsStore = [];
let passwordResetsStore = [];

let storageService = null;
function getStorageService() {
  if (!storageService) {
    try {
      storageService = require('../services/storage/storage.service');
    } catch (e) {}
  }
  return storageService;
}

// -------------------------------------------------------------
// DEFAULT PLANS DEFINITION
// -------------------------------------------------------------
const DEFAULT_PLANS = [
  {
    id: 'free',
    name: 'Free',
    max_publications: 5,
    max_storage_bytes: 100 * 1024 * 1024, // 100 MB
    max_pdf_size_bytes: 25 * 1024 * 1024, // 25 MB
    max_pages_per_doc: 30,
    has_branding: 1,
    allow_password_protect: 0,
    allow_analytics: 0,
    allow_download: 1,
    created_at: new Date('2026-01-01T00:00:00.000Z').toISOString()
  },
  {
    id: 'pro',
    name: 'Pro',
    max_publications: 250,
    max_storage_bytes: 10 * 1024 * 1024 * 1024, // 10 GB
    max_pdf_size_bytes: 200 * 1024 * 1024, // 200 MB
    max_pages_per_doc: 1000,
    has_branding: 0,
    allow_password_protect: 1,
    allow_analytics: 1,
    allow_download: 1,
    created_at: new Date('2026-01-01T00:00:00.000Z').toISOString()
  },
  {
    id: 'business',
    name: 'Business',
    max_publications: 1000,
    max_storage_bytes: 50 * 1024 * 1024 * 1024, // 50 GB
    max_pdf_size_bytes: 500 * 1024 * 1024, // 500 MB
    max_pages_per_doc: 2500,
    has_branding: 0,
    allow_password_protect: 1,
    allow_analytics: 1,
    allow_download: 1,
    created_at: new Date('2026-01-01T00:00:00.000Z').toISOString()
  }
];

const SYSTEM_ADMIN_ID = 'usr_system_admin';

// Load Stores from Local JSON
function loadJsonStore() {
  try {
    if (fs.existsSync(jsonDbPath)) {
      memoryStore = JSON.parse(fs.readFileSync(jsonDbPath, 'utf8'));
    }
    if (fs.existsSync(jsonUsersPath)) {
      usersStore = JSON.parse(fs.readFileSync(jsonUsersPath, 'utf8'));
    }
    if (fs.existsSync(jsonSessionsPath)) {
      sessionsStore = JSON.parse(fs.readFileSync(jsonSessionsPath, 'utf8'));
    }
    if (fs.existsSync(jsonPlansPath)) {
      plansStore = JSON.parse(fs.readFileSync(jsonPlansPath, 'utf8'));
    } else {
      plansStore = [...DEFAULT_PLANS];
    }
    if (fs.existsSync(jsonUploadSessionsPath)) {
      uploadSessionsStore = JSON.parse(fs.readFileSync(jsonUploadSessionsPath, 'utf8'));
    }
    if (fs.existsSync(jsonAnalyticsEventsPath)) {
      analyticsEventsStore = JSON.parse(fs.readFileSync(jsonAnalyticsEventsPath, 'utf8'));
    }
    if (fs.existsSync(jsonPasswordResetsPath)) {
      passwordResetsStore = JSON.parse(fs.readFileSync(jsonPasswordResetsPath, 'utf8'));
    }

    usersStore = usersStore.filter(u => !u.email.endsWith('@example.com') && !u.id.startsWith('usr_test'));
    memoryStore = memoryStore.filter(p => 
      !p.id.startsWith('pub_test_') &&
      !p.title.includes('Alice Annual Report') &&
      !p.title.includes('Test Flipbook') &&
      !p.title.includes('Legacy Blogger Document') &&
      !p.title.includes('Protected Document') &&
      !p.title.includes('Protected Financial') &&
      !p.title.includes('Strictly Confidential') &&
      !p.title.includes('Unlisted Corporate') &&
      !p.title.includes('Public Architecture Magazine')
    );
    sessionsStore = sessionsStore.filter(s => usersStore.some(u => u.id === s.user_id));
  } catch (e) {
    console.warn('[DB] Failed to load JSON store:', e.message);
  }
}

let r2SyncTimer = null;

function isTestEnvironment() {
  return process.env.NODE_ENV === 'test' || process.env.IS_TEST_SUITE === 'true' || process.env.NO_R2_SYNC === 'true';
}

async function syncToCloudflareR2() {
  // CRITICAL PRODUCTION GUARD: Never push test suite data to Cloudflare R2
  if (isTestEnvironment()) return;

  const ss = getStorageService();
  if (!ss || !ss.isR2Configured) return;

  try {
    // 1. Sync publications catalog (filtering out test artifacts)
    const cleanPublications = memoryStore.filter(p => 
      !p.id.startsWith('pub_test_') &&
      !p.title.includes('Alice Annual Report') &&
      !p.title.includes('Test Flipbook') &&
      !p.title.includes('Legacy Blogger Document') &&
      !p.title.includes('Protected Document') &&
      !p.title.includes('Protected Financial') &&
      !p.title.includes('Strictly Confidential') &&
      !p.title.includes('Unlisted Corporate') &&
      !p.title.includes('Public Architecture Magazine')
    );
    const pubBuffer = Buffer.from(JSON.stringify(cleanPublications, null, 2), 'utf8');
    await ss.upload('catalog/publications.json', pubBuffer, 'application/json');

    // 2. Sync users catalog (filter out dummy/mock test accounts)
    const cleanUsers = usersStore.filter(u => 
      !u.email.endsWith('@example.com') && 
      !u.id.startsWith('usr_test')
    );
    const usersBuffer = Buffer.from(JSON.stringify(cleanUsers, null, 2), 'utf8');
    await ss.upload('catalog/users.json', usersBuffer, 'application/json');

    // 3. Sync sessions (keeps active real user logins alive across deployments)
    const cleanSessions = sessionsStore.filter(s => cleanUsers.some(u => u.id === s.user_id));
    if (cleanSessions.length > 0) {
      const sessBuffer = Buffer.from(JSON.stringify(cleanSessions, null, 2), 'utf8');
      await ss.upload('catalog/sessions.json', sessBuffer, 'application/json');
    }

    // 4. Sync analytics events
    if (analyticsEventsStore.length > 0) {
      const analyticsBuffer = Buffer.from(JSON.stringify(analyticsEventsStore, null, 2), 'utf8');
      await ss.upload('catalog/analytics.json', analyticsBuffer, 'application/json');
    }

    // 5. Sync plans
    if (plansStore.length > 0) {
      const plansBuffer = Buffer.from(JSON.stringify(plansStore, null, 2), 'utf8');
      await ss.upload('catalog/plans.json', plansBuffer, 'application/json');
    }
  } catch (e) {
    console.warn('[DB] Failed to sync data stores to Cloudflare R2:', e.message);
  }
}

async function syncFromCloudflareR2() {
  // CRITICAL PRODUCTION GUARD: Never pull cloud catalog during test executions
  if (isTestEnvironment()) return;

  const ss = getStorageService();
  if (!ss || !ss.isR2Configured) return;

  try {
    // 1. Restore Users from Cloudflare R2
    try {
      const usersBuf = await ss.getBuffer('catalog/users.json');
      if (usersBuf) {
        const rawUsers = JSON.parse(usersBuf.toString('utf8'));
        const loadedUsers = Array.isArray(rawUsers) ? rawUsers.filter(u => !u.email.endsWith('@example.com') && !u.id.startsWith('usr_test')) : [];
        if (loadedUsers.length > 0) {
          loadedUsers.forEach(u => {
            if (!u.id || !u.email) return;
            const existingIdx = usersStore.findIndex(item => item.id === u.id || (item.email && item.email.toLowerCase() === u.email.toLowerCase()));
            if (existingIdx === -1) {
              usersStore.push(u);
            } else {
              // Preserve existing user properties unless it's master admin being upgraded
              if (u.id !== SYSTEM_ADMIN_ID && u.email !== 'technews1562@gmail.com') {
                usersStore[existingIdx] = { ...u, ...usersStore[existingIdx] };
              }
            }

            if (sqliteDb) {
              try {
                sqliteDb.prepare(`
                  INSERT OR REPLACE INTO users (
                    id, email, password_hash, full_name, avatar_url, role,
                    plan_id, storage_used_bytes, publication_count, created_at, updated_at
                  ) VALUES (
                    @id, @email, @password_hash, @full_name, @avatar_url, @role,
                    @plan_id, @storage_used_bytes, @publication_count, @created_at, @updated_at
                  )
                `).run(u);
              } catch (e) {}
            }
          });
          console.log(`[DB] Successfully restored ${loadedUsers.length} user accounts from Cloudflare R2.`);
        }
      }
    } catch (e) {}

    // 2. Restore Publications from Cloudflare R2
    try {
      const pubBuf = await ss.getBuffer('catalog/publications.json');
      if (pubBuf) {
        const rawPubs = JSON.parse(pubBuf.toString('utf8'));
        const loadedPubs = Array.isArray(rawPubs) ? rawPubs.filter(item => 
          !item.id.startsWith('pub_test_') &&
          !item.title.includes('Alice Annual Report') &&
          !item.title.includes('Test Flipbook') &&
          !item.title.includes('Legacy Blogger Document') &&
          !item.title.includes('Protected Document') &&
          !item.title.includes('Protected Financial') &&
          !item.title.includes('Strictly Confidential') &&
          !item.title.includes('Unlisted Corporate') &&
          !item.title.includes('Public Architecture Magazine')
        ) : [];
        if (loadedPubs.length > 0) {
          loadedPubs.forEach(item => {
            if (!item.user_id) item.user_id = SYSTEM_ADMIN_ID;
            if (!item.visibility) item.visibility = 'PUBLIC';
            const existingIdx = memoryStore.findIndex(p => p.id === item.id);
            if (existingIdx === -1) {
              memoryStore.push(item);
            }
            if (sqliteDb) {
              try {
                sqliteDb.prepare(`
                  INSERT OR IGNORE INTO publications (
                    id, user_id, title, slug, category, description, author,
                    pdf_filename, storage_key, pdf_url, cover_url,
                    page_count, file_size, file_hash, status, published, visibility,
                    password_hash, has_branding, download_enabled, share_enabled,
                    view_count, blogger_post_id, blogger_post_url, published_at,
                    created_at, updated_at
                  ) VALUES (
                    @id, @user_id, @title, @slug, @category, @description, @author,
                    @pdf_filename, @storage_key, @pdf_url, @cover_url,
                    @page_count, @file_size, @file_hash, @status, @published, @visibility,
                    @password_hash, @has_branding, @download_enabled, @share_enabled,
                    @view_count, @blogger_post_id, @blogger_post_url, @published_at,
                    @created_at, @updated_at
                  )
                `).run(item);
              } catch (e) {}
            }
          });
          console.log(`[DB] Successfully synchronized ${loadedPubs.length} publications from Cloudflare R2 catalog.`);
        }
      }
    } catch (e) {}

    // 3. Restore Sessions from Cloudflare R2
    try {
      const sessBuf = await ss.getBuffer('catalog/sessions.json');
      if (sessBuf) {
        const loadedSess = JSON.parse(sessBuf.toString('utf8'));
        if (Array.isArray(loadedSess)) {
          loadedSess.forEach(s => {
            if (!sessionsStore.find(item => item.id === s.id)) {
              sessionsStore.push(s);
            }
          });
        }
      }
    } catch (e) {}

    // 4. Restore Analytics from Cloudflare R2
    try {
      const analyticsBuf = await ss.getBuffer('catalog/analytics.json');
      if (analyticsBuf) {
        const loadedAnalytics = JSON.parse(analyticsBuf.toString('utf8'));
        if (Array.isArray(loadedAnalytics)) {
          loadedAnalytics.forEach(a => {
            if (!analyticsEventsStore.find(item => item.id === a.id)) {
              analyticsEventsStore.push(a);
            }
          });
        }
      }
    } catch (e) {}

    saveJsonStoreLocal();
  } catch (err) {
    console.warn('[DB] Error during Cloudflare R2 data restore:', err.message);
  }
}

function saveJsonStoreLocal() {
  if (isTestEnvironment()) {
    // In test mode, do not write test fixtures to production JSON store files
    return;
  }
  try {
    fs.writeFileSync(jsonDbPath, JSON.stringify(memoryStore, null, 2), 'utf8');
    fs.writeFileSync(jsonUsersPath, JSON.stringify(usersStore, null, 2), 'utf8');
    fs.writeFileSync(jsonSessionsPath, JSON.stringify(sessionsStore, null, 2), 'utf8');
    fs.writeFileSync(jsonPlansPath, JSON.stringify(plansStore, null, 2), 'utf8');
    fs.writeFileSync(jsonUploadSessionsPath, JSON.stringify(uploadSessionsStore, null, 2), 'utf8');
    fs.writeFileSync(jsonAnalyticsEventsPath, JSON.stringify(analyticsEventsStore, null, 2), 'utf8');
    fs.writeFileSync(jsonPasswordResetsPath, JSON.stringify(passwordResetsStore, null, 2), 'utf8');
  } catch (e) {
    console.warn('[DB] Failed to persist JSON stores:', e.message);
  }
}

function saveJsonStore() {
  saveJsonStoreLocal();
  if (r2SyncTimer) clearTimeout(r2SyncTimer);
  r2SyncTimer = setTimeout(() => {
    syncToCloudflareR2().catch(() => {});
  }, 400);
}

loadJsonStore();
setTimeout(syncFromCloudflareR2, 1000);

// -------------------------------------------------------------
// SQLITE INITIALIZATION & MIGRATIONS
// -------------------------------------------------------------
let sqliteDb = null;
try {
  const Database = require('better-sqlite3');
  sqliteDb = new Database(dbPath);
  sqliteDb.pragma('journal_mode = WAL');

  // 1. Plans Table
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      max_publications INTEGER NOT NULL,
      max_storage_bytes INTEGER NOT NULL,
      max_pdf_size_bytes INTEGER NOT NULL,
      max_pages_per_doc INTEGER NOT NULL,
      has_branding INTEGER DEFAULT 1,
      allow_password_protect INTEGER DEFAULT 0,
      allow_analytics INTEGER DEFAULT 0,
      allow_download INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);

  // 2. Users Table
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      avatar_url TEXT,
      role TEXT DEFAULT 'USER',
      plan_id TEXT DEFAULT 'free',
      storage_used_bytes INTEGER DEFAULT 0,
      publication_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(plan_id) REFERENCES plans(id)
    );
  `);

  // 3. Sessions Table
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      client_type TEXT DEFAULT 'WEB',
      ip_address TEXT,
      user_agent TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 4. Upload Sessions Table (Phase 3 Modernized Uploads)
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS upload_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      publication_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      content_type TEXT DEFAULT 'application/pdf',
      expected_size INTEGER NOT NULL,
      received_size INTEGER DEFAULT 0,
      total_chunks INTEGER NOT NULL,
      received_chunks INTEGER DEFAULT 0,
      file_hash TEXT,
      status TEXT DEFAULT 'INITIATED',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 5. Publications Table
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS publications (
      id TEXT PRIMARY KEY,
      user_id TEXT DEFAULT '${SYSTEM_ADMIN_ID}',
      title TEXT NOT NULL,
      slug TEXT,
      category TEXT DEFAULT 'Magazine',
      description TEXT,
      author TEXT DEFAULT '',
      pdf_filename TEXT,
      storage_key TEXT NOT NULL,
      pdf_url TEXT NOT NULL,
      cover_url TEXT,
      page_count INTEGER DEFAULT 1,
      file_size INTEGER DEFAULT 0,
      file_hash TEXT,
      status TEXT DEFAULT 'READY',
      published INTEGER DEFAULT 1,
      visibility TEXT DEFAULT 'PUBLIC',
      password_hash TEXT,
      has_branding INTEGER DEFAULT 1,
      download_enabled INTEGER DEFAULT 1,
      share_enabled INTEGER DEFAULT 1,
      view_count INTEGER DEFAULT 0,
      blogger_post_id TEXT,
      blogger_post_url TEXT,
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Safe schema migrations for existing publications table
  const existingCols = sqliteDb.prepare("PRAGMA table_info(publications)").all().map(c => c.name);
  if (!existingCols.includes('user_id')) {
    sqliteDb.exec(`ALTER TABLE publications ADD COLUMN user_id TEXT DEFAULT '${SYSTEM_ADMIN_ID}'`);
  }
  if (!existingCols.includes('visibility')) {
    sqliteDb.exec("ALTER TABLE publications ADD COLUMN visibility TEXT DEFAULT 'PUBLIC'");
  }
  if (!existingCols.includes('password_hash')) {
    sqliteDb.exec("ALTER TABLE publications ADD COLUMN password_hash TEXT");
  }
  if (!existingCols.includes('has_branding')) {
    sqliteDb.exec("ALTER TABLE publications ADD COLUMN has_branding INTEGER DEFAULT 1");
  }
  if (!existingCols.includes('view_count')) {
    sqliteDb.exec("ALTER TABLE publications ADD COLUMN view_count INTEGER DEFAULT 0");
  }
  if (!existingCols.includes('published_at')) {
    sqliteDb.exec("ALTER TABLE publications ADD COLUMN published_at TEXT");
  }

  // 6. Analytics Events Table (Phase 4 Public Viewer Analytics)
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id TEXT PRIMARY KEY,
      publication_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      page_number INTEGER,
      duration_seconds INTEGER,
      referrer TEXT,
      user_agent TEXT,
      country TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(publication_id) REFERENCES publications(id) ON DELETE CASCADE
    );
  `);

  // 7. Password Resets Table
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Seed Default Plans into SQLite
  const insertPlanStmt = sqliteDb.prepare(`
    INSERT OR IGNORE INTO plans (
      id, name, max_publications, max_storage_bytes, max_pdf_size_bytes,
      max_pages_per_doc, has_branding, allow_password_protect, allow_analytics,
      allow_download, created_at
    ) VALUES (
      @id, @name, @max_publications, @max_storage_bytes, @max_pdf_size_bytes,
      @max_pages_per_doc, @has_branding, @allow_password_protect, @allow_analytics,
      @allow_download, @created_at
    )
  `);
  for (const plan of DEFAULT_PLANS) {
    insertPlanStmt.run(plan);
  }

  // Seed / Upgrade Master Admin User (technews1562@gmail.com)
  const masterAdminUser = {
    id: SYSTEM_ADMIN_ID,
    email: 'technews1562@gmail.com',
    password_hash: '$2b$10$rW/1PMH0EdHVU/xmJPANXefL2tJi1QFy0e3MDLlzRFqV2bmcegnW6', // bcrypt for 'Admin@4916'
    full_name: 'FlipView Master Admin',
    avatar_url: '',
    role: 'ADMIN',
    plan_id: 'business',
    storage_used_bytes: 0,
    publication_count: 0,
    created_at: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    updated_at: new Date().toISOString()
  };

  const existingAdmin = sqliteDb.prepare("SELECT * FROM users WHERE email = ? OR id = ?").get('technews1562@gmail.com', SYSTEM_ADMIN_ID);
  if (existingAdmin) {
    sqliteDb.prepare(`
      UPDATE users SET
        email = 'technews1562@gmail.com',
        password_hash = '$2b$10$rW/1PMH0EdHVU/xmJPANXefL2tJi1QFy0e3MDLlzRFqV2bmcegnW6',
        role = 'ADMIN',
        plan_id = 'business',
        updated_at = ?
      WHERE id = ? OR email = 'technews1562@gmail.com'
    `).run(new Date().toISOString(), existingAdmin.id);
  } else {
    sqliteDb.prepare(`
      INSERT INTO users (
        id, email, password_hash, full_name, avatar_url, role,
        plan_id, storage_used_bytes, publication_count, created_at, updated_at
      ) VALUES (
        @id, @email, @password_hash, @full_name, @avatar_url, @role,
        @plan_id, @storage_used_bytes, @publication_count, @created_at, @updated_at
      )
    `).run(masterAdminUser);
  }

  // Assign any publications without user_id to SYSTEM_ADMIN_ID
  sqliteDb.prepare(`UPDATE publications SET user_id = ? WHERE user_id IS NULL OR user_id = ''`).run(SYSTEM_ADMIN_ID);

  console.log('[DB] SQLite Engine & Multi-Tenant Tables initialized successfully at:', dbPath);
} catch (err) {
  console.log('[DB] Using Pure JavaScript JSON Database Engine (Zero-Dependency Mode):', err.message);
  sqliteDb = null;
}

// Seed memory store for fallback
if (plansStore.length === 0) plansStore = [...DEFAULT_PLANS];

const masterAdminMemory = {
  id: SYSTEM_ADMIN_ID,
  email: 'technews1562@gmail.com',
  password_hash: '$2b$10$rW/1PMH0EdHVU/xmJPANXefL2tJi1QFy0e3MDLlzRFqV2bmcegnW6', // bcrypt for 'Admin@4916'
  full_name: 'FlipView Master Admin',
  avatar_url: '',
  role: 'ADMIN',
  plan_id: 'business',
  storage_used_bytes: 0,
  publication_count: 0,
  created_at: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  updated_at: new Date().toISOString()
};

const adminIdx = usersStore.findIndex(u => u.email === 'technews1562@gmail.com' || u.id === SYSTEM_ADMIN_ID);
if (adminIdx >= 0) {
  usersStore[adminIdx] = { ...usersStore[adminIdx], ...masterAdminMemory };
} else {
  usersStore.unshift(masterAdminMemory);
}

memoryStore.forEach(p => {
  if (!p.user_id) p.user_id = SYSTEM_ADMIN_ID;
  if (!p.visibility) p.visibility = 'PUBLIC';
  if (p.has_branding === undefined) p.has_branding = 1;
  if (p.view_count === undefined) p.view_count = 0;
});
saveJsonStore();

module.exports = {
  SYSTEM_ADMIN_ID,

  // -------------------------------------------------------------
  // USER METHODS
  // -------------------------------------------------------------
  createUser(userData) {
    const now = new Date().toISOString();
    const user = {
      id: userData.id || `usr_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 7)}`,
      email: (userData.email || '').trim().toLowerCase(),
      password_hash: userData.password_hash,
      full_name: userData.full_name || '',
      avatar_url: userData.avatar_url || '',
      role: userData.role || 'USER',
      plan_id: userData.plan_id || 'free',
      storage_used_bytes: userData.storage_used_bytes || 0,
      publication_count: userData.publication_count || 0,
      created_at: userData.created_at || now,
      updated_at: now
    };

    if (sqliteDb) {
      try {
        const stmt = sqliteDb.prepare(`
          INSERT INTO users (
            id, email, password_hash, full_name, avatar_url, role,
            plan_id, storage_used_bytes, publication_count, created_at, updated_at
          ) VALUES (
            @id, @email, @password_hash, @full_name, @avatar_url, @role,
            @plan_id, @storage_used_bytes, @publication_count, @created_at, @updated_at
          )
        `);
        stmt.run(user);
      } catch (e) {
        console.warn('[DB User insert error]', e.message);
        throw e;
      }
    }

    const idx = usersStore.findIndex(u => u.id === user.id || u.email === user.email);
    if (idx >= 0) usersStore[idx] = user;
    else usersStore.unshift(user);
    saveJsonStore();

    return user;
  },

  getUserById(id) {
    if (!id) return null;
    if (sqliteDb) {
      try {
        const row = sqliteDb.prepare('SELECT * FROM users WHERE id = ?').get(id);
        if (row) return row;
      } catch (e) {}
    }
    return usersStore.find(u => u.id === id) || null;
  },

  getUserByEmail(email) {
    if (!email) return null;
    const cleanEmail = email.trim().toLowerCase();
    if (sqliteDb) {
      try {
        const row = sqliteDb.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(cleanEmail);
        if (row) return row;
      } catch (e) {}
    }
    return usersStore.find(u => (u.email || '').toLowerCase() === cleanEmail) || null;
  },

  updateUser(id, updates) {
    const now = new Date().toISOString();
    const existing = this.getUserById(id);
    if (!existing) return null;

    const merged = {
      ...existing,
      ...updates,
      updated_at: now
    };

    if (sqliteDb) {
      try {
        sqliteDb.prepare(`
          UPDATE users SET
            email = @email,
            password_hash = @password_hash,
            full_name = @full_name,
            avatar_url = @avatar_url,
            role = @role,
            plan_id = @plan_id,
            storage_used_bytes = @storage_used_bytes,
            publication_count = @publication_count,
            updated_at = @updated_at
          WHERE id = @id
        `).run(merged);
      } catch (e) {}
    }

    const idx = usersStore.findIndex(u => u.id === id);
    if (idx >= 0) usersStore[idx] = merged;
    saveJsonStore();

    return merged;
  },

  updateUserStorageCounters(userId, sizeDelta = 0, countDelta = 0) {
    if (!userId) return null;
    if (sqliteDb) {
      try {
        sqliteDb.prepare(`
          UPDATE users SET
            storage_used_bytes = MAX(0, storage_used_bytes + ?),
            publication_count = MAX(0, publication_count + ?),
            updated_at = ?
          WHERE id = ?
        `).run(sizeDelta, countDelta, new Date().toISOString(), userId);
      } catch (e) {
        console.warn('[DB User Storage Counter Update Error]', e.message);
      }
    }

    const user = this.getUserById(userId);
    if (user) {
      user.storage_used_bytes = Math.max(0, (user.storage_used_bytes || 0) + sizeDelta);
      user.publication_count = Math.max(0, (user.publication_count || 0) + countDelta);
      user.updated_at = new Date().toISOString();
      const idx = usersStore.findIndex(u => u.id === userId);
      if (idx >= 0) usersStore[idx] = user;
      saveJsonStore();
    }
    return user;
  },

  getAllUsers() {
    let users = [];
    if (sqliteDb) {
      try {
        users = sqliteDb.prepare('SELECT id, email, full_name, avatar_url, role, status, plan_id, storage_used_bytes, publication_count, subscription_id, created_at, updated_at FROM users ORDER BY created_at DESC').all();
      } catch (e) {
        users = usersStore;
      }
    } else {
      users = usersStore;
    }

    return users.map(u => {
      const plan = this.getPlanById(u.plan_id) || this.getPlanById('free');
      const { password_hash, ...safe } = u;
      return {
        ...safe,
        status: safe.status || 'ACTIVE',
        plan: plan || null
      };
    });
  },

  getPublicationsByUserId(userId) {
    if (!userId) return [];
    if (sqliteDb) {
      try {
        return sqliteDb.prepare('SELECT * FROM publications WHERE user_id = ?').all(userId);
      } catch (e) {}
    }
    return memoryStore.filter(p => p.user_id === userId);
  },

  deleteUser(userId) {
    if (!userId || userId === SYSTEM_ADMIN_ID) {
      throw new Error('Cannot delete system master administrator account.');
    }

    // 1. Delete all publications owned by this user
    const userPubs = this.getPublicationsByUserId(userId);
    for (const pub of userPubs) {
      try { this.deletePublication(pub.id); } catch (e) {}
    }

    // 2. Delete user sessions & record in SQLite
    if (sqliteDb) {
      try {
        sqliteDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
        sqliteDb.prepare('DELETE FROM users WHERE id = ?').run(userId);
      } catch (e) {}
    }

    // 3. Delete in memory
    usersStore = usersStore.filter(u => u.id !== userId);
    sessionsStore = sessionsStore.filter(s => s.user_id !== userId);
    saveJsonStore();
    return true;
  },

  getAllPublicationsAdmin() {
    let pubs = [];
    if (sqliteDb) {
      try {
        pubs = sqliteDb.prepare(`
          SELECT p.*, u.email as user_email, u.full_name as user_name, u.plan_id as user_plan
          FROM publications p
          LEFT JOIN users u ON p.user_id = u.id
          ORDER BY p.created_at DESC
        `).all();
      } catch (e) {
        pubs = memoryStore;
      }
    } else {
      pubs = memoryStore;
    }

    return pubs.map(p => {
      const user = this.getUserById(p.user_id);
      return {
        ...p,
        user_email: p.user_email || (user ? user.email : 'System Master Admin'),
        user_name: p.user_name || (user ? user.full_name : 'System Admin'),
        user_plan: p.user_plan || (user ? user.plan_id : 'business')
      };
    });
  },

  // -------------------------------------------------------------
  // PLAN METHODS
  // -------------------------------------------------------------
  getPlanById(id) {
    const planId = (id || 'free').toLowerCase();
    if (sqliteDb) {
      try {
        const row = sqliteDb.prepare('SELECT * FROM plans WHERE id = ?').get(planId);
        if (row) return row;
      } catch (e) {}
    }
    return plansStore.find(p => p.id === planId) || DEFAULT_PLANS.find(p => p.id === planId) || DEFAULT_PLANS[0];
  },

  listPlans() {
    if (sqliteDb) {
      try {
        const rows = sqliteDb.prepare('SELECT * FROM plans ORDER BY max_storage_bytes ASC').all();
        if (rows && rows.length > 0) return rows;
      } catch (e) {}
    }
    return plansStore.length ? plansStore : DEFAULT_PLANS;
  },

  // -------------------------------------------------------------
  // SESSION METHODS
  // -------------------------------------------------------------
  createSession(sessionData) {
    const now = new Date().toISOString();
    const session = {
      id: sessionData.id || `ses_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 7)}`,
      user_id: sessionData.user_id,
      token_hash: sessionData.token_hash,
      client_type: sessionData.client_type || 'WEB',
      ip_address: sessionData.ip_address || '',
      user_agent: sessionData.user_agent || '',
      expires_at: sessionData.expires_at,
      created_at: sessionData.created_at || now
    };

    if (sqliteDb) {
      try {
        sqliteDb.prepare(`
          INSERT INTO sessions (
            id, user_id, token_hash, client_type, ip_address, user_agent, expires_at, created_at
          ) VALUES (
            @id, @user_id, @token_hash, @client_type, @ip_address, @user_agent, @expires_at, @created_at
          )
        `).run(session);
      } catch (e) {
        console.warn('[DB Session insert error]', e.message);
      }
    }

    sessionsStore.unshift(session);
    saveJsonStore();
    return session;
  },

  getSessionByTokenHash(tokenHash) {
    if (!tokenHash) return null;
    const now = new Date().toISOString();
    if (sqliteDb) {
      try {
        const row = sqliteDb.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?').get(tokenHash, now);
        if (row) return row;
      } catch (e) {}
    }
    return sessionsStore.find(s => s.token_hash === tokenHash && s.expires_at > now) || null;
  },

  deleteSessionByTokenHash(tokenHash) {
    if (!tokenHash) return false;
    if (sqliteDb) {
      try {
        sqliteDb.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      } catch (e) {}
    }
    sessionsStore = sessionsStore.filter(s => s.token_hash !== tokenHash);
    saveJsonStore();
    return true;
  },

  deleteUserSessions(userId) {
    if (!userId) return false;
    if (sqliteDb) {
      try {
        sqliteDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      } catch (e) {}
    }
    sessionsStore = sessionsStore.filter(s => s.user_id !== userId);
    saveJsonStore();
    return true;
  },

  // -------------------------------------------------------------
  // PASSWORD RESETS METHODS
  // -------------------------------------------------------------
  createPasswordReset({ email, code, expires_at }) {
    const now = new Date().toISOString();
    const cleanEmail = (email || '').trim().toLowerCase();
    const resetRecord = {
      id: `rst_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 7)}`,
      email: cleanEmail,
      code: String(code).trim(),
      expires_at: expires_at || new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      created_at: now
    };

    // Remove any existing active codes for this email
    this.deletePasswordReset(cleanEmail);

    if (sqliteDb) {
      try {
        sqliteDb.prepare(`
          INSERT INTO password_resets (id, email, code, expires_at, created_at)
          VALUES (@id, @email, @code, @expires_at, @created_at)
        `).run(resetRecord);
      } catch (e) {
        console.warn('[DB Password Reset insert error]', e.message);
      }
    }

    passwordResetsStore.unshift(resetRecord);
    saveJsonStore();
    return resetRecord;
  },

  getPasswordReset(email, code) {
    if (!email || !code) return null;
    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = String(code).trim();
    const now = new Date().toISOString();

    if (sqliteDb) {
      try {
        const row = sqliteDb.prepare(`
          SELECT * FROM password_resets
          WHERE LOWER(email) = LOWER(?) AND code = ? AND expires_at > ?
          ORDER BY created_at DESC
          LIMIT 1
        `).get(cleanEmail, cleanCode, now);
        if (row) return row;
      } catch (e) {}
    }

    return passwordResetsStore.find(
      r => (r.email || '').toLowerCase() === cleanEmail && r.code === cleanCode && r.expires_at > now
    ) || null;
  },

  deletePasswordReset(email) {
    if (!email) return false;
    const cleanEmail = email.trim().toLowerCase();
    if (sqliteDb) {
      try {
        sqliteDb.prepare('DELETE FROM password_resets WHERE LOWER(email) = LOWER(?)').run(cleanEmail);
      } catch (e) {}
    }
    passwordResetsStore = passwordResetsStore.filter(r => (r.email || '').toLowerCase() !== cleanEmail);
    saveJsonStore();
    return true;
  },

  // -------------------------------------------------------------
  // UPLOAD SESSIONS METHODS (Phase 3)
  // -------------------------------------------------------------
  createUploadSession(sessionData) {
    const now = new Date().toISOString();
    const session = {
      id: sessionData.id || `upl_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 7)}`,
      user_id: sessionData.user_id,
      publication_id: sessionData.publication_id || `pub_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`,
      filename: sessionData.filename || 'publication.pdf',
      content_type: sessionData.content_type || 'application/pdf',
      expected_size: parseInt(sessionData.expected_size, 10) || 0,
      received_size: parseInt(sessionData.received_size, 10) || 0,
      total_chunks: parseInt(sessionData.total_chunks, 10) || 1,
      received_chunks: parseInt(sessionData.received_chunks, 10) || 0,
      file_hash: sessionData.file_hash || null,
      status: sessionData.status || 'INITIATED',
      expires_at: sessionData.expires_at,
      created_at: sessionData.created_at || now,
      updated_at: now
    };

    if (sqliteDb) {
      try {
        sqliteDb.prepare(`
          INSERT INTO upload_sessions (
            id, user_id, publication_id, filename, content_type,
            expected_size, received_size, total_chunks, received_chunks,
            file_hash, status, expires_at, created_at, updated_at
          ) VALUES (
            @id, @user_id, @publication_id, @filename, @content_type,
            @expected_size, @received_size, @total_chunks, @received_chunks,
            @file_hash, @status, @expires_at, @created_at, @updated_at
          )
        `).run(session);
      } catch (e) {
        console.warn('[DB Upload Session insert error]', e.message);
      }
    }

    const idx = uploadSessionsStore.findIndex(s => s.id === session.id);
    if (idx >= 0) uploadSessionsStore[idx] = session;
    else uploadSessionsStore.unshift(session);
    saveJsonStore();

    return session;
  },

  getUploadSessionById(id) {
    if (!id) return null;
    if (sqliteDb) {
      try {
        const row = sqliteDb.prepare('SELECT * FROM upload_sessions WHERE id = ?').get(id);
        if (row) return row;
      } catch (e) {}
    }
    return uploadSessionsStore.find(s => s.id === id) || null;
  },

  updateUploadSession(id, updates) {
    const now = new Date().toISOString();
    const existing = this.getUploadSessionById(id);
    if (!existing) return null;

    const merged = {
      ...existing,
      ...updates,
      updated_at: now
    };

    if (sqliteDb) {
      try {
        sqliteDb.prepare(`
          UPDATE upload_sessions SET
            received_size = @received_size,
            received_chunks = @received_chunks,
            file_hash = @file_hash,
            status = @status,
            expires_at = @expires_at,
            updated_at = @updated_at
          WHERE id = @id
        `).run(merged);
      } catch (e) {}
    }

    const idx = uploadSessionsStore.findIndex(s => s.id === id);
    if (idx >= 0) uploadSessionsStore[idx] = merged;
    saveJsonStore();

    return merged;
  },

  deleteUploadSession(id) {
    if (sqliteDb) {
      try {
        sqliteDb.prepare('DELETE FROM upload_sessions WHERE id = ?').run(id);
      } catch (e) {}
    }
    uploadSessionsStore = uploadSessionsStore.filter(s => s.id !== id);
    saveJsonStore();
    return true;
  },

  cleanExpiredUploadSessions() {
    const now = new Date().toISOString();
    if (sqliteDb) {
      try {
        sqliteDb.prepare("DELETE FROM upload_sessions WHERE expires_at <= ? AND status NOT IN ('COMPLETED')").run(now);
      } catch (e) {}
    }
    uploadSessionsStore = uploadSessionsStore.filter(s => s.expires_at > now || s.status === 'COMPLETED');
    saveJsonStore();
  },

  // -------------------------------------------------------------
  // PUBLICATION METHODS
  // -------------------------------------------------------------
  createPublication(data) {
    const now = new Date().toISOString();
    const record = {
      id: data.id,
      user_id: data.user_id || SYSTEM_ADMIN_ID,
      title: data.title,
      slug: data.slug || data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      category: data.category || 'Magazine',
      description: data.description || '',
      author: data.author || '',
      pdf_filename: data.pdf_filename || 'document.pdf',
      storage_key: data.storage_key,
      pdf_url: data.pdf_url,
      cover_url: data.cover_url || '',
      page_count: data.page_count || 1,
      file_size: data.file_size || 0,
      file_hash: data.file_hash || null,
      status: data.status || 'READY',
      published: data.published !== undefined ? (data.published ? 1 : 0) : 1,
      visibility: data.visibility || 'PUBLIC',
      password_hash: data.password_hash || null,
      has_branding: data.has_branding !== undefined ? (data.has_branding ? 1 : 0) : 1,
      download_enabled: data.download_enabled !== undefined ? (data.download_enabled ? 1 : 0) : 1,
      share_enabled: data.share_enabled !== undefined ? (data.share_enabled ? 1 : 0) : 1,
      view_count: data.view_count || 0,
      blogger_post_id: data.blogger_post_id || null,
      blogger_post_url: data.blogger_post_url || null,
      published_at: data.published_at || (data.published ? now : null),
      created_at: data.created_at || now,
      updated_at: now
    };

    if (sqliteDb) {
      try {
        const stmt = sqliteDb.prepare(`
          INSERT INTO publications (
            id, user_id, title, slug, category, description, author,
            pdf_filename, storage_key, pdf_url, cover_url,
            page_count, file_size, file_hash, status, published, visibility,
            password_hash, has_branding, download_enabled, share_enabled,
            view_count, blogger_post_id, blogger_post_url, published_at,
            created_at, updated_at
          ) VALUES (
            @id, @user_id, @title, @slug, @category, @description, @author,
            @pdf_filename, @storage_key, @pdf_url, @cover_url,
            @page_count, @file_size, @file_hash, @status, @published, @visibility,
            @password_hash, @has_branding, @download_enabled, @share_enabled,
            @view_count, @blogger_post_id, @blogger_post_url, @published_at,
            @created_at, @updated_at
          )
        `);
        stmt.run(record);
      } catch (e) {
        console.warn('[DB SQLite insert fallback]', e.message);
      }
    }

    // Always keep JSON store synchronized
    const existingIdx = memoryStore.findIndex(p => p.id === record.id);
    if (existingIdx >= 0) memoryStore[existingIdx] = record;
    else memoryStore.unshift(record);
    saveJsonStore();

    // Increment user's publication count & storage
    this.updateUserStorageCounters(record.user_id, record.file_size, 1);

    return record;
  },

  getPublicationById(id) {
    if (!id) return null;
    if (sqliteDb) {
      try {
        const row = sqliteDb.prepare('SELECT * FROM publications WHERE id = ?').get(id);
        if (row) return row;
      } catch (e) {}
    }
    return memoryStore.find(p => p.id === id) || null;
  },

  getPublicationByHash(hash, userId = null) {
    if (!hash) return null;
    if (sqliteDb) {
      try {
        if (userId) {
          const row = sqliteDb.prepare('SELECT * FROM publications WHERE file_hash = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1').get(hash, userId);
          if (row) return row;
        } else {
          const row = sqliteDb.prepare('SELECT * FROM publications WHERE file_hash = ? ORDER BY created_at DESC LIMIT 1').get(hash);
          if (row) return row;
        }
      } catch (e) {}
    }
    if (userId) {
      return memoryStore.find(p => p.file_hash === hash && p.user_id === userId) || null;
    }
    return memoryStore.find(p => p.file_hash === hash) || null;
  },

  updatePublication(id, updates) {
    const now = new Date().toISOString();
    let record = this.getPublicationById(id);
    if (!record) return null;

    const merged = {
      ...record,
      ...updates,
      updated_at: now
    };

    if (sqliteDb) {
      try {
        sqliteDb.prepare(`
          UPDATE publications SET
            title = @title,
            category = @category,
            description = @description,
            author = @author,
            pdf_url = @pdf_url,
            cover_url = @cover_url,
            page_count = @page_count,
            status = @status,
            published = @published,
            visibility = @visibility,
            password_hash = @password_hash,
            has_branding = @has_branding,
            download_enabled = @download_enabled,
            share_enabled = @share_enabled,
            view_count = @view_count,
            blogger_post_id = @blogger_post_id,
            blogger_post_url = @blogger_post_url,
            published_at = @published_at,
            updated_at = @updated_at
          WHERE id = @id
        `).run(merged);
      } catch (e) {}
    }

    const idx = memoryStore.findIndex(p => p.id === id);
    if (idx >= 0) memoryStore[idx] = merged;
    else memoryStore.unshift(merged);
    saveJsonStore();

    return merged;
  },

  deletePublication(id) {
    const pub = this.getPublicationById(id);
    if (pub) {
      this.updateUserStorageCounters(pub.user_id, -pub.file_size, -1);
    }

    if (sqliteDb) {
      try {
        sqliteDb.prepare('DELETE FROM publications WHERE id = ?').run(id);
      } catch (e) {}
    }
    const before = memoryStore.length;
    memoryStore = memoryStore.filter(p => p.id !== id);
    saveJsonStore();
    return memoryStore.length < before;
  },

  listPublications({ userId, category, search, page = 1, limit = 50, status, visibility, isAdmin = false } = {}) {
    let list = [...memoryStore].sort((a, b) => {
      const tA = new Date(a.created_at || 0).getTime();
      const tB = new Date(b.created_at || 0).getTime();
      return tB - tA;
    });

    // If authenticated regular user, filter only user's publications
    if (userId && !isAdmin) {
      list = list.filter(p => p.user_id === userId);
    } else if (!userId && !isAdmin) {
      // Unauthenticated / Blogger public feed: only return public and published
      list = list.filter(p => p.published === 1 && (p.visibility === 'PUBLIC' || !p.visibility));
    }

    if (category && category.toLowerCase() !== 'all') {
      list = list.filter(p => (p.category || '').toLowerCase() === category.toLowerCase());
    }
    if (status) {
      list = list.filter(p => p.status === status);
    }
    if (visibility) {
      list = list.filter(p => p.visibility === visibility);
    }
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p => 
        (p.title || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
      );
    }

    const total = list.length;
    const start = (page - 1) * limit;
    const paginated = list.slice(start, start + limit);

    return {
      publications: paginated,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  },

  incrementPublicationView(id) {
    const pub = this.getPublicationById(id);
    if (!pub) return null;
    const nextCount = (pub.view_count || 0) + 1;
    return this.updatePublication(id, { view_count: nextCount });
  },

  recordAnalyticsEvent(data) {
    const event = {
      id: `evt_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 7)}`,
      publication_id: data.publication_id,
      event_type: data.event_type || 'VIEW',
      page_number: data.page_number ? parseInt(data.page_number, 10) : null,
      duration_seconds: data.duration_seconds ? parseInt(data.duration_seconds, 10) : null,
      referrer: data.referrer || '',
      user_agent: data.user_agent || '',
      country: data.country || '',
      created_at: data.created_at || new Date().toISOString()
    };

    if (sqliteDb) {
      try {
        sqliteDb.prepare(`
          INSERT INTO analytics_events (
            id, publication_id, event_type, page_number, duration_seconds,
            referrer, user_agent, country, created_at
          ) VALUES (
            @id, @publication_id, @event_type, @page_number, @duration_seconds,
            @referrer, @user_agent, @country, @created_at
          )
        `).run(event);
      } catch (e) {
        console.warn('[DB Analytics Event insert error]', e.message);
      }
    }

    analyticsEventsStore.unshift(event);
    if (analyticsEventsStore.length > 5000) analyticsEventsStore.pop();
    saveJsonStore();
    return event;
  },

  getPublicPublicationById(id) {
    const pub = this.getPublicationById(id);
    if (!pub) return null;

    const publicUrl = config.getPublicViewerUrl(pub.id);
    const hasBranding = pub.has_branding !== undefined ? Boolean(pub.has_branding) : true;
    const downloadEnabled = pub.download_enabled !== undefined ? Boolean(pub.download_enabled) : true;
    const shareEnabled = pub.share_enabled !== undefined ? Boolean(pub.share_enabled) : true;
    const isPasswordProtected = pub.visibility === 'PASSWORD_PROTECTED';

    return {
      id: pub.id,
      title: pub.title,
      slug: pub.slug || pub.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      category: pub.category || 'Magazine',
      description: pub.description || '',
      author: pub.author || '',
      pageCount: pub.page_count || 1,
      fileSize: pub.file_size || 0,
      coverUrl: pub.cover_url || `/api/public/${pub.id}/cover`,
      pdfUrl: isPasswordProtected ? null : `/api/public/${pub.id}/pdf`,
      publicUrl: publicUrl,
      visibility: pub.visibility || 'PUBLIC',
      hasBranding: hasBranding,
      downloadEnabled: downloadEnabled,
      shareEnabled: shareEnabled,
      viewCount: pub.view_count || 0,
      requiresPassword: isPasswordProtected,
      publishedAt: pub.published_at || pub.created_at,
      createdAt: pub.created_at
    };
  },

  getCategories() {
    const cats = [...new Set(memoryStore.map(p => p.category).filter(Boolean))];
    return cats.length ? cats : ['Magazine', 'Brochure', 'Catalogue', 'Portfolio', 'Annual Report', 'Document'];
  },

  // -------------------------------------------------------------
  // SYSTEM & ADMIN AGGREGATIONS
  // -------------------------------------------------------------
  getStats() {
    let totalPubs = 0, publishedPubs = 0, pendingPubs = 0, totalPages = 0, totalBytes = 0, totalUsers = 0, totalViews = 0;
    let planBreakdown = { free: 0, pro: 0, business: 0 };
    let categoryBreakdown = {};

    if (sqliteDb) {
      try {
        totalPubs = sqliteDb.prepare('SELECT COUNT(*) as count FROM publications').get().count;
        publishedPubs = sqliteDb.prepare("SELECT COUNT(*) as count FROM publications WHERE status = 'PUBLISHED'").get().count;
        pendingPubs = sqliteDb.prepare("SELECT COUNT(*) as count FROM publications WHERE status = 'BLOGGER_PENDING'").get().count;
        totalPages = sqliteDb.prepare('SELECT SUM(page_count) as total FROM publications').get().total || 0;
        totalBytes = sqliteDb.prepare('SELECT SUM(file_size) as total FROM publications').get().total || 0;
        totalUsers = sqliteDb.prepare('SELECT COUNT(*) as count FROM users').get().count;
        totalViews = sqliteDb.prepare('SELECT SUM(view_count) as total FROM publications').get().total || 0;

        const plans = sqliteDb.prepare('SELECT plan_id, COUNT(*) as count FROM users GROUP BY plan_id').all();
        plans.forEach(p => { if (p.plan_id) planBreakdown[p.plan_id.toLowerCase()] = p.count; });

        const cats = sqliteDb.prepare('SELECT category, COUNT(*) as count FROM publications GROUP BY category').all();
        cats.forEach(c => { if (c.category) categoryBreakdown[c.category] = c.count; });

        return {
          totalPublications: totalPubs,
          published: publishedPubs,
          bloggerPending: pendingPubs,
          totalPages,
          totalStorageBytes: totalBytes,
          totalStorageMb: (totalBytes / (1024 * 1024)).toFixed(2),
          totalUsers,
          totalViews,
          planBreakdown,
          categoryBreakdown
        };
      } catch (e) {}
    }

    // JSON Fallback Stats
    totalPubs = memoryStore.length;
    publishedPubs = memoryStore.filter(p => p.status === 'PUBLISHED').length;
    pendingPubs = memoryStore.filter(p => p.status === 'BLOGGER_PENDING').length;
    totalPages = memoryStore.reduce((acc, p) => acc + (p.page_count || 0), 0);
    totalBytes = memoryStore.reduce((acc, p) => acc + (p.file_size || 0), 0);
    totalUsers = usersStore.length;
    totalViews = memoryStore.reduce((acc, p) => acc + (p.view_count || 0), 0);

    usersStore.forEach(u => {
      const pid = (u.plan_id || 'free').toLowerCase();
      planBreakdown[pid] = (planBreakdown[pid] || 0) + 1;
    });

    memoryStore.forEach(p => {
      const cat = p.category || 'Magazine';
      categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
    });

    return {
      totalPublications: totalPubs,
      published: publishedPubs,
      bloggerPending: pendingPubs,
      totalPages,
      totalStorageBytes: totalBytes,
      totalStorageMb: (totalBytes / (1024 * 1024)).toFixed(2),
      totalUsers,
      totalViews,
      planBreakdown,
      categoryBreakdown
    };
  }
};
