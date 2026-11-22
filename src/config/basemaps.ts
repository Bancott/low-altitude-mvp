export type BasemapStyle = 'dark' | 'light' | 'satellite' | 'custom';
type StandardBasemapStyle = Exclude<BasemapStyle, 'custom'>;

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
 * 在项目根目录 .env.local 写入：
 * VITE_CUSTOM_MAP_URL=http://localhost:8080/styles/low-altitude/{z}/{x}/{y}.png
 * 重启 dev server 后底图菜单会出现“自定义地图”。
 */
const CUSTOM_MAP_URL = String(import.meta.env.VITE_CUSTOM_MAP_URL ?? '').trim();
export const CUSTOM_MAP_READY = /^(https?:\/\/|\/).+/.test(CUSTOM_MAP_URL);
const CUSTOM_MAP_CREDIT =
  String(import.meta.env.VITE_CUSTOM_MAP_CREDIT ?? '').trim() ||
  '© OpenMapTiles · © OpenStreetMap contributors';

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
  maxLevel: 19,
  credit: CUSTOM_MAP_CREDIT,
  globeColor: '#c9d5e4',
  sceneColor: '#eef2f7',
  layers: [
    {
      url: CUSTOM_MAP_URL || 'http://localhost:8080/styles/low-altitude/{z}/{x}/{y}.png',
      credit: CUSTOM_MAP_CREDIT
    }
  ]
};

export function getBasemap(style: BasemapStyle): BasemapConfig {
  if (style === 'custom') return CUSTOM;
  return TIANDITU_READY ? TIANDITU[style] : ESRI[style];
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

export const BASEMAP_OPTIONS: Array<{
  id: BasemapStyle;
  label: string;
  short: string;
  desc: string;
  swatch: string;
}> = CUSTOM_MAP_READY
  ? [
      ...STANDARD_BASEMAP_OPTIONS,
      {
        id: 'custom',
        label: '自定义地图',
        short: '自定义',
        desc: 'Maputnik / TileServer GL',
        swatch: 'custom'
      }
    ]
  : STANDARD_BASEMAP_OPTIONS;
