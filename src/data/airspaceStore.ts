import { computed, reactive } from 'vue';
import { AIRSPACES, type Airspace } from './scenario';

/**
 * 空域数据层。
 *
 * 这里只存“可序列化的数据”，不放 Cesium 实体、不放 DOM。
 * 渲染由 AirspaceLayer 订阅 version 变化后同步，路径规划等算法也只读这份数据。
 * 后续手绘 / 导入，只需调用 addAirspace / replaceAirspaces，其余各处自动跟上。
 */

const state = reactive<{
  items: Airspace[];
  revision: number;
}>({
  items: AIRSPACES.map(cloneAirspace),
  revision: 0
});

export function cloneAirspace(airspace: Airspace): Airspace {
  return {
    ...airspace,
    polygons: airspace.polygons.map((ring) => ring.map(([lon, lat]) => [lon, lat] as [number, number])),
    source: airspace.source ?? 'builtin',
    window: airspace.window ? { ...airspace.window } : undefined
  };
}

/** 只读列表，模板里可直接 v-for */
export const airspaces = computed(() => state.items);

/** 每次变更自增，渲染层据此判断是否需要重建实体 */
export const airspaceRevision = computed(() => state.revision);

function touch(): void {
  state.revision += 1;
}

export function getAirspace(id: string): Airspace | undefined {
  return state.items.find((item) => item.id === id);
}

export function addAirspace(airspace: Airspace): Airspace {
  const next = cloneAirspace(airspace);
  state.items.push(next);
  touch();
  return next;
}

export function updateAirspace(id: string, patch: Partial<Airspace>): void {
  const target = state.items.find((item) => item.id === id);
  if (!target) return;
  Object.assign(target, cloneAirspace({ ...target, ...patch }));
  touch();
}

export function removeAirspace(id: string): boolean {
  const index = state.items.findIndex((item) => item.id === id);
  if (index < 0) return false;
  state.items.splice(index, 1);
  touch();
  return true;
}

/** 导入用：整表替换（可保留内置示例，由调用方决定拼装方式） */
export function replaceAirspaces(list: Airspace[]): void {
  state.items.splice(0, state.items.length, ...list.map(cloneAirspace));
  touch();
}

/** 恢复内置示例区域 */
export function resetAirspaces(): void {
  state.items.splice(0, state.items.length, ...AIRSPACES.map(cloneAirspace));
  touch();
}

/** 生成下一个可用编号，手绘新增时用 */
export function nextAirspaceId(prefix = 'AS'): string {
  const used = new Set(state.items.map((item) => item.id));
  let index = state.items.length + 1;
  let candidate = `${prefix}-${String(index).padStart(3, '0')}`;
  while (used.has(candidate)) {
    index += 1;
    candidate = `${prefix}-${String(index).padStart(3, '0')}`;
  }
  return candidate;
}
