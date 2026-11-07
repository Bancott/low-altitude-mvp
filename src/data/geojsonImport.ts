import type { Airspace, AirspaceKind } from './scenario';

/** 四类空域的固定色，列表 / 地图 / 导入共用同一份 */
export const KIND_COLOR: Record<AirspaceKind, string> = {
  control: '#4F7DF3',
  advisory: '#2BB6A8',
  'no-fly': '#E5484D',
  temporary: '#E49A2F'
};

export const KIND_STATUS: Record<AirspaceKind, string> = {
  control: '运行中',
  advisory: '运行中',
  'no-fly': '生效中',
  temporary: '限制中'
};

export type LonLat = [number, number];

export interface ImportIssue {
  name: string;
  reason: string;
}

export interface ImportResult {
  items: Array<Omit<Airspace, 'id'>>;
  issues: ImportIssue[];
}

/** 判断某个环是否有效，返回 null 表示可用，否则返回原因 */
function validateRing(ring: unknown): { ring: LonLat[] } | { reason: string } {
  if (!Array.isArray(ring) || ring.length < 3) return { reason: '顶点不足 3 个' };
  const points: LonLat[] = [];
  for (const item of ring) {
    if (!Array.isArray(item) || item.length < 2) return { reason: '坐标格式不是 [lon, lat]' };
    const lon = Number(item[0]);
    const lat = Number(item[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return { reason: '坐标含非数字' };
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      return { reason: '坐标超出经纬度范围（可能不是 WGS84 / CGCS2000）' };
    }
    points.push([lon, lat]);
  }
  // 去掉末尾重复点，后面统一闭合
  const dedup: LonLat[] = [];
  for (const p of points) {
    const last = dedup[dedup.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-9 || Math.abs(last[1] - p[1]) > 1e-9) dedup.push(p);
  }
  if (dedup.length >= 2) {
    const first = dedup[0];
    const last = dedup[dedup.length - 1];
    if (Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) dedup.pop();
  }
  if (dedup.length < 3) return { reason: '去重后顶点不足 3 个' };
  if (ringAreaMeters(dedup) < 50) return { reason: '面积过小（< 50 m²）' };
  return { ring: dedup };
}

/** 球面近似下的环面积（平方米），仅用于过滤破碎面 */
function ringAreaMeters(ring: LonLat[]): number {
  if (ring.length < 3) return 0;
  const lat0 = (ring.reduce((sum, p) => sum + p[1], 0) / ring.length) * (Math.PI / 180);
  const kx = 111320 * Math.cos(lat0);
  const ky = 110540;
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    area += x1 * kx * (y2 * ky) - x2 * kx * (y1 * ky);
  }
  return Math.abs(area / 2);
}

function pickNumber(props: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = props[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const value = Number(String(raw).replace(/[^\d.+-]/g, ''));
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function pickString(props: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = props[key];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return undefined;
}

function normalizeKind(raw: string | undefined, name: string): AirspaceKind {
  const text = `${raw ?? ''} ${name}`.toLowerCase();
  if (/no.?fly|nfz|prohibit|forbid|禁飞/.test(text)) return 'no-fly';
  if (/temporar|restrict|limit|限制|临时/.test(text)) return 'temporary';
  if (/advis|suitable|open|适飞/.test(text)) return 'advisory';
  return 'control';
}

type Geometry = { type: string; coordinates?: unknown };

function collectPolygons(geometry: Geometry | null): { rings: LonLat[][]; error?: string } {
  if (!geometry || typeof geometry !== 'object') return { rings: [], error: '缺少 geometry' };
  const { type, coordinates } = geometry;
  if (type === 'Polygon') {
    if (!Array.isArray(coordinates) || !Array.isArray(coordinates[0])) {
      return { rings: [], error: 'Polygon 坐标结构不合法' };
    }
    return { rings: [coordinates[0] as LonLat[]] };
  }
  if (type === 'MultiPolygon') {
    if (!Array.isArray(coordinates)) return { rings: [], error: 'MultiPolygon 坐标结构不合法' };
    const rings: LonLat[][] = [];
    for (const poly of coordinates) {
      if (Array.isArray(poly) && Array.isArray(poly[0])) rings.push(poly[0] as LonLat[]);
    }
    if (!rings.length) return { rings: [], error: 'MultiPolygon 内没有有效多边形' };
    return { rings };
  }
  return { rings: [], error: `不支持的几何类型 ${type}` };
}

/**
 * 解析 GeoJSON 文本为可直接写入 store 的空域数据。
 * 支持 FeatureCollection / Feature / 裸几何；只取外环（内环孔洞暂不处理）。
 */
export function parseAirspacesGeoJSON(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('不是合法的 JSON 文件');
  }

  const root = data as { type?: string; features?: unknown[]; geometry?: Geometry };
  let features: Array<{ type?: string; geometry?: Geometry | null; properties?: Record<string, unknown> }> = [];

  if (root?.type === 'FeatureCollection' && Array.isArray(root.features)) {
    features = root.features as typeof features;
  } else if (root?.type === 'Feature') {
    features = [root as unknown as (typeof features)[number]];
  } else if (root?.type) {
    features = [{ type: 'Feature', geometry: root as unknown as Geometry, properties: {} }];
  } else {
    throw new Error('不是 GeoJSON：缺少 type 字段');
  }

  const items: ImportResult['items'] = [];
  const issues: ImportIssue[] = [];

  features.forEach((feature, index) => {
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const rawName = pickString(props, ['name', 'NAME', 'Name', '名称', 'title', 'id']);
    const name = rawName || `导入区域 ${index + 1}`;
    const kind = normalizeKind(pickString(props, ['kind', 'type', 'zone', 'zoneType', '类别', '类型']), name);

    const { rings, error } = collectPolygons(feature.geometry ?? null);
    if (error) {
      issues.push({ name, reason: error });
      return;
    }

    const polygons: LonLat[][] = [];
    let badReason = '';
    for (const ring of rings) {
      const checked = validateRing(ring);
      if ('reason' in checked) {
        badReason = checked.reason;
        continue;
      }
      polygons.push(checked.ring);
    }
    if (!polygons.length) {
      issues.push({ name, reason: badReason || '没有可用的面' });
      return;
    }

    const maxAlt = pickNumber(props, ['maxAlt', 'max_alt', 'ceiling', 'upper', 'top', 'height', '高度', '顶高']);
    const minAlt = pickNumber(props, ['minAlt', 'min_alt', 'floor', 'lower', 'bottom', '底高']);
    const clampAlt = (value: number | undefined, fallback: number) =>
      Math.max(0, Math.min(1000, Math.round(value ?? fallback)));

    const low = clampAlt(minAlt, 0);
    const high = clampAlt(maxAlt, 120);

    items.push({
      name,
      code: pickString(props, ['code', 'CODE', '编号']) ?? `IMP-${index + 1}`,
      kind,
      color: KIND_COLOR[kind],
      minAlt: Math.min(low, high),
      maxAlt: Math.max(low, high),
      polygons,
      description: pickString(props, ['description', 'desc', 'note', '备注']) ?? '由 GeoJSON 文件导入。',
      authority: pickString(props, ['authority', 'source', '来源']) ?? '外部数据',
      status: KIND_STATUS[kind],
      source: 'imported'
    });
  });

  return { items, issues };
}
