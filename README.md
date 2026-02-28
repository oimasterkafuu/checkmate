# Checkmate!!

Checkmate!! 是一个使用 TypeScript + Fastify + Socket.IO 仿写的 generals.io 游戏。

## 运行

```shell
pnpm install
pnpm run build
pnpm run start
```

启动后访问 `http://localhost:23333/` 并注册账号。

## 环境变量

服务启动时会自动读取当前目录下 `.env`。如果以下变量缺失，会自动生成并写入 `.env`：

- `WEBHOOK_SECRET`：默认写入 `kana-secret-change-me-in-dev-environment-haha-meow`
- `JWT_SECRET`：自动生成 32 位随机字符串
- `environment`：默认写入 `production`
- `NODE_ENV`：默认跟随 `environment`（未配置时为 `production`）

## GitHub Webhook 自动更新

- Webhook 地址：`POST /postreceive`
- 鉴权方式：优先校验 GitHub 的 `X-Hub-Signature-256`（基于 `WEBHOOK_SECRET`）
- Payload 类型：支持 `application/json` 与 `application/x-www-form-urlencoded`（读取 `payload` 字段）
- `push` 事件仅对 `refs/heads/main` 生效，其他分支会忽略
- 成功收到 webhook 后会依次执行：
  1. `git fetch origin main`
  2. `git checkout -f main`
  3. `git reset --hard origin/main`
  4. `pnpm install --frozen-lockfile`
  5. `pnpm run build`
  6. 自动重启当前进程（在 systemd 下由 systemd 拉起）

注意：自动更新会强制覆盖已跟踪文件中的本地修改。  
如果更新过程中命令失败，服务会保留当前进程并输出错误日志。
