import * as Cesium from 'cesium';
import {
  AIRSPACES,
  DRONES,
  type Airspace,
  type AlertEvent,
  type Drone,
  airspaceCentroid,
  positionAt
} from '../data/scenario';

export type Selection = { kind: 'drone' | 'airspace'; id: string } | null;
export type BasemapStyle = 'dark' | 'light' | 'satellite';
export type LayerKey = 'airspace' | 'routes' | 'drones' | 'trails' | 'alerts';
export type CameraInfo = { lon: number; lat: number; height: number; heading: number };

interface SceneOptions {
  onSelect?: (selection: Selection) => void;
  onCameraChange?: (info: CameraInfo) => void;
}

interface AirspaceView {
  airspace: Airspace;
  volume: Cesium.Entity;
  top: Cesium.Entity;
  bottom: Cesium.Entity;
  verticals: Cesium.Entity[];
  alert: boolean;
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

export class LowAltitudeScene {
  private readonly container: HTMLElement;
  private readonly options: SceneOptions;
  private viewer?: Cesium.Viewer;
  private handler?: Cesium.ScreenSpaceEventHandler;
  private resizeObserver?: ResizeObserver;
  private airspaces: AirspaceView[] = [];
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
    alerts: true
  };
  private lastTime = 0;
  private lastTrailUpdate = 0;
  private lastTrailUpdateTime = 0;
  private lastCameraNotify = 0;
  private lastAlertKey = '';
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
  };

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
      requestRenderMode: true
    });

    const scene = this.viewer.scene;
    scene.backgroundColor = Cesium.Color.fromCssColorString(DARK);
    scene.globe.baseColor = Cesium.Color.fromCssColorString('#07111f');
    scene.globe.enableLighting = false;
    scene.globe.showGroundAtmosphere = false;
    scene.globe.depthTestAgainstTerrain = false;
    scene.fog.enabled = false;
    scene.screenSpaceCameraController.minimumZoomDistance = 900;
    scene.screenSpaceCameraController.maximumZoomDistance = 26000;
    scene.screenSpaceCameraController.enableLook = false;
    scene.requestRenderMode = true;
    scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY;

    this.setBasemap('dark');
    this.buildAirspaces();
    this.buildDrones();
    this.buildRoutes();
    this.buildFacilities();
    this.bindEvents();
    this.resetView(false);
    this.viewer.resize();
    this.options.onCameraChange?.({ ...this.cameraInfo });
  }

  setBasemap(style: BasemapStyle): void {
    if (!this.viewer) return;
    this.viewer.imageryLayers.removeAll();

    const darkBase =
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
    const darkLabels =
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}';
    const lightBase =
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
    const lightLabels =
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}';
    const satellite =
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

    const layers =
      style === 'light'
        ? [
            { url: lightBase, credit: 'Esri · HERE · Garmin · OpenStreetMap contributors' },
            { url: lightLabels, credit: '' }
          ]
        : style === 'satellite'
          ? [{ url: satellite, credit: 'Esri · Maxar · Earthstar Geographics' }]
          : [
              { url: darkBase, credit: 'Esri · HERE · Garmin · OpenStreetMap contributors' },
              { url: darkLabels, credit: '' }
            ];

    for (const layer of layers) {
      const provider = new Cesium.UrlTemplateImageryProvider({
        url: layer.url,
        maximumLevel: 19,
        tilingScheme: new Cesium.WebMercatorTilingScheme(),
        credit: layer.credit ? new Cesium.Credit(layer.credit) : undefined
      });
      const imageryLayer = this.viewer.imageryLayers.addImageryProvider(provider);
      if (style === 'dark') {
        imageryLayer.brightness = 0.78;
        imageryLayer.contrast = 1.08;
        imageryLayer.saturation = 0.72;
        imageryLayer.gamma = 0.92;
      }
    }

    this.viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(
      style === 'light' ? '#c9d5e4' : '#07111f'
    );
    this.viewer.scene.backgroundColor = Cesium.Color.fromCssColorString(
      style === 'light' ? '#eef2f7' : DARK
    );
    this.viewer.scene.requestRender();
  }

  setLayerVisible(key: LayerKey, visible: boolean): void {
    this.layers[key] = visible;
    if (!this.viewer) return;

    if (key === 'airspace') {
      for (const view of this.airspaces) {
        view.volume.show = visible;
        view.top.show = visible;
        view.bottom.show = visible;
        view.verticals.forEach((item) => (item.show = visible));
      }
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

    this.viewer.scene.requestRender();
  }

  update(time: number, activeAlerts: AlertEvent[]): void {
    if (!this.viewer) return;
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
      for (const view of this.airspaces) {
        view.alert = nextAirspaceIds.has(view.airspace.id);
        this.applyAirspaceStyle(view);
      }
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

    this.viewer.scene.requestRender();
  }

  select(selection: Selection, emit = false): void {
    this.selection = selection;

    for (const view of this.drones) {
      view.selected = selection?.kind === 'drone' && selection.id === view.drone.id;
      this.applyDroneStyle(view);
    }

    for (const view of this.airspaces) {
      this.applyAirspaceStyle(view);
    }

    this.viewer?.scene.requestRender();
    if (emit) this.options.onSelect?.(selection);
  }

  focus(selection: Selection): void {
    if (!this.viewer || !selection) return;
    this.viewer.trackedEntity = undefined;

    if (selection.kind === 'drone') {
      const view = this.drones.find((item) => item.drone.id === selection.id);
      if (!view) return;
      const pos = positionAt(view.drone, this.lastTime);
      this.viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt + 1650),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-56),
          roll: 0
        },
        duration: 1.15
      });
      return;
    }

    const view = this.airspaces.find((item) => item.airspace.id === selection.id);
    if (!view) return;
    const center = airspaceCentroid(view.airspace);
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        center.lon,
        center.lat,
        Math.max(3300, view.airspace.maxAlt * 11)
      ),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-54),
        roll: 0
      },
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
    view.entity.viewFrom = new Cesium.Cartesian3(0, -2600, 1600);
    this.viewer.trackedEntity = view.entity;
    return true;
  }

  stopFollow(): void {
    if (this.viewer) this.viewer.trackedEntity = undefined;
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
    if (mode === '2d') {
      this.focus2D();
      return;
    }
    this.viewer.scene.mode = Cesium.SceneMode.SCENE3D;
    this.resetView();
  }

  resetView(animate = true): void {
    if (!this.viewer) return;
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
    this.handler?.destroy();
    this.viewer?.camera.changed.removeEventListener(this.handleCameraChanged);
    if (this.viewer && !this.viewer.isDestroyed()) this.viewer.destroy();
    this.viewer = undefined;
  }

  private bindEvents(): void {
    if (!this.viewer) return;
    this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);

    this.handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      if (!this.viewer) return;
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

  private buildAirspaces(): void {
    if (!this.viewer) return;

    for (const airspace of AIRSPACES) {
      const color = Cesium.Color.fromCssColorString(airspace.color);
      const ring = [...airspace.polygon, airspace.polygon[0]];
      const topPositions = Cesium.Cartesian3.fromDegreesArrayHeights(
        ring.flatMap(([lon, lat]) => [lon, lat, airspace.maxAlt + 1])
      );
      const bottomPositions = Cesium.Cartesian3.fromDegreesArrayHeights(
        ring.flatMap(([lon, lat]) => [lon, lat, airspace.minAlt + 1])
      );

      const volume = this.viewer.entities.add({
        id: `airspace:${airspace.id}`,
        name: airspace.name,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(
            Cesium.Cartesian3.fromDegreesArray(airspace.polygon.flat())
          ),
          height: airspace.minAlt,
          extrudedHeight: airspace.maxAlt,
          material: color.withAlpha(0.05),
          outline: false
        }
      });

      const top = this.viewer.entities.add({
        id: `airspace:${airspace.id}:top`,
        polyline: {
          positions: topPositions,
          width: 1.2,
          material: color.withAlpha(0.78),
          arcType: Cesium.ArcType.NONE
        }
      });

      const bottom = this.viewer.entities.add({
        id: `airspace:${airspace.id}:bottom`,
        polyline: {
          positions: bottomPositions,
          width: 0.8,
          material: color.withAlpha(0.16),
          arcType: Cesium.ArcType.NONE
        }
      });

      const verticals = airspace.polygon.map(([lon, lat], index) =>
        this.viewer!.entities.add({
          id: `airspace:${airspace.id}:edge:${index}`,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArrayHeights([
              lon,
              lat,
              airspace.minAlt,
              lon,
              lat,
              airspace.maxAlt
            ]),
            width: 0.8,
            material: color.withAlpha(0.12),
            arcType: Cesium.ArcType.NONE,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 18000)
          }
        })
      );

      this.airspaces.push({ airspace, volume, top, bottom, verticals, alert: false });
    }
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
        billboard: {
          image: droneIcon(drone.color, false),
          width: 34,
          height: 34,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          rotation: new Cesium.CallbackProperty(
            () => -Cesium.Math.toRadians(view.heading),
            false
          ),
          alignedAxis: Cesium.Cartesian3.ZERO,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scale: new Cesium.CallbackProperty(() => (view.selected ? 1.16 : 1), false)
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

    if (view.entity.billboard) {
      view.entity.billboard.image = new Cesium.ConstantProperty(
        droneIcon(view.drone.color, view.alert, view.alertLevel)
      );
      view.entity.billboard.width = new Cesium.ConstantProperty(view.alert ? 38 : 32);
      view.entity.billboard.height = new Cesium.ConstantProperty(view.alert ? 38 : 32);
    }

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

  private applyAirspaceStyle(view: AirspaceView): void {
    const color = Cesium.Color.fromCssColorString(view.airspace.color);
    const red = Cesium.Color.fromCssColorString('#E5484D');
    const selected =
      this.selection?.kind === 'airspace' && this.selection.id === view.airspace.id;
    const accent = view.alert ? red : color;
    const fillAlpha =
      view.airspace.kind === 'no-fly'
        ? selected
          ? 0.07
          : view.alert
            ? 0.05
            : 0.03
        : selected
          ? 0.07
          : 0.025;

    if (view.volume.polygon) {
      view.volume.polygon.material = new Cesium.ColorMaterialProperty(
        (view.alert ? red : color).withAlpha(fillAlpha)
      );
    }

    if (view.top.polyline) {
      view.top.polyline.material = new Cesium.ColorMaterialProperty(
        accent.withAlpha(selected ? 0.96 : 0.7)
      );
      view.top.polyline.width = new Cesium.ConstantProperty(selected || view.alert ? 1.5 : 1);
    }

    if (view.bottom.polyline) {
      view.bottom.polyline.material = new Cesium.ColorMaterialProperty(
        accent.withAlpha(selected ? 0.28 : 0.12)
      );
    }

    for (const vertical of view.verticals) {
      if (vertical.polyline) {
        vertical.polyline.material = new Cesium.ColorMaterialProperty(
          accent.withAlpha(selected ? 0.18 : 0.08)
        );
      }
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

function droneIcon(
  color: string,
  alert: boolean,
  level: 'critical' | 'warning' | null = null
): string {
  const main = alert ? (level === 'warning' ? '#E49A2F' : '#E5484D') : color;
  return svgData(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <defs>
        <filter id="g" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.6" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <circle cx="32" cy="32" r="20" fill="${main}" fill-opacity=".06" stroke="${main}" stroke-opacity=".3" stroke-width="1.2"/>
      <path d="M32 9 L46 47 L32 39.5 L18 47 Z" fill="${main}" filter="url(#g)"/>
      <path d="M32 17 L39 39 L32 35 L25 39 Z" fill="#ffffff" fill-opacity=".82"/>
      <circle cx="32" cy="32" r="2.4" fill="#ffffff"/>
    </svg>
  `);
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

function helipadIcon(): string {
  return svgData(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="22" fill="#FFFFFF" fill-opacity=".94" stroke="#4F7DF3" stroke-opacity=".8" stroke-width="2"/>
      <path d="M23 21 V43 M41 21 V43 M23 32 H41" stroke="#4F7DF3" stroke-width="4" stroke-linecap="round"/>
    </svg>
  `);
}
