/**
 * ==========================================================================
 * FLIPVIEW MASTER ADMIN STUDIO JAVASCRIPT ENGINE
 * FULL MULTI-TENANT USER MANAGEMENT, PUBLICATIONS CONTROL & METRICS
 * SECURE AUTHENTICATION GATEWAY
 * ==========================================================================
 */

(function () {
  'use strict';

  // --- State Variables ---
  let currentUser = null;
  let allUsers = [];
  let allPublications = [];
  let currentFile = null;
  let currentFileCoverBase64 = null;
  let toastTimeout = null;

  // --- Token Management ---
  function getAdminToken() {
    return sessionStorage.getItem('flipview_admin_token') || localStorage.getItem('flipview_admin_token') || '';
  }

  function setAdminToken(token) {
    sessionStorage.setItem('flipview_admin_token', token);
    localStorage.setItem('flipview_admin_token', token);
  }

  function clearAdminToken() {
    sessionStorage.removeItem('flipview_admin_token');
    localStorage.removeItem('flipview_admin_token');
  }

  // --- API Helper with Automatic Authorization Header ---
  async function apiFetch(url, options = {}) {
    const token = getAdminToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers || {})
    };

    const res = await fetch(url, { ...options, headers });
    if (res.status === 401 || res.status === 403) {
      if (!url.includes('/api/admin/login')) {
        showLoginOverlay('Session expired or unauthorized. Please sign in again.');
      }
    }
    return res;
  }

  // --- Toast Notification ---
  function showToast(message) {
    const toast = document.getElementById('adminToast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2800);
  }

  // --- Escape HTML for Safe Rendering ---
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // --- UI Visibility Toggles ---
  function showLoginOverlay(errorMsg = '') {
    const overlay = document.getElementById('adminLoginOverlay');
    const layout = document.getElementById('appLayout');
    const errBox = document.getElementById('loginError');

    if (overlay) overlay.style.display = 'flex';
    if (layout) layout.style.display = 'none';

    if (errBox) {
      if (errorMsg) {
        errBox.textContent = errorMsg;
        errBox.style.display = 'block';
      } else {
        errBox.style.display = 'none';
      }
    }
  }

  function showAppLayout(user) {
    currentUser = user;
    const overlay = document.getElementById('adminLoginOverlay');
    const layout = document.getElementById('appLayout');
    const adminEmailEl = document.getElementById('sidebarAdminEmail');
    const settingsAdminEmailEl = document.getElementById('settingsAdminEmail');

    if (overlay) overlay.style.display = 'none';
    if (layout) layout.style.display = 'flex';
    if (adminEmailEl && user) {
      adminEmailEl.textContent = user.email || 'Admin';
    }
    if (settingsAdminEmailEl && user) {
      settingsAdminEmailEl.textContent = user.email || 'Admin';
    }

    loadStats();
    loadUsers();
    loadPublications();
  }

  // --- Authentication Flow ---
  async function checkAuthSession() {
    const token = getAdminToken();
    if (!token) {
      showLoginOverlay();
      return;
    }

    try {
      const res = await apiFetch('/api/admin/me');
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data && json.data.user) {
          showAppLayout(json.data.user);
          return;
        }
      }
      showLoginOverlay();
    } catch (e) {
      showLoginOverlay();
    }
  }

  async function handleAdminLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errBox = document.getElementById('loginError');
    const submitBtn = document.getElementById('loginSubmitBtn');

    if (!email || !password) {
      errBox.textContent = 'Please enter both email and password.';
      errBox.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Verifying credentials...</span>';
    errBox.style.display = 'none';

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const json = await res.json();

      if (json.success && json.data && json.data.accessToken) {
        setAdminToken(json.data.accessToken);
        showToast(`Welcome back, Master Admin!`);
        showAppLayout(json.data.user);
      } else {
        errBox.textContent = json.error?.message || 'Invalid email or password.';
        errBox.style.display = 'block';
      }
    } catch (err) {
      errBox.textContent = 'Network error connecting to API server. Please check your connection.';
      errBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Sign In to Admin Panel</span>';
    }
  }

  function handleLogout() {
    clearAdminToken();
    currentUser = null;
    const pwdInput = document.getElementById('loginPassword');
    if (pwdInput) pwdInput.value = '';
    showToast('You have been logged out.');
    showLoginOverlay();
  }

  // --- Tab Navigation ---
  function initTabs() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.onclick = () => {
        const tab = btn.getAttribute('data-tab');
        switchTab(tab);
      };
    });
  }

  window.switchTab = function (tabId) {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === tabId));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === `tab-${tabId}`));

    const titles = {
      overview: 'Overview & Statistics',
      users: 'Users Management',
      publications: 'Publications Library',
      upload: 'Publish Digital PDF',
      migration: 'GitHub to Cloudflare R2 Migration',
      settings: 'System & API Settings'
    };
    const titleEl = document.getElementById('pageTitle');
    if (titleEl) titleEl.textContent = titles[tabId] || 'Dashboard';

    if (tabId === 'users') loadUsers();
    if (tabId === 'publications') loadPublications();
    if (tabId === 'overview') loadStats();
  };

  // --- Overview & Stats ---
  async function loadStats() {
    try {
      const res = await apiFetch('/api/admin/stats');
      if (!res.ok) return;
      const { data } = await res.json();

      const totalPubsEl = document.getElementById('statTotalPubs');
      const totalUsersEl = document.getElementById('statTotalUsers');
      const totalViewsEl = document.getElementById('statTotalViews');
      const storEl = document.getElementById('statStorage');

      if (totalPubsEl) totalPubsEl.textContent = data.totalPublications || 0;
      if (totalUsersEl) totalUsersEl.textContent = data.totalUsers || 0;
      if (totalViewsEl) totalViewsEl.textContent = Number(data.totalViews || 0).toLocaleString();
      if (storEl) storEl.textContent = `${data.totalStorageMb || 0} MB`;

      // Plan breakdown
      const totalUsersCount = Math.max(1, data.totalUsers || 1);
      const freeCount = data.planBreakdown?.free || 0;
      const proCount = data.planBreakdown?.pro || 0;
      const busCount = data.planBreakdown?.business || 0;

      const planCountFree = document.getElementById('planCountFree');
      const planCountPro = document.getElementById('planCountPro');
      const planCountBusiness = document.getElementById('planCountBusiness');
      const planBarFree = document.getElementById('planBarFree');
      const planBarPro = document.getElementById('planBarPro');
      const planBarBusiness = document.getElementById('planBarBusiness');

      if (planCountFree) planCountFree.textContent = `${freeCount} users (${Math.round((freeCount / totalUsersCount) * 100)}%)`;
      if (planCountPro) planCountPro.textContent = `${proCount} users (${Math.round((proCount / totalUsersCount) * 100)}%)`;
      if (planCountBusiness) planCountBusiness.textContent = `${busCount} users (${Math.round((busCount / totalUsersCount) * 100)}%)`;

      if (planBarFree) planBarFree.style.width = `${Math.round((freeCount / totalUsersCount) * 100)}%`;
      if (planBarPro) planBarPro.style.width = `${Math.round((proCount / totalUsersCount) * 100)}%`;
      if (planBarBusiness) planBarBusiness.style.width = `${Math.round((busCount / totalUsersCount) * 100)}%`;

    } catch (e) {}
  }

  // --- Users Management ---
  async function loadUsers() {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    try {
      const res = await apiFetch('/api/admin/users');
      if (!res.ok) throw new Error('Failed to fetch users.');
      const json = await res.json();
      allUsers = json.data || [];
      renderUsersTable(allUsers);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-danger text-center" style="padding:24px;">Error loading users: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    if (!users || users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted" style="padding:32px;">No user accounts found.</td></tr>';
      return;
    }

    tbody.innerHTML = users.map(u => {
      const initial = (u.full_name || u.email || 'U').charAt(0).toUpperCase();
      const roleBadge = u.role === 'ADMIN'
        ? '<span class="badge badge-purple">👑 ADMIN</span>'
        : '<span class="badge" style="background:rgba(255,255,255,0.06);">USER</span>';

      const planTier = (u.plan_id || 'free').toLowerCase();
      let planBadge = '<span class="badge" style="background:rgba(148,163,184,0.15); color:#94a3b8;">FREE</span>';
      if (planTier === 'pro') planBadge = '<span class="badge badge-primary">PRO</span>';
      if (planTier === 'business') planBadge = '<span class="badge badge-warning">BUSINESS</span>';

      const statusBadge = (u.status || 'ACTIVE') === 'SUSPENDED'
        ? '<span class="badge badge-danger">SUSPENDED</span>'
        : '<span class="badge badge-success">ACTIVE</span>';

      const joined = u.created_at ? new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-';
      const storageStr = formatBytes(u.storage_used_bytes || 0);

      const isMasterAdmin = u.email === 'technews1562@gmail.com';

      return `
        <tr>
          <td>
            <div class="user-cell">
              <div class="user-avatar">${initial}</div>
              <div style="min-width:0;">
                <strong style="color:var(--text-main); font-size:0.92rem;">${escapeHtml(u.full_name || 'No Name')}</strong>
                <div style="color:var(--text-muted); font-size:0.8rem;">${escapeHtml(u.email)}</div>
              </div>
            </div>
          </td>
          <td>${roleBadge}</td>
          <td>
            <select class="form-select form-select-sm" style="padding:4px 8px; font-size:0.78rem; width:110px;" onchange="changeUserPlan('${u.id}', this.value)" ${isMasterAdmin ? 'disabled' : ''}>
              <option value="free" ${planTier === 'free' ? 'selected' : ''}>Free</option>
              <option value="pro" ${planTier === 'pro' ? 'selected' : ''}>Pro</option>
              <option value="business" ${planTier === 'business' ? 'selected' : ''}>Business</option>
            </select>
          </td>
          <td>${statusBadge}</td>
          <td><strong>${u.publication_count || 0}</strong> pubs</td>
          <td>${storageStr}</td>
          <td>${joined}</td>
          <td>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-secondary btn-sm" onclick="openEditUserModal('${u.id}')" title="Edit account details">✏️ Edit</button>
              <button class="btn btn-secondary btn-sm" onclick="openResetPwdModal('${u.id}', '${escapeHtml(u.email)}')" title="Set new password">🔑 Reset</button>
              ${!isMasterAdmin ? `<button class="btn btn-secondary btn-sm text-danger" onclick="deleteUser('${u.id}', '${escapeHtml(u.email)}')" title="Delete user">🗑️ Delete</button>` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function filterUsers() {
    const search = (document.getElementById('searchUsers')?.value || '').toLowerCase().trim();
    const plan = document.getElementById('filterUserPlan')?.value || 'all';
    const status = document.getElementById('filterUserStatus')?.value || 'all';

    let filtered = allUsers;
    if (plan !== 'all') {
      filtered = filtered.filter(u => (u.plan_id || 'free').toLowerCase() === plan.toLowerCase());
    }
    if (status !== 'all') {
      filtered = filtered.filter(u => (u.status || 'ACTIVE').toUpperCase() === status.toUpperCase());
    }
    if (search) {
      filtered = filtered.filter(u =>
        (u.email || '').toLowerCase().includes(search) ||
        (u.full_name || '').toLowerCase().includes(search) ||
        (u.id || '').toLowerCase().includes(search)
      );
    }
    renderUsersTable(filtered);
  }

  window.changeUserPlan = async function (userId, newPlan) {
    try {
      const res = await apiFetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ plan_id: newPlan })
      });
      const json = await res.json();
      if (json.success) {
        showToast(`User plan updated to ${newPlan.toUpperCase()}!`);
        loadUsers();
        loadStats();
      } else {
        alert(json.error?.message || 'Failed to update plan.');
      }
    } catch (err) {
      alert('Error updating user plan.');
    }
  };

  window.openEditUserModal = function (userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;

    document.getElementById('editUserId').value = user.id;
    document.getElementById('editUserEmail').value = user.email;
    document.getElementById('editUserName').value = user.full_name || '';
    document.getElementById('editUserPlan').value = (user.plan_id || 'free').toLowerCase();
    document.getElementById('editUserRole').value = user.role || 'USER';
    document.getElementById('editUserStatus').value = user.status || 'ACTIVE';

    document.getElementById('editUserModal').classList.add('open');
  };

  window.openResetPwdModal = function (userId, email) {
    document.getElementById('resetPwdUserId').value = userId;
    document.getElementById('resetPwdUserEmail').textContent = email;
    document.getElementById('resetNewPwd').value = '';
    document.getElementById('resetPwdModal').classList.add('open');
  };

  window.deleteUser = async function (userId, email) {
    if (!confirm(`Are you sure you want to permanently delete user ${email} and all their uploaded flipbooks? This cannot be undone.`)) {
      return;
    }

    try {
      const res = await apiFetch(`/api/admin/users/${userId}`, {
        method: 'DELETE'
      });
      const json = await res.json();
      if (json.success) {
        showToast(`User ${email} deleted successfully.`);
        loadUsers();
        loadPublications();
        loadStats();
      } else {
        alert(json.error?.message || 'Failed to delete user.');
      }
    } catch (e) {
      alert('Error deleting user account.');
    }
  };

  // --- Publications Library ---
  async function loadPublications() {
    const tbody = document.getElementById('publicationsTableBody');
    if (!tbody) return;

    try {
      const res = await apiFetch('/api/admin/publications');
      if (!res.ok) throw new Error('Failed to fetch publications from API');
      const json = await res.json();
      allPublications = json.data || [];

      // Populate category filter
      const catSelect = document.getElementById('filterCategory');
      if (catSelect) {
        const cats = [...new Set(allPublications.map(p => p.category).filter(Boolean))];
        catSelect.innerHTML = '<option value="all">All Categories</option>' + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
      }

      renderPublicationsTable(allPublications);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-danger text-center" style="padding:24px;">Error loading publications: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderPublicationsTable(pubs) {
    const tbody = document.getElementById('publicationsTableBody');
    if (!tbody) return;

    if (!pubs || pubs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted" style="padding:32px;">No publications found. Upload your first PDF!</td></tr>';
      return;
    }

    tbody.innerHTML = pubs.map(p => {
      let visBadge = '<span class="badge badge-success">PUBLIC</span>';
      if (p.visibility === 'PASSWORD_PROTECTED') visBadge = '<span class="badge badge-warning">🔒 PROTECTED</span>';
      if (p.visibility === 'PRIVATE') visBadge = '<span class="badge badge-danger">PRIVATE</span>';
      if (p.visibility === 'UNLISTED') visBadge = '<span class="badge badge-primary">UNLISTED</span>';

      const dateStr = p.created_at ? new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent';
      const coverSrc = p.cover_url || `/api/public/${encodeURIComponent(p.id)}/cover`;
      const flipbookUrl = `https://flipviewpdf.blogspot.com/#doc=${encodeURIComponent(p.id)}`;
      const pdfUrl = `/api/public/${encodeURIComponent(p.id)}/pdf?download=1`;
      const readerUrl = `/view/${encodeURIComponent(p.id)}`;

      return `
        <tr>
          <td>
            <img src="${coverSrc}" class="pub-thumb" alt="Cover" onerror="this.src='/api/public/${encodeURIComponent(p.id)}/cover'" />
          </td>
          <td class="pub-title-cell">
            <strong>${escapeHtml(p.title || 'Untitled')}</strong>
            <div class="pub-id-tag">${escapeHtml(p.id)}</div>
          </td>
          <td>
            <div style="font-size:0.84rem; font-weight:600; color:var(--text-main);">${escapeHtml(p.user_email || 'System Admin')}</div>
            <span class="badge" style="font-size:0.65rem; background:rgba(255,255,255,0.06);">${escapeHtml(p.user_plan || 'business').toUpperCase()}</span>
          </td>
          <td><span class="badge" style="background:rgba(255,255,255,0.06);">${escapeHtml(p.category || 'Magazine')}</span></td>
          <td>${p.page_count || 1} pages</td>
          <td>${visBadge}</td>
          <td><strong>${p.view_count || 0}</strong> views</td>
          <td>${dateStr}</td>
          <td>
            <div style="display:flex; gap:6px; flex-wrap:nowrap;">
              <a href="${readerUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm" title="Open Standalone Public FlipView Reader" style="background:var(--primary); color:#070a12; font-weight:700;">📖 Reader</a>
              <a href="${flipbookUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" title="Open 3D Flipbook Viewer on Blogger">🌐 Blogger</a>
              <a href="${pdfUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" title="Download Original PDF">📄 PDF</a>
              <button onclick="openEditPubModal('${p.id}')" class="btn btn-secondary btn-sm" title="Edit settings & password">⚙️</button>
              <button onclick="deletePublication('${p.id}')" class="btn btn-secondary btn-sm text-danger" title="Permanently delete from R2 and Database">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function filterPublications() {
    const search = (document.getElementById('searchPubs')?.value || '').toLowerCase().trim();
    const category = document.getElementById('filterCategory')?.value || 'all';
    const visibility = document.getElementById('filterVisibility')?.value || 'all';

    let filtered = allPublications;
    if (category !== 'all') {
      filtered = filtered.filter(p => (p.category || '').toLowerCase() === category.toLowerCase());
    }
    if (visibility !== 'all') {
      filtered = filtered.filter(p => (p.visibility || 'PUBLIC').toUpperCase() === visibility.toUpperCase());
    }
    if (search) {
      filtered = filtered.filter(p =>
        (p.title || '').toLowerCase().includes(search) ||
        (p.id || '').toLowerCase().includes(search) ||
        (p.user_email || '').toLowerCase().includes(search) ||
        (p.category || '').toLowerCase().includes(search)
      );
    }
    renderPublicationsTable(filtered);
  }

  window.openEditPubModal = function (pubId) {
    const pub = allPublications.find(p => p.id === pubId);
    if (!pub) return;

    document.getElementById('editPubId').value = pub.id;
    document.getElementById('editPubTitle').value = pub.title || '';
    document.getElementById('editPubCategory').value = pub.category || 'Magazine';
    document.getElementById('editPubVisibility').value = pub.visibility || 'PUBLIC';
    document.getElementById('editPubAuthor').value = pub.author || '';
    document.getElementById('editPubDesc').value = pub.description || '';

    const pwdGroup = document.getElementById('editPubPasswordGroup');
    if (pwdGroup) {
      pwdGroup.style.display = pub.visibility === 'PASSWORD_PROTECTED' ? 'block' : 'none';
    }

    document.getElementById('editPubModal').classList.add('open');
  };

  window.deletePublication = async function (id) {
    if (!confirm(`Are you sure you want to permanently delete publication ${id} from Cloudflare R2 and database?`)) {
      return;
    }

    try {
      const res = await apiFetch(`/api/admin/publications/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        showToast(`Publication ${id} deleted.`);
        loadPublications();
        loadStats();
      } else {
        alert(json.error?.message || 'Failed to delete publication.');
      }
    } catch (e) {
      alert('Error deleting publication.');
    }
  };

  window.closeModals = function () {
    document.querySelectorAll('.admin-modal-overlay').forEach(m => m.classList.remove('open'));
  };

  // --- Dropzone & Fast PDF Upload Engine ---
  function initDropzone() {
    const dropzone = document.getElementById('adminDropzone');
    const input = document.getElementById('adminPdfInput');
    if (!dropzone || !input) return;

    dropzone.onclick = () => input.click();
    dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add('dragover'); };
    dropzone.ondragleave = () => dropzone.classList.remove('dragover');
    dropzone.ondrop = (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    };
    input.onchange = (e) => {
      if (e.target.files.length) handleFile(e.target.files[0]);
    };
  }

  async function handleFile(file) {
    if (!file || file.type !== 'application/pdf') {
      alert('Please select a valid PDF file.');
      return;
    }
    currentFile = file;
    const dropText = document.getElementById('dropText');
    if (dropText) {
      dropText.innerHTML = `Selected: <strong>${escapeHtml(file.name)}</strong> (${(file.size / (1024 * 1024)).toFixed(1)} MB)`;
    }

    const titleInput = document.getElementById('adminTitle');
    if (titleInput && !titleInput.value) {
      titleInput.value = file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
    }

    // Extract cover with PDF.js
    if (window.pdfjsLib) {
      try {
        const arrayBuf = await file.slice(0, 1024 * 1024 * 2).arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuf });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 0.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        currentFileCoverBase64 = canvas.toDataURL('image/jpeg', 0.85);
      } catch (e) {
        currentFileCoverBase64 = null;
      }
    }
  }

  async function handleUploadSubmit(e) {
    e.preventDefault();
    if (!currentFile) {
      alert('Please select a PDF file to upload.');
      return;
    }

    const title = document.getElementById('adminTitle').value.trim();
    const category = document.getElementById('adminCategory').value;
    const author = document.getElementById('adminAuthor').value.trim();
    const description = document.getElementById('adminDescription').value.trim();

    const progressBox = document.getElementById('adminProgressBox');
    const fill = document.getElementById('adminProgressFill');
    const pct = document.getElementById('adminProgressPct');
    const status = document.getElementById('adminProgressStatus');
    const submitBtn = document.getElementById('adminSubmitBtn');

    if (progressBox) progressBox.style.display = 'block';
    if (submitBtn) submitBtn.disabled = true;

    try {
      const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
      const totalChunks = Math.ceil(currentFile.size / CHUNK_SIZE);

      status.textContent = 'Initializing Cloudflare R2 session...';
      pct.textContent = '5%';
      fill.style.width = '5%';

      const initRes = await apiFetch('/api/uploads/init', {
        method: 'POST',
        body: JSON.stringify({
          filename: currentFile.name,
          fileSize: currentFile.size,
          totalChunks,
          chunkSize: CHUNK_SIZE,
          contentType: 'application/pdf',
          title,
          category,
          author,
          description,
          coverBase64: currentFileCoverBase64
        })
      });

      const initJson = await initRes.json();
      if (!initJson.success) throw new Error(initJson.error?.message || 'Upload initialization failed.');

      const uploadId = initJson.data.uploadId;

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, currentFile.size);
        const chunkBlob = currentFile.slice(start, end);

        const progressPercent = Math.round(10 + (chunkIndex / totalChunks) * 75);
        status.textContent = `Streaming Chunk ${chunkIndex + 1} of ${totalChunks} to R2...`;
        pct.textContent = `${progressPercent}%`;
        fill.style.width = `${progressPercent}%`;

        const chunkRes = await apiFetch('/api/uploads/chunk', {
          method: 'POST',
          headers: {
            'x-upload-id': uploadId,
            'x-chunk-index': String(chunkIndex)
          },
          body: chunkBlob
        });

        const chunkJson = await chunkRes.json();
        if (!chunkJson.success) throw new Error(chunkJson.error?.message || `Chunk ${chunkIndex + 1} failed.`);
      }

      status.textContent = 'Finalizing publication in Cloudflare R2...';
      pct.textContent = '90%';
      fill.style.width = '90%';

      const completeRes = await apiFetch('/api/uploads/complete', {
        method: 'POST',
        body: JSON.stringify({ uploadId, coverBase64: currentFileCoverBase64 })
      });

      const completeJson = await completeRes.json();
      if (!completeJson.success) throw new Error(completeJson.error?.message || 'Finalize upload failed.');

      pct.textContent = '100%';
      fill.style.width = '100%';
      status.textContent = '🎉 Successfully published to Cloudflare R2 & Public Reader!';

      showToast('Publication published successfully!');
      setTimeout(() => {
        document.getElementById('adminUploadForm').reset();
        currentFile = null;
        currentFileCoverBase64 = null;
        const dropText = document.getElementById('dropText');
        if (dropText) dropText.innerHTML = 'Drag &amp; drop your PDF here or <span>browse files</span>';
        if (progressBox) progressBox.style.display = 'none';
        switchTab('publications');
      }, 1500);

    } catch (err) {
      alert(`Upload error: ${err.message}`);
      if (status) status.textContent = `Upload failed: ${err.message}`;
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  // --- GitHub Migration Tool ---
  async function runMigration(dryRun = true) {
    const repo = document.getElementById('migRepo').value.trim();
    const token = document.getElementById('migToken').value.trim();
    const terminal = document.getElementById('migTerminal');
    const logEl = document.getElementById('migLog');

    if (terminal) terminal.style.display = 'block';
    if (logEl) logEl.textContent = `[Migration] Starting ${dryRun ? 'DRY RUN' : 'FULL TRANSFER'} for repository: ${repo}...\n`;

    try {
      const res = await apiFetch('/api/admin/migrate-github', {
        method: 'POST',
        body: JSON.stringify({ repo, token, dryRun })
      });

      const json = await res.json();
      if (json.success) {
        logEl.textContent += JSON.stringify(json.data, null, 2);
        showToast(dryRun ? 'Dry run scan complete.' : 'Migration completed!');
        loadStats();
        loadPublications();
      } else {
        logEl.textContent += `[Error] ${json.error?.message || 'Migration failed.'}`;
      }
    } catch (err) {
      logEl.textContent += `[Error] Connection failure: ${err.message}`;
    }
  }

  // --- Attach All Global Listeners ---
  document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initDropzone();
    checkAuthSession();

    // Login Form Submit
    const loginForm = document.getElementById('adminLoginForm');
    if (loginForm) loginForm.onsubmit = handleAdminLogin;

    // Toggle Password Visibility
    const togglePwdBtn = document.getElementById('togglePwdBtn');
    if (togglePwdBtn) {
      togglePwdBtn.onclick = () => {
        const pwdInput = document.getElementById('loginPassword');
        if (pwdInput) {
          pwdInput.type = pwdInput.type === 'password' ? 'text' : 'password';
        }
      };
    }

    // Logout Button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.onclick = handleLogout;

    // Refresh Button
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
      refreshBtn.onclick = () => {
        loadStats();
        loadUsers();
        loadPublications();
        showToast('Refreshed data.');
      };
    }

    // Quick buttons
    const topUploadBtn = document.getElementById('topUploadBtn');
    if (topUploadBtn) topUploadBtn.onclick = () => switchTab('upload');

    const topAddUserBtn = document.getElementById('topAddUserBtn');
    const addNewUserBtn = document.getElementById('addNewUserBtn');
    const openAddUser = () => {
      document.getElementById('addUserForm').reset();
      document.getElementById('addUserModal').classList.add('open');
    };
    if (topAddUserBtn) topAddUserBtn.onclick = openAddUser;
    if (addNewUserBtn) addNewUserBtn.onclick = openAddUser;

    // User Search & Filters
    const searchUsers = document.getElementById('searchUsers');
    if (searchUsers) searchUsers.oninput = filterUsers;

    const filterUserPlan = document.getElementById('filterUserPlan');
    if (filterUserPlan) filterUserPlan.onchange = filterUsers;

    const filterUserStatus = document.getElementById('filterUserStatus');
    if (filterUserStatus) filterUserStatus.onchange = filterUsers;

    // Publication Search & Filters
    const searchPubs = document.getElementById('searchPubs');
    if (searchPubs) searchPubs.oninput = filterPublications;

    const filterCategory = document.getElementById('filterCategory');
    if (filterCategory) filterCategory.onchange = filterPublications;

    const filterVisibility = document.getElementById('filterVisibility');
    if (filterVisibility) filterVisibility.onchange = filterPublications;

    // Visibility Selector Change in Modal
    const editPubVis = document.getElementById('editPubVisibility');
    if (editPubVis) {
      editPubVis.onchange = (e) => {
        const pwdGroup = document.getElementById('editPubPasswordGroup');
        if (pwdGroup) {
          pwdGroup.style.display = e.target.value === 'PASSWORD_PROTECTED' ? 'block' : 'none';
        }
      };
    }

    // Edit User Form Submit
    const editUserForm = document.getElementById('editUserForm');
    if (editUserForm) {
      editUserForm.onsubmit = async (e) => {
        e.preventDefault();
        const userId = document.getElementById('editUserId').value;
        const full_name = document.getElementById('editUserName').value.trim();
        const plan_id = document.getElementById('editUserPlan').value;
        const role = document.getElementById('editUserRole').value;
        const status = document.getElementById('editUserStatus').value;

        try {
          const res = await apiFetch(`/api/admin/users/${userId}`, {
            method: 'PATCH',
            body: JSON.stringify({ full_name, plan_id, role, status })
          });
          const json = await res.json();
          if (json.success) {
            showToast('User account updated!');
            closeModals();
            loadUsers();
            loadStats();
          } else {
            alert(json.error?.message || 'Update failed.');
          }
        } catch (e) {
          alert('Network error updating user.');
        }
      };
    }

    // Reset Password Form Submit
    const resetPwdForm = document.getElementById('resetPwdForm');
    if (resetPwdForm) {
      resetPwdForm.onsubmit = async (e) => {
        e.preventDefault();
        const userId = document.getElementById('resetPwdUserId').value;
        const password = document.getElementById('resetNewPwd').value;

        try {
          const res = await apiFetch(`/api/admin/users/${userId}`, {
            method: 'PATCH',
            body: JSON.stringify({ password })
          });
          const json = await res.json();
          if (json.success) {
            showToast('User password reset successfully!');
            closeModals();
          } else {
            alert(json.error?.message || 'Password reset failed.');
          }
        } catch (e) {
          alert('Network error resetting password.');
        }
      };
    }

    // Add User Form Submit
    const addUserForm = document.getElementById('addUserForm');
    if (addUserForm) {
      addUserForm.onsubmit = async (e) => {
        e.preventDefault();
        const email = document.getElementById('addEmail').value.trim();
        const full_name = document.getElementById('addName').value.trim();
        const password = document.getElementById('addPassword').value;
        const plan_id = document.getElementById('addPlan').value;
        const role = document.getElementById('addRole').value;

        try {
          const res = await apiFetch('/api/admin/users', {
            method: 'POST',
            body: JSON.stringify({ email, full_name, password, plan_id, role })
          });
          const json = await res.json();
          if (json.success) {
            showToast(`User ${email} created successfully!`);
            closeModals();
            loadUsers();
            loadStats();
          } else {
            alert(json.error?.message || 'Failed to create user.');
          }
        } catch (e) {
          alert('Network error creating user.');
        }
      };
    }

    // Edit Publication Form Submit
    const editPubForm = document.getElementById('editPubForm');
    if (editPubForm) {
      editPubForm.onsubmit = async (e) => {
        e.preventDefault();
        const pubId = document.getElementById('editPubId').value;
        const title = document.getElementById('editPubTitle').value.trim();
        const category = document.getElementById('editPubCategory').value;
        const visibility = document.getElementById('editPubVisibility').value;
        const password = document.getElementById('editPubPassword').value;
        const author = document.getElementById('editPubAuthor').value.trim();
        const description = document.getElementById('editPubDesc').value.trim();

        try {
          const res = await apiFetch(`/api/admin/publications/${pubId}`, {
            method: 'PATCH',
            body: JSON.stringify({ title, category, visibility, password, author, description })
          });
          const json = await res.json();
          if (json.success) {
            showToast('Publication settings updated!');
            closeModals();
            loadPublications();
          } else {
            alert(json.error?.message || 'Update failed.');
          }
        } catch (e) {
          alert('Network error updating publication.');
        }
      };
    }

    // Upload form
    const uploadForm = document.getElementById('adminUploadForm');
    if (uploadForm) uploadForm.onsubmit = handleUploadSubmit;

    // Migration buttons
    const dryRunBtn = document.getElementById('migDryRunBtn');
    if (dryRunBtn) dryRunBtn.onclick = () => runMigration(true);

    const startMigBtn = document.getElementById('migStartBtn');
    if (startMigBtn) startMigBtn.onclick = () => runMigration(false);
  });

})();
