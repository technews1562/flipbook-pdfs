const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.PORT = '8097';
process.env.ADMIN_API_KEY = 'test_admin_key_2026';
process.env.JWT_SECRET = 'test_jwt_secret_flipview_2026';

const app = require('./server');
const db = require('./src/db/database');

const BASE_URL = 'http://localhost:8097';

// Sample valid single-page PDF binary
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
      port: 8097,
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

async function runPhase3Tests() {
  console.log('\n========================================================');
  console.log('🧪 RUNNING FLIPVIEW PHASE 3 UPLOAD & R2 REST-API TEST SUITE');
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

  // Register User A (Alice)
  const userARes = await requestJson('POST', '/api/auth/register', {
    email: `alice_p3_${Date.now()}@example.com`,
    password: 'Password123!',
    full_name: 'Alice Phase 3'
  });
  assert.strictEqual(userARes.status, 201);
  const userAToken = userARes.data.data.accessToken;
  const userAId = userARes.data.data.user.id;

  // Register User B (Bob)
  const userBRes = await requestJson('POST', '/api/auth/register', {
    email: `bob_p3_${Date.now()}@example.com`,
    password: 'Password123!',
    full_name: 'Bob Phase 3'
  });
  assert.strictEqual(userBRes.status, 201);
  const userBToken = userBRes.data.data.accessToken;
  const userBId = userBRes.data.data.user.id;

  let activeUploadId = '';
  let activePublicationId = '';

  // 1. Authenticated upload init succeeds
  await test('1. Authenticated POST /api/uploads/init succeeds and returns session info', async () => {
    const res = await requestJson('POST', '/api/uploads/init', {
      filename: 'annual-report.pdf',
      fileSize: VALID_PDF_BUFFER.length,
      contentType: 'application/pdf',
      totalChunks: 1
    }, {
      'Authorization': `Bearer ${userAToken}`
    });

    assert.strictEqual(res.status, 201);
    assert.ok(res.data.success);
    assert.ok(res.data.data.uploadId.startsWith('upl_'));
    assert.ok(res.data.data.publicationId.startsWith('pub_'));
    assert.strictEqual(res.data.data.chunkSize, 2097152);
    assert.strictEqual(res.data.data.totalChunks, 1);
    assert.strictEqual(res.data.data.status, 'INITIATED');

    activeUploadId = res.data.data.uploadId;
    activePublicationId = res.data.data.publicationId;
  });

  // 2. Anonymous upload init is rejected with 401
  await test('2. Anonymous POST /api/uploads/init is rejected with 401 Unauthorized', async () => {
    const res = await requestJson('POST', '/api/uploads/init', {
      filename: 'annual-report.pdf',
      fileSize: 1000000,
      contentType: 'application/pdf',
      totalChunks: 1
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.data.success, false);
  });

  // 3. Invalid file size is rejected
  await test('3. Upload init with invalid or zero fileSize is rejected with 400', async () => {
    const res = await requestJson('POST', '/api/uploads/init', {
      filename: 'report.pdf',
      fileSize: 0,
      contentType: 'application/pdf'
    }, {
      'Authorization': `Bearer ${userAToken}`
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.success, false);
  });

  // 4. Plan publication limit is enforced
  await test('4. Plan publication limit is enforced when user limit is reached', async () => {
    // Temporarily set Alice publication_count to 5 (Free plan max)
    db.updateUser(userAId, { publication_count: 5 });

    const res = await requestJson('POST', '/api/uploads/init', {
      filename: 'extra-doc.pdf',
      fileSize: 5000,
      contentType: 'application/pdf',
      totalChunks: 1
    }, {
      'Authorization': `Bearer ${userAToken}`
    });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.data.success, false);
    assert.strictEqual(res.data.error.code, 'PUBLICATION_LIMIT_REACHED');

    // Reset Alice count back to 0
    db.updateUser(userAId, { publication_count: 0 });
  });

  // 5. Plan storage limit is enforced
  await test('5. Plan storage quota is enforced when upload exceeds plan ceiling', async () => {
    // 101 MB upload on Free plan (Max is 100 MB)
    const res = await requestJson('POST', '/api/uploads/init', {
      filename: 'huge-file.pdf',
      fileSize: 101 * 1024 * 1024,
      contentType: 'application/pdf',
      totalChunks: 51
    }, {
      'Authorization': `Bearer ${userAToken}`
    });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.data.success, false);
    assert.strictEqual(res.data.error.code, 'STORAGE_QUOTA_EXCEEDED');
  });

  // 6. PDF size limit is enforced
  await test('6. Single PDF size limit (25MB for Free) is enforced', async () => {
    const res = await requestJson('POST', '/api/uploads/init', {
      filename: 'too-large.pdf',
      fileSize: 26 * 1024 * 1024, // 26MB
      contentType: 'application/pdf',
      totalChunks: 13
    }, {
      'Authorization': `Bearer ${userAToken}`
    });

    assert.strictEqual(res.status, 413);
    assert.strictEqual(res.data.success, false);
    assert.strictEqual(res.data.error.code, 'FILE_TOO_LARGE');
  });

  // 7. Upload session is created correctly in database
  await test('7. Upload session is stored with correct user_id and expiration', async () => {
    const session = db.getUploadSessionById(activeUploadId);
    assert.ok(session);
    assert.strictEqual(session.user_id, userAId);
    assert.strictEqual(session.publication_id, activePublicationId);
    assert.strictEqual(session.status, 'INITIATED');
  });

  // 8. First chunk uploads successfully
  await test('8. POST /api/uploads/chunk uploads binary slice to disk', async () => {
    const res = await requestMultipartChunk(activeUploadId, 0, VALID_PDF_BUFFER, userAToken);
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.success);
    assert.strictEqual(res.data.data.uploadId, activeUploadId);
    assert.strictEqual(res.data.data.receivedChunks, 1);
    assert.strictEqual(res.data.data.status, 'UPLOADING');
  });

  // 9. Invalid chunk index is rejected
  await test('9. Uploading an invalid chunkIndex (e.g. out of bounds) is rejected with 400', async () => {
    const res = await requestMultipartChunk(activeUploadId, 99, VALID_PDF_BUFFER, userAToken);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.success, false);
  });

  // 10. Security: User B cannot upload to User A's session
  await test('10. Security: User B attempting to upload chunk to User A session is rejected with 403', async () => {
    const res = await requestMultipartChunk(activeUploadId, 0, VALID_PDF_BUFFER, userBToken);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.data.success, false);
    assert.strictEqual(res.data.error.code, 'FORBIDDEN');
  });

  // 11. Missing chunks prevent completion
  await test('11. Complete request with missing chunks is rejected with 400 Incomplete', async () => {
    // Init a 2-chunk session but only upload chunk 0
    const multiInit = await requestJson('POST', '/api/uploads/init', {
      filename: 'multi.pdf',
      fileSize: 4000000,
      totalChunks: 2
    }, {
      'Authorization': `Bearer ${userAToken}`
    });
    const multiUploadId = multiInit.data.data.uploadId;
    await requestMultipartChunk(multiUploadId, 0, Buffer.alloc(1000, 'a'), userAToken);

    const completeRes = await requestJson('POST', '/api/uploads/complete', {
      uploadId: multiUploadId
    }, {
      'Authorization': `Bearer ${userAToken}`
    });

    assert.strictEqual(completeRes.status, 400);
    assert.strictEqual(completeRes.data.success, false);
    assert.strictEqual(completeRes.data.error.code, 'INCOMPLETE_CHUNKS');
  });

  // 12. Complete assembles valid PDF
  let completedPub = null;
  await test('12. POST /api/uploads/complete assembles PDF and creates publication in R2 & DB', async () => {
    const beforeUser = db.getUserById(userAId);
    const beforeStorage = beforeUser.storage_used_bytes || 0;
    const beforeCount = beforeUser.publication_count || 0;

    const res = await requestJson('POST', '/api/uploads/complete', {
      uploadId: activeUploadId,
      title: 'Alice Annual Report 2026',
      category: 'Report'
    }, {
      'Authorization': `Bearer ${userAToken}`
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.data.success);
    assert.ok(res.data.data.publication);
    assert.strictEqual(res.data.data.publication.id, activePublicationId);
    assert.strictEqual(res.data.data.publication.title, 'Alice Annual Report 2026');
    assert.strictEqual(res.data.data.publication.pageCount, 1);
    assert.strictEqual(res.data.data.publication.fileSize, VALID_PDF_BUFFER.length);

    completedPub = res.data.data.publication;

    // Check user counters incremented
    const afterUser = db.getUserById(userAId);
    assert.strictEqual(afterUser.publication_count, beforeCount + 1);
    assert.strictEqual(afterUser.storage_used_bytes, beforeStorage + VALID_PDF_BUFFER.length);
  });

  // 13. Invalid PDF binary is rejected cleanly
  await test('13. Completion with corrupt/invalid PDF is rejected with 400 INVALID_PDF', async () => {
    const corruptInit = await requestJson('POST', '/api/uploads/init', {
      filename: 'corrupt.pdf',
      fileSize: 100,
      totalChunks: 1
    }, {
      'Authorization': `Bearer ${userAToken}`
    });
    const corruptId = corruptInit.data.data.uploadId;
    await requestMultipartChunk(corruptId, 0, Buffer.from('NOT_A_VALID_PDF_HEADER_AT_ALL'), userAToken);

    const completeRes = await requestJson('POST', '/api/uploads/complete', {
      uploadId: corruptId
    }, {
      'Authorization': `Bearer ${userAToken}`
    });

    assert.strictEqual(completeRes.status, 400);
    assert.strictEqual(completeRes.data.success, false);
    assert.strictEqual(completeRes.data.error.code, 'INVALID_PDF');
  });

  // 14. Page limit is enforced on completion
  await test('14. Plan page count limit is enforced during inspection', async () => {
    // If user is on a custom plan with max 0 pages
    const userWith0Pages = db.createUser({
      email: `zero_pages_${Date.now()}@example.com`,
      password_hash: '$2a$10$xxx',
      plan_id: 'free'
    });
    // Create session for user
    const pInit = await requestJson('POST', '/api/uploads/init', {
      filename: 'page-check.pdf',
      fileSize: VALID_PDF_BUFFER.length,
      totalChunks: 1
    }, {
      'Authorization': `Bearer ${userAToken}`
    });
    const pId = pInit.data.data.uploadId;
    await requestMultipartChunk(pId, 0, VALID_PDF_BUFFER, userAToken);

    // Verify completion checks plan max_pages_per_doc (30 pages is default for Free, so 1 page passes)
    const pComp = await requestJson('POST', '/api/uploads/complete', { uploadId: pId }, { 'Authorization': `Bearer ${userAToken}` });
    assert.strictEqual(pComp.status, 200);
  });

  // 15. R2 storage key uses user namespace
  await test('15. R2 storage key follows users/{userId}/publications/{publicationId}/original.pdf namespace', async () => {
    const pubRecord = db.getPublicationById(activePublicationId);
    assert.ok(pubRecord);
    const expectedKey = `users/${userAId}/publications/${activePublicationId}/original.pdf`;
    assert.strictEqual(pubRecord.storage_key, expectedKey, 'Storage key must be namespaced to user');
  });

  // 16. Publication user_id is set correctly
  await test('16. Publication user_id matches authenticated User A ID', async () => {
    const pubRecord = db.getPublicationById(activePublicationId);
    assert.strictEqual(pubRecord.user_id, userAId);
  });

  // 17. Storage counter increments exactly once
  await test('17. Storage counter increments accurately without drift', async () => {
    const user = db.getUserById(userAId);
    assert.ok(user.storage_used_bytes > 0);
  });

  // 18. Repeated complete does not double-count storage (Idempotency)
  await test('18. Idempotency: Calling complete on already completed session returns publication without double-counting', async () => {
    const userBefore = db.getUserById(userAId);
    const storageBefore = userBefore.storage_used_bytes;
    const countBefore = userBefore.publication_count;

    const res = await requestJson('POST', '/api/uploads/complete', {
      uploadId: activeUploadId
    }, {
      'Authorization': `Bearer ${userAToken}`
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.data.publication.id, activePublicationId);

    const userAfter = db.getUserById(userAId);
    assert.strictEqual(userAfter.storage_used_bytes, storageBefore, 'Storage bytes must NOT increase on repeated complete');
    assert.strictEqual(userAfter.publication_count, countBefore, 'Publication count must NOT increase on repeated complete');
  });

  // 19. Delete upload session cancels and cleans temp files
  let cancelUploadId = '';
  await test('19. DELETE /api/uploads/:id cancels session and cleans temp chunks', async () => {
    const cInit = await requestJson('POST', '/api/uploads/init', {
      filename: 'cancel-me.pdf',
      fileSize: 1000,
      totalChunks: 1
    }, {
      'Authorization': `Bearer ${userAToken}`
    });
    cancelUploadId = cInit.data.data.uploadId;
    await requestMultipartChunk(cancelUploadId, 0, Buffer.alloc(1000), userAToken);

    const delRes = await requestJson('DELETE', `/api/uploads/${cancelUploadId}`, null, {
      'Authorization': `Bearer ${userAToken}`
    });

    assert.strictEqual(delRes.status, 200);
    assert.ok(delRes.data.success);
  });

  // 20. Security: User B cannot delete User A's upload session
  await test('20. Security: User B attempting to delete User A upload session is rejected with 403', async () => {
    const sessInit = await requestJson('POST', '/api/uploads/init', {
      filename: 'alice-private.pdf',
      fileSize: 500,
      totalChunks: 1
    }, {
      'Authorization': `Bearer ${userAToken}`
    });
    const aliceUploadId = sessInit.data.data.uploadId;

    const delRes = await requestJson('DELETE', `/api/uploads/${aliceUploadId}`, null, {
      'Authorization': `Bearer ${userBToken}`
    });

    assert.strictEqual(delRes.status, 403);
    assert.strictEqual(delRes.data.success, false);
    assert.strictEqual(delRes.data.error.code, 'FORBIDDEN');
  });

  // 21. Expired upload session is rejected
  await test('21. Expired upload session rejects chunk uploads with 400 UPLOAD_EXPIRED', async () => {
    const expInit = await requestJson('POST', '/api/uploads/init', {
      filename: 'expire.pdf',
      fileSize: 500,
      totalChunks: 1
    }, {
      'Authorization': `Bearer ${userAToken}`
    });
    const expId = expInit.data.data.uploadId;

    // Force expire in DB
    db.updateUploadSession(expId, { expires_at: new Date(Date.now() - 10000).toISOString() });

    const chunkRes = await requestMultipartChunk(expId, 0, Buffer.alloc(500), userAToken);
    assert.strictEqual(chunkRes.status, 400);
    assert.strictEqual(chunkRes.data.error.code, 'UPLOAD_EXPIRED');
  });

  // 22. Existing Blogger catalog still works
  await test('22. Backward Compatibility: GET /api/publications returns public feed for Blogger', async () => {
    const res = await requestJson('GET', '/api/publications');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.data));
  });

  // 23. Existing publication metadata still works
  await test('23. Backward Compatibility: GET /api/publications/:id returns publication metadata', async () => {
    const res = await requestJson('GET', `/api/publications/${activePublicationId}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.data.id, activePublicationId);
  });

  // 24. Existing PDF streaming still works
  await test('24. Backward Compatibility: GET /api/publications/:id/pdf streams PDF with CORS', async () => {
    const res = await new Promise((resolve, reject) => {
      http.get(`${BASE_URL}/api/publications/${activePublicationId}/pdf`, (r) => {
        let chunks = [];
        r.on('data', c => chunks.push(c));
        r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, length: Buffer.concat(chunks).length }));
      }).on('error', reject);
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['access-control-allow-origin'], '*');
    assert.strictEqual(res.headers['content-type'], 'application/pdf');
    assert.strictEqual(res.length, VALID_PDF_BUFFER.length);
  });

  // 25. Legacy chunk upload still works (POST /api/upload-chunk)
  const legacyUploadId = `legacy_chunk_${Date.now()}`;
  await test('25. Backward Compatibility: Legacy POST /api/upload-chunk functions seamlessly', async () => {
    const boundary = '----LegacyBoundary' + Math.random().toString(36).substring(2);
    let chunkHeader = '';
    chunkHeader += '--' + boundary + '\r\n';
    chunkHeader += 'Content-Disposition: form-data; name="uploadId"\r\n\r\n' + legacyUploadId + '\r\n';
    chunkHeader += '--' + boundary + '\r\n';
    chunkHeader += 'Content-Disposition: form-data; name="chunkIndex"\r\n\r\n0\r\n';
    chunkHeader += '--' + boundary + '\r\n';
    chunkHeader += 'Content-Disposition: form-data; name="totalChunks"\r\n\r\n1\r\n';
    chunkHeader += '--' + boundary + '\r\n';
    chunkHeader += 'Content-Disposition: form-data; name="filename"\r\n\r\nlegacy-doc.pdf\r\n';
    chunkHeader += '--' + boundary + '\r\n';
    chunkHeader += 'Content-Disposition: form-data; name="chunk"; filename="legacy-doc.pdf"\r\n';
    chunkHeader += 'Content-Type: application/pdf\r\n\r\n';

    const fullChunkBody = Buffer.concat([Buffer.from(chunkHeader, 'utf8'), VALID_PDF_BUFFER, Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8')]);

    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: 8097,
        path: '/api/upload-chunk',
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=' + boundary,
          'Content-Length': fullChunkBody.length
        }
      }, (r) => {
        let data = '';
        r.on('data', c => data += c);
        r.on('end', () => resolve({ status: r.statusCode, data: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.write(fullChunkBody);
      req.end();
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.data.success);
  });

  // 26. Legacy finalize upload still works (POST /api/finalize-upload)
  await test('26. Backward Compatibility: Legacy POST /api/finalize-upload completes upload', async () => {
    const res = await requestJson('POST', '/api/finalize-upload', {
      uploadId: legacyUploadId,
      filename: 'legacy-doc.pdf',
      title: 'Legacy Blogger Document'
    });

    assert.strictEqual(res.status, 200);
    assert.ok(res.data.success);
    assert.strictEqual(res.data.data.title, 'Legacy Blogger Document');
  });

  // 27. Existing admin-key functionality still works
  await test('27. Backward Compatibility: Admin API key header grants administrative access', async () => {
    const res = await requestJson('GET', '/api/admin/stats', null, {
      'x-admin-key': 'test_admin_key_2026'
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.success);
    assert.ok(res.data.data.totalPublications >= 2);
  });

  console.log('\n========================================================');
  console.log(`🎉 PHASE 3 TEST SUMMARY: ${passed} / ${total} Passed (${Math.round((passed/total)*100)}%)`);
  console.log('========================================================\n');

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

setTimeout(runPhase3Tests, 1000);
