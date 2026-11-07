import * as Cesium from 'cesium';
import type { Airspace } from '../data/scenario';

interface RingParts {
  volume: Cesium.Entity;
  top: Cesium.Entity;
  bottom: Cesium.Entity;
  verticals: Cesium.Entity[];
}

interface AirspaceView {
  airspace: Airspace;
  signature: string;
  parts: RingParts[];
}

/**
 * 空域渲染层：只负责把 Airspace 数据变成 Cesium 实体，并处理选中 / 告警 / 显隐。
 *
 * 一个空域可以有多个外环，每个环渲染成一根独立棱柱（体积 + 顶面线 + 底面线 + 竖边）。
 * 与数据层解耦：调用方传入空域列表即可，图层内部按 id 做差异同步。
 */
export class AirspaceLayer {
  private views = new Map<string, AirspaceView>();
  private visible = true;
  private selectedId: string | null = null;
  private alertIds = new Set<string>();

  constructor(private readonly viewer: Cesium.Viewer) {}

  sync(list: Airspace[]): void {
    const nextIds = new Set(list.map((item) => item.id));

    for (const [id, view] of [...this.views]) {
      if (nextIds.has(id)) continue;
      this.remove(view);
      this.views.delete(id);
    }

    for (const airspace of list) {
      const signature = this.signatureOf(airspace);
      const existing = this.views.get(airspace.id);
      if (existing && existing.signature === signature) continue;
      if (existing) {
        this.remove(existing);
        this.views.delete(airspace.id);
      }
      const view = this.create(airspace, signature);
      this.views.set(airspace.id, view);
      this.applyStyle(view);
    }

    this.viewer.scene.requestRender();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const view of this.views.values()) {
      for (const part of view.parts) {
        part.volume.show = visible;
        part.top.show = visible;
        part.bottom.show = visible;
        for (const vertical of part.verticals) vertical.show = visible;
      }
    }
    this.viewer.scene.requestRender();
  }

  setSelection(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    for (const view of this.views.values()) this.applyStyle(view);
    this.viewer.scene.requestRender();
  }

  setAlerting(ids: Set<string>): void {
    const same =
      ids.size === this.alertIds.size && [...ids].every((id) => this.alertIds.has(id));
    if (same) return;
    this.alertIds = new Set(ids);
    for (const view of this.views.values()) this.applyStyle(view);
    this.viewer.scene.requestRender();
  }

  get(id: string): Airspace | undefined {
    return this.views.get(id)?.airspace;
  }

  destroy(): void {
    for (const view of this.views.values()) this.remove(view);
    this.views.clear();
  }

  private signatureOf(airspace: Airspace): string {
    return JSON.stringify([
      airspace.name,
      airspace.kind,
      airspace.color,
      airspace.minAlt,
      airspace.maxAlt,
      airspace.polygons
    ]);
  }

  private create(airspace: Airspace, signature: string): AirspaceView {
    const color = Cesium.Color.fromCssColorString(airspace.color);
    const parts = airspace.polygons.map((ring) => this.createRing(airspace, ring, color));
    return { airspace, signature, parts };
  }

  private createRing(
    airspace: Airspace,
    ring: [number, number][],
    color: Cesium.Color
  ): RingParts {
    const viewer = this.viewer;
    const closed = [...ring, ring[0]];
    const topPositions = Cesium.Cartesian3.fromDegreesArrayHeights(
      closed.flatMap(([lon, lat]) => [lon, lat, airspace.maxAlt + 1])
    );
    const bottomPositions = Cesium.Cartesian3.fromDegreesArrayHeights(
      closed.flatMap(([lon, lat]) => [lon, lat, airspace.minAlt + 1])
    );
    const suffix = `${airspace.id}:${ring[0][0].toFixed(5)}_${ring[0][1].toFixed(5)}`;

    const volume = viewer.entities.add({
      id: `airspace:${suffix}`,
      name: airspace.name,
      show: this.visible,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ring.flat())),
        height: airspace.minAlt,
        extrudedHeight: airspace.maxAlt,
        material: color.withAlpha(0.28),
        outline: false
      }
    });

    const top = viewer.entities.add({
      id: `airspace:${suffix}:top`,
      show: this.visible,
      polyline: {
        positions: topPositions,
        width: 2.2,
        material: color.withAlpha(0.92),
        arcType: Cesium.ArcType.NONE
      }
    });

    const bottom = viewer.entities.add({
      id: `airspace:${suffix}:bottom`,
      show: this.visible,
      polyline: {
        positions: bottomPositions,
        width: 1.2,
        material: color.withAlpha(0.34),
        arcType: Cesium.ArcType.NONE
      }
    });

    const verticals = ring.map(([lon, lat], index) =>
      viewer.entities.add({
        id: `airspace:${suffix}:edge:${index}`,
        show: this.visible,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArrayHeights([
            lon,
            lat,
            airspace.minAlt,
            lon,
            lat,
            airspace.maxAlt
          ]),
          width: 1,
          material: color.withAlpha(0.24),
          arcType: Cesium.ArcType.NONE,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 18000)
        }
      })
    );

    return { volume, top, bottom, verticals };
  }

  private remove(view: AirspaceView): void {
    for (const part of view.parts) {
      this.viewer.entities.remove(part.volume);
      this.viewer.entities.remove(part.top);
      this.viewer.entities.remove(part.bottom);
      for (const vertical of part.verticals) this.viewer.entities.remove(vertical);
    }
  }

  private applyStyle(view: AirspaceView): void {
    const color = Cesium.Color.fromCssColorString(view.airspace.color);
    const red = Cesium.Color.fromCssColorString('#E5484D');
    const selected = this.selectedId === view.airspace.id;
    const alert = this.alertIds.has(view.airspace.id);
    const accent = alert ? red : color;
    const noFly = view.airspace.kind === 'no-fly';

    // 体积填充顶面与侧壁共用一份材质，只在这里统一定浓度。
    // 禁飞本身够醒目，其余类别要再浓一些才看得清色块。
    const base = noFly ? 0.28 : 0.34;
    const bodyAlpha = alert ? 0.38 : selected ? Math.min(0.42, base + 0.06) : base;

    for (const part of view.parts) {
      if (part.volume.polygon) {
        part.volume.polygon.material = new Cesium.ColorMaterialProperty(
          (alert ? red : color).withAlpha(bodyAlpha)
        );
      }

      if (part.top.polyline) {
        part.top.polyline.material = new Cesium.ColorMaterialProperty(
          accent.withAlpha(selected || alert ? 1 : 0.92)
        );
        part.top.polyline.width = new Cesium.ConstantProperty(selected || alert ? 3 : 2.2);
      }

      if (part.bottom.polyline) {
        part.bottom.polyline.material = new Cesium.ColorMaterialProperty(
          accent.withAlpha(selected ? 0.42 : 0.3)
        );
      }

      for (const vertical of part.verticals) {
        if (!vertical.polyline) continue;
        vertical.polyline.material = new Cesium.ColorMaterialProperty(
          accent.withAlpha(selected ? 0.34 : 0.2)
        );
      }
    }
  }
}
