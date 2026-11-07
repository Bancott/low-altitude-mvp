import { computed } from 'vue';
import { airspaceRevision, airspaces } from './airspaceStore';
import { pointInRing } from './geometry';
import {
  DRONES,
  SIM_DURATION,
  positionAt,
  type Airspace,
  type AlertEvent,
  type Drone
} from './scenario';

/**
 * 告警时间线。
 *
 * 原实现把 AIRSPACES 写死在模块顶层算一次，新增空域永远不会产生告警，
 * 而且末尾 slice(0, 8) 会静默丢掉多余事件。现在改为：
 *   - 输入是当前空域列表，空域一变就重算（computed 依赖 airspaceRevision）
 *   - 不再硬截断，列表本身可滚动
 * 采样仍是 1 秒，420 秒 × 10 机 × N 空域，毫秒级，重算成本可以接受。
 */
export function buildAlertEvents(
  airspaceList: Airspace[],
  duration = SIM_DURATION
): AlertEvent[] {
  const events: AlertEvent[] = [];

  for (const drone of DRONES) {
    const active = new Map<
      string,
      { start: number; end: number; airspace: Airspace; type: AlertEvent['type'] }
    >();

    for (let t = 0; t <= duration; t += 1) {
      const pos = positionAt(drone, t);
      const hits = new Map<string, { airspace: Airspace; type: AlertEvent['type'] }>();

      for (const airspace of airspaceList) {
        const inside = airspace.polygons.some((ring) => pointInRing(pos.lon, pos.lat, ring));
        if (!inside) continue;

        if (airspace.kind === 'no-fly' && pos.alt >= airspace.minAlt && pos.alt <= airspace.maxAlt) {
          hits.set(`nfz:${airspace.id}`, { airspace, type: 'NO_FLY_INTRUSION' });
        }

        if (airspace.kind === 'advisory' && pos.alt > airspace.maxAlt) {
          hits.set(`alt:${airspace.id}`, { airspace, type: 'ALTITUDE_DEVIATION' });
        }

        if (airspace.kind === 'temporary' && pos.alt > airspace.maxAlt) {
          hits.set(`tmp:${airspace.id}`, { airspace, type: 'TEMP_RESTRICTION' });
        }
      }

      for (const [key, hit] of hits) {
        const current = active.get(key);
        if (current) {
          current.end = t;
        } else {
          active.set(key, { start: t, end: t, airspace: hit.airspace, type: hit.type });
        }
      }

      for (const [key, current] of [...active]) {
        if (!hits.has(key)) {
          events.push(toAlertEvent(drone, current.airspace, current.type, current.start, current.end));
          active.delete(key);
        }
      }
    }

    for (const current of active.values()) {
      events.push(toAlertEvent(drone, current.airspace, current.type, current.start, current.end));
    }
  }

  if (events.length === 0) {
    const drone = DRONES[0];
    const airspace =
      airspaceList.find((item) => item.kind === 'no-fly') ?? airspaceList[0];
    if (airspace) {
      events.push(toAlertEvent(drone, airspace, 'NO_FLY_INTRUSION', 38, 62));
    }
  }

  return events
    .map((event, index) => ({ ...event, id: `AL-${String(index + 1).padStart(3, '0')}` }))
    .sort((a, b) => a.start - b.start);
}

function toAlertEvent(
  drone: Drone,
  airspace: Airspace,
  type: AlertEvent['type'],
  start: number,
  end: number
): AlertEvent {
  const title =
    type === 'NO_FLY_INTRUSION'
      ? '闯入临时禁飞区'
      : type === 'ALTITUDE_DEVIATION'
        ? '超出适飞高度'
        : '进入临时限制区';

  const level: AlertEvent['level'] = type === 'NO_FLY_INTRUSION' ? 'critical' : 'warning';
  const message =
    type === 'NO_FLY_INTRUSION'
      ? `${drone.callsign} 进入 ${airspace.name}，请立即处置`
      : `${drone.callsign} 在 ${airspace.name} 内超出 ${airspace.maxAlt}m 限高`;

  return {
    id: '',
    droneId: drone.id,
    droneCallsign: drone.callsign,
    airspaceId: airspace.id,
    airspaceName: airspace.name,
    type,
    level,
    title,
    message,
    start,
    end: Math.max(start + 1, end)
  };
}

/** 当前空域列表对应的告警时间线，空域变更后自动重算 */
export const alertEvents = computed(() => {
  airspaceRevision.value;
  return buildAlertEvents(airspaces.value);
});

export function alertsAt(time: number): AlertEvent[] {
  return alertEvents.value.filter((event) => time >= event.start && time <= event.end);
}
