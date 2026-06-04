/* ── Equi7Grid Explorer — Onboarding Tour ── */
(function () {
  'use strict';

  const STORAGE_KEY = 'e7tour_seen_v1';

  // ── Tour step definitions ──────────────────────────────────────────────────
  // target: CSS selector to spotlight (null = centered welcome/done card)
  // placement: where to place the card relative to the target
  //   'right' | 'left' | 'top' | 'bottom' | 'center'
  // pad: extra padding (px) around the spotlight ring

  const STEPS = [
    {
      target: null,
      placement: 'center',
      title: 'Welcome to Equi7Grid Explorer',
      body: 'This tool helps you explore the <strong>Equi7 discrete global grid</strong> — a tiling system used in satellite remote sensing. Let\'s take a quick tour of what you can do.',
      isWelcome: true,
    },
    {
      target: '#map',
      placement: 'center',
      title: '7 Continental Zones',
      body: 'The map shows <strong>7 color-coded zones</strong>: Africa (gold), Europe (blue), Asia (orange), North America (red), South America (purple), Oceania (teal), and Antarctica (green). <strong>Click any colored zone</strong> to select a continent and load its tile grid.',
      pad: 0,
    },
    {
      target: '#tiling-section',
      placement: 'right',
      title: 'Tiling Resolution',
      body: 'After selecting a continent, choose a tile size:<br><br><strong>T6</strong> — 600 km (coarsest, ~1000–64 m sampling)<br><strong>T3</strong> — 300 km (~160–20 m sampling)<br><strong>T1</strong> — 100 km (finest, ~16–1 m sampling)',
      pad: 8,
      showSidebar: true,
    },
    {
      target: '#aoi-toolbar',
      placement: 'left',
      title: 'Define an Area of Interest (AOI)',
      body: 'Use these tools to define your study area:<br><br>&#9632; <strong>Rectangle</strong> — click twice for a bounding box<br>&#11039; <strong>Polygon</strong> — click vertices, double-click to close<br>&#8679; <strong>Upload</strong> — drop a GeoJSON or Shapefile (.zip)<br><br>Only tiles intersecting your AOI are highlighted.',
      pad: 8,
    },
    {
      target: '#topbar-left',
      placement: 'bottom',
      title: 'View Controls',
      body: '<strong>2D / 3D</strong> — switch between a flat map and an interactive globe.<br><br><strong>Country</strong> — pick a country to find its Equi7 tiles across zones.<br><br><strong>Home</strong> — reset everything.<br><br><strong>Camera</strong> — save a PNG snapshot.',
      pad: 8,
    },
    {
      target: '#stats-section',
      placement: 'right',
      title: 'Tile Statistics',
      body: 'Once a zone and AOI are set, this panel shows <strong>total tiles</strong>, how many are <strong>on land</strong>, and how many <strong>intersect your AOI</strong>. You can filter by land-only and switch between long and short tile name formats.',
      pad: 8,
      showSidebar: true,
    },
    {
      target: '#export-section',
      placement: 'right',
      title: 'Copy & Export',
      body: 'Copy all intersecting tile names as a <strong>Python list</strong> — ready to paste into your script. Or click <strong>Export GeoJSON</strong> to download the tile geometries with names and zone colour properties.',
      pad: 8,
      showSidebar: true,
    },
    {
      target: null,
      placement: 'center',
      title: 'You\'re all set!',
      body: 'Start by clicking a colored zone on the map, pick a tiling resolution, then draw or upload an area of interest. The <strong>?</strong> button in the bottom-right corner will replay this tour any time.',
      isDone: true,
    },
  ];

  // ── State ─────────────────────────────────────────────────────────────────
  let currentStep = 0;
  let ring = null;
  let card = null;
  let overlay = null;
  let helpBtn = null;
  let isActive = false;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function isSidebarCollapsed() {
    const sidebar = document.getElementById('sidebar');
    return sidebar && sidebar.classList.contains('collapsed');
  }

  function ensureSidebarVisible(needed) {
    if (!needed) return;
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebar-toggle');
    if (sidebar && sidebar.classList.contains('collapsed') && toggle) {
      toggle.click();
    }
  }

  function getTargetRect(selector, pad = 8) {
    if (!selector) return null;
    const el = document.querySelector(selector);
    if (!el) return null;

    // If the element is hidden (display:none / hidden attr), skip it
    if (el.offsetParent === null && !el.closest('#sidebar')) return null;

    const r = el.getBoundingClientRect();
    return {
      top:    r.top    - pad,
      left:   r.left   - pad,
      width:  r.width  + pad * 2,
      height: r.height + pad * 2,
    };
  }

  function positionCard(step, targetRect) {
    if (!card) return;
    card.className = 'tour-card';  // reset

    // Remove old arrow
    const oldArrow = card.querySelector('.tour-arrow');
    if (oldArrow) oldArrow.remove();

    if (step.isWelcome || step.isDone || !targetRect) {
      card.classList.add('welcome');
      card.style.top = '';
      card.style.left = '';
      card.style.transform = 'translate(-50%, -50%)';
      card.style.top = '50%';
      card.style.left = '50%';
      return;
    }

    card.style.transform = '';
    const GAP = 14;
    const cw = 320; // approx card width
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const placement = step.placement || 'right';

    const arrow = document.createElement('div');
    arrow.className = 'tour-arrow';

    if (placement === 'right') {
      card.style.top  = Math.max(10, Math.min(vh - 300, targetRect.top)) + 'px';
      card.style.left = (targetRect.left + targetRect.width + GAP) + 'px';
      arrow.classList.add('left');
    } else if (placement === 'left') {
      card.style.top  = Math.max(10, Math.min(vh - 300, targetRect.top)) + 'px';
      card.style.left = (targetRect.left - cw - GAP) + 'px';
      arrow.classList.add('right');
    } else if (placement === 'bottom') {
      card.style.top  = (targetRect.top + targetRect.height + GAP) + 'px';
      card.style.left = Math.max(10, Math.min(vw - cw - 10, targetRect.left)) + 'px';
      arrow.classList.add('top');
    } else if (placement === 'top') {
      card.style.top  = (targetRect.top - GAP - 200) + 'px'; // rough card height
      card.style.left = Math.max(10, Math.min(vw - cw - 10, targetRect.left)) + 'px';
      arrow.classList.add('bottom');
    } else {
      // center fallback
      card.style.top = '50%';
      card.style.left = '50%';
      card.style.transform = 'translate(-50%, -50%)';
    }

    // Clamp left edge so card stays on-screen
    const curLeft = parseFloat(card.style.left) || 0;
    if (curLeft + cw > vw - 10) card.style.left = (vw - cw - 10) + 'px';
    if (curLeft < 10) card.style.left = '10px';

    card.appendChild(arrow);
  }

  function positionRing(targetRect) {
    if (!ring) return;
    if (!targetRect) {
      ring.style.display = 'none';
      return;
    }
    ring.style.display = 'block';
    ring.style.top    = targetRect.top    + 'px';
    ring.style.left   = targetRect.left   + 'px';
    ring.style.width  = targetRect.width  + 'px';
    ring.style.height = targetRect.height + 'px';
  }

  // ── Render a step ─────────────────────────────────────────────────────────

  function renderStep(index) {
    if (!card || !ring || !overlay) return;
    const step = STEPS[index];

    // Optionally expand sidebar
    ensureSidebarVisible(step.showSidebar);

    const targetRect = getTargetRect(step.target, step.pad ?? 8);

    // Position the ring
    positionRing(targetRect);

    // Animate card out, update content, animate back in
    card.classList.add('entering');

    setTimeout(() => {
      // Badge
      const totalReal = STEPS.filter(s => !s.isWelcome && !s.isDone).length;
      const realIndex = STEPS.slice(0, index).filter(s => !s.isWelcome && !s.isDone).length;

      card.innerHTML = '';

      if (!step.isWelcome && !step.isDone) {
        const badge = document.createElement('div');
        badge.className = 'tour-step-badge';
        badge.textContent = `Step ${realIndex + 1} of ${totalReal}`;
        card.appendChild(badge);
      }

      if (step.isWelcome) {
        // Large logo
        const logo = document.createElement('div');
        logo.style.cssText = 'width:52px;height:52px;border-radius:12px;background:linear-gradient(135deg,#4393c3,#9b59b6);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:17px;color:#fff;margin:0 auto 18px;letter-spacing:0.5px;';
        logo.textContent = 'E7';
        card.appendChild(logo);
      }

      const title = document.createElement('h3');
      title.textContent = step.title;
      card.appendChild(title);

      const body = document.createElement('p');
      body.innerHTML = step.body;
      card.appendChild(body);

      // Progress dots (skip welcome & done)
      if (!step.isWelcome && !step.isDone) {
        const progress = document.createElement('div');
        progress.className = 'tour-progress';
        const realSteps = STEPS.filter(s => !s.isWelcome && !s.isDone);
        realSteps.forEach((_, i) => {
          const dot = document.createElement('div');
          dot.className = 'tour-dot' + (i < realIndex ? ' done' : i === realIndex ? ' active' : '');
          progress.appendChild(dot);
        });
        card.appendChild(progress);
      }

      // Nav buttons
      const nav = document.createElement('div');
      nav.className = 'tour-nav';

      if (step.isWelcome) {
        const startBtn = document.createElement('button');
        startBtn.className = 'tour-btn tour-btn-primary';
        startBtn.textContent = 'Start Tour';
        startBtn.onclick = () => goTo(index + 1);
        nav.appendChild(startBtn);

        const skipBtn = document.createElement('button');
        skipBtn.className = 'tour-btn tour-btn-skip';
        skipBtn.textContent = 'Skip intro — I know my way around';
        skipBtn.onclick = endTour;
        nav.appendChild(skipBtn);
      } else if (step.isDone) {
        const doneBtn = document.createElement('button');
        doneBtn.className = 'tour-btn tour-btn-primary';
        doneBtn.textContent = 'Start Exploring';
        doneBtn.onclick = endTour;
        nav.appendChild(doneBtn);
      } else {
        const skipBtn = document.createElement('button');
        skipBtn.className = 'tour-btn tour-btn-skip';
        skipBtn.textContent = 'Skip tour';
        skipBtn.onclick = endTour;
        nav.appendChild(skipBtn);

        const rightBtns = document.createElement('div');
        rightBtns.style.cssText = 'display:flex;gap:8px;';

        if (index > 1) {
          const prevBtn = document.createElement('button');
          prevBtn.className = 'tour-btn tour-btn-prev';
          prevBtn.textContent = '← Back';
          prevBtn.onclick = () => goTo(index - 1);
          rightBtns.appendChild(prevBtn);
        }

        const isLastReal = (index === STEPS.length - 2); // before isDone step
        const nextBtn = document.createElement('button');
        nextBtn.className = 'tour-btn ' + (isLastReal ? 'tour-btn-finish' : 'tour-btn-next');
        nextBtn.textContent = isLastReal ? 'Finish ✓' : 'Next →';
        nextBtn.onclick = () => goTo(index + 1);
        rightBtns.appendChild(nextBtn);

        nav.appendChild(rightBtns);
      }

      card.appendChild(nav);

      // Position card
      positionCard(step, targetRect);

      // Animate in
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          card.classList.remove('entering');
        });
      });
    }, 200);
  }

  function goTo(index) {
    if (index < 0 || index >= STEPS.length) return;
    currentStep = index;
    renderStep(currentStep);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  function startTour() {
    if (isActive) return;
    isActive = true;
    currentStep = 0;

    overlay.classList.add('active');
    card.style.display = 'block';
    ring.style.display = 'block';

    requestAnimationFrame(() => renderStep(0));
  }

  function endTour() {
    if (!isActive) return;
    isActive = false;

    localStorage.setItem(STORAGE_KEY, '1');

    card.classList.add('entering');
    overlay.classList.remove('active');

    setTimeout(() => {
      card.style.display = 'none';
      ring.style.display = 'none';
      card.classList.remove('entering');
    }, 250);
  }

  // ── Mount DOM elements ────────────────────────────────────────────────────

  function mount() {
    // Overlay (darkens background via the ring's box-shadow)
    overlay = document.createElement('div');
    overlay.id = 'tour-overlay';
    // Click outside card to skip only if not welcome
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && isActive) {
        const step = STEPS[currentStep];
        if (!step.isWelcome) endTour();
      }
    });

    // Spotlight ring
    ring = document.createElement('div');
    ring.className = 'tour-highlight-ring';
    ring.style.display = 'none';

    // Tour card
    card = document.createElement('div');
    card.id = 'tour-card';
    card.style.display = 'none';

    document.body.appendChild(overlay);
    document.body.appendChild(ring);
    document.body.appendChild(card);

    // Help / replay button
    helpBtn = document.createElement('button');
    helpBtn.id = 'tour-help-btn';
    helpBtn.title = 'Show guide';
    helpBtn.setAttribute('aria-label', 'Show guide');
    helpBtn.textContent = '?';
    helpBtn.addEventListener('click', startTour);
    document.body.appendChild(helpBtn);

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (!isActive) return;
      if (e.key === 'Escape') endTour();
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        const step = STEPS[currentStep];
        if (!step.isWelcome && !step.isDone) goTo(currentStep + 1);
      }
      if (e.key === 'ArrowLeft') {
        if (currentStep > 1) goTo(currentStep - 1);
      }
    });

    // Reposition on resize
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (isActive) renderStep(currentStep);
      }, 100);
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    mount();
    // Auto-start on first visit
    if (!localStorage.getItem(STORAGE_KEY)) {
      // Small delay so the map finishes painting
      setTimeout(startTour, 900);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
