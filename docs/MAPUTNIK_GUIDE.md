# 用 Maputnik 自定义底图并接入本项目

这份文档按“从零到能在 Cesium 里看到自定义底图”的顺序写。

先说结论：

```text
Maputnik 只负责编辑 style.json
TileServer GL 负责把矢量瓦片按 style.json 渲染成栅格瓦片
Cesium 负责加载栅格瓦片
```

Cesium **不能直接吃 Mapbox/MapLibre 的 `style.json`**。所以完整链路是：

```text
OpenMapTiles 矢量瓦片（.mbtiles）
        ↓
Maputnik 编辑 style.json
        ↓
TileServer GL 按样式渲染
        ↓
/styles/low-altitude-qianli/{z}/{x}/{y}.png
        ↓
Cesium UrlTemplateImageryProvider
        ↓
项目里的“自定义地图”
```

业务空域、无人机、航线仍然由 Cesium 绘制，不放进底图。这样空域可以继续点击、查询、编辑。

---

## 1. 准备环境

推荐用 Docker，Windows 上先安装 Docker Desktop。

目录建议：

```text
└─ maputnik/
   ├─ config.json
   ├─ docker-compose.yml
   ├─ data/
   │  └─ shenzhen.mbtiles
   ├─ fonts/
   │  └─ Noto Sans Regular/
   ├─ sprites/
   └─ styles/
      └─ low-altitude/
         └─ style.json
```

本项目的 `docs/maputnik/` 里已经放了三个示例：

- `config.example.json`
- `style.example.json`
- `docker-compose.yml`

把它们复制到 `maputnik/`，再改文件名：

```text
config.example.json  → config.json
style.example.json   → styles/qianli/style.json
```

---

## 2. 准备矢量瓦片

TileServer GL 需要一份矢量瓦片数据，常见格式是 `.mbtiles`。

可以选：

### 方案 A：MapTiler Data（最省事）

在 [MapTiler Data](https://data.maptiler.com/downloads/) 下载深圳范围的 **OpenMapTiles** MBTiles，放到：

```text
maputnik/data/shenzhen.mbtiles
```

注意遵守 MapTiler 的授权和配额。

### 方案 B：自己用 OpenMapTiles 生成

参考 [OpenMapTiles](https://openmaptiles.org/) 的 Docker 流程，用中国/深圳 OSM 提取生成 `.mbtiles`。这条路线更自由，但需要处理 OSM 数据、Docker 磁盘和生成时间。

### 方案 C：已有的 OpenMapTiles 数据

如果课程/实验室已有 `.mbtiles`，直接放进 `data/` 即可。

---

## 3. 准备字体

样式里的地名标注需要字体文件。TileServer GL 默认从 `fonts/` 读取：

```text
maputnik/fonts/Noto Sans Regular/0-255.pbf
maputnik/fonts/Noto Sans Regular/256-511.pbf
...
```

可以从 OpenMapTiles 的字体包获取，或者使用 TileServer GL 测试数据里的 `fonts/`。

如果暂时不做地名标注，可以先把 `style.json` 里的 `glyphs` 和 `place-labels` 图层删掉，等底图跑通后再补。

---

## 4. 启动 TileServer GL

项目已经提供六套配色和配置，直接复制：

```powershell
Copy-Item docs\maputnik\config.example.json maputnik\config.json
```

`maputnik/config.json` 包含：

```text
styles/low-altitude-qianli
styles/low-altitude-wutai
styles/low-altitude-youchun
styles/low-altitude-qiuse
styles/low-altitude-danfeng
styles/low-altitude-qixu
```

并且注册了 `data/shenzhen.mbtiles`。

`docker-compose.yml` 示例：

```yaml
services:
  tileserver:
    image: maptiler/tileserver-gl:latest
    container_name: low-altitude-tileserver
    ports:
      - "8080:8080"
    volumes:
      - ./:/data
    command: ["--config", "/data/config.json", "--verbose"]
    restart: unless-stopped
```

启动：

```powershell
cd D:\低空经济\low-altitude-mvp\maputnik
docker compose up -d
docker compose logs -f
```

打开：

```text
http://localhost:8080
```

你应该能看到：

- `Data`：`shenzhen`
- `Styles`：`low-altitude`

先验证栅格瓦片是否能出图：

```text
http://localhost:8080/styles/low-altitude-qianli/0/0/0.png
http://localhost:8080/styles/low-altitude-qianli/12/3344/1784.png
```

如果这两个地址返回图片，说明 TileServer GL 已经能按 `style.json` 渲染。

---

## 5. 用 Maputnik 编辑样式

打开在线编辑器：

```text
https://maputnik.github.io/editor/
```

或者使用本地/桌面版 Maputnik（避免在线版访问 localhost 的跨域问题）。

### 5.1 打开样式

点击 `Open`，选择：

```text
maputnik/styles/qianli/style.json
```

### 5.2 检查数据源

在 `Data Sources` 里确认：

```json
{
  "openmaptiles": {
    "type": "vector",
    "url": "http://localhost:8080/data/shenzhen.json"
  }
}
```

如果 TileServer GL 的数据名不是 `shenzhen`，改成实际名称。

如果 Maputnik 在线版无法访问 `localhost:8080`，有两个办法：

1. 用本地 Maputnik；
2. 给 TileServer GL 加 CORS 反向代理。

Nginx 示例：

```nginx
location / {
    add_header Access-Control-Allow-Origin *;
    proxy_pass http://127.0.0.1:8080;
}
```

### 5.3 推荐先改的图层

不要一上来做几十个图层。先做这 6 层：

```text
background          背景
water               水系
landuse             绿地/用地
transportation      道路
building            建筑
place               地名
```

对应颜色可以先用本项目浅色主题：

| 元素 | 建议颜色 |
|---|---|
| 背景 | `#F3F5F8` |
| 水系 | `#C9D6E2` |
| 绿地/用地 | `#E8EDF3` |
| 道路 | `#FFFFFF` |
| 道路描边 | `#D8E0EA` |
| 建筑 | `#E5E7EB` |
| 地名 | `#475569` |

深色主题可以用：

| 元素 | 建议颜色 |
|---|---|
| 背景 | `#0B0F16` |
| 水系 | `#0F1B2A` |
| 绿地/用地 | `#111827` |
| 道路 | `#2A3648` |
| 建筑 | `#1F2937` |
| 地名 | `#94A3B8` |

### 5.4 设计原则

- **底图低饱和**，业务空域才突出；
- 不要把所有 POI 都打开，地名会很乱；
- 道路不要用高对比纯白，浅灰更耐看；
- 建筑只保留面，不做夸张描边；
- 把“空域”留在 Cesium 里，不要画进底图；
- 做两套样式：`low-altitude-light`、`low-altitude-dark`，方便和主题切换配合。

### 5.5 导出

Maputnik 右上角 `Export` → `Style JSON`，覆盖对应配色目录，例如：

```text
maputnik/styles/qianli/style.json
```

TileServer GL 会自动读取新文件；如果没刷新，重启容器：

```powershell
docker compose restart
```

再打开：

```text
http://localhost:8080/styles/low-altitude-qianli/0/0/0.png
```

### 5.6 本项目已经准备好的 6 套配色

`maputnik/styles/` 里已经有：

| 目录 | 配色 | 适用场景 |
|---|---|---|
| `qianli` | 千里江山 | 青绿山水、报告截图 |
| `wutai` | 五台山图 | 敦煌矿物色、正式汇报 |
| `youchun` | 游春图 | 春日青绿、轻量演示 |
| `qiuse` | 江山秋色 | 秋山赭色、课堂讲解 |
| `danfeng` | 丹枫呦鹿 | 丹枫深林、强调对比 |
| `qixu` | 绮序舒芳 | 花卉册页、柔和浅色 |

配色用脚本集中维护：

```text
scripts/build-basemap-styles.mjs
```

修改里面的 `palettes` 后重新运行：

```powershell
node scripts/build-basemap-styles.mjs
```

---

## 6. 配置到本项目

项目已经预留了自定义底图入口。

### 6.1 配置 `.env.local`

live 模式（连接本地 TileServer GL）：

```dotenv
VITE_CUSTOM_MAP_BASE_URL=http://localhost:8080/styles
VITE_CUSTOM_MAP_CREDIT=© OpenMapTiles · © OpenStreetMap contributors
```

单套模式（只挂一个样式）可以用：

```dotenv
VITE_CUSTOM_MAP_URL=http://localhost:8080/styles/low-altitude-qianli/{z}/{x}/{y}.png
```

注意：

- 多套样式用 `VITE_CUSTOM_MAP_BASE_URL`，底图菜单会一次出现 6 个配色；
- 必须使用 `VITE_` 前缀；
- `{z}`、`{x}`、`{y}` 原样保留；
- 修改 `.env.local` 后必须重启 `npm run dev`。

### 6.2 代码位置

配置读取在：

```text
src/config/basemaps.ts
```

关键代码：

```ts
const CUSTOM_MAP_BASE_URL = String(import.meta.env.VITE_CUSTOM_MAP_BASE_URL ?? '')
  .trim()
  .replace(/\/+$/, '');

export const CUSTOM_MAP_READY = /^(https?:\/\/|\/).+/.test(CUSTOM_MAP_BASE_URL);
```

底图菜单会自动出现：

```text
千里江山 / 五台山图 / 游春图 / 江山秋色 / 丹枫呦鹿 / 绮序舒芳
```

Cesium 加载在：

```text
src/cesium/LowAltitudeScene.ts
```

`setBasemap()` 会把 URL 模板交给：

```ts
new Cesium.UrlTemplateImageryProvider({
  url: layer.url,
  maximumLevel: config.maxLevel,
  tilingScheme: new Cesium.WebMercatorTilingScheme(),
  credit: new Cesium.Credit(layer.credit)
});
```

### 6.3 为什么能放大到 z16

项目使用 **live TileServer GL**，不是静态图片金字塔：

```text
Cesium 请求 /styles/low-altitude-qianli/{z}/{x}/{y}.png
  → TileServer GL 从 shenzhen.mbtiles 取矢量瓦片
  → 按 style.json 实时渲染 PNG
```

所以不需要预渲染 z15/z16，也不会在放大后拉伸 z14 图片。Cesium 端设置：

```ts
maximumLevel: 16
```

数据 `shenzhen.mbtiles` 本身支持到 z16，地图放到街道级仍然清晰。

如果要离线交付，才需要运行：

```powershell
# 可选：把当前 6 套样式预渲染为静态瓦片
node scripts/export-basemap-tiles.mjs
```

默认不提交静态瓦片，避免上万张 PNG 占用空间。

### 6.4 重启并选择

```powershell
cd D:\低空经济\low-altitude-mvp
npm run dev
```

打开页面：

1. 点击右侧“底图”；
2. 选择“千里江山 / 五台山图 / 游春图 / 江山秋色 / 丹枫呦鹿 / 绮序舒芳”；
3. 地图会切换为对应配色。

---

## 7. 六套配色怎么选

| 配色 | 适合 |
|---|---|
| 千里江山 | 青绿山水、课程报告、截图 |
| 五台山图 | 敦煌矿物色、正式汇报 |
| 游春图 | 春日青绿、轻量演示 |
| 江山秋色 | 秋山赭色、课堂讲解 |
| 丹枫呦鹿 | 丹枫深林、强调对比 |
| 绮序舒芳 | 花卉册页、柔和浅色 |

修改颜色只需要改：

```text
scripts/build-basemap-styles.mjs
```

里面的 `palettes` 数组，然后重新生成并导出。

---

## 8. 生产部署

> GitHub Pages 是纯静态托管，**不能运行 TileServer GL**。线上部署建议直接使用天地图 key；如果一定要线上显示国画底图，需要把导出的静态瓦片放进 `public/basemap`，或把 TileServer 部署到一台可公网访问的服务器。


开发时：

```text
http://localhost:8080/styles/low-altitude-qianli/{z}/{x}/{y}.png
```

生产时不要继续用 `localhost`。建议：

```text
https://你的域名/tiles/styles/low-altitude-qianli/{z}/{x}/{y}.png
```

Nginx 反向代理示例：

```nginx
location /tiles/ {
    proxy_pass http://127.0.0.1:8080/;
    proxy_set_header Host $host;
    add_header Access-Control-Allow-Origin *;
}
```

然后把 `.env.production` 改成：

```dotenv
VITE_CUSTOM_MAP_BASE_URL=https://你的域名/tiles/styles
```

注意：

- 页面是 HTTPS 时，底图也必须是 HTTPS，否则会被浏览器拦截；
- 保留 OpenMapTiles / OSM / MapTiler 的版权标识；
- 商用或公开部署前确认地图数据授权、测绘资质和审核要求。

---

## 9. 常见问题

### 瓦片 404

检查：

```text
http://localhost:8080/styles/low-altitude-qianli/0/0/0.png
```

如果 404：

- `config.json` 的 `styles` 路径不对；
- `style.json` 文件名不对；
- 容器没有挂载到 `/data`；
- 看 `docker compose logs -f` 的报错。

### 地图空白，但瓦片地址有图

检查：

- `.env.local` 是否重启生效；
- URL 是否保留了 `{z}/{x}/{y}`；
- 浏览器控制台是否有 CORS 错误；
- Cesium 是否使用了 `WebMercatorTilingScheme`。

### 字体/地名不显示

- `fonts/` 里没有对应字体；
- `glyphs` URL 不对；
- `text-font` 写成了不存在的字体名；
- 先删掉 `place-labels` 图层，确认底图能出图后再补字体。

### Maputnik 在线版打不开 localhost 数据

在线版是 HTTPS 页面，访问 `http://localhost:8080` 可能被浏览器拦截，或者被 CORS 拒绝。使用本地 Maputnik，或加 CORS 代理。

### 底图菜单没有“自定义地图”

- `.env.local` 没有 `VITE_CUSTOM_MAP_BASE_URL` 或 `VITE_CUSTOM_MAP_URL`；
- 变量名不是 `VITE_` 开头；
- 修改后没有重启 `npm run dev`；
- `CUSTOM_MAP_READY` 的正则没有匹配到 `http://` 或 `https://`。

---

## 10. 最小验收标准

做到下面几条，就可以认为底图接入完成：

1. `http://localhost:8080/styles/low-altitude-qianli/0/0/0.png` 能返回图片；
2. 页面底图菜单出现 3 个标准底图 + 6 个自定义配色；
3. 切换后 Cesium 能显示你设计的背景、水系、道路、建筑、地名；
4. 空域、无人机、航线、告警仍然正常显示；
5. 浏览器控制台没有 CORS / 404 错误；
6. 页面底部保留底图版权标识。

示例文件在：

```text
docs/maputnik/config.example.json
docs/maputnik/style.example.json
docs/maputnik/docker-compose.yml
```
