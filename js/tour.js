/* ── Equi7Grid Explorer — Onboarding Tour (open-sar-triad style) ── */
(function () {
  'use strict';

  const STORAGE_KEY = 'e7tour_seen_v2';

  // IDs of elements that start hidden and must be temporarily revealed for a step.
  // Each step lists every ancestor that needs `hidden` removed so the target is visible.
  const STEPS = [
    /* 0 ─ Welcome */
    {
      target: null,
      placement: 'center',
      heading: 'Equi7Grid Explorer',
      body: 'A visual explorer for the <strong>Equi7 discrete global grid</strong> — a tiling system for satellite Earth observation developed at TU Wien.',
      showIds: [],
      isWelcome: true,
    },
    /* 1 ─ Map zones */
    {
      target: '#map',
      placement: 'left',
      heading: '7 Continental Zones',
      body: 'The map shows 7 colour-coded zones:<br><br>'
          + '🟡 <strong>Africa</strong> &nbsp;🟢 <strong>Antarctica</strong> &nbsp;🟠 <strong>Asia</strong><br>'
          + '🔵 <strong>Europe</strong> &nbsp;🔴 <strong>N. America</strong><br>'
          + '🟣 <strong>S. America</strong> &nbsp;🩵 <strong>Oceania</strong><br><br>'
          + '<strong>Click any coloured zone</strong> to select it and load the tile grid.',
      showIds: [],
    },
    /* 2 ─ 2D / 3D toggle */
    {
      target: '#view-toggle-wrap',
      placement: 'bottom',
      heading: '2D / 3D View',
      body: 'Switch between a flat 2D map and an interactive <strong>3D globe</strong>. All tools — drawing, country mode, snapshot — work in both views.',
      showIds: [],
    },
    /* 3 ─ Country mode */
    {
      target: '#btn-country-mode',
      placement: 'bottom',
      heading: 'Country Mode',
      body: 'Activate <strong>Country Mode</strong> to pick a country on the map. The tool finds every Equi7 tile that overlaps that country — even if they span multiple continental zones.',
      showIds: [],
    },
    /* 4 ─ Home */
    {
      target: '#btn-home',
      placement: 'bottom',
      heading: 'Reset / Home',
      body: 'Clears the selected continent, any drawn AOI, and returns the camera to the world overview.',
      showIds: [],
    },
    /* 5 ─ Snapshot */
    {
      target: '#btn-snapshot',
      placement: 'bottom',
      heading: 'Map Snapshot',
      body: 'Downloads a <strong>PNG</strong> of the current map or globe — including tiles, AOI outline, and all labels.',
      showIds: [],
    },
    /* 6 ─ Draw rectangle */
    {
      target: '#btn-bbox',
      placement: 'left',
      heading: 'Draw Rectangle AOI',
      body: 'Click once to anchor a corner, click again to finish a <strong>bounding box</strong>. All tiles intersecting the rectangle are highlighted and counted.',
      showIds: [],
    },
    /* 7 ─ Draw polygon */
    {
      target: '#btn-poly',
      placement: 'left',
      heading: 'Draw Polygon AOI',
      body: 'Click to place vertices, <strong>double-click</strong> to close the polygon. Press <kbd style="background:#21262d;border:1px solid #30363d;border-radius:3px;padding:1px 5px;font-size:11px">Esc</kbd> to cancel mid-draw.',
      showIds: [],
    },
    /* 8 ─ Upload GeoJSON */
    {
      target: 'label[title="Upload GeoJSON"]',
      placement: 'left',
      heading: 'Upload GeoJSON',
      body: 'Load a <strong>.geojson</strong> or <strong>.json</strong> file as your Area of Interest. Supports Polygon and MultiPolygon geometries.',
      showIds: [],
    },
    /* 9 ─ Upload Shapefile */
    {
      target: 'label[title="Upload Shapefile (.zip)"]',
      placement: 'left',
      heading: 'Upload Shapefile',
      body: 'Upload a <strong>.zip</strong> archive containing your Shapefile (.shp, .dbf, .shx). The tool parses and displays it as the AOI automatically.',
      showIds: [],
    },
    /* 10 ─ Tiling resolution */
    {
      target: '#tiling-section',
      placement: 'right',
      heading: 'Tiling Resolution',
      body: 'After selecting a continent, choose your tile size:<br><br>'
          + '<strong>T6</strong> — 600 km &nbsp;(~1000–64 m sampling)<br>'
          + '<strong>T3</strong> — 300 km &nbsp;(~160–20 m sampling)<br>'
          + '<strong>T1</strong> — 100 km &nbsp;(~16–1 m sampling)<br><br>'
          + 'Finer tiles = more tiles, higher spatial resolution.',
      showIds: ['tiling-section'],
      sidebar: true,
    },
    /* 11 ─ Zone statistics */
    {
      target: '#stats-section',
      placement: 'right',
      heading: 'Zone Statistics',
      body: '<strong>Total tiles</strong> shows how many tiles cover the entire continental zone at the selected resolution.<br><br><strong>On land</strong> filters to tiles that overlap at least one country polygon — useful for excluding pure-ocean tiles.',
      showIds: ['tiling-section', 'stats-section'],
      sidebar: true,
    },
    /* 12 ─ AOI intersection */
    {
      target: '#aoi-results',
      placement: 'right',
      heading: 'AOI Intersection',
      body: 'Once you draw or upload an AOI, this section shows how many tiles <strong>intersect</strong> your study area — and of those, how many are on land.',
      showIds: ['tiling-section', 'stats-section', 'aoi-results'],
      sidebar: true,
    },
    /* 13 ─ Tile list + name format */
    {
      target: '#tile-list-wrap',
      placement: 'right',
      heading: 'Tile List & Name Format',
      body: 'A scrollable list of every tile in your AOI.<br><br>'
          + '<strong>Long</strong> — includes zone prefix &amp; sampling: <code style="font-size:10.5px;background:#21262d;padding:1px 4px;border-radius:3px">EU500M_E006N006T6</code><br>'
          + '<strong>Short</strong> — grid ID only: <code style="font-size:10.5px;background:#21262d;padding:1px 4px;border-radius:3px">E006N006T6</code><br><br>'
          + 'Filter to <strong>On land</strong> to exclude ocean-only tiles.',
      showIds: ['tiling-section', 'stats-section', 'aoi-results', 'tile-list-wrap'],
      sidebar: true,
    },
    /* 14 ─ Sampling + copy */
    {
      target: '.sampling-row',
      placement: 'right',
      heading: 'Sampling & Copy',
      body: 'Set the <strong>sampling resolution</strong> (default 500 m) used in long tile names.<br><br>Click <strong>Copy</strong> to put all listed tile names on the clipboard as a Python list — ready to paste straight into your script.',
      showIds: ['tiling-section', 'stats-section', 'aoi-results', 'tile-list-wrap'],
      sidebar: true,
    },
    /* 15 ─ Export GeoJSON */
    {
      target: '#export-section',
      placement: 'right',
      heading: 'Export GeoJSON',
      body: 'Download all intersecting tiles as a <strong>GeoJSON FeatureCollection</strong>. Each feature includes the tile name, zone colour, and inside/outside status as properties.',
      showIds: ['tiling-section', 'stats-section', 'aoi-results', 'tile-list-wrap', 'export-section'],
      sidebar: true,
    },
    /* 16 ─ Done */
    {
      target: null,
      placement: 'center',
      heading: "You're all set!",
      body: 'Click any coloured zone on the map to begin. Use the <strong>?</strong> button (bottom-right) to replay this tour any time.',
      showIds: [],
      isDone: true,
    },
  ];

  // ── Real step count (exclude welcome + done) ───────────────────
  const REAL_STEPS = STEPS.filter(s => !s.isWelcome && !s.isDone);

  // ── DOM refs ───────────────────────────────────────────────────
  let svgEl, holeEl, ringEl, tooltipEl, helpBtn;
  let currentStep = 0;
  let isActive = false;
  // Track which IDs we have forced-visible so we can restore them
  const forcedVisible = new Set();

  // ── Forced-visibility helpers ──────────────────────────────────

  function forceShow(ids) {
    ids.forEach(id => {
      if (forcedVisible.has(id)) return;
      const el = document.getElementById(id);
      if (el && el.hasAttribute('hidden')) {
        el.removeAttribute('hidden');
        forcedVisible.add(id);
      }
    });
  }

  function forceHideUnneeded(keepIds) {
    const keep = new Set(keepIds);
    forcedVisible.forEach(id => {
      if (!keep.has(id)) {
        const el = document.getElementById(id);
        if (el) el.setAttribute('hidden', '');
        forcedVisible.delete(id);
      }
    });
  }

  function restoreAll() {
    forcedVisible.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('hidden', '');
    });
    forcedVisible.clear();
  }

  // ── Sidebar ────────────────────────────────────────────────────

  function ensureSidebar(needed) {
    if (!needed) return;
    const sidebar = document.getElementById('sidebar');
    const toggle  = document.getElementById('sidebar-toggle');
    if (sidebar && sidebar.classList.contains('collapsed') && toggle) toggle.click();
  }

  // ── Bounding rect with padding ─────────────────────────────────

  function getRect(selector, pad) {
    if (!selector) return null;
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    const p = pad ?? 8;
    return { top: r.top - p, left: r.left - p, width: r.width + p * 2, height: r.height + p * 2, raw: r };
  }

  // ── SVG hole ───────────────────────────────────────────────────

  function setHole(rect) {
    if (!rect) {
      holeEl.style.x = '0px';
      holeEl.style.y = '0px';
      holeEl.style.width  = '0px';
      holeEl.style.height = '0px';
    } else {
      holeEl.style.x = rect.left + 'px';
      holeEl.style.y = rect.top  + 'px';
      holeEl.style.width  = rect.width  + 'px';
      holeEl.style.height = rect.height + 'px';
    }
  }

  // ── Ring ───────────────────────────────────────────────────────

  function setRing(rect) {
    if (!rect) {
      ringEl.style.display = 'none';
      return;
    }
    ringEl.style.display = 'block';
    ringEl.style.top    = rect.top    + 'px';
    ringEl.style.left   = rect.left   + 'px';
    ringEl.style.width  = rect.width  + 'px';
    ringEl.style.height = rect.height + 'px';
  }

  // ── Tooltip content ────────────────────────────────────────────

  function buildTooltip(step, realIdx) {
    tooltipEl.innerHTML = '';
    tooltipEl.className = 'tt-animate';

    if (step.isWelcome) {
      tooltipEl.classList.add('tt-center');

      const logo = document.createElement('div');
      logo.className = 'tt-logo';
      logo.textContent = 'E7';
      tooltipEl.appendChild(logo);

      const h = document.createElement('div');
      h.className = 'tt-heading';
      h.style.textAlign = 'center';
      h.textContent = step.heading;
      tooltipEl.appendChild(h);

      const b = document.createElement('div');
      b.className = 'tt-body';
      b.style.textAlign = 'center';
      b.innerHTML = step.body;
      tooltipEl.appendChild(b);

      const credit = document.createElement('div');
      credit.className = 'tt-credit';
      credit.innerHTML =
        'Grid system by <strong>TU Wien</strong> — '
        + '<a href="https://github.com/TUW-GEO/Equi7Grid" target="_blank" rel="noopener">GitHub repo</a>'
        + ' · <a href="https://tuw-geo.github.io/Equi7Grid/latest/" target="_blank" rel="noopener">Documentation</a>';
      tooltipEl.appendChild(credit);

      const actions = document.createElement('div');
      actions.className = 'tt-actions tt-actions-center';
      actions.style.marginTop = '16px';

      const startBtn = document.createElement('button');
      startBtn.className = 'tt-btn tt-start';
      startBtn.textContent = 'Start tour  →';
      startBtn.onclick = () => goTo(1);
      actions.appendChild(startBtn);

      const skipBtn = document.createElement('button');
      skipBtn.className = 'tt-skip-intro';
      skipBtn.textContent = 'Skip — I know my way around';
      skipBtn.onclick = endTour;
      actions.appendChild(skipBtn);

      tooltipEl.appendChild(actions);
      return;
    }

    if (step.isDone) {
      tooltipEl.classList.add('tt-center');

      const h = document.createElement('div');
      h.className = 'tt-heading';
      h.style.textAlign = 'center';
      h.textContent = step.heading;
      tooltipEl.appendChild(h);

      const b = document.createElement('div');
      b.className = 'tt-body';
      b.style.textAlign = 'center';
      b.innerHTML = step.body;
      tooltipEl.appendChild(b);

      const actions = document.createElement('div');
      actions.className = 'tt-actions tt-actions-center';
      actions.style.marginTop = '0';

      const doneBtn = document.createElement('button');
      doneBtn.className = 'tt-btn tt-start';
      doneBtn.textContent = 'Start exploring';
      doneBtn.onclick = endTour;
      actions.appendChild(doneBtn);

      tooltipEl.appendChild(actions);
      return;
    }

    // Normal step
    const topbar = document.createElement('div');
    topbar.className = 'tt-topbar';

    const counter = document.createElement('span');
    counter.className = 'tt-counter';
    counter.textContent = (realIdx + 1) + ' / ' + REAL_STEPS.length;
    topbar.appendChild(counter);

    const skipBtn = document.createElement('button');
    skipBtn.className = 'tt-skip';
    skipBtn.textContent = 'Skip tour';
    skipBtn.onclick = endTour;
    topbar.appendChild(skipBtn);

    tooltipEl.appendChild(topbar);

    const h = document.createElement('div');
    h.className = 'tt-heading';
    h.textContent = step.heading;
    tooltipEl.appendChild(h);

    const b = document.createElement('div');
    b.className = 'tt-body';
    b.innerHTML = step.body;
    tooltipEl.appendChild(b);

    const actions = document.createElement('div');
    actions.className = 'tt-actions';

    if (currentStep > 1) {
      const back = document.createElement('button');
      back.className = 'tt-btn tt-back';
      back.textContent = '← Back';
      back.onclick = () => goTo(currentStep - 1);
      actions.appendChild(back);
    }

    const fwd = document.createElement('button');
    fwd.className = 'tt-btn tt-fwd';
    fwd.textContent = currentStep === STEPS.length - 2 ? 'Finish ✓' : 'Next →';
    fwd.onclick = () => goTo(currentStep + 1);
    actions.appendChild(fwd);

    tooltipEl.appendChild(actions);
  }

  // ── Tooltip position ───────────────────────────────────────────

  function positionTooltip(step, rect) {
    if (step.isWelcome || step.isDone || !rect) {
      tooltipEl.style.top       = '50%';
      tooltipEl.style.left      = '50%';
      tooltipEl.style.transform = 'translate(-50%, -50%)';
      return;
    }

    tooltipEl.style.transform = '';
    const GAP = 14;
    const TW  = 290;
    const vw  = window.innerWidth;
    const vh  = window.innerHeight;
    const p   = step.placement;

    let top, left;

    if (p === 'right') {
      left = rect.left + rect.width + GAP;
      top  = Math.max(10, Math.min(rect.top, vh - 320));
    } else if (p === 'left') {
      left = rect.left - TW - GAP;
      top  = Math.max(10, Math.min(rect.top, vh - 320));
    } else if (p === 'bottom') {
      left = Math.max(10, Math.min(rect.left, vw - TW - 10));
      top  = rect.top + rect.height + GAP;
    } else if (p === 'top') {
      left = Math.max(10, Math.min(rect.left, vw - TW - 10));
      top  = rect.top - GAP - 240;
    } else {
      // center fallback
      tooltipEl.style.top       = '50%';
      tooltipEl.style.left      = '50%';
      tooltipEl.style.transform = 'translate(-50%, -50%)';
      return;
    }

    // Clamp left so tooltip stays on screen
    left = Math.max(10, Math.min(left, vw - TW - 10));
    // Clamp top
    top  = Math.max(10, Math.min(top, vh - 20));

    tooltipEl.style.top  = top  + 'px';
    tooltipEl.style.left = left + 'px';
  }

  // ── Render step ────────────────────────────────────────────────

  function renderStep(index) {
    const step = STEPS[index];
    const realIdx = STEPS.slice(0, index).filter(s => !s.isWelcome && !s.isDone).length;

    // Manage forced-visible elements
    forceShow(step.showIds || []);
    forceHideUnneeded(step.showIds || []);

    // Expand sidebar if needed
    ensureSidebar(step.sidebar);

    // Small delay so DOM has time to reflect hidden/shown changes
    const doRender = () => {
      const rect = getRect(step.target, step.isWelcome || step.isDone ? 0 : 8);
      setHole(rect);
      setRing(rect);
      buildTooltip(step, realIdx);
      positionTooltip(step, rect);

      // Re-trigger animation
      void tooltipEl.offsetWidth;
      tooltipEl.classList.add('tt-animate');
    };

    if ((step.showIds || []).length > 0) {
      setTimeout(doRender, 40);
    } else {
      doRender();
    }
  }

  function goTo(index) {
    if (index < 0 || index >= STEPS.length) return;
    currentStep = index;
    renderStep(currentStep);
  }

  // ── Tour lifecycle ─────────────────────────────────────────────

  function startTour() {
    if (isActive) return;
    isActive = true;
    currentStep = 0;

    svgEl.style.display   = 'block';
    ringEl.style.display  = 'none';
    tooltipEl.style.display = 'block';
    helpBtn.classList.add('tour-running');

    renderStep(0);
  }

  function endTour() {
    if (!isActive) return;
    isActive = false;

    restoreAll();

    svgEl.style.display     = 'none';
    ringEl.style.display    = 'none';
    tooltipEl.style.display = 'none';
    helpBtn.classList.remove('tour-running');

    localStorage.setItem(STORAGE_KEY, '1');
  }

  // ── Mount ──────────────────────────────────────────────────────

  function mount() {
    // SVG overlay
    svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.id = 'tour-overlay';
    svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgEl.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:none;';

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const mask = document.createElementNS('http://www.w3.org/2000/svg', 'mask');
    mask.id = 'tour-spotlight-mask';

    const maskBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    maskBg.setAttribute('width', '100%');
    maskBg.setAttribute('height', '100%');
    maskBg.setAttribute('fill', 'white');

    holeEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    holeEl.id = 'tour-hole';
    holeEl.setAttribute('rx', '8');
    holeEl.setAttribute('ry', '8');
    holeEl.setAttribute('fill', 'black');
    holeEl.style.x = '0px'; holeEl.style.y = '0px';
    holeEl.style.width = '0px'; holeEl.style.height = '0px';

    mask.appendChild(maskBg);
    mask.appendChild(holeEl);
    defs.appendChild(mask);

    const darkBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    darkBg.setAttribute('width', '100%');
    darkBg.setAttribute('height', '100%');
    darkBg.setAttribute('fill', 'rgba(0,0,0,0.72)');
    darkBg.setAttribute('mask', 'url(#tour-spotlight-mask)');

    svgEl.appendChild(defs);
    svgEl.appendChild(darkBg);

    // Ring
    ringEl = document.createElement('div');
    ringEl.id = 'tour-ring';
    ringEl.style.display = 'none';

    // Tooltip
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'tour-tooltip';
    tooltipEl.style.display = 'none';

    // Help button
    helpBtn = document.createElement('button');
    helpBtn.id = 'tour-help-btn';
    helpBtn.title = 'Show guide';
    helpBtn.setAttribute('aria-label', 'Show guide');
    helpBtn.textContent = '?';
    helpBtn.addEventListener('click', startTour);

    document.body.appendChild(svgEl);
    document.body.appendChild(ringEl);
    document.body.appendChild(tooltipEl);
    document.body.appendChild(helpBtn);

    // Click overlay to exit (but not on welcome step)
    svgEl.addEventListener('click', (e) => {
      if (e.target === svgEl || e.target === svgEl.querySelector('rect:last-child')) {
        if (isActive && !STEPS[currentStep].isWelcome) endTour();
      }
    });

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (!isActive) return;
      const s = STEPS[currentStep];
      if (e.key === 'Escape') endTour();
      if (e.key === 'ArrowRight' && !s.isWelcome && !s.isDone) goTo(currentStep + 1);
      if (e.key === 'ArrowLeft'  && currentStep > 1)           goTo(currentStep - 1);
    });

    // Reposition on resize
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (isActive) renderStep(currentStep); }, 120);
    });
  }

  // ── Init ───────────────────────────────────────────────────────

  function init() {
    mount();
    if (!localStorage.getItem(STORAGE_KEY)) {
      setTimeout(startTour, 800);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
