const fs = require('fs');
const http = require('http');

async function testUpload() {
  const fileBuf = fs.readFileSync('../demo/sample-magazine.pdf');
  const uploadId = 'test_' + Date.now();
  const filename = 'sample-magazine.pdf';

  console.log('Testing upload of', filename, fileBuf.length, 'bytes...');

  // 1. Upload chunk
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  let header = '';
  header += '--' + boundary + '\r\n';
  header += 'Content-Disposition: form-data; name="uploadId"\r\n\r\n' + uploadId + '\r\n';
  header += '--' + boundary + '\r\n';
  header += 'Content-Disposition: form-data; name="chunkIndex"\r\n\r\n0\r\n';
  header += '--' + boundary + '\r\n';
  header += 'Content-Disposition: form-data; name="totalChunks"\r\n\r\n1\r\n';
  header += '--' + boundary + '\r\n';
  header += 'Content-Disposition: form-data; name="filename"\r\n\r\n' + filename + '\r\n';
  header += '--' + boundary + '\r\n';
  header += 'Content-Disposition: form-data; name="chunk"; filename="' + filename + '"\r\n';
  header += 'Content-Type: application/pdf\r\n\r\n';

  const bodyStart = Buffer.from(header, 'utf8');
  const bodyEnd = Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8');
  const fullBody = Buffer.concat([bodyStart, fileBuf, bodyEnd]);

  await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 8080,
      path: '/api/upload-chunk',
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': fullBody.length
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        console.log('Chunk Upload Response:', res.statusCode, data);
        resolve();
      });
    });
    req.on('error', reject);
    req.write(fullBody);
    req.end();
  });

  // 2. Finalize
  const finalizePayload = JSON.stringify({
    uploadId: uploadId,
    filename: filename,
    title: 'Automated Test Magazine',
    category: 'Magazine'
  });

  await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 8080,
      path: '/api/finalize-upload',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(finalizePayload)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        console.log('Finalize Response:', res.statusCode, data);
        resolve();
      });
    });
    req.on('error', reject);
    req.write(finalizePayload);
    req.end();
  });
}

testUpload().catch(console.error);
