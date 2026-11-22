import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 生成 6 套 MapLibre/Maputnik 底图样式。
 * 运行：node scripts/build-basemap-styles.mjs
 *
 * 数据源默认指向本地 TileServer GL：
 *   http://localhost:8080/data/shenzhen.json
 *   http://localhost:8080/fonts/{fontstack}/{range}.pbf
 */

const SOURCE_URL = process.env.MAP_STYLE_SOURCE ?? 'http://localhost:8080/data/shenzhen.json';
const GLYPHS_URL =
  process.env.MAP_STYLE_GLYPHS ?? 'http://localhost:8080/fonts/{fontstack}/{range}.pbf';
const FONT = 'Noto Sans Regular';

const palettes = [
  {
    id: 'paper',
    name: '暖灰纸感',
    note: '低饱和暖灰，适合报告截图',
    bg: '#F4F1EA',
    land: '#EDE8DE',
    water: '#C9D8D6',
    green: '#DDE8D8',
    building: '#E2DACD',
    road: '#FFFFFF',
    roadCasing: '#D8D0C2',
    rail: '#B7AA97',
    boundary: '#B9AD9C',
    text: '#4A443C',
    textHalo: '#F8F5EF',
    motorway: '#E8C9A8'
  },
  {
    id: 'azure',
    name: '冷蓝政务',
    note: '清透冷蓝，接近政务系统',
    bg: '#EEF3F8',
    land: '#E6EDF5',
    water: '#C5D9E8',
    green: '#DDE9E1',
    building: '#DCE5EF',
    road: '#FFFFFF',
    roadCasing: '#CBD8E6',
    rail: '#A9B8C8',
    boundary: '#AFC0D1',
    text: '#334155',
    textHalo: '#FFFFFF',
    motorway: '#B9D4EA'
  },
  {
    id: 'slate',
    name: '中性灰',
    note: '克制中性，突出业务图层',
    bg: '#F1F3F5',
    land: '#E6EAED',
    water: '#C7D2DB',
    green: '#DEE5DC',
    building: '#DADFE3',
    road: '#FAFBFC',
    roadCasing: '#C2CAD1',
    rail: '#A6B0BA',
    boundary: '#AAB4BE',
    text: '#3F4A55',
    textHalo: '#FFFFFF',
    motorway: '#D7DEE4'
  },
  {
    id: 'contrast',
    name: '教学高对比',
    note: '边界清晰，适合课堂投屏',
    bg: '#FFFFFF',
    land: '#F4F4F4',
    water: '#BFDDF0',
    green: '#D9EED6',
    building: '#E5E5E5',
    road: '#FFFFFF',
    roadCasing: '#9CA3AF',
    rail: '#6B7280',
    boundary: '#4B5563',
    text: '#111827',
    textHalo: '#FFFFFF',
    motorway: '#F5C97A'
  },
  {
    id: 'midnight',
    name: '深色指挥',
    note: '深色底，适合大屏监看',
    bg: '#080D15',
    land: '#0D1522',
    water: '#0A2230',
    green: '#10251F',
    building: '#182333',
    road: '#25364A',
    roadCasing: '#101A28',
    rail: '#3B4D63',
    boundary: '#33465B',
    text: '#9FB3C8',
    textHalo: '#07111F',
    motorway: '#3C5875'
  },
  {
    id: 'night',
    name: '深蓝夜航',
    note: '偏蓝夜色，适合夜间态势',
    bg: '#07111F',
    land: '#0C1B2E',
    water: '#0B2C42',
    green: '#0E2A2A',
    building: '#14263B',
    road: '#29445F',
    roadCasing: '#0E1E31',
    rail: '#3B5B7A',
    boundary: '#36546E',
    text: '#A8C4DE',
    textHalo: '#07111F',
    motorway: '#42688B'
  }
];

const roadWidth = ['interpolate', ['linear'], ['zoom'], 5, 0.8, 10, 2.2, 14, 6, 17, 16];
const casingWidth = ['interpolate', ['linear'], ['zoom'], 5, 1.3, 10, 3.5, 14, 8, 17, 20];

function styleFor(p) {
  return {
    version: 8,
    name: `Low Altitude · ${p.name}`,
    metadata: {
      'low-altitude:theme': p.id,
      'low-altitude:note': p.note
    },
    sources: {
      openmaptiles: {
        type: 'vector',
        tiles: [SOURCE_URL.replace('/shenzhen.json', '/shenzhen/{z}/{x}/{y}.pbf')],
        minzoom: 0,
        maxzoom: 14
      }
    },
    glyphs: GLYPHS_URL,
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': p.bg }
      },
      {
        id: 'landuse',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landuse',
        paint: { 'fill-color': p.land, 'fill-opacity': 0.9 }
      },
      {
        id: 'landcover',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        paint: { 'fill-color': p.green, 'fill-opacity': 0.65 }
      },
      {
        id: 'water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        paint: { 'fill-color': p.water }
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'waterway',
        paint: {
          'line-color': p.water,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2.5]
        }
      },
      {
        id: 'aeroway',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'aeroway',
        paint: {
          'line-color': p.roadCasing,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 16, 10]
        }
      },
      {
        id: 'building',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 13,
        paint: {
          'fill-color': p.building,
          'fill-opacity': 0.72,
          'fill-outline-color': p.roadCasing
        }
      },
      {
        id: 'boundary',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'boundary',
        paint: {
          'line-color': p.boundary,
          'line-width': 1,
          'line-dasharray': [2, 2],
          'line-opacity': 0.7
        }
      },
      {
        id: 'road-casing',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 5,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': p.roadCasing,
          'line-width': casingWidth,
          'line-opacity': 0.9
        }
      },
      {
        id: 'road',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 5,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'match',
            ['get', 'class'],
            'motorway',
            p.motorway,
            'trunk',
            p.motorway,
            p.road
          ],
          'line-width': roadWidth
        }
      },
      {
        id: 'rail',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 9,
        filter: ['==', ['get', 'class'], 'rail'],
        paint: {
          'line-color': p.rail,
          'line-width': 1,
          'line-dasharray': [2, 2],
          'line-opacity': 0.7
        }
      },
      {
        id: 'water-name',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'water_name',
        minzoom: 9,
        layout: {
          'text-field': ['coalesce', ['get', 'name:zh'], ['get', 'name']],
          'text-font': [FONT],
          'text-size': 10,
          'text-max-width': 6
        },
        paint: {
          'text-color': p.text,
          'text-halo-color': p.textHalo,
          'text-halo-width': 1.2
        }
      },
      {
        id: 'place-label',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        minzoom: 5,
        layout: {
          'text-field': ['coalesce', ['get', 'name:zh'], ['get', 'name']],
          'text-font': [FONT],
          'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 10, 13, 14, 15],
          'text-max-width': 8,
          'text-padding': 4
        },
        paint: {
          'text-color': p.text,
          'text-halo-color': p.textHalo,
          'text-halo-width': 1.4
        }
      },
      {
        id: 'road-label',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
        minzoom: 13,
        layout: {
          'text-field': ['coalesce', ['get', 'name:zh'], ['get', 'name']],
          'text-font': [FONT],
          'text-size': 10,
          'symbol-placement': 'line',
          'text-max-angle': 30
        },
        paint: {
          'text-color': p.text,
          'text-halo-color': p.textHalo,
          'text-halo-width': 1.2
        }
      }
    ]
  };
}

const root = path.resolve('maputnik/styles');
for (const palette of palettes) {
  const dir = path.join(root, palette.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'style.json'),
    `${JSON.stringify(styleFor(palette), null, 2)}\n`,
    'utf8'
  );
  console.log('wrote', path.relative(process.cwd(), path.join(dir, 'style.json')));
}

const config = {
  options: {
    paths: {
      root: '/data',
      fonts: 'fonts',
      sprites: 'sprites',
      styles: 'styles',
      mbtiles: 'data'
    }
  },
  styles: Object.fromEntries(
    palettes.map((palette) => [
      `low-altitude-${palette.id}`,
      { style: `${palette.id}/style.json` }
    ])
  ),
  data: {
    shenzhen: {
      mbtiles: 'shenzhen.mbtiles'
    }
  }
};

await fs.writeFile(
  path.join('maputnik', 'config.json'),
  `${JSON.stringify(config, null, 2)}\n`,
  'utf8'
);
console.log('wrote maputnik/config.json');
