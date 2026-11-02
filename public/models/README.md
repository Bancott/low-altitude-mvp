# 无人机 / 3D 模型放置说明

把模型文件放在这个目录，例如：

```text
public/models/drone.glb
public/models/city/tileset.json
```

然后在 `src/cesium/LowAltitudeScene.ts` 中：

- 无人机模型：把 `buildDrones()` 中的 `billboard` 换成 `model: { uri: '/models/drone.glb', ... }`；
- 3D 建筑：新增 `Cesium3DTileset.fromUrl('/models/city/tileset.json')`。

建议：

- glTF 使用 `.glb` 单文件；
- 模型单位与 Cesium 米制一致；
- 记录模型前向轴（+X / +Z），方便设置 `orientation`；
- 大模型不要直接提交到 Git，超过 50MB 建议使用 Git LFS 或外部静态资源服务。
