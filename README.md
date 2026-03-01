# Checkmate!!

Checkmate!! 是一个使用 TypeScript + Fastify + Socket.IO 仿写的 generals.io 游戏。

## 运行

```shell
pnpm install
pnpm run build
pnpm run start
```

启动后访问 `http://localhost:23333/` 并注册账号。

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
