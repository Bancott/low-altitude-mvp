<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
  type CSSProperties
} from 'vue';
import Icon from './components/Icon.vue';
import EqMark from './components/EqMark.vue';
import AirspaceForm from './components/AirspaceForm.vue';
import { useTheme } from './composables/useTheme';
import { useAmbientParticles } from './composables/useAmbientParticles';
import {
  LowAltitudeScene,
  type CameraInfo,
  type DrawMode,
  type LayerKey,
  type Selection
} from './cesium/LowAltitudeScene';
import {
  BASEMAP_OPTIONS,
  TIANDITU_READY,
  getBasemap,
  type BasemapStyle
} from './config/basemaps';
import layersIcon from './assets/icons/layers.svg?url';
import routeIcon from './assets/icons/route.svg?url';
import droneIcon from './assets/icons/drone.svg?url';
import trailIcon from './assets/icons/trail.svg?url';
import targetIcon from './assets/icons/target.svg?url';
import {
  AIRSPACE_META,
  DRONES,
  DRONE_KIND_META,
  SIM_DURATION,
  type AirspaceKind,
  type AlertEvent,
  formatClock,
  formatDate,
  formatDuration,
  positionAt
} from './data/scenario';
import { addAirspace, airspaceRevision, airspaces, nextAirspaceId, removeAirspace } from './data/airspaceStore';
import { KIND_COLOR, parseAirspacesGeoJSON } from './data/geojsonImport';
import { planRoute, type PlanResult } from './data/pathPlan';
import { alertEvents } from './data/alerts';

const mapEl = ref<HTMLElement | null>(null);
const particleEl = ref<HTMLCanvasElement | null>(null);
const scene = ref<LowAltitudeScene | null>(null);
const loading = ref(true);
const error = ref('');
const isPlaying = ref(true);
const speed = ref(2);
const simTime = ref(0);
const selected = ref<Selection>(null);
const followId = ref<string | null>(null);
const fpvId = ref<string | null>(null);
const basemap = ref<BasemapStyle>('dark');
const drawerOpen = ref(false);
const showDesignPanel = ref(false);
const sidebarTab = ref<'airspace' | 'targets' | 'alerts'>('airspace');
const sidebarOpen = ref(true);
const mode = ref<'3d' | '2d'>('3d');
const searchQuery = ref('');
const toast = ref<{ message: string; type: 'info' | 'success' | 'warn' } | null>(null);
const cameraInfo = ref<CameraInfo>({ lon: 113.935, lat: 22.525, height: 8600, heading: 0 });
const glitch = ref(false);

const drawingAirspace = ref(false);
const drawMode = ref<DrawMode>('polygon');
const drawPan = ref(false);
const drawRings = ref(0);
const drawPoints = ref(0);
const pendingRings = ref<[number, number][][]>([]);
const showAirForm = ref(false);
let modeBeforeDraw: '3d' | '2d' | null = null;

const { mode: themeMode, resolvedTheme, setMode: setThemeMode } = useTheme();
const { burst } = useAmbientParticles(particleEl);

const layerState = reactive<Record<LayerKey, boolean>>({
  airspace: true,
  routes: true,
  drones: true,
  trails: true,
  alerts: true,
  buildings: true
});

const railLayers: Array<{
  key: LayerKey;
  label: string;
  icon: string;
  mask?: string;
  size: number;
  color: string;
}> = [
  { key: 'airspace', label: '空域结构', icon: 'layers', mask: layersIcon, size: 17, color: '#4F7DF3' },
  { key: 'routes', label: '计划航线', icon: 'route', mask: routeIcon, size: 26, color: '#2BB6A8' },
  { key: 'drones', label: '实时目标', icon: 'drone', mask: droneIcon, size: 19, color: '#8B5CF6' },
  { key: 'trails', label: '飞行尾迹', icon: 'signal', mask: trailIcon, size: 25, color: '#35C28B' },
  { key: 'alerts', label: '告警标记', icon: 'alert', size: 20, color: '#F0553F' },
  { key: 'buildings', label: '建筑体块', icon: 'cube', size: 18, color: '#7C8DA6' }
];

const maskStyle = (url: string, size = 17): CSSProperties =>
  ({
    '--mask': `url("${url}")`,
    width: `${size}px`,
    height: `${size}px`
  }) as CSSProperties;

const speedOptions = [1, 2, 4];
const ticks = Array.from({ length: 8 }, (_, index) => index * 60);

const designPalette = [
  { name: '深空背景', value: '#050A12' },
  { name: '浅色底图', value: '#EEF2F7' },
  { name: '水系', value: '#0B2A3A' },
  { name: '管制空域', value: '#4F7DF3' },
  { name: '适飞空域', value: '#2BB6A8' },
  { name: '禁飞告警', value: '#E5484D' },
  { name: '临时限制', value: '#E49A2F' }
];
const designLayers = ['背景底色', '水系/岸线', '绿地与建筑', '道路分级', '行政边界', '地名标注', '业务空域叠加'];

const firstCritical = alertEvents.value.find((event) => event.level === 'critical') ?? alertEvents.value[0];
const INITIAL_TIME = Math.min(SIM_DURATION - 2, Math.max(0, (firstCritical?.start ?? 0) + 4));

let currentTime = INITIAL_TIME;
let raf = 0;
let lastFrame = 0;
let lastUi = 0;
let dirty = true;
let toastTimer: number | undefined;
let glitchTimer: number | undefined;
let glitchHold: number | undefined;
let parallaxFrame = 0;

simTime.value = INITIAL_TIME;

const activeAlerts = computed(() =>
  alertEvents.value.filter((event) => simTime.value >= event.start && simTime.value <= event.end)
);

const selectedDrone = computed(() => {
  if (selected.value?.kind !== 'drone') return null;
  return DRONES.find((drone) => drone.id === selected.value?.id) ?? null;
});

const selectedAirspace = computed(() => {
  if (selected.value?.kind !== 'airspace') return null;
  return airspaces.value.find((airspace) => airspace.id === selected.value?.id) ?? null;
});

const selectedDronePos = computed(() =>
  selectedDrone.value ? positionAt(selectedDrone.value, simTime.value) : null
);

const selectedDroneAlert = computed(() =>
  selectedDrone.value
    ? activeAlerts.value.find((alert) => alert.droneId === selectedDrone.value?.id) ?? null
    : null
);

const fpvDrone = computed(() =>
  fpvId.value ? DRONES.find((drone) => drone.id === fpvId.value) ?? null : null
);

const fpvPos = computed(() =>
  fpvDrone.value ? positionAt(fpvDrone.value, simTime.value) : null
);

const selectedAirspaceMeta = computed(() =>
  selectedAirspace.value ? AIRSPACE_META[selectedAirspace.value.kind] : null
);

const clock = computed(() => formatClock(simTime.value));
const dateLabel = formatDate(0);
const activeAlertCount = computed(() => activeAlerts.value.length);

const tabIndex = computed(() => {
  if (sidebarTab.value === 'targets') return 1;
  if (sidebarTab.value === 'alerts') return 2;
  return 0;
});
const tabStyle = computed<CSSProperties>(() => ({ '--tab': String(tabIndex.value) }) as CSSProperties);

const cameraLabel = computed(() => {
  const info = cameraInfo.value;
  const height =
    info.height >= 1000 ? `${(info.height / 1000).toFixed(1)} km` : `${Math.round(info.height)} m`;
  return `${info.lat.toFixed(3)}°N  ${info.lon.toFixed(3)}°E  ·  ${height}`;
});

const basemapCredit = computed(() => getBasemap(basemap.value).credit);

const currentBasemapLabel = computed(
  () => BASEMAP_OPTIONS.find((item) => item.id === basemap.value)?.label ?? ''
);

const alertBands = computed(() =>
  alertEvents.value.map((event) => ({
    id: event.id,
    level: event.level,
    left: `${(event.start / SIM_DURATION) * 100}%`,
    width: `${Math.max(0.35, ((event.end - event.start) / SIM_DURATION) * 100)}%`
  }))
);

const alertListAll = computed(() =>
  [...alertEvents.value].sort((a, b) => {
    const rank = { active: 0, upcoming: 1, ended: 2 } as const;
    const levelRank = { critical: 0, warning: 1 } as const;
    return (
      rank[alertState(a)] - rank[alertState(b)] ||
      levelRank[a.level] - levelRank[b.level] ||
      a.start - b.start
    );
  })
);

const targetRows = computed(() =>
  DRONES.map((drone) => {
    const pos = positionAt(drone, simTime.value);
    const alert = activeAlerts.value.find((item) => item.droneId === drone.id) ?? null;
    return { drone, pos, alert };
  }).sort(
    (a, b) =>
      Number(Boolean(b.alert)) - Number(Boolean(a.alert)) ||
      a.drone.callsign.localeCompare(b.drone.callsign)
  )
);

watch(resolvedTheme, (theme) => {
  if (!scene.value) return;
  const next: BasemapStyle = theme === 'light' ? 'light' : 'dark';
  basemap.value = next;
  scene.value.setBasemap(next);
});

// 空域数据变更（手绘 / 导入 / 删除）后，场景与选中态立即跟上
watch(airspaceRevision, () => {
  scene.value?.refreshAirspaces();
  if (
    selected.value?.kind === 'airspace' &&
    !airspaces.value.some((item) => item.id === selected.value?.id)
  ) {
    selected.value = null;
  }
});

watch(activeAlertCount, (next, previous) => {
  if (next <= previous) return;
  window.clearTimeout(glitchTimer);
  window.clearTimeout(glitchHold);
  glitch.value = false;
  glitchTimer = window.setTimeout(() => {
    glitch.value = true;
    glitchHold = window.setTimeout(() => (glitch.value = false), 460);
  }, 16);
});

watch(
  () => activeAlerts.value.map((alert) => alert.id).join(','),
  (next, previous) => {
    const known = new Set(previous ? previous.split(',') : []);
    const freshId = next.split(',').find((id) => id && !known.has(id));
    if (!freshId) return;
    const alert = alertEvents.value.find((item) => item.id === freshId);
    if (!alert) return;
    window.setTimeout(() => {
      const drone = DRONES.find((item) => item.id === alert.droneId);
      if (!drone) return;
      const pos = positionAt(drone, simTime.value);
      const point = scene.value?.project(pos.lon, pos.lat, pos.alt);
      if (!point) return;
      burst(point.x, point.y, alert.level === 'critical' ? '#F0553F' : '#F5A524');
    }, 40);
  }
);

function alertsAt(time: number): AlertEvent[] {
  return alertEvents.value.filter((event) => time >= event.start && time <= event.end);
}

function setTime(value: number): void {
  currentTime = Math.min(SIM_DURATION, Math.max(0, value));
  simTime.value = currentTime;
  scene.value?.update(currentTime, alertsAt(currentTime));
  dirty = true;
}

function startLoop(): void {
  lastFrame = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.08, (now - lastFrame) / 1000);
    lastFrame = now;

    if (isPlaying.value) {
      currentTime += dt * speed.value;
      if (currentTime >= SIM_DURATION) currentTime = 0;
      dirty = true;
    }

    if (dirty) {
      scene.value?.update(currentTime, alertsAt(currentTime));
      dirty = false;
    }

    if (now - lastUi > 90) {
      simTime.value = currentTime;
      lastUi = now;
    }

    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}

function handleSelect(selection: Selection): void {
  selected.value = selection;
  if (selection) {
    sidebarOpen.value = true;
    sidebarTab.value = selection.kind === 'drone' ? 'targets' : 'airspace';
  }
  if (followId.value && (selection?.kind !== 'drone' || selection.id !== followId.value)) {
    followId.value = null;
    scene.value?.stopFollow();
  }
  if (fpvId.value && (selection?.kind !== 'drone' || selection.id !== fpvId.value)) {
    exitFpv(true);
  }
}

function startDrawAirspace(): void {
  exitFpv(true);
  if (routeMode.value) closeRoutePlanner();
  followId.value = null;
  scene.value?.stopFollow();

  // 空域是棱柱，平面轮廓在 2D 下最好画：先切二维，画完再回三维看体
  if (mode.value !== '2d') {
    modeBeforeDraw = mode.value;
    mode.value = '2d';
    scene.value?.setMode('2d');
  }

  scene.value?.startAirspaceDraw(drawMode.value);
  drawingAirspace.value = true;
  drawRings.value = 0;
  drawPoints.value = 0;
  sidebarOpen.value = true;
  sidebarTab.value = 'airspace';
  showToast('在二维视图单击落点，双击或右键闭合当前块，可继续画下一块；Esc 取消', 'info');
}

function restoreModeAfterDraw(): void {
  if (!modeBeforeDraw) return;
  const previous = modeBeforeDraw;
  modeBeforeDraw = null;
  if (previous === '3d') {
    mode.value = '3d';
    scene.value?.setMode('3d');
  }
}

function handleDrawChange(state: {
  active: boolean;
  mode: DrawMode;
  pan: boolean;
  rings: number;
  points: number;
}): void {
  drawingAirspace.value = state.active;
  drawMode.value = state.mode;
  drawPan.value = state.pan;
  drawRings.value = state.rings;
  drawPoints.value = state.points;
}

function chooseDrawMode(mode: DrawMode): void {
  drawMode.value = mode;
  scene.value?.setAirspaceDrawMode(mode);
}

const DRAW_MODES: DrawMode[] = ['polygon', 'rectangle', 'circle'];
const drawModeOptions: Array<{ value: DrawMode; label: string }> = [
  { value: 'polygon', label: '自由' },
  { value: 'rectangle', label: '矩形' },
  { value: 'circle', label: '圆形' }
];
const drawModeIndex = computed(() => Math.max(0, DRAW_MODES.indexOf(drawMode.value)));

/* 形状滑块：可按住拖动，松手吸附到最近一档 ----------------------------- */
const drawModesEl = ref<HTMLElement | null>(null);
const drawDragging = ref(false);
const drawDragX = ref(0);

function measureDrawModes(): { left: number; segW: number } | null {
  const el = drawModesEl.value;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { left: rect.left, segW: (rect.width - 6) / 3 };
}

function trackOffset(clientX: number, track: { left: number; segW: number }): number {
  const raw = clientX - track.left - 3 - track.segW / 2;
  return Math.min(Math.max(raw, 0), track.segW * 2);
}

function startDrawModeDrag(event: PointerEvent): void {
  if (event.button !== 0) return;
  const el = drawModesEl.value;
  const track = measureDrawModes();
  if (!el || !track) return;
  drawDragging.value = true;
  drawDragX.value = trackOffset(event.clientX, track);
  el.setPointerCapture(event.pointerId);
}

function moveDrawModeDrag(event: PointerEvent): void {
  if (!drawDragging.value) return;
  const track = measureDrawModes();
  if (!track) return;
  drawDragX.value = trackOffset(event.clientX, track);
}

function endDrawModeDrag(event: PointerEvent): void {
  if (!drawDragging.value) return;
  const el = drawModesEl.value;
  const track = measureDrawModes();
  drawDragging.value = false;
  if (el?.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
  if (!track) return;
  const index = Math.min(Math.max(Math.round(drawDragX.value / track.segW), 0), 2);
  drawDragX.value = 0;
  const next = DRAW_MODES[index];
  if (next && next !== drawMode.value) chooseDrawMode(next);
}

function toggleDrawPan(): void {
  drawPan.value = !drawPan.value;
  scene.value?.setAirspaceDrawPan(drawPan.value);
}

const drawHint = computed(() => {
  if (drawMode.value === 'rectangle') return '点两个对角完成矩形';
  if (drawMode.value === 'circle') return '先点圆心再点圆周';
  return '单击落点，双击闭合';
});

function deleteSelectedAirspace(): void {
  const target = selectedAirspace.value;
  if (!target || (target.source && target.source === 'builtin')) return;
  removeAirspace(target.id);
  selected.value = null;
  showToast(`已删除「${target.name}」`, 'info');
}

function handleDrawFinish(rings: [number, number][][]): void {
  drawingAirspace.value = false;
  drawRings.value = 0;
  drawPoints.value = 0;
  pendingRings.value = rings;
  showAirForm.value = true;
}

function undoDrawPoint(): void {
  scene.value?.undoAirspacePoint();
}

function finishDrawAirspace(): void {
  scene.value?.finishAirspaceDraw();
}

function closeDrawRing(): void {
  scene.value?.closeAirspaceRing();
}

function cancelDraw(): void {
  scene.value?.cancelAirspaceDraw();
  drawingAirspace.value = false;
  drawRings.value = 0;
  drawPoints.value = 0;
  restoreModeAfterDraw();
}

function cancelAirForm(): void {
  showAirForm.value = false;
  pendingRings.value = [];
  restoreModeAfterDraw();
}

const routeMode = ref(false);
const routeFrom = ref<[number, number] | null>(null);
const routeTo = ref<[number, number] | null>(null);
const routeAlt = ref(100);
const routeResult = ref<PlanResult | null>(null);
const routePicking = ref<'from' | 'to' | null>(null);

const routeDistanceLabel = computed(() =>
  routeResult.value?.ok ? `${(routeResult.value.distance / 1000).toFixed(2)} km` : ''
);

const routeTimeLabel = computed(() => {
  if (!routeResult.value?.ok) return '';
  const minutes = routeResult.value.distance / 15 / 60;
  return minutes < 1 ? `${Math.round(minutes * 60)} 秒` : `${minutes.toFixed(1)} 分钟`;
});

function openRoutePlanner(): void {
  exitFpv(true);
  if (drawingAirspace.value) cancelDraw();
  followId.value = null;
  scene.value?.stopFollow();
  routeMode.value = true;
}

function closeRoutePlanner(): void {
  routeMode.value = false;
  routePicking.value = null;
  scene.value?.cancelPick();
  scene.value?.clearRoute();
  routeFrom.value = null;
  routeTo.value = null;
  routeResult.value = null;
}

function resetRoute(): void {
  routeFrom.value = null;
  routeTo.value = null;
  routeResult.value = null;
  scene.value?.clearRoute();
}

async function pickRoutePoint(kind: 'from' | 'to'): Promise<void> {
  const instance = scene.value;
  if (!instance) return;
  routePicking.value = kind;
  const point = await instance.pickPoint();
  routePicking.value = null;
  if (!point) return;
  if (kind === 'from') routeFrom.value = point;
  else routeTo.value = point;
  routeResult.value = null;
  instance.clearRouteLine();
  instance.setRouteMarkers(routeFrom.value, routeTo.value);
  if (routeFrom.value && routeTo.value) runRoutePlan();
}

function runRoutePlan(): void {
  if (!routeFrom.value || !routeTo.value) {
    showToast('先选起点和终点', 'info');
    return;
  }
  const result = planRoute({
    from: routeFrom.value,
    to: routeTo.value,
    alt: routeAlt.value,
    airspaces: airspaces.value
  });
  routeResult.value = result;
  if (result.ok) {
    scene.value?.showRoute(result.path, routeAlt.value);
    const extra = result.blockedBy.length ? `，绕开 ${result.blockedBy.length} 个限制区` : '';
    showToast(`路径已生成：${(result.distance / 1000).toFixed(2)} km${extra}`, 'success');
  } else {
    scene.value?.clearRouteLine();
    showToast(result.reason || '规划失败', 'warn');
  }
}

const importEl = ref<HTMLInputElement | null>(null);

function openAirspaceImport(): void {
  importEl.value?.click();
}

async function onAirspaceFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const { items, issues } = parseAirspacesGeoJSON(text);
    if (!items.length) {
      showToast(issues[0] ? `导入失败：${issues[0].reason}` : '文件里没有可用的面', 'warn');
      return;
    }
    const created = items.map((item) => addAirspace({ ...item, id: nextAirspaceId('IMP') }));
    sidebarOpen.value = true;
    sidebarTab.value = 'airspace';
    selectAirspace(created[0].id, false);
    showToast(
      `已导入 ${created.length} 个空域${issues.length ? `，跳过 ${issues.length} 个（${issues[0].reason}）` : ''}`,
      'success'
    );
  } catch (err) {
    showToast(`导入失败：${(err as Error).message}`, 'warn');
  }
}

function createDrawnAirspace(payload: {
  name: string;
  kind: AirspaceKind;
  minAlt: number;
  maxAlt: number;
}): void {
  const id = nextAirspaceId('AS');
  addAirspace({
    id,
    code: id,
    name: payload.name,
    kind: payload.kind,
    color: KIND_COLOR[payload.kind],
    minAlt: payload.minAlt,
    maxAlt: payload.maxAlt,
    polygons: pendingRings.value.map((ring) => ring.map(([lon, lat]) => [lon, lat])),
    description: '由操作员在地图上手绘划设。',
    authority: '本机绘制',
    status: '手动划设',
    source: 'drawn'
  });

  showAirForm.value = false;
  pendingRings.value = [];
  restoreModeAfterDraw();
  selectAirspace(id);
  showToast(`已新增「${payload.name}」`, 'success');
}

function selectDrone(id: string, focus = true): void {
  if (followId.value && followId.value !== id) {
    followId.value = null;
    scene.value?.stopFollow();
  }
  if (fpvId.value && fpvId.value !== id) exitFpv(true);
  const selection: Selection = { kind: 'drone', id };
  selected.value = selection;
  sidebarOpen.value = true;
  sidebarTab.value = 'targets';
  scene.value?.select(selection);
  if (focus) scene.value?.focus(selection);
}

function selectAirspace(id: string, focus = true): void {  const selection: Selection = { kind: 'airspace', id };
  selected.value = selection;
  sidebarOpen.value = true;
  sidebarTab.value = 'airspace';
  followId.value = null;
  scene.value?.stopFollow();
  scene.value?.select(selection);
  if (focus) scene.value?.focus(selection);
}

function closeDetail(): void {
  selected.value = null;
  followId.value = null;
  scene.value?.stopFollow();
  scene.value?.select(null);
}

function focusSelected(): void {
  if (!selected.value) return;
  scene.value?.focus(selected.value);
  showToast('已定位到选中对象', 'success');
}

function toggleFollow(): void {
  if (!selectedDrone.value) return;
  if (followId.value === selectedDrone.value.id) {
    scene.value?.stopFollow();
    followId.value = null;
    showToast('已取消跟随', 'info');
    return;
  }
  exitFpv(true);
  const ok = scene.value?.follow({ kind: 'drone', id: selectedDrone.value.id });
  if (ok) {
    followId.value = selectedDrone.value.id;
    showToast(`正在跟随 ${selectedDrone.value.callsign}`, 'success');
  }
}

function toggleFirstPerson(): void {
  if (!selectedDrone.value) return;
  if (fpvId.value === selectedDrone.value.id) {
    exitFpv();
    return;
  }
  const drone = selectedDrone.value;
  if (followId.value) {
    scene.value?.stopFollow();
    followId.value = null;
  }
  const ok = scene.value?.firstPerson({ kind: 'drone', id: drone.id });
  if (!ok) return;
  fpvId.value = drone.id;
  isPlaying.value = true;
  showToast(`已进入 ${drone.callsign} 第一视角`, 'success');
}

function exitFpv(silent = false): void {
  if (!fpvId.value) return;
  scene.value?.exitFirstPerson();
  fpvId.value = null;
  if (!silent) showToast('已退出第一视角', 'info');
}

function selectAlert(alert: AlertEvent): void {
  isPlaying.value = false;
  const middle = alert.start + Math.max(2, (alert.end - alert.start) * 0.35);
  setTime(Math.min(alert.end - 1, middle));
  selectDrone(alert.droneId, true);
  sidebarTab.value = 'alerts';
  showToast(`已定位 ${alert.droneCallsign} 的告警`, 'warn');
}

function openAlerts(): void {
  sidebarOpen.value = true;
  sidebarTab.value = 'alerts';
}

function togglePlay(): void {
  isPlaying.value = !isPlaying.value;
  if (isPlaying.value && currentTime >= SIM_DURATION - 0.2) setTime(0);
  showToast(isPlaying.value ? '模拟时钟继续运行' : '模拟时钟已暂停', 'info');
}

function toggleLayer(key: LayerKey): void {
  layerState[key] = !layerState[key];
  scene.value?.setLayerVisible(key, layerState[key]);
}

function setBasemap(style: BasemapStyle): void {
  basemap.value = style;
  scene.value?.setBasemap(style);
  const label = BASEMAP_OPTIONS.find((item) => item.id === style)?.label ?? style;
  showToast(`已切换底图：${label}`, 'success');
}

function toggleMode(): void {
  mode.value = mode.value === '3d' ? '2d' : '3d';
  followId.value = null;
  exitFpv(true);
  scene.value?.stopFollow();
  scene.value?.setMode(mode.value);
  showToast(mode.value === '3d' ? '已切换到三维态势' : '已切换到二维总览', 'info');
}

function zoom(direction: 1 | -1): void {
  scene.value?.zoomBy(direction === 1 ? 0.62 : 1.6);
}

function resetView(): void {
  followId.value = null;
  exitFpv(true);
  scene.value?.resetView();
  showToast('视角已复位', 'info');
}

function resetSimulation(): void {
  isPlaying.value = false;
  selected.value = null;
  followId.value = null;
  scene.value?.stopFollow();
  scene.value?.select(null);
  setTime(0);
  showToast('场景已回到起点', 'info');
}

function onTimeInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  isPlaying.value = false;
  setTime(value);
}

function setSpeed(value: number): void {
  speed.value = value;
}

function alertState(alert: AlertEvent): 'active' | 'upcoming' | 'ended' {
  if (simTime.value < alert.start) return 'upcoming';
  if (simTime.value > alert.end) return 'ended';
  return 'active';
}

function alertStateLabel(alert: AlertEvent): string {
  const state = alertState(alert);
  if (state === 'active') return '处置中';
  if (state === 'upcoming') return '待触发';
  return '已结束';
}

function alertTimeLabel(alert: AlertEvent): string {
  const state = alertState(alert);
  if (state === 'active') return `处置中 · ${formatClock(alert.start)}`;
  if (state === 'upcoming') return `待触发 · ${formatClock(alert.start)}`;
  return `已结束 · ${formatClock(alert.end)}`;
}

function doSearch(): void {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return;

  const drone = DRONES.find(
    (item) =>
      item.callsign.toLowerCase().includes(query) ||
      item.id.toLowerCase().includes(query) ||
      item.operator.includes(query)
  );
  if (drone) {
    selectDrone(drone.id);
    searchQuery.value = '';
    showToast(`已定位 ${drone.callsign}`, 'success');
    return;
  }

  const airspace = airspaces.value.find(
    (item) => item.name.includes(query) || item.code.toLowerCase().includes(query)
  );
  if (airspace) {
    selectAirspace(airspace.id);
    searchQuery.value = '';
    showToast(`已定位 ${airspace.name}`, 'success');
    return;
  }

  showToast('未找到匹配的目标或空域', 'warn');
}

function showToast(message: string, type: 'info' | 'success' | 'warn' = 'info'): void {
  toast.value = { message, type };
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = null), 2200);
}

function reloadPage(): void {
  window.location.reload();
}

async function toggleFullscreen(): Promise<void> {  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch {
    showToast('当前浏览器不支持全屏', 'warn');
  }
}

function onPointerMove(event: PointerEvent): void {
  if (parallaxFrame) return;
  parallaxFrame = requestAnimationFrame(() => {
    parallaxFrame = 0;
    const x = event.clientX / window.innerWidth - 0.5;
    const y = event.clientY / window.innerHeight - 0.5;
    particleEl.value?.style.setProperty('--px', `${(-x * 5).toFixed(2)}px`);
    particleEl.value?.style.setProperty('--py', `${(-y * 4).toFixed(2)}px`);
  });
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  if (drawingAirspace.value) {
    cancelDraw();
    return;
  }
  if (showAirForm.value) {
    cancelAirForm();
    return;
  }
  if (routeMode.value) {
    closeRoutePlanner();
    return;
  }
  if (fpvId.value) {
    exitFpv();
    return;
  }
  if (showDesignPanel.value) {
    showDesignPanel.value = false;
    return;
  }
  if (drawerOpen.value) drawerOpen.value = false;
}

onMounted(async () => {
  await nextTick();  if (!mapEl.value) return;

  try {
    const instance = new LowAltitudeScene(mapEl.value, {
      onSelect: handleSelect,
      onCameraChange: (info) => (cameraInfo.value = info),
      onDrawChange: handleDrawChange,
      onDrawFinish: handleDrawFinish,
      onContextLost: () => {
        loading.value = false;
        error.value =
          '浏览器回收了 WebGL 渲染上下文（长时间挂起、休眠或显卡驱动重置后常见），画面会变空白，刷新即可恢复。';
      }
    });
    scene.value = instance;
    await instance.init();
    const initialBasemap: BasemapStyle = resolvedTheme.value === 'light' ? 'light' : 'dark';
    basemap.value = initialBasemap;
    instance.setBasemap(initialBasemap);
    setTime(INITIAL_TIME);
    startLoop();
    loading.value = false;
    // 建筑体块异步加载，失败不影响主场景
    instance
      .loadBuildings()
      .then((count) => {
        if (count > 0) showToast(`已加载 ${count} 栋建筑体块`, 'info');
      })
      .catch(() => undefined);
  } catch (err) {
    console.error(err);
    error.value = err instanceof Error ? err.message : '三维场景初始化失败';
    loading.value = false;
  }

  if (window.matchMedia('(pointer: fine)').matches) {
    window.addEventListener('pointermove', onPointerMove, { passive: true });
  }
  window.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  if (parallaxFrame) cancelAnimationFrame(parallaxFrame);
  if (toastTimer) window.clearTimeout(toastTimer);
  if (glitchTimer) window.clearTimeout(glitchTimer);
  if (glitchHold) window.clearTimeout(glitchHold);
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('keydown', onKeydown);
  scene.value?.destroy();
});
</script>

<template>
  <div
    class="app"
    :class="{ 'has-detail': !!selected, 'drawer-open': drawerOpen, 'panel-closed': !sidebarOpen }"
  >
    <div ref="mapEl" class="map"></div>
    <canvas ref="particleEl" class="particles" aria-hidden="true"></canvas>

    <header class="top">
      <form class="search" @submit.prevent="doSearch">
        <Icon name="search" :size="17" />
        <input v-model="searchQuery" placeholder="搜索目标、空域或呼号" aria-label="搜索目标或空域" />
        <button class="search-go" type="submit" aria-label="定位">
          <span class="glyph search-glyph" :style="maskStyle(targetIcon)"></span>
        </button>
      </form>

      <div class="brand">
        <span class="brand-mark"><EqMark :size="26" /></span>
        <span class="brand-text">
          <strong>低空天穹</strong>
          <em>南山低空运行态势</em>
        </span>
      </div>

      <div class="top-right">
        <Transition name="alert-pill">
          <button
            v-if="activeAlertCount > 0"
            class="alert-pill"
            :class="{ glitch }"
            type="button"
            @click="openAlerts"
          >
            <Icon name="alert" :size="13" />
            {{ activeAlertCount }} 条告警
          </button>
        </Transition>

        <div class="theme" role="group" aria-label="主题">
          <button
            type="button"
            :class="{ active: themeMode === 'light' }"
            title="浅色主题"
            @click="setThemeMode('light')"
          >
            <Icon name="sun" :size="14" />
          </button>
          <button
            type="button"
            :class="{ active: themeMode === 'dark' }"
            title="深色主题"
            @click="setThemeMode('dark')"
          >
            <Icon name="moon" :size="14" />
          </button>
          <button
            type="button"
            :class="{ active: themeMode === 'system' }"
            title="跟随系统"
            @click="setThemeMode('system')"
          >
            <Icon name="monitor" :size="14" />
          </button>
        </div>

        <div class="clock">
          <strong>{{ clock }}</strong>
          <span>{{ dateLabel }}</span>
        </div>

        <button
          class="icon-btn"
          type="button"
          :class="{ active: sidebarOpen }"
          :title="sidebarOpen ? '收起侧栏' : '展开侧栏'"
          @click="sidebarOpen = !sidebarOpen"
        >
          <Icon name="layout" :size="16" />
        </button>
      </div>
    </header>

    <aside class="panel" :class="{ collapsed: !sidebarOpen }">
      <header class="panel-head">
        <div>
          <h1 class="panel-title">空域态势</h1>
          <p class="panel-sub">南山 · 实时模拟</p>
        </div>
        <span class="live"><i></i>运行中</span>
      </header>

      <div class="tabs" :style="tabStyle" role="tablist">
        <span class="tab-glider" aria-hidden="true"></span>
        <button
          type="button"
          role="tab"
          :aria-selected="sidebarTab === 'airspace'"
          :class="{ active: sidebarTab === 'airspace' }"
          @click="sidebarTab = 'airspace'"
        >
          空域 <em>{{ airspaces.length }}</em>
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="sidebarTab === 'targets'"
          :class="{ active: sidebarTab === 'targets' }"
          @click="sidebarTab = 'targets'"
        >
          目标 <em>{{ DRONES.length }}</em>
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="sidebarTab === 'alerts'"
          :class="{ active: sidebarTab === 'alerts' }"
          @click="sidebarTab = 'alerts'"
        >
          告警 <em :class="{ danger: activeAlertCount > 0 }">{{ activeAlertCount }}</em>
        </button>
      </div>

      <div class="panel-body" :key="sidebarTab">
        <template v-if="sidebarTab === 'airspace'">
          <div class="draw-actions">
            <button type="button" class="draw-entry" @click="startDrawAirspace">
              <span class="draw-entry-icon"><Icon name="plus" :size="14" /></span>
              <span class="draw-entry-copy">
                <strong>手绘新增</strong>
                <small>二维勾画轮廓</small>
              </span>
            </button>
            <button type="button" class="draw-entry" @click="openAirspaceImport">
              <span class="draw-entry-icon"><Icon name="upload" :size="14" /></span>
              <span class="draw-entry-copy">
                <strong>导入 GeoJSON</strong>
                <small>读轮廓与高度</small>
              </span>
            </button>
          </div>
          <button type="button" class="route-entry" @click="openRoutePlanner">
            <span class="draw-entry-icon"><Icon name="routePlan" :size="14" /></span>
            <span class="draw-entry-copy">
              <strong>最短路径规划</strong>
              <small>二维 A*，按高度绕开禁飞与限制区</small>
            </span>
          </button>
          <input
            ref="importEl"
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            class="visually-hidden-file"
            @change="onAirspaceFile"
          />

          <button
            v-for="(airspace, index) in airspaces"
            :key="airspace.id"
            type="button"
            class="air-row"
            :class="{ active: selected?.kind === 'airspace' && selected.id === airspace.id }"
            :style="{ animationDelay: `${index * 34}ms`, '--row': airspace.color }"
            @click="selectAirspace(airspace.id)"
          >
            <span class="air-chip" :style="{ background: airspace.color }"></span>
            <span class="air-copy">
              <strong>{{ airspace.name }}</strong>
              <small>{{ AIRSPACE_META[airspace.kind].label }} · {{ airspace.minAlt }}–{{ airspace.maxAlt }} m</small>
            </span>
            <span class="air-state" :class="{ danger: airspace.kind === 'no-fly' }">{{ airspace.status }}</span>
          </button>

        </template>

        <template v-else-if="sidebarTab === 'targets'">
          <button
            v-for="(row, index) in targetRows"
            :key="row.drone.id"
            type="button"
            class="target-row"
            :class="{
              active: selected?.kind === 'drone' && selected.id === row.drone.id,
              alert: !!row.alert
            }"
            :style="{ animationDelay: `${index * 28}ms` }"
            @click="selectDrone(row.drone.id)"
          >
            <span class="t-dot" :style="{ background: row.drone.color }"></span>
            <span class="t-copy">
              <strong>{{ row.drone.callsign }}</strong>
              <small>{{ DRONE_KIND_META[row.drone.kind].label }} · {{ row.drone.operator }}</small>
            </span>
            <span class="t-metrics">
              <b>{{ Math.round(row.pos.alt) }}<i>m</i></b>
              <small>{{ Math.round(row.pos.heading) }}°</small>
            </span>
            <span class="t-state" :class="{ danger: !!row.alert }">{{ row.alert ? '告警' : '正常' }}</span>
          </button>
        </template>

        <template v-else>
          <button
            v-for="(alert, index) in alertListAll"
            :key="alert.id"
            type="button"
            class="alert-row"
            :class="[alert.level, alertState(alert)]"
            :style="{ animationDelay: `${index * 32}ms` }"
            @click="selectAlert(alert)"
          >
            <span class="a-icon"><Icon name="alert" :size="14" /></span>
            <span class="a-copy">
              <strong>{{ alert.title }}</strong>
              <small>{{ alert.droneCallsign }} · {{ alert.airspaceName }}</small>
              <em>{{ alertTimeLabel(alert) }}</em>
            </span>
            <span class="a-state" :class="alertState(alert)">{{ alertStateLabel(alert) }}</span>
          </button>
        </template>
      </div>

      <footer class="panel-foot">
        <div class="legend">
          <span><i style="background: #4f7df3"></i>管制</span>
          <span><i style="background: #2bb6a8"></i>适飞</span>
          <span><i style="background: #e5484d"></i>禁飞</span>
          <span><i style="background: #e49a2f"></i>限制</span>
        </div>
      </footer>
    </aside>

    <nav class="rail" aria-label="图层与图面">
      <button
        v-for="layer in railLayers"
        :key="layer.key"
        type="button"
        class="rail-item"
        :class="{ on: layerState[layer.key] }"
        :aria-pressed="layerState[layer.key]"
        :title="`${layer.label}${layerState[layer.key] ? '：已开启' : '：已关闭，点击恢复'}`"
        @click="toggleLayer(layer.key)"
      >
        <span class="rail-label">{{ layer.label }}</span>
        <span class="bead" :style="{ color: layer.color }">
          <i class="bead-face"></i>
          <span v-if="layer.mask" class="glyph" :style="maskStyle(layer.mask, layer.size)"></span>
          <Icon v-else :name="layer.icon" :size="layer.size" />
        </span>
      </button>

      <span class="rail-sep" aria-hidden="true"></span>

      <button
        type="button"
        class="rail-item rail-action"
        :class="{ on: drawerOpen }"
        @click="drawerOpen = !drawerOpen"
      >
        <span class="rail-label">底图</span>
        <span class="bead" :style="{ color: '#5C7FA8' }">
          <i class="bead-face"></i>
          <Icon name="map" :size="17" />
        </span>
      </button>

      <button type="button" class="rail-item rail-action" @click="showDesignPanel = true">
        <span class="rail-label">设计规范</span>
        <span class="bead" :style="{ color: '#C08A2E' }">
          <i class="bead-face"></i>
          <Icon name="palette" :size="17" />
        </span>
      </button>
    </nav>

    <div v-if="drawerOpen" class="drawer-scrim" @click="drawerOpen = false"></div>

    <Transition name="drawer">
      <aside v-if="drawerOpen" class="drawer">
        <header class="drawer-head">
          <div>
            <strong>底图与图面</strong>
            <small>BASEMAP · 3 套方案</small>
          </div>
          <button class="icon-btn" type="button" title="关闭" @click="drawerOpen = false">
            <Icon name="x" :size="16" />
          </button>
        </header>

        <div class="drawer-body">
          <button
            v-for="(item, index) in BASEMAP_OPTIONS"
            :key="item.id"
            type="button"
            class="base-card"
            :class="{ active: basemap === item.id }"
            :style="{ animationDelay: `${60 + index * 45}ms` }"
            @click="setBasemap(item.id)"
          >
            <span class="base-swatch" :class="item.swatch"></span>
            <span class="base-copy">
              <strong>{{ item.label }}</strong>
              <small>{{ item.desc }}</small>
            </span>
            <span class="base-check"><Icon name="check" :size="13" /></span>
          </button>

          <p v-if="!TIANDITU_READY" class="drawer-note">
            未配置天地图 key，当前使用 Esri。在根目录 <code>.env.local</code> 填
            <code>VITE_TIANDITU_KEY</code> 后重启。
          </p>

          <div class="drawer-divider"></div>

          <button
            type="button"
            class="design-entry"
            @click="showDesignPanel = true; drawerOpen = false"
          >
            <Icon name="palette" :size="16" />
            <span>
              <strong>底图设计规范</strong>
              <small>色板 · 图层栈 · Maputnik 接入</small>
            </span>
            <Icon name="chevron" :size="14" />
          </button>
        </div>
      </aside>
    </Transition>

    <Transition name="card">
      <aside
        v-if="selected"
        class="detail"
        :style="{ '--accent-detail': selectedDrone?.color ?? selectedAirspace?.color ?? '#F5A524' }"
      >
        <div class="detail-head">
          <span>{{ selectedDrone ? '无人机详情' : '空域详情' }}</span>
          <button type="button" class="icon-btn tiny" title="关闭" @click="closeDetail">
            <Icon name="x" :size="14" />
          </button>
        </div>

        <div class="detail-body">
          <template v-if="selectedDrone">
            <div class="hero">
              <span class="hero-avatar"><Icon name="drone" :size="19" /></span>
              <span class="hero-copy">
                <b class="hero-title">{{ selectedDrone.callsign }}</b>
                <small class="hero-sub">{{ selectedDrone.model }} · {{ selectedDrone.operator }}</small>
              </span>
              <span class="badge" :class="{ danger: !!selectedDroneAlert }">
                {{ selectedDroneAlert ? '告警' : '正常' }}
              </span>
            </div>

            <div class="metrics">
              <div class="metric">
                <span>当前高度</span>
                <strong>{{ selectedDronePos ? Math.round(selectedDronePos.alt) : '--' }}<em>m</em></strong>
              </div>
              <div class="metric">
                <span>地速</span>
                <strong>{{ selectedDrone.speed }}<em>m/s</em></strong>
              </div>
              <div class="metric">
                <span>航向</span>
                <strong>{{ selectedDronePos ? Math.round(selectedDronePos.heading) : '--' }}<em>°</em></strong>
              </div>
              <div class="metric">
                <span>任务进度</span>
                <strong>{{ selectedDronePos ? Math.round(selectedDronePos.progress * 100) : '--' }}<em>%</em></strong>
              </div>
            </div>

            <div class="bar">
              <i :style="{ width: selectedDronePos ? `${selectedDronePos.progress * 100}%` : '0%' }"></i>
            </div>

            <div class="rows">
              <div class="row">
                <span>执行计划</span>
                <strong>{{ selectedDrone.plan }}</strong>
              </div>
              <div class="row">
                <span>任务类型</span>
                <strong>{{ DRONE_KIND_META[selectedDrone.kind].label }}</strong>
              </div>
            </div>

            <div class="actions">
              <button type="button" @click="focusSelected">
                <Icon name="locate" :size="14" />定位
              </button>
              <button
                type="button"
                :class="{ active: followId === selectedDrone.id }"
                @click="toggleFollow"
              >
                <Icon name="follow" :size="14" />{{ followId === selectedDrone.id ? '取消跟随' : '跟随' }}
              </button>
              <button
                type="button"
                class="fpv-enter"
                :class="{ active: fpvId === selectedDrone.id }"
                @click="toggleFirstPerson"
              >
                <Icon name="eye" :size="14" />{{ fpvId === selectedDrone.id ? '退出视角' : '第一视角' }}
              </button>
            </div>

            <div v-if="selectedDroneAlert" class="inline-alert">
              <Icon name="alert" :size="14" />
              <span>{{ selectedDroneAlert.message }}</span>
            </div>
          </template>

          <template v-else-if="selectedAirspace">
            <div class="hero">
              <span class="hero-avatar"><Icon name="layers" :size="19" /></span>
              <span class="hero-copy">
                <b class="hero-title">{{ selectedAirspace.name }}</b>
                <small class="hero-sub">{{ selectedAirspace.code }} · {{ selectedAirspace.authority }}</small>
              </span>
              <span class="badge">{{ selectedAirspace.status }}</span>
            </div>

            <div class="metrics">
              <div class="metric">
                <span>空域类型</span>
                <strong class="text">{{ selectedAirspaceMeta?.label }}</strong>
              </div>
              <div class="metric">
                <span>高度范围</span>
                <strong>{{ selectedAirspace.minAlt }}–{{ selectedAirspace.maxAlt }}<em>m</em></strong>
              </div>
            </div>

            <p class="desc">{{ selectedAirspace.description }}</p>

            <div class="rows">
              <div class="row">
                <span>管理单位</span>
                <strong>{{ selectedAirspace.authority }}</strong>
              </div>
              <div class="row">
                <span>运行状态</span>
                <strong>{{ selectedAirspace.status }}</strong>
              </div>
              <div class="row">
                <span>轮廓</span>
                <strong>{{ selectedAirspace.polygons.length }} 块 · {{ selectedAirspace.polygons.reduce((n, r) => n + r.length, 0) }} 顶点</strong>
              </div>
            </div>

            <div class="actions">
              <button type="button" @click="focusSelected">
                <Icon name="locate" :size="14" />定位空域
              </button>
              <button
                v-if="selectedAirspace.source && selectedAirspace.source !== 'builtin'"
                type="button"
                class="danger"
                @click="deleteSelectedAirspace"
              >
                <Icon name="x" :size="14" />删除空域
              </button>
            </div>

          </template>
        </div>
      </aside>
    </Transition>

    <Transition name="hud">
      <div v-if="fpvPos && fpvDrone" class="fpv">
        <div class="fpv-reticle" aria-hidden="true">
          <svg viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="27" />
            <path d="M60 4v20M60 96v20M4 60h20M96 60h20" />
          </svg>
        </div>
        <div class="fpv-bar">
          <span class="fpv-tag"><i></i>第一视角</span>
          <strong class="fpv-call">{{ fpvDrone.callsign }}</strong>
          <span class="fpv-metrics">
            <span>高度 <b>{{ Math.round(fpvPos.alt) }}</b><em>m</em></span>
            <span>速度 <b>{{ fpvDrone.speed }}</b><em>m/s</em></span>
            <span>航向 <b>{{ Math.round(fpvPos.heading) }}</b><em>°</em></span>
          </span>
          <button type="button" class="fpv-exit" @click="exitFpv()">
            <Icon name="x" :size="12" />退出 <kbd>Esc</kbd>
          </button>
        </div>
      </div>
    </Transition>

    <Transition name="hud">
      <div v-if="drawingAirspace" class="draw-bar">
        <span class="draw-tag"><i></i>绘制空域</span>
        <div
          ref="drawModesEl"
          class="draw-modes"
          :class="{ dragging: drawDragging }"
          role="group"
          aria-label="绘制方式"
          :style="{ '--draw-index': drawModeIndex, '--draw-x': `${drawDragX}px` }"
          @pointerdown="startDrawModeDrag"
          @pointermove="moveDrawModeDrag"
          @pointerup="endDrawModeDrag"
          @pointercancel="endDrawModeDrag"
        >
          <span class="draw-modes-glider" aria-hidden="true"></span>
          <span class="draw-modes-text" aria-hidden="true">
            <i v-for="option in drawModeOptions" :key="'l-' + option.value">{{ option.label }}</i>
          </span>
          <span class="draw-modes-text ink" aria-hidden="true">
            <i v-for="option in drawModeOptions" :key="'i-' + option.value">{{ option.label }}</i>
          </span>
          <button
            v-for="option in drawModeOptions"
            :key="option.value"
            type="button"
            :class="{ active: drawMode === option.value }"
            @click="chooseDrawMode(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
        <button
          type="button"
          class="draw-pan"
          :class="{ active: drawPan }"
          :title="drawPan ? '退出平移' : '平移地图'"
          @click="toggleDrawPan"
        >
          <Icon name="move" :size="13" />平移
        </button>
        <span class="draw-hint">{{ drawHint }}</span>
        <span class="draw-count">已画 <b>{{ drawRings }}</b> 块</span>
        <button type="button" :disabled="drawPoints === 0" @click="undoDrawPoint">撤销</button>
        <button
          type="button"
          :disabled="drawMode !== 'polygon' || drawPoints < 3"
          :title="drawMode === 'polygon' ? '闭合当前这一块' : '矩形与圆形按点自动闭合'"
          @click="closeDrawRing"
        >
          闭合
        </button>
        <button
          type="button"
          class="primary"
          :disabled="drawRings === 0 && drawPoints < 3"
          @click="finishDrawAirspace"
        >
          完成
        </button>
        <button type="button" @click="cancelDraw">取消</button>
      </div>
    </Transition>

    <Transition name="hud">
      <div v-if="routeMode" class="draw-bar route-bar">
        <span class="draw-tag"><i></i>路径规划</span>
        <button
          type="button"
          class="route-pick"
          :class="{ active: routePicking === 'from', set: !!routeFrom }"
          @click="pickRoutePoint('from')"
        >
          <i class="route-dot from"></i>{{ routePicking === 'from' ? '点击地图…' : routeFrom ? '重选起点' : '选起点' }}
        </button>
        <button
          type="button"
          class="route-pick"
          :class="{ active: routePicking === 'to', set: !!routeTo }"
          @click="pickRoutePoint('to')"
        >
          <i class="route-dot to"></i>{{ routePicking === 'to' ? '点击地图…' : routeTo ? '重选终点' : '选终点' }}
        </button>
        <label class="route-alt">
          高度
          <input v-model.number="routeAlt" type="number" min="0" max="300" step="10" />
          <span>m</span>
        </label>
        <button type="button" class="primary" :disabled="!routeFrom || !routeTo" @click="runRoutePlan">
          规划
        </button>
        <span v-if="routeResult?.ok" class="route-summary">
          {{ routeDistanceLabel }} · 约 {{ routeTimeLabel }}<template v-if="routeResult.blockedBy.length"> · 绕开 {{ routeResult.blockedBy.length }} 个限制区</template>
        </span>
        <span v-else-if="routeResult" class="route-summary warn">{{ routeResult.reason }}</span>
        <button type="button" @click="resetRoute">清除</button>
        <button type="button" @click="closeRoutePlanner">关闭</button>
      </div>
    </Transition>

    <div class="controls">
      <div class="cluster">
        <button type="button" title="缩小" @click="zoom(-1)"><Icon name="minus" :size="15" /></button>
        <button type="button" title="放大" @click="zoom(1)"><Icon name="plus" :size="15" /></button>
        <span class="sep" aria-hidden="true"></span>
        <button type="button" class="mode-btn" :class="{ active: mode === '3d' }" @click="toggleMode">
          {{ mode === '3d' ? '3D' : '2D' }}
        </button>
        <button type="button" title="复位视角" @click="resetView">
          <Icon name="rotate" :size="15" />
        </button>
        <button type="button" title="全屏" @click="toggleFullscreen">
          <Icon name="maximize" :size="15" />
        </button>
      </div>

      <div class="basemaps">
        <button
          v-for="item in BASEMAP_OPTIONS"
          :key="item.id"
          type="button"
          class="bm-pill"
          :class="{ active: basemap === item.id }"
          @click="setBasemap(item.id)"
        >
          {{ item.short }}
        </button>
      </div>

      <div class="readout">
        <Icon name="target" :size="12" />
        <span>{{ cameraLabel }}</span>
      </div>

      <p class="credit">{{ basemapCredit }}</p>
    </div>

    <footer class="dock">
      <button class="play" type="button" :aria-label="isPlaying ? '暂停' : '播放'" @click="togglePlay">
        <Icon :name="isPlaying ? 'pause' : 'play'" :size="15" />
      </button>

      <div class="now">
        <strong>{{ clock }}</strong>
        <small>{{ isPlaying ? '运行中' : '已暂停' }}</small>
      </div>

      <div class="timeline">
        <div class="bands" aria-hidden="true">
          <i
            v-for="band in alertBands"
            :key="band.id"
            class="band"
            :class="band.level"
            :style="{ left: band.left, width: band.width }"
          ></i>
        </div>
        <input
          class="range"
          type="range"
          min="0"
          :max="SIM_DURATION"
          step="0.1"
          :value="simTime"
          aria-label="场景时间轴"
          @input="onTimeInput"
        />
        <div class="ticks">
          <span v-for="tick in ticks" :key="tick">{{ formatDuration(tick) }}</span>
        </div>
      </div>

      <div class="speed">
        <button
          v-for="value in speedOptions"
          :key="value"
          type="button"
          :class="{ active: speed === value }"
          @click="setSpeed(value)"
        >
          {{ value }}×
        </button>
      </div>

      <button class="icon-btn ghost" type="button" title="回到起点" @click="resetSimulation">
        <Icon name="clock" :size="15" />
      </button>
    </footer>

    <Transition name="toast">
      <div v-if="toast" class="toast" :class="toast.type">
        <Icon :name="toast.type === 'warn' ? 'alert' : 'shield'" :size="14" />
        <span>{{ toast.message }}</span>
      </div>
    </Transition>

    <Transition name="drawer">
      <div v-if="showAirForm" class="design-overlay" @click.self="cancelAirForm">
        <AirspaceForm :rings="pendingRings" @submit="createDrawnAirspace" @cancel="cancelAirForm" />
      </div>
    </Transition>

    <Transition name="drawer">
      <div v-if="showDesignPanel" class="design-overlay" @click.self="showDesignPanel = false">
        <section class="design-sheet">
          <header class="design-head">
            <div>
              <h2>底图设计规范</h2>
              <p>Maputnik · TileServer GL · Cesium</p>
            </div>
            <button type="button" class="icon-btn" title="关闭" @click="showDesignPanel = false">
              <Icon name="x" :size="17" />
            </button>
          </header>

          <div class="design-preview" :class="basemap">
            <div class="design-preview-grid"></div>
            <div class="design-preview-copy">
              <span>当前底图</span>
              <strong>{{ currentBasemapLabel }}</strong>
              <small>低饱和底图 · 高对比业务层</small>
            </div>
          </div>

          <div class="design-section">
            <div class="design-section-head">
              <span>色彩系统</span>
              <small>COLOR TOKENS</small>
            </div>
            <div class="palette-grid">
              <div v-for="color in designPalette" :key="color.value" class="palette-item">
                <i :style="{ background: color.value }"></i>
                <span>{{ color.name }}</span>
                <code>{{ color.value }}</code>
              </div>
            </div>
          </div>

          <div class="design-section">
            <div class="design-section-head">
              <span>图层层级</span>
              <small>LAYER STACK</small>
            </div>
            <div class="layer-stack">
              <span v-for="(layer, index) in designLayers" :key="layer">
                <em>{{ String(index + 1).padStart(2, '0') }}</em>{{ layer }}
              </span>
            </div>
          </div>

          <div class="design-note">
            <Icon name="palette" :size="17" />
            <p>
              当前使用 Esri 底图 + Cesium 色彩调校。后续接入 Maputnik 编辑
              <code>style.json</code>，经 TileServer GL 栅格化后供 Cesium 加载。
            </p>
          </div>

          <div class="design-note">
            <Icon name="cube" :size="17" />
            <p>三维建筑预留 3D Tiles 接入位：白模 / 倾斜摄影 + <code>Cesium3DTileset</code>，用于重点区域。</p>
          </div>

          <div class="design-actions">
            <button type="button" @click="setBasemap('dark'); showDesignPanel = false">应用暗色地图</button>
            <button type="button" @click="setBasemap('light'); showDesignPanel = false">应用浅色地图</button>
          </div>
        </section>
      </div>
    </Transition>

    <div v-if="loading" class="loading">
      <div class="loading-mark"><Icon name="radar" :size="24" /></div>
      <strong>正在构建低空态势</strong>
      <div class="loading-line"><i></i></div>
      <small>CESIUM · AIRSPACE · TELEMETRY</small>
    </div>

    <div v-if="error" class="error-screen">
      <Icon name="alert" :size="26" />
      <strong>场景初始化失败</strong>
      <p>{{ error }}</p>
      <small>请检查浏览器 WebGL 支持和网络连接后刷新页面。</small>
      <button class="error-action" type="button" @click="reloadPage">重新加载</button>
    </div>
  </div>
</template>
