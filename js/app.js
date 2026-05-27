'use strict';

/* ── Constants ── */
const CONTINENT_NAMES = {
  AF: 'Africa', AN: 'Antarctica', AS: 'Asia',
  EU: 'Europe', NA: 'North America', OC: 'Oceania', SA: 'South America',
};

const CONTINENT_VIEWS = {
  AF: { center: [22,    5],  zoom: 3.0 },
  AN: { center: [0,   -80],  zoom: 2.0 },
  AS: { center: [100,  45],  zoom: 2.5 },
  EU: { center: [24,   53],  zoom: 3.5 },
  NA: { center: [-97,  52],  zoom: 2.5 },
  OC: { center: [148, -25],  zoom: 3.0 },
  SA: { center: [-60, -14],  zoom: 2.5 },
};

const CONTINENT_COLORS = {
  AF: '#e6a817', AN: '#74c476', AS: '#fd7f28',
  EU: '#4393c3', NA: '#d9534f', OC: '#20b2aa', SA: '#9b59b6',
};

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

/* ── State ── */
let state = {
  continent:   null,      // 'EU' | 'AS' | ...
  tiling:      'T6',
  tilesData:   null,      // raw GeoJSON from file
  aoi:         null,      // GeoJSON Feature (Polygon)
  intersecting: new Set(),
  drawMode:    null,      // null | 'bbox' | 'polygon'
  bboxAnchor:  null,      // [lng, lat] first corner for bbox
  polyVerts:   [],        // accumulated polygon vertices
};

/* ── DOM refs ── */
const $ = id => document.getElementById(id);
const tilingSection  = $('tiling-section');
const aoiSection     = $('aoi-section');
const statsSection   = $('stats-section');
const exportSection  = $('export-section');
const hintBanner     = $('hint-banner');
const loader         = $('loader');
const loaderMsg      = $('loader-msg');
const statInside     = $('stat-inside');
const statTotal      = $('stat-total');
const tileList       = $('tile-list');
const tileListWrap   = $('tile-list-wrap');
const clearAoiBtn    = $('btn-clear-aoi');

/* ── Map ── */
let map;

function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: MAP_STYLE,
    center: [15, 20],
    zoom: 1.8,
    maxZoom: 14,
  });

  map.on('load', onMapLoad);
}

function onMapLoad() {
  /* ── GeoJSON sources ── */
  // Zone hull polygons (one per continent; used for world-overview fill/click)
  map.addSource('zones', {
    type: 'geojson',
    data: emptyFC(),
    promoteId: 'id',
  });
  // Fixed label points so continent names stay well-placed
  map.addSource('continent-labels', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: Object.entries(CONTINENT_NAMES).map(([id, name]) => ({
        type: 'Feature',
        properties: { id, name, color: CONTINENT_COLORS[id] },
        geometry: { type: 'Point', coordinates: CONTINENT_VIEWS[id].center },
      })),
    },
  });
  map.addSource('tiles', {
    type: 'geojson',
    data: emptyFC(),
  });
  map.addSource('aoi', {
    type: 'geojson',
    data: emptyFC(),
  });
  map.addSource('draw-preview', {
    type: 'geojson',
    data: emptyFC(),
  });

  /* ── Zone hull layers (world overview) ── */
  map.addLayer({
    id: 'zones-fill',
    type: 'fill',
    source: 'zones',
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': [
        'case',
        ['boolean', ['feature-state', 'hover'],    false], 0.45,
        ['boolean', ['feature-state', 'selected'], false], 0.50,
        0.22,
      ],
    },
  });
  map.addLayer({
    id: 'zones-line',
    type: 'line',
    source: 'zones',
    paint: {
      'line-color': ['get', 'color'],
      'line-width': [
        'case',
        ['boolean', ['feature-state', 'selected'], false], 2.5,
        1.2,
      ],
      'line-opacity': 0.9,
    },
  });
  /* Continent name labels (hardcoded points, better placement than polygon centroids) */
  map.addLayer({
    id: 'continent-labels',
    type: 'symbol',
    source: 'continent-labels',
    layout: {
      'text-field': ['get', 'name'],
      'text-size': 13,
      'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
      'text-anchor': 'center',
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': ['get', 'color'],
      'text-halo-color': 'rgba(0,0,0,0.8)',
      'text-halo-width': 2,
    },
  });

  /* ── Tile layers ── */
  map.addLayer({
    id: 'tiles-fill',
    type: 'fill',
    source: 'tiles',
    paint: {
      'fill-color': [
        'case',
        ['==', ['get', 'status'], 'inside'],  ['get', 'color'],
        ['==', ['get', 'status'], 'outside'], '#555566',
        ['get', 'color'],
      ],
      'fill-opacity': [
        'case',
        ['==', ['get', 'status'], 'inside'],  0.55,
        ['==', ['get', 'status'], 'outside'], 0.08,
        0.2,
      ],
    },
  });
  map.addLayer({
    id: 'tiles-line',
    type: 'line',
    source: 'tiles',
    paint: {
      'line-color': [
        'case',
        ['==', ['get', 'status'], 'inside'],  ['get', 'color'],
        ['==', ['get', 'status'], 'outside'], '#555566',
        ['get', 'color'],
      ],
      'line-width': [
        'case',
        ['==', ['get', 'status'], 'inside'], 1.5,
        0.5,
      ],
      'line-opacity': [
        'case',
        ['==', ['get', 'status'], 'outside'], 0.25,
        0.75,
      ],
    },
  });

  /* ── Tile name labels ── */
  map.addLayer({
    id: 'tiles-label',
    type: 'symbol',
    source: 'tiles',
    minzoom: 4,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
      'text-size': [
        'interpolate', ['linear'], ['zoom'],
        4, 8,
        7, 11,
        10, 13,
      ],
      'text-anchor': 'center',
      'text-max-width': 10,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
    },
    paint: {
      'text-color': [
        'case',
        ['==', ['get', 'status'], 'inside'], '#ffffff',
        '#aaaaaa',
      ],
      'text-halo-color': 'rgba(0,0,0,0.75)',
      'text-halo-width': 1.2,
      'text-opacity': [
        'interpolate', ['linear'], ['zoom'],
        4, 0.5,
        6, 1.0,
      ],
    },
  });

  /* ── AOI layers ── */
  map.addLayer({
    id: 'aoi-fill',
    type: 'fill',
    source: 'aoi',
    paint: {
      'fill-color': '#ffffff',
      'fill-opacity': 0.08,
    },
  });
  map.addLayer({
    id: 'aoi-line',
    type: 'line',
    source: 'aoi',
    paint: {
      'line-color': '#ffffff',
      'line-width': 2,
      'line-dasharray': [4, 2.5],
    },
  });

  /* ── Draw-preview layers ── */
  map.addLayer({
    id: 'preview-fill',
    type: 'fill',
    source: 'draw-preview',
    paint: {
      'fill-color': '#58a6ff',
      'fill-opacity': 0.1,
    },
  });
  map.addLayer({
    id: 'preview-line',
    type: 'line',
    source: 'draw-preview',
    paint: {
      'line-color': '#58a6ff',
      'line-width': 1.8,
      'line-dasharray': [3, 2],
    },
  });
  map.addLayer({
    id: 'preview-points',
    type: 'circle',
    source: 'draw-preview',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 5,
      'circle-color': '#58a6ff',
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#fff',
    },
  });

  /* ── Map interactions ── */
  let hoveredZoneId = null;

  map.on('mousemove', 'zones-fill', e => {
    if (state.drawMode) return;
    map.getCanvas().style.cursor = 'pointer';
    if (e.features.length > 0) {
      if (hoveredZoneId !== null)
        map.setFeatureState({ source: 'zones', id: hoveredZoneId }, { hover: false });
      hoveredZoneId = e.features[0].id;
      map.setFeatureState({ source: 'zones', id: hoveredZoneId }, { hover: true });
    }
  });

  map.on('mouseleave', 'zones-fill', () => {
    if (state.drawMode) return;
    map.getCanvas().style.cursor = '';
    if (hoveredZoneId !== null)
      map.setFeatureState({ source: 'zones', id: hoveredZoneId }, { hover: false });
    hoveredZoneId = null;
  });

  map.on('click', 'zones-fill', e => {
    if (state.drawMode) return;
    selectContinent(e.features[0].properties.id);
  });

  /* drawing clicks */
  map.on('click', handleMapClick);
  map.on('mousemove', handleMouseMove);
  map.on('dblclick', handleDblClick);

  /* Escape cancels draw mode */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') disableDrawMode();
  });

  /* ── Load zone hull boundaries ── */
  fetch('data/zones/e7_zone_hulls.geojson')
    .then(r => r.json())
    .then(data => map.getSource('zones').setData(data))
    .catch(err => console.error('Failed to load zone hulls:', err));
}

/* ─────────── Continent selection ─────────── */
function selectContinent(id) {
  if (state.continent === id) return;

  // Deselect previous zone
  if (state.continent)
    map.setFeatureState({ source: 'zones', id: state.continent }, { selected: false });

  state.continent = id;
  state.tiling = currentTiling();
  state.aoi = null;
  state.intersecting = new Set();

  // Highlight selected zone; hide labels (not needed when zoomed in)
  map.setFeatureState({ source: 'zones', id }, { selected: true });
  map.setLayoutProperty('continent-labels', 'visibility', 'none');

  // Update sidebar buttons
  document.querySelectorAll('.cont-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.id === id);
  });

  // Show tiling + AOI sections
  tilingSection.hidden  = false;
  aoiSection.hidden     = false;
  statsSection.hidden   = true;
  exportSection.hidden  = true;
  clearAoiBtn.hidden    = true;

  // Reset AOI source
  map.getSource('aoi').setData(emptyFC());

  // Zoom to continent
  zoomToContinent(id);

  // Load tiles
  loadTiles(id, state.tiling);
}

function zoomToContinent(id) {
  const v = CONTINENT_VIEWS[id];
  if (!v) return;
  map.flyTo({ center: v.center, zoom: v.zoom, duration: 800 });
}

/* ─────────── Tiling radio ─────────── */
document.querySelectorAll('input[name="tiling"]').forEach(input => {
  input.addEventListener('change', () => {
    if (!state.continent) return;
    state.tiling = input.value;
    loadTiles(state.continent, state.tiling);
  });
});

function currentTiling() {
  return document.querySelector('input[name="tiling"]:checked')?.value || 'T6';
}

/* ─────────── Tile loading ─────────── */
async function loadTiles(continent, tiling) {
  showLoader(`Loading ${CONTINENT_NAMES[continent]} ${tiling} tiles…`);
  try {
    const url = `data/tiles/${continent.toLowerCase()}_${tiling.toLowerCase()}.geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.tilesData = await res.json();

    // Reset statuses
    state.tilesData.features.forEach(f => delete f.properties.status);
    map.getSource('tiles').setData(state.tilesData);

    statTotal.textContent = state.tilesData.features.length.toLocaleString();

    // Re-apply AOI if exists
    if (state.aoi) applyAOI(state.aoi, false);
  } catch (err) {
    console.error('Tile load error:', err);
  } finally {
    hideLoader();
  }
}

/* ─────────── AOI application ─────────── */
function applyAOI(geojson, zoomTo = true) {
  // Accept FeatureCollection (from uploaded file) or Feature
  let feat = geojson;
  if (geojson.type === 'FeatureCollection') {
    if (geojson.features.length === 0) return;
    // Merge all features into one polygon/multipolygon if needed
    feat = geojson.features.length === 1
      ? geojson.features[0]
      : turf.union(...geojson.features);
  }
  // Ensure it's a polygon
  if (!['Polygon', 'MultiPolygon'].includes(feat.geometry?.type)) return;

  state.aoi = feat;
  map.getSource('aoi').setData(feat);
  clearAoiBtn.hidden = false;

  if (zoomTo) {
    const bb = turf.bbox(feat);
    map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 80, duration: 600 });
  }

  computeIntersections();
}

function computeIntersections() {
  if (!state.tilesData || !state.aoi) return;

  showLoader('Computing intersections…');

  // Use setTimeout to allow UI to update before heavy computation
  setTimeout(() => {
    const insideSet = new Set();
    const updated = state.tilesData.features.map(f => {
      let intersects = false;
      try {
        intersects = turf.booleanIntersects(f, state.aoi);
      } catch (_) {}
      if (intersects) insideSet.add(f.properties.name);
      return {
        ...f,
        properties: { ...f.properties, status: intersects ? 'inside' : 'outside' },
      };
    });

    state.intersecting = insideSet;
    map.getSource('tiles').setData({
      type: 'FeatureCollection',
      features: updated,
    });

    updateStats(insideSet);
    hideLoader();
  }, 0);
}

function updateStats(insideSet) {
  const total = state.tilesData ? state.tilesData.features.length : 0;
  statInside.textContent = insideSet.size.toLocaleString();
  statTotal.textContent  = total.toLocaleString();
  statsSection.hidden    = false;
  exportSection.hidden   = insideSet.size === 0;

  // Show tile list only if manageable number
  tileList.innerHTML = '';
  if (insideSet.size > 0 && insideSet.size <= 200) {
    tileListWrap.hidden = false;
    insideSet.forEach(name => {
      const li = document.createElement('li');
      li.textContent = name;
      tileList.appendChild(li);
    });
  } else {
    tileListWrap.hidden = true;
  }
}

/* ─────────── Draw: Rectangle ─────────── */
$('btn-bbox').addEventListener('click', () => {
  if (state.drawMode === 'bbox') { disableDrawMode(); return; }
  disableDrawMode();
  state.drawMode = 'bbox';
  state.bboxAnchor = null;
  $('btn-bbox').classList.add('active');
  document.getElementById('map').classList.add('drawing');
  showHint('Click to set first corner of rectangle · Esc to cancel');
});

/* ─────────── Draw: Polygon ─────────── */
$('btn-poly').addEventListener('click', () => {
  if (state.drawMode === 'polygon') { disableDrawMode(); return; }
  disableDrawMode();
  state.drawMode = 'polygon';
  state.polyVerts = [];
  $('btn-poly').classList.add('active');
  document.getElementById('map').classList.add('drawing');
  showHint('Click to add vertices · Double-click to finish · Esc to cancel');
});

function handleMapClick(e) {
  if (!state.drawMode) return;

  const pt = [e.lngLat.lng, e.lngLat.lat];

  if (state.drawMode === 'bbox') {
    if (!state.bboxAnchor) {
      state.bboxAnchor = pt;
      showHint('Click to set opposite corner · Esc to cancel');
    } else {
      const [x1, y1] = state.bboxAnchor;
      const [x2, y2] = pt;
      const bbox = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
      const poly = turf.bboxPolygon(bbox);
      clearPreview();
      disableDrawMode();
      applyAOI(poly);
    }
    return;
  }

  if (state.drawMode === 'polygon') {
    state.polyVerts.push(pt);
    updatePolyPreview(null);
  }
}

function handleDblClick(e) {
  if (state.drawMode !== 'polygon') return;
  e.preventDefault();
  e.originalEvent.stopPropagation();

  if (state.polyVerts.length < 3) {
    showHint('Need at least 3 points to close polygon');
    return;
  }

  const ring = [...state.polyVerts, state.polyVerts[0]];
  const poly = turf.polygon([ring]);
  clearPreview();
  state.polyVerts = [];
  disableDrawMode();
  applyAOI(poly);
}

function handleMouseMove(e) {
  if (!state.drawMode) return;
  const pt = [e.lngLat.lng, e.lngLat.lat];

  if (state.drawMode === 'bbox' && state.bboxAnchor) {
    const [x1, y1] = state.bboxAnchor;
    const [x2, y2] = pt;
    const bbox = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
    map.getSource('draw-preview').setData(turf.bboxPolygon(bbox));
    return;
  }

  if (state.drawMode === 'polygon' && state.polyVerts.length > 0) {
    updatePolyPreview(pt);
  }
}

function updatePolyPreview(cursor) {
  const verts = cursor ? [...state.polyVerts, cursor] : state.polyVerts;
  if (verts.length < 2) {
    // Just show the single vertex as a point
    map.getSource('draw-preview').setData({
      type: 'FeatureCollection',
      features: state.polyVerts.map(v => turf.point(v)),
    });
    return;
  }

  const features = [
    turf.lineString([...verts, verts[0]]),
    ...state.polyVerts.map(v => turf.point(v)),
  ];
  map.getSource('draw-preview').setData({
    type: 'FeatureCollection',
    features,
  });
}

function clearPreview() {
  map.getSource('draw-preview').setData(emptyFC());
}

function disableDrawMode() {
  state.drawMode = null;
  state.bboxAnchor = null;
  state.polyVerts = [];
  $('btn-bbox').classList.remove('active');
  $('btn-poly').classList.remove('active');
  document.getElementById('map').classList.remove('drawing');
  hideHint();
  clearPreview();
}

/* ─────────── Clear AOI ─────────── */
clearAoiBtn.addEventListener('click', () => {
  state.aoi = null;
  state.intersecting = new Set();
  clearAoiBtn.hidden = true;
  statsSection.hidden = true;
  exportSection.hidden = true;
  map.getSource('aoi').setData(emptyFC());

  // Reset tile statuses
  if (state.tilesData) {
    const reset = {
      ...state.tilesData,
      features: state.tilesData.features.map(f => ({
        ...f,
        properties: { ...f.properties, status: undefined },
      })),
    };
    map.getSource('tiles').setData(reset);
  }
});

/* ─────────── File upload ─────────── */
$('upload-geojson').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  try {
    const text = await file.text();
    const geojson = JSON.parse(text);
    applyAOI(geojson);
  } catch (err) {
    alert('Could not parse GeoJSON: ' + err.message);
  }
});

$('upload-shp').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  showLoader('Parsing shapefile…');
  try {
    const buf = await file.arrayBuffer();
    const geojson = await shp(buf);
    hideLoader();
    applyAOI(geojson);
  } catch (err) {
    hideLoader();
    alert('Could not parse shapefile: ' + err.message);
  }
});

/* ─────────── Export ─────────── */
$('btn-export').addEventListener('click', () => {
  if (!state.tilesData || state.intersecting.size === 0) return;

  const features = state.tilesData.features.filter(
    f => state.intersecting.has(f.properties.name)
  );
  const fc = { type: 'FeatureCollection', features };
  const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `equi7_${state.continent}_${state.tiling}_tiles.geojson`;
  a.click();
  URL.revokeObjectURL(a.href);
});

/* ─────────── Continent sidebar buttons ─────────── */
document.querySelectorAll('.cont-btn').forEach(btn => {
  btn.addEventListener('click', () => selectContinent(btn.dataset.id));
});

/* ─────────── Utilities ─────────── */
function emptyFC() {
  return { type: 'FeatureCollection', features: [] };
}

function showHint(msg) {
  hintBanner.textContent = msg;
  hintBanner.hidden = false;
}

function hideHint() {
  hintBanner.hidden = true;
}

function showLoader(msg) {
  loaderMsg.textContent = msg;
  loader.hidden = false;
}

function hideLoader() {
  loader.hidden = true;
}

/* ─────────── Boot ─────────── */
initMap();
