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

// No-labels dark basemap so the 2D map matches the clean dark earth used on
// the 3D globe (city/road/place labels removed; only our own zone & tile
// labels and the white country borders remain — homogeneous with 3D).
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json';

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
  longName:    true,      // tile-name format: true = EU500M_E006N006T6, false = E006N006T6
  tileScope:   'all',     // which AOI tiles to list/copy/export: 'all' | 'land'
};

/* The AOI tile names matching the current scope ('all' or 'land'), sorted.
 * Land filtering uses the cached land set; if it isn't ready yet, falls back
 * to all (the count stat will fill in once computed). */
function activeTileNames() {
  let names = [...state.intersecting];
  if (state.tileScope === 'land') {
    const landSet = landSetCache[`${state.continent}_${state.tiling}`];
    if (landSet) names = names.filter(n => landSet.has(n));
  }
  return names.sort();
}

/* Format a raw tile name (e.g. "EU_E006N006T6") for display.
 *  short → strip the "XX_" continent prefix  → "E006N006T6"
 *  long  → "<CONT><SAMPLING>M_<grid>"        → "EU500M_E006N006T6"
 */
function formatTileName(rawName) {
  const grid = rawName.replace(/^[A-Z]{2}_/, '');   // drop continent prefix
  if (!state.longName) return grid;
  const sampling = Math.max(1, parseInt($('sampling-input')?.value) || 500);
  return `${state.continent || ''}${sampling}M_${grid}`;
}


/* ── DOM refs ── */
const $ = id => document.getElementById(id);
const tilingSection  = $('tiling-section');
const statsSection   = $('stats-section');
const aoiResults     = $('aoi-results');
const statLand       = $('stat-land');
const statInsideLand = $('stat-inside-land');
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
  // Canonical Equi7Grid 7-zone partition (spherical Voronoi based on AEQD
  // origins).  Every point on Earth belongs to exactly one zone.
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
  // Zone outlines split into normal borders (solid) and antimeridian-seam
  // segments (dashed + mild) so the harsh vertical line at ±180° is softened
  // without affecting any other zone boundary.
  map.addSource('zones-border', { type: 'geojson', data: emptyFC() });
  map.addSource('zones-seam',   { type: 'geojson', data: emptyFC() });
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

  // No country-border overlay in 2D — the CARTO basemap already renders
  // subtle country borders. Adding white lines on top caused very visible
  // "horizontal lines" across zone fills (many African borders follow parallels).

  /* ── Zone layers (canonical 7-zone partition) ── */
  map.addLayer({
    id: 'zones-fill',
    type: 'fill',
    source: 'zones',
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': [
        'case',
        ['boolean', ['feature-state', 'hover'],    false], 0.55,
        ['boolean', ['feature-state', 'selected'], false], 0.60,
        0.45,
      ],
    },
  });
  // Normal zone borders — solid white (seam segments excluded, drawn separately)
  map.addLayer({
    id: 'zones-line',
    type: 'line',
    source: 'zones-border',
    paint: {
      'line-color': '#ffffff',
      'line-width': 1.2,
      'line-opacity': 0.7,
    },
  });
  // Antimeridian seam — mild dashed line so it doesn't read as a hard border
  map.addLayer({
    id: 'zones-seam-line',
    type: 'line',
    source: 'zones-seam',
    paint: {
      'line-color': '#ffffff',
      'line-width': 1,
      'line-opacity': 0.25,
      'line-dasharray': [3, 3],
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
    if (e.features.length === 0) return;
    const id = e.features[0].properties.id;
    if (id === hoveredZoneId) return;
    if (hoveredZoneId)
      map.setFeatureState({ source: 'zones', id: hoveredZoneId }, { hover: false });
    hoveredZoneId = id;
    map.setFeatureState({ source: 'zones', id }, { hover: true });
  });

  map.on('mouseleave', 'zones-fill', () => {
    if (state.drawMode) return;
    map.getCanvas().style.cursor = '';
    if (hoveredZoneId)
      map.setFeatureState({ source: 'zones', id: hoveredZoneId }, { hover: false });
    hoveredZoneId = null;
  });

  map.on('click', 'zones-fill', e => {
    if (state.drawMode) return;
    const id = e.features[0]?.properties?.id;
    if (id) selectContinent(id);
  });

  /* drawing clicks */
  map.on('click', handleMapClick);
  map.on('mousemove', handleMouseMove);
  map.on('dblclick', handleDblClick);

  /* Escape cancels draw mode */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') disableDrawMode();
  });

  /* ── Load canonical Equi7Grid zone boundaries ── */
  fetch('data/zones/e7_zones.geojson')
    .then(r => r.json())
    .then(data => {
      map.getSource('zones').setData(data);
      const { border, seam } = splitZoneBorders(data);
      map.getSource('zones-border').setData(border);
      map.getSource('zones-seam').setData(seam);
      zonesGeoJSON = data;
      // Pre-compute globe zone data once — zones never change
      zonePaths = featuresToPaths(data.features, f => ({
        id: f.properties.id, color: f.properties.color, kind: 'zone',
      }), 0.015);
      zonesPolygons = prepareGlobeZones(data.features);
    })
    .catch(err => console.error('Failed to load zones:', err));
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

  // Highlight selected zone; hide overview labels when zoomed in
  map.setFeatureState({ source: 'zones', id }, { selected: true });
  map.setLayoutProperty('continent-labels', 'visibility', 'none');

  // Show tiling section, reset stats display
  tilingSection.hidden  = false;
  $('no-selection-hint').hidden = true;
  statsSection.hidden   = true;   // shown again once tiles load
  exportSection.hidden  = true;
  clearAoiBtn.hidden    = true;
  $('aoi-clear-divider').hidden = true;
  aoiResults.hidden     = true;
  statLand.textContent  = '—';
  statInsideLand.textContent = '—';

  // Reset AOI source
  map.getSource('aoi').setData(emptyFC());

  // Zoom to continent (map or globe), centering on the zone like 2D
  if (viewIs3D && globeInstance) {
    const v = CONTINENT_VIEWS[id];
    // Derive a globe altitude from the 2D zoom so framing matches (bigger
    // continents → higher altitude). Lower altitude = more zoomed in.
    if (v) globeInstance.pointOfView({ lat: v.center[1], lng: v.center[0], altitude: 4.5 / v.zoom }, 500);
  } else {
    zoomToContinent(id);
  }

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
    statsSection.hidden = false;
    computeLandTiles();

    // Re-apply AOI if exists
    if (state.aoi) applyAOI(state.aoi, false);
    // Sync tile data to globe if in 3D mode
    refreshGlobeData();
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
  $('aoi-clear-divider').hidden = false;

  if (zoomTo) {
    const bb = turf.bbox(feat);
    if (viewIs3D && globeInstance) {
      const lat = (bb[1] + bb[3]) / 2, lng = (bb[0] + bb[2]) / 2;
      const span = Math.max(bb[2] - bb[0], bb[3] - bb[1]);
      globeInstance.pointOfView({ lat, lng, altitude: Math.max(0.1, Math.min(3, span / 55)) }, 600);
    } else {
      map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 80, duration: 600 });
    }
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
    const updatedFC = { type: 'FeatureCollection', features: updated };
    map.getSource('tiles').setData(updatedFC);
    // Keep tilesData in sync so globe refresh picks up statuses
    state.tilesData = updatedFC;

    refreshGlobeData();
    updateStats(insideSet);
    hideLoader();
  }, 0);
}

/* ─── Land-tile computation ─── */
let landSetCache = {};     // key: 'CONTINENT_TILING' → Set<tileName> (tiles touching land)
let landSetPromise = {};   // key → Promise<Set> (in-flight computation)
let countryBBoxCache = null;

/* Returns a Promise<Set<tileName>> of tiles that touch any country polygon,
 * for the current continent+tiling. Cached per key. */
function getLandSet() {
  if (!state.tilesData || !state.continent) return Promise.resolve(new Set());
  const key = `${state.continent}_${state.tiling}`;
  if (landSetCache[key]) return Promise.resolve(landSetCache[key]);
  if (landSetPromise[key]) return landSetPromise[key];

  const tilesSnap = state.tilesData;
  const p = fetchCountries().then(fc => new Promise(resolve => {
    if (!countryBBoxCache) countryBBoxCache = fc.features.map(f => turf.bbox(f));
    setTimeout(() => {
      const set = new Set();
      for (const tile of tilesSnap.features) {
        const tb = turf.bbox(tile);
        const hits = fc.features.filter((_, i) => {
          const cb = countryBBoxCache[i];
          return !(tb[2] < cb[0] || tb[0] > cb[2] || tb[3] < cb[1] || tb[1] > cb[3]);
        });
        if (hits.some(c => { try { return turf.booleanIntersects(tile, c); } catch (_) { return false; } }))
          set.add(tile.properties.name);
      }
      landSetCache[key] = set;
      delete landSetPromise[key];
      resolve(set);
    }, 0);
  }));
  landSetPromise[key] = p;
  return p;
}

/* Total land tiles in the current E7 zone (stat card). */
function computeLandTiles() {
  if (!state.tilesData || !state.continent) return;
  statLand.textContent = '…';
  getLandSet().then(set => {
    if (state.continent) statLand.textContent = set.size.toLocaleString();
  }).catch(() => { statLand.textContent = '?'; });
}

/* ─── Tile list renderer (truncated, formatted names) ─── */
function renderTileList() {
  if (state.intersecting.size === 0) { tileListWrap.hidden = true; return; }
  tileListWrap.hidden = false;

  const names = activeTileNames();
  const countEl = $('tile-list-count');
  if (countEl) countEl.textContent = names.length.toLocaleString();

  const fmt = formatTileName;

  const MAX_HEAD = 6, MAX_TAIL = 3, THRESHOLD = MAX_HEAD + MAX_TAIL + 1;
  tileList.innerHTML = '';
  const addLi = (text, cls) => {
    const li = document.createElement('li');
    li.textContent = text;
    if (cls) li.className = cls;
    tileList.appendChild(li);
  };

  if (names.length <= THRESHOLD) {
    names.forEach(n => addLi(fmt(n)));
  } else {
    names.slice(0, MAX_HEAD).forEach(n => addLi(fmt(n)));
    addLi(`··· ${names.length - MAX_HEAD - MAX_TAIL} more ···`, 'tile-ellipsis');
    names.slice(-MAX_TAIL).forEach(n => addLi(fmt(n)));
  }
}

function updateStats(insideSet) {
  statInside.textContent = insideSet.size.toLocaleString();
  exportSection.hidden   = insideSet.size === 0;

  if (insideSet.size === 0) {
    aoiResults.hidden = true;
    return;
  }
  aoiResults.hidden = false;

  // AOI tiles that are also on land = intersection of insideSet and the land set
  statInsideLand.textContent = '…';
  getLandSet().then(landSet => {
    let n = 0;
    insideSet.forEach(name => { if (landSet.has(name)) n++; });
    statInsideLand.textContent = n.toLocaleString();
    // Land set may have resolved after the first render — refresh if scoped to land
    if (state.tileScope === 'land') renderTileList();
  }).catch(() => { statInsideLand.textContent = '?'; });

  renderTileList();
}

/* ─────────── Draw: Rectangle ─────────── */
$('btn-bbox').addEventListener('click', () => {
  if (state.drawMode === 'bbox') { disableDrawMode(); return; }
  disableDrawMode();
  state.drawMode = 'bbox';
  state.bboxAnchor = null;
  $('btn-bbox').classList.add('active');
  document.getElementById(viewIs3D ? 'globe-wrap' : 'map').classList.add('drawing');
  showHint('Click to set first corner of rectangle · Esc to cancel');
});

/* ─────────── Draw: Polygon ─────────── */
$('btn-poly').addEventListener('click', () => {
  if (state.drawMode === 'polygon') { disableDrawMode(); return; }
  disableDrawMode();
  state.drawMode = 'polygon';
  state.polyVerts = [];
  $('btn-poly').classList.add('active');
  document.getElementById(viewIs3D ? 'globe-wrap' : 'map').classList.add('drawing');
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
  if (e.preventDefault) e.preventDefault();
  if (e.originalEvent?.stopPropagation) e.originalEvent.stopPropagation();

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
    setDrawPreview(turf.bboxPolygon(bbox));
    return;
  }

  if (state.drawMode === 'polygon' && state.polyVerts.length > 0) {
    updatePolyPreview(pt);
  }
}

/* Push draw-preview geometry to both the 2D map source and (in 3D) the globe. */
function setDrawPreview(data) {
  map.getSource('draw-preview').setData(data);
  if (viewIs3D) renderGlobePreview(data);
}

function updatePolyPreview(cursor) {
  const verts = cursor ? [...state.polyVerts, cursor] : state.polyVerts;
  if (verts.length < 2) {
    setDrawPreview({
      type: 'FeatureCollection',
      features: state.polyVerts.map(v => turf.point(v)),
    });
    return;
  }

  const features = [
    turf.lineString([...verts, verts[0]]),
    ...state.polyVerts.map(v => turf.point(v)),
  ];
  setDrawPreview({ type: 'FeatureCollection', features });
}

function clearPreview() {
  map.getSource('draw-preview').setData(emptyFC());
  globePreviewPaths = [];
  if (globeInstance) { globeInstance.pointsData([]); applyGlobePaths(); }
}

function disableDrawMode() {
  state.drawMode = null;
  state.bboxAnchor = null;
  state.polyVerts = [];
  $('btn-bbox').classList.remove('active');
  $('btn-poly').classList.remove('active');
  document.getElementById('map').classList.remove('drawing');
  document.getElementById('globe-wrap').classList.remove('drawing');
  hideHint();
  clearPreview();
}

/* ─────────── Clear AOI ─────────── */
clearAoiBtn.addEventListener('click', () => {
  state.aoi = null;
  state.intersecting = new Set();
  clearAoiBtn.hidden = true;
  $('aoi-clear-divider').hidden = true;
  aoiResults.hidden = true;
  exportSection.hidden = true;
  // Keep statsSection visible (still shows total + on-land counts)
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
    state.tilesData = reset;
    map.getSource('tiles').setData(reset);
    refreshGlobeData();
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
/* ─────────── Tile list controls (sampling, long/short, copy) ─────────── */
function setNameMode(long) {
  state.longName = long;
  $('btn-name-long').classList.toggle('active', long);
  $('btn-name-short').classList.toggle('active', !long);
  if (state.intersecting.size > 0) renderTileList();
}
$('btn-name-long').addEventListener('click', () => setNameMode(true));
$('btn-name-short').addEventListener('click', () => setNameMode(false));

function setTileScope(scope) {
  state.tileScope = scope;
  $('btn-scope-all').classList.toggle('active', scope === 'all');
  $('btn-scope-land').classList.toggle('active', scope === 'land');
  if (state.intersecting.size > 0) renderTileList();
}
$('btn-scope-all').addEventListener('click', () => setTileScope('all'));
$('btn-scope-land').addEventListener('click', () => {
  // Ensure the land set is computed, then switch (list refreshes on resolve)
  getLandSet().then(() => { if (state.tileScope === 'land') renderTileList(); });
  setTileScope('land');
});

$('sampling-input').addEventListener('input', () => {
  if (state.intersecting.size > 0) renderTileList();
});

/* Copy text to clipboard with a fallback for non-secure / blocked contexts.
 * The async Clipboard API silently fails in some browsers/iframes, so we
 * fall back to a hidden <textarea> + execCommand('copy') which always works
 * inside a user-gesture handler. Returns a Promise<boolean>. */
function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
  }
  return Promise.resolve(fallbackCopy(text));
}
function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);   // iOS/Safari needs explicit range
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (_) { return false; }
}

$('btn-copy-tiles').addEventListener('click', () => {
  const names = activeTileNames();   // respects All / On-land scope
  const formatted = names.map(formatTileName);
  const pyList = '[' + formatted.map(n => `'${n}'`).join(', ') + ']';

  copyToClipboard(pyList).then(ok => {
    const btn = $('btn-copy-tiles');
    if (ok) {
      btn.classList.add('copied');
      btn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polyline points="2 8 6 12 14 4"/></svg> Copied ' + names.length + '!';
    } else {
      btn.textContent = 'Copy failed';
    }
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="8" height="9" rx="1"/><path d="M3 11V3a1 1 0 011-1h7"/></svg> Copy';
    }, 2000);
  });
});

$('btn-export').addEventListener('click', () => {
  if (!state.tilesData || state.intersecting.size === 0) return;

  const nameSet = new Set(activeTileNames());   // respects All / On-land scope
  const features = state.tilesData.features.filter(f => nameSet.has(f.properties.name));
  const fc = { type: 'FeatureCollection', features };
  const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const scope = state.tileScope === 'land' ? 'land' : 'aoi';
  a.download = `equi7_${state.continent}_${state.tiling}_${scope}_tiles.geojson`;
  a.click();
  URL.revokeObjectURL(a.href);
});


/* ─────────── Sidebar collapse / expand ─────────── */
$('sidebar-toggle').addEventListener('click', () => {
  document.body.classList.toggle('sidebar-collapsed');
  // Trigger MapLibre resize so it fills the new canvas dimensions
  setTimeout(() => map.resize(), 30);
});

/* ─────────── 2D / 3D view toggle ─────────── */
let viewIs3D    = false;
let savedCamera = null;
let globeInstance = null;
let zonesGeoJSON  = null;

// Harvested three.js classes (from globe.gl's own bundle) + merged tile mesh.
let THREEC   = null;   // { LineSegments, BufferGeometry, BufferAttribute, LineBasicMaterial }
let tileMesh = null;   // single merged LineSegments object for ALL tiles
let globeGroup = null; // the ThreeGlobe group (parent for correct getCoords frame)

let zonePaths        = null;  // cached after first zones load — never changes
let zonesPolygons    = null;  // cached after first zones load — never changes
let tileMeshKey      = '';    // 'CONTINENT_TILING' — skip geometry rebuild when unchanged
let featureVertCounts = [];   // vertex count per tile feature in the merged mesh

/* -- helpers -- */
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function hexToRgb01(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
  };
}

/* Harvest three.js constructors from globe.gl's own scene (same instance =
 * zero version-mismatch risk). Also locate the ThreeGlobe group so our merged
 * mesh shares the exact coordinate frame getCoords() uses. */
function ensureThree() {
  if (THREEC && globeGroup) return true;
  if (!globeInstance) return false;
  const scene = globeInstance.scene();
  let seg = null, sphereMesh = null;
  scene.traverse(o => {
    if (!seg && o.type === 'LineSegments' && o.material && o.material.type === 'LineBasicMaterial') seg = o;
    if (!sphereMesh && o.geometry && o.geometry.type === 'SphereGeometry') sphereMesh = o;
  });
  if (seg && sphereMesh) {
    // SphereGeometry's position attribute is a plain (non-interleaved)
    // BufferAttribute; its base class is BufferGeometry. Harvest both safely.
    const sphereGeomCtor = sphereMesh.geometry.constructor;
    THREEC = {
      LineSegments:      seg.constructor,
      LineBasicMaterial: seg.material.constructor,
      BufferGeometry:    Object.getPrototypeOf(sphereGeomCtor.prototype).constructor,
      BufferAttribute:   sphereMesh.geometry.getAttribute('position').constructor,
    };
    // The globe sphere sits at the scene origin (identity transform), so
    // getCoords() returns scene-space positions — add the merged mesh there.
    globeGroup = scene;
  }
  return !!(THREEC && globeGroup);
}

/* Build ONE merged LineSegments for all tiles → a single draw call.
 * If the continent+tiling key is unchanged (only AOI status changed),
 * skip the geometry rebuild and update just the color buffer in-place. */
function buildTileMesh() {
  if (!state.tilesData || !state.continent || !ensureThree()) return false;

  const newKey = `${state.continent}_${state.tiling}`;

  if (tileMesh && newKey === tileMeshKey) {
    updateTileMeshColors();
    return true;
  }

  // Full geometry rebuild — continent or tiling changed
  if (tileMesh) {
    tileMesh.parent && tileMesh.parent.remove(tileMesh);
    tileMesh.geometry.dispose();
    tileMesh.material.dispose();
    tileMesh = null;
  }
  tileMeshKey = newKey;
  featureVertCounts = [];

  const ALT = 0.05;
  const positions = [];
  const colors = [];
  const DEG = Math.PI / 180;
  const R = 100 * (1 + ALT);

  for (const f of state.tilesData.features) {
    const rgb = hexToRgb01(f.properties.color);
    const dim = f.properties.status === 'inside' ? 1.0
              : f.properties.status === 'outside' ? 0.15   // nearly invisible — matches 2D
              : 0.78;
    const cr = rgb.r * dim, cg = rgb.g * dim, cb = rgb.b * dim;

    const ring = f.geometry.coordinates[0];
    const step = Math.max(1, Math.min(3, Math.floor((ring.length - 1) / 8)));
    const xyz = [];
    const pushXY = (lng, lat) => {
      const phi = (90 - lat) * DEG, theta = (90 - lng) * DEG;
      const sp = Math.sin(phi);
      xyz.push([R * sp * Math.cos(theta), R * Math.cos(phi), R * sp * Math.sin(theta)]);
    };
    for (let i = 0; i < ring.length; i += step) pushXY(ring[i][0], ring[i][1]);
    const last = ring[ring.length - 1];
    const lastIdx = ring.length - 1 - ((ring.length - 1) % step);
    if (lastIdx !== ring.length - 1) pushXY(last[0], last[1]);

    featureVertCounts.push((xyz.length - 1) * 2); // 2 verts per segment

    for (let i = 0; i < xyz.length - 1; i++) {
      const a = xyz[i], b = xyz[i + 1];
      positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      colors.push(cr, cg, cb, cr, cg, cb);
    }
  }

  const geom = new THREEC.BufferGeometry();
  geom.setAttribute('position', new THREEC.BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute('color',    new THREEC.BufferAttribute(new Float32Array(colors), 3));
  const mat = new THREEC.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 });
  tileMesh = new THREEC.LineSegments(geom, mat);
  tileMesh.renderOrder = 2;
  globeGroup.add(tileMesh);
  return true;
}

/* Update only the color buffer when AOI status changes — no geometry rebuild. */
function updateTileMeshColors() {
  if (!tileMesh || !state.tilesData) return;
  const arr = tileMesh.geometry.attributes.color.array;
  let vi = 0;
  for (let fi = 0; fi < state.tilesData.features.length; fi++) {
    const f = state.tilesData.features[fi];
    const rgb = hexToRgb01(f.properties.color);
    const dim = f.properties.status === 'inside' ? 1.0
              : f.properties.status === 'outside' ? 0.15   // nearly invisible — matches 2D
              : 0.78;
    const cr = rgb.r * dim, cg = rgb.g * dim, cb = rgb.b * dim;
    const count = featureVertCounts[fi] || 0;
    for (let i = 0; i < count; i++, vi++) {
      arr[vi * 3]     = cr;
      arr[vi * 3 + 1] = cg;
      arr[vi * 3 + 2] = cb;
    }
  }
  tileMesh.geometry.attributes.color.needsUpdate = true;
}

/* Build transparent polygon features — invisible fill, only for Three.js click raycasting */
function prepareGlobeZones(features) {
  return features.map(f => ({ ...f, properties: { ...f.properties, _type: 'zone' } }));
}

let countryPaths = [];   // loaded once from world-atlas, persists across globe rebuilds

/*
 * Convert GeoJSON polygons → globe.gl path objects with embedded altitude.
 * `step` decimates dense rings (keeps every Nth vertex) to cut the amount of
 * tube geometry three-globe must build — the single biggest perf lever.
 */
function featuresToPaths(features, extraProps, alt = 0.004, step = 1) {
  const paths = [];
  features.forEach(feat => {
    const geom = feat.geometry;
    if (!geom) return;
    const polys = geom.type === 'Polygon'      ? [geom.coordinates]
                : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    polys.forEach(poly => {
      const ring = poly[0];
      // Adaptive decimation: never reduce a ring below ~8 segments, so small
      // rings (e.g. T1 tile squares with only 5 vertices) are kept intact and
      // don't collapse into triangles.
      const effStep = Math.max(1, Math.min(step, Math.floor((ring.length - 1) / 8)));
      const coords = [];
      for (let i = 0; i < ring.length; i += effStep) {
        coords.push({ lat: ring[i][1], lng: ring[i][0], alt });
      }
      // always include the closing vertex so the ring stays closed
      const last = ring[ring.length - 1];
      const tail = coords[coords.length - 1];
      if (tail.lat !== last[1] || tail.lng !== last[0]) {
        coords.push({ lat: last[1], lng: last[0], alt });
      }
      paths.push({ ...extraProps(feat), coords });
    });
  });
  return paths;
}

/* Shared, cached fetch of 110m country borders (used by both 2D map and globe) */
let countryGeoJSON = null;
async function fetchCountries() {
  if (countryGeoJSON) return countryGeoJSON;
  const res  = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json');
  const topo = await res.json();
  countryGeoJSON = topojson.feature(topo, topo.objects.countries);
  return countryGeoJSON;
}

/* Build globe country border paths once; cached across globe rebuilds */
async function loadCountryBorders() {
  if (countryPaths.length) { refreshGlobeData(); return; }
  try {
    const fc = await fetchCountries();
    countryPaths = featuresToPaths(
      fc.features,
      () => ({ kind: 'country', color: 'rgba(255,255,255,0.92)' }),
      0.01   // above the zone fill (0.004) so borders stay crisp over the colors
    );
    refreshGlobeData();
  } catch (e) {
    console.warn('Country borders load failed:', e);
  }
}

/*
 * Visual rendering:
 *   • pathsData   → country borders + zone borders (few objects, fine as paths)
 *   • tileMesh    → ALL tiles merged into ONE LineSegments = a single draw call
 *                   (this is what makes dense T1 fast — same batching MapLibre
 *                   does internally; thousands of tiles cost one draw call)
 *   • polygonsData → transparent zone fills for click raycasting
 *
 * If three.js can't be harvested (unexpected), tiles fall back to per-tile
 * paths so nothing breaks.
 */
/* Densify a polygon feature's edges (insert points every ~maxStep degrees in
 * lat/lng) so that when drawn on the globe the boundary follows the curvature
 * instead of cutting straight chords below the surface. */
function densifyFeature(feat, maxStep = 1.5) {
  const densifyRing = ring => {
    const out = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      const segs = Math.max(1, Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) / maxStep));
      for (let j = 0; j < segs; j++) out.push([x1 + (x2 - x1) * j / segs, y1 + (y2 - y1) * j / segs]);
    }
    out.push(ring[ring.length - 1]);
    return out;
  };
  const g = feat.geometry;
  const map1 = poly => poly.map(densifyRing);
  const coords = g.type === 'Polygon'      ? map1(g.coordinates)
               : g.type === 'MultiPolygon' ? g.coordinates.map(map1)
               : g.coordinates;
  return { type: 'Feature', properties: feat.properties || {},
           geometry: { type: g.type, coordinates: coords } };
}

/* Combine cached base paths with any live draw-preview paths and push to the
 * globe in a single call (avoids a full refreshGlobeData on every mousemove). */
let globeBasePaths    = [];
let globePreviewPaths = [];
function applyGlobePaths() {
  if (globeInstance) globeInstance.pathsData([...globeBasePaths, ...globePreviewPaths]);
}

/* Render the in-progress draw preview on the globe from the same GeoJSON the
 * 2D map uses — blue dashed outline + blue vertex dots (mirrors the 2D style). */
function renderGlobePreview(data) {
  if (!globeInstance) return;
  const feats = !data ? []
              : data.type === 'FeatureCollection' ? data.features
              : [data];
  const lineFeats = [], ptCoords = [];
  for (const f of feats) {
    const t = f.geometry?.type;
    if (t === 'Polygon' || t === 'MultiPolygon') lineFeats.push(densifyFeature(f));
    else if (t === 'LineString') {
      lineFeats.push(densifyFeature({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [f.geometry.coordinates] } }));
    } else if (t === 'Point') ptCoords.push({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] });
  }
  globePreviewPaths = lineFeats.length
    ? featuresToPaths(lineFeats, () => ({ kind: 'preview' }), 0.092)
    : [];
  globeInstance.pointsData(ptCoords);
  applyGlobePaths();
}

function refreshGlobeData() {
  if (!globeInstance || !zonesGeoJSON || !viewIs3D) return;

  // Polygon fills for zone click detection — set once from cache
  globeInstance.polygonsData(zonesPolygons || prepareGlobeZones(zonesGeoJSON.features));

  // Try the fast merged-mesh path for tiles; fall back to per-tile paths.
  const merged = buildTileMesh();

  const zp = zonePaths || featuresToPaths(zonesGeoJSON.features, f => ({
    id: f.properties.id, color: f.properties.color, kind: 'zone',
  }), 0.015);
  const tilePaths = (!merged && state.tilesData && state.continent)
    ? featuresToPaths(state.tilesData.features, f => ({
        color: f.properties.color, status: f.properties.status, kind: 'tile',
      }), 0.05, 3)
    : [];
  // AOI boundary — densified so edges hug the sphere (no submerged chords),
  // lifted to 0.09 (above tiles at 0.05) so it floats clearly on the surface.
  const aoiPaths = state.aoi?.geometry
    ? featuresToPaths([densifyFeature(state.aoi)], () => ({ kind: 'aoi' }), 0.09)
    : [];
  globeBasePaths = [...countryPaths, ...zp, ...tilePaths, ...aoiPaths];
  applyGlobePaths();

  // Cache tile centroids once per tile-set; labels are filtered by zoom below.
  tileCentroids = (state.tilesData && state.continent)
    ? state.tilesData.features.map(f => {
        const ring = f.geometry.coordinates[0];
        let sx = 0, sy = 0, n = 0;
        for (let i = 0; i < ring.length - 1; i++) { sx += ring[i][0]; sy += ring[i][1]; n++; }
        return { name: f.properties.name, lat: sy / n, lng: sx / n,
                 status: f.properties.status };   // carry status for label colour
      })
    : [];
  updateTileLabels();
}

/* ── Zoom-gated tile labels (mirrors 2D map's zoom-based label reveal) ── */
let tileCentroids = [];
let lastLabelKey  = '';      // skip rebuilds when the visible set is unchanged
const MAX_LABELS  = 160;     // each label is a 3D-text mesh + draw call; keep modest

// Per-level: max camera altitude at which labels appear + their arc-size
// (label height in angular degrees). Sizes follow the real 600/300/100 km
// tile ratio (6:3:1) so each name fits neatly inside its own tile, mirroring
// the 2D map where labels stay contained within tile bounds.
// size is in angular degrees (label height). Calibrated so labels read clearly
// at each level's maxAlt (most zoomed-out view) and stay inside their tiles
// when fully zoomed in — matching the proportional feel of the 2D map labels.
const LABEL_CFG = {
  T6: { maxAlt: 3.0,  size: 0.20 },
  T3: { maxAlt: 1.1,  size: 0.16 },
  T1: { maxAlt: 0.40, size: 0.055 },
};

/* great-circle angular distance between two lat/lng points, in degrees */
function angDistDeg(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const a = lat1 * r, b = lat2 * r, d = (lng2 - lng1) * r;
  const c = Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(d);
  return Math.acos(Math.min(1, Math.max(-1, c))) / r;
}

function setLabels(arr) {
  // Rebuilding 3D-text meshes is expensive — skip if the set is identical.
  const key = arr.map(t => t.name).join('|');
  if (key === lastLabelKey) return;
  lastLabelKey = key;
  globeInstance.labelsData(arr);
}

function updateTileLabels() {
  if (!globeInstance) return;
  if (!tileCentroids.length) { setLabels([]); return; }

  const pov = globeInstance.pointOfView();
  const cfg = LABEL_CFG[state.tiling] || LABEL_CFG.T6;

  // Too far out for this tiling level → no labels (not enough space)
  if (pov.altitude > cfg.maxAlt) { setLabels([]); return; }

  // Only label tiles inside the visible cap facing the camera
  const visR = Math.acos(1 / (1 + pov.altitude)) * 180 / Math.PI * 0.95;

  const visible = [];
  for (const t of tileCentroids) {
    const dist = angDistDeg(pov.lat, pov.lng, t.lat, t.lng);
    if (dist <= visR) visible.push({ ...t, size: cfg.size, _d: dist });
  }
  // Nearest-to-center first, capped, so perf stays bounded at any zoom
  visible.sort((a, b) => a._d - b._d);
  setLabels(visible.slice(0, MAX_LABELS));
}

/*
 * Labels are 3D-text meshes — rebuilding/rendering them while the camera moves
 * is what causes stutter. So we HIDE labels during any motion and show them
 * only once the camera settles (~220ms idle). Motion stays buttery; labels pop
 * in when you stop to read them. onZoom fires continuously during drag/zoom/
 * spin, so each event hides labels and resets the settle timer.
 */
let labelTimer = null;
function scheduleTileLabelUpdate() {
  setLabels([]);                       // hide instantly while moving
  clearTimeout(labelTimer);
  labelTimer = setTimeout(updateTileLabels, 220);
}

/* Fully tear down the globe and free its WebGL context (prevents it from
 * competing with MapLibre's renderer and slowing 2D after a 3D session). */
function destroyGlobe() {
  if (!globeInstance) return;
  if (tileMesh) {
    try { tileMesh.geometry.dispose(); tileMesh.material.dispose(); } catch (_) {}
    tileMesh = null;
  }
  globeGroup = null;            // belongs to the destroyed scene
  try { globeInstance._destructor(); } catch (_) {}
  $('globe-wrap').innerHTML = '';   // remove the canvas
  globeInstance = null;
}

/* Convert Mercator tile row → latitude (degrees) */
function tile2lat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/*
 * Composite CARTO dark-matter-nolabels raster tiles onto a canvas then use
 * it as the globe texture — same base style as the 2D MapLibre basemap.
 * Canvas approach avoids any z-fighting between tile quads and the sphere.
 * Zoom 2 (4×4 = 16 tiles) gives enough detail to show coastlines and borders
 * without over-resolving individual roads that bleed through zone fills.
 */
async function initCartoBgTiles() {
  const ZOOM = 2, N = Math.pow(2, ZOOM), TILE = 256;
  const canvas = document.createElement('canvas');
  canvas.width  = N * TILE;   // 1024 px
  canvas.height = N * TILE;   // 1024 px (square Mercator composite)
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0b1a2b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const loads = [];
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      loads.push(new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload  = () => { ctx.drawImage(img, x * TILE, y * TILE, TILE, TILE); resolve(); };
        img.onerror = () => resolve();
        img.src = `https://basemaps.cartocdn.com/dark_matter_nolabels/${ZOOM}/${x}/${y}.png`;
      }));
    }
  }

  await Promise.all(loads);
  globeInstance.globeImageUrl(canvas.toDataURL('image/jpeg', 0.90));
}

function initGlobe() {
  const container = $('globe-wrap');

  globeInstance = Globe({ animateIn: false })(container)
    .width(container.offsetWidth)
    .height(container.offsetHeight)
    .backgroundColor('#0d1117')
    .showAtmosphere(true)
    .atmosphereColor('#2255cc')
    .atmosphereAltitude(0.15)
    .pathResolution(4)
    // earth-dark shows immediately; CARTO canvas composite replaces it via
    // onGlobeReady once all 16 tiles are fetched and drawn onto a canvas.
    .globeImageUrl('https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-dark.jpg')
    .onGlobeReady(initCartoBgTiles)

    /* ── Translucent zone fills — colored like the 2D map (also used for
     *    Three.js click raycasting). Selected zone fills a touch stronger,
     *    matching the 2D fill-opacity ramp (0.45 base → 0.60 selected). ── */
    .polygonCapColor(f =>
      hexToRgba(f.properties.color || '#888888',
                f.properties.id === state.continent ? 0.60 : 0.45))
    .polygonSideColor(() => 'rgba(0,0,0,0)')
    .polygonStrokeColor(() => 'rgba(0,0,0,0)')
    // Fill sits just above the globe surface — high enough to avoid z-fighting
    // with the sphere, but below the country borders (raised to 0.01 in
    // loadCountryBorders) so those white lines render crisply on top of it.
    .polygonAltitude(0.004)
    // Zones are huge spherical-Voronoi polygons; the default 5° cap tessellation
    // leaves flat triangles that dip below the sphere at grazing angles (black
    // slivers). 1° makes each cap follow the curvature — clean fills at any
    // angle. Only 7 polygons, so the extra geometry is negligible.
    .polygonCapCurvatureResolution(1)
    .polygonsTransitionDuration(0)
    .polygonLabel(f => {
      const name = CONTINENT_NAMES[f.properties.id] || f.properties.id;
      const color = f.properties.color || '#fff';
      return `<div style="font:600 13px system-ui;color:${color};`
           + `background:rgba(0,0,0,.82);padding:4px 10px;border-radius:6px;">`
           + `${name}</div>`;
    })
    .onPolygonClick(f => {
      const id = f.properties.id;
      if (id) selectContinent(id);
    })

    /* ── Path layer — zone borders + tile grid, same colors as 2D ── */
    .pathsData([])
    .pathPoints(d => d.coords)
    .pathPointLat(d => d.lat)
    .pathPointLng(d => d.lng)
    .pathColor(d => {
      if (d.kind === 'country') return d.color;
      if (d.kind === 'aoi')     return '#ffffff';      // committed AOI — bright white
      if (d.kind === 'preview') return '#58a6ff';      // live draw preview — accent blue (matches 2D)
      if (d.kind === 'tile') {
        return d.status === 'inside' ? d.color : hexToRgba(d.color, 0.85);
      }
      return d.id === state.continent ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.7)';
    })
    /*
     * pathStroke: a numeric value renders a fat TUBE (expensive geometry);
     * returning null renders a thin THREE.Line (far cheaper, crisp 1px).
     * Countries + tiles → thin lines (huge perf win, esp. dense T1).
     * Zone borders stay as tubes (only ~8-10 paths) so they read as bold.
     */
    .pathStroke(d => {
      if (d.kind === 'country') return null;
      if (d.kind === 'tile')    return null;
      if (d.kind === 'aoi')     return 0.4;    // bold dashed tube so it stands out from the grid
      if (d.kind === 'preview') return 0.35;   // bold blue dashed preview
      return d.id === state.continent ? 1.1 : 0.65;
    })
    .pathPointAlt(d => d.alt || 0)
    .pathDashLength(d => (d.kind === 'aoi' || d.kind === 'preview') ? 0.6 : 1)
    .pathDashGap(d => (d.kind === 'aoi' || d.kind === 'preview') ? 0.35 : 0)
    .pathTransitionDuration(0)

    /* ── Tile-name labels (like the 2D map) ── */
    .labelsData([])
    .labelLat(d => d.lat)
    .labelLng(d => d.lng)
    .labelText(d => d.name)
    .labelAltitude(0.05)
    .labelSize(d => d.size)
    .labelDotRadius(0)            // no marker dot, just text
    // Match 2D: inside=white, no-status/outside=gray (#aaaaaa)
    .labelColor(d => d.status === 'inside' ? 'rgba(255,255,255,0.92)' : 'rgba(170,170,170,0.80)')
    .labelResolution(1)
    .labelsTransitionDuration(0)

    /* ── Points layer — polygon-draw vertex markers (blue dots, like 2D) ── */
    .pointsData([])
    .pointLat(d => d.lat)
    .pointLng(d => d.lng)
    .pointColor(() => '#58a6ff')
    .pointAltitude(0.09)
    .pointRadius(0.25)
    .pointResolution(8)
    .pointsTransitionDuration(0)

    .onZoom(scheduleTileLabelUpdate);   // hide/show labels as camera moves

  // Manual rotation only — no auto-rotation (it caused continuous re-renders).
  globeInstance.controls().autoRotate = false;

  // Cap pixel ratio: retina screens render 4× the pixels, which tanks FPS for
  // marginal sharpness. 1.5 keeps it crisp while greatly lightening the GPU.
  try {
    globeInstance.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  } catch (_) {}

  /* ── Drawing on the globe — mirrors the 2D map draw handlers ── */
  try {
    const gc = globeInstance.renderer().domElement;
    gc.addEventListener('click', e => {
      if (!state.drawMode) return;
      const c = globeInstance.toGlobeCoords(e.offsetX, e.offsetY);
      if (c) handleMapClick({ lngLat: { lng: c.lng, lat: c.lat } });
    });
    gc.addEventListener('dblclick', e => {
      if (!state.drawMode) return;
      const c = globeInstance.toGlobeCoords(e.offsetX, e.offsetY);
      if (c) handleDblClick({ lngLat: { lng: c.lng, lat: c.lat }, originalEvent: e });
    });
    gc.addEventListener('mousemove', e => {
      if (!state.drawMode) return;
      const c = globeInstance.toGlobeCoords(e.offsetX, e.offsetY);
      if (c) handleMouseMove({ lngLat: { lng: c.lng, lat: c.lat } });
    });
  } catch (_) {}

  refreshGlobeData();
}

$('btn-2d').addEventListener('click', () => {
  if (!viewIs3D) return;
  viewIs3D = false;
  $('btn-2d').classList.add('active');
  $('btn-3d').classList.remove('active');

  // Re-enable AOI tools — drawing/upload only works on the 2D map
  $('aoi-toolbar').style.display = '';

  // Pause the render loop instead of destroying — re-activating 3D is then instant
  if (globeInstance) {
    try { globeInstance.pauseAnimation(); } catch (_) {}
  }

  $('globe-wrap').hidden = true;
  $('map').style.visibility = '';
  map.resize();

  if (savedCamera) {
    map.flyTo({ ...savedCamera, pitch: 0, bearing: 0, duration: 700 });
    savedCamera = null;
  }
});

$('btn-3d').addEventListener('click', () => {
  if (viewIs3D) return;
  viewIs3D = true;
  $('btn-3d').classList.add('active');
  $('btn-2d').classList.remove('active');

  // AOI tools are 2D-only — cancel any active draw and hide the toolbar.
  // (An already-drawn AOI still displays on the globe.)
  disableDrawMode();
  $('aoi-toolbar').style.display = 'none';

  savedCamera = { center: map.getCenter(), zoom: map.getZoom() };

  $('map').style.visibility = 'hidden';
  $('globe-wrap').hidden = false;

  if (globeInstance) {
    // Resume existing globe — sync any changes made while in 2D, then unpause
    try { globeInstance.resumeAnimation(); } catch (_) {}
    refreshGlobeData();
  } else {
    // First time: build the globe and load country borders
    initGlobe();
    loadCountryBorders();
  }

  // If a continent was already selected, fly globe to it
  if (state.continent) {
    const v = CONTINENT_VIEWS[state.continent];
    if (v) globeInstance?.pointOfView({ lat: v.center[1], lng: v.center[0], altitude: 4.5 / v.zoom }, 500);
  }
});

/* ─────────── Home / reset to initial state ─────────── */
function resetToHome() {
  // Back to 2D (uses the existing handler: restores toolbar, etc.)
  if (viewIs3D) $('btn-2d').click();

  disableDrawMode();

  // Clear AOI
  state.aoi = null;
  state.intersecting = new Set();
  map.getSource('aoi').setData(emptyFC());
  clearAoiBtn.hidden = true;
  $('aoi-clear-divider').hidden = true;
  aoiResults.hidden = true;

  // Deselect continent
  if (state.continent)
    map.setFeatureState({ source: 'zones', id: state.continent }, { selected: false });
  state.continent = null;
  state.tilesData = null;
  map.getSource('tiles').setData(emptyFC());

  // Remove any lingering 3D tile mesh
  if (tileMesh) {
    try { tileMesh.parent && tileMesh.parent.remove(tileMesh); tileMesh.geometry.dispose(); tileMesh.material.dispose(); } catch (_) {}
    tileMesh = null; tileMeshKey = '';
  }

  // Restore initial sidebar/map UI
  tilingSection.hidden = true;
  statsSection.hidden  = true;
  exportSection.hidden = true;
  $('no-selection-hint').hidden = false;
  map.setLayoutProperty('continent-labels', 'visibility', 'visible');
  statLand.textContent = '—';
  statInsideLand.textContent = '—';

  // Reset controls to defaults
  const t6 = document.querySelector('input[name="tiling"][value="T6"]');
  if (t6) t6.checked = true;
  state.tiling = 'T6';
  setNameMode(true);
  setTileScope('all');

  // Fly back to the opening view
  map.flyTo({ center: [15, 20], zoom: 1.8, duration: 700 });
}
$('btn-home').addEventListener('click', resetToHome);

/* resize globe on window resize or sidebar collapse */
window.addEventListener('resize', () => {
  if (globeInstance && viewIs3D) {
    const c = $('globe-wrap');
    globeInstance.width(c.offsetWidth).height(c.offsetHeight);
  }
});

$('sidebar-toggle').addEventListener('click', () => {
  if (globeInstance && viewIs3D) {
    setTimeout(() => {
      const c = $('globe-wrap');
      globeInstance.width(c.offsetWidth).height(c.offsetHeight);
    }, 300);
  }
});

/* ─────────── Utilities ─────────── */
function emptyFC() {
  return { type: 'FeatureCollection', features: [] };
}

/* Split zone-polygon outlines into normal-border vs antimeridian-seam line
 * features. A segment is "seam" when both endpoints sit on ±180° longitude.
 * Consecutive same-type segments are merged into LineStrings. */
function splitZoneBorders(fc) {
  const border = [], seam = [];
  const onSeam = c => Math.abs(Math.abs(c[0]) - 180) < 0.5;
  fc.features.forEach(f => {
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates]
                : g.type === 'MultiPolygon' ? g.coordinates : [];
    polys.forEach(poly => poly.forEach(ring => {
      if (ring.length < 2) return;
      let run = [ring[0]];
      let runSeam = onSeam(ring[0]) && onSeam(ring[1]);
      for (let i = 1; i < ring.length; i++) {
        const segSeam = onSeam(ring[i - 1]) && onSeam(ring[i]);
        if (segSeam === runSeam) {
          run.push(ring[i]);
        } else {
          (runSeam ? seam : border).push(run);
          run = [ring[i - 1], ring[i]];
          runSeam = segSeam;
        }
      }
      (runSeam ? seam : border).push(run);
    }));
  });
  const toFC = arr => ({
    type: 'FeatureCollection',
    features: arr.filter(r => r.length >= 2).map(r => ({
      type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r },
    })),
  });
  return { border: toFC(border), seam: toFC(seam) };
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
