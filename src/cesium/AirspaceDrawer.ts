import * as Cesium from 'cesium';

export type DrawMode = 'polygon' | 'rectangle' | 'circle';
export type LonLatRing = [number, number][];

export interface DrawState {
  active: boolean;
  mode: DrawMode;
  /** 平移模式：拖动地图，不落点 */
  pan: boolean;
  /** 已闭合的多边形块数 */
  rings: number;
  /** 当前正在画的点数（矩形/圆形为锚点是否已落） */
  points: number;
}

interface DrawerCallbacks {
  onChange?: (state: DrawState) => void;
  onFinish?: (rings: LonLatRing[]) => void;
}

const DRAFT_COLOR = '#F5A524';
const M_PER_DEG_LAT = 111132.92;

/**
 * 空域手绘，三种模式（参考 GEE 的绘制工具）：
 *   - polygon   自由多边形：单击落点，双击 / 右键闭合当前块
 *   - rectangle 矩形：点两个对角
 *   - circle    圆形：先点圆心，再点圆周（按 64 边近似成环）
 *
 * 一个空域可以由多块组成，闭合一块后可以继续画下一块。
 */
export class AirspaceDrawer {
  private handler?: Cesium.ScreenSpaceEventHandler;
  private mode: DrawMode = 'polygon';
  private current: Cesium.Cartesian3[] = [];
  private currentLonLat: [number, number][] = [];
  private anchorLonLat?: [number, number];
  private rings: LonLatRing[] = [];
  private hover?: Cesium.Cartesian3;
  private vertexEntities: Cesium.Entity[] = [];
  private ringEntities: Cesium.Entity[] = [];
  private line?: Cesium.Entity;
  private fill?: Cesium.Entity;
  private active = false;
  private lastClick = { time: 0, x: 0, y: 0 };
  private panMode = false;

  constructor(
    private readonly viewer: Cesium.Viewer,
    private readonly callbacks: DrawerCallbacks
  ) {}

  get isActive(): boolean {
    return this.active;
  }

  start(mode: DrawMode = 'polygon'): void {
    if (this.active) return;
    this.active = true;
    this.mode = mode;
    this.panMode = false;
    this.reset();

    const color = Cesium.Color.fromCssColorString(DRAFT_COLOR);

    this.line = this.viewer.entities.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => this.previewPositions(), false),
        width: 2.6,
        material: new Cesium.PolylineOutlineMaterialProperty({
          color: color.withAlpha(0.95),
          outlineColor: Cesium.Color.BLACK.withAlpha(0.35),
          outlineWidth: 1
        }),
        arcType: Cesium.ArcType.NONE
      }
    });

    this.fill = this.viewer.entities.add({
      polygon: {
        hierarchy: new Cesium.CallbackProperty(() => {
          const ring = this.previewPositions();
          return ring.length >= 3
            ? new Cesium.PolygonHierarchy(ring)
            : (undefined as unknown as Cesium.PolygonHierarchy);
        }, false),
        height: 2,
        material: color.withAlpha(0.3),
        outline: false
      }
    });

    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);

    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      this.onClick(movement.position);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    handler.setInputAction(() => {
      if (this.panMode) return;
      if (this.mode === 'polygon') this.closeRing();
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    handler.setInputAction(() => {
      if (this.panMode) return;
      if (this.mode === 'polygon') this.closeRing();
      else this.anchorLonLat = undefined;
      this.viewer.scene.requestRender();
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      if (!this.active) return;
      const picked = this.pick(movement.endPosition);
      this.hover = picked ?? undefined;
      this.viewer.scene.requestRender();
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    this.handler = handler;

    // 双击不要触发 Viewer 的“缩放到实体”
    this.viewer.screenSpaceEventHandler.removeInputAction(
      Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
    );

    this.viewer.scene.canvas.style.cursor = 'crosshair';
    this.emit();
    this.viewer.scene.requestRender();
  }

  /** 平移模式：此时不接收落点，交给相机控制器拖拽 */
  setPanMode(on: boolean): void {
    if (!this.active) return;
    this.panMode = on;
    this.viewer.scene.canvas.style.cursor = on ? 'grab' : 'crosshair';
    this.emit();
    this.viewer.scene.requestRender();
  }

  setMode(mode: DrawMode): void {
    if (!this.active || this.mode === mode) return;
    this.mode = mode;
    // 切换模式时丢弃未闭合的草稿，但保留已经画好的块
    this.current = [];
    this.currentLonLat = [];
    this.anchorLonLat = undefined;
    for (const entity of this.vertexEntities) this.viewer.entities.remove(entity);
    this.vertexEntities = [];
    this.emit();
    this.viewer.scene.requestRender();
  }

  undo(): void {
    if (!this.active) return;
    if (this.mode !== 'polygon') {
      this.anchorLonLat = undefined;
      this.emit();
      this.viewer.scene.requestRender();
      return;
    }
    if (this.current.length === 0) return;
    const entity = this.vertexEntities.pop();
    if (entity) this.viewer.entities.remove(entity);
    this.current.pop();
    this.currentLonLat.pop();
    this.emit();
    this.viewer.scene.requestRender();
  }

  /** 自由多边形：闭合当前块；不足三个点不动 */
  closeRing(): void {
    if (!this.active || this.mode !== 'polygon' || this.currentLonLat.length < 3) {
      this.emit();
      return;
    }
    this.pushRing(this.currentLonLat.map(([lon, lat]) => [lon, lat] as [number, number]));
    this.current = [];
    this.currentLonLat = [];
    this.emit();
    this.viewer.scene.requestRender();
  }

  /** 完成全部绘制并提交 */
  finishAll(): void {
    if (!this.active) return;
    if (this.mode === 'polygon' && this.currentLonLat.length >= 3) this.closeRing();
    if (this.rings.length === 0) {
      this.emit();
      return;
    }
    const rings = this.rings.map((ring) => ring.map(([lon, lat]) => [lon, lat] as [number, number]));
    this.stop();
    this.callbacks.onFinish?.(rings);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;

    this.handler?.destroy();
    this.handler = undefined;

    for (const entity of [...this.vertexEntities, ...this.ringEntities]) {
      this.viewer.entities.remove(entity);
    }
    if (this.line) this.viewer.entities.remove(this.line);
    if (this.fill) this.viewer.entities.remove(this.fill);

    this.line = undefined;
    this.fill = undefined;

    this.reset();
    this.viewer.scene.canvas.style.cursor = '';
    this.emit();
    this.viewer.scene.requestRender();
  }

  private reset(): void {
    this.current = [];
    this.currentLonLat = [];
    this.anchorLonLat = undefined;
    this.rings = [];
    this.vertexEntities = [];
    this.ringEntities = [];
    this.hover = undefined;
    this.lastClick = { time: 0, x: 0, y: 0 };
  }

  private pushRing(ring: LonLatRing): void {
    this.rings.push(ring);
    const color = Cesium.Color.fromCssColorString(DRAFT_COLOR);
    this.ringEntities.push(
      this.viewer.entities.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ring.flat())),
          height: 2,
          material: color.withAlpha(0.3),
          outline: false
        }
      })
    );
  }

  private previewPositions(): Cesium.Cartesian3[] {
    if (this.mode === 'polygon') {
      if (this.current.length === 0) return [];
      return this.hover ? [...this.current, this.hover] : this.current;
    }

    if (!this.anchorLonLat || !this.hover) return [];
    const hoverLL = this.toLonLat(this.hover);
    if (!hoverLL) return [];
    const ring = this.shapeRing(this.anchorLonLat, hoverLL, this.mode);
    return ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, 2));
  }

  private shapeRing(a: [number, number], b: [number, number], mode: DrawMode): LonLatRing {
    if (mode === 'rectangle') {
      return [
        [a[0], a[1]],
        [b[0], a[1]],
        [b[0], b[1]],
        [a[0], b[1]]
      ];
    }

    const mPerDegLon = 111412.84 * Math.cos((a[1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * mPerDegLon;
    const dy = (b[1] - a[1]) * M_PER_DEG_LAT;
    const radius = Math.hypot(dx, dy);
    const steps = 64;
    const ring: LonLatRing = [];
    for (let i = 0; i < steps; i += 1) {
      const angle = (i / steps) * Math.PI * 2;
      ring.push([
        a[0] + (radius * Math.cos(angle)) / mPerDegLon,
        a[1] + (radius * Math.sin(angle)) / M_PER_DEG_LAT
      ]);
    }
    return ring;
  }

  private toLonLat(cartesian: Cesium.Cartesian3): [number, number] | null {
    const carto = Cesium.Cartographic.fromCartesian(cartesian);
    if (!carto) return null;
    return [Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)];
  }

  private pick(windowPos: Cesium.Cartesian2): Cesium.Cartesian3 | null {
    const scene = this.viewer.scene;
    const ray = this.viewer.camera.getPickRay(windowPos);
    if (ray) {
      const hit = scene.globe.pick(ray, scene);
      if (hit) return hit;
    }
    return this.viewer.camera.pickEllipsoid(windowPos, scene.globe.ellipsoid) ?? null;
  }

  private onClick(windowPos: Cesium.Cartesian2): void {
    if (!this.active || this.panMode) return;

    const now = performance.now();
    const moved = Math.hypot(windowPos.x - this.lastClick.x, windowPos.y - this.lastClick.y);
    // 双击会先触发两次单击，把紧邻的第二次丢掉
    if (now - this.lastClick.time < 320 && moved < 6) return;
    this.lastClick = { time: now, x: windowPos.x, y: windowPos.y };

    const cartesian = this.pick(windowPos);
    if (!cartesian) return;
    const lonLat = this.toLonLat(cartesian);
    if (!lonLat) return;

    if (this.mode === 'polygon') {
      this.current.push(cartesian);
      this.currentLonLat.push(lonLat);
      this.vertexEntities.push(
        this.viewer.entities.add({
          position: cartesian,
          point: {
            pixelSize: 9,
            color: Cesium.Color.fromCssColorString(DRAFT_COLOR),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          }
        })
      );
      this.emit();
      this.viewer.scene.requestRender();
      return;
    }

    // 矩形 / 圆形：第一次点锚点，第二次成型
    if (!this.anchorLonLat) {
      this.anchorLonLat = lonLat;
      this.vertexEntities.push(
        this.viewer.entities.add({
          position: cartesian,
          point: {
            pixelSize: 9,
            color: Cesium.Color.fromCssColorString(DRAFT_COLOR),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          }
        })
      );
      this.emit();
      this.viewer.scene.requestRender();
      return;
    }

    const ring = this.shapeRing(this.anchorLonLat, lonLat, this.mode);
    this.pushRing(ring);
    this.anchorLonLat = undefined;
    for (const entity of this.vertexEntities) this.viewer.entities.remove(entity);
    this.vertexEntities = [];
    this.emit();
    this.viewer.scene.requestRender();
  }

  private emit(): void {
    this.callbacks.onChange?.({
      active: this.active,
      mode: this.mode,
      pan: this.panMode,
      rings: this.rings.length,
      points: this.mode === 'polygon' ? this.currentLonLat.length : this.anchorLonLat ? 1 : 0
    });
  }
}
