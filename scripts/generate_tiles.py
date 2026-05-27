"""
Generate GeoJSON tile files for all Equi7Grid continents and tiling systems.
Run once: python scripts/generate_tiles.py
Output: data/zones/e7_zones.geojson and data/tiles/<continent>_<tiling>.geojson
"""

import json
import math
from pathlib import Path

import pyproj
import shapely
from shapely.geometry import mapping, box
from equi7grid.core import get_standard_equi7grid
from equi7grid._create_grids import get_system_definitions

OUT_DIR = Path(__file__).parent.parent / "data"
ZONES_OUT = OUT_DIR / "zones" / "e7_zones.geojson"
TILES_OUT = OUT_DIR / "tiles"

CONTINENTS = ["AF", "AN", "AS", "EU", "NA", "OC", "SA"]
TILINGS = ["T6", "T3", "T1"]
SAMPLING = 1000  # 1km sampling — only affects pixel size, not tile boundaries

# Colours for each continent (used as properties in GeoJSON)
COLORS = {
    "AF": "#e6a817",
    "AN": "#9ecae1",
    "AS": "#fd8d3c",
    "EU": "#4393c3",
    "NA": "#e41a1c",
    "OC": "#4daf4a",
    "SA": "#984ea3",
}

NAMES = {
    "AF": "Africa",
    "AN": "Antarctica",
    "AS": "Asia",
    "EU": "Europe",
    "NA": "North America",
    "OC": "Oceania",
    "SA": "South America",
}


def normalize_ring(pts):
    """Adjust longitudes to avoid antimeridian jumps within a ring.

    After reprojection, vertices near ±180° can jump from 179° to -179°
    within the same polygon. This makes them coherent (even if > 180 or < -180)
    so MapLibre renders the tile as a single shape rather than a map-wide band.
    """
    if not pts:
        return pts
    result = [[pts[0][0], pts[0][1]]]
    for lon, lat in pts[1:]:
        prev = result[-1][0]
        while lon - prev > 180:
            lon -= 360
        while prev - lon > 180:
            lon += 360
        result.append([round(lon, 6), round(lat, 6)])
    return result


def normalize_geojson_geometry(geom_dict):
    """Apply ring normalization to a GeoJSON geometry to fix antimeridian jumps."""
    def fix_ring(ring):
        return normalize_ring([[c[0], c[1]] for c in ring])

    geo_type = geom_dict['type']
    if geo_type == 'Polygon':
        return {'type': 'Polygon',
                'coordinates': [fix_ring(r) for r in geom_dict['coordinates']]}
    elif geo_type == 'MultiPolygon':
        return {'type': 'MultiPolygon',
                'coordinates': [[fix_ring(r) for r in poly]
                                for poly in geom_dict['coordinates']]}
    return geom_dict


def generate_zones(e7):
    """Generate e7_zones.geojson with the 7 continental coverage zones."""
    features = []
    for name in CONTINENTS:
        ts = e7[name]
        zone_geog = ts.proj_zone_geog.geom
        geom_json = normalize_geojson_geometry(mapping(zone_geog))
        features.append({
            "type": "Feature",
            "properties": {
                "id": name,
                "name": NAMES[name],
                "color": COLORS[name],
            },
            "geometry": geom_json,
        })
    fc = {"type": "FeatureCollection", "features": features}
    ZONES_OUT.parent.mkdir(parents=True, exist_ok=True)
    ZONES_OUT.write_text(json.dumps(fc))
    print(f"  Wrote {ZONES_OUT} ({len(features)} zones)")


def generate_tiles(e7):
    """Generate per-continent per-tiling GeoJSON files."""
    TILES_OUT.mkdir(parents=True, exist_ok=True)

    for continent in CONTINENTS:
        ts = e7[continent]
        crs = ts.pyproj_crs
        transformer = pyproj.Transformer.from_crs(crs, "EPSG:4326", always_xy=True)

        for tiling_id_str in TILINGS:
            features = []
            try:
                tiles = list(ts.get_tiles_in_geog_bbox(
                    (-180, -90, 180, 90),
                    tiling_id=tiling_id_str,
                    cover_land=False,
                ))
            except Exception as exc:
                print(f"  WARN {continent} {tiling_id_str}: {exc}")
                continue

            for tile in tiles:
                ext = tile.outer_boundary_extent  # (x_min, y_min, x_max, y_max)
                xmin, ymin, xmax, ymax = ext

                # Build corners in projected space and densify edges
                poly = box(xmin, ymin, xmax, ymax)
                densified = shapely.segmentize(poly, max_segment_length=50_000)
                coords = list(densified.exterior.coords)
                lons, lats = transformer.transform(
                    [c[0] for c in coords], [c[1] for c in coords]
                )
                ring = normalize_ring([[lon, lat] for lon, lat in zip(lons, lats)])

                # Skip tiles that are too close to a geographic pole.
                # Near-polar tiles appear extremely distorted in WGS84 because
                # the AEQD projection collapses east-west extents near the poles.
                # A longitude span > 50° indicates this distortion; likewise we
                # drop anything that touches beyond ±84° latitude.
                ring_lons = [c[0] for c in ring]
                ring_lats = [c[1] for c in ring]
                if (max(ring_lons) - min(ring_lons) > 50
                        or max(ring_lats) > 84
                        or min(ring_lats) < -84):
                    continue

                features.append({
                    "type": "Feature",
                    "properties": {
                        "name": tile.name,
                        "continent": continent,
                        "tiling": tiling_id_str,
                        "covers_land": tile.covers_land,
                        "color": COLORS[continent],
                    },
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [ring],
                    },
                })

            out = TILES_OUT / f"{continent.lower()}_{tiling_id_str.lower()}.geojson"
            fc = {"type": "FeatureCollection", "features": features}
            out.write_text(json.dumps(fc))
            print(f"  Wrote {out} ({len(features)} tiles)")


def generate_zone_hulls(e7):
    """Generate zone hull polygons from the union of filtered T6 tile extents.

    Computes the union of each continent's T6 tile footprints in its native
    projected (AEQD) space, then reprojects to WGS84.  Unlike the raw
    proj_zone_geog polygons these hulls cannot encircle the poles because
    only tiles that passed the WGS84 lat/lon-span filter are included.

    Antarctica is a special case: its tiles form a full 360° annulus around
    the South Pole.  We represent it with a simple bounding rectangle.
    """
    TILES_OUT.mkdir(parents=True, exist_ok=True)
    features = []

    for continent in CONTINENTS:
        ts = e7[continent]
        crs = ts.pyproj_crs
        transformer = pyproj.Transformer.from_crs(crs, "EPSG:4326", always_xy=True)

        # Get the names of tiles that survived the WGS84 filter
        path = TILES_OUT / f"{continent.lower()}_t6.geojson"
        if not path.exists():
            print(f"  SKIP hull {continent}: tile file missing")
            continue
        with open(path) as fh:
            fc = json.load(fh)
        valid_names = {f["properties"]["name"] for f in fc["features"]}

        try:
            all_tiles = list(ts.get_tiles_in_geog_bbox(
                (-180, -90, 180, 90), tiling_id="T6", cover_land=False,
            ))
        except Exception as exc:
            print(f"  SKIP hull {continent}: {exc}")
            continue

        valid_tiles = [t for t in all_tiles if t.name in valid_names]
        if not valid_tiles:
            continue

        # ── Antarctica: 360° annulus → use a simple lat-band rectangle ──────
        if continent == "AN":
            # Determine the northern boundary from actual tile data
            north_lats = []
            for tile in valid_tiles:
                xmin, ymin, xmax, ymax = tile.outer_boundary_extent
                lons_t, lats_t = transformer.transform(
                    [xmin, xmin, xmax, xmax],
                    [ymin, ymax, ymin, ymax],
                )
                north_lats.extend(lats_t)
            north = round(max(north_lats), 2)
            # Emit raw coordinates — do NOT pass through normalize_ring because
            # that function collapses a full-width [-180, 180] rectangle.
            geom_json = {
                "type": "Polygon",
                "coordinates": [[
                    [-180.0, -84.0],
                    [-180.0, north],
                    [ 180.0, north],
                    [ 180.0, -84.0],
                    [-180.0, -84.0],
                ]],
            }

        # ── All other continents: union projected boxes → reproject ──────────
        else:
            proj_boxes = [box(*t.outer_boundary_extent) for t in valid_tiles]
            proj_hull = shapely.unary_union(proj_boxes)
            # Smooth the tile-edge staircase (600 km steps) before reprojecting
            proj_hull = proj_hull.simplify(300_000, preserve_topology=True)
            densified = shapely.segmentize(proj_hull, max_segment_length=100_000)

            def reproject_ring(coords):
                lons, lats = transformer.transform(
                    [c[0] for c in coords], [c[1] for c in coords]
                )
                ring = normalize_ring([[lo, la] for lo, la in zip(lons, lats)])
                rl = [c[0] for c in ring]
                rb = [c[1] for c in ring]
                if max(rl) - min(rl) > 300 or max(rb) > 85 or min(rb) < -85:
                    return None
                return ring

            gtype = densified.geom_type
            if gtype == "Polygon":
                ring = reproject_ring(list(densified.exterior.coords))
                if ring is None:
                    print(f"  SKIP hull {continent}: distorted")
                    continue
                geom_json = {"type": "Polygon", "coordinates": [ring]}
            elif gtype == "MultiPolygon":
                polys = []
                for p in densified.geoms:
                    ring = reproject_ring(list(p.exterior.coords))
                    if ring:
                        polys.append([ring])
                if not polys:
                    continue
                geom_json = {"type": "MultiPolygon", "coordinates": polys}
            else:
                print(f"  SKIP hull {continent}: unexpected geom type {gtype}")
                continue

        features.append({
            "type": "Feature",
            "properties": {
                "id": continent,
                "name": NAMES[continent],
                "color": COLORS[continent],
            },
            "geometry": geom_json,
        })

    out = OUT_DIR / "zones" / "e7_zone_hulls.geojson"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    print(f"  Wrote {out} ({len(features)} zones)")


def generate_overview():
    """Merge all T6 tiles into a single overview GeoJSON for the world map.

    This avoids using the raw Equi7Grid zone polygons, which encircle the
    geographic poles in WGS84 and cause MapLibre to flood-fill the top/bottom
    of the map with the wrong colour.
    """
    features = []
    for continent in CONTINENTS:
        path = TILES_OUT / f"{continent.lower()}_t6.geojson"
        if not path.exists():
            continue
        with open(path) as fh:
            fc = json.load(fh)
        features.extend(fc["features"])
    out = OUT_DIR / "overview_t6.geojson"
    out.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    print(f"  Wrote {out} ({len(features)} tiles across all continents)")


if __name__ == "__main__":
    print("Loading Equi7Grid (1000m sampling)...")
    e7 = get_standard_equi7grid(SAMPLING)

    print("Generating zone boundaries (kept for reference)...")
    generate_zones(e7)

    print("Generating tile boundaries...")
    generate_tiles(e7)

    print("Generating zone hulls (from filtered tile unions)...")
    generate_zone_hulls(e7)

    print("Generating world overview (merged T6)...")
    generate_overview()

    print("Done.")
