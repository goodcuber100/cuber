#!/usr/bin/env bash
# Downloads the raw open-data sources used to build js/data/nyc-data.js.
# Everything comes from the npm registry / PyPI so it works behind restrictive proxies.
#   - mta-subway-stations          : MTA station list (structure: Subway / Elevated / Open Cut ...)
#   - mta-gtfs-static              : daily JSON export of the official MTA subway GTFS feed
#   - @geo-maps/earth-lands-10m    : OpenStreetMap land polygons (ODbL) for neighbouring coastline
#   - geopandas 0.14 wheel         : ships NYC DCP "nybb" borough shorelines (shapefile)
# The generated js/data/nyc-data.js is committed, so you only need this to refresh the data.
set -euo pipefail
OUT="${1:-.data-src}"
mkdir -p "$OUT"
cd "$OUT"
npm pack mta-subway-stations --silent >/dev/null
npm pack mta-gtfs-static --silent >/dev/null
npm pack @geo-maps/earth-lands-10m --silent >/dev/null
rm -rf mss gtfs nybb wheel package && mkdir -p mss gtfs nybb wheel
tar xzf mta-subway-stations-*.tgz -C mss --strip-components=1
tar xzf mta-gtfs-static-*.tgz package/gtfs_json.zip
unzip -o -q package/gtfs_json.zip 'gtfs_json/subway/*' -d gtfs
tar xzf geo-maps-earth-lands-10m-*.tgz package/map.geo.json
mv package/map.geo.json lands10m.geo.json
python3 -m pip download geopandas==0.14.4 --no-deps -d wheel -q
unzip -o -q wheel/geopandas-*.whl 'geopandas/datasets/nybb_16a.zip' -d wheel
unzip -o -q wheel/geopandas/datasets/nybb_16a.zip -d nybb
rm -rf package wheel *.tgz
echo "Raw data ready in $OUT. Now run:  npm run data:build"
