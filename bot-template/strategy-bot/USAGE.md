# Strategy Bot (Python Adapter for Checkmate)

该目录已替换为 Python 版 `generals-bot`（上游快照）并接入 Checkmate Socket.IO 协议。

## 1) 安装依赖

```bash
cd bot-template/strategy-bot
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 2) 准备环境变量

- `BOT_SERVER`：服务端地址，默认 `http://127.0.0.1:23333`
- `BOT_ROOM`：房间号（必填）
- `BOT_TOKEN`：网页登录后 Cookie 里的 `auth_token`（必填）
- `BOT_TEAM`：允许组队模式下目标队伍，默认 `1`
- `BOT_AUTO_READY`：是否自动准备，默认 `1`
- `BOT_NO_UI`：是否关闭 pygame viewer，默认 `1`（推荐保持）
- `BOT_LOG_LEVEL`：日志级别（`DEBUG/INFO/WARNING/ERROR`），默认 `INFO`

## 3) 启动

```bash
cd bot-template/strategy-bot
BOT_SERVER=http://127.0.0.1:23333 \
BOT_ROOM=your-room \
BOT_TOKEN=your-auth-token \
BOT_AUTO_READY=1 \
BOT_NO_UI=1 \
python3 index.py
```

## 说明

- 该适配层保持上游策略内核不变，只替换网络交互协议。
- 默认面向 1v1 / FFA 房间玩法，不强制 `maze` 地图。
- `KnapsackUtils` 已实现“优先本地加速，失败自动回退纯 Python”。
