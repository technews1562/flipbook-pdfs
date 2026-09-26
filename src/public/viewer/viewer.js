/**
 * ==========================================================================
 * FLIPVIEW PDF STANDALONE VIEWER JAVASCRIPT ENGINE
 * HEYZINE-GRADE 3D PHYSICS, LIGHT THEME & AUTHENTIC SOUND SYSTEM
 * COMPLETE MOBILE RESPONSIVE ENGINE & INTERACTIVE ZOOM/PANNING
 * ==========================================================================
 */

(function () {
  'use strict';

  // --- State Variables ---
  let publicationId = '';
  let publicationData = null;
  let viewerToken = '';
  let currentPdfDoc = null;
  let currentActivePageFlip = null;
  let cachedPages = [];
  let currentZoom = 1.0;
  let soundEnabled = localStorage.getItem('fv_sound_enabled') !== 'false';
  let isDarkMode = localStorage.getItem('fv_theme') === 'dark';
  let autoplayTimer = null;
  let isAutoplaying = false;
  let toastTimeout = null;
  let viewEventRecorded = false;
  let lastPageTurnTime = 0;

  // Zoom & Pan State
  let panX = 0;
  let panY = 0;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let lastTapTime = 0;

  // Pinch Zoom State
  let initialPinchDistance = null;
  let initialPinchZoom = 1.0;

  // Touch Swipe Page Turn State
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;

  // --- DOM Elements Cache ---
  const el = {};

  function cacheElements() {
    el.docTitle = document.getElementById('fvDocTitle');
    el.categoryPill = document.getElementById('fvCategoryPill');
    el.brandBadge = document.getElementById('fvBrandBadge');
    el.stage = document.getElementById('fvStage');
    el.viewport = document.getElementById('fvViewport');
    el.bookContainer = document.getElementById('fvBookContainer');
    el.prevArrow = document.getElementById('fvPrevArrow');
    el.nextArrow = document.getElementById('fvNextArrow');
    el.prevBtn = document.getElementById('fvPrevBtn');
    el.nextBtn = document.getElementById('fvNextBtn');
    el.firstBtn = document.getElementById('fvFirstBtn');
    el.lastBtn = document.getElementById('fvLastBtn');
    el.currentPage = document.getElementById('fvCurrentPage');
    el.totalPages = document.getElementById('fvTotalPages');
    el.scrubber = document.getElementById('fvScrubber');
    el.scrubberTooltip = document.getElementById('fvScrubberTooltip');
    el.zoomInBtn = document.getElementById('fvZoomInBtn');
    el.zoomOutBtn = document.getElementById('fvZoomOutBtn');
    el.zoomLevel = document.getElementById('fvZoomLevel');
    el.fullscreenBtn = document.getElementById('fvFullscreenBtn');
    el.autoplayBtn = document.getElementById('fvAutoplayBtn');
    el.soundBtn = document.getElementById('fvSoundBtn');
    el.themeToggleBtn = document.getElementById('fvThemeToggleBtn');
    el.thumbnailsBtn = document.getElementById('fvThumbnailsBtn');
    el.thumbnailsTray = document.getElementById('fvThumbnailsTray');
    el.thumbScroll = document.getElementById('fvThumbScroll');
    el.closeTrayBtn = document.getElementById('fvCloseTrayBtn');
    el.infoBtn = document.getElementById('fvInfoBtn');
    el.infoDrawer = document.getElementById('fvInfoDrawer');
    el.closeDrawerBtn = document.getElementById('fvCloseDrawerBtn');
    el.shareBtn = document.getElementById('fvShareBtn');
    el.shareModal = document.getElementById('fvShareModal');
    el.qrBtn = document.getElementById('fvQrBtn');
    el.qrModal = document.getElementById('fvQrModal');
    el.searchBtn = document.getElementById('fvSearchBtn');
    el.searchModal = document.getElementById('fvSearchModal');
    el.downloadBtn = document.getElementById('fvDownloadBtn');
    el.mobileMenuBtn = document.getElementById('fvMobileMenuBtn');
    el.mobileSheetModal = document.getElementById('fvMobileSheetModal');
    el.loader = document.getElementById('fvLoader');
    el.loaderTitle = document.getElementById('fvLoaderTitle');
    el.loaderDesc = document.getElementById('fvLoaderDesc');
    el.loaderFill = document.getElementById('fvLoaderFill');
    el.errorOverlay = document.getElementById('fvErrorOverlay');
    el.errorTitle = document.getElementById('fvErrorTitle');
    el.errorDesc = document.getElementById('fvErrorDesc');
    el.errorIcon = document.getElementById('fvErrorIcon');
    el.passwordPrompt = document.getElementById('fvPasswordPrompt');
    el.passwordInput = document.getElementById('fvPasswordInput');
    el.passwordBtn = document.getElementById('fvPasswordBtn');
    el.passwordError = document.getElementById('fvPasswordError');
  }

  // --- Initialize Theme ---
  function applyTheme(dark) {
    isDarkMode = dark;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('fv_theme', dark ? 'dark' : 'light');
    const sun = document.getElementById('fvThemeIconSun');
    const moon = document.getElementById('fvThemeIconMoon');
    if (sun && moon) {
      sun.style.display = dark ? 'none' : 'block';
      moon.style.display = dark ? 'block' : 'none';
    }
    const mobileThemeLabel = document.getElementById('fvMobileThemeLabel');
    if (mobileThemeLabel) {
      mobileThemeLabel.textContent = dark ? 'Theme: Dark' : 'Theme: Light';
    }
  }

  // --- Heyzine-Grade Paper Flip Sound Engine ---
  let audioContext = null;

  function initAudio() {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        audioContext = new AudioCtx();
      }
    }
  }

  // Synthesis of Realistic Crisp Page Turn Sound (Triple-Layer Physics Simulation)
  function playPaperSound() {
    if (!soundEnabled) return;
    const now = Date.now();
    if (now - lastPageTurnTime < 180) return; // Debounce rapid triggers
    lastPageTurnTime = now;

    try {
      initAudio();
      if (!audioContext) return;
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }

      const t0 = audioContext.currentTime;
      const sampleRate = audioContext.sampleRate;

      // Layer 1: Natural Paper Friction / White-Pink Noise Burst
      const duration = 0.18; // 180ms
      const bufferSize = Math.floor(sampleRate * duration);
      const noiseBuffer = audioContext.createBuffer(1, bufferSize, sampleRate);
      const output = noiseBuffer.getChannelData(0);

      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        lastOut = (lastOut * 0.90) + (white * 0.10);
        const env = Math.sin((i / bufferSize) * Math.PI) * Math.exp(-i / (bufferSize * 0.45));
        output[i] = (lastOut * 0.65 + white * 0.35) * env;
      }

      const noiseSource = audioContext.createBufferSource();
      noiseSource.buffer = noiseBuffer;

      // Sweeping Bandpass Filter (Simulates air glide and paper curve)
      const filter = audioContext.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(3200, t0);
      filter.frequency.exponentialRampToValueAtTime(800, t0 + duration);
      filter.Q.setValueAtTime(1.9, t0);

      // Amplitude Envelope
      const gainNode = audioContext.createGain();
      gainNode.gain.setValueAtTime(0.001, t0);
      gainNode.gain.linearRampToValueAtTime(0.24, t0 + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0005, t0 + duration);

      noiseSource.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(audioContext.destination);
      noiseSource.start(t0);

      // Layer 2: High-Frequency Snap / Edge Flick
      const snapDuration = 0.05;
      const snapSize = Math.floor(sampleRate * snapDuration);
      const snapBuffer = audioContext.createBuffer(1, snapSize, sampleRate);
      const snapData = snapBuffer.getChannelData(0);
      for (let j = 0; j < snapSize; j++) {
        snapData[j] = (Math.random() * 2 - 1) * Math.exp(-j / (snapSize * 0.22));
      }
      const snapSource = audioContext.createBufferSource();
      snapSource.buffer = snapBuffer;

      const snapFilter = audioContext.createBiquadFilter();
      snapFilter.type = 'highpass';
      snapFilter.frequency.setValueAtTime(3800, t0);

      const snapGain = audioContext.createGain();
      snapGain.gain.setValueAtTime(0.12, t0);
      snapGain.gain.exponentialRampToValueAtTime(0.001, t0 + snapDuration);

      snapSource.connect(snapFilter);
      snapFilter.connect(snapGain);
      snapGain.connect(audioContext.destination);
      snapSource.start(t0 + 0.012);

    } catch (e) {
      // Audio autoplay restrictions or unsupported
    }
  }

  function updateSoundUI() {
    const iconOn = document.getElementById('fvSoundIconOn');
    const iconOff = document.getElementById('fvSoundIconOff');
    if (iconOn && iconOff) {
      iconOn.style.display = soundEnabled ? 'block' : 'none';
      iconOff.style.display = soundEnabled ? 'none' : 'block';
    }
    const mobileSoundLabel = document.getElementById('fvMobileSoundLabel');
    if (mobileSoundLabel) {
      mobileSoundLabel.textContent = soundEnabled ? 'Sound: On' : 'Sound: Off';
    }
  }

  // --- Helper: Script Loader ---
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.getAttribute('data-loaded') === 'true') return resolve();
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', (e) => reject(e));
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => { s.setAttribute('data-loaded', 'true'); resolve(); };
      s.onerror = (e) => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  // --- Helper: Extract Publication ID from URL ---
  function getPublicationIdFromUrl() {
    const pathname = window.location.pathname;
    const viewMatch = pathname.match(/\/view\/([^/?#]+)/i);
    if (viewMatch && viewMatch[1]) {
      return viewMatch[1];
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get('id')) return params.get('id');
    if (params.get('doc')) return params.get('doc');

    const hash = window.location.hash;
    const hashDoc = hash.match(/#(?:doc=)?([^&]+)/);
    if (hashDoc && hashDoc[1]) {
      return hashDoc[1];
    }

    return null;
  }

  // --- Toast Notification ---
  function showToast(message) {
    const toast = document.getElementById('fvToast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  }

  // --- Analytics Dispatcher ---
  function sendAnalytics(eventType, pageNumber = null) {
    if (!publicationId) return;
    try {
      fetch('/api/analytics/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publication_id: publicationId,
          event_type: eventType,
          page_number: pageNumber,
          user_agent: navigator.userAgent,
          screen_res: `${window.screen.width}x${window.screen.height}`,
          referrer: document.referrer || 'direct'
        })
      }).catch(() => {});
    } catch (e) {}
  }

  // --- Show/Hide Overlays ---
  function hideOverlays() {
    if (el.loader) el.loader.style.display = 'none';
    if (el.errorOverlay) el.errorOverlay.style.display = 'none';
    if (el.passwordPrompt) el.passwordPrompt.style.display = 'none';
  }

  function showError(title, desc, icon = '⚠️') {
    hideOverlays();
    if (el.errorOverlay) {
      el.errorOverlay.style.display = 'flex';
      if (el.errorTitle) el.errorTitle.textContent = title;
      if (el.errorDesc) el.errorDesc.textContent = desc;
      if (el.errorIcon) el.errorIcon.textContent = icon;
    }
  }

  function showPasswordPrompt() {
    hideOverlays();
    if (el.passwordPrompt) {
      el.passwordPrompt.style.display = 'flex';
      if (el.passwordInput) {
        el.passwordInput.value = '';
        el.passwordInput.focus();
      }
      if (el.passwordError) el.passwordError.style.display = 'none';
    }
  }

  async function submitPassword() {
    const password = el.passwordInput ? el.passwordInput.value.trim() : '';
    if (!password) {
      if (el.passwordError) {
        el.passwordError.textContent = 'Please enter the publication password.';
        el.passwordError.style.display = 'block';
      }
      return;
    }

    if (el.passwordBtn) {
      el.passwordBtn.disabled = true;
      el.passwordBtn.textContent = 'Verifying...';
    }

    try {
      const res = await fetch(`/api/public/${publicationId}/verify-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();

      if (data.success && data.data && data.data.viewerToken) {
        viewerToken = data.data.viewerToken;
        sessionStorage.setItem(`fv_token_${publicationId}`, viewerToken);
        hideOverlays();
        loadPdfDocument();
      } else {
        if (el.passwordError) {
          el.passwordError.textContent = data.error?.message || 'Incorrect password. Please try again.';
          el.passwordError.style.display = 'block';
        }
      }
    } catch (err) {
      if (el.passwordError) {
        el.passwordError.textContent = 'Network error verifying password.';
        el.passwordError.style.display = 'block';
      }
    } finally {
      if (el.passwordBtn) {
        el.passwordBtn.disabled = false;
        el.passwordBtn.textContent = 'Unlock & Read Flipbook';
      }
    }
  }

  // --- Load Publication Metadata ---
  async function loadPublication() {
    publicationId = getPublicationIdFromUrl();

    if (!publicationId) {
      showError('Flipbook Not Found', 'Please verify the publication URL or ID in your address bar.', '📖');
      return;
    }

    const savedToken = sessionStorage.getItem(`fv_token_${publicationId}`);
    if (savedToken) viewerToken = savedToken;

    if (el.loader) {
      el.loader.style.display = 'flex';
      if (el.loaderTitle) el.loaderTitle.textContent = 'Connecting to FlipView Cloud...';
      if (el.loaderFill) el.loaderFill.style.width = '20%';
    }

    try {
      const res = await fetch(`/api/public/${publicationId}`);
      const result = await res.json();

      if (!result.success) {
        if (result.error?.code === 'PUBLICATION_PRIVATE') {
          showError('Private Publication', 'This publication has been marked private by its publisher.', '🔒');
        } else {
          showError('Flipbook Not Found', result.error?.message || 'The requested publication could not be found.', '🔍');
        }
        return;
      }

      publicationData = result.data.publication;
      applyPublicationMetadata();

      if (publicationData.requiresPassword && !viewerToken) {
        showPasswordPrompt();
      } else {
        loadPdfDocument();
      }
    } catch (err) {
      showError('Connection Error', 'Unable to reach the FlipView publication servers. Please check your internet connection.', '🌐');
    }
  }

  // --- Apply Metadata to UI ---
  function applyPublicationMetadata() {
    if (!publicationData) return;

    document.title = `${publicationData.title || 'Digital Publication'} — FlipView`;

    if (el.docTitle) el.docTitle.textContent = publicationData.title || 'Digital Publication';
    if (el.categoryPill) {
      el.categoryPill.textContent = publicationData.category || 'Magazine';
      el.categoryPill.style.display = publicationData.category ? 'inline-block' : 'none';
    }

    if (el.brandBadge) {
      el.brandBadge.style.display = publicationData.hasBranding ? 'flex' : 'none';
    }

    if (publicationData.downloadEnabled !== false) {
      if (el.downloadBtn) {
        el.downloadBtn.style.display = 'inline-flex';
        el.downloadBtn.onclick = () => {
          sendAnalytics('DOWNLOAD');
          const tokenParam = viewerToken ? `&token=${encodeURIComponent(viewerToken)}` : '';
          window.open(`/api/public/${publicationId}/pdf?download=1${tokenParam}`, '_blank');
        };
      }
      const mobileDownloadBtn = document.getElementById('fvMobileDownloadBtn');
      if (mobileDownloadBtn) {
        mobileDownloadBtn.style.display = 'flex';
        mobileDownloadBtn.onclick = () => {
          sendAnalytics('DOWNLOAD');
          closeAllModals();
          const tokenParam = viewerToken ? `&token=${encodeURIComponent(viewerToken)}` : '';
          window.open(`/api/public/${publicationId}/pdf?download=1${tokenParam}`, '_blank');
        };
      }
    }

    const infoTitle = document.getElementById('fvInfoTitle');
    const infoCategory = document.getElementById('fvInfoCategory');
    const infoAuthor = document.getElementById('fvInfoAuthor');
    const infoDesc = document.getElementById('fvInfoDesc');
    const infoPages = document.getElementById('fvInfoPages');

    if (infoTitle) infoTitle.textContent = publicationData.title || '';
    if (infoCategory) infoCategory.textContent = publicationData.category || 'Magazine';
    if (infoAuthor) infoAuthor.textContent = publicationData.author ? `By ${publicationData.author}` : '';
    if (infoDesc) infoDesc.textContent = publicationData.description || 'No description provided.';
    if (infoPages) infoPages.textContent = `${publicationData.pageCount || 0} Pages`;
  }

  // --- Load PDF Document and Initialize Canvas Render ---
  async function loadPdfDocument() {
    if (el.loader) {
      el.loader.style.display = 'flex';
      if (el.loaderTitle) el.loaderTitle.textContent = 'Loading Document Engine...';
      if (el.loaderFill) el.loaderFill.style.width = '35%';
    }

    try {
      if (!window.pdfjsLib) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

      if (!window.St || !window.St.PageFlip) {
        await loadScript('https://cdn.jsdelivr.net/npm/page-flip@2.0.7/dist/js/page-flip.browser.js');
      }

      if (el.loaderTitle) el.loaderTitle.textContent = 'Streaming PDF Pages...';
      if (el.loaderFill) el.loaderFill.style.width = '55%';

      const pdfUrl = `/api/public/${publicationId}/pdf` + (viewerToken ? `?token=${encodeURIComponent(viewerToken)}` : '');

      const loadingTask = pdfjsLib.getDocument({
        url: pdfUrl,
        cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
        cMapPacked: true
      });

      const pdf = await loadingTask.promise;
      currentPdfDoc = pdf;
      const numPages = pdf.numPages;

      if (el.totalPages) el.totalPages.textContent = numPages;
      if (el.scrubber) {
        el.scrubber.max = numPages;
        el.scrubber.value = 1;
      }

      cachedPages = [];
      const renderScale = window.devicePixelRatio > 1 ? 1.75 : 1.5;

      for (let i = 1; i <= numPages; i++) {
        if (el.loaderTitle) el.loaderTitle.textContent = `Rendering Page ${i} of ${numPages}...`;
        if (el.loaderFill) el.loaderFill.style.width = `${55 + Math.round((i / numPages) * 40)}%`;

        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: renderScale });

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');

        await page.render({ canvasContext: ctx, viewport: viewport }).promise;

        cachedPages.push({
          pageNumber: i,
          density: (i === 1 || i === numPages) ? 'hard' : 'soft',
          canvas: canvas,
          width: viewport.width,
          height: viewport.height
        });
      }

      if (!viewEventRecorded) {
        sendAnalytics('VIEW');
        viewEventRecorded = true;
      }

      hideOverlays();
      buildFlipbookInstance(0);
      populateThumbnails();

    } catch (err) {
      console.error('[PDF Load Error]', err);
      if (err.message && err.message.includes('401')) {
        showPasswordPrompt();
      } else {
        showError('Unable to Load PDF', 'The PDF document could not be rendered. It may be corrupt or protected.', '⚠️');
      }
    }
  }

  // --- Calculate Dimensions & Centering ---
  function getBookSpreadTransform(idx, numPages, isMobile) {
    if (isMobile) {
      return `translateX(0)`;
    }
    if (idx === 0) {
      return `translateX(-25%)`;
    }
    if (idx === numPages - 1) {
      return `translateX(25%)`;
    }
    return `translateX(0)`;
  }

  function updateContainerTransform() {
    if (!el.bookContainer || !currentActivePageFlip) return;
    const idx = currentActivePageFlip.getCurrentPageIndex();
    const numPages = cachedPages.length;
    const isMobile = window.innerWidth <= 768;

    const spreadOffset = getBookSpreadTransform(idx, numPages, isMobile);

    if (currentZoom > 1.02) {
      el.bookContainer.classList.add('is-zoomed');
      el.bookContainer.style.transform = `translate3d(${panX}px, ${panY}px, 0px) scale(${currentZoom}) ${spreadOffset}`;
    } else {
      el.bookContainer.classList.remove('is-zoomed');
      el.bookContainer.classList.remove('is-panning');
      el.bookContainer.style.transform = `scale(1) ${spreadOffset}`;
    }
  }

  // --- Build StPageFlip Book Instance with Heyzine-Grade Physics ---
  function buildFlipbookInstance(startPageIndex = 0) {
    if (!cachedPages || cachedPages.length === 0) return;
    const numPages = cachedPages.length;

    if (currentActivePageFlip) {
      try { currentActivePageFlip.destroy(); } catch (e) {}
      currentActivePageFlip = null;
    }

    const container = el.bookContainer;
    if (!container) return;
    container.innerHTML = '';

    cachedPages.forEach((p, idx) => {
      const pDiv = document.createElement('div');
      pDiv.className = 'st-page';
      pDiv.setAttribute('data-density', p.density);
      if (idx % 2 === 0) {
        pDiv.classList.add('--right');
      } else {
        pDiv.classList.add('--left');
      }
      pDiv.appendChild(p.canvas);
      container.appendChild(pDiv);
    });

    const firstCanvas = cachedPages[0].canvas;
    const canvasW = firstCanvas ? firstCanvas.width : 600;
    const canvasH = firstCanvas ? firstCanvas.height : 850;
    const pageRatio = canvasH / canvasW;

    const stageW = window.innerWidth;
    const stageH = window.innerHeight - (stageW <= 768 ? 110 : 130);
    const isMobile = stageW <= 768;

    let singleW, singleH;

    if (!isMobile) {
      // Desktop Two-Page Spread
      const maxPairWidth = stageW * 0.84;
      const maxHeight = stageH * 0.90;
      const maxSingleWidth = maxPairWidth / 2;
      const heightFromWidth = maxSingleWidth * pageRatio;

      if (heightFromWidth <= maxHeight) {
        singleW = Math.round(maxSingleWidth);
        singleH = Math.round(heightFromWidth);
      } else {
        singleH = Math.round(maxHeight);
        singleW = Math.round(singleH / pageRatio);
      }
    } else {
      // Mobile Single Page Portrait
      const maxWidth = stageW * 0.92;
      const maxHeight = stageH * 0.88;
      const heightFromWidth = maxWidth * pageRatio;

      if (heightFromWidth <= maxHeight) {
        singleW = Math.round(maxWidth);
        singleH = Math.round(heightFromWidth);
      } else {
        singleH = Math.round(maxHeight);
        singleW = Math.round(singleH / pageRatio);
      }
    }

    const pageFlip = new St.PageFlip(container, {
      width: singleW,
      height: singleH,
      size: 'fixed',
      minWidth: 180,
      maxWidth: 1600,
      minHeight: 260,
      maxHeight: 1800,
      maxShadowOpacity: 0.30,
      showCover: true,
      mobileScrollSupport: false,
      usePortrait: isMobile,
      startPage: startPageIndex,
      drawShadow: true,
      flippingTime: 650, // Crisp natural Heyzine paper turn timing
      useMouseEvents: true,
      swipeDistance: 25,
      showPageCorners: true
    });

    pageFlip.loadFromHTML(container.querySelectorAll('.st-page'));
    currentActivePageFlip = pageFlip;

    // Smooth Centering Transition and Page Display Update
    function updatePageDisplay(idx) {
      const pageIdx = idx + 1;
      if (el.scrubber) el.scrubber.value = pageIdx;

      if (!isMobile) {
        if (idx === 0) {
          if (el.currentPage) el.currentPage.textContent = '1';
        } else if (idx === numPages - 1) {
          if (el.currentPage) el.currentPage.textContent = `${numPages}`;
        } else {
          const leftP = idx + 1;
          const rightP = Math.min(idx + 2, numPages);
          if (el.currentPage) el.currentPage.textContent = `${leftP} - ${rightP}`;
        }
      } else {
        if (el.currentPage) el.currentPage.textContent = `${pageIdx}`;
      }

      updateContainerTransform();

      // Update control disabled states
      const isStart = idx <= 0;
      const isEnd = idx >= numPages - 1;
      if (el.prevArrow) el.prevArrow.disabled = isStart;
      if (el.prevBtn) el.prevBtn.disabled = isStart;
      if (el.firstBtn) el.firstBtn.disabled = isStart;
      if (el.nextArrow) el.nextArrow.disabled = isEnd;
      if (el.nextBtn) el.nextBtn.disabled = isEnd;
      if (el.lastBtn) el.lastBtn.disabled = isEnd;

      // Update active thumbnail
      document.querySelectorAll('.fv-thumb-item').forEach((item, i) => {
        if (i === idx || (!isMobile && idx > 0 && (i === idx || i === idx + 1))) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });
    }

    // PageFlip Events
    pageFlip.on('flip', (e) => {
      playPaperSound();
      updatePageDisplay(e.data);
      sendAnalytics('PAGE_TURN', e.data + 1);
    });

    pageFlip.on('changeState', (e) => {
      if (e.data === 'flipping') {
        playPaperSound();
      }
    });

    pageFlip.on('init', () => {
      updatePageDisplay(startPageIndex);
    });

    updatePageDisplay(startPageIndex);

    // Dock Navigation Buttons
    if (el.prevBtn) el.prevBtn.onclick = () => pageFlip.flipPrev();
    if (el.nextBtn) el.nextBtn.onclick = () => pageFlip.flipNext();
    if (el.firstBtn) el.firstBtn.onclick = () => pageFlip.flip(0);
    if (el.lastBtn) el.lastBtn.onclick = () => pageFlip.flip(numPages - 1);
    if (el.prevArrow) el.prevArrow.onclick = () => pageFlip.flipPrev();
    if (el.nextArrow) el.nextArrow.onclick = () => pageFlip.flipNext();

    // Scrubber Navigation
    if (el.scrubber) {
      el.scrubber.oninput = (e) => {
        const val = parseInt(e.target.value, 10);
        if (el.scrubberTooltip) {
          el.scrubberTooltip.textContent = `Page ${val}`;
          el.scrubberTooltip.style.opacity = '1';
        }
      };
      el.scrubber.onchange = (e) => {
        const val = parseInt(e.target.value, 10) - 1;
        pageFlip.flip(val);
        if (el.scrubberTooltip) el.scrubberTooltip.style.opacity = '0';
      };
    }
  }

  // --- Populate Thumbnails Tray ---
  function populateThumbnails() {
    if (!el.thumbScroll || !cachedPages) return;
    el.thumbScroll.innerHTML = '';

    cachedPages.forEach((p, idx) => {
      const item = document.createElement('div');
      item.className = 'fv-thumb-item';
      if (idx === 0) item.classList.add('active');

      const wrap = document.createElement('div');
      wrap.className = 'thumb-canvas-wrap';

      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = 140;
      thumbCanvas.height = 190;
      const ctx = thumbCanvas.getContext('2d');
      ctx.drawImage(p.canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);

      wrap.appendChild(thumbCanvas);

      const lbl = document.createElement('span');
      lbl.textContent = `Page ${p.pageNumber}`;

      item.appendChild(wrap);
      item.appendChild(lbl);

      item.onclick = () => {
        if (currentActivePageFlip) {
          currentActivePageFlip.flip(idx);
          if (el.thumbnailsTray) el.thumbnailsTray.classList.remove('open');
          if (el.thumbnailsBtn) el.thumbnailsBtn.classList.remove('active');
        }
      };

      el.thumbScroll.appendChild(item);
    });
  }

  // --- Zoom Engine & Interactive Pan ---
  function applyZoom(newZoom, originX = null, originY = null) {
    const prevZoom = currentZoom;
    currentZoom = Math.max(1.0, Math.min(3.5, newZoom));

    if (currentZoom <= 1.02) {
      currentZoom = 1.0;
      panX = 0;
      panY = 0;
    } else if (originX !== null && originY !== null && prevZoom !== currentZoom) {
      // Zoom towards cursor location
      const zoomRatio = currentZoom / prevZoom;
      const viewportRect = el.viewport ? el.viewport.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      const mouseX = originX - (viewportRect.left + viewportRect.width / 2);
      const mouseY = originY - (viewportRect.top + viewportRect.height / 2);

      panX = (panX - mouseX) * zoomRatio + mouseX;
      panY = (panY - mouseY) * zoomRatio + mouseY;
    }

    // Clamp pan bounds
    clampPanBounds();

    if (el.zoomLevel) el.zoomLevel.textContent = `${Math.round(currentZoom * 100)}%`;
    updateContainerTransform();
  }

  function clampPanBounds() {
    if (currentZoom <= 1.02) {
      panX = 0;
      panY = 0;
      return;
    }
    const maxPanX = (window.innerWidth * (currentZoom - 1)) / 2 + 100;
    const maxPanY = (window.innerHeight * (currentZoom - 1)) / 2 + 100;
    panX = Math.max(-maxPanX, Math.min(maxPanX, panX));
    panY = Math.max(-maxPanY, Math.min(maxPanY, panY));
  }

  // --- Autoplay Slideshow Controller ---
  function toggleAutoplay() {
    isAutoplaying = !isAutoplaying;
    if (isAutoplaying) {
      if (el.autoplayBtn) {
        el.autoplayBtn.classList.add('playing');
        el.autoplayBtn.querySelector('span').textContent = 'Pause';
      }
      showToast('Autoplay presentation mode started');
      autoplayTimer = setInterval(() => {
        if (currentActivePageFlip) {
          const cur = currentActivePageFlip.getCurrentPageIndex();
          if (cur >= cachedPages.length - 1) {
            currentActivePageFlip.flip(0);
          } else {
            currentActivePageFlip.flipNext();
          }
        }
      }, 4500);
    } else {
      if (el.autoplayBtn) {
        el.autoplayBtn.classList.remove('playing');
        el.autoplayBtn.querySelector('span').textContent = 'Auto';
      }
      clearInterval(autoplayTimer);
      autoplayTimer = null;
      showToast('Autoplay paused');
    }
  }

  // --- Fullscreen Toggle ---
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  // --- Search in Document (Text Extraction via PDF.js) ---
  async function performSearch(query) {
    const resultsContainer = document.getElementById('fvSearchResults');
    if (!resultsContainer || !currentPdfDoc) return;
    resultsContainer.innerHTML = '';

    query = query.trim().toLowerCase();
    if (!query) {
      resultsContainer.innerHTML = '<p style="color:var(--fv-text-muted); font-size:0.86rem;">Type a keyword to search.</p>';
      return;
    }

    resultsContainer.innerHTML = '<p style="color:var(--fv-text-muted); font-size:0.86rem;">Searching pages...</p>';

    let matches = [];
    const numPages = currentPdfDoc.numPages;

    for (let i = 1; i <= numPages; i++) {
      const page = await currentPdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');

      if (pageText.toLowerCase().includes(query)) {
        matches.push({ pageNum: i, text: pageText });
      }
    }

    resultsContainer.innerHTML = '';
    if (matches.length === 0) {
      resultsContainer.innerHTML = `<p style="color:var(--fv-text-muted); font-size:0.86rem;">No matches found for "${query}".</p>`;
      return;
    }

    matches.forEach(m => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:10px; margin-bottom:8px; border:1px solid var(--fv-border); border-radius:8px; cursor:pointer; background:var(--fv-bg); font-size:0.86rem; transition:background 0.15s;';
      div.innerHTML = `<strong style="color:var(--fv-primary);">Page ${m.pageNum}</strong><p style="margin-top:4px; color:var(--fv-text-muted); font-size:0.8rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${m.text}</p>`;
      div.onclick = () => {
        if (currentActivePageFlip) {
          currentActivePageFlip.flip(m.pageNum - 1);
          closeAllModals();
        }
      };
      resultsContainer.appendChild(div);
    });
  }

  // --- Close All Modals ---
  function closeAllModals() {
    if (el.shareModal) el.shareModal.classList.remove('open');
    if (el.qrModal) el.qrModal.classList.remove('open');
    if (el.searchModal) el.searchModal.classList.remove('open');
    if (el.mobileSheetModal) el.mobileSheetModal.classList.remove('open');
    if (el.infoDrawer) el.infoDrawer.classList.remove('open');
    if (el.thumbnailsTray) el.thumbnailsTray.classList.remove('open');
    if (el.thumbnailsBtn) el.thumbnailsBtn.classList.remove('active');
    if (el.infoBtn) el.infoBtn.classList.remove('active');
  }

  // --- Setup Mouse Wheel & Touch Interaction ---
  function setupInteractiveListeners() {
    const viewport = el.viewport || window;

    // Ctrl + Mouse Wheel (or Trackpad Pinch) Zoom
    viewport.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const zoomDelta = -e.deltaY * 0.0035;
        const targetZoom = Math.max(1.0, Math.min(3.5, currentZoom + zoomDelta));
        applyZoom(targetZoom, e.clientX, e.clientY);
      }
    }, { passive: false });

    // Drag & Pan when Zoomed In
    window.addEventListener('mousedown', (e) => {
      if (currentZoom > 1.02 && e.button === 0) {
        isDragging = true;
        dragStartX = e.clientX - panX;
        dragStartY = e.clientY - panY;
        if (el.bookContainer) el.bookContainer.classList.add('is-panning');
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (isDragging && currentZoom > 1.02) {
        panX = e.clientX - dragStartX;
        panY = e.clientY - dragStartY;
        clampPanBounds();
        updateContainerTransform();
      }
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        if (el.bookContainer) el.bookContainer.classList.remove('is-panning');
      }
    });

    // Double-Click to Zoom In/Out
    if (el.viewport) {
      el.viewport.addEventListener('dblclick', (e) => {
        if (currentZoom > 1.05) {
          applyZoom(1.0);
          showToast('Zoom reset (100%)');
        } else {
          applyZoom(2.0, e.clientX, e.clientY);
          showToast('Zoomed 200%');
        }
      });
    }

    // Touch Support (Pinch to Zoom, Drag to Pan, Double Tap)
    if (el.viewport) {
      el.viewport.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
          // Pinch Zoom Start
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          initialPinchDistance = Math.hypot(dx, dy);
          initialPinchZoom = currentZoom;
        } else if (e.touches.length === 1) {
          const t = e.touches[0];
          touchStartX = t.clientX;
          touchStartY = t.clientY;
          touchStartTime = Date.now();

          // Check for Double-Tap
          const now = Date.now();
          if (now - lastTapTime < 300) {
            if (currentZoom > 1.05) {
              applyZoom(1.0);
            } else {
              applyZoom(2.0, t.clientX, t.clientY);
            }
            lastTapTime = 0;
            return;
          }
          lastTapTime = now;

          if (currentZoom > 1.02) {
            isDragging = true;
            dragStartX = t.clientX - panX;
            dragStartY = t.clientY - panY;
          }
        }
      }, { passive: true });

      el.viewport.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && initialPinchDistance) {
          // Pinch Zooming
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const dist = Math.hypot(dx, dy);
          const factor = dist / initialPinchDistance;
          applyZoom(initialPinchZoom * factor);
        } else if (e.touches.length === 1 && isDragging && currentZoom > 1.02) {
          // Panning when Zoomed
          const t = e.touches[0];
          panX = t.clientX - dragStartX;
          panY = t.clientY - dragStartY;
          clampPanBounds();
          updateContainerTransform();
        }
      }, { passive: true });

      el.viewport.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) {
          initialPinchDistance = null;
        }
        if (e.touches.length === 0) {
          isDragging = false;

          // Single finger swipe page turn when NOT zoomed
          if (currentZoom <= 1.02 && currentActivePageFlip) {
            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;
            const deltaX = touchEndX - touchStartX;
            const deltaY = touchEndY - touchStartY;
            const elapsed = Date.now() - touchStartTime;

            if (elapsed < 400 && Math.abs(deltaX) > 40 && Math.abs(deltaY) < 60) {
              if (deltaX < 0) {
                currentActivePageFlip.flipNext();
              } else {
                currentActivePageFlip.flipPrev();
              }
            }
          }
        }
      }, { passive: true });
    }
  }

  // --- Initialize UI Event Listeners ---
  function initEventListeners() {
    // Sound Toggle
    if (el.soundBtn) {
      el.soundBtn.onclick = () => {
        soundEnabled = !soundEnabled;
        localStorage.setItem('fv_sound_enabled', soundEnabled ? 'true' : 'false');
        updateSoundUI();
        showToast(soundEnabled ? 'Page flip sound enabled' : 'Page flip sound muted');
        if (soundEnabled) playPaperSound();
      };
      updateSoundUI();
    }

    // Theme Toggle
    if (el.themeToggleBtn) {
      el.themeToggleBtn.onclick = () => {
        applyTheme(!isDarkMode);
        showToast(isDarkMode ? 'Dark theme enabled' : 'Light theme enabled');
      };
    }

    // Zoom Buttons
    if (el.zoomInBtn) el.zoomInBtn.onclick = () => applyZoom(currentZoom + 0.25);
    if (el.zoomOutBtn) el.zoomOutBtn.onclick = () => applyZoom(currentZoom - 0.25);
    if (el.zoomLevel) el.zoomLevel.onclick = () => applyZoom(1.0);

    // Fullscreen Button
    if (el.fullscreenBtn) el.fullscreenBtn.onclick = toggleFullscreen;

    // Autoplay Button
    if (el.autoplayBtn) el.autoplayBtn.onclick = toggleAutoplay;

    // Mobile Menu Button
    if (el.mobileMenuBtn) {
      el.mobileMenuBtn.onclick = () => {
        if (el.mobileSheetModal) el.mobileSheetModal.classList.add('open');
      };
    }

    // Mobile Sheet Grid Actions
    const mSearch = document.getElementById('fvMobileSearchBtn');
    if (mSearch) {
      mSearch.onclick = () => {
        closeAllModals();
        if (el.searchBtn) el.searchBtn.click();
      };
    }
    const mThumbnails = document.getElementById('fvMobileThumbnailsBtn');
    if (mThumbnails) {
      mThumbnails.onclick = () => {
        closeAllModals();
        if (el.thumbnailsBtn) el.thumbnailsBtn.click();
      };
    }
    const mSound = document.getElementById('fvMobileSoundBtn');
    if (mSound) {
      mSound.onclick = () => {
        if (el.soundBtn) el.soundBtn.click();
      };
    }
    const mTheme = document.getElementById('fvMobileThemeBtn');
    if (mTheme) {
      mTheme.onclick = () => {
        if (el.themeToggleBtn) el.themeToggleBtn.click();
      };
    }
    const mShare = document.getElementById('fvMobileShareBtn');
    if (mShare) {
      mShare.onclick = () => {
        closeAllModals();
        if (el.shareBtn) el.shareBtn.click();
      };
    }
    const mQr = document.getElementById('fvMobileQrBtn');
    if (mQr) {
      mQr.onclick = () => {
        closeAllModals();
        if (el.qrBtn) el.qrBtn.click();
      };
    }
    const mInfo = document.getElementById('fvMobileInfoBtn');
    if (mInfo) {
      mInfo.onclick = () => {
        closeAllModals();
        if (el.infoBtn) el.infoBtn.click();
      };
    }

    // Thumbnails Tray Toggle
    if (el.thumbnailsBtn) {
      el.thumbnailsBtn.onclick = () => {
        const isOpen = el.thumbnailsTray.classList.toggle('open');
        el.thumbnailsBtn.classList.toggle('active', isOpen);
        if (isOpen && el.infoDrawer) el.infoDrawer.classList.remove('open');
      };
    }
    if (el.closeTrayBtn) {
      el.closeTrayBtn.onclick = () => {
        if (el.thumbnailsTray) el.thumbnailsTray.classList.remove('open');
        if (el.thumbnailsBtn) el.thumbnailsBtn.classList.remove('active');
      };
    }

    // Info Drawer Toggle
    if (el.infoBtn) {
      el.infoBtn.onclick = () => {
        const isOpen = el.infoDrawer.classList.toggle('open');
        el.infoBtn.classList.toggle('active', isOpen);
        if (isOpen && el.thumbnailsTray) el.thumbnailsTray.classList.remove('open');
      };
    }
    if (el.closeDrawerBtn) {
      el.closeDrawerBtn.onclick = () => {
        if (el.infoDrawer) el.infoDrawer.classList.remove('open');
        if (el.infoBtn) el.infoBtn.classList.remove('active');
      };
    }

    // Share Modal
    if (el.shareBtn) {
      el.shareBtn.onclick = () => {
        const shareUrlInput = document.getElementById('fvShareUrlInput');
        if (shareUrlInput) shareUrlInput.value = window.location.href;
        if (el.shareModal) el.shareModal.classList.add('open');
      };
    }
    const copyShareBtn = document.getElementById('fvCopyShareBtn');
    if (copyShareBtn) {
      copyShareBtn.onclick = () => {
        const shareUrlInput = document.getElementById('fvShareUrlInput');
        if (shareUrlInput) {
          navigator.clipboard.writeText(shareUrlInput.value).then(() => {
            copyShareBtn.textContent = 'Copied!';
            showToast('Link copied to clipboard!');
            setTimeout(() => { copyShareBtn.textContent = 'Copy'; }, 2000);
          });
        }
      };
    }

    // QR Code Modal
    if (el.qrBtn) {
      el.qrBtn.onclick = async () => {
        if (el.qrModal) el.qrModal.classList.add('open');
        if (!window.QRCode) {
          await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js');
        }
        const qrCanvas = document.getElementById('fvQrCanvas');
        if (qrCanvas && window.QRCode) {
          qrCanvas.innerHTML = '';
          new QRCode(qrCanvas, {
            text: window.location.href,
            width: 180,
            height: 180,
            colorDark: '#0f172a',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
          });
        }
      };
    }

    // Search Modal
    if (el.searchBtn) {
      el.searchBtn.onclick = () => {
        if (el.searchModal) el.searchModal.classList.add('open');
        const searchInput = document.getElementById('fvSearchInput');
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
      };
    }
    const searchInput = document.getElementById('fvSearchInput');
    if (searchInput) {
      searchInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
          performSearch(searchInput.value);
        }
      };
    }

    // Modal Close Buttons
    document.querySelectorAll('.fv-modal-close').forEach(btn => {
      btn.onclick = closeAllModals;
    });

    // Password Prompt Submit
    if (el.passwordBtn) el.passwordBtn.onclick = submitPassword;
    if (el.passwordInput) {
      el.passwordInput.onkeydown = (e) => {
        if (e.key === 'Enter') submitPassword();
      };
    }

    // Global Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

      if (e.key === 'ArrowLeft') {
        if (currentActivePageFlip) currentActivePageFlip.flipPrev();
      } else if (e.key === 'ArrowRight') {
        if (currentActivePageFlip) currentActivePageFlip.flipNext();
      } else if (e.key === 'Home') {
        if (currentActivePageFlip) currentActivePageFlip.flip(0);
      } else if (e.key === 'End') {
        if (currentActivePageFlip) currentActivePageFlip.flip(cachedPages.length - 1);
      } else if (e.key === ' ') {
        e.preventDefault();
        toggleAutoplay();
      } else if (e.key === '+' || e.key === '=') {
        applyZoom(currentZoom + 0.25);
      } else if (e.key === '-' || e.key === '_') {
        applyZoom(currentZoom - 0.25);
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === 'm' || e.key === 'M') {
        if (el.soundBtn) el.soundBtn.click();
      } else if (e.key === 'Escape') {
        closeAllModals();
        if (currentZoom > 1.05) applyZoom(1.0);
      }
    });

    // Setup Touch & Pointer Wheel Controls
    setupInteractiveListeners();

    // Window Resize Handler with Debouncing
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (currentActivePageFlip) {
          const curPage = currentActivePageFlip.getCurrentPageIndex();
          buildFlipbookInstance(curPage);
        }
      }, 200);
    });
  }

  // --- Bootstrap on Page Load ---
  window.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    applyTheme(isDarkMode);
    initEventListeners();
    loadPublication();
  });

})();
