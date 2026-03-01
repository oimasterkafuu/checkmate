# Checkmate!!

Checkmate!! 是一个使用 TypeScript + Fastify + Socket.IO 仿写的 generals.io 游戏。

## 运行

```shell
pnpm install
pnpm run build
pnpm run start
```

启动后访问 `http://localhost:23333/` 并注册账号。

## 关于页地图示例

- 关于页会展示“标准地图 / 峡谷回廊”的实时示例。
- 示例由服务端接口 `GET /api/map-examples` 现场生成（4 人地图），前端负责渲染。
