const assert = require('assert');
const http = require('http');

process.env.NODE_ENV = 'test';
process.env.PORT = '8098';
process.env.ADMIN_API_KEY = 'test_admin_key_2026';
process.env.JWT_SECRET = 'test_jwt_secret_flipview_2026';

const app = require('./server');
const db = require('./src/db/database');

const BASE_URL = 'http://localhost:8098';

async function testBloggerCompatibility() {
  console.log('\n========================================================');
  console.log('🧪 TESTING BLOGGER VIEWER & ON-SITE UPLOAD COMPATIBILITY');
  console.log('========================================================\n');

  // 1. Test public feed for Blogger catalog (GET /api/publications)
  const pubsRes = await new Promise((resolve, reject) => {
    http.get(`${BASE_URL}/api/publications?limit=10`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
    }).on('error', reject);
  });

  assert.strictEqual(pubsRes.status, 200);
  assert.ok(pubsRes.data.success);
  assert.ok(Array.isArray(pubsRes.data.data));
  console.log(`  ✅ [PASS] Public /api/publications returns ${pubsRes.data.data.length} publications for Blogger catalog`);

  // 2. Test fetching single publication metadata by ID (GET /api/publications/:id)
  const firstPub = pubsRes.data.data[0];
  if (firstPub) {
    const singleRes = await new Promise((resolve, reject) => {
      http.get(`${BASE_URL}/api/publications/${encodeURIComponent(firstPub.id)}`, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
      }).on('error', reject);
    });

    assert.strictEqual(singleRes.status, 200);
    assert.strictEqual(singleRes.data.data.id, firstPub.id);
    assert.ok(singleRes.data.data.title);
    assert.strictEqual(singleRes.data.data.password_hash, undefined, 'Must not leak password hash');
    console.log(`  ✅ [PASS] Public /api/publications/${firstPub.id} returns metadata required by Blogger viewer`);

    // 3. Test Cover streaming endpoint (GET /api/publications/:id/cover)
    const coverRes = await new Promise((resolve, reject) => {
      http.get(`${BASE_URL}/api/publications/${encodeURIComponent(firstPub.id)}/cover`, (res) => {
        let chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, length: Buffer.concat(chunks).length }));
      }).on('error', reject);
    });

    assert.ok(coverRes.status === 200 || coverRes.status === 302, 'Cover endpoint should return 200 or 302 redirect');
    console.log(`  ✅ [PASS] Cover streaming endpoint /cover works properly (Status: ${coverRes.status})`);
  }

  // 4. Test on-site chunk upload from Blogger without auth (Blogger Theme Uploader)
  const uploadId = `blogger_test_${Date.now()}`;
  const mockPdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000010 00000 n \n0000000060 00000 n \n0000000117 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF', 'utf8');

  // Multi-part chunk boundary
  const boundary = '----BloggerBoundary' + Math.random().toString(36).substring(2);
  let chunkHeader = '';
  chunkHeader += '--' + boundary + '\r\n';
  chunkHeader += 'Content-Disposition: form-data; name="uploadId"\r\n\r\n' + uploadId + '\r\n';
  chunkHeader += '--' + boundary + '\r\n';
  chunkHeader += 'Content-Disposition: form-data; name="chunkIndex"\r\n\r\n0\r\n';
  chunkHeader += '--' + boundary + '\r\n';
  chunkHeader += 'Content-Disposition: form-data; name="totalChunks"\r\n\r\n1\r\n';
  chunkHeader += '--' + boundary + '\r\n';
  chunkHeader += 'Content-Disposition: form-data; name="filename"\r\n\r\nblogger-test.pdf\r\n';
  chunkHeader += '--' + boundary + '\r\n';
  chunkHeader += 'Content-Disposition: form-data; name="chunk"; filename="blogger-test.pdf"\r\n';
  chunkHeader += 'Content-Type: application/pdf\r\n\r\n';

  const bodyStart = Buffer.from(chunkHeader, 'utf8');
  const bodyEnd = Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8');
  const fullChunkBody = Buffer.concat([bodyStart, mockPdfBytes, bodyEnd]);

  const chunkRes = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 8098,
      path: '/api/upload-chunk',
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': fullChunkBody.length,
        'Origin': 'https://flipviewpdf.blogspot.com'
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write(fullChunkBody);
    req.end();
  });

  assert.strictEqual(chunkRes.status, 200);
  assert.strictEqual(chunkRes.data.success, true);
  console.log('  ✅ [PASS] On-site chunk upload /api/upload-chunk functions seamlessly');

  // 5. Test finalize upload from Blogger without auth (auto-assigned to System Admin)
  const finalizePayload = JSON.stringify({
    uploadId: uploadId,
    filename: 'blogger-test.pdf',
    title: 'Blogger On-Site Test Flipbook',
    category: 'Magazine'
  });

  const finalRes = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 8098,
      path: '/api/finalize-upload',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(finalizePayload),
        'Origin': 'https://flipviewpdf.blogspot.com'
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write(finalizePayload);
    req.end();
  });

  assert.strictEqual(finalRes.status, 200);
  assert.strictEqual(finalRes.data.success, true);
  assert.ok(finalRes.data.data.publicationId);
  assert.strictEqual(finalRes.data.data.user_id, db.SYSTEM_ADMIN_ID, 'Unauthenticated Blogger upload must be assigned to system admin');
  assert.ok(finalRes.data.data.postUrl.includes('#doc='));
  console.log(`  ✅ [PASS] /api/finalize-upload successfully generated publication "${finalRes.data.data.publicationId}"`);

  console.log('\n========================================================');
  console.log('🎉 ALL BLOGGER COMPATIBILITY CHECKS PASSED!');
  console.log('========================================================\n');

  process.exit(0);
}

setTimeout(testBloggerCompatibility, 1000);
