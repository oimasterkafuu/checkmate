# Strategy Bot Template

核心策略代码保留在：

- `src/strategy/GameStrategy.js`

适配层与交互层位于：

- `src/Bot.js`：Socket.IO 交互、自动准备、回合驱动、动作下发
- `src/state/MapState.js`：`update` patch 应用、地图协议转译（新协议 -> bot3 gm 结构）

## 环境变量

- `BOT_SERVER`：服务端地址，默认 `http://127.0.0.1:23333`
- `BOT_ROOM`：要加入的房间（必填）
- `BOT_TOKEN`：网页登录后提取的 `auth_token`（必填）
- `BOT_TEAM`：自动分队目标，默认 `1`
- `BOT_AUTO_READY`：是否自动准备，默认 `1`（`0` 关闭）

## 运行

```bash
cd bot-template/strategy-bot
pnpm install
BOT_SERVER=http://127.0.0.1:23333 BOT_ROOM=your-room BOT_TOKEN=your-auth-token pnpm start
```

## 说明

- 核心决策仍由 `GameStrategy` 完成；本模板仅做协议与交互适配，不改核心策略算法。
- 地图为非正方形时，适配层会以边界山体补齐成正方结构供策略计算。
- bot 一旦拥有改图权限（房主），会立即把 `map_mode` 强制为 `maze`（峡谷回廊）。
- 若地图不是 `maze` 且 bot 无权限改图，会立刻切到观战席并保持观战，直到地图恢复为 `maze`。
- 默认已移除大部分高频输出，仅保留关键错误与房主切图提示。
