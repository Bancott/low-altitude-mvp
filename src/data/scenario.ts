export type AirspaceKind = 'control' | 'advisory' | 'no-fly' | 'temporary';

export interface Airspace {
  id: string;
  name: string;
  code: string;
  kind: AirspaceKind;
  color: string;
  minAlt: number;
  maxAlt: number;
  /** 1 个或多个外环；空域 = 这些环向上拉伸的棱柱集合 */
  polygons: [number, number][][];
  description: string;
  authority: string;
  status: string;
  /** 来源：内置示例 / 手绘 / 导入 */
  source?: 'builtin' | 'drawn' | 'imported';
  /** 生效时间窗（秒，对应模拟时间轴），留空表示全程生效 */
  window?: { from: number; to: number };
}

export interface RoutePoint {
  lon: number;
  lat: number;
  alt: number;
}

export type DroneKind = 'logistics' | 'inspection' | 'patrol' | 'emergency';

export interface Drone {
  id: string;
  callsign: string;
  model: string;
  operator: string;
  kind: DroneKind;
  color: string;
  route: RoutePoint[];
  speed: number;
  phase: number;
  plan: string;
}

export interface AlertEvent {
  id: string;
  droneId: string;
  droneCallsign: string;
  airspaceId: string;
  airspaceName: string;
  type: 'NO_FLY_INTRUSION' | 'ALTITUDE_DEVIATION' | 'TEMP_RESTRICTION';
  level: 'critical' | 'warning';
  title: string;
  message: string;
  start: number;
  end: number;
}

export interface DronePosition {
  lon: number;
  lat: number;
  alt: number;
  heading: number;
  progress: number;
}

export const AIRSPACE_META: Record<
  AirspaceKind,
  { label: string; short: string; description: string }
> = {
  control: {
    label: '管制空域',
    short: 'CTR',
    description: '需要接受低空运行管理、保持监视与通信的空域。'
  },
  advisory: {
    label: '适飞空域',
    short: 'ADV',
    description: '面向轻型无人机开放的适飞区域，默认限高 120m。'
  },
  'no-fly': {
    label: '临时禁飞',
    short: 'NFZ',
    description: '因重大活动或临时任务划设的禁飞区域，任何目标不得进入。'
  },
  temporary: {
    label: '临时限制',
    short: 'TMP',
    description: '在特定时间窗口内限制飞行高度或速度的临时区域。'
  }
};

export const DRONE_KIND_META: Record<DroneKind, { label: string; color: string }> = {
  logistics: { label: '物流配送', color: '#0EA5E9' },
  inspection: { label: '城市巡检', color: '#3B82F6' },
  patrol: { label: '安防巡逻', color: '#8B5CF6' },
  emergency: { label: '应急救援', color: '#F59E0B' }
};

export const SIM_DURATION = 420;
export const BASE_TIME = new Date('2026-11-02T14:32:00+08:00').getTime();

export const AIRSPACES: Airspace[] = [
  {
    id: 'AS-001',
    code: 'SZ-NS-CTR-01',
    name: '南山低空管制区',
    kind: 'control',
    color: '#4F7DF3',
    minAlt: 0,
    maxAlt: 300,
    polygons: [
      [
        [113.895, 22.510],
        [113.970, 22.510],
        [113.972, 22.565],
        [113.900, 22.568]
      ]
    ],
    description: '南山核心区低空管制空域，覆盖物流、巡检和应急飞行活动。',
    authority: '深圳市低空运行管理中心',
    status: '运行中'
  },
  {
    id: 'AS-002',
    code: 'SZ-NS-ADV-03',
    name: '前海适飞空域',
    kind: 'advisory',
    color: '#2BB6A8',
    minAlt: 0,
    maxAlt: 120,
    polygons: [
      [
        [113.872, 22.505],
        [113.925, 22.505],
        [113.925, 22.548],
        [113.872, 22.548]
      ]
    ],
    description: '前海片区轻型无人机适飞空域，默认限高 120m。',
    authority: '深圳市低空运行管理中心',
    status: '运行中'
  },
  {
    id: 'AS-003',
    code: 'SZ-NS-NFZ-07',
    name: '深圳湾临时禁飞区',
    kind: 'no-fly',
    color: '#E5484D',
    minAlt: 0,
    maxAlt: 300,
    polygons: [
      [
        [113.920, 22.508],
        [113.945, 22.505],
        [113.956, 22.515],
        [113.948, 22.526],
        [113.928, 22.523],
        [113.918, 22.515]
      ]
    ],
    description: '因重大活动保障划设的临时禁飞区，活动期间禁止一切未授权飞行。',
    authority: '深圳市公安局低空警务支队',
    status: '生效中'
  },
  {
    id: 'AS-004',
    code: 'SZ-NS-TMP-12',
    name: '人才公园临时限制区',
    kind: 'temporary',
    color: '#E49A2F',
    minAlt: 0,
    maxAlt: 150,
    polygons: [
      [
        [113.942, 22.532],
        [113.962, 22.532],
        [113.962, 22.552],
        [113.942, 22.552]
      ]
    ],
    description: '人才公园灯光秀期间临时限制区，飞行高度不得超过 150m。',
    authority: '南山区低空经济工作专班',
    status: '18:00 生效'
  }
];

const p = (lon: number, lat: number, alt: number): RoutePoint => ({ lon, lat, alt });

export const DRONES: Drone[] = [
  {
    id: 'UAV-001',
    callsign: 'UAV-001',
    model: 'DJI FlyCart 30',
    operator: '南山低空物流',
    kind: 'logistics',
    color: '#0EA5E9',
    speed: 26,
    phase: 0.02,
    plan: '物流航线 L-01 · 前海 → 科技园',
    route: [
      p(113.880, 22.512, 118),
      p(113.900, 22.512, 118),
      p(113.920, 22.512, 118),
      p(113.940, 22.512, 118),
      p(113.960, 22.512, 118),
      p(113.975, 22.512, 118)
    ]
  },
  {
    id: 'UAV-002',
    callsign: 'UAV-002',
    model: 'DJI Matrice 350',
    operator: '城市安全巡检',
    kind: 'patrol',
    color: '#8B5CF6',
    speed: 19,
    phase: 0.18,
    plan: '安防巡逻 P-02 · 南山中心区环线',
    route: [
      p(113.905, 22.545, 180),
      p(113.925, 22.555, 180),
      p(113.945, 22.545, 180),
      p(113.925, 22.535, 180),
      p(113.905, 22.545, 180)
    ]
  },
  {
    id: 'UAV-003',
    callsign: 'UAV-003',
    model: 'Autel EVO Max 4T',
    operator: '电力设施巡检',
    kind: 'inspection',
    color: '#3B82F6',
    speed: 16,
    phase: 0.41,
    plan: '巡检航线 I-03 · 科技园变电站',
    route: [
      p(113.930, 22.560, 92),
      p(113.930, 22.540, 92),
      p(113.950, 22.540, 92),
      p(113.950, 22.560, 92),
      p(113.930, 22.560, 92)
    ]
  },
  {
    id: 'UAV-004',
    callsign: 'UAV-004',
    model: 'DJI FlyCart 30',
    operator: '南山低空物流',
    kind: 'logistics',
    color: '#0EA5E9',
    speed: 24,
    phase: 0.63,
    plan: '物流航线 L-04 · 后海 → 前海',
    route: [
      p(113.890, 22.530, 100),
      p(113.910, 22.530, 100),
      p(113.930, 22.530, 100),
      p(113.950, 22.530, 100),
      p(113.970, 22.530, 100)
    ]
  },
  {
    id: 'UAV-005',
    callsign: 'UAV-005',
    model: 'EHang 216',
    operator: '低空应急保障',
    kind: 'emergency',
    color: '#F59E0B',
    speed: 31,
    phase: 0.11,
    plan: '应急航线 E-05 · 人才公园备勤',
    route: [
      p(113.960, 22.550, 150),
      p(113.940, 22.550, 150),
      p(113.920, 22.550, 150),
      p(113.900, 22.550, 150),
      p(113.960, 22.550, 150)
    ]
  },
  {
    id: 'UAV-006',
    callsign: 'UAV-006',
    model: 'DJI Matrice 400',
    operator: '前海城市服务',
    kind: 'inspection',
    color: '#3B82F6',
    speed: 18,
    phase: 0.34,
    plan: '巡检航线 I-06 · 前海超高层',
    route: [
      p(113.885, 22.525, 162),
      p(113.905, 22.525, 162),
      p(113.925, 22.525, 162),
      p(113.925, 22.545, 162),
      p(113.885, 22.525, 162)
    ]
  },
  {
    id: 'UAV-007',
    callsign: 'UAV-007',
    model: 'DJI Mavic 3E',
    operator: '深圳湾生态监测',
    kind: 'inspection',
    color: '#3B82F6',
    speed: 15,
    phase: 0.77,
    plan: '生态巡检 I-07 · 深圳湾岸线',
    route: [
      p(113.940, 22.505, 80),
      p(113.960, 22.505, 80),
      p(113.960, 22.525, 80),
      p(113.940, 22.525, 80),
      p(113.940, 22.505, 80)
    ]
  },
  {
    id: 'UAV-008',
    callsign: 'UAV-008',
    model: 'DJI Matrice 350',
    operator: '城市安全巡检',
    kind: 'patrol',
    color: '#8B5CF6',
    speed: 22,
    phase: 0.52,
    plan: '安防巡逻 P-08 · 后海中心区',
    route: [
      p(113.970, 22.540, 220),
      p(113.950, 22.540, 220),
      p(113.930, 22.540, 220),
      p(113.910, 22.540, 220),
      p(113.970, 22.540, 220)
    ]
  },
  {
    id: 'UAV-009',
    callsign: 'UAV-009',
    model: 'Autel EVO Max 4T',
    operator: '深圳湾生态监测',
    kind: 'inspection',
    color: '#3B82F6',
    speed: 14,
    phase: 0.29,
    plan: '生态巡检 I-09 · 滨海湿地',
    route: [
      p(113.900, 22.500, 60),
      p(113.920, 22.500, 60),
      p(113.940, 22.500, 60),
      p(113.960, 22.500, 60),
      p(113.900, 22.500, 60)
    ]
  },
  {
    id: 'UAV-010',
    callsign: 'UAV-010',
    model: 'EHang 216',
    operator: '低空应急保障',
    kind: 'emergency',
    color: '#F59E0B',
    speed: 20,
    phase: 0.86,
    plan: '应急航线 E-10 · 南山医院备勤',
    route: [
      p(113.935, 22.570, 100),
      p(113.955, 22.560, 100),
      p(113.935, 22.550, 100),
      p(113.915, 22.560, 100),
      p(113.935, 22.570, 100)
    ]
  }
];

const EARTH_RADIUS = 6371000;

function segmentLength(a: RoutePoint, b: RoutePoint): number {
  const lat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dx = (b.lon - a.lon) * (Math.PI / 180) * EARTH_RADIUS * Math.cos(lat);
  const dy = (b.lat - a.lat) * (Math.PI / 180) * EARTH_RADIUS;
  return Math.hypot(dx, dy, b.alt - a.alt);
}

export function routeLength(route: RoutePoint[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i += 1) {
    total += segmentLength(route[i - 1], route[i]);
  }
  return total;
}

export function dronePeriod(drone: Drone): number {
  return Math.max(60, routeLength(drone.route) / drone.speed);
}

export function positionAt(drone: Drone, time: number): DronePosition {
  const period = dronePeriod(drone);
  const raw = time / period + drone.phase;
  const u = ((raw % 1) + 1) % 1;
  const lengths: number[] = [];
  let total = 0;

  for (let i = 1; i < drone.route.length; i += 1) {
    const len = segmentLength(drone.route[i - 1], drone.route[i]);
    lengths.push(len);
    total += len;
  }

  const target = u * total;
  let acc = 0;
  for (let i = 0; i < lengths.length; i += 1) {
    const len = lengths[i];
    if (target <= acc + len || i === lengths.length - 1) {
      const t = len === 0 ? 0 : (target - acc) / len;
      const a = drone.route[i];
      const b = drone.route[i + 1];
      const lon = a.lon + (b.lon - a.lon) * t;
      const lat = a.lat + (b.lat - a.lat) * t;
      const alt = a.alt + (b.alt - a.alt) * t;
      const latRad = lat * (Math.PI / 180);
      const dx = (b.lon - a.lon) * Math.cos(latRad);
      const dy = b.lat - a.lat;
      const heading = (Math.atan2(dx, dy) * 180) / Math.PI;
      return { lon, lat, alt, heading: (heading + 360) % 360, progress: u };
    }
    acc += len;
  }

  const last = drone.route[drone.route.length - 1];
  return { lon: last.lon, lat: last.lat, alt: last.alt, heading: 0, progress: u };
}

export function formatClock(seconds: number): string {
  const date = new Date(BASE_TIME + seconds * 1000);
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(safe / 60)
    .toString()
    .padStart(2, '0');
  const ss = (safe % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

export function formatDate(seconds: number): string {
  const date = new Date(BASE_TIME + seconds * 1000);
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  })
    .format(date)
    .replace(/\//g, '.');
}
