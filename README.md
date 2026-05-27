# Equi7Grid Explorer

An interactive web tool for visualising the [Equi7Grid](https://github.com/TUW-GEO/Equi7Grid) discrete global grid system developed by TU Wien.

**Live app → https://pmuguda.github.io/equi7grid-explorer/**

## Features

- World overview showing all 7 E7 continental sub-grids in distinct colours
- Click any continent to zoom in and inspect its tile grid
- Three tiling systems: **T6** (600 km), **T3** (300 km), **T1** (100 km)
- Define an Area of Interest by:
  - Drawing a **bounding rectangle** on the map
  - Drawing a **custom polygon** (click vertices, double-click to close)
  - Uploading a **GeoJSON** file
  - Uploading a **Shapefile** (.zip)
- Tiles intersecting the AOI are highlighted; non-intersecting tiles are dimmed
- Tile count statistics (inside AOI vs total)
- **Export** intersecting tiles as GeoJSON (with tile names as properties)

## Tiling systems

| System | Tile size | Samplings |
|--------|-----------|-----------|
| T6 | 600 km × 600 km | 1000 m – 64 m |
| T3 | 300 km × 300 km | 160 m – 20 m |
| T1 | 100 km × 100 km | 16 m – 1 m |

## Sub-grids

| ID | Continent | CRS |
|----|-----------|-----|
| AF | Africa | EPSG:27701 |
| AN | Antarctica | EPSG:27702 |
| AS | Asia | EPSG:27703 |
| EU | Europe | EPSG:27704 |
| NA | North America | EPSG:27705 |
| OC | Oceania | EPSG:27706 |
| SA | South America | EPSG:27707 |

## Regenerating tile data

Tile GeoJSON files are pre-generated from the equi7grid Python package and committed to this repo. To regenerate them (e.g. after a new equi7grid release):

```bash
pip install "equi7grid @ git+https://github.com/TUW-GEO/Equi7Grid.git" geopandas pyarrow
python scripts/generate_tiles.py
```

## Tech stack

- [MapLibre GL JS](https://maplibre.org/) — map rendering
- [Turf.js](https://turfjs.org/) — spatial intersection
- [shpjs](https://github.com/calvinmetcalf/shapefile-js) — shapefile parsing
- [CARTO Dark Matter](https://carto.com/basemaps/) — base map tiles
- Hosted on **GitHub Pages** (no server needed)

## Credits

Grid definition and data: [TUW-GEO/Equi7Grid](https://github.com/TUW-GEO/Equi7Grid) · MIT License
