# Random Patch Bot Template

This folder contains a minimal bot framework for Checkmate.

What this bot does:

- joins a room through Socket.IO;
- applies full/diff `update` payloads to keep a local map state;
- collects currently possible actions from owned cells each turn;
- randomly picks one action and sends `attack`.

## 1) Get auth token manually

Login requires captcha, so bot login is not fully automatic.

1. Login in browser first.
2. Open DevTools -> Application/Storage -> Cookies.
3. Copy cookie value named `auth_token`.

## 2) Install and run

```bash
cd bot-template/random-patch-bot
pnpm install
BOT_SERVER=http://127.0.0.1:23333 BOT_ROOM=your-room BOT_TOKEN=your-auth-token pnpm start
```

Optional env:

- `BOT_ACTION_DELAY_MS` (default: `120`)
