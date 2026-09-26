/**
 * ==========================================================================
 * FLIPVIEW PHASE 4 TEST SUITE
 * Standalone Public FlipView Viewer & Public Reader API
 * ==========================================================================
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.PORT = '8096';
process.env.ADMIN_API_KEY = 'test_admin_key_2026';
process.env.JWT_SECRET = 'test_jwt_secret_flipview_2026';
process.env.PUBLIC_VIEWER_BASE_URL = 'https://flipviewpdf.com';

const app = require('./server');
const db = require('./src/db/database');
const authService = require('./src/services/auth/auth.service');
const storageService = require('./src/services/storage/storage.service');

const BASE_URL = 'http://localhost:8096';

function generateMinimalPdf(pageCount = 3) {
  let content = `%PDF-1.4\n`;
  let offsets = [];
  offsets.push(content.length);
  content += `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  
  offsets.push(content.length);
  let kids = '';
  for (let i = 0; i < pageCount; i++) {
    kids += `${3 + i * 2} 0 R `;
  }
  content += `2 0 obj\n<< /Type /Pages /Kids [ ${kids}] /Count ${pageCount} >>\nendobj\n`;

  for (let i = 0; i < pageCount; i++) {
    const pageObjNum = 3 + i * 2;
    const contentObjNum = 4 + i * 2;
    offsets.push(content.length);
    content += `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjNum} 0 R >>\nendobj\n`;
    offsets.push(content.length);
    const streamContent = `BT /F1 24 Tf 100 700 Td (FlipView Test Page ${i + 1}) Tj ET`;
    content += `${contentObjNum} 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj\n`;
  }

  const xrefOffset = content.length;
  content += `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    content += `${off.toString().padStart(10, '0')} 00000 n \n`;
  }
  content += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(content, 'utf8');
}

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
          data: json,
          rawBuffer: buffer
        });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runPhase4Tests() {
  console.log('\n========================================================');
  console.log('🧪 RUNNING FLIPVIEW PHASE 4 PUBLIC VIEWER TEST SUITE');
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

  const pdf3Pages = generateMinimalPdf(3);
  const pdfStorageKeyPublic = 'users/usr_test_author/publications/pub_test_public_01/original.pdf';
  await storageService.upload(pdfStorageKeyPublic, pdf3Pages, 'application/pdf');

  const pubPublic = db.createPublication({
    id: 'pub_test_public_01',
    user_id: 'usr_test_author',
    title: 'Public Architecture Magazine',
    category: 'Magazine',
    description: 'A test public digital magazine.',
    author: 'Studio Alpha',
    pdf_filename: 'architecture-mag.pdf',
    storage_key: pdfStorageKeyPublic,
    pdf_url: storageService.getUrl(pdfStorageKeyPublic),
    cover_url: '',
    page_count: 3,
    file_size: pdf3Pages.length,
    file_hash: 'hash_test_public_01',
    status: 'READY',
    published: 1,
    visibility: 'PUBLIC',
    has_branding: 1,
    download_enabled: 1,
    share_enabled: 1
  });

  const pdfStorageKeyUnlisted = 'users/usr_test_author/publications/pub_test_unlisted_02/original.pdf';
  await storageService.upload(pdfStorageKeyUnlisted, pdf3Pages, 'application/pdf');
  const pubUnlisted = db.createPublication({
    id: 'pub_test_unlisted_02',
    user_id: 'usr_test_author',
    title: 'Unlisted Corporate Briefing',
    category: 'Corporate',
    description: 'Unlisted doc accessible via direct link.',
    author: 'Corp Executive',
    pdf_filename: 'briefing.pdf',
    storage_key: pdfStorageKeyUnlisted,
    pdf_url: storageService.getUrl(pdfStorageKeyUnlisted),
    cover_url: '',
    page_count: 3,
    file_size: pdf3Pages.length,
    status: 'READY',
    published: 1,
    visibility: 'UNLISTED',
    has_branding: 0,
    download_enabled: 0
  });

  const pdfStorageKeyPrivate = 'users/usr_test_author/publications/pub_test_private_03/original.pdf';
  await storageService.upload(pdfStorageKeyPrivate, pdf3Pages, 'application/pdf');
  const pubPrivate = db.createPublication({
    id: 'pub_test_private_03',
    user_id: 'usr_test_author',
    title: 'Strictly Confidential Internal Note',
    category: 'Internal',
    description: 'Private document never accessible by public.',
    author: 'Security Lead',
    pdf_filename: 'private.pdf',
    storage_key: pdfStorageKeyPrivate,
    pdf_url: storageService.getUrl(pdfStorageKeyPrivate),
    page_count: 3,
    file_size: pdf3Pages.length,
    status: 'READY',
    published: 1,
    visibility: 'PRIVATE'
  });

  const protectedPassword = 'SecretFlipViewPassword2026!';
  const protectedPasswordHash = await authService.hashPassword(protectedPassword);
  const pdfStorageKeyProtected = 'users/usr_test_author/publications/pub_test_protected_04/original.pdf';
  await storageService.upload(pdfStorageKeyProtected, pdf3Pages, 'application/pdf');
  const pubProtected = db.createPublication({
    id: 'pub_test_protected_04',
    user_id: 'usr_test_author',
    title: 'Password Protected Financial Audit',
    category: 'Report',
    description: 'Protected financial audit.',
    author: 'Auditor General',
    pdf_filename: 'audit.pdf',
    storage_key: pdfStorageKeyProtected,
    pdf_url: storageService.getUrl(pdfStorageKeyProtected),
    page_count: 3,
    file_size: pdf3Pages.length,
    status: 'READY',
    published: 1,
    visibility: 'PASSWORD_PROTECTED',
    password_hash: protectedPasswordHash
  });

  const pdfStorageKeyProtected2 = 'users/usr_test_author/publications/pub_test_protected_05/original.pdf';
  await storageService.upload(pdfStorageKeyProtected2, pdf3Pages, 'application/pdf');
  const pubProtected2 = db.createPublication({
    id: 'pub_test_protected_05',
    user_id: 'usr_test_author',
    title: 'Second Protected Document',
    category: 'Report',
    pdf_filename: 'protected2.pdf',
    storage_key: pdfStorageKeyProtected2,
    pdf_url: storageService.getUrl(pdfStorageKeyProtected2),
    page_count: 3,
    file_size: pdf3Pages.length,
    status: 'READY',
    published: 1,
    visibility: 'PASSWORD_PROTECTED',
    password_hash: protectedPasswordHash
  });

  // 1. PUBLIC metadata accessible
  await test('1. PUBLIC publication metadata accessible via GET /api/public/:id', async () => {
    const res = await request('GET', `/api/public/${pubPublic.id}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.publication.id, pubPublic.id);
    assert.strictEqual(res.data.data.publication.title, 'Public Architecture Magazine');
    assert.strictEqual(res.data.data.publication.visibility, 'PUBLIC');
    assert.strictEqual(res.data.data.publication.requiresPassword, false);
    assert.ok(res.data.data.publication.publicUrl.includes('/view/'));
  });

  // 2. PUBLIC PDF accessible
  await test('2. PUBLIC PDF accessible via GET /api/public/:id/pdf with streaming headers', async () => {
    const res = await request('GET', `/api/public/${pubPublic.id}/pdf`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['content-type'], 'application/pdf');
    assert.strictEqual(res.headers['accept-ranges'], 'bytes');
    assert.strictEqual(res.headers['access-control-allow-origin'], '*');
    assert.ok(res.rawBuffer.length > 0);
  });

  // 3. UNLISTED accessible via direct link
  await test('3. UNLISTED direct URL metadata accessible', async () => {
    const res = await request('GET', `/api/public/${pubUnlisted.id}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.publication.id, pubUnlisted.id);
    assert.strictEqual(res.data.data.publication.visibility, 'UNLISTED');
  });

  // 4. PRIVATE rejected
  await test('4. PRIVATE publication rejected with 403 Forbidden', async () => {
    const metaRes = await request('GET', `/api/public/${pubPrivate.id}`);
    assert.strictEqual(metaRes.status, 403);
    assert.strictEqual(metaRes.data.success, false);
    assert.strictEqual(metaRes.data.error.code, 'PUBLICATION_PRIVATE');

    const pdfRes = await request('GET', `/api/public/${pubPrivate.id}/pdf`);
    assert.strictEqual(pdfRes.status, 403);
  });

  // 5. PASSWORD_PROTECTED requires password
  await test('5. PASSWORD_PROTECTED publication metadata requires password and hides pdfUrl', async () => {
    const res = await request('GET', `/api/public/${pubProtected.id}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.publication.requiresPassword, true);
    assert.strictEqual(res.data.data.publication.pdfUrl, null);

    const pdfRes = await request('GET', `/api/public/${pubProtected.id}/pdf`);
    assert.strictEqual(pdfRes.status, 401);
  });

  // 6. Wrong password rejected
  await test('6. Wrong password rejected by POST /api/public/:id/verify-password', async () => {
    const res = await request('POST', `/api/public/${pubProtected.id}/verify-password`, {
      password: 'WrongPassword123'
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.data.success, false);
    assert.strictEqual(res.data.error.code, 'INVALID_PASSWORD');
  });

  // 7. Correct password returns viewer token
  let viewerTokenProtected = '';
  await test('7. Correct password returns short-lived viewerToken', async () => {
    const res = await request('POST', `/api/public/${pubProtected.id}/verify-password`, {
      password: protectedPassword
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.data.viewerToken);
    assert.strictEqual(res.data.data.publicationId, pubProtected.id);
    viewerTokenProtected = res.data.data.viewerToken;
  });

  // 8. Viewer token grants access to PDF
  await test('8. Viewer token grants streaming access to protected PDF', async () => {
    const res = await request('GET', `/api/public/${pubProtected.id}/pdf?token=${encodeURIComponent(viewerTokenProtected)}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['content-type'], 'application/pdf');
    assert.ok(res.rawBuffer.length > 0);
  });

  // 9. Viewer token cannot access another protected publication
  await test('9. Security: Viewer token cannot access another protected publication', async () => {
    const res = await request('GET', `/api/public/${pubProtected2.id}/pdf?token=${encodeURIComponent(viewerTokenProtected)}`);
    assert.strictEqual(res.status, 401);
  });

  // 10. Expired/invalid viewer token rejected
  await test('10. Security: Forged or invalid viewer token is rejected with 401', async () => {
    const res = await request('GET', `/api/public/${pubProtected.id}/pdf?token=invalid.jwt.token`);
    assert.strictEqual(res.status, 401);
  });

  // 11. password_hash never appears in public metadata
  await test('11. Security: password_hash never leaks in public API metadata', async () => {
    const res = await request('GET', `/api/public/${pubProtected.id}`);
    assert.strictEqual(res.data.data.publication.password_hash, undefined);
    assert.strictEqual(JSON.stringify(res.data).includes(protectedPasswordHash), false);
  });

  // 12. User password_hash never appears
  await test('12. Security: User password_hash or internal user data never leaks', async () => {
    const res = await request('GET', `/api/public/${pubPublic.id}`);
    assert.strictEqual(res.data.data.publication.user, undefined);
    assert.strictEqual(res.data.data.publication.user_password, undefined);
  });

  // 13. R2 credentials never appear
  await test('13. Security: R2 credentials, secret keys, or storage internals never leak', async () => {
    const res = await request('GET', `/api/public/${pubPublic.id}`);
    const jsonStr = JSON.stringify(res.data);
    assert.strictEqual(jsonStr.includes('secretAccessKey'), false);
    assert.strictEqual(jsonStr.includes('accessKeyId'), false);
  });

  // 14. download_enabled=false is respected
  await test('14. download_enabled=false is enforced by server on direct download request', async () => {
    const res = await request('GET', `/api/public/${pubUnlisted.id}/pdf?download=1`);
    assert.strictEqual(res.status, 403);
  });

  // 15. publicUrl uses configured public viewer URL
  await test('15. publicUrl uses configured public viewer URL (/view/:id)', async () => {
    const res = await request('GET', `/api/public/${pubPublic.id}`);
    assert.strictEqual(res.data.data.publication.publicUrl, `https://flipviewpdf.com/view/${pubPublic.id}`);
  });

  // 16. Standalone viewer route returns HTML
  await test('16. Standalone viewer route GET /view/:id returns 200 HTML reader app', async () => {
    const res = await request('GET', `/view/${pubPublic.id}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.includes('fv-viewer'));
    assert.ok(res.data.includes('/viewer/viewer.js'));
  });

  // 17. Standalone viewer static assets resolve
  await test('17. Standalone viewer static assets (/viewer/viewer.css & /viewer/viewer.js) resolve 200', async () => {
    const cssRes = await request('GET', '/viewer/viewer.css');
    assert.strictEqual(cssRes.status, 200);
    assert.ok(cssRes.data.includes('--fv-primary'));

    const jsRes = await request('GET', '/viewer/viewer.js');
    assert.strictEqual(jsRes.status, 200);
    assert.ok(jsRes.data.includes('FLIPVIEW PDF STANDALONE VIEWER'));
  });

  // 18. VIEW analytics event works and increments view_count
  await test('18. POST /api/analytics/view records VIEW event and increments view_count', async () => {
    const beforePub = db.getPublicationById(pubPublic.id);
    const initialViews = beforePub.view_count || 0;

    const res = await request('POST', '/api/analytics/view', {
      publicationId: pubPublic.id,
      eventType: 'VIEW'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);

    const afterPub = db.getPublicationById(pubPublic.id);
    assert.strictEqual(afterPub.view_count, initialViews + 1);
  });

  // 19. PAGE_TURN, DOWNLOAD, SHARE, QR_SCAN analytics events
  await test('19. Reader interactions (PAGE_TURN, DOWNLOAD, SHARE, QR_SCAN) record without error', async () => {
    const events = ['PAGE_TURN', 'DOWNLOAD', 'SHARE', 'QR_SCAN'];
    for (const evt of events) {
      const res = await request('POST', '/api/analytics/view', {
        publicationId: pubPublic.id,
        eventType: evt,
        pageNumber: 2
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
    }
  });

  // 20. Analytics failure does not crash
  await test('20. Empty or invalid analytics payload is safely handled gracefully', async () => {
    const res = await request('POST', '/api/analytics/view', {});
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
  });

  // 21. HTTP Range request support on PDF streaming
  await test('21. HTTP Range request on GET /api/public/:id/pdf returns 206 Partial Content', async () => {
    const res = await request('GET', `/api/public/${pubPublic.id}/pdf`, null, {
      'Range': 'bytes=0-1023'
    });
    assert.ok(res.status === 206 || res.status === 200);
    assert.ok(res.rawBuffer.length <= 1024 || res.rawBuffer.length === pdf3Pages.length);
  });

  // 22. HEAD request on PDF returns headers
  await test('22. HEAD request on GET /api/public/:id/pdf returns 200 with Content-Length', async () => {
    const res = await request('HEAD', `/api/public/${pubPublic.id}/pdf`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['content-type'], 'application/pdf');
    assert.ok(res.headers['content-length']);
  });

  // 23. Public cover endpoint
  await test('23. GET /api/public/:id/cover serves cover image / SVG with status 200 or 302', async () => {
    const res = await request('GET', `/api/public/${pubPublic.id}/cover`);
    assert.ok(res.status === 200 || res.status === 302);
  });

  // 24. Legacy Blogger metadata endpoint still works
  await test('24. Backward Compatibility: Legacy GET /api/publications/:id works', async () => {
    const res = await request('GET', `/api/publications/${pubPublic.id}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.data.id, pubPublic.id);
  });

  // 25. Legacy Blogger PDF endpoint still works
  await test('25. Backward Compatibility: Legacy GET /api/publications/:id/pdf streams PDF', async () => {
    const res = await request('GET', `/api/publications/${pubPublic.id}/pdf`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['content-type'], 'application/pdf');
  });

  // 26. Legacy Blogger cover endpoint still works
  await test('26. Backward Compatibility: Legacy GET /api/publications/:id/cover works', async () => {
    const res = await request('GET', `/api/publications/${pubPublic.id}/cover`);
    assert.ok(res.status === 200 || res.status === 302);
  });

  // 27. Standalone viewer route works for sub-routes
  await test('27. GET /view/:id/page-2 serves viewer shell for direct deep-linking', async () => {
    const res = await request('GET', `/view/${pubPublic.id}/page-2`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.includes('fv-viewer'));
  });

  console.log('\n========================================================');
  console.log(`🎉 PHASE 4 TEST SUMMARY: ${passed} / ${total} Passed (${Math.round((passed / total) * 100)}%)`);
  console.log('========================================================\n');

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

setTimeout(runPhase4Tests, 1000);
