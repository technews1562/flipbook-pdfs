const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');

// Start backend in test mode
process.env.NODE_ENV = 'test';
process.env.PORT = '8099';
process.env.ADMIN_API_KEY = 'test_admin_key_2026';
process.env.JWT_SECRET = 'test_jwt_secret_flipview_2026';

const app = require('./server');
const db = require('./src/db/database');

const BASE_URL = 'http://localhost:8099';

async function request(method, path, body = null, headers = {}) {
  const url = new URL(path, BASE_URL);
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
      res.on('data', chunk => data += chunk);
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

async function runTests() {
  console.log('\n========================================================');
  console.log('🧪 RUNNING FLIPVIEW PHASE 2 TEST SUITE');
  console.log('========================================================\n');

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
      if (err.actual !== undefined && err.expected !== undefined) {
        console.error(`     Expected: ${err.expected}, Actual: ${err.actual}`);
      }
    }
  }

  const testEmail1 = `testuser_${Date.now()}@example.com`;
  const testEmail2 = `anotheruser_${Date.now()}@example.com`;
  const testPassword = 'Password123!';

  let user1Token = '';
  let user1RefreshToken = '';
  let user1Id = '';

  let user2Token = '';
  let user2Id = '';

  let createdPubId = '';

  // 1. Health check
  await test('1. Health check endpoint responds with Phase 2/3/4 metadata', async () => {
    const res = await request('GET', '/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.status, 'ok');
    assert.ok(res.data.phase.includes('Phase 2') || res.data.phase.includes('Phase 3') || res.data.phase.includes('Phase 4'));
  });

  // 2. Plan lookup
  await test('2. Plan lookup endpoint lists Free, Pro, Business plans', async () => {
    const res = await request('GET', '/api/auth/plans');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.data));
    assert.ok(res.data.data.length >= 3);
    const freePlan = res.data.data.find(p => p.id === 'free');
    assert.ok(freePlan);
    assert.strictEqual(freePlan.max_publications, 5);
    assert.strictEqual(freePlan.has_branding, 1);
  });

  // 3. Registration
  await test('3. User Registration succeeds and returns JWT tokens & user info (no password hash)', async () => {
    const res = await request('POST', '/api/auth/register', {
      email: testEmail1,
      password: testPassword,
      full_name: 'Alice Flipview'
    });
    assert.strictEqual(res.status, 201);
    assert.ok(res.data.success);
    assert.ok(res.data.data.accessToken);
    assert.ok(res.data.data.refreshToken);
    assert.strictEqual(res.data.data.user.email, testEmail1);
    assert.strictEqual(res.data.data.user.plan_id, 'free');
    assert.strictEqual(res.data.data.user.password_hash, undefined, 'Password hash must never be returned');

    user1Token = res.data.data.accessToken;
    user1RefreshToken = res.data.data.refreshToken;
    user1Id = res.data.data.user.id;
  });

  // 4. Duplicate email rejection
  await test('4. Registration rejects duplicate email address', async () => {
    const res = await request('POST', '/api/auth/register', {
      email: testEmail1,
      password: 'AnotherPassword123!',
      full_name: 'Alice Clone'
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.success, false);
    assert.ok(res.data.error.message.includes('already exists'));
  });

  // 5. Short password rejection
  await test('5. Registration rejects password shorter than 6 characters', async () => {
    const res = await request('POST', '/api/auth/register', {
      email: `short_${Date.now()}@example.com`,
      password: '123'
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.success, false);
  });

  // 6. Login with valid credentials
  await test('6. User Login with valid credentials succeeds', async () => {
    const res = await request('POST', '/api/auth/login', {
      email: testEmail1,
      password: testPassword
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.success);
    assert.ok(res.data.data.accessToken);
    assert.strictEqual(res.data.data.user.email, testEmail1);
  });

  // 7. Login with invalid password
  await test('7. User Login with incorrect password is rejected', async () => {
    const res = await request('POST', '/api/auth/login', {
      email: testEmail1,
      password: 'WrongPassword999!'
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.data.success, false);
  });

  // 8. GET /api/auth/me with Bearer token
  await test('8. GET /api/auth/me returns profile for authenticated user', async () => {
    const res = await request('GET', '/api/auth/me', null, {
      'Authorization': `Bearer ${user1Token}`
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.success);
    assert.strictEqual(res.data.data.id, user1Id);
    assert.strictEqual(res.data.data.email, testEmail1);
    assert.ok(res.data.data.plan);
    assert.strictEqual(res.data.data.plan.id, 'free');
  });

  // 9. Refresh token
  await test('9. Token Refresh generates fresh access token', async () => {
    const res = await request('POST', '/api/auth/refresh', {
      refreshToken: user1RefreshToken
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.success);
    assert.ok(res.data.data.accessToken);
    user1Token = res.data.data.accessToken;
    user1RefreshToken = res.data.data.refreshToken;
  });

  // 10. Register user 2 for ownership testing
  await test('10. Register User 2 (Bob)', async () => {
    const res = await request('POST', '/api/auth/register', {
      email: testEmail2,
      password: testPassword,
      full_name: 'Bob Reader'
    });
    assert.strictEqual(res.status, 201);
    user2Token = res.data.data.accessToken;
    user2Id = res.data.data.user.id;
  });

  // 11. Create a publication directly in DB assigned to User 1
  await test('11. Publication Creation records user_id & updates user storage counters', async () => {
    const initialUser = db.getUserById(user1Id);
    const initialCount = initialUser.publication_count || 0;
    const initialStorage = initialUser.storage_used_bytes || 0;

    const pub = db.createPublication({
      id: `pub_test_${Date.now().toString(36)}`,
      user_id: user1Id,
      title: 'Alice Special Magazine',
      category: 'Magazine',
      description: 'First test magazine by Alice',
      pdf_filename: 'alice-mag.pdf',
      storage_key: 'uploads/test/alice-mag.pdf',
      pdf_url: 'https://publisher.convertlyfiles.com/api/storage/alice-mag.pdf',
      cover_url: 'https://publisher.convertlyfiles.com/api/storage/alice-cover.svg',
      page_count: 12,
      file_size: 1048576, // 1MB
      file_hash: 'hash_test_1234567890',
      status: 'READY',
      published: 1,
      visibility: 'PUBLIC'
    });

    createdPubId = pub.id;
    assert.ok(createdPubId);

    const updatedUser = db.getUserById(user1Id);
    assert.strictEqual(updatedUser.publication_count, initialCount + 1, 'Publication count should increment by 1');
    assert.strictEqual(updatedUser.storage_used_bytes, initialStorage + 1048576, 'Storage used should increment by 1MB');
  });

  // 12. User 1 can fetch their publications via GET /api/publications
  await test('12. User 1 GET /api/publications returns only their own publications', async () => {
    const res = await request('GET', '/api/publications', null, {
      'Authorization': `Bearer ${user1Token}`
    });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.data));
    const found = res.data.data.find(p => p.id === createdPubId);
    assert.ok(found, 'User 1 should see their publication');
    // Ensure all returned publications belong to User 1
    res.data.data.forEach(p => {
      assert.strictEqual(p.user_id, user1Id);
    });
  });

  // 13. User 2 cannot see User 1's publication in their private list
  await test('13. User 2 GET /api/publications returns only User 2 publications (empty initially)', async () => {
    const res = await request('GET', '/api/publications', null, {
      'Authorization': `Bearer ${user2Token}`
    });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.data));
    const found = res.data.data.find(p => p.id === createdPubId);
    assert.strictEqual(found, undefined, 'User 2 must NOT see User 1 publication in private library');
  });

  // 14. Unauthenticated GET /api/publications returns public feed for Blogger
  await test('14. Unauthenticated GET /api/publications returns public published feed for Blogger compatibility', async () => {
    const res = await request('GET', '/api/publications');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.data));
    const found = res.data.data.find(p => p.id === createdPubId);
    assert.ok(found, 'Public catalog should include public published item');
  });

  // 15. Unauthenticated PATCH /api/publications/:id is rejected (Security Fix)
  await test('15. Security Fix: Unauthenticated PATCH /api/publications/:id is rejected with 401', async () => {
    const res = await request('PATCH', `/api/publications/${createdPubId}`, {
      title: 'Hacked Title Without Auth'
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.data.success, false);
  });

  // 16. User 2 attempting to PATCH User 1's publication is forbidden with 403
  await test('16. User 2 attempting to PATCH User 1 publication is rejected with 403 Forbidden', async () => {
    const res = await request('PATCH', `/api/publications/${createdPubId}`, {
      title: 'Unauthorized Modification by User 2'
    }, {
      'Authorization': `Bearer ${user2Token}`
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.data.success, false);
    assert.strictEqual(res.data.error.code, 'FORBIDDEN');
  });

  // 17. User 1 can successfully PATCH their own publication
  await test('17. User 1 can successfully update their own publication', async () => {
    const newTitle = 'Alice Updated Magazine Edition';
    const res = await request('PATCH', `/api/publications/${createdPubId}`, {
      title: newTitle,
      category: 'Catalogue'
    }, {
      'Authorization': `Bearer ${user1Token}`
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.success);
    assert.strictEqual(res.data.data.title, newTitle);
    assert.strictEqual(res.data.data.category, 'Catalogue');
  });

  // 18. Admin can PATCH any publication using legacy admin key
  await test('18. Admin can update any publication using legacy admin key header', async () => {
    const adminTitle = 'Admin Supervised Edition';
    const res = await request('PATCH', `/api/publications/${createdPubId}`, {
      title: adminTitle
    }, {
      'x-admin-key': 'test_admin_key_2026'
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.success);
    assert.strictEqual(res.data.data.title, adminTitle);
  });

  // 19. GET /api/admin/stats works without crashing (Bug fix verification)
  await test('19. Bug Fix: GET /api/admin/stats executes cleanly and returns stats', async () => {
    const res = await request('GET', '/api/admin/stats', null, {
      'x-admin-key': 'test_admin_key_2026'
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.success);
    assert.ok(res.data.data.totalPublications >= 1);
    assert.ok(res.data.data.totalUsers >= 1);
    assert.ok(res.data.data.totalStorageMb !== undefined);
  });

  // 20. Delete publication decrements storage counter
  await test('20. Deleting publication decrements user publication count and storage quota', async () => {
    const beforeUser = db.getUserById(user1Id);
    const beforeCount = beforeUser.publication_count;
    const beforeStorage = beforeUser.storage_used_bytes;

    const res = await request('DELETE', `/api/publications/${createdPubId}`, null, {
      'Authorization': `Bearer ${user1Token}`
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.success);

    const afterUser = db.getUserById(user1Id);
    assert.strictEqual(afterUser.publication_count, Math.max(0, beforeCount - 1));
    assert.strictEqual(afterUser.storage_used_bytes, Math.max(0, beforeStorage - 1048576));
  });

  // 21. Logout revokes refresh token
  await test('21. Logout revokes session and subsequent refresh fails', async () => {
    const res = await request('POST', '/api/auth/logout', {
      refreshToken: user1RefreshToken
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.success);

    const refreshRes = await request('POST', '/api/auth/refresh', {
      refreshToken: user1RefreshToken
    });
    assert.strictEqual(refreshRes.status, 401);
  });

  console.log('\n========================================================');
  console.log(`🎉 TEST SUMMARY: ${passed} / ${total} Passed (${Math.round((passed/total)*100)}%)`);
  console.log('========================================================\n');

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

// Give server time to listen before running
setTimeout(runTests, 1000);
