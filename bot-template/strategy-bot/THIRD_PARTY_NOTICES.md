# Third Party Notices

This directory vendors code from:

- Project: `EklipZgit/generals-bot`
- Source: https://github.com/EklipZgit/generals-bot
- Snapshotted commit: `89d0680`
- License: MIT (see `LICENSE.generals-bot-MIT`)

Modifications in this repository:

- Replaced the original generals.io websocket client with a Checkmate Socket.IO adapter.
- Added runtime fallback for knapsack acceleration (pure-Python fallback when native module is unavailable).
- Added environment-variable entrypoint (`index.py`) and Checkmate-specific usage docs.
