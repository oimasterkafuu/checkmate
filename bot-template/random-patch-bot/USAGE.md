# 随机 Patch Bot 模板

这个目录提供了一个 Checkmate 机器人的最小可运行框架。

该 bot 的行为如下：

- 通过 Socket.IO 加入房间；
- 消费 `update` 的全量/增量数据，维护本地地图状态；
- 每回合从当前可行动作中收集候选；
- 随机选择一个动作并发送 `attack`。

## 1）手动获取鉴权 token

登录流程包含验证码，因此机器人无法完全自动登录。

1. 先在浏览器中登录账号。
2. 打开开发者工具，进入 Application/Storage -> Cookies。
3. 复制名为 `auth_token` 的 Cookie 值。

## 2）安装与运行

```bash
cd bot-template/random-patch-bot
pnpm install
BOT_SERVER=http://127.0.0.1:23333 BOT_ROOM=your-room BOT_TOKEN=your-auth-token pnpm start
```

可选环境变量：

- `BOT_ACTION_DELAY_MS`（默认值：`120`）
