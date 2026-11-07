import { pointInRing } from './geometry';
import type { Airspace } from './scenario';

/**
 * 二维最短路径规划（单高度层）。
 *
 * 思路：把研究区按固定格网切成栅格，凡是"在该高度上不可通行"的空域覆盖到的格子标为障碍，
 * 用 8 邻域 A* 找一条折线，再做视线简化（string pulling）把锯齿拉直。
 * 纯函数、不依赖 Cesium，方便单测，也方便以后整体搬到后端。
 */

export interface PlanInput {
  from: [number, number];
  to: [number, number];
  /** 飞行高度（米），用于判断穿越哪些空域的垂直区间 */
  alt: number;
  airspaces: Airspace[];
  /** 格网边长（米），不传则按距离自适应 */
  cellSize?: number;
}

export interface PlanResult {
  ok: boolean;
  /** 经纬度折线，含起终点 */
  path: [number, number][];
  /** 折线长度（米） */
  distance: number;
  /** 原始栅格折线的转弯点数（简化前） */
  rawPoints: number;
  /** A* 展开的节点数，用于说明搜索规模 */
  expanded: number;
  /** 直线穿越、因而促使绕行的空域名称 */
  blockedBy: string[];
  /** 失败的说明 */
  reason?: string;
}

/** 会阻断飞行的空域类型：禁飞与临时限制；管制区与适飞区可通行 */
const BLOCKING_KINDS = new Set(['no-fly', 'temporary']);

const METERS_PER_DEG_LAT = 110540;

function metersPerDegLon(lat: number): number {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function blocksPoint(airspaces: Airspace[], lon: number, lat: number, alt: number): Airspace | null {
  for (const airspace of airspaces) {
    if (!BLOCKING_KINDS.has(airspace.kind)) continue;
    if (alt < airspace.minAlt || alt > airspace.maxAlt) continue;
    if (airspace.polygons.some((ring) => pointInRing(lon, lat, ring))) return airspace;
  }
  return null;
}

/** 从 a 到 b 的直线是否穿过任何阻断型空域 */
function segmentBlocked(
  airspaces: Airspace[],
  a: [number, number],
  b: [number, number],
  alt: number
): Airspace | null {
  const len = haversine(a, b);
  const steps = Math.max(2, Math.ceil(len / 20));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const lon = a[0] + (b[0] - a[0]) * t;
    const lat = a[1] + (b[1] - a[1]) * t;
    const hit = blocksPoint(airspaces, lon, lat, alt);
    if (hit) return hit;
  }
  return null;
}

/** 极简二叉堆，key 为节点的 f 值 */
class MinHeap {
  private items: number[] = [];

  private f: Float64Array;

  constructor(fScore: Float64Array) {
    this.f = fScore;
  }

  get size(): number {
    return this.items.length;
  }

  push(node: number): void {
    const items = this.items;
    items.push(node);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.f[items[parent]] <= this.f[items[i]]) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): number {
    const items = this.items;
    const top = items[0];
    const last = items.pop() as number;
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && this.f[items[left]] < this.f[items[smallest]]) smallest = left;
        if (right < items.length && this.f[items[right]] < this.f[items[smallest]]) smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

const NEIGHBORS: Array<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2]
];

export function planRoute(input: PlanInput): PlanResult {
  const { from, to, alt, airspaces } = input;
  const empty: PlanResult = {
    ok: false,
    path: [],
    distance: 0,
    rawPoints: 0,
    expanded: 0,
    blockedBy: [],
    reason: ''
  };

  if (!from || !to) return { ...empty, reason: '缺少起点或终点' };
  const direct = haversine(from, to);
  if (direct < 30) return { ...empty, reason: '起点与终点过近' };
  if (direct > 60000) return { ...empty, reason: '起终点距离超过 60 km，超出演示范围' };

  const startBlock = blocksPoint(airspaces, from[0], from[1], alt);
  if (startBlock) return { ...empty, reason: `起点位于「${startBlock.name}」内（该高度不可通行）` };
  const endBlock = blocksPoint(airspaces, to[0], to[1], alt);
  if (endBlock) return { ...empty, reason: `终点位于「${endBlock.name}」内（该高度不可通行）` };

  // 直线受阻的空域 —— 报告给用户"为什么绕行"
  const blockedBy = new Set<string>();
  const straightHit = segmentBlocked(airspaces, from, to, alt);
  if (straightHit) blockedBy.add(straightHit.name);
  for (const airspace of airspaces) {
    if (!BLOCKING_KINDS.has(airspace.kind)) continue;
    if (alt < airspace.minAlt || alt > airspace.maxAlt) continue;
    if (segmentBlocked([airspace], from, to, alt)) blockedBy.add(airspace.name);
  }

  // 局部平面坐标（等距投影，范围只有几十公里，误差可忽略）
  const lat0 = (from[1] + to[1]) / 2;
  const kx = metersPerDegLon(lat0);
  const ky = METERS_PER_DEG_LAT;
  const toXY = (p: [number, number]): [number, number] => [p[0] * kx, p[1] * ky];
  const toLonLat = (x: number, y: number): [number, number] => [x / kx, y / ky];

  const [fx, fy] = toXY(from);
  const [tx, ty] = toXY(to);

  const margin = Math.min(4000, Math.max(600, direct * 0.35));
  const minX = Math.min(fx, tx) - margin;
  const maxX = Math.max(fx, tx) + margin;
  const minY = Math.min(fy, ty) - margin;
  const maxY = Math.max(fy, ty) + margin;

  const cell = input.cellSize ?? Math.min(160, Math.max(50, direct / 140));
  const cols = Math.ceil((maxX - minX) / cell);
  const rows = Math.ceil((maxY - minY) / cell);
  if (cols * rows > 260000) return { ...empty, reason: '搜索范围过大' };

  const total = cols * rows;
  const blocked = new Uint8Array(total);

  const toCell = (x: number, y: number): [number, number] => [
    Math.floor((x - minX) / cell),
    Math.floor((y - minY) / cell)
  ];
  const cellCenter = (cx: number, cy: number): [number, number] => [
    minX + (cx + 0.5) * cell,
    minY + (cy + 0.5) * cell
  ];

  // 只对每个空域的包围盒内做逐格判断，避免全图 × 全空域的开销
  for (const airspace of airspaces) {
    if (!BLOCKING_KINDS.has(airspace.kind)) continue;
    if (alt < airspace.minAlt || alt > airspace.maxAlt) continue;
    let aMinX = Infinity;
    let aMaxX = -Infinity;
    let aMinY = Infinity;
    let aMaxY = -Infinity;
    for (const ring of airspace.polygons) {
      for (const [lon, lat] of ring) {
        const x = lon * kx;
        const y = lat * ky;
        if (x < aMinX) aMinX = x;
        if (x > aMaxX) aMaxX = x;
        if (y < aMinY) aMinY = y;
        if (y > aMaxY) aMaxY = y;
      }
    }
    const [c0, r0] = toCell(aMinX, aMinY);
    const [c1, r1] = toCell(aMaxX, aMaxY);
    for (let cy = Math.max(0, r0); cy <= Math.min(rows - 1, r1); cy += 1) {
      const lat = minY + (cy + 0.5) * cell;
      for (let cx = Math.max(0, c0); cx <= Math.min(cols - 1, c1); cx += 1) {
        const idx = cy * cols + cx;
        if (blocked[idx]) continue;
        const lon = minX + (cx + 0.5) * cell;
        if (airspace.polygons.some((ring) => pointInRing(lon / kx, lat / ky, ring))) {
          blocked[idx] = 1;
        }
      }
    }
  }

  const nearestFree = (cx: number, cy: number): [number, number] | null => {
    if (cx >= 0 && cy >= 0 && cx < cols && cy < rows && !blocked[cy * cols + cx]) return [cx, cy];
    for (let r = 1; r <= 6; r += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          if (!blocked[ny * cols + nx]) return [nx, ny];
        }
      }
    }
    return null;
  };

  const [fsx, fsy] = toCell(fx, fy);
  const [tsx, tsy] = toCell(tx, ty);
  const startCell = nearestFree(fsx, fsy);
  const endCell = nearestFree(tsx, tsy);
  if (!startCell || !endCell) return { ...empty, reason: '起点或终点附近没有可通行格子' };

  const startIdx = startCell[1] * cols + startCell[0];
  const endIdx = endCell[1] * cols + endCell[0];

  const gScore = new Float32Array(total).fill(Infinity);
  const fScore = new Float64Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const state = new Uint8Array(total); // 0 未访问 1 在开集 2 已关闭
  const heap = new MinHeap(fScore);

  const heuristic = (cx: number, cy: number): number => {
    const dx = Math.abs(cx - endCell[0]);
    const dy = Math.abs(cy - endCell[1]);
    return (dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy)) * cell;
  };

  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(startCell[0], startCell[1]);
  heap.push(startIdx);
  state[startIdx] = 1;
  let expanded = 0;

  while (heap.size) {
    const current = heap.pop();
    if (state[current] === 2) continue;
    state[current] = 2;
    expanded += 1;
    if (current === endIdx) break;

    const cx = current % cols;
    const cy = (current - cx) / cols;

    for (const [dx, dy, cost] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nIdx = ny * cols + nx;
      if (blocked[nIdx] || state[nIdx] === 2) continue;
      // 斜向走位不允许贴角穿过障碍
      if (dx !== 0 && dy !== 0) {
        if (blocked[cy * cols + nx] || blocked[ny * cols + cx]) continue;
      }
      const tentative = gScore[current] + cost * cell;
      if (tentative < gScore[nIdx]) {
        gScore[nIdx] = tentative;
        fScore[nIdx] = tentative + heuristic(nx, ny);
        cameFrom[nIdx] = current;
        state[nIdx] = 1;
        heap.push(nIdx);
      }
    }
  }

  if (cameFrom[endIdx] === -1 && endIdx !== startIdx) {
    return { ...empty, reason: '搜索范围内没有可行通路', expanded, blockedBy: [...blockedBy] };
  }

  const cells: number[] = [];
  let cursor = endIdx;
  while (cursor !== -1) {
    cells.push(cursor);
    if (cursor === startIdx) break;
    cursor = cameFrom[cursor];
  }
  cells.reverse();

  const raw = cells.map((idx) => {
    const cx = idx % cols;
    const cy = (idx - cx) / cols;
    const [x, y] = cellCenter(cx, cy);
    return toLonLat(x, y);
  });
  raw[0] = from;
  raw[raw.length - 1] = to;

  // 视线简化：从当前点尽可能往后直连
  const simplified: [number, number][] = [raw[0]];
  let i = 0;
  while (i < raw.length - 1) {
    let far = i + 1;
    // 只向前看 80 个栅格点，避免长路径上的 O(n²) 视线测试
    const limit = Math.min(raw.length - 1, i + 80);
    for (let j = limit; j > i + 1; j -= 1) {
      if (!segmentBlocked(airspaces, raw[i], raw[j], alt)) {
        far = j;
        break;
      }
    }
    simplified.push(raw[far]);
    i = far;
  }

  let distance = 0;
  for (let k = 1; k < simplified.length; k += 1) {
    distance += haversine(simplified[k - 1], simplified[k]);
  }

  return {
    ok: true,
    path: simplified,
    distance,
    rawPoints: raw.length,
    expanded,
    blockedBy: [...blockedBy]
  };
}
