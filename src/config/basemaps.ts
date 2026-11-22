export type CustomBasemapStyle =
  | 'custom'
  | 'custom-qianli'
  | 'custom-wutai'
  | 'custom-youchun'
  | 'custom-qiuse'
  | 'custom-danfeng'
  | 'custom-qixu';

export type BasemapStyle = 'dark' | 'light' | 'satellite' | CustomBasemapStyle;
type StandardBasemapStyle = 'dark' | 'light' | 'satellite';

export interface BasemapLayerConfig {
  url: string;
  subdomains?: string[];
  brightness?: number;
  contrast?: number;
  saturation?: number;
  gamma?: number;
  credit?: string;
}

export interface BasemapConfig {
  id: BasemapStyle;
  source: 'tianditu' | 'esri' | 'custom';
  maxLevel: number;
  layers: BasemapLayerConfig[];
  credit: string;
  globeColor: string;
  sceneColor: string;
}

/**
 * 天地图浏览器端 key。
 * 申请：https://console.tianditu.gov.cn/ → 应用管理 → 创建应用（类型选“浏览器端”）
 * 配置：项目根目录 .env.local 写入 VITE_TIANDITU_KEY=你的key，重启 dev server。
 * 未配置时自动回退到 Esri 底图，页面不会空白。
 */
const TIANDITU_KEY = String(import.meta.env.VITE_TIANDITU_KEY ?? '').trim();

export const TIANDITU_READY = /^[A-Za-z0-9]{16,}$/.test(TIANDITU_KEY);

/**
 * Maputnik / TileServer GL 自定义底图。
 *
 * 单套样式：
 * VITE_CUSTOM_MAP_URL=http://localhost:8080/styles/low-altitude-qianli/{z}/{x}/{y}.png
 *
 * 多套配色（推荐，底图菜单会出现 6 个选项）：
 * VITE_CUSTOM_MAP_BASE_URL=http://localhost:8080/styles
 */
const CUSTOM_MAP_URL = String(import.meta.env.VITE_CUSTOM_MAP_URL ?? '').trim();
const CUSTOM_MAP_BASE_URL = String(import.meta.env.VITE_CUSTOM_MAP_BASE_URL ?? '')
  .trim()
  .replace(/\/+$/, '');
export const CUSTOM_MAP_READY =
  /^(https?:\/\/|\/).+/.test(CUSTOM_MAP_URL) || /^(https?:\/\/|\/).+/.test(CUSTOM_MAP_BASE_URL);
const CUSTOM_MAP_CREDIT =
  String(import.meta.env.VITE_CUSTOM_MAP_CREDIT ?? '').trim() ||
  '© OpenMapTiles · © OpenStreetMap contributors';

export const CUSTOM_STYLE_PRESETS: Array<{
  id: CustomBasemapStyle;
  style: string;
  label: string;
  short: string;
  desc: string;
  swatch: string;
}> = [
  {
    id: 'custom-qianli',
    style: 'low-altitude-qianli',
    label: '千里江山',
    short: '千里',
    desc: '石青石绿，青绿山水',
    swatch: 'qianli'
  },
  {
    id: 'custom-wutai',
    style: 'low-altitude-wutai',
    label: '五台山图',
    short: '五台',
    desc: '敦煌矿物颜料，赭石朱砂',
    swatch: 'wutai'
  },
  {
    id: 'custom-youchun',
    style: 'low-altitude-youchun',
    label: '游春图',
    short: '游春',
    desc: '春日青绿，轻盈绢色',
    swatch: 'youchun'
  },
  {
    id: 'custom-qiuse',
    style: 'low-altitude-qiuse',
    label: '江山秋色',
    short: '秋色',
    desc: '秋山赭色，温润沉稳',
    swatch: 'qiuse'
  },
  {
    id: 'custom-danfeng',
    style: 'low-altitude-danfeng',
    label: '丹枫呦鹿',
    short: '丹枫',
    desc: '丹枫、鹿褐与深林',
    swatch: 'danfeng'
  },
  {
    id: 'custom-qixu',
    style: 'low-altitude-qixu',
    label: '绮序舒芳',
    short: '绮序',
    desc: '花卉册页，清妍设色',
    swatch: 'qixu'
  }
];

const TDT_SUBDOMAINS = ['0', '1', '2', '3', '4', '5', '6', '7'];
const TDT_CREDIT = '© 天地图 · 国家地理信息公共服务平台';

function tiandituLayer(layer: 'vec' | 'cva' | 'img' | 'cia'): string {
  const params = [
    'SERVICE=WMTS',
    'REQUEST=GetTile',
    'VERSION=1.0.0',
    `LAYER=${layer}`,
    'STYLE=default',
    'TILEMATRIXSET=w',
    'FORMAT=tiles',
    'TILEMATRIX={z}',
    'TILEROW={y}',
    'TILECOL={x}',
    `tk=${TIANDITU_KEY}`
  ].join('&');

  return `https://t{s}.tianditu.gov.cn/${layer}_w/wmts?${params}`;
}

const TIANDITU: Record<StandardBasemapStyle, BasemapConfig> = {
  dark: {
    id: 'dark',
    source: 'tianditu',
    maxLevel: 18,
    credit: TDT_CREDIT,
    globeColor: '#0a1018',
    sceneColor: '#050a12',
    layers: [
      {
        url: tiandituLayer('vec'),
        subdomains: TDT_SUBDOMAINS,
        credit: TDT_CREDIT,
        brightness: 0.52,
        contrast: 1.3,
        saturation: 0.24,
        gamma: 0.82
      },
      {
        url: tiandituLayer('cva'),
        subdomains: TDT_SUBDOMAINS,
        brightness: 0.82,
        contrast: 1.06,
        saturation: 0.35
      }
    ]
  },
  light: {
    id: 'light',
    source: 'tianditu',
    maxLevel: 18,
    credit: TDT_CREDIT,
    globeColor: '#c9d5e4',
    sceneColor: '#eef2f7',
    layers: [
      { url: tiandituLayer('vec'), subdomains: TDT_SUBDOMAINS, credit: TDT_CREDIT },
      { url: tiandituLayer('cva'), subdomains: TDT_SUBDOMAINS }
    ]
  },
  satellite: {
    id: 'satellite',
    source: 'tianditu',
    maxLevel: 18,
    credit: TDT_CREDIT,
    globeColor: '#0a1018',
    sceneColor: '#050a12',
    layers: [
      { url: tiandituLayer('img'), subdomains: TDT_SUBDOMAINS, credit: TDT_CREDIT },
      { url: tiandituLayer('cia'), subdomains: TDT_SUBDOMAINS }
    ]
  }
};

const ESRI: Record<StandardBasemapStyle, BasemapConfig> = {
  dark: {
    id: 'dark',
    source: 'esri',
    maxLevel: 19,
    credit: '© Esri · HERE · Garmin · OpenStreetMap contributors',
    globeColor: '#07111f',
    sceneColor: '#050a12',
    layers: [
      {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        credit: '© Esri · HERE · Garmin · OpenStreetMap contributors',
        brightness: 0.78,
        contrast: 1.08,
        saturation: 0.72,
        gamma: 0.92
      },
      {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'
      }
    ]
  },
  light: {
    id: 'light',
    source: 'esri',
    maxLevel: 19,
    credit: '© Esri · HERE · Garmin · OpenStreetMap contributors',
    globeColor: '#c9d5e4',
    sceneColor: '#eef2f7',
    layers: [
      {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        credit: '© Esri · HERE · Garmin · OpenStreetMap contributors'
      },
      {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}'
      }
    ]
  },
  satellite: {
    id: 'satellite',
    source: 'esri',
    maxLevel: 19,
    credit: '© Esri · Maxar · Earthstar Geographics',
    globeColor: '#07111f',
    sceneColor: '#050a12',
    layers: [
      {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        credit: '© Esri · Maxar · Earthstar Geographics'
      }
    ]
  }
};

const CUSTOM: BasemapConfig = {
  id: 'custom',
  source: 'custom',
  maxLevel: 16,
  credit: CUSTOM_MAP_CREDIT,
  globeColor: '#c9d5e4',
  sceneColor: '#eef2f7',
  layers: [
    {
      url: CUSTOM_MAP_URL || 'http://localhost:8080/styles/low-altitude-qianli/{z}/{x}/{y}.png',
      credit: CUSTOM_MAP_CREDIT
    }
  ]
};

function customStyleConfig(
  id: BasemapStyle,
  styleName: string,
  maxLevel = 16
): BasemapConfig {
  const base = CUSTOM_MAP_BASE_URL || 'http://localhost:8080/styles';
  return {
    ...CUSTOM,
    id,
    maxLevel,
    layers: [
      {
        url: `${base}/${styleName}/{z}/{x}/{y}.png`,
        credit: CUSTOM_MAP_CREDIT
      }
    ]
  };
}

export function getBasemap(style: BasemapStyle): BasemapConfig {
  if (style === 'custom') return CUSTOM;
  const preset = CUSTOM_STYLE_PRESETS.find((item) => item.id === style);
  if (preset) return customStyleConfig(preset.id, preset.style);
  const standard = style as StandardBasemapStyle;
  return TIANDITU_READY ? TIANDITU[standard] : ESRI[standard];
}

const STANDARD_BASEMAP_OPTIONS: Array<{
  id: BasemapStyle;
  label: string;
  short: string;
  desc: string;
  swatch: string;
}> = [
  { id: 'dark', label: '暗色地图', short: '暗色', desc: '低饱和，适合长时间监看', swatch: 'dark' },
  { id: 'light', label: '浅色地图', short: '浅色', desc: '道路清晰，适合汇报截图', swatch: 'light' },
  { id: 'satellite', label: '卫星影像', short: '卫星', desc: '真实纹理，辅助研判', swatch: 'satellite' }
];

export const BASE_QUICK_OPTIONS = STANDARD_BASEMAP_OPTIONS;

export const BASEMAP_OPTIONS: Array<{
  id: BasemapStyle;
  label: string;
  short: string;
  desc: string;
  swatch: string;
}> = CUSTOM_MAP_READY
  ? [
      ...STANDARD_BASEMAP_OPTIONS,
      ...(CUSTOM_MAP_BASE_URL
        ? CUSTOM_STYLE_PRESETS.map((item) => ({
            id: item.id,
            label: item.label,
            short: item.short,
            desc: item.desc,
            swatch: item.swatch
          }))
        : [
            {
              id: 'custom' as BasemapStyle,
              label: '自定义地图',
              short: '自定义',
              desc: 'Maputnik / TileServer GL',
              swatch: 'custom'
            }
          ])
    ]
  : STANDARD_BASEMAP_OPTIONS;
