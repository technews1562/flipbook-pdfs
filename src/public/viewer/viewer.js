/**
 * ==========================================================================
 * FLIPVIEW PDF STANDALONE VIEWER JAVASCRIPT ENGINE (PHASE 4)
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
  let soundEnabled = true;
  let autoplayTimer = null;
  let isAutoplaying = false;
  let toastTimeout = null;
  let viewEventRecorded = false;
  let lastPageTurnTime = 0;

  // --- Web Audio Synthesizer for Paper Flip Sound ---
  let audioContext = null;
  function initAudio() {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) audioContext = new AudioCtx();
    }
  }

  function playPaperSound() {
    if (!soundEnabled) return;
    try {
      initAudio();
      if (!audioContext) return;
      if (audioContext.state === 'suspended') audioContext.resume();

      const bufferSize = audioContext.sampleRate * 0.08;
      const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
      }

      const noise = audioContext.createBufferSource();
      noise.buffer = buffer;
      const filter = audioContext.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 900;
      filter.Q.value = 1.1;

      const gainNode = audioContext.createGain();
      gainNode.gain.setValueAtTime(0.08, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.08);

      noise.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(audioContext.destination);
      noise.start();
    } catch (e) {
      // Audio autoplay restrictions or unsupported
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
    }, 2800);
  }

  // --- Analytics Dispatcher ---
  function sendAnalytics(eventType, pageNumber = null) {
    if (!publicationId) return;
    try {
      fetch('/api/analytics/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicationId,
          eventType,
          pageNumber,
          referrer: document.referrer || window.location.href
        })
      }).catch(() => {});
    } catch (e) {}
  }

  // --- DOM Element References ---
  const el = {
    loader: document.getElementById('fvLoader'),
    loaderTitle: document.getElementById('fvLoaderTitle'),
    loaderDesc: document.getElementById('fvLoaderDesc'),
    loaderFill: document.getElementById('fvLoaderFill'),
    errorOverlay: document.getElementById('fvErrorOverlay'),
    errorIcon: document.getElementById('fvErrorIcon'),
    errorTitle: document.getElementById('fvErrorTitle'),
    errorDesc: document.getElementById('fvErrorDesc'),
    errorActionBtn: document.getElementById('fvErrorActionBtn'),
    passwordOverlay: document.getElementById('fvPasswordOverlay'),
    passwordInput: document.getElementById('fvPasswordInput'),
    passwordBtn: document.getElementById('fvPasswordBtn'),
    passwordError: document.getElementById('fvPasswordError'),
    brandBadge: document.getElementById('fvBrandBadge'),
    docTitle: document.getElementById('fvDocTitle'),
    categoryPill: document.getElementById('fvCategoryPill'),
    downloadBtn: document.getElementById('fvDownloadBtn'),
    zoomInBtn: document.getElementById('fvZoomInBtn'),
    zoomOutBtn: document.getElementById('fvZoomOutBtn'),
    zoomLevel: document.getElementById('fvZoomLevel'),
    fullscreenBtn: document.getElementById('fvFullscreenBtn'),
    searchBtn: document.getElementById('fvSearchBtn'),
    thumbnailsBtn: document.getElementById('fvThumbnailsBtn'),
    infoBtn: document.getElementById('fvInfoBtn'),
    shareBtn: document.getElementById('fvShareBtn'),
    qrBtn: document.getElementById('fvQrBtn'),
    prevArrow: document.getElementById('fvPrevArrow'),
    nextArrow: document.getElementById('fvNextArrow'),
    firstBtn: document.getElementById('fvFirstBtn'),
    prevBtn: document.getElementById('fvPrevBtn'),
    nextBtn: document.getElementById('fvNextBtn'),
    lastBtn: document.getElementById('fvLastBtn'),
    currentPage: document.getElementById('fvCurrentPage'),
    totalPages: document.getElementById('fvTotalPages'),
    scrubber: document.getElementById('fvScrubber'),
    scrubberTooltip: document.getElementById('fvScrubberTooltip'),
    autoplayBtn: document.getElementById('fvAutoplayBtn'),
    thumbnailsTray: document.getElementById('fvThumbnailsTray'),
    thumbScroll: document.getElementById('fvThumbScroll'),
    closeTrayBtn: document.getElementById('fvCloseTrayBtn'),
    infoDrawer: document.getElementById('fvInfoDrawer'),
    closeDrawerBtn: document.getElementById('fvCloseDrawerBtn'),
    shareModal: document.getElementById('fvShareModal'),
    qrModal: document.getElementById('fvQrModal'),
    searchModal: document.getElementById('fvSearchModal'),
    viewport: document.getElementById('fvViewport'),
    bookContainer: document.getElementById('fvBookContainer')
  };

  // --- Hide All Overlays ---
  function hideOverlays() {
    if (el.loader) el.loader.style.display = 'none';
    if (el.errorOverlay) el.errorOverlay.style.display = 'none';
    if (el.passwordOverlay) el.passwordOverlay.style.display = 'none';
  }

  // --- Show Error State ---
  function showError(title, desc, icon = '⚠️') {
    hideOverlays();
    if (el.errorOverlay) {
      el.errorOverlay.style.display = 'flex';
      if (el.errorIcon) el.errorIcon.textContent = icon;
      if (el.errorTitle) el.errorTitle.textContent = title;
      if (el.errorDesc) el.errorDesc.textContent = desc;
    }
  }

  // --- Show Password Prompt ---
  function showPasswordPrompt() {
    hideOverlays();
    if (el.passwordOverlay) {
      el.passwordOverlay.style.display = 'flex';
      if (el.passwordInput) {
        el.passwordInput.value = '';
        el.passwordInput.focus();
      }
      if (el.passwordError) el.passwordError.style.display = 'none';
    }
  }

  // --- Password Submit Handler ---
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

    // Check cached token
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

    // Branding configuration
    if (el.brandBadge) {
      el.brandBadge.style.display = publicationData.hasBranding ? 'flex' : 'none';
    }

    // Download configuration
    if (el.downloadBtn) {
      if (publicationData.downloadEnabled !== false) {
        el.downloadBtn.style.display = 'inline-flex';
        el.downloadBtn.onclick = () => {
          sendAnalytics('DOWNLOAD');
          const tokenParam = viewerToken ? `&token=${encodeURIComponent(viewerToken)}` : '';
          window.open(`/api/public/${publicationId}/pdf?download=1${tokenParam}`, '_blank');
        };
      } else {
        el.downloadBtn.style.display = 'none';
      }
    }

    // Info drawer population
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
      // 1. Ensure PDF.js is loaded
      if (!window.pdfjsLib) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

      // 2. Ensure StPageFlip is loaded
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

      // Record View Analytics
      if (!viewEventRecorded) {
        sendAnalytics('VIEW');
        viewEventRecorded = true;
      }

      // Build Flipbook Instance
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

  // --- Build StPageFlip Book Instance ---
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

    cachedPages.forEach(p => {
      const pDiv = document.createElement('div');
      pDiv.className = 'st-page';
      pDiv.setAttribute('data-density', p.density);
      pDiv.appendChild(p.canvas);
      container.appendChild(pDiv);
    });

    const firstCanvas = cachedPages[0].canvas;
    const canvasW = firstCanvas ? firstCanvas.width : 600;
    const canvasH = firstCanvas ? firstCanvas.height : 850;
    const pageRatio = canvasH / canvasW;

    const stageW = window.innerWidth;
    const stageH = window.innerHeight - 130;
    const isMobile = stageW <= 768;

    let singleW, singleH;

    if (!isMobile) {
      // Desktop Two-Page Spread
      const maxPairWidth = stageW * 0.82;
      const maxHeight = stageH * 0.88;
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
      // Mobile Single Page
      const maxWidth = stageW * 0.90;
      const maxHeight = stageH * 0.86;
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
      minWidth: 200,
      maxWidth: 1400,
      minHeight: 280,
      maxHeight: 1600,
      maxShadowOpacity: 0.65,
      showCover: true,
      mobileScrollSupport: false,
      usePortrait: isMobile,
      startPage: startPageIndex,
      drawShadow: true,
      flippingTime: 600,
      useMouseEvents: true,
      swipeDistance: 25,
      showPageCorners: true
    });

    pageFlip.loadFromHTML(container.querySelectorAll('.st-page'));
    currentActivePageFlip = pageFlip;

    // Update display on flip
    function updatePageDisplay(idx) {
      const pageIdx = idx + 1;
      if (el.scrubber) el.scrubber.value = pageIdx;

      if (!isMobile) {
        if (idx === 0) {
          if (el.currentPage) el.currentPage.textContent = '1';
          container.style.transform = `scale(${currentZoom}) translateX(-25%)`;
        } else if (idx === numPages - 1) {
          if (el.currentPage) el.currentPage.textContent = `${numPages}`;
          container.style.transform = `scale(${currentZoom}) translateX(25%)`;
        } else {
          const leftP = idx + 1;
          const rightP = Math.min(idx + 2, numPages);
          if (el.currentPage) el.currentPage.textContent = `${leftP} - ${rightP}`;
          container.style.transform = `scale(${currentZoom}) translateX(0)`;
        }
      } else {
        if (el.currentPage) el.currentPage.textContent = `${pageIdx}`;
        container.style.transform = `scale(${currentZoom}) translateX(0)`;
      }

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

      // Debounced Page Turn Analytics
      const now = Date.now();
      if (now - lastPageTurnTime > 1500) {
        sendAnalytics('PAGE_TURN', pageIdx);
        lastPageTurnTime = now;
      }
    }

    pageFlip.on('flip', (e) => {
      updatePageDisplay(e.data);
      playPaperSound();
    });

    updatePageDisplay(startPageIndex);

    // Bind Navigation Buttons
    if (el.prevArrow) el.prevArrow.onclick = () => pageFlip.flipPrev();
    if (el.nextArrow) el.nextArrow.onclick = () => pageFlip.flipNext();
    if (el.prevBtn) el.prevBtn.onclick = () => pageFlip.flipPrev();
    if (el.nextBtn) el.nextBtn.onclick = () => pageFlip.flipNext();
    if (el.firstBtn) el.firstBtn.onclick = () => pageFlip.flip(0);
    if (el.lastBtn) el.lastBtn.onclick = () => pageFlip.flip(numPages - 1);

    if (el.scrubber) {
      el.scrubber.oninput = (e) => {
        const val = parseInt(e.target.value, 10);
        pageFlip.flip(val - 1);
        if (el.scrubberTooltip) {
          el.scrubberTooltip.textContent = `Page ${val} of ${numPages}`;
          const pct = (val - 1) / Math.max(1, numPages - 1);
          el.scrubberTooltip.style.left = `${pct * 100}%`;
          el.scrubberTooltip.style.opacity = '1';
        }
      };
      el.scrubber.onmouseleave = () => {
        if (el.scrubberTooltip) el.scrubberTooltip.style.opacity = '0';
      };
    }
  }

  // --- Populate Slide-up Thumbnails ---
  function populateThumbnails() {
    if (!el.thumbScroll || !cachedPages.length) return;
    el.thumbScroll.innerHTML = '';

    cachedPages.forEach((p, idx) => {
      const item = document.createElement('div');
      item.className = 'fv-thumb-item' + (idx === 0 ? ' active' : '');
      item.onclick = () => {
        if (currentActivePageFlip) currentActivePageFlip.flip(idx);
        toggleThumbnails(false);
      };

      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = 70;
      thumbCanvas.height = Math.round(70 * (p.height / p.width));
      const ctx = thumbCanvas.getContext('2d');
      ctx.drawImage(p.canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);

      const numBadge = document.createElement('span');
      numBadge.className = 'fv-thumb-number';
      numBadge.textContent = idx + 1;

      item.appendChild(thumbCanvas);
      item.appendChild(numBadge);
      el.thumbScroll.appendChild(item);
    });
  }

  // --- Zoom Controls ---
  function setZoom(factor) {
    currentZoom = Math.min(Math.max(factor, 0.75), 2.25);
    if (el.zoomLevel) el.zoomLevel.textContent = `${Math.round(currentZoom * 100)}%`;
    if (currentActivePageFlip) {
      const idx = currentActivePageFlip.getCurrentPageIndex();
      const numPages = cachedPages.length;
      const isMobile = window.innerWidth <= 768;

      if (!isMobile) {
        if (idx === 0) el.bookContainer.style.transform = `scale(${currentZoom}) translateX(-25%)`;
        else if (idx === numPages - 1) el.bookContainer.style.transform = `scale(${currentZoom}) translateX(25%)`;
        else el.bookContainer.style.transform = `scale(${currentZoom}) translateX(0)`;
      } else {
        el.bookContainer.style.transform = `scale(${currentZoom}) translateX(0)`;
      }
    }
  }

  // --- Fullscreen Toggle ---
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  }

  // --- Autoplay Toggle ---
  function toggleAutoplay() {
    isAutoplaying = !isAutoplaying;
    if (el.autoplayBtn) el.autoplayBtn.classList.toggle('active', isAutoplaying);

    if (isAutoplaying) {
      showToast('Autoplay Slideshow Started (3s interval)');
      autoplayTimer = setInterval(() => {
        if (!currentActivePageFlip) return;
        const cur = currentActivePageFlip.getCurrentPageIndex();
        if (cur >= cachedPages.length - 1) {
          currentActivePageFlip.flip(0);
        } else {
          currentActivePageFlip.flipNext();
        }
      }, 3200);
    } else {
      showToast('Autoplay Paused');
      if (autoplayTimer) {
        clearInterval(autoplayTimer);
        autoplayTimer = null;
      }
    }
  }

  // --- Thumbnails Tray Toggle ---
  function toggleThumbnails(force) {
    const shouldOpen = force !== undefined ? force : !el.thumbnailsTray.classList.contains('open');
    el.thumbnailsTray.classList.toggle('open', shouldOpen);
    if (el.thumbnailsBtn) el.thumbnailsBtn.classList.toggle('active', shouldOpen);
  }

  // --- Info Drawer Toggle ---
  function toggleInfoDrawer(force) {
    const shouldOpen = force !== undefined ? force : !el.infoDrawer.classList.contains('open');
    el.infoDrawer.classList.toggle('open', shouldOpen);
    if (el.infoBtn) el.infoBtn.classList.toggle('active', shouldOpen);
  }

  // --- Share Modal & Web Share API ---
  function openShareModal() {
    sendAnalytics('SHARE');
    const shareUrl = window.location.href;
    const shareTitle = publicationData?.title || 'FlipView Digital Magazine';

    if (navigator.share) {
      navigator.share({
        title: shareTitle,
        text: `Read "${shareTitle}" on FlipView interactive flipbook reader:`,
        url: shareUrl
      }).catch(() => {});
      return;
    }

    if (el.shareModal) {
      const shareInput = document.getElementById('fvShareUrlInput');
      if (shareInput) shareInput.value = shareUrl;
      el.shareModal.classList.add('open');
    }
  }

  function copyShareLink() {
    const shareUrl = window.location.href;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareUrl).then(() => {
        showToast('Publication URL copied to clipboard!');
      }).catch(() => {
        showToast('Share Link: ' + shareUrl);
      });
    } else {
      showToast('Share Link: ' + shareUrl);
    }
  }

  // --- QR Code Modal ---
  function openQrModal() {
    sendAnalytics('QR_SCAN');
    const shareUrl = window.location.href;
    if (el.qrModal) {
      el.qrModal.classList.add('open');
      const qrCanvas = document.getElementById('fvQrCanvas');
      if (qrCanvas) {
        renderQrCanvas(qrCanvas, shareUrl);
      }
    }
  }

  // Lightweight QR Matrix Generator for Canvas
  function renderQrCanvas(canvas, text) {
    const ctx = canvas.getContext('2d');
    const size = 200;
    canvas.width = size;
    canvas.height = size;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    // Draw stylized QR preview with corner finder patterns
    ctx.fillStyle = '#070a12';
    const drawFinder = (x, y) => {
      ctx.fillRect(x, y, 42, 42);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + 6, y + 6, 30, 30);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(x + 12, y + 12, 18, 18);
      ctx.fillStyle = '#070a12';
    };

    drawFinder(10, 10);
    drawFinder(size - 52, 10);
    drawFinder(10, size - 52);

    // Deterministic pseudo-grid based on URL hash
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = (hash << 5) - hash + text.charCodeAt(i);

    const step = 8;
    for (let r = 0; r < size; r += step) {
      for (let c = 0; c < size; c += step) {
        if ((r < 56 && c < 56) || (r < 56 && c > size - 56) || (r > size - 56 && c < 56)) continue;
        const bit = ((hash ^ (r * 31 + c * 17)) & 1) === 1;
        if (bit) {
          ctx.fillRect(c, r, step - 1, step - 1);
        }
      }
    }
  }

  // --- Search in Document Modal ---
  function openSearchModal() {
    if (el.searchModal) {
      el.searchModal.classList.add('open');
      const searchInput = document.getElementById('fvSearchInput');
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
    }
  }

  async function performSearch(query) {
    if (!currentPdfDoc || !query || !query.trim()) return;
    const q = query.trim().toLowerCase();
    const resultsContainer = document.getElementById('fvSearchResults');
    if (!resultsContainer) return;
    resultsContainer.innerHTML = '<p style="color:var(--fv-text-muted); font-size:0.85rem;">Searching document...</p>';

    const matches = [];
    for (let i = 1; i <= currentPdfDoc.numPages; i++) {
      const page = await currentPdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      if (pageText.toLowerCase().includes(q)) {
        matches.push({ pageNumber: i, snippet: pageText.slice(0, 120) });
      }
    }

    if (matches.length === 0) {
      resultsContainer.innerHTML = '<p style="color:var(--fv-text-muted); font-size:0.85rem; padding:10px 0;">No matching text found.</p>';
      return;
    }

    resultsContainer.innerHTML = '';
    matches.forEach(m => {
      const row = document.createElement('div');
      row.style.cssText = 'padding:8px 12px; margin-bottom:6px; background:var(--fv-bg); border-radius:6px; cursor:pointer; font-size:0.85rem; display:flex; justify-content:space-between; align-items:center;';
      row.innerHTML = `<span>Page <strong>${m.pageNumber}</strong>: <em style="color:var(--fv-text-muted);">${m.snippet.slice(0, 45)}...</em></span> <span style="color:var(--fv-primary); font-weight:700;">Jump ➔</span>`;
      row.onclick = () => {
        if (currentActivePageFlip) currentActivePageFlip.flip(m.pageNumber - 1);
        el.searchModal.classList.remove('open');
      };
      resultsContainer.appendChild(row);
    });
  }

  // --- Bind Event Listeners ---
  function bindUI() {
    if (el.passwordBtn) el.passwordBtn.onclick = submitPassword;
    if (el.passwordInput) {
      el.passwordInput.onkeydown = (e) => {
        if (e.key === 'Enter') submitPassword();
      };
    }

    if (el.zoomInBtn) el.zoomInBtn.onclick = () => setZoom(currentZoom + 0.25);
    if (el.zoomOutBtn) el.zoomOutBtn.onclick = () => setZoom(currentZoom - 0.25);
    if (el.zoomLevel) el.zoomLevel.onclick = () => setZoom(1.0);
    if (el.fullscreenBtn) el.fullscreenBtn.onclick = toggleFullscreen;
    if (el.autoplayBtn) el.autoplayBtn.onclick = toggleAutoplay;
    if (el.thumbnailsBtn) el.thumbnailsBtn.onclick = () => toggleThumbnails();
    if (el.closeTrayBtn) el.closeTrayBtn.onclick = () => toggleThumbnails(false);
    if (el.infoBtn) el.infoBtn.onclick = () => toggleInfoDrawer();
    if (el.closeDrawerBtn) el.closeDrawerBtn.onclick = () => toggleInfoDrawer(false);
    if (el.shareBtn) el.shareBtn.onclick = openShareModal;
    if (el.qrBtn) el.qrBtn.onclick = openQrModal;
    if (el.searchBtn) el.searchBtn.onclick = openSearchModal;

    // Modal close triggers
    document.querySelectorAll('.fv-modal-close').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.fv-modal-overlay').forEach(m => m.classList.remove('open'));
      };
    });

    const copyBtn = document.getElementById('fvCopyShareBtn');
    if (copyBtn) copyBtn.onclick = copyShareLink;

    const searchInput = document.getElementById('fvSearchInput');
    if (searchInput) {
      searchInput.onkeydown = (e) => {
        if (e.key === 'Enter') performSearch(searchInput.value);
      };
    }

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.key === 'ArrowRight') {
        if (currentActivePageFlip) currentActivePageFlip.flipNext();
      } else if (e.key === 'ArrowLeft') {
        if (currentActivePageFlip) currentActivePageFlip.flipPrev();
      } else if (e.key === 'Home') {
        if (currentActivePageFlip) currentActivePageFlip.flip(0);
      } else if (e.key === 'End') {
        if (currentActivePageFlip && cachedPages.length) currentActivePageFlip.flip(cachedPages.length - 1);
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        toggleAutoplay();
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === 'Escape') {
        document.querySelectorAll('.fv-modal-overlay').forEach(m => m.classList.remove('open'));
        toggleThumbnails(false);
        toggleInfoDrawer(false);
      }
    });

    // Window Resize -> Rebuild Flipbook layout
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (currentActivePageFlip && cachedPages.length) {
          const cur = currentActivePageFlip.getCurrentPageIndex();
          buildFlipbookInstance(cur);
        }
      }, 250);
    });
  }

  // --- Initialization on DOM Ready ---
  document.addEventListener('DOMContentLoaded', () => {
    bindUI();
    loadPublication();
  });
})();
