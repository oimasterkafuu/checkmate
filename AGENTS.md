# AGENTS.md

## 包管理器

- 统一使用 `pnpm`，禁止使用 `npm` 或 `yarn`。
- 首次安装依赖：`pnpm install`
- 新增依赖：`pnpm add <pkg>` / `pnpm add -D <pkg>`
- 删除依赖：`pnpm remove <pkg>`
- 提交前应确保 `pnpm-lock.yaml` 与 `package.json` 一致。

## 项目开发准则

- Node 与依赖管理：
  - 使用 `package.json` 中声明的 `packageManager` 版本（通过 Corepack 管理）。
  - 不手动编辑 `dist/` 产物，源码修改应在 `src/` 与 `static/` 下进行。
- 日常开发流程：
  - 启动开发：`pnpm run dev`
  - 类型构建检查：`pnpm run build`
  - 代码检查：`pnpm run lint`
  - 自动格式化：`pnpm run format`
- 提交前最小检查：
  - `pnpm run lint`
  - `pnpm run build`
  - `pnpm run format`
- 变更原则：
  - 单次提交聚焦一个主题，避免混入无关改动。
  - 修改行为时，需同步更新 `README.md`（如运行方式、接口、配置变化）。

## 提交格式规范（Conventional Commits）

- 提交信息格式：
  - `<type>(<scope>): <subject>`
- `type` 建议值：
  - `feat` 新功能
  - `fix` 缺陷修复
  - `refactor` 重构（不改变外部行为）
  - `perf` 性能优化
  - `docs` 文档变更
  - `style` 纯样式/格式调整（不改逻辑）
  - `test` 测试相关
  - `chore` 杂项维护（构建、工具、依赖等）
  - `ci` CI/CD 配置变更
  - `revert` 回滚提交
- 书写要求：
  - `subject` 使用祈使句，简洁明确，英语，首字母小写，不超过 72 个字符。
  - 需要补充背景时，在正文说明 `why` 与影响范围。
  - 破坏性变更需在正文或页脚标注 `BREAKING CHANGE:`。

示例：

```text
feat(replay): support ops-v1 binary patch stream
fix(auth): invalidate previous session on re-login
docs(readme): replace npm commands with pnpm
chore(deps): migrate lockfile to pnpm-lock.yaml
```
