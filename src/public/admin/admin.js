let currentFile = null;
let currentFileCoverBase64 = null;
let allPublications = [];
const DEFAULT_ADMIN_KEY = 'flipview_secret_admin_key_2026';

function getAdminKey() {
  return localStorage.getItem('flipview_admin_key') || DEFAULT_ADMIN_KEY;
}

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initDropzone();
  loadStats();
  loadPublications();

  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.onclick = () => {
      loadStats();
      loadPublications();
    };
  }

  const newPubBtn = document.getElementById('newPubBtn');
  if (newPubBtn) {
    newPubBtn.onclick = () => {
      switchTab('upload');
    };
  }

  const searchPubs = document.getElementById('searchPubs');
  if (searchPubs) {
    searchPubs.oninput = (e) => {
      const catSelect = document.getElementById('filterCategory');
      filterTable(e.target.value, catSelect ? catSelect.value : 'all');
    };
  }

  const filterCat = document.getElementById('filterCategory');
  if (filterCat) {
    filterCat.onchange = (e) => {
      const searchInput = document.getElementById('searchPubs');
      filterTable(searchInput ? searchInput.value : '', e.target.value);
    };
  }

  const uploadForm = document.getElementById('adminUploadForm');
  if (uploadForm) uploadForm.onsubmit = handleUploadSubmit;

  const dryRunBtn = document.getElementById('migDryRunBtn');
  if (dryRunBtn) dryRunBtn.onclick = () => runMigration(true);

  const startMigBtn = document.getElementById('migStartBtn');
  if (startMigBtn) startMigBtn.onclick = () => runMigration(false);
});

// Tab Switcher
function initTabs() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.onclick = () => {
      const tab = btn.getAttribute('data-tab');
      switchTab(tab);
    };
  });
}

function switchTab(tabId) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === tabId));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === `tab-${tabId}`));
  
  const titles = {
    publications: 'Publications Library',
    upload: 'Publish Digital PDF',
    migration: 'GitHub to R2 Migration',
    settings: 'System & API Settings'
  };
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = titles[tabId] || 'Dashboard';
}

// Load Stats
async function loadStats() {
  try {
    const res = await fetch('/api/admin/stats', {
      headers: { 'x-admin-key': getAdminKey() }
    });
    if (res.ok) {
      const { data } = await res.json();
      const totalEl = document.getElementById('statTotalPubs');
      const pubEl = document.getElementById('statPublished');
      const pendEl = document.getElementById('statPending');
      const storEl = document.getElementById('statStorage');
      if (totalEl) totalEl.textContent = data.totalPublications || allPublications.length || 0;
      if (pubEl) pubEl.textContent = data.published || allPublications.length || 0;
      if (pendEl) pendEl.textContent = data.bloggerPending || 0;
      if (storEl) storEl.textContent = (data.totalStorageMb || 0) + ' MB';
    } else {
      updateFallbackStats();
    }
  } catch (e) {
    updateFallbackStats();
  }
}

function updateFallbackStats() {
  const totalEl = document.getElementById('statTotalPubs');
  const pubEl = document.getElementById('statPublished');
  const storEl = document.getElementById('statStorage');
  if (totalEl) totalEl.textContent = allPublications.length;
  if (pubEl) pubEl.textContent = allPublications.length;
  if (storEl) {
    const totalBytes = allPublications.reduce((acc, p) => acc + (p.file_size || 0), 0);
    storEl.textContent = (totalBytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
}

// Load Publications Table
async function loadPublications() {
  const tbody = document.getElementById('publicationsTableBody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/publications?limit=200');
    if (!res.ok) throw new Error('Failed to fetch publications from API');
    const json = await res.json();
    allPublications = (json && Array.isArray(json.data)) ? json.data : (Array.isArray(json) ? json : []);

    // Populate category filter
    const catSelect = document.getElementById('filterCategory');
    if (catSelect) {
      const cats = [...new Set(allPublications.map(p => p.category).filter(Boolean))];
      catSelect.innerHTML = '<option value="all">All Categories</option>' + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    }

    renderTable(allPublications);
    updateFallbackStats();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-danger text-center" style="padding:24px;">Error loading publications: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderTable(pubs) {
  const tbody = document.getElementById('publicationsTableBody');
  if (!tbody) return;

  if (!pubs || pubs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted" style="padding:32px;">No publications found. Upload your first PDF!</td></tr>';
    return;
  }

  tbody.innerHTML = pubs.map(p => {
    const statusBadge = '<span class="badge badge-success">Ready • R2</span>';
    const dateStr = p.created_at ? new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent';
    const coverSrc = p.cover_url || `/api/publications/${encodeURIComponent(p.id)}/cover`;
    const flipbookUrl = `https://flipviewpdf.blogspot.com/#doc=${encodeURIComponent(p.id)}`;
    const pdfUrl = p.pdf_url || `/api/publications/${encodeURIComponent(p.id)}/pdf`;

    return `
      <tr>
        <td>
          <img src="${coverSrc}" class="pub-thumb" alt="Cover" onerror="this.src='/api/publications/${encodeURIComponent(p.id)}/cover'" />
        </td>
        <td class="pub-title-cell">
          <strong>${escapeHtml(p.title || 'Untitled')}</strong>
          <span class="pub-id-tag">${escapeHtml(p.id)}</span>
        </td>
        <td><span class="badge" style="background:rgba(255,255,255,0.06);">${escapeHtml(p.category || 'Magazine')}</span></td>
        <td>${p.page_count || 1} pages</td>
        <td>${statusBadge}</td>
        <td>${dateStr}</td>
        <td>
          <div style="display:flex; gap:6px; flex-wrap:nowrap;">
            <a href="/view/${encodeURIComponent(p.id)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm" title="Open Standalone Public FlipView Reader" style="background:var(--primary); color:#070a12; font-weight:700;">📖 Reader</a>
            <a href="${flipbookUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" title="Open 3D Flipbook Viewer on Blogger">🌐 Blogger</a>
            <a href="${pdfUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" title="View / Stream Raw PDF">📄 PDF</a>
            <button onclick="deletePublication('${p.id}')" class="btn btn-secondary btn-sm text-danger" title="Permanently delete from R2 and Database">🗑️ Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function filterTable(searchTerm, category) {
  let filtered = allPublications;
  if (category && category !== 'all') {
    filtered = filtered.filter(p => (p.category || '').toLowerCase() === category.toLowerCase());
  }
  if (searchTerm && searchTerm.trim()) {
    const term = searchTerm.toLowerCase();
    filtered = filtered.filter(p => 
      (p.title || '').toLowerCase().includes(term) || 
      (p.id || '').toLowerCase().includes(term) ||
      (p.category || '').toLowerCase().includes(term)
    );
  }
  renderTable(filtered);
}

// Dropzone setup
function initDropzone() {
  const dropzone = document.getElementById('adminDropzone');
  const fileInput = document.getElementById('adminPdfInput');
  if (!dropzone || !fileInput) return;

  dropzone.onclick = () => fileInput.click();

  dropzone.ondragover = (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  };
  dropzone.ondragleave = () => dropzone.classList.remove('dragover');
  dropzone.ondrop = (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  fileInput.onchange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  };
}

async function handleFileSelected(file) {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    alert('Please select a valid PDF file.');
    return;
  }
  currentFile = file;
  currentFileCoverBase64 = null;
  const dropText = document.getElementById('dropText');
  if (dropText) {
    dropText.innerHTML = `Selected: <strong>${escapeHtml(file.name)}</strong> (${(file.size / (1024 * 1024)).toFixed(2)} MB) • <em>Extracting 1st page cover...</em>`;
  }
  const titleInput = document.getElementById('adminTitle');
  if (titleInput && !titleInput.value) {
    titleInput.value = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ');
  }

  // Extract real first page cover as high-res JPEG image
  try {
    if (window.pdfjsLib) {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      currentFileCoverBase64 = canvas.toDataURL('image/jpeg', 0.88);
      if (dropText) {
        dropText.innerHTML = `Selected: <strong>${escapeHtml(file.name)}</strong> (${(file.size / (1024 * 1024)).toFixed(2)} MB) <span style="color:#10b981;">✓ 1st Page Cover Captured</span>`;
      }
    }
  } catch (err) {
    console.warn('First page cover preview extraction notice:', err);
  }
}

// Upload & Stream Handling
async function handleUploadSubmit(e) {
  e.preventDefault();
  if (!currentFile) {
    alert('Please select a PDF file.');
    return;
  }

  const titleInput = document.getElementById('adminTitle');
  const catInput = document.getElementById('adminCategory');
  const authorInput = document.getElementById('adminAuthor');
  const descInput = document.getElementById('adminDescription');

  const title = titleInput ? titleInput.value.trim() : currentFile.name;
  const category = catInput ? catInput.value : 'Magazine';
  const author = authorInput ? authorInput.value.trim() : '';
  const description = descInput ? descInput.value.trim() : '';

  const progressBox = document.getElementById('adminProgressBox');
  const progressFill = document.getElementById('adminProgressFill');
  const progressStatus = document.getElementById('adminProgressStatus');
  const progressPct = document.getElementById('adminProgressPct');
  const progressDesc = document.getElementById('adminProgressDesc');
  const submitBtn = document.getElementById('adminSubmitBtn');

  if (progressBox) progressBox.style.display = 'block';
  if (submitBtn) submitBtn.disabled = true;

  function updateProgress(pct, status, desc) {
    if (progressFill) progressFill.style.width = pct + '%';
    if (progressPct) progressPct.textContent = pct + '%';
    if (progressStatus) progressStatus.textContent = status;
    if (progressDesc) progressDesc.textContent = desc;
  }

  const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB
  const totalSize = currentFile.size;
  const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);
  const uploadId = 'up_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  const cleanFileName = currentFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const totalMb = (totalSize / (1024 * 1024)).toFixed(1);

  try {
    updateProgress(5, 'Uploading publication...', `Transferring 0.0 MB of ${totalMb} MB...`);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(totalSize, start + CHUNK_SIZE);
      const chunk = currentFile.slice(start, end);

      const formData = new FormData();
      formData.append('chunk', chunk, cleanFileName);
      formData.append('uploadId', uploadId);
      formData.append('chunkIndex', i);
      formData.append('totalChunks', totalChunks);
      formData.append('filename', cleanFileName);

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload-chunk', true);
        xhr.upload.onprogress = (pe) => {
          if (pe.lengthComputable) {
            const chunkFraction = pe.loaded / pe.total;
            const overallPct = Math.round(5 + ((i + chunkFraction) / totalChunks) * 75);
            const transferredMb = ((start + pe.loaded) / (1024 * 1024)).toFixed(1);
            updateProgress(overallPct, 'Uploading publication...', `${transferredMb} MB of ${totalMb} MB uploaded (${overallPct}%)`);
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload transfer error on part ${i + 1}`));
        };
        xhr.onerror = () => reject(new Error('Connection lost during upload. Please check your internet.'));
        xhr.send(formData);
      });
    }

    updateProgress(85, 'Finalizing Publication in Cloudflare R2...', 'Saving 1st page cover image and setting up 3D viewer...');

    const finalRes = await fetch('/api/finalize-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uploadId,
        filename: cleanFileName,
        title,
        category,
        author,
        description,
        coverBase64: currentFileCoverBase64
      })
    });

    if (!finalRes.ok) {
      const err = await finalRes.json().catch(() => ({}));
      throw new Error(err.error?.message || `Finalization failed: HTTP ${finalRes.status}`);
    }

    const { data } = await finalRes.json();
    updateProgress(100, 'Your Flipbook is Live! 🎉', 'Publication saved to Cloudflare R2 with 1st page cover.');

    setTimeout(() => {
      alert(`Publication "${data.title || title}" uploaded successfully!`);
      currentFile = null;
      currentFileCoverBase64 = null;
      const form = document.getElementById('adminUploadForm');
      if (form) form.reset();
      const dropText = document.getElementById('dropText');
      if (dropText) dropText.innerHTML = 'Drag &amp; drop your PDF here or <span>browse files</span>';
      if (progressBox) progressBox.style.display = 'none';
      if (submitBtn) submitBtn.disabled = false;
      loadStats();
      loadPublications();
      switchTab('publications');
    }, 1000);

  } catch (err) {
    alert('Upload error: ' + err.message);
    if (progressBox) progressBox.style.display = 'none';
    if (submitBtn) submitBtn.disabled = false;
  }
}

// Delete Publication
async function deletePublication(id) {
  const pub = allPublications.find(p => p.id === id);
  const title = pub ? pub.title : id;
  if (!confirm(`Are you sure you want to permanently delete "${title}"?\n\nThis will remove the PDF and covers from Cloudflare R2 and delete it from your database library.`)) return;

  try {
    const res = await fetch(`/api/publications/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'x-admin-key': getAdminKey() }
    });
    const json = await res.json();
    if (json.success) {
      alert(`Publication "${title}" deleted successfully.`);
      loadStats();
      loadPublications();
    } else {
      alert('Delete failed: ' + (json.error?.message || 'Unknown error'));
    }
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// Migration Runner
async function runMigration(dryRun) {
  const repoInput = document.getElementById('migRepo');
  const tokenInput = document.getElementById('migToken');
  const repo = repoInput ? repoInput.value.trim() : '';
  const token = tokenInput ? tokenInput.value.trim() : '';
  const terminal = document.getElementById('migTerminal');
  const log = document.getElementById('migLog');

  if (terminal) terminal.style.display = 'block';
  if (log) log.textContent = `[${new Date().toLocaleTimeString()}] Starting ${dryRun ? 'DRY RUN' : 'FULL'} migration for ${repo}...\n`;

  try {
    const res = await fetch('/api/admin/migrate-github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': getAdminKey()
      },
      body: JSON.stringify({ repo, token, dryRun })
    });

    const json = await res.json();
    if (json.success) {
      if (log) {
        log.textContent += `\n[${new Date().toLocaleTimeString()}] Migration Complete!\n`;
        log.textContent += `Total PDFs Found: ${json.data.totalFound}\n`;
        log.textContent += `Migrated: ${json.data.migrated.length}\n`;
        log.textContent += `Skipped: ${json.data.skipped.length}\n`;
        log.textContent += `Errors: ${json.data.errors.length}\n\n`;
        log.textContent += JSON.stringify(json.data, null, 2);
      }
      loadStats();
      loadPublications();
    } else {
      if (log) log.textContent += `\n[ERROR] Migration failed: ${json.error?.message}\n`;
    }
  } catch (err) {
    if (log) log.textContent += `\n[FATAL] ${err.message}\n`;
  }
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}
