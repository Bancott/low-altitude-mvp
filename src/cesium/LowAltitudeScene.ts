import * as Cesium from 'cesium';
import { getBasemap, type BasemapStyle } from '../config/basemaps';
import { airspaceRevision, airspaces, getAirspace } from '../data/airspaceStore';
import { ringArea, ringCentroid, ringRadius } from '../data/geometry';
import { DRONES, type AlertEvent, type Drone, positionAt } from '../data/scenario';
import { AirspaceDrawer, type DrawMode, type DrawState } from './AirspaceDrawer';
import { AirspaceLayer } from './AirspaceLayer';

export type Selection = { kind: 'drone' | 'airspace'; id: string } | null;
export type { BasemapStyle };
export type { DrawMode } from './AirspaceDrawer';
export type LayerKey = 'airspace' | 'routes' | 'drones' | 'trails' | 'alerts' | 'buildings';
export type CameraInfo = { lon: number; lat: number; height: number; heading: number };

interface SceneOptions {
  onSelect?: (selection: Selection) => void;
  onCameraChange?: (info: CameraInfo) => void;
  onContextLost?: () => void;
  onDrawChange?: (state: DrawState) => void;
  onDrawFinish?: (rings: [number, number][][]) => void;
}

interface DroneView {
  drone: Drone;
  entity: Cesium.Entity;
  halo: Cesium.Entity;
  trail: Cesium.Entity;
  route: Cesium.Entity;
  position: Cesium.Cartesian3;
  trailPositions: Cesium.Cartesian3[];
  heading: number;
  selected: boolean;
  alert: boolean;
  alertLevel: 'critical' | 'warning' | null;
  visualKey: string;
}

const CENTER = { lon: 113.935, lat: 22.525 };
const DARK = '#050a12';
const MODEL_HEADING_OFFSET = Math.PI / 2;

// 缩到这个高度开始把俯角往 -90° 拉平；到 GLOBE_LEVEL_FULL 完全拉平。
// 不拉平的话，斜俯角在极远距离上会把球体压到画面下半部分。
const GLOBE_LEVEL_START = 1_500_000;
const GLOBE_LEVEL_FULL = 6_000_000;

export class LowAltitudeScene {
  private readonly container: HTMLElement;
  private readonly options: SceneOptions;
  private viewer?: Cesium.Viewer;
  private handler?: Cesium.ScreenSpaceEventHandler;
  private resizeObserver?: ResizeObserver;
  private airspaceLayer?: AirspaceLayer;
  private drawer?: AirspaceDrawer;
  private airspaceSyncedRevision = -1;
  private drones: DroneView[] = [];
  private facilities: Cesium.Entity[] = [];
  private selection: Selection = null;
  private activeAirspaceIds = new Set<string>();
  private activeDroneIds = new Set<string>();
  private layers: Record<LayerKey, boolean> = {
    airspace: true,
    routes: true,
    drones: true,
    trails: true,
    alerts: true,
    buildings: true
  };
  private lastTime = 0;
  private lastUpdateWall = 0;
  private simRate = 1;
  private lastTrailUpdate = 0;
  private lastTrailUpdateTime = 0;
  private lastCameraNotify = 0;
  private lastAlertKey = '';
  private contextLostHandler?: (event: Event) => void;
  private followOffset = new Cesium.Cartesian3(0, -2600, 1600);
  private fpvId: string | null = null;
  private cameraInfo: CameraInfo = { ...CENTER, height: 7200, heading: 0 };
  private handleResize = () => this.viewer?.resize();
  private handleCameraChanged = () => {
    const now = performance.now();
    if (now - this.lastCameraNotify < 160 || !this.viewer) return;
    this.lastCameraNotify = now;
    const carto = this.viewer.camera.positionCartographic;
    this.cameraInfo = {
      lon: Cesium.Math.toDegrees(carto.longitude),
      lat: Cesium.Math.toDegrees(carto.latitude),
      height: carto.height,
      heading: Cesium.Math.toDegrees(this.viewer.camera.heading)
    };
    this.options.onCameraChange?.({ ...this.cameraInfo });

    // 超过 1500 km 视为"地球视图"，打开大气边缘光；回到近处再关掉
    const far = carto.height > 1500000;
    if (this.globeFar !== far) {
      this.globeFar = far;
      this.viewer.scene.globe.showGroundAtmosphere = far;
      this.viewer.scene.requestRender();
    }

    this.scheduleGlobeLevel(carto.height);
  };

  private globeFar = false;
  private levelTimer: number | null = null;
  private leveling = false;

  /**
   * 极远距离下把俯角逐步拉平到 -90°，让球体居中。
   * 用防抖等手势停下来再飞，避免和滚轮缩放抢相机。
   */
  private scheduleGlobeLevel(height: number): void {
    const viewer = this.viewer;
    if (!viewer || this.leveling || this.fpvId || viewer.trackedEntity) return;
    if (height < GLOBE_LEVEL_START) return;
    if (Cesium.Math.toDegrees(viewer.camera.pitch) <= -84) return;

    if (this.levelTimer !== null) window.clearTimeout(this.levelTimer);
    this.levelTimer = window.setTimeout(() => {
      this.levelTimer = null;
      this.levelGlobe();
    }, 200);
  }

  private levelGlobe(): void {
    const viewer = this.viewer;
    if (!viewer || this.leveling) return;

    const camera = viewer.camera;
    const height = camera.positionCartographic.height;
    if (height < GLOBE_LEVEL_START) return;

    const pitchDeg = Cesium.Math.toDegrees(camera.pitch);
    const t = Cesium.Math.clamp(
      (height - GLOBE_LEVEL_START) / (GLOBE_LEVEL_FULL - GLOBE_LEVEL_START),
      0,
      1
    );
    const nextPitchDeg = Cesium.Math.lerp(pitchDeg, -90, t);
    if (pitchDeg - nextPitchDeg < 0.4) return; // 已经够平，别反复起飞

    const anchor = this.screenCenterCarto() ?? Cesium.Cartographic.fromCartesian(camera.position);

    this.leveling = true;
    camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(anchor.longitude, anchor.latitude, height),
      orientation: { heading: camera.heading, pitch: Cesium.Math.toRadians(nextPitchDeg), roll: 0 },
      duration: 0.6,
      complete: () => {
        this.leveling = false;
        viewer.scene.requestRender();
      },
      cancel: () => {
        this.leveling = false;
      }
    });
  }

  /** 屏幕中心落在地球上的经纬度，用于拉平俯角时保持视野中心不跑偏。 */
  private screenCenterCarto(): Cesium.Cartographic | null {
    const viewer = this.viewer;
    if (!viewer) return null;
    const scene = viewer.scene;
    const center = new Cesium.Cartesian2(
      scene.canvas.clientWidth / 2,
      scene.canvas.clientHeight / 2
    );
    const ray = viewer.camera.getPickRay(center);
    const point = ray ? scene.globe.pick(ray, scene) : undefined;
    return point ? Cesium.Cartographic.fromCartesian(point) : null;
  }
  private routePick: ((point: [number, number]) => void) | null = null;
  private buildingPrimitive?: Cesium.Primitive;
  private routeEntities: Cesium.Entity[] = [];

  constructor(container: HTMLElement, options: SceneOptions = {}) {
    this.container = container;
    this.options = options;
  }

  async init(): Promise<void> {
    this.viewer = new Cesium.Viewer(this.container, {
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      vrButton: false,
      infoBox: false,
      selectionIndicator: false,
      skyBox: false,
      skyAtmosphere: false,
      shouldAnimate: false,
      msaaSamples: 4,
      requestRenderMode: true
    });

    const scene = this.viewer.scene;
    scene.backgroundColor = Cesium.Color.fromCssColorString(DARK);
    scene.globe.baseColor = Cesium.Color.fromCssColorString('#07111f');
    scene.globe.enableLighting = false;
    // 近处关闭大气雾化（避免压暗底图），拉到地球尺度时再打开，给地球一圈蓝色边缘光
    scene.globe.showGroundAtmosphere = false;
    scene.globe.depthTestAgainstTerrain = false;
    scene.fog.enabled = false;
    scene.screenSpaceCameraController.minimumZoomDistance = 2;
    scene.screenSpaceCameraController.maximumZoomDistance = 20000000;
    scene.screenSpaceCameraController.enableLook = false;
    scene.requestRenderMode = true;
    scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY;

    this.setBasemap('dark');
    this.airspaceLayer = new AirspaceLayer(this.viewer);
    this.drawer = new AirspaceDrawer(this.viewer, {
      onChange: (state) => this.options.onDrawChange?.(state),
      onFinish: (rings) => this.options.onDrawFinish?.(rings)
    });
    this.syncAirspaces(true);
    this.buildDrones();
    this.buildRoutes();
    this.buildFacilities();
    this.bindEvents();

    this.contextLostHandler = (event: Event) => {
      event.preventDefault();
      this.options.onContextLost?.();
    };
    this.viewer.scene.canvas.addEventListener(
      'webglcontextlost',
      this.contextLostHandler,
      false
    );

    this.resetView(false);
    this.viewer.resize();
    this.options.onCameraChange?.({ ...this.cameraInfo });
  }

  setBasemap(style: BasemapStyle): void {
    if (!this.viewer) return;
    const config = getBasemap(style);
    this.viewer.imageryLayers.removeAll();

    for (const layer of config.layers) {
      const provider = new Cesium.UrlTemplateImageryProvider({
        url: layer.url,
        subdomains: layer.subdomains,
        maximumLevel: config.maxLevel,
        tilingScheme: new Cesium.WebMercatorTilingScheme(),
        credit: layer.credit ? new Cesium.Credit(layer.credit) : undefined
      });
      const imageryLayer = this.viewer.imageryLayers.addImageryProvider(provider);
      if (layer.brightness !== undefined) imageryLayer.brightness = layer.brightness;
      if (layer.contrast !== undefined) imageryLayer.contrast = layer.contrast;
      if (layer.saturation !== undefined) imageryLayer.saturation = layer.saturation;
      if (layer.gamma !== undefined) imageryLayer.gamma = layer.gamma;
    }

    this.viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(config.globeColor);
    this.viewer.scene.backgroundColor = Cesium.Color.fromCssColorString(config.sceneColor);
    this.viewer.scene.requestRender();
  }

  setLayerVisible(key: LayerKey, visible: boolean): void {
    this.layers[key] = visible;
    if (!this.viewer) return;

    if (key === 'airspace') {
      this.airspaceLayer?.setVisible(visible);
    }

    if (key === 'routes') {
      for (const view of this.drones) view.route.show = visible;
    }

    if (key === 'drones') {
      for (const view of this.drones) {
        view.entity.show = visible;
        view.halo.show = visible && this.layers.alerts && view.alert;
      }
    }

    if (key === 'trails') {
      for (const view of this.drones) view.trail.show = visible;
    }

    if (key === 'alerts') {
      for (const view of this.drones) view.halo.show = visible && view.alert;
    }

    if (key === 'buildings' && this.buildingPrimitive) {
      this.buildingPrimitive.show = visible;
    }

    this.viewer.scene.requestRender();
  }

  /** 外部（如手绘/导入）改完空域后立即刷新，不依赖下一帧的 update */
  refreshAirspaces(): void {
    this.syncAirspaces(true);
    this.viewer?.scene.requestRender();
  }

  startAirspaceDraw(mode: DrawMode = 'polygon'): void {
    this.drawer?.start(mode);
  }

  setAirspaceDrawMode(mode: DrawMode): void {
    this.drawer?.setMode(mode);
  }

  setAirspaceDrawPan(on: boolean): void {
    this.drawer?.setPanMode(on);
  }

  cancelAirspaceDraw(): void {
    this.drawer?.stop();
  }

  undoAirspacePoint(): void {
    this.drawer?.undo();
  }

  closeAirspaceRing(): void {
    this.drawer?.closeRing();
  }

  finishAirspaceDraw(): void {
    this.drawer?.finishAll();
  }

  /** 空域数据变化时才重建实体，每帧只比一次版本号 */
  private syncAirspaces(force = false): void {    if (!this.airspaceLayer) return;
    const revision = airspaceRevision.value;
    if (!force && revision === this.airspaceSyncedRevision) return;
    this.airspaceSyncedRevision = revision;
    this.airspaceLayer.sync(airspaces.value);
    this.airspaceLayer.setSelection(
      this.selection?.kind === 'airspace' ? this.selection.id : null
    );
  }

  update(time: number, activeAlerts: AlertEvent[]): void {
    if (!this.viewer) return;

    this.syncAirspaces();

    // 估算播放倍速（模拟秒 / 真实秒），用于飞行定位时按目标速度做前置补偿
    const wall = performance.now();
    const dtWall = (wall - this.lastUpdateWall) / 1000;
    if (this.lastUpdateWall > 0 && dtWall > 0.03 && dtWall < 0.5) {
      const rate = (time - this.lastTime) / dtWall;
      if (rate >= 0 && rate < 12) this.simRate = rate;
    }
    this.lastUpdateWall = wall;
    this.lastTime = time;

    const nextDroneIds = new Set(activeAlerts.map((item) => item.droneId));
    const nextAirspaceIds = new Set(activeAlerts.map((item) => item.airspaceId));
    const nextLevels = new Map<string, 'critical' | 'warning'>();
    for (const alert of activeAlerts) {
      const current = nextLevels.get(alert.droneId);
      if (!current || alert.level === 'critical') nextLevels.set(alert.droneId, alert.level);
    }

    const alertKey = `${[...nextLevels.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, level]) => `${id}:${level}`)
      .join(',')}|${[...nextAirspaceIds].sort().join(',')}`;

    if (alertKey !== this.lastAlertKey) {
      this.lastAlertKey = alertKey;
      this.activeDroneIds = nextDroneIds;
      this.activeAirspaceIds = nextAirspaceIds;
      for (const view of this.drones) {
        view.alertLevel = nextLevels.get(view.drone.id) ?? null;
        view.alert = view.alertLevel !== null;
        this.applyDroneStyle(view);
      }
      this.airspaceLayer?.setAlerting(nextAirspaceIds);
    }

    const now = performance.now();
    const forceTrail = Math.abs(time - (this.lastTrailUpdateTime ?? time)) > 1.6;
    const refreshTrails = forceTrail || now - this.lastTrailUpdate > 260;

    for (const view of this.drones) {
      const pos = positionAt(view.drone, time);
      view.position = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt);
      view.heading = pos.heading;
      if (refreshTrails) this.updateTrail(view, time);
      this.applyDroneStyle(view);
    }

    if (refreshTrails) {
      this.lastTrailUpdate = now;
      this.lastTrailUpdateTime = time;
    }

    if (this.fpvId) {
      const view = this.drones.find((item) => item.drone.id === this.fpvId);
      if (view) this.applyFirstPersonCamera(view);
    }

    this.viewer.scene.requestRender();
  }

  select(selection: Selection, emit = false): void {
    this.selection = selection;

    for (const view of this.drones) {
      view.selected = selection?.kind === 'drone' && selection.id === view.drone.id;
      this.applyDroneStyle(view);
    }

    this.airspaceLayer?.setSelection(selection?.kind === 'airspace' ? selection.id : null);

    this.viewer?.scene.requestRender();
    if (emit) this.options.onSelect?.(selection);
  }

  focus(selection: Selection): void {
    if (!this.viewer || !selection) return;
    this.viewer.trackedEntity = undefined;

    if (selection.kind === 'drone') {
      const view = this.drones.find((item) => item.drone.id === selection.id);
      if (!view) return;
      // 预判镜头到位那一刻目标所在的位置，避免飞到一半目标已经跑开
      const pos = positionAt(view.drone, this.lastTime + 1.15 * this.simRate);
      const center = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt);
      // 以目标为中心取景：相机挂在目标北侧斜上方，朝目标俯视，目标始终落在画面中心
      this.viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, 40), {
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-30), 520),
        duration: 1.15
      });
      return;
    }

    const airspace = getAirspace(selection.id);
    if (!airspace || airspace.polygons.length === 0) return;
    // 多块空域按面积最大的那一块取景
    const ring = [...airspace.polygons].sort((a, b) => ringArea(b) - ringArea(a))[0];
    const center = ringCentroid(ring);
    const midAlt = (airspace.minAlt + airspace.maxAlt) / 2;
    // 半径取轮廓外接圆，太小的空域兜底 320m，太大的封顶 6km
    const extent = ringRadius(ring);
    const radius = Cesium.Math.clamp(Math.max(extent, airspace.maxAlt * 2), 320, 6000);
    const sphere = new Cesium.BoundingSphere(
      Cesium.Cartesian3.fromDegrees(center.lon, center.lat, midAlt),
      radius
    );
    this.viewer.camera.flyToBoundingSphere(sphere, {
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-38), radius * 2.6),
      duration: 1.15
    });
  }

  follow(selection: Selection): boolean {
    if (!this.viewer) return false;
    if (!selection || selection.kind !== 'drone') {
      this.viewer.trackedEntity = undefined;
      return false;
    }
    const view = this.drones.find((item) => item.drone.id === selection.id);
    if (!view) return false;
    this.followOffset = new Cesium.Cartesian3(0, -2600, 1600);
    view.entity.viewFrom = Cesium.Cartesian3.clone(this.followOffset);
    this.viewer.trackedEntity = view.entity;
    return true;
  }

  stopFollow(): void {
    if (this.viewer) this.viewer.trackedEntity = undefined;
  }

  /**
   * 第一视角：相机吊在机尾后上方，沿航向朝前看，机体保持在画面下方。
   * 后续可在 applyFirstPersonCamera 里叠加云台角度、变焦与外挂传感器视场。
   */
  firstPerson(selection: Selection): boolean {
    if (!this.viewer || !selection || selection.kind !== 'drone') return false;
    const view = this.drones.find((item) => item.drone.id === selection.id);
    if (!view) return false;
    this.viewer.trackedEntity = undefined;
    if (this.fpvId) this.exitFirstPerson();
    this.fpvId = selection.id;
    if (view.entity.model) {
      view.entity.model.silhouetteColor = new Cesium.ConstantProperty(
        Cesium.Color.fromCssColorString('#08131f').withAlpha(0.5)
      );
      view.entity.model.silhouetteSize = new Cesium.ConstantProperty(1.4);
    }
    this.viewer.scene.screenSpaceCameraController.enableInputs = false;
    this.applyFirstPersonCamera(view);
    this.viewer.scene.requestRender();
    return true;
  }

  exitFirstPerson(): void {
    if (!this.fpvId) return;
    const view = this.drones.find((item) => item.drone.id === this.fpvId);
    if (view?.entity.model) {
      view.entity.model.show = new Cesium.ConstantProperty(true);
      view.entity.model.silhouetteColor = new Cesium.ConstantProperty(Cesium.Color.TRANSPARENT);
      view.entity.model.silhouetteSize = new Cesium.ConstantProperty(0.01);
    }
    this.fpvId = null;
    if (this.viewer) {
      this.viewer.scene.screenSpaceCameraController.enableInputs = true;
      this.viewer.scene.requestRender();
    }
  }

  isFirstPerson(): string | null {
    return this.fpvId;
  }

  private applyFirstPersonCamera(view: DroneView): void {
    if (!this.viewer) return;
    const frame = Cesium.Transforms.eastNorthUpToFixedFrame(view.position);
    const heading = Cesium.Math.toRadians(view.heading);
    const forwardX = Math.sin(heading);
    const forwardY = Math.cos(heading);

    // 机尾后上方 9 m / 2.3 m，俯角 8.5°，机体落在画面下方三分之一处
    const eyeLocal = new Cesium.Cartesian3(forwardX * -9, forwardY * -9, 2.3);
    const eye = Cesium.Matrix4.multiplyByPoint(frame, eyeLocal, new Cesium.Cartesian3());

    const directionLocal = new Cesium.Cartesian3(
      forwardX,
      forwardY,
      Math.tan(Cesium.Math.toRadians(-8.5))
    );
    Cesium.Cartesian3.normalize(directionLocal, directionLocal);
    const direction = Cesium.Matrix4.multiplyByPointAsVector(
      frame,
      directionLocal,
      new Cesium.Cartesian3()
    );
    Cesium.Cartesian3.normalize(direction, direction);

    const up = Cesium.Matrix4.multiplyByPointAsVector(
      frame,
      Cesium.Cartesian3.UNIT_Z,
      new Cesium.Cartesian3()
    );
    Cesium.Cartesian3.normalize(up, up);

    this.viewer.camera.setView({ destination: eye, orientation: { direction, up } });
  }

  private focus2D(): void {
    if (!this.viewer) return;
    this.viewer.scene.mode = Cesium.SceneMode.SCENE2D;
    this.viewer.camera.setView({
      destination: Cesium.Rectangle.fromDegrees(113.845, 22.475, 113.995, 22.595)
    });
  }

  setMode(mode: '2d' | '3d'): void {
    if (!this.viewer) return;
    this.exitFirstPerson();
    if (mode === '2d') {
      this.focus2D();
      return;
    }
    this.viewer.scene.mode = Cesium.SceneMode.SCENE3D;
    this.resetView();
  }

  /** 加载建筑轮廓并按高度挤出（单个 Primitive 批量绘制，避免上千个 Entity） */
  async loadBuildings(url = `${import.meta.env.BASE_URL}data/buildings.geojson`): Promise<number> {
    if (!this.viewer) return 0;
    try {
      const response = await fetch(url);
      if (!response.ok) return 0;
      const data = (await response.json()) as {
        features: Array<{ properties: { h?: number; mh?: number }; geometry: { coordinates: number[][][] } }>;
      };
      if (!Array.isArray(data.features) || !data.features.length) return 0;

      const instances: Cesium.GeometryInstance[] = [];
      for (const feature of data.features) {
        const ring = feature.geometry?.coordinates?.[0];
        if (!ring || ring.length < 4) continue;
        const flat: number[] = [];
        for (const point of ring) {
          flat.push(point[0], point[1]);
        }
        const h = Math.max(3, Number(feature.properties?.h ?? 8));
        const mh = Math.max(0, Math.min(h - 1, Number(feature.properties?.mh ?? 0)));
        instances.push(
          new Cesium.GeometryInstance({
            geometry: new Cesium.PolygonGeometry({
              polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat)),
              height: mh,
              extrudedHeight: h,
              vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT
            }),
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(buildingColor(h))
            }
          })
        );
      }
      if (!instances.length) return 0;

      this.buildingPrimitive = this.viewer.scene.primitives.add(
        new Cesium.Primitive({
          geometryInstances: instances,
          appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, closed: true }),
          asynchronous: true
        })
      ) as Cesium.Primitive;
      this.buildingPrimitive.show = this.layers.buildings;
      this.viewer.scene.requestRender();
      return instances.length;
    } catch {
      return 0;
    }
  }

  /** 进入路径选点：下一次左键单击返回地表经纬度 */
  pickPoint(): Promise<[number, number] | null> {
    if (!this.viewer) return Promise.resolve(null);
    this.routePick = null;
    this.viewer.scene.canvas.style.cursor = 'crosshair';
    return new Promise((resolve) => {
      this.routePick = (point) => resolve(point);
    });
  }

  cancelPick(): void {
    this.routePick = null;
    if (this.viewer) this.viewer.scene.canvas.style.cursor = 'default';
  }

  /** 起终点标记（A / B） */
  setRouteMarkers(from: [number, number] | null, to: [number, number] | null): void {
    if (!this.viewer) return;
    for (const entity of this.routeEntities.filter((e) => e.id === 'route:from' || e.id === 'route:to')) {
      this.viewer.entities.remove(entity);
    }
    this.routeEntities = this.routeEntities.filter((e) => e.id !== 'route:from' && e.id !== 'route:to');

    const add = (id: string, point: [number, number], color: string, label: string) => {
      const entity = this.viewer!.entities.add({
        id,
        position: Cesium.Cartesian3.fromDegrees(point[0], point[1], 6),
        point: {
          pixelSize: 13,
          color: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: label,
          font: '600 12px Inter, system-ui, sans-serif',
          fillColor: Cesium.Color.WHITE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString(color).withAlpha(0.92),
          backgroundPadding: new Cesium.Cartesian2(7, 4),
          pixelOffset: new Cesium.Cartesian2(0, -20),
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });
      this.routeEntities.push(entity);
    };

    if (from) add('route:from', from, '#35C28B', '起点');
    if (to) add('route:to', to, '#F0553F', '终点');
    this.viewer.scene.requestRender();
  }

  /** 绘制规划结果：主航线 + 光晕 + 落地垂线 */
  showRoute(path: [number, number][], alt: number): void {
    if (!this.viewer || path.length < 2) return;
    this.clearRouteLine();

    const positions = path.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat, alt));

    const glow = this.viewer.entities.add({
      id: 'route:glow',
      polyline: {
        positions,
        width: 9,
        material: Cesium.Color.fromCssColorString('#35E0FF').withAlpha(0.18),
        clampToGround: false
      }
    });

    const line = this.viewer.entities.add({
      id: 'route:line',
      polyline: {
        positions,
        width: 3.2,
        material: new Cesium.PolylineOutlineMaterialProperty({
          color: Cesium.Color.fromCssColorString('#35E0FF'),
          outlineColor: Cesium.Color.fromCssColorString('#05202b'),
          outlineWidth: 1.4
        }),
        clampToGround: false
      }
    });

    const drops: Cesium.Entity[] = [];
    for (const [index, [lon, lat]] of path.entries()) {
      if (index !== 0 && index !== path.length - 1) continue;
      drops.push(
        this.viewer.entities.add({
          id: `route:drop:${index}`,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArrayHeights([lon, lat, 0, lon, lat, alt]),
            width: 1.4,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString('#35E0FF').withAlpha(0.55),
              dashLength: 10
            }),
            clampToGround: false
          }
        })
      );
    }

    this.routeEntities.push(glow, line, ...drops);
    this.viewer.scene.requestRender();
  }

  clearRouteLine(): void {
    if (!this.viewer) return;
    for (const entity of this.routeEntities) {
      if (entity.id === 'route:from' || entity.id === 'route:to') continue;
      this.viewer.entities.remove(entity);
    }
    this.routeEntities = this.routeEntities.filter((e) => e.id === 'route:from' || e.id === 'route:to');
    this.viewer.scene.requestRender();
  }

  clearRoute(): void {
    if (!this.viewer) return;
    for (const entity of this.routeEntities) this.viewer.entities.remove(entity);
    this.routeEntities = [];
    this.cancelPick();
    this.viewer.scene.requestRender();
  }

  zoomBy(ratio: number): void {
    if (!this.viewer) return;

    if (this.fpvId) {
      const frustum = this.viewer.camera.frustum;
      if (frustum instanceof Cesium.PerspectiveFrustum) {
        const current = frustum.fov ?? Cesium.Math.toRadians(60);
        frustum.fov = Cesium.Math.clamp(
          current * ratio,
          Cesium.Math.toRadians(18),
          Cesium.Math.toRadians(70)
        );
      }
      this.viewer.scene.requestRender();
      return;
    }

    if (this.viewer.trackedEntity) {
      const length = Cesium.Cartesian3.magnitude(this.followOffset);
      const target = Cesium.Math.clamp(length * ratio, 8, 6000);
      Cesium.Cartesian3.multiplyByScalar(this.followOffset, target / length, this.followOffset);
      const tracked = this.viewer.trackedEntity;
      tracked.viewFrom = Cesium.Cartesian3.clone(this.followOffset);
      this.viewer.trackedEntity = undefined;
      this.viewer.trackedEntity = tracked;
      this.viewer.scene.requestRender();
      return;
    }

    const camera = this.viewer.camera;
    const height = camera.positionCartographic.height;
    const target = Cesium.Math.clamp(height * ratio, 2, 20000000);

    // 地球视图下同时把俯角拉平，否则球体会停在画面下方
    if (target > GLOBE_LEVEL_START) {
      const t = Cesium.Math.clamp(
        (target - GLOBE_LEVEL_START) / (GLOBE_LEVEL_FULL - GLOBE_LEVEL_START),
        0,
        1
      );
      const pitch = Cesium.Math.toRadians(
        Cesium.Math.lerp(Cesium.Math.toDegrees(camera.pitch), -90, t)
      );
      const anchor =
        this.screenCenterCarto() ?? Cesium.Cartographic.fromCartesian(camera.position);
      camera.setView({
        destination: Cesium.Cartesian3.fromRadians(anchor.longitude, anchor.latitude, target),
        orientation: { heading: camera.heading, pitch, roll: 0 }
      });
      if (this.levelTimer !== null) {
        window.clearTimeout(this.levelTimer);
        this.levelTimer = null;
      }
      this.viewer.scene.requestRender();
      return;
    }

    camera.zoomIn(height - target);
    this.viewer.scene.requestRender();
  }

  project(lon: number, lat: number, alt: number): { x: number; y: number } | null {
    if (!this.viewer) return null;
    const transforms = Cesium.SceneTransforms as unknown as {
      worldToWindowCoordinates?: (
        scene: Cesium.Scene,
        position: Cesium.Cartesian3
      ) => Cesium.Cartesian2 | undefined;
      wgs84ToWindowCoordinates?: (
        scene: Cesium.Scene,
        position: Cesium.Cartesian3
      ) => Cesium.Cartesian2 | undefined;
    };
    const convert = transforms.worldToWindowCoordinates ?? transforms.wgs84ToWindowCoordinates;
    if (!convert) return null;
    const point = convert(this.viewer.scene, Cesium.Cartesian3.fromDegrees(lon, lat, alt));
    if (!point) return null;
    return { x: point.x, y: point.y };
  }

  resetView(animate = true): void {
    if (!this.viewer) return;
    this.exitFirstPerson();
    this.viewer.trackedEntity = undefined;

    if (this.viewer.scene.mode === Cesium.SceneMode.SCENE2D) {
      this.viewer.camera.setView({
        destination: Cesium.Rectangle.fromDegrees(113.84, 22.46, 114.01, 22.60)
      });
      this.cameraInfo = {
        lon: CENTER.lon,
        lat: CENTER.lat,
        height: this.viewer.camera.positionCartographic.height,
        heading: 0
      };
      this.options.onCameraChange?.({ ...this.cameraInfo });
      return;
    }

    const destination = Cesium.Cartesian3.fromDegrees(CENTER.lon, CENTER.lat - 0.036, 8600);
    const orientation = {
      heading: 0,
      pitch: Cesium.Math.toRadians(-64),
      roll: 0
    };

    if (animate) {
      this.viewer.camera.flyTo({ destination, orientation, duration: 1.1 });
    } else {
      this.viewer.camera.setView({ destination, orientation });
    }

    this.cameraInfo = { lon: CENTER.lon, lat: CENTER.lat, height: 8600, heading: 0 };
    this.options.onCameraChange?.({ ...this.cameraInfo });
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.handleResize);
    if (this.levelTimer !== null) {
      window.clearTimeout(this.levelTimer);
      this.levelTimer = null;
    }
    this.handler?.destroy();
    this.airspaceLayer?.destroy();
    if (this.viewer && !this.viewer.isDestroyed()) {
      if (this.contextLostHandler) {
        this.viewer.scene.canvas.removeEventListener(
          'webglcontextlost',
          this.contextLostHandler
        );
      }
      this.viewer.camera.changed.removeEventListener(this.handleCameraChanged);
      this.viewer.destroy();
    }
    this.viewer = undefined;
  }

  private bindEvents(): void {
    if (!this.viewer) return;
    this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);

    this.handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      if (!this.viewer) return;
      // 路径选点优先：取地表经纬度后交给回调，不做选中
      if (this.routePick) {
        const ray = this.viewer.camera.getPickRay(movement.position);
        const cart = ray ? this.viewer.scene.globe.pick(ray, this.viewer.scene) : undefined;
        if (cart) {
          const carto = Cesium.Cartographic.fromCartesian(cart);
          const callback = this.routePick;
          this.routePick = null;
          this.viewer.scene.canvas.style.cursor = 'default';
          callback([
            Cesium.Math.toDegrees(carto.longitude),
            Cesium.Math.toDegrees(carto.latitude)
          ]);
        }
        return;
      }
      // 手绘模式下单击用于落点，不做拾取选中
      if (this.drawer?.isActive) return;
      const picked = this.viewer.scene.pick(movement.position);
      const rawId = this.extractId(picked);
      if (rawId) {
        const [kind, id] = rawId.split(':');
        if (kind === 'drone' && id) {
          this.select({ kind: 'drone', id }, true);
          return;
        }
        if (kind === 'route' && id) {
          this.select({ kind: 'drone', id }, true);
          return;
        }
        if (kind === 'airspace' && id) {
          this.select({ kind: 'airspace', id }, true);
          return;
        }
      }
      this.select(null, true);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    this.handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      if (!this.viewer) return;
      if (this.drawer?.isActive) return;
      const picked = this.viewer.scene.pick(movement.endPosition);
      this.viewer.scene.canvas.style.cursor = this.extractId(picked) ? 'pointer' : 'default';
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    this.viewer.camera.percentageChanged = 0.01;
    this.viewer.camera.changed.addEventListener(this.handleCameraChanged);
    window.addEventListener('resize', this.handleResize);

    this.resizeObserver = new ResizeObserver(() => this.viewer?.resize());
    this.resizeObserver.observe(this.container);
  }

  private extractId(picked: unknown): string | null {
    if (!Cesium.defined(picked)) return null;
    const candidate = (picked as { id?: unknown }).id;
    if (!candidate) return null;
    if (typeof candidate === 'string') return candidate;
    const entity = candidate as Cesium.Entity;
    return typeof entity.id === 'string' ? entity.id : null;
  }

  private buildRoutes(): void {
    if (!this.viewer) return;

    for (const drone of DRONES) {
      const color = Cesium.Color.fromCssColorString(drone.color);
      const route = this.viewer.entities.add({
        id: `route:${drone.id}`,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArrayHeights(
            drone.route.flatMap((point) => [point.lon, point.lat, point.alt])
          ),
          width: 1.2,
          material: new Cesium.PolylineDashMaterialProperty({
            color: color.withAlpha(0.26),
            dashLength: 11
          }),
          arcType: Cesium.ArcType.NONE
        }
      });
      const view = this.drones.find((item) => item.drone.id === drone.id);
      if (view) view.route = route;
    }
  }

  private buildDrones(): void {
    if (!this.viewer) return;

    for (const drone of DRONES) {
      const color = Cesium.Color.fromCssColorString(drone.color);
      const position = Cesium.Cartesian3.fromDegrees(drone.route[0].lon, drone.route[0].lat, drone.route[0].alt);
      const view = {
        drone,
        position,
        trailPositions: [] as Cesium.Cartesian3[],
        heading: 0,
        selected: false,
        alert: false,
        alertLevel: null,
        visualKey: '',
        entity: undefined as unknown as Cesium.Entity,
        halo: undefined as unknown as Cesium.Entity,
        trail: undefined as unknown as Cesium.Entity,
        route: undefined as unknown as Cesium.Entity
      } satisfies DroneView;

      view.entity = this.viewer.entities.add({
        id: `drone:${drone.id}`,
        position: new Cesium.CallbackPositionProperty(() => view.position, false),
        orientation: new Cesium.CallbackProperty(
          () =>
            Cesium.Transforms.headingPitchRollQuaternion(
              view.position,
              new Cesium.HeadingPitchRoll(
                Cesium.Math.toRadians(view.heading) + MODEL_HEADING_OFFSET,
                0,
                0
              )
            ),
          false
        ),
        model: {
          uri: `${import.meta.env.BASE_URL}models/uav.glb`,
          scale: new Cesium.CallbackProperty(() => (view.selected ? 0.12 : 0.1), false),
          minimumPixelSize: 44,
          maximumScale: 400,
          heightReference: Cesium.HeightReference.NONE
        },
        label: {
          text: drone.callsign,
          font: '600 10px "Inter", "Microsoft YaHei", "PingFang SC", sans-serif',
          fillColor: Cesium.Color.fromCssColorString('#1F2937'),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 0,
          style: Cesium.LabelStyle.FILL,
          showBackground: true,
          backgroundColor: Cesium.Color.WHITE.withAlpha(0.9),
          backgroundPadding: new Cesium.Cartesian2(5, 2),
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -22),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 14000)
        }
      });

      view.halo = this.viewer.entities.add({
        position: new Cesium.CallbackPositionProperty(() => view.position, false),
        billboard: {
          image: alertHaloIcon(),
          width: 76,
          height: 76,
          color: Cesium.Color.WHITE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scale: new Cesium.CallbackProperty(
            () => 1 + Math.sin(performance.now() / 260) * 0.08,
            false
          )
        },
        show: false
      });

      view.trail = this.viewer.entities.add({
        polyline: {
          positions: new Cesium.CallbackProperty(() => view.trailPositions, false),
          width: 2.2,
          material: new Cesium.PolylineGlowMaterialProperty({
            color: color.withAlpha(0.42),
            glowPower: 0.15,
            taperPower: 0.55
          }),
          arcType: Cesium.ArcType.NONE
        }
      });

      this.drones.push(view);
    }
  }

  private buildFacilities(): void {
    if (!this.viewer) return;

    const center = Cesium.Cartesian3.fromDegrees(CENTER.lon, CENTER.lat, 3);
    const centerRing = this.viewer.entities.add({
      position: center,
      ellipse: {
        semiMajorAxis: 320,
        semiMinorAxis: 320,
        material: Cesium.Color.fromCssColorString('#4F7DF3').withAlpha(0.05),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#4F7DF3').withAlpha(0.32),
        height: 2
      }
    });

    const centerMark = this.viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(CENTER.lon, CENTER.lat, 24),
      billboard: {
        image: commandIcon(),
        width: 42,
        height: 42,
        disableDepthTestDistance: Number.POSITIVE_INFINITY
      }
    });

    const vertiports = [
      { lon: 113.900, lat: 22.520 },
      { lon: 113.960, lat: 22.545 },
      { lon: 113.925, lat: 22.558 }
    ];

    const portEntities = vertiports.map((port) =>
      this.viewer!.entities.add({
        position: Cesium.Cartesian3.fromDegrees(port.lon, port.lat, 28),
        billboard: {
          image: helipadIcon(),
          width: 26,
          height: 26,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      })
    );

    this.facilities.push(centerRing, centerMark, ...portEntities);
  }

  private applyDroneStyle(view: DroneView): void {
    const key = `${view.selected}|${view.alertLevel ?? 'none'}`;
    if (view.visualKey === key) return;
    view.visualKey = key;

    const color = Cesium.Color.fromCssColorString(view.drone.color);
    const red = Cesium.Color.fromCssColorString('#E5484D');
    const amber = Cesium.Color.fromCssColorString('#E49A2F');
    const labelColor = view.alert
      ? Cesium.Color.fromCssColorString('#B91C1C')
      : view.selected
        ? Cesium.Color.fromCssColorString('#0F172A')
        : Cesium.Color.fromCssColorString('#334155');
    const alertColor = view.alertLevel === 'critical' ? red : amber;

    if (view.entity.label) {
      view.entity.label.show = new Cesium.ConstantProperty(view.selected);
      view.entity.label.text = new Cesium.ConstantProperty(
        view.alert ? `${view.drone.callsign} · 告警` : view.drone.callsign
      );
      view.entity.label.fillColor = new Cesium.ConstantProperty(labelColor);
      view.entity.label.backgroundColor = new Cesium.ConstantProperty(
        Cesium.Color.WHITE.withAlpha(view.alert ? 0.96 : view.selected ? 0.96 : 0.9)
      );
    }

    view.halo.show = view.alert && this.layers.alerts;
    if (view.halo.billboard) {
      view.halo.billboard.image = new Cesium.ConstantProperty(
        alertHaloIcon(view.alertLevel === 'critical' ? '#E5484D' : '#E49A2F')
      );
    }
    if (view.trail.polyline) {
      view.trail.polyline.material = new Cesium.PolylineGlowMaterialProperty({
        color: (view.alert ? alertColor : color).withAlpha(view.alert ? 0.72 : 0.42),
        glowPower: 0.16,
        taperPower: 0.55
      });
    }
  }

  private updateTrail(view: DroneView, time: number): void {
    const points: Cesium.Cartesian3[] = [];
    const count = view.alert ? 26 : 20;
    for (let i = 0; i < count; i += 1) {
      const pos = positionAt(view.drone, time - i * 2.8);
      points.push(Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt));
    }
    view.trailPositions = points;
  }
}

function svgData(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function alertHaloIcon(color = '#E5484D'): string {
  return svgData(`
    <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
      <defs>
        <filter id="g" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="5" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <circle cx="60" cy="60" r="47" fill="none" stroke="${color}" stroke-width="2" stroke-opacity=".85" filter="url(#g)"/>
      <circle cx="60" cy="60" r="36" fill="none" stroke="${color}" stroke-width="1" stroke-opacity=".55" stroke-dasharray="5 7"/>
    </svg>
  `);
}

function commandIcon(): string {
  return svgData(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <defs>
        <filter id="g" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.4" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <path d="M32 6 L54 19 L54 45 L32 58 L10 45 L10 19 Z" fill="#FFFFFF" stroke="#4F7DF3" stroke-width="2" filter="url(#g)"/>
      <circle cx="32" cy="32" r="11" fill="none" stroke="#4F7DF3" stroke-width="1.5"/>
      <path d="M32 17 V23 M32 41 V47 M17 32 H23 M41 32 H47" stroke="#4F7DF3" stroke-width="1.5"/>
      <circle cx="32" cy="32" r="2.4" fill="#ffffff"/>
    </svg>
  `);
}

function buildingColor(height: number): Cesium.Color {
  const t = Math.min(1, Math.max(0, (height - 6) / 90));
  const low = Cesium.Color.fromCssColorString('#223043');
  const high = Cesium.Color.fromCssColorString('#53708f');
  const mixed = Cesium.Color.lerp(low, high, t, new Cesium.Color());
  return mixed.withAlpha(0.97);
}

function helipadIcon(): string {
  return svgData(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="22" fill="#FFFFFF" fill-opacity=".94" stroke="#4F7DF3" stroke-opacity=".8" stroke-width="2"/>
      <path d="M23 21 V43 M41 21 V43 M23 32 H41" stroke="#4F7DF3" stroke-width="4" stroke-linecap="round"/>
    </svg>
  `);
}
