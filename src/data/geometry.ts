import type { Airspace } from './scenario';

export type Ring = [number, number][];

/** 射线法判断点是否在环内（环不要求闭合，首尾会自动连接） */
export function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > lat !== yj > lat;
    if (crosses && lon < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** 面积加权重心，形状不规则时比顶点平均更稳 */
export function ringCentroid(ring: Ring): { lon: number; lat: number } {
  let twiceArea = 0;
  let x = 0;
  let y = 0;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j];
    const [x1, y1] = ring[i];
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    x += (x0 + x1) * cross;
    y += (y0 + y1) * cross;
  }

  if (Math.abs(twiceArea) < 1e-12) {
    const sum = ring.reduce<[number, number]>(
      (acc, [lo, la]) => [acc[0] + lo, acc[1] + la],
      [0, 0]
    );
    return { lon: sum[0] / ring.length, lat: sum[1] / ring.length };
  }

  return { lon: x / (3 * twiceArea), lat: y / (3 * twiceArea) };
}

/** 环的面积，单位平方米（小范围平面近似，误差 < 0.1%） */
export function ringArea(ring: Ring): number {
  const lat0 = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
  const mPerDegLat = 111132.92;
  const mPerDegLon = 111412.84 * Math.cos((lat0 * Math.PI) / 180);

  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = [ring[j][0] * mPerDegLon, ring[j][1] * mPerDegLat];
    const [x1, y1] = [ring[i][0] * mPerDegLon, ring[i][1] * mPerDegLat];
    area += x0 * y1 - x1 * y0;
  }
  return Math.abs(area) / 2;
}

/** 环的外接半径（米，以重心为圆心），用于取景与碰撞粗筛 */
export function ringRadius(ring: Ring): number {
  if (ring.length === 0) return 0;
  const { lon: cLon, lat: cLat } = ringCentroid(ring);
  const mPerDegLat = 111132.92;
  const mPerDegLon = 111412.84 * Math.cos((cLat * Math.PI) / 180);
  let max = 0;
  for (const [lon, lat] of ring) {
    const dx = (lon - cLon) * mPerDegLon;
    const dy = (lat - cLat) * mPerDegLat;
    max = Math.max(max, Math.hypot(dx, dy));
  }
  return max;
}

/** 三维判断：点是否落在空域体内（任一外环内即可） */
export function airspaceContains(
  airspace: Airspace,
  lon: number,
  lat: number,
  alt: number
): boolean {
  if (alt < airspace.minAlt || alt > airspace.maxAlt) return false;
  return airspace.polygons.some((ring) => pointInRing(lon, lat, ring));
}
