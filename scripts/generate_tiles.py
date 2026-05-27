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


if __name__ == "__main__":
    print("Loading Equi7Grid (1000m sampling)...")
    e7 = get_standard_equi7grid(SAMPLING)

    print("Generating zone boundaries...")
    generate_zones(e7)

    print("Generating tile boundaries...")
    generate_tiles(e7)

    print("Done.")
