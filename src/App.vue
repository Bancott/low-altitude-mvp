<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import Icon from './components/Icon.vue';
import { useTheme } from './composables/useTheme';
import {
  LowAltitudeScene,
  type BasemapStyle,
  type CameraInfo,
  type LayerKey,
  type Selection,
  type ViewPreset
} from './cesium/LowAltitudeScene';
import {
  AIRSPACES,
  AIRSPACE_META,
  ALERT_EVENTS,
  DRONES,
  DRONE_KIND_META,
  SIM_DURATION,
  type AlertEvent,
  formatClock,
  formatDate,
  formatDuration,
  positionAt
} from './data/scenario';

const mapEl = ref<HTMLElement | null>(null);
const scene = ref<LowAltitudeScene | null>(null);
const loading = ref(true);
const error = ref('');
const isPlaying = ref(true);
const speed = ref(2);
const simTime = ref(0);
const selected = ref<Selection>(null);
const followId = ref<string | null>(null);
const basemap = ref<BasemapStyle>('dark');
const basemapOpen = ref(false);
const showDesignPanel = ref(false);
const viewPreset = ref<ViewPreset>('district');
const rightTab = ref<'detail' | 'targets' | 'alerts'>('detail');
const scenarioMode = ref<'daily' | 'emergency'>('daily');
const panelsVisible = ref(true);
const mode = ref<'3d' | '2d'>('3d');
const searchQuery = ref('');
const toast = ref<{ message: string; type: 'info' | 'success' | 'warn' } | null>(null);
const cameraInfo = ref<CameraInfo>({ lon: 113.935, lat: 22.525, height: 8600, heading: 0 });

const { mode: themeMode, resolvedTheme, setMode: setThemeMode } = useTheme();

const layerState = reactive<Record<LayerKey, boolean>>({
  airspace: true,
  routes: true,
  drones: true,
  trails: true,
  alerts: true
});

const layerList: Array<{ key: LayerKey; label: string; icon: string; meta: string; count: string }> = [
  { key: 'airspace', label: '空域结构', icon: 'layers', meta: '4 个空域体', count: '04' },
  { key: 'routes', label: '计划航线', icon: 'route', meta: '10 条任务航线', count: '10' },
  { key: 'drones', label: '实时目标', icon: 'drone', meta: '1 Hz 模拟遥测', count: '10' },
  { key: 'trails', label: '飞行尾迹', icon: 'signal', meta: '最近 56 秒', count: '20s' },
  { key: 'alerts', label: '告警标记', icon: 'alert', meta: '空间规则引擎', count: String(ALERT_EVENTS.length).padStart(2, '0') }
];

const basemapOptions: Array<{
  id: BasemapStyle;
  label: string;
  desc: string;
  swatch: string;
}> = [
  { id: 'dark', label: '暗色指挥', desc: '低饱和 · 适合态势大屏', swatch: 'dark' },
  { id: 'light', label: '浅色政务', desc: '道路清晰 · 适合汇报截图', swatch: 'light' },
  { id: 'satellite', label: '卫星影像', desc: '真实纹理 · 辅助研判', swatch: 'satellite' }
];

const speedOptions = [1, 2, 4];
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
const firstCritical = ALERT_EVENTS.find((event) => event.level === 'critical') ?? ALERT_EVENTS[0];
const INITIAL_TIME = Math.min(SIM_DURATION - 2, Math.max(0, (firstCritical?.start ?? 0) + 4));

let currentTime = INITIAL_TIME;
let raf = 0;
let lastFrame = 0;
let lastUi = 0;
let dirty = true;
let toastTimer: number | undefined;

simTime.value = INITIAL_TIME;

const activeAlerts = computed(() =>
  ALERT_EVENTS.filter((event) => simTime.value >= event.start && simTime.value <= event.end)
);

const selectedDrone = computed(() => {
  if (selected.value?.kind !== 'drone') return null;
  return DRONES.find((drone) => drone.id === selected.value?.id) ?? null;
});

const selectedAirspace = computed(() => {
  if (selected.value?.kind !== 'airspace') return null;
  return AIRSPACES.find((airspace) => airspace.id === selected.value?.id) ?? null;
});

const selectedDronePos = computed(() =>
  selectedDrone.value ? positionAt(selectedDrone.value, simTime.value) : null
);

const selectedDroneAlert = computed(() =>
  selectedDrone.value
    ? activeAlerts.value.find((alert) => alert.droneId === selectedDrone.value?.id) ?? null
    : null
);

const selectedAirspaceMeta = computed(() =>
  selectedAirspace.value ? AIRSPACE_META[selectedAirspace.value.kind] : null
);

const clock = computed(() => formatClock(simTime.value));
const dateLabel = formatDate(0);
const durationLabel = formatDuration(SIM_DURATION);
const activeAlertCount = computed(() => activeAlerts.value.length);
const utilization = computed(() => `${Math.round((DRONES.length / 15) * 100)}%`);

const cameraLabel = computed(() => {
  const info = cameraInfo.value;
  const height = info.height >= 1000 ? `${(info.height / 1000).toFixed(1)} km` : `${Math.round(info.height)} m`;
  return `${info.lat.toFixed(3)}°N  ${info.lon.toFixed(3)}°E  ·  ${height}`;
});

const basemapCredit = computed(() =>
  basemap.value === 'satellite'
    ? '© Esri · Maxar · Earthstar Geographics'
    : '© Esri · HERE · Garmin · OpenStreetMap contributors'
);

const currentBasemapLabel = computed(
  () => basemapOptions.find((item) => item.id === basemap.value)?.label ?? ''
);

const alertListAll = computed(() =>
  [...ALERT_EVENTS].sort((a, b) => {
    const rank = { active: 0, upcoming: 1, ended: 2 } as const;
    const levelRank = { critical: 0, warning: 1 } as const;
    return (
      rank[alertState(a)] - rank[alertState(b)] ||
      levelRank[a.level] - levelRank[b.level] ||
      a.start - b.start
    );
  })
);

const alertList = computed(() => alertListAll.value.slice(0, 3));

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

const legendItems = (Object.keys(AIRSPACE_META) as Array<keyof typeof AIRSPACE_META>).map((key) => ({
  label: AIRSPACE_META[key].label,
  color:
    key === 'control'
      ? '#4F7DF3'
      : key === 'advisory'
        ? '#2BB6A8'
        : key === 'no-fly'
          ? '#E5484D'
          : '#E49A2F'
}));

watch(resolvedTheme, (theme) => {
  if (!scene.value) return;
  const next: BasemapStyle = theme === 'light' ? 'light' : 'dark';
  basemap.value = next;
  scene.value.setBasemap(next);
});

function alertsAt(time: number): AlertEvent[] {
  return ALERT_EVENTS.filter((event) => time >= event.start && time <= event.end);
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
  if (selection) rightTab.value = 'detail';
  if (followId.value && (selection?.kind !== 'drone' || selection.id !== followId.value)) {
    followId.value = null;
    scene.value?.stopFollow();
  }
}

function selectDrone(id: string, focus = true): void {
  if (followId.value && followId.value !== id) {
    followId.value = null;
    scene.value?.stopFollow();
  }
  const selection: Selection = { kind: 'drone', id };
  selected.value = selection;
  rightTab.value = 'detail';
  scene.value?.select(selection);
  if (focus) scene.value?.focus(selection);
}

function selectAirspace(id: string, focus = true): void {
  const selection: Selection = { kind: 'airspace', id };
  selected.value = selection;
  rightTab.value = 'detail';
  followId.value = null;
  scene.value?.stopFollow();
  scene.value?.select(selection);
  if (focus) scene.value?.focus(selection);
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
  const ok = scene.value?.follow({ kind: 'drone', id: selectedDrone.value.id });
  if (ok) {
    followId.value = selectedDrone.value.id;
    showToast(`正在跟随 ${selectedDrone.value.callsign}`, 'success');
  }
}

function selectAlert(alert: AlertEvent): void {
  isPlaying.value = false;
  const middle = alert.start + Math.max(2, (alert.end - alert.start) * 0.35);
  setTime(Math.min(alert.end - 1, middle));
  selectDrone(alert.droneId, true);
  rightTab.value = 'detail';
  showToast(`已定位 ${alert.droneCallsign} 的告警`, 'warn');
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
  basemapOpen.value = false;
  scene.value?.setBasemap(style);
  const label = basemapOptions.find((item) => item.id === style)?.label ?? style;
  showToast(`已切换底图：${label}`, 'success');
}

function setViewPreset(preset: ViewPreset): void {
  viewPreset.value = preset;
  followId.value = null;
  scene.value?.stopFollow();
  scene.value?.setViewPreset(preset);
  const label = preset === 'city' ? '深圳全市' : preset === 'focus' ? '重点区域' : '南山片区';
  showToast(`视角已切换到：${label}`, 'info');
}

function setScenario(mode: 'daily' | 'emergency'): void {
  scenarioMode.value = mode;
  if (mode === 'emergency') {
    const alert = ALERT_EVENTS.find((event) => event.level === 'critical') ?? ALERT_EVENTS[0];
    if (alert) {
      isPlaying.value = false;
      const middle = alert.start + Math.max(2, (alert.end - alert.start) * 0.35);
      setTime(Math.min(alert.end - 1, middle));
      selectDrone(alert.droneId, true);
      rightTab.value = 'detail';
    }
    showToast('已进入应急演练：禁飞区处置', 'warn');
    return;
  }

  isPlaying.value = true;
  setTime(INITIAL_TIME);
  if (firstCritical) selectDrone(firstCritical.droneId, false);
  showToast('已切换到日常监视', 'info');
}

function toggleMode(): void {
  mode.value = mode.value === '3d' ? '2d' : '3d';
  followId.value = null;
  scene.value?.stopFollow();
  scene.value?.setMode(mode.value);
  showToast(mode.value === '3d' ? '已切换到三维态势' : '已切换到二维总览', 'info');
}

function resetView(): void {
  viewPreset.value = 'district';
  followId.value = null;
  scene.value?.setViewPreset('district');
  showToast('视角已复位', 'info');
}

function resetSimulation(): void {
  isPlaying.value = false;
  followId.value = null;
  selected.value = null;
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

  const airspace = AIRSPACES.find(
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

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch {
    showToast('当前浏览器不支持全屏', 'warn');
  }
}

function closeBasemap(): void {
  basemapOpen.value = false;
}

onMounted(async () => {
  await nextTick();
  if (!mapEl.value) return;

  try {
    const instance = new LowAltitudeScene(mapEl.value, {
      onSelect: handleSelect,
      onCameraChange: (info) => (cameraInfo.value = info)
    });
    scene.value = instance;
    await instance.init();
    const initialBasemap: BasemapStyle = resolvedTheme.value === 'light' ? 'light' : 'dark';
    basemap.value = initialBasemap;
    instance.setBasemap(initialBasemap);
    setTime(INITIAL_TIME);
    if (firstCritical) selectDrone(firstCritical.droneId, false);
    startLoop();
    loading.value = false;
  } catch (err) {
    console.error(err);
    error.value = err instanceof Error ? err.message : '三维场景初始化失败';
    loading.value = false;
  }

  window.addEventListener('click', closeBasemap);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  if (toastTimer) window.clearTimeout(toastTimer);
  window.removeEventListener('click', closeBasemap);
  scene.value?.destroy();
});
</script>

<template>
  <div class="app-shell" :class="{ 'focus-mode': !panelsVisible }">
    <div ref="mapEl" class="map-canvas"></div>

    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">
          <Icon name="radar" :size="21" />
        </div>
        <div class="brand-copy">
          <div class="brand-title">低空天穹 <span>LOW ALTITUDE</span></div>
          <div class="brand-sub">低空空域管控 · 动态电子地图</div>
        </div>
      </div>

      <div class="topbar-center">
        <div class="view-switch" role="group" aria-label="视角">
          <span>视角</span>
          <button type="button" :class="{ active: viewPreset === 'city' }" @click="setViewPreset('city')">
            全市
          </button>
          <button type="button" :class="{ active: viewPreset === 'district' }" @click="setViewPreset('district')">
            片区
          </button>
          <button type="button" :class="{ active: viewPreset === 'focus' }" @click="setViewPreset('focus')">
            重点
          </button>
        </div>
      </div>

      <div class="topbar-right">
        <form class="search-box" @submit.prevent="doSearch">
          <Icon name="search" :size="15" />
          <input v-model="searchQuery" placeholder="搜索目标 / 空域" aria-label="搜索目标或空域" />
          <kbd>↵</kbd>
        </form>

        <div class="theme-switch" role="group" aria-label="主题">
          <button
            type="button"
            :class="{ active: themeMode === 'light' }"
            title="浅色主题"
            @click="setThemeMode('light')"
          >
            <Icon name="sun" :size="15" />
          </button>
          <button
            type="button"
            :class="{ active: themeMode === 'dark' }"
            title="深色主题"
            @click="setThemeMode('dark')"
          >
            <Icon name="moon" :size="15" />
          </button>
          <button
            type="button"
            :class="{ active: themeMode === 'system' }"
            title="跟随系统"
            @click="setThemeMode('system')"
          >
            <Icon name="monitor" :size="15" />
          </button>
        </div>

        <div class="clock-box">
          <strong>{{ clock }}</strong>
          <span>{{ dateLabel }}</span>
        </div>

        <button
          class="icon-button"
          type="button"
          :class="{ active: !panelsVisible }"
          :title="panelsVisible ? '进入专注模式' : '退出专注模式'"
          @click="panelsVisible = !panelsVisible"
        >
          <Icon name="layout" :size="18" />
        </button>

        <div class="avatar">管</div>
      </div>
    </header>

    <main class="workspace">
      <aside class="panel left-panel">
        <div class="mission-card">
          <div class="mission-card-top">
            <span class="eyebrow">当前任务</span>
            <span class="mission-live"><i class="pulse-dot"></i>运行中</span>
          </div>
          <div class="mission-title">南山低空融合运行</div>
          <div class="mission-mode">
            <button
              type="button"
              :class="{ active: scenarioMode === 'daily' }"
              @click="setScenario('daily')"
            >
              日常监视
            </button>
            <button
              type="button"
              :class="{ active: scenarioMode === 'emergency' }"
              @click="setScenario('emergency')"
            >
              应急演练
            </button>
          </div>
          <div class="mission-stats">
            <span>
              <strong>{{ DRONES.length }}</strong>
              <small>在飞目标</small>
            </span>
            <span :class="{ danger: activeAlertCount > 0 }">
              <strong>{{ activeAlertCount }}</strong>
              <small>活动告警</small>
            </span>
            <span>
              <strong>{{ utilization }}</strong>
              <small>空域负荷</small>
            </span>
          </div>
        </div>

        <div class="panel-head compact">
          <div>
            <h3>态势图层</h3>
          </div>
          <span class="count-badge">{{ layerList.length }}</span>
        </div>

        <div class="layer-list">
          <button
            v-for="layer in layerList"
            :key="layer.key"
            type="button"
            class="layer-row"
            :class="{ active: layerState[layer.key] }"
            @click="toggleLayer(layer.key)"
          >
            <span class="layer-icon"><Icon :name="layer.icon" :size="17" /></span>
            <span class="layer-copy">
              <strong>{{ layer.label }}</strong>
            </span>
            <span class="layer-count">{{ layer.count }}</span>
            <span class="switch" :class="{ on: layerState[layer.key] }"><i></i></span>
          </button>
        </div>

        <div class="panel-divider"></div>

        <div class="panel-head compact">
          <div>
            <h3>空域概览</h3>
          </div>
          <span class="count-badge">{{ AIRSPACES.length }}</span>
        </div>

        <div class="airspace-list">
          <button
            v-for="airspace in AIRSPACES"
            :key="airspace.id"
            type="button"
            class="airspace-row"
            :class="{ active: selected?.kind === 'airspace' && selected.id === airspace.id }"
            @click="selectAirspace(airspace.id)"
          >
            <span
              class="airspace-dot"
              :style="{ background: airspace.color, boxShadow: `0 0 12px ${airspace.color}66` }"
            ></span>
            <span class="airspace-copy">
              <strong>{{ airspace.name }}</strong>
              <small>{{ AIRSPACE_META[airspace.kind].label }} · {{ airspace.minAlt }}–{{ airspace.maxAlt }}m</small>
            </span>
            <span class="airspace-status" :class="{ danger: airspace.kind === 'no-fly' }">{{ airspace.status }}</span>
          </button>
        </div>
      </aside>

      <div class="map-overlay">
        <div class="map-toolbar">
          <button
            class="map-tool"
            type="button"
            :class="{ active: mode === '2d' }"
            :title="mode === '3d' ? '切换到二维总览' : '切换到三维态势'"
            @click="toggleMode"
          >
            <Icon :name="mode === '3d' ? 'cube' : 'map'" :size="18" />
            <span>{{ mode === '3d' ? '3D' : '2D' }}</span>
          </button>
          <button class="map-tool" type="button" title="复位视角" @click="resetView">
            <Icon name="rotate" :size="18" />
          </button>
          <div class="basemap-control" @click.stop>
            <button class="map-tool" type="button" title="底图风格" @click="basemapOpen = !basemapOpen">
              <Icon name="layers" :size="18" />
              <span>底图</span>
            </button>
            <div v-if="basemapOpen" class="basemap-menu">
              <div class="basemap-menu-head">
                <span>底图风格</span>
                <small>BASEMAP DESIGN</small>
              </div>
              <button
                v-for="item in basemapOptions"
                :key="item.id"
                type="button"
                class="basemap-option"
                :class="{ active: basemap === item.id }"
                @click="setBasemap(item.id)"
              >
                <span class="basemap-swatch" :class="item.swatch"></span>
                <span class="basemap-copy">
                  <strong>{{ item.label }}</strong>
                  <small>{{ item.desc }}</small>
                </span>
                <Icon v-if="basemap === item.id" name="shield" :size="15" />
              </button>
              <div class="basemap-menu-footer">
                <button type="button" class="design-link" @click="showDesignPanel = true; basemapOpen = false">
                  <Icon name="palette" :size="14" />
                  打开底图设计
                </button>
              </div>
            </div>
          </div>
          <button class="map-tool" type="button" title="全屏" @click="toggleFullscreen">
            <Icon name="maximize" :size="18" />
          </button>
        </div>


        <div class="map-legend">
          <div class="legend-title">空域图例</div>
          <div class="legend-grid">
            <span v-for="item in legendItems" :key="item.label" class="legend-item">
              <i :style="{ background: item.color, boxShadow: `0 0 8px ${item.color}88` }"></i>
              {{ item.label }}
            </span>
          </div>
        </div>

        <div class="map-readout">
          <Icon name="target" :size="14" />
          <span>{{ cameraLabel }}</span>
        </div>

        <div class="map-attribution">{{ basemapCredit }}</div>

        <Transition name="toast-fade">
          <div v-if="toast" class="toast" :class="toast.type">
            <Icon :name="toast.type === 'warn' ? 'alert' : 'shield'" :size="15" />
            <span>{{ toast.message }}</span>
          </div>
        </Transition>
      </div>

      <aside class="panel right-panel">
        <div class="panel-head">
          <div>
            <h2>态势详情</h2>
          </div>
        </div>

        <div class="inspector-tabs">
          <button type="button" :class="{ active: rightTab === 'detail' }" @click="rightTab = 'detail'">
            详情
          </button>
          <button type="button" :class="{ active: rightTab === 'targets' }" @click="rightTab = 'targets'">
            目标 <em>{{ DRONES.length }}</em>
          </button>
          <button type="button" :class="{ active: rightTab === 'alerts' }" @click="rightTab = 'alerts'">
            告警 <em :class="{ danger: activeAlertCount > 0 }">{{ activeAlertCount }}</em>
          </button>
        </div>

        <template v-if="rightTab === 'detail'">
          <div v-if="selectedDrone" class="object-card target-card">
          <div class="object-hero">
            <div class="object-avatar" :style="{ '--accent': selectedDrone.color }">
              <Icon name="drone" :size="23" />
            </div>
            <div class="object-title-wrap">
              <div class="object-title">{{ selectedDrone.callsign }}</div>
              <div class="object-sub">{{ selectedDrone.model }} · {{ selectedDrone.operator }}</div>
            </div>
            <span class="state-badge" :class="{ danger: !!selectedDroneAlert }">
              {{ selectedDroneAlert ? '告警' : '正常' }}
            </span>
          </div>

          <div class="metric-grid">
            <div>
              <span>当前高度</span>
              <strong>{{ selectedDronePos ? Math.round(selectedDronePos.alt) : '--' }}<em>m</em></strong>
            </div>
            <div>
              <span>地速</span>
              <strong>{{ selectedDrone.speed }}<em>m/s</em></strong>
            </div>
            <div>
              <span>航向</span>
              <strong>{{ selectedDronePos ? Math.round(selectedDronePos.heading) : '--' }}<em>°</em></strong>
            </div>
            <div>
              <span>任务进度</span>
              <strong>{{ selectedDronePos ? Math.round(selectedDronePos.progress * 100) : '--' }}<em>%</em></strong>
            </div>
          </div>

          <div class="progress-line">
            <span :style="{ width: selectedDronePos ? `${selectedDronePos.progress * 100}%` : '0%' }"></span>
          </div>

          <div class="info-row">
            <span>执行计划</span>
            <strong>{{ selectedDrone.plan }}</strong>
          </div>
          <div class="info-row">
            <span>任务类型</span>
            <strong>{{ DRONE_KIND_META[selectedDrone.kind].label }}</strong>
          </div>

          <div class="object-actions">
            <button type="button" @click="focusSelected">
              <Icon name="locate" :size="15" />定位
            </button>
            <button type="button" :class="{ active: followId === selectedDrone.id }" @click="toggleFollow">
              <Icon name="follow" :size="15" />{{ followId === selectedDrone.id ? '取消跟随' : '跟随' }}
            </button>
          </div>

          <div v-if="selectedDroneAlert" class="inline-alert">
            <Icon name="alert" :size="15" />
            <span>{{ selectedDroneAlert.message }}</span>
          </div>
        </div>

        <div v-else-if="selectedAirspace" class="object-card airspace-card">
          <div class="object-hero">
            <div class="object-avatar" :style="{ '--accent': selectedAirspace.color }">
              <Icon name="layers" :size="23" />
            </div>
            <div class="object-title-wrap">
              <div class="object-title">{{ selectedAirspace.name }}</div>
              <div class="object-sub">{{ selectedAirspace.code }} · {{ selectedAirspace.authority }}</div>
            </div>
            <span class="state-badge">{{ selectedAirspace.status }}</span>
          </div>

          <div class="metric-grid airspace-metrics">
            <div>
              <span>空域类型</span>
              <strong class="text-strong">{{ selectedAirspaceMeta?.label }}</strong>
            </div>
            <div>
              <span>高度范围</span>
              <strong>{{ selectedAirspace.minAlt }}–{{ selectedAirspace.maxAlt }}<em>m</em></strong>
            </div>
          </div>

          <p class="object-description">{{ selectedAirspace.description }}</p>

          <div class="info-row">
            <span>管理单位</span>
            <strong>{{ selectedAirspace.authority }}</strong>
          </div>
          <div class="info-row">
            <span>运行状态</span>
            <strong>{{ selectedAirspace.status }}</strong>
          </div>

          <div class="object-actions">
            <button type="button" @click="focusSelected">
              <Icon name="locate" :size="15" />定位空域
            </button>
          </div>
        </div>

        <div v-else class="object-empty">
          <div class="empty-ring"><Icon name="target" :size="27" /></div>
          <strong>未选择对象</strong>
          <p>点击地图中的空域或航空器<br />查看实时详情</p>
        </div>
        </template>

        <div v-else-if="rightTab === 'targets'" class="target-list">
          <div class="list-caption">
            <span>在飞目标</span>
            <small>按告警优先排序</small>
          </div>
          <button
            v-for="row in targetRows"
            :key="row.drone.id"
            type="button"
            class="target-row"
            :class="{
              active: selected?.kind === 'drone' && selected.id === row.drone.id,
              alert: !!row.alert
            }"
            @click="selectDrone(row.drone.id)"
          >
            <span
              class="target-dot"
              :style="{ background: row.drone.color, boxShadow: `0 0 10px ${row.drone.color}66` }"
            ></span>
            <span class="target-main">
              <strong>{{ row.drone.callsign }}</strong>
              <small>{{ DRONE_KIND_META[row.drone.kind].label }} · {{ row.drone.operator }}</small>
            </span>
            <span class="target-metrics">
              <strong>{{ Math.round(row.pos.alt) }}<em>m</em></strong>
              <small>{{ Math.round(row.pos.heading) }}°</small>
            </span>
            <span class="target-status" :class="{ alert: !!row.alert }">
              {{ row.alert ? '告警' : '正常' }}
            </span>
          </button>
        </div>

        <div v-else class="alert-list full">
          <div class="list-caption">
            <span>全部告警</span>
            <small>{{ ALERT_EVENTS.length }} 条事件</small>
          </div>
          <button
            v-for="alert in alertListAll"
            :key="alert.id"
            type="button"
            class="alert-item"
            :class="[alert.level, alertState(alert)]"
            @click="selectAlert(alert)"
          >
            <span class="alert-item-icon"><Icon name="alert" :size="15" /></span>
            <span class="alert-copy">
              <strong>{{ alert.title }}</strong>
              <small>{{ alert.droneCallsign }} · {{ alert.airspaceName }}</small>
              <em>{{ alertTimeLabel(alert) }}</em>
            </span>
            <span class="alert-item-state">{{ alertStateLabel(alert) }}</span>
          </button>
        </div>

        <template v-if="rightTab !== 'alerts'">
          <div class="panel-divider"></div>

          <div class="alert-head">
            <div>
              <h3>实时告警</h3>
            </div>
            <span class="alert-count" :class="{ live: activeAlertCount > 0 }">{{ activeAlertCount }}</span>
          </div>

          <div class="alert-list">
            <button
              v-for="alert in alertList"
              :key="alert.id"
              type="button"
              class="alert-item"
              :class="[alert.level, alertState(alert)]"
              @click="selectAlert(alert)"
            >
              <span class="alert-item-icon"><Icon name="alert" :size="15" /></span>
              <span class="alert-copy">
                <strong>{{ alert.title }}</strong>
                <small>{{ alert.droneCallsign }} · {{ alert.airspaceName }}</small>
                <em>{{ alertTimeLabel(alert) }}</em>
              </span>
              <span class="alert-item-state">{{ alertStateLabel(alert) }}</span>
            </button>

            <div v-if="alertList.length === 0" class="alert-empty">
              <Icon name="shield" :size="18" />
              <span>当前空域运行正常</span>
            </div>
          </div>
        </template>
      </aside>
    </main>

    <footer class="timeline-bar">
      <div class="timeline-left">
        <button class="play-button" type="button" :aria-label="isPlaying ? '暂停' : '播放'" @click="togglePlay">
          <Icon :name="isPlaying ? 'pause' : 'play'" :size="18" />
        </button>
        <div class="time-readout">
          <strong>{{ clock }}</strong>
          <span>{{ isPlaying ? '模拟运行中' : '模拟已暂停' }}</span>
        </div>
        <span class="sim-chip"><i class="pulse-dot"></i>模拟时钟</span>
      </div>

      <div class="timeline-main">
        <div class="timeline-meta">
          <span>场景时间轴</span>
          <span>{{ formatDuration(simTime) }} / {{ durationLabel }}</span>
        </div>
        <div class="timeline-track">
          <input
            class="timeline-range"
            type="range"
            min="0"
            :max="SIM_DURATION"
            step="0.1"
            :value="simTime"
            aria-label="场景时间轴"
            @input="onTimeInput"
          />
        </div>
        <div class="timeline-scale"><span>00:00</span><span>{{ durationLabel }}</span></div>
      </div>

      <div class="timeline-right">
        <div class="speed-group">
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
        <button class="icon-button small" type="button" title="回到起点" @click="resetSimulation">
          <Icon name="clock" :size="17" />
        </button>
        <button class="icon-button small" type="button" title="复位视角" @click="resetView">
          <Icon name="rotate" :size="17" />
        </button>
      </div>
    </footer>

    <Transition name="drawer-fade">
      <div v-if="showDesignPanel" class="design-overlay" @click.self="showDesignPanel = false">
        <section class="design-panel" role="dialog" aria-label="底图设计规范">
          <header class="design-header">
            <div>
              <span class="eyebrow">BASEMAP DESIGN</span>
              <h2>底图设计规范</h2>
            </div>
            <button class="icon-button" type="button" title="关闭" @click="showDesignPanel = false">
              <Icon name="x" :size="18" />
            </button>
          </header>

          <div class="design-preview" :class="basemap">
            <div class="design-preview-grid"></div>
            <div class="design-preview-copy">
              <span>当前底图风格</span>
              <strong>{{ currentBasemapLabel }}</strong>
              <small>
                低饱和底图 · 高对比业务层 ·
                {{
                  basemap === 'light'
                    ? '浅色政务视觉'
                    : basemap === 'satellite'
                      ? '卫星影像视觉'
                      : '暗色指挥视觉'
                }}
              </small>
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
            <Icon name="palette" :size="19" />
            <p>
              MVP 阶段使用 Esri 底图 + Cesium 色彩调校模拟“暗色指挥”风格。后续接入 Maputnik 编辑
              <code>style.json</code>，经 TileServer GL 栅格化后供 Cesium 加载，实现真正的自定义底图设计。
            </p>
          </div>

          <div class="design-note next">
            <Icon name="cube" :size="19" />
            <p>
              <strong>三维建筑（下一阶段）</strong><br />
              预留 3D Tiles 接入位：倾斜摄影/白模 + <code>Cesium3DTileset</code> + 建筑风格化，用于重点区域三维场景。
            </p>
          </div>

          <div class="design-actions">
            <button type="button" @click="setBasemap('dark'); showDesignPanel = false">应用暗色指挥</button>
            <button type="button" @click="setBasemap('light'); showDesignPanel = false">应用浅色政务</button>
          </div>
        </section>
      </div>
    </Transition>

    <div v-if="loading" class="loading-screen">
      <div class="loading-orbit"><span></span><span></span></div>
      <strong>正在构建低空态势场景</strong>
      <small>CESIUM · AIRSPACE · TELEMETRY</small>
    </div>

    <div v-if="error" class="error-screen">
      <Icon name="alert" :size="28" />
      <strong>场景初始化失败</strong>
      <p>{{ error }}</p>
      <small>请检查浏览器 WebGL 支持和网络连接后刷新页面。</small>
    </div>
  </div>
</template>
