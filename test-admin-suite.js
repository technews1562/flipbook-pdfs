/**
 * ==========================================================================
 * FLIPVIEW ADMIN AUTH & USER MANAGEMENT TEST SUITE
 * ==========================================================================
 */

const assert = require('assert');
const http = require('http');

process.env.NODE_ENV = 'test';
process.env.PORT = '8095';
process.env.ADMIN_API_KEY = 'test_admin_key_2026';
process.env.JWT_SECRET = 'test_jwt_secret_flipview_2026';

const app = require('./server');
const db = require('./src/db/database');

const BASE_URL = 'http://localhost:8095';

async function request(method, path, body = null, headers = {}) {
  const url = new URL(path, BASE_URL);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    method: method,
    headers: { ...headers }
  };

  let payload = null;
  if (body) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    if (!options.headers['Content-Type']) {
      options.headers['Content-Type'] = 'application/json';
    }
    options.headers['Content-Length'] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(data);
        const text = buffer.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { json = text; }
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

async function runAdminTests() {
  console.log('\n========================================================');
  console.log('🧪 RUNNING FLIPVIEW ADMIN AUTH & USER MANAGEMENT TEST SUITE');
  console.log('========================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}`);
      console.error(`     Error: ${err.message}\n`);
      failed++;
    }
  }

  let adminToken = '';
  let testUserId = '';

  // 1. Rejection of invalid credentials on POST /api/admin/login
  await test('1. Rejection of wrong password on POST /api/admin/login', async () => {
    const res = await request('POST', '/api/admin/login', {
      email: 'technews1562@gmail.com',
      password: 'WrongPassword123'
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.data.success, false);
  });

  // 2. Successful Admin login with technews1562@gmail.com and Admin@4916
  await test('2. Successful Admin login with technews1562@gmail.com and Admin@4916', async () => {
    const res = await request('POST', '/api/admin/login', {
      email: 'technews1562@gmail.com',
      password: 'Admin@4916'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert(res.data.data.accessToken, 'Access token must be returned');
    assert.strictEqual(res.data.data.user.email, 'technews1562@gmail.com');
    assert.strictEqual(res.data.data.user.role, 'ADMIN');
    adminToken = res.data.data.accessToken;
  });

  // 3. GET /api/admin/me returns admin profile
  await test('3. GET /api/admin/me returns admin profile with Bearer token', async () => {
    const res = await request('GET', '/api/admin/me', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.data.user.email, 'technews1562@gmail.com');
    assert.strictEqual(res.data.data.user.role, 'ADMIN');
  });

  // 4. Rejection of unauthenticated GET /api/admin/users
  await test('4. Unauthenticated GET /api/admin/users is rejected with 401', async () => {
    const res = await request('GET', '/api/admin/users');
    assert.strictEqual(res.status, 401);
  });

  // 5. GET /api/admin/users returns user list
  await test('5. Authenticated GET /api/admin/users returns user list', async () => {
    const res = await request('GET', '/api/admin/users', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert.strictEqual(res.status, 200);
    assert(Array.isArray(res.data.data));
    assert(res.data.data.length >= 1);
  });

  // 6. Admin creates new user via POST /api/admin/users
  await test('6. Admin creates new user via POST /api/admin/users', async () => {
    const res = await request('POST', '/api/admin/users', {
      email: `admintest_${Date.now()}@example.com`,
      password: 'TestUser123!',
      full_name: 'Test Customer',
      plan_id: 'pro'
    }, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.data.user.plan.id, 'pro');
    testUserId = res.data.data.user.id;
  });

  // 7. Admin upgrades user plan to Business via PATCH /api/admin/users/:id
  await test('7. Admin upgrades user plan to Business via PATCH /api/admin/users/:id', async () => {
    const res = await request('PATCH', `/api/admin/users/${testUserId}`, {
      plan_id: 'business'
    }, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.data.user.plan_id, 'business');
  });

  // 8. Admin resets user password via PATCH /api/admin/users/:id
  await test('8. Admin resets user password and verifies login with new password', async () => {
    const updateRes = await request('PATCH', `/api/admin/users/${testUserId}`, {
      password: 'NewAdminSetPassword999'
    }, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert.strictEqual(updateRes.status, 200);

    const user = db.getUserById(testUserId);
    const loginRes = await request('POST', '/api/auth/login', {
      email: user.email,
      password: 'NewAdminSetPassword999'
    });
    assert.strictEqual(loginRes.status, 200);
    assert.strictEqual(loginRes.data.success, true);
  });

  // 9. Admin suspends user via PATCH /api/admin/users/:id
  await test('9. Admin sets user status to SUSPENDED', async () => {
    const res = await request('PATCH', `/api/admin/users/${testUserId}`, {
      status: 'SUSPENDED'
    }, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.data.user.status, 'SUSPENDED');
  });

  // 10. GET /api/admin/stats returns comprehensive metrics
  await test('10. GET /api/admin/stats returns platform overview metrics', async () => {
    const res = await request('GET', '/api/admin/stats', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert.strictEqual(res.status, 200);
    assert(res.data.data.totalUsers >= 1);
    assert(res.data.data.planBreakdown !== undefined);
  });

  // 11. Admin deletes user via DELETE /api/admin/users/:id
  await test('11. Admin deletes user via DELETE /api/admin/users/:id', async () => {
    const res = await request('DELETE', `/api/admin/users/${testUserId}`, null, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(db.getUserById(testUserId), null);
  });

  // 12. Security: Master admin cannot delete own admin account
  await test('12. Security: Master admin cannot delete own admin account', async () => {
    const res = await request('DELETE', `/api/admin/users/${db.SYSTEM_ADMIN_ID}`, null, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert.strictEqual(res.status, 400);
  });

  console.log('\n========================================================');
  console.log(`🎉 ADMIN TEST SUMMARY: ${passed} / ${passed + failed} Passed (${Math.round((passed / (passed + failed)) * 100)}%)`);
  console.log('========================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runAdminTests().catch(err => {
  console.error('Fatal Admin Test Error:', err);
  process.exit(1);
});
