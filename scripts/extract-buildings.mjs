/**
 * 从本地 mbtiles 提取建筑轮廓，生成 Cesium 可直接用的 GeoJSON。
 *
 * 用法：node --experimental-sqlite scripts/extract-buildings.mjs
 * 输出：public/data/buildings.geojson（properties: h 顶高、mh 底高）
 */
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

const Z = 16;
const BBOX = [113.84, 22.46, 114.01, 22.6]; // w, s, e, n
const OUT = 'public/data/buildings.geojson';

const db = new DatabaseSync('.cache/shenzhen.mbtiles');

const size = 2 ** Z;
const lon2x = (lon) => ((lon + 180) / 360) * size;
const lat2y = (lat) => {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * size;
};

const x0 = Math.floor(lon2x(BBOX[0]));
const x1 = Math.floor(lon2x(BBOX[2]));
const y0 = Math.floor(lat2y(BBOX[3]));
const y1 = Math.floor(lat2y(BBOX[1]));

const seen = new Set();
const features = [];
let tiles = 0;
let dropped = 0;

const round = (v) => Math.round(v * 1e5) / 1e5;

for (let x = x0; x <= x1; x += 1) {
  for (let y = y0; y <= y1; y += 1) {
    const row = db
      .prepare('select tile_data from tiles where zoom_level=? and tile_column=? and tile_row=?')
      .get(Z, x, size - 1 - y);
    if (!row) continue;
    tiles += 1;

    const raw = Buffer.from(row.tile_data);
    const buf = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
    const tile = new VectorTile(new PbfReader(buf));
    const layer = tile.layers.building;
    if (!layer) continue;

    const extent = layer.extent;
    for (let i = 0; i < layer.length; i += 1) {
      const feature = layer.feature(i);
      const rings = feature.loadGeometry();
      if (!rings.length) continue;
      // 只取最大的一环（孔洞忽略）
      let outer = rings[0];
      for (const ring of rings) if (ring.length > outer.length) outer = ring;
      if (outer.length < 4) {
        dropped += 1;
        continue;
      }

      const coords = [];
      let sumLon = 0;
      let sumLat = 0;
      for (const point of outer) {
        const lon = ((x + point.x / extent) / size) * 360 - 180;
        const lat =
          (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + point.y / extent)) / size))) * 180) / Math.PI;
        sumLon += lon;
        sumLat += lat;
        coords.push([round(lon), round(lat)]);
      }
      // 环闭合
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) coords.push([first[0], first[1]]);

      const cLon = sumLon / outer.length;
      const cLat = sumLat / outer.length;
      if (cLon < BBOX[0] || cLon > BBOX[2] || cLat < BBOX[1] || cLat > BBOX[3]) continue;

      // 瓦片缓冲区会让同一栋楼在相邻瓦片里重复出现，用几何指纹去重
      let area = 0;
      for (let k = 0; k < coords.length - 1; k += 1) {
        area += coords[k][0] * coords[k + 1][1] - coords[k + 1][0] * coords[k][1];
      }
      const key = `${cLon.toFixed(5)}|${cLat.toFixed(5)}|${coords.length}|${Math.abs(area).toFixed(6)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const props = feature.properties ?? {};
      const top = Number(props.render_height ?? 8);
      const base = Number(props.render_min_height ?? 0);
      const h = Math.max(3, Math.min(220, Math.round(Number.isFinite(top) ? top : 8)));
      const mh = Math.max(0, Math.min(h - 1, Math.round(Number.isFinite(base) ? base : 0)));

      features.push({
        type: 'Feature',
        properties: { h, mh },
        geometry: { type: 'Polygon', coordinates: [coords] }
      });
    }
  }
}

mkdirSync('public/data', { recursive: true });
writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', features }), 'utf8');

console.log(`tiles=${tiles} features=${features.length} dropped=${dropped}`);
