const crypto = require('crypto');
const { PDFDocument } = require('pdf-lib');

class PdfService {
  /**
   * Validate PDF magic bytes and parse structure
   * @param {Buffer} buffer
   */
  async validateAndInspect(buffer) {
    if (!buffer || buffer.length < 10) {
      throw new Error('Invalid file: empty or corrupted PDF buffer.');
    }

    // Check magic bytes %PDF-
    const header = buffer.subarray(0, 5).toString('ascii');
    if (header !== '%PDF-') {
      throw new Error('Invalid file format: file does not have a valid PDF header.');
    }

    try {
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const pageCount = pdfDoc.getPageCount();

      if (pageCount < 1) {
        throw new Error('The PDF document contains 0 pages.');
      }

      const firstPage = pdfDoc.getPage(0);
      const { width, height } = firstPage.getSize();

      // Extract metadata if available
      const title = pdfDoc.getTitle() || '';
      const author = pdfDoc.getAuthor() || '';
      const subject = pdfDoc.getSubject() || '';

      // Compute SHA-256 hash for duplicate detection
      const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

      return {
        isValid: true,
        pageCount,
        dimensions: { width, height },
        meta: { title, author, subject },
        fileHash,
        fileSize: buffer.length
      };
    } catch (err) {
      throw new Error(`PDF validation error: ${err.message}`);
    }
  }

  /**
   * Generate an ultra-clean, lightweight SVG vector cover banner for instant homepage rendering
   * @param {string} title
   * @param {string} category
   * @param {number} pageCount
   * @param {number} width
   * @param {number} height
   * @returns {Buffer}
   */
  generateVectorCoverSvg(title, category = 'Magazine', pageCount = 1, width = 600, height = 800) {
    const cleanTitle = (title || 'Digital Publication').replace(/[<>&"]/g, '');
    const cleanCat = (category || 'MAGAZINE').toUpperCase().replace(/[<>&"]/g, '');
    
    // Choose gradient accents based on category
    const gradients = {
      MAGAZINE: ['#1e1b4b', '#312e81', '#4338ca', '#6366f1'],
      BROCHURE: ['#064e3b', '#065f46', '#047857', '#10b981'],
      REPORT: ['#1c1917', '#292524', '#44403c', '#78716c'],
      CATALOGUE: ['#701a75', '#86198f', '#a21caf', '#d946ef'],
      DEFAULT: ['#0f172a', '#1e293b', '#334155', '#4f46e5']
    };

    const colors = gradients[cleanCat] || gradients.DEFAULT;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colors[0]}" />
      <stop offset="40%" stop-color="${colors[1]}" />
      <stop offset="80%" stop-color="${colors[2]}" />
      <stop offset="100%" stop-color="${colors[3]}" />
    </linearGradient>
    <linearGradient id="spineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="rgba(0,0,0,0.45)" />
      <stop offset="70%" stop-color="rgba(255,255,255,0.08)" />
      <stop offset="100%" stop-color="rgba(0,0,0,0.3)" />
    </linearGradient>
    <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="rgba(0,0,0,0.5)" />
    </filter>
  </defs>

  <!-- Background Canvas -->
  <rect width="${width}" height="${height}" fill="url(#bgGrad)" />

  <!-- Subtle Geometric Accents -->
  <circle cx="${width * 0.85}" cy="${height * 0.15}" r="${width * 0.4}" fill="rgba(255,255,255,0.03)" />
  <circle cx="${width * 0.15}" cy="${height * 0.85}" r="${width * 0.35}" fill="rgba(255,255,255,0.02)" />

  <!-- Magazine Book Spine Shading -->
  <rect x="0" y="0" width="24" height="${height}" fill="url(#spineGrad)" />

  <!-- Border Highlight -->
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="2" rx="4" />

  <!-- Category Tag -->
  <g transform="translate(48, 64)">
    <rect x="0" y="0" width="130" height="32" rx="16" fill="rgba(255,255,255,0.15)" />
    <text x="65" y="21" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="700" fill="#ffffff" text-anchor="middle" letter-spacing="1.5">${cleanCat}</text>
  </g>

  <!-- Publication Title -->
  <g transform="translate(48, 150)">
    <foreignObject x="0" y="0" width="${width - 96}" height="${height - 280}">
      <div xmlns="http://www.w3.org/1999/xhtml" style="color:#ffffff; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:36px; font-weight:800; line-height:1.25; text-shadow:0 2px 10px rgba(0,0,0,0.5); word-break:break-word; max-height:100%; overflow:hidden;">
        ${cleanTitle}
      </div>
    </foreignObject>
  </g>

  <!-- Bottom Details Bar -->
  <g transform="translate(48, ${height - 72})">
    <rect x="0" y="0" width="${width - 96}" height="42" rx="8" fill="rgba(0,0,0,0.3)" />
    <text x="20" y="26" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="600" fill="#e2e8f0">
      📖 Interactive 3D Edition
    </text>
    <text x="${width - 116}" y="26" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="500" fill="#94a3b8" text-anchor="end">
      ${pageCount} ${pageCount === 1 ? 'Page' : 'Pages'}
    </text>
  </g>
</svg>`;

    return Buffer.from(svg, 'utf-8');
  }
}

module.exports = new PdfService();
