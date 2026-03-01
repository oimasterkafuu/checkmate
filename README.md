# Checkmate!!

Checkmate!! 是一个使用 TypeScript + Fastify + Socket.IO 仿写的 generals.io 游戏。

## 运行

```shell
pnpm install
pnpm run build
pnpm run start
```

启动后访问 `http://localhost:23333/` 并注册账号。

## 频率限制与真实 IP

- 服务端限流默认按客户端 IP 计数。
- 当请求来源是内网或本机代理（如 `127.0.0.1`、`10.x.x.x`、`192.168.x.x`）时，会优先从以下请求头提取真实 IP：
  - `CF-Connecting-IP`
  - `True-Client-IP`
  - `X-Real-IP`
  - `X-Forwarded-For`
  - `X-Client-IP`
  - `Forwarded`
- 若请求直接到达 Fastify（非可信代理来源），则使用连接源地址，避免伪造头绕过限流。

### frp 透传真实 IP（Cloudflare -> Nginx -> frp -> Fastify）

推荐使用 `frp` 的 `http` 代理类型（不要使用 `tcp` 直透），这样 Fastify 才能拿到 HTTP 头里的真实 IP。

`frps.toml`（服务端示例）：

```toml
bindPort = 7000
vhostHTTPPort = 8080

[auth]
method = "token"
token = "replace-with-strong-token"
```

`frpc.toml`（客户端示例）：

```toml
serverAddr = "your-frps-public-ip-or-domain"
serverPort = 7000

[auth]
method = "token"
token = "replace-with-strong-token"

[[proxies]]
name = "checkmate-http"
type = "http"
localIP = "127.0.0.1"
localPort = 23333
customDomains = ["game.example.com"]
```

Nginx（位于 Cloudflare 后方，转发到 frps 的 `vhostHTTPPort`）：

```nginx
server {
    listen 80;
    server_name game.example.com;

    # 建议启用 real_ip 模块并维护 Cloudflare 官方 IP 段
    real_ip_header CF-Connecting-IP;
    real_ip_recursive on;

    location / {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $realip_remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
        proxy_pass http://127.0.0.1:8080;
    }
}
```

这样链路中的头部会被保留，服务端限流会优先使用真实客户端 IP。

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

## GitHub Action：升级版本并自动合并 PR

新增了一个 workflow：`Bump Version And Merge PR`，支持「手动触发」和「PR 评论触发」。

使用方式：

1. 推荐：在 PR 中评论触发（仅限 `oimasterkafuu`）：
   - `OK. major`
   - `OK. minor`
   - `OK. patch`
   - 可选指定合并策略：`OK. patch merge|squash|rebase`（默认 `merge`）
2. 也可在 Actions 页面手动 `Run workflow`：
   - `pr_number`：要处理的 PR 编号
   - `bump_type`：版本升级类型（`major` / `minor` / `patch`）
   - `merge_method`：合并方式（`merge` / `squash` / `rebase`）
3. 运行后会自动完成：
   - 在 PR 分支执行 `pnpm version <bump_type> --no-git-tag-version`
   - 提交并推送 `package.json`（以及 `pnpm-lock.yaml`，如果有变化）
   - 先检测与目标分支是否冲突
   - 无冲突则自动 merge；有冲突则在 PR 留言提示冲突文件并停止

注意事项：

- 该 workflow 仅支持同仓库分支创建的 PR（不支持 fork PR）。
- PR 必须是 `open` 且非 draft 状态。

## GitHub Action：合并后自动删除 `dev/*` 分支

新增了一个 workflow：`Delete Merged Dev Branch`。

- 触发时机：PR 被关闭（`pull_request.closed`）
- 仅在以下条件成立时执行删除：
  - PR 确认已 merge
  - 源分支名以 `dev/` 开头
  - 源分支来自当前仓库（不处理 fork 仓库分支）
- 删除方式：调用 GitHub API 删除 `refs/heads/<head_ref>`

另外，`Bump Version And Merge PR` 在自动 merge 成功后，也会在同一次运行内直接删除 `dev/*` 分支。  
这样即使自动 merge 由 `GITHUB_TOKEN` 发起，仍能稳定完成分支清理。
