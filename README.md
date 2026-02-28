# Checkmate!!

Checkmate!! 是一个使用 TypeScript + Fastify + Socket.IO 仿写的 generals.io 游戏。

## 运行

```shell
pnpm install
pnpm run build
pnpm run start
```

启动后访问 `http://localhost:23333/` 并注册账号。

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
