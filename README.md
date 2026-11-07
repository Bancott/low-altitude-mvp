# 低空天穹 · 低空空域管控动态电子地图 MVP

面向本科课程设计/毕业设计的可运行 MVP：用 **Vue 3 + CesiumJS** 展示低空空域、模拟航空器、越界告警和时间回放。

界面采用“全屏地图 + 悬浮控件”的结构，视觉语言参考 Windy：顶部左侧搜索、中央品牌、右侧时钟与主题；左栏为可收起的态势面板（空域 / 目标 / 告警）；右侧竖向图层柱控制空域、航线、目标、尾迹、告警五类图层，并可展开底图抽屉；底部为播放与时间轴；右下为缩放、2D/3D、复位、全屏与底图快切。空域名称不常驻地图，统一放在侧栏和详情卡里，避免标签压住地图。

系统图标为 `EQ.svg`（低空飞行箭头），品牌区每 9 秒重播一次“线条生长 + 填充浮现”的动效，同时作为浏览器 favicon。

![浅色主题](docs/preview-light.png)

> 架构说明、文件职责和学习路线见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 当前已实现

- Cesium 三维地球、2D/3D 切换、相机复位、全屏
- 滚轮缩放、拖拽平移、倾斜视角
- 4 个空域体：管制空域、适飞空域、临时禁飞区、临时限制区
- 10 架模拟无人机：物流、巡检、安防、应急四类任务
- 空域侵入、超出限高两类规则告警
- 左侧栏三个页签：空域 / 目标 / 告警
- 点击空域或目标，右侧出现浮动详情卡
- 空域名称不常驻地图；只有选中目标才显示目标标签
- 右侧图层柱：空域、航线、目标、尾迹、告警统一开关，带状态珠与标签
- 底图抽屉：暗色 / 浅色 / 卫星，卡片预览 + 当前项标记
- 浅色 / 深色 / 跟随系统主题，自动切换 Cesium 底图
- 动效：按压挤压、列表交错入场、页签滑块形变、告警故障闪、指针视差、环境粒子、面板遮罩展开
- 侧栏可收起，地图占满工作区
- 时间轴播放/暂停/倍速/拖动，使用原生 `range` 控件
- 搜索目标或空域，定位/跟随目标
- “底图设计规范”面板：色彩系统、图层层级、Maputnik 接入说明、3D 建筑预留
- 响应式布局，适配 1600×900、1366×768 及常见宽屏

## 设计原则

1. **地图优先**：不再用左右两块大面板夹住地图。
2. **一个侧栏**：空域、目标、告警放在同一个侧栏的三个页签里。
3. **详情按需出现**：只有选中对象时才出现详情卡，避免默认堆信息。
4. **地图少标签**：空域名称放在列表和详情卡；只有选中目标才显示目标标签。
5. **一个强调色**：蓝色作为唯一主强调色，红/黄只用于告警。
6. **原生控件**：滚动条、时间轴滑块使用浏览器原生样式。

## 技术栈

| 层 | 选型 |
|---|---|
| 前端框架 | Vue 3 + TypeScript + Vite |
| 三维地图 | CesiumJS |
| 状态 | Vue Composition API（MVP 阶段不引入 Pinia） |
| 主题 | CSS 变量 + `useTheme.ts` + `prefers-color-scheme` |
| 图标 | 手写 SVG 图标组件 |
| 数据 | 前端模拟数据 + 运动学插值 |
| 底图 | Esri 公共底图服务（演示用） |
| 构建 | Vite |

## 运行

要求 Node.js 22+。

```bash
cd low-altitude-mvp
npm install
npm run dev
```

打开：

```text
http://localhost:5173
```

其他命令：

```bash
npm run typecheck   # TypeScript 类型检查
npm run build       # 生产构建
npm run preview     # 预览构建结果
```

`npm install` 会把 Cesium 的 `Assets`、`Workers`、`Widgets`、`ThirdParty` 复制到 `public/cesium/`，无需手动处理。

### 底图配置

底图已抽到 `src/config/basemaps.ts`，默认回退 Esri。配置天地图 key 后自动切换：

```bash
cp .env.example .env.local   # 写入 VITE_TIANDITU_KEY=你的key
```

key 在 [天地图控制台](https://console.tianditu.gov.cn/) 申请（应用类型选「浏览器端」）。改完需重启 dev server。后续接 Maputnik 自制底图时，只需在 `basemaps.ts` 里把对应图层的 `url` 换成本地 TileServer GL 的地址，场景代码不用动。

## 界面预览

### 浅色主题

![浅色主题](docs/preview-light.png)

### 深色主题

![深色主题](docs/preview-dark.png)

### 空域详情

![空域详情](docs/preview-detail.png)

### 图层弹层

![图层弹层](docs/preview-layers.png)

### 底图设计规范

![底图设计](docs/preview-design.png)

## 交互说明

| 操作 | 效果 |
|---|---|
| 左侧“空域 / 目标 / 告警” | 切换侧栏列表 |
| 点击空域/目标 | 地图定位，右侧出现详情卡 |
| 详情卡右上角 × | 关闭详情卡 |
| 顶栏太阳/月亮/显示器 | 浅色 / 深色 / 跟随系统 |
| 顶栏右侧布局按钮 | 收起 / 展开侧栏 |
| 右侧图层柱 | 开关空域、航线、目标、尾迹、告警 |
| 右侧「底图」 | 打开底图抽屉，切换底图、进入底图设计 |
| 右下角 + / − | 缩放地图 |
| 右下角 3D / 2D | 切换三维态势 / 二维总览 |
| 鼠标滚轮 / 拖拽 | 缩放 / 平移地图（2 m – 20,000 km，可一直拉到地球视图） |
| 点击告警 | 时间跳转到告警窗口，定位目标 |
| 拖动时间轴 | 暂停模拟并回放该时刻 |
| `1× / 2× / 4×` | 调整模拟速度 |
| 底部时钟按钮 | 回到场景起点 |
| 搜索框输入 `UAV-001` 或空域名 | 定位目标/空域 |
| 详情卡“跟随” | 相机跟随目标 |
| 详情卡“第一视角” | 进入机头视角（Esc 退出），`+ / −` 调整视场角 |
| 空域页签顶部“手绘新增” | 自动切到二维；支持自由多边形（双击/右键闭合）、矩形（两点）、圆形（圆心+圆周），可连续画多块；完成后填名称/类型/高度 |
| 空域页签顶部“导入 GeoJSON” | 选择 `.geojson/.json`，支持 FeatureCollection / Feature / Polygon / MultiPolygon，自动读取 `kind`、`minAlt/maxAlt`（或 `height`）等属性，导入后可删除 |
| 空域页签“最短路径规划” | 地图点选起点与终点，设定高度后按二维 A* 规划，结果给出距离、预计耗时与绕开的限制区 |
| 详情卡“删除空域” | 删除手绘或导入的空域（内置示例不可删） |
| 右侧“建筑体块” | 开关 3D 建筑（约 3600 栋，来自本地 OSM 切片） |

## 目录结构

```text
low-altitude-mvp/
├─ ARCHITECTURE.md                  # 架构、文件职责、学习路线
├─ src/
│  ├─ App.vue                      # 顶栏、侧栏、详情卡、时间轴、交互
│  ├─ cesium/
│  │  ├─ LowAltitudeScene.ts       # Cesium 场景、目标、告警、路径、建筑
│  │  ├─ AirspaceLayer.ts          # 空域实体增删改（按 id diff）
│  │  └─ AirspaceDrawer.ts         # 二维手绘（自由/矩形/圆形）
│  ├─ components/
│  │  └─ Icon.vue                  # SVG 图标
│  ├─ composables/
│  │  └─ useTheme.ts               # 浅色 / 深色 / 跟随系统
│  ├─ data/
│  │  ├─ scenario.ts               # 内置空域、无人机、航线、常量
│  │  ├─ airspaceStore.ts          # 响应式空域数据层（增删改 + 版本号）
│  │  ├─ geometry.ts               # 点面判断、质心、面积等纯几何函数
│  │  ├─ geojsonImport.ts          # GeoJSON → 空域的解析与校验
│  │  ├─ pathPlan.ts               # 二维栅格 A* + 视线简化
│  │  └─ alerts.ts                 # 告警时间线（随空域变更重算）
│  ├─ styles.css                   # 设计令牌、明暗主题、组件样式
│  └─ main.ts
├─ public/
│  ├─ cesium/                      # Cesium 静态资源（安装时生成）
│  ├─ models/                      # 无人机 glTF
│  ├─ data/                        # buildings.geojson、示例空域
│  └─ favicon.svg
├─ scripts/
│  ├─ copy-cesium.mjs              # Cesium 资源复制脚本
│  └─ extract-buildings.mjs        # 从 mbtiles 提取建筑轮廓
├─ docs/                           # 预览截图
└─ index.html
```

## 数据和规则

- 空域、无人机航线、告警事件都在 `src/data/scenario.ts` 中维护；
- 无人机沿三维折线航线按速度循环飞行；
- 告警规则：
  - 进入临时禁飞区且高度在 0–300m：`NO_FLY_INTRUSION`
  - 在适飞空域内超过 120m：`ALTITUDE_DEVIATION`
  - 在临时限制区内超过 150m：`TEMP_RESTRICTION`
- 空域是可序列化的纯数据（`Airspace`），渲染层 `AirspaceLayer` 按 id 差异同步实体，因此手绘、导入、删除都会自动反映到地图与告警；
- 告警事件随空域版本号重算，时间轴色带同步更新；
- 路径规划只依赖 `Airspace[]`，不依赖 Cesium：格网 8 邻域 A*，斜向不允许贴角穿越，再用按 20 m 采样的视线简化拉直；
- 建筑轮廓来自本地 `shenzhen.mbtiles`（z16，OpenMapTiles `building` 图层），带 `render_height`，由 `scripts/extract-buildings.mjs` 导出为 GeoJSON，运行时用单个 Primitive 批量挤出；OSM 在国内的建筑面积覆盖并不完整，缺数据的片区会偏空；
- 初始时间会自动定位到第一个严重告警窗口。

## MVP 阶段的取舍

- **没有后端**：模拟器、规则判断、数据都在浏览器里完成，启动简单；
- **没有真实 ADS-B/Remote ID**：使用模拟遥测，适合答辩演示；
- **底图暂时用 Esri 公共瓦片**：演示方便，但正式项目应替换为 Maputnik + TileServer GL 或本地离线瓦片；
- **告警规则是简化版**：只做点面判断 + 高度区间，不包含 4D 预测、间隔碰撞等；
- **没有 3D 城市模型**：用 2.5D 空域体和示意设施表达低空结构。

## 下一步

1. **底图真正接入 Maputnik**：
   - OpenMapTiles/MapTiler 矢量瓦片
   - Maputnik 编辑 `style.json`
   - TileServer GL 栅格化为 `/styles/{id}/{z}/{x}/{y}.png`
   - Cesium `UrlTemplateImageryProvider` 加载
2. **加一个轻量后端**：Node/Express + `ws` + SQLite，把模拟器和告警判定移到服务端；
3. **完善空域管理**：GeoJSON 导入、绘制、编辑、生效时间；
4. **增强回放**：轨迹分片加载、告警事件时间轴联动；
5. **3D Tiles 建筑模型**：重点区域白模/倾斜摄影 + `Cesium3DTileset` + 建筑高度分级/风格化；
6. **无人机 glTF 模型**：把 Billboard 替换为实际模型，并处理朝向、缩放和告警高亮。

## 底图版权

演示底图来自 Esri World Dark Gray / Light Gray / World Imagery 服务，页面内保留版权标识。正式发布或离线部署时，请替换为已授权/已审核的底图数据，并遵守地图审核、测绘资质和版权要求。

## 素材版权

- 无人机模型 `public/models/uav.glb`：Sketchfab 作品《无人机(1)》，作者 fh51692305，许可 CC-BY-4.0。公开演示或提交报告时请保留署名。
- 图层图标（`src/assets/icons/*.svg`）：由项目提供，用于界面图层按钮。
