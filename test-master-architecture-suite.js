const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.PORT = '8099';
process.env.ADMIN_API_KEY = 'test_master_admin_key_2026';
process.env.JWT_SECRET = 'test_master_jwt_secret_flipview_2026';
process.env.JWT_REFRESH_SECRET = 'test_master_jwt_refresh_secret_2026';
process.env.NO_R2_SYNC = 'true';

const app = require('./server');
const db = require('./src/db/database');

const BASE_URL = 'http://localhost:8099';

// Valid single-page PDF binary
const VALID_PDF_BUFFER = Buffer.from(
  '%PDF-1.4\n' +
  '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
  '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
  '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n' +
  '4 0 obj\n<< /Length 20 >>\nstream\nBT /F1 12 Tf ET\nendstream\nendobj\n' +
  'xref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000200 00000 n \n' +
  'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n270\n%%EOF',
  'utf8'
);

async function requestJson(method, endpoint, body = null, headers = {}) {
  const url = new URL(endpoint, BASE_URL);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    method: method,
    headers: {
      'Accept': 'application/json',
      ...headers
    }
  };

  let payload = null;
  if (body) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    options.headers['Content-Type'] = 'application/json';
    options.headers['Content-Length'] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = data; }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json
        });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function requestMultipartChunk(uploadId, chunkIndex, chunkBuffer, token) {
  const boundary = '----UploadChunkBoundary' + Math.random().toString(36).substring(2);
  let header = '';
  header += '--' + boundary + '\r\n';
  header += 'Content-Disposition: form-data; name="uploadId"\r\n\r\n' + uploadId + '\r\n';
  header += '--' + boundary + '\r\n';
  header += 'Content-Disposition: form-data; name="chunkIndex"\r\n\r\n' + chunkIndex + '\r\n';
  header += '--' + boundary + '\r\n';
  header += 'Content-Disposition: form-data; name="chunk"; filename="chunk.bin"\r\n';
  header += 'Content-Type: application/octet-stream\r\n\r\n';

  const bodyStart = Buffer.from(header, 'utf8');
  const bodyEnd = Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8');
  const fullBody = Buffer.concat([bodyStart, chunkBuffer, bodyEnd]);

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 8099,
      path: '/api/uploads/chunk',
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': fullBody.length,
        'Authorization': `Bearer ${token}`
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = data; }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json
        });
      });
    });
    req.on('error', reject);
    req.write(fullBody);
    req.end();
  });
}

async function runMasterSuite() {
  console.log('========================================================================');
  console.log('🚀 RUNNING FLIPVIEW MASTER ARCHITECTURE & CANONICAL API TEST SUITE');
  console.log('========================================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}`);
      console.error(`     Error: ${err.message}`);
      if (err.stack) console.error(`     ${err.stack.split('\n')[1]}`);
    }
  }

  // --- SECTION 1: AUTHENTICATION & TOKEN LIFECYCLE ---
  console.log('\n--- 1. Authentication & Token Lifecycle ---');
  let userAToken = '', userARefreshToken = '', userAId = '';
  let userBToken = '', userBRefreshToken = '', userBId = '';
  const emailA = `test_master_a_${Date.now()}@example.com`;
  const emailB = `test_master_b_${Date.now()}@example.com`;

  await test('Register User A', async () => {
    const res = await requestJson('POST', '/api/auth/register', {
      email: emailA,
      password: 'Password123!',
      full_name: 'Alice Tester'
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.data.accessToken);
    assert.ok(res.data.data.refreshToken);
    userAToken = res.data.data.accessToken;
    userARefreshToken = res.data.data.refreshToken;
    userAId = res.data.data.user.id;
  });

  await test('Register User B', async () => {
    const res = await requestJson('POST', '/api/auth/register', {
      email: emailB,
      password: 'Password123!',
      full_name: 'Bob Tester'
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.success, true);
    userBToken = res.data.data.accessToken;
    userBRefreshToken = res.data.data.refreshToken;
    userBId = res.data.data.user.id;
  });

  await test('Login with Wrong Password Fails', async () => {
    const res = await requestJson('POST', '/api/auth/login', {
      email: emailA,
      password: 'WrongPassword'
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.data.success, false);
  });

  await test('GET /api/auth/me Returns Sanitized Profile', async () => {
    const res = await requestJson('GET', '/api/auth/me', null, {
      'Authorization': `Bearer ${userAToken}`
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.data.id, userAId);
    assert.strictEqual(res.data.data.password_hash, undefined);
    assert.ok(res.data.data.plan);
  });

  await test('Token Refresh & Refresh Token Rotation', async () => {
    const res = await requestJson('POST', '/api/auth/refresh', {
      refreshToken: userARefreshToken
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.data.accessToken);
    assert.ok(res.data.data.refreshToken);
    assert.notStrictEqual(res.data.data.refreshToken, userARefreshToken);

    // Old refresh token must be revoked
    const resOld = await requestJson('POST', '/api/auth/refresh', {
      refreshToken: userARefreshToken
    });
    assert.strictEqual(resOld.status, 401);

    userAToken = res.data.data.accessToken;
    userARefreshToken = res.data.data.refreshToken;
  });

  // Upgrade User A to Pro for full upload testing
  db.updateUser(userAId, { plan_id: 'pro' });

  // --- SECTION 2: CANONICAL UPLOAD API ---
  console.log('\n--- 2. Canonical Upload API & State Machine ---');
  let uploadId = '', publicationId = '';

  await test('POST /api/uploads/init returns 2 MB chunkSize & valid session', async () => {
    const res = await requestJson('POST', '/api/uploads/init', {
      filename: 'master-test.pdf',
      fileSize: VALID_PDF_BUFFER.length,
      contentType: 'application/pdf',
      title: 'Master Test PDF',
      category: 'Catalogue',
      description: 'Master test publication description',
      author: 'Antigravity Team',
      visibility: 'PUBLIC'
    }, {
      'Authorization': `Bearer ${userAToken}`
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.chunkSize, 2097152); // 2 MB
    assert.strictEqual(res.data.data.totalChunks, 1);
    assert.strictEqual(res.data.data.status, 'INITIATED');
    assert.ok(res.data.data.uploadId);
    assert.ok(res.data.data.publicationId);

    uploadId = res.data.data.uploadId;
    publicationId = res.data.data.publicationId;
  });

  await test('POST /api/uploads/init rejects invalid file extension', async () => {
    const res = await requestJson('POST', '/api/uploads/init', {
      filename: 'malicious.exe',
      fileSize: 1024,
      contentType: 'application/x-msdownload'
    }, {
      'Authorization': `Bearer ${userAToken}`
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.success, false);
  });

  await test('POST /api/uploads/chunk accepts 2MB binary chunk', async () => {
    const res = await requestMultipartChunk(uploadId, 0, VALID_PDF_BUFFER, userAToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.chunkIndex, 0);
    assert.strictEqual(res.data.data.receivedChunks, 1);
    assert.strictEqual(res.data.data.status, 'UPLOADING');
  });

  await test('GET /api/uploads/:uploadId returns Resume details', async () => {
    const res = await requestJson('GET', `/api/uploads/${uploadId}`, null, {
      'Authorization': `Bearer ${userAToken}`
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.uploadId, uploadId);
    assert.deepStrictEqual(res.data.data.receivedChunks, [0]);
    assert.deepStrictEqual(res.data.data.missingChunks, []);
    assert.strictEqual(res.data.data.progressPercent, 100);
  });

  await test('User B cannot upload chunk to User A session (403 Forbidden)', async () => {
    const res = await requestMultipartChunk(uploadId, 0, VALID_PDF_BUFFER, userBToken);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.data.success, false);
  });

  await test('POST /api/uploads/complete assembles PDF and creates publication', async () => {
    const res = await requestJson('POST', '/api/uploads/complete', {
      uploadId: uploadId
    }, {
      'Authorization': `Bearer ${userAToken}`
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.publication.id, publicationId);
    assert.strictEqual(res.data.data.publication.title, 'Master Test PDF');
    assert.strictEqual(res.data.data.publication.pageCount, 1);
    assert.strictEqual(res.data.data.publication.status, 'READY');
  });

  await test('POST /api/uploads/complete is Idempotent (Calling twice returns existing without duplicate storage)', async () => {
    const res = await requestJson('POST', '/api/uploads/complete', {
      uploadId: uploadId
    }, {
      'Authorization': `Bearer ${userAToken}`
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.publication.id, publicationId);
  });

  // --- SECTION 3: OWNERSHIP & MULTI-TENANCY ---
  console.log('\n--- 3. Ownership & Multi-Tenancy Protection ---');

  await test('User A sees only User A publications in GET /api/publications', async () => {
    const res = await requestJson('GET', '/api/publications', null, {
      'Authorization': `Bearer ${userAToken}`
    });
    assert.strictEqual(res.status, 200);
    const pubs = res.data.data;
    assert.ok(pubs.every(p => p.user_id === userAId));
    assert.ok(pubs.some(p => p.id === publicationId));
  });

  await test('User B does NOT see User A publication in GET /api/publications', async () => {
    const res = await requestJson('GET', '/api/publications', null, {
      'Authorization': `Bearer ${userBToken}`
    });
    assert.strictEqual(res.status, 200);
    const pubs = res.data.data;
    assert.ok(!pubs.some(p => p.id === publicationId));
  });

  await test('User B cannot modify User A publication (403 Forbidden)', async () => {
    const res = await requestJson('PATCH', `/api/publications/${publicationId}`, {
      title: 'Hacked Title'
    }, {
      'Authorization': `Bearer ${userBToken}`
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.data.success, false);
  });

  await test('User B cannot delete User A publication (403 Forbidden)', async () => {
    const res = await requestJson('DELETE', `/api/publications/${publicationId}`, null, {
      'Authorization': `Bearer ${userBToken}`
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.data.success, false);
  });

  await test('User A can modify own publication', async () => {
    const res = await requestJson('PATCH', `/api/publications/${publicationId}`, {
      title: 'Updated Master Test PDF'
    }, {
      'Authorization': `Bearer ${userAToken}`
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.data.title, 'Updated Master Test PDF');
  });

  // --- SECTION 4: PUBLIC VIEWER & RANGE STREAMING ---
  console.log('\n--- 4. Public Viewer, Visibility & Range Streaming ---');

  await test('GET /api/public/:publicationId returns public metadata', async () => {
    const res = await requestJson('GET', `/api/public/${publicationId}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.data.publication.id, publicationId);
    assert.strictEqual(res.data.data.publication.requiresPassword, false);
  });

  await test('GET /api/public/:publicationId/pdf supports HTTP Range partial streaming (206 Partial Content)', async () => {
    const url = new URL(`/api/public/${publicationId}/pdf`, BASE_URL);
    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'GET',
        headers: {
          'Range': 'bytes=0-100'
        }
      }, (r) => {
        let chunks = [];
        r.on('data', c => chunks.push(c));
        r.on('end', () => {
          resolve({
            status: r.statusCode,
            headers: r.headers,
            body: Buffer.concat(chunks)
          });
        });
      });
      req.on('error', reject);
      req.end();
    });

    assert.strictEqual(res.status, 206);
    assert.strictEqual(res.headers['accept-ranges'], 'bytes');
    assert.ok(res.headers['content-range']);
    assert.strictEqual(res.body.length, 101);
  });

  // --- SECTION 5: PASSWORD PROTECTION & SCOPED VIEWER TOKEN ---
  console.log('\n--- 5. Password Protected Publications & Scoped Token ---');
  let protectedUploadId = '', protectedPubId = '';
  const SECRET_PDF_BUFFER = Buffer.concat([
    Buffer.from('%PDF-1.4\n% Secret FlipView Test Document\n', 'utf8'),
    VALID_PDF_BUFFER.subarray(9)
  ]);

  await test('Create Password Protected Publication', async () => {
    const initRes = await requestJson('POST', '/api/uploads/init', {
      filename: 'secret-doc.pdf',
      fileSize: SECRET_PDF_BUFFER.length,
      contentType: 'application/pdf',
      title: 'Secret Document',
      visibility: 'PASSWORD_PROTECTED'
    }, {
      'Authorization': `Bearer ${userAToken}`
    });
    assert.strictEqual(initRes.status, 201);
    protectedUploadId = initRes.data.data.uploadId;
    protectedPubId = initRes.data.data.publicationId;

    await requestMultipartChunk(protectedUploadId, 0, SECRET_PDF_BUFFER, userAToken);

    const compRes = await requestJson('POST', '/api/uploads/complete', {
      uploadId: protectedUploadId,
      visibility: 'PASSWORD_PROTECTED',
      password: 'SuperSecret123!'
    }, {
      'Authorization': `Bearer ${userAToken}`
    });
    assert.strictEqual(compRes.status, 200);
    assert.strictEqual(compRes.data.data.publication.visibility, 'PASSWORD_PROTECTED');
  });


  await test('GET /api/public/:id on Protected Doc returns requiresPassword: true and pdfUrl: null', async () => {
    const res = await requestJson('GET', `/api/public/${protectedPubId}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.data.publication.requiresPassword, true);
    assert.strictEqual(res.data.data.publication.pdfUrl, null);
  });

  await test('Streaming PDF without token is Denied (401 Unauthorized)', async () => {
    const res = await new Promise((resolve) => {
      http.get(`${BASE_URL}/api/public/${protectedPubId}/pdf`, (r) => {
        resolve({ status: r.statusCode });
      });
    });
    assert.strictEqual(res.status, 401);
  });

  let viewerToken = '';
  await test('POST /api/public/:id/verify-password with correct password returns 15-min Viewer Token', async () => {
    const res = await requestJson('POST', `/api/public/${protectedPubId}/verify-password`, {
      password: 'SuperSecret123!'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.data.viewerToken);
    assert.strictEqual(res.data.data.expiresIn, 900); // 15 min
    viewerToken = res.data.data.viewerToken;
  });

  await test('Streaming PDF with valid Viewer Token succeeds (200 OK)', async () => {
    const res = await new Promise((resolve) => {
      http.get(`${BASE_URL}/api/public/${protectedPubId}/pdf?token=${viewerToken}`, (r) => {
        let chunks = [];
        r.on('data', c => chunks.push(c));
        r.on('end', () => {
          resolve({ status: r.statusCode, body: Buffer.concat(chunks) });
        });
      });
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.length, SECRET_PDF_BUFFER.length);
  });


  // --- SECTION 6: ANALYTICS TELEMETRY & PLAN ENFORCEMENT ---
  console.log('\n--- 6. Analytics Telemetry & Plan Enforcement ---');

  await test('POST /api/analytics/event records VIEW event and increments view_count', async () => {
    const res = await requestJson('POST', '/api/analytics/event', {
      publicationId: publicationId,
      eventType: 'VIEW'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.data.recorded, true);

    const pubRes = await requestJson('GET', `/api/public/${publicationId}`);
    assert.ok(pubRes.data.data.publication.viewCount >= 1);
  });

  await test('POST /api/analytics/event records PAGE_TURN and SHARE events', async () => {
    const res = await requestJson('POST', '/api/analytics/event', {
      publicationId: publicationId,
      eventType: 'PAGE_TURN',
      pageNumber: 2
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.data.recorded, true);
  });

  await test('Free user requesting GET /api/analytics/:id is blocked (403 PLAN_UPGRADE_REQUIRED)', async () => {
    // User B is on 'free' plan
    // Create a publication for User B
    const bPub = db.createPublication({
      id: `pub_test_b_${Date.now().toString(36)}`,
      user_id: userBId,
      title: 'User B Document',
      storage_key: 'uploads/test/b.pdf',
      pdf_url: '/api/public/b/pdf',
      page_count: 1,
      file_size: 1024,
      status: 'READY',
      published: 1,
      visibility: 'PUBLIC'
    });

    const res = await requestJson('GET', `/api/analytics/${bPub.id}`, null, {
      'Authorization': `Bearer ${userBToken}`
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.data.success, false);
    assert.strictEqual(res.data.error.code, 'PLAN_UPGRADE_REQUIRED');

    db.deletePublication(bPub.id);
  });

  await test('Pro user (User A) requesting GET /api/analytics/:id succeeds (200 OK)', async () => {
    const res = await requestJson('GET', `/api/analytics/${publicationId}`, null, {
      'Authorization': `Bearer ${userAToken}`
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.publicationId, publicationId);
    assert.ok(res.data.data.totalEvents >= 1);
    assert.ok(res.data.data.eventTypes);
  });

  await test('User B cannot access User A analytics (403 FORBIDDEN)', async () => {
    const res = await requestJson('GET', `/api/analytics/${publicationId}`, null, {
      'Authorization': `Bearer ${userBToken}`
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.data.success, false);
    assert.strictEqual(res.data.error.code, 'FORBIDDEN');
  });

  // --- SECTION 7: GUEST CATALOG ISOLATION & BLOGGER COMPATIBILITY ---
  console.log('\n--- 7. Guest Catalog Isolation & Blogger Compatibility ---');

  await test('Guest GET /api/publications returns ONLY public published flipbooks', async () => {
    const res = await requestJson('GET', '/api/publications');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.data));

    // Secret document (PASSWORD_PROTECTED) must NOT be in guest catalog
    assert.ok(!res.data.data.some(p => p.id === protectedPubId));
    // Must never leak password_hash or storage_key
    assert.ok(res.data.data.every(p => p.password_hash === undefined && p.storage_key === undefined));
  });

  await test('GET /api/publications/mine requires authentication', async () => {
    const res = await requestJson('GET', '/api/publications/mine');
    assert.strictEqual(res.status, 401);
  });

  await test('GET /api/publications/mine returns user owned publications', async () => {
    const res = await requestJson('GET', '/api/publications/mine', null, {
      'Authorization': `Bearer ${userAToken}`
    });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.data));
    assert.ok(res.data.data.some(p => p.id === publicationId));
  });

  // --- SECTION 8: ADMIN BACKUP & HARDENED RESTORE ---
  console.log('\n--- 8. Admin Hardened Backup & Restore Safety ---');
  const adminApiKey = process.env.ADMIN_API_KEY || 'test_master_admin_key_2026';

  await test('Non-admin user blocked from POST /api/admin/db/restore (403 Forbidden)', async () => {
    const res = await requestJson('POST', '/api/admin/db/restore', { test: true }, {
      'Authorization': `Bearer ${userAToken}`
    });
    assert.strictEqual(res.status, 403);
  });

  await test('Admin POST /api/admin/db/restore with invalid structure is rejected (400/500)', async () => {
    const res = await requestJson('POST', '/api/admin/db/restore', { invalid: 'payload' }, {
      'x-admin-key': adminApiKey
    });
    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.data.success, false);
  });

  await test('Admin POST /api/admin/db/restore creates pre-restore safety backup and restores', async () => {
    const currentUsers = db.getAllUsers();
    const currentPubs = db.listPublications({ isAdmin: true }).publications;

    const restorePayload = {
      version: '1.0.0',
      data: {
        users: currentUsers,
        publications: currentPubs,
        plans: db.listPlans()
      }
    };

    const res = await requestJson('POST', '/api/admin/db/restore', restorePayload, {
      'x-admin-key': adminApiKey
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.data.safety_backup);
  });

  // --- SECTION 9: LEGACY UPLOAD ENDPOINT DELEGATION ---
  console.log('\n--- 9. Legacy Upload Endpoints Delegation ---');

  await test('Legacy POST /api/upload single file upload delegates to canonical UploadService', async () => {
    const boundary = '----UploadLegacyBoundary' + Math.random().toString(36).substring(2);
    let header = '';
    header += '--' + boundary + '\r\n';
    header += 'Content-Disposition: form-data; name="title"\r\n\r\nLegacy Delegate Doc\r\n';
    header += '--' + boundary + '\r\n';
    header += 'Content-Disposition: form-data; name="category"\r\n\r\nMagazine\r\n';
    header += '--' + boundary + '\r\n';
    header += 'Content-Disposition: form-data; name="pdf"; filename="legacy.pdf"\r\n';
    header += 'Content-Type: application/pdf\r\n\r\n';

    const bodyStart = Buffer.from(header, 'utf8');
    const bodyEnd = Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8');
    const fullBody = Buffer.concat([bodyStart, VALID_PDF_BUFFER, bodyEnd]);

    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: 8099,
        path: '/api/upload',
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=' + boundary,
          'Content-Length': fullBody.length,
          'Authorization': `Bearer ${userAToken}`
        }
      }, (r) => {
        let data = '';
        r.on('data', c => data += c);
        r.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch (e) { json = data; }
          resolve({ status: r.statusCode, data: json });
        });
      });
      req.on('error', reject);
      req.write(fullBody);
      req.end();
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.status, 'READY');
    assert.ok(res.data.data.publicationId);

    // Clean up legacy upload
    db.deletePublication(res.data.data.publicationId);
  });

  // --- CLEANUP ---
  console.log('\n--- Cleanup Test Artifacts ---');
  await test('Clean up publications and test users', async () => {
    db.deletePublication(publicationId);
    db.deletePublication(protectedPubId);
    db.deleteUser(userAId);
    db.deleteUser(userBId);
  });

  console.log('\n========================================================================');
  console.log(`🎉 TEST RESULTS: ${passed}/${total} TESTS PASSED (${((passed/total)*100).toFixed(1)}%)`);
  console.log('========================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

// Start server if required or run directly
setTimeout(() => {
  runMasterSuite().then(() => {
    console.log('Suite completed successfully.');
    process.exit(0);
  }).catch((err) => {
    console.error('Suite error:', err);
    process.exit(1);
  });
}, 800);

