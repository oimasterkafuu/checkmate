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

新增了一个手动触发的 workflow：`Bump Version And Merge PR`。

使用方式：

1. 打开 GitHub 仓库的 `Actions` 页面。
2. 选择 `Bump Version And Merge PR`。
3. 点击 `Run workflow`，填写：
   - `pr_number`：要处理的 PR 编号
   - `bump_type`：版本升级类型（`major` / `minor` / `patch`）
   - `merge_method`：合并方式（`squash` / `merge` / `rebase`）
4. 运行后会自动完成：
   - 在 PR 分支执行 `pnpm version <bump_type> --no-git-tag-version`
   - 提交并推送 `package.json`（以及 `pnpm-lock.yaml`，如果有变化）
   - 自动 merge 该 PR

注意事项：

- 该 workflow 仅支持同仓库分支创建的 PR（不支持 fork PR）。
- PR 必须是 `open` 且非 draft 状态。
