const config = require('../../config');
const storageService = require('../storage/storage.service');
const pdfService = require('../pdf/pdf.service');
const db = require('../../db/database');

class MigrationService {
  /**
   * Run migration from legacy GitHub repository to Cloudflare R2 & Database
   * @param {Object} options
   */
  async migrateFromGithub(options = {}) {
    const repo = options.repo || config.legacyGithub.repo;
    const token = options.token || config.legacyGithub.token;
    const dryRun = Boolean(options.dryRun);

    const headers = {
      'User-Agent': 'Flipview-Migration-Tool',
      'Accept': 'application/vnd.github.v3+json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    console.log(`[Migration] Scanning GitHub repository "${repo}"...`);
    const apiUrl = `https://api.github.com/repos/${repo}/contents/`;
    const res = await fetch(apiUrl, { headers });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`GitHub API scan failed: HTTP ${res.status} - ${err.message || res.statusText}`);
    }

    const files = await res.json();
    const pdfFiles = files.filter(f => f.name && f.name.toLowerCase().endsWith('.pdf') && f.type === 'file');

    const results = {
      totalFound: pdfFiles.length,
      migrated: [],
      skipped: [],
      errors: []
    };

    for (const file of pdfFiles) {
      try {
        const rawFilename = file.name;
        const cleanTitle = rawFilename.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
        const datePrefix = new Date().toISOString().slice(0, 7).replace('-', '/');
        const pubId = 'pub_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
        const storageKey = `uploads/${datePrefix}/${pubId}/${rawFilename}`;

        console.log(`[Migration] Fetching ${rawFilename} (${file.size} bytes)...`);
        const downloadUrl = file.download_url || `https://raw.githubusercontent.com/${repo}/main/${encodeURIComponent(rawFilename)}`;
        const pdfRes = await fetch(downloadUrl);

        if (!pdfRes.ok) {
          throw new Error(`Failed to download ${rawFilename}: HTTP ${pdfRes.status}`);
        }

        const arrayBuf = await pdfRes.arrayBuffer();
        const pdfBuffer = Buffer.from(arrayBuf);

        // Inspect PDF
        const inspect = await pdfService.validateAndInspect(pdfBuffer);

        // Check if already in database by file hash
        const existing = db.getPublicationByHash(inspect.fileHash);
        if (existing) {
          console.log(`[Migration] Skipping ${rawFilename} - already exists as ${existing.id}`);
          results.skipped.push({ filename: rawFilename, id: existing.id, reason: 'Duplicate hash' });
          continue;
        }

        if (!dryRun) {
          // Upload PDF to R2
          const { url: pdfUrl } = await storageService.upload(storageKey, pdfBuffer, 'application/pdf');

          // Generate & upload cover
          const coverSvg = pdfService.generateVectorCoverSvg(cleanTitle, 'Magazine', inspect.pageCount);
          const coverKey = `covers/${pubId}.svg`;
          const { url: coverUrl } = await storageService.upload(coverKey, coverSvg, 'image/svg+xml');

          // Save publication in database
          const pubRecord = db.createPublication({
            id: pubId,
            title: cleanTitle,
            category: 'Magazine',
            description: `Legacy publication migrated from GitHub repository ${repo}.`,
            pdf_filename: rawFilename,
            storage_key: storageKey,
            pdf_url: pdfUrl,
            cover_url: coverUrl,
            page_count: inspect.pageCount,
            file_size: inspect.fileSize,
            file_hash: inspect.fileHash,
            status: 'PUBLISHED',
            published: 1
          });

          results.migrated.push({
            id: pubId,
            filename: rawFilename,
            title: cleanTitle,
            pages: inspect.pageCount,
            pdfUrl,
            coverUrl
          });
        } else {
          results.migrated.push({
            id: pubId,
            filename: rawFilename,
            title: cleanTitle,
            pages: inspect.pageCount,
            dryRun: true
          });
        }
      } catch (err) {
        console.error(`[Migration Error] File ${file.name}:`, err);
        results.errors.push({ filename: file.name, error: err.message });
      }
    }

    return results;
  }
}

module.exports = new MigrationService();
