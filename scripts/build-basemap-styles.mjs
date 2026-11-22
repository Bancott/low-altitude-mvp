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
    id: 'qianli',
    name: '千里江山',
    note: '石青石绿与绢底，青绿山水',
    bg: '#E8E4D3', land: '#C9D8CE', water: '#6F9FA8', green: '#7FA487',
    building: '#D8D2BC', road: '#F8F6EB', roadCasing: '#B9B49B', rail: '#8F7C61',
    boundary: '#8A7B61', text: '#2F3A38', textHalo: '#F6F0E2', motorway: '#C9A66B'
  },
  {
    id: 'wutai',
    name: '五台山图',
    note: '敦煌矿物颜料，赭石与朱砂',
    bg: '#E8D2AD', land: '#D9B98B', water: '#6C8F95', green: '#8A8A5A',
    building: '#C99E6A', road: '#F3E2C8', roadCasing: '#B98E5A', rail: '#8B5E3C',
    boundary: '#8C5A3C', text: '#3C2C22', textHalo: '#F7EAD4', motorway: '#B5623E'
  },
  {
    id: 'youchun',
    name: '游春图',
    note: '春日青绿，轻盈绢色',
    bg: '#F1F2E1', land: '#D8E0C6', water: '#9DC4C7', green: '#A8C09A',
    building: '#DCD2B8', road: '#FCFBF2', roadCasing: '#C3C3A8', rail: '#907E63',
    boundary: '#8D806A', text: '#34423E', textHalo: '#FFFDF6', motorway: '#D6A66B'
  },
  {
    id: 'qiuse',
    name: '江山秋色',
    note: '秋山赭色，温润沉稳',
    bg: '#F0E0C4', land: '#E4C69B', water: '#7E9A9C', green: '#A89A63',
    building: '#D0AB78', road: '#FBF0DA', roadCasing: '#C79E6C', rail: '#8A5B3E',
    boundary: '#8A5B3E', text: '#3B2B22', textHalo: '#FAF0DF', motorway: '#B65A32'
  },
  {
    id: 'danfeng',
    name: '丹枫呦鹿',
    note: '丹枫、鹿褐与深林',
    bg: '#E5D3B8', land: '#CFB08A', water: '#6B898C', green: '#5F7253',
    building: '#BE9568', road: '#F6E7D0', roadCasing: '#AD8259', rail: '#7B3B2E',
    boundary: '#7B3B2E', text: '#2F211B', textHalo: '#F8EBDC', motorway: '#8E2F2A'
  },
  {
    id: 'qixu',
    name: '绮序舒芳',
    note: '花卉册页，清妍设色',
    bg: '#F8EFE5', land: '#EBDCCB', water: '#A8C7CD', green: '#B7C7AC',
    building: '#E0CEC3', road: '#FFFDF9', roadCasing: '#D4BEB2', rail: '#A58B73',
    boundary: '#B09A82', text: '#40352D', textHalo: '#FFFFFF', motorway: '#C98A8F'
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
        maxzoom: 16
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
