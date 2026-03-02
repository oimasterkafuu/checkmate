"""Checkmate strategy bot entrypoint (environment-variable driven)."""

from __future__ import annotations

import os

import logbook

import BotLogging
from BotHost import run_bothost


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() not in {'0', 'false', 'no', 'off'}


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(str(raw).strip())
    except ValueError:
        return default


def _resolve_log_level() -> int:
    raw = str(os.environ.get('BOT_LOG_LEVEL', 'INFO')).strip().upper()
    if raw == 'DEBUG':
        return logbook.DEBUG
    if raw == 'NOTICE':
        return logbook.NOTICE
    if raw == 'WARNING' or raw == 'WARN':
        return logbook.WARNING
    if raw == 'ERROR':
        return logbook.ERROR
    if raw == 'CRITICAL':
        return logbook.CRITICAL
    return logbook.INFO


def main() -> None:
    room_id = str(os.environ.get('BOT_ROOM', '')).strip()
    if not room_id:
        raise RuntimeError('Missing BOT_ROOM. Example: BOT_ROOM=abcd')

    token = str(os.environ.get('BOT_TOKEN', '')).strip()
    if not token:
        raise RuntimeError('Missing BOT_TOKEN. Copy auth_token from browser cookie.')

    # Keep compatibility with previous template defaults.
    os.environ.setdefault('BOT_SERVER', 'http://127.0.0.1:23333')
    os.environ.setdefault('BOT_TEAM', str(_env_int('BOT_TEAM', 1)))
    os.environ.setdefault('BOT_AUTO_READY', '1' if _env_bool('BOT_AUTO_READY', True) else '0')
    os.environ.setdefault('BOT_LOG_LEVEL', 'INFO')

    no_ui = _env_bool('BOT_NO_UI', True)
    level = _resolve_log_level()
    no_log = level >= logbook.ERROR

    # Optional knobs for callers who want to label multiple bot instances.
    name = str(os.environ.get('BOT_NAME', 'EklipZ_ai')).strip() or 'EklipZ_ai'
    user_id = str(os.environ.get('BOT_USER_ID', '')).strip() or None

    # This mode label is informational in current adapter; room join is always BOT_ROOM-driven.
    game_type = str(os.environ.get('BOT_GAME_TYPE', 'ffa')).strip().lower()
    if game_type not in {'private', 'custom', '1v1', 'ffa', 'team', 'bigteam'}:
        game_type = 'ffa'

    BotLogging.set_up_logger(level)

    run_bothost(
        name=name,
        gameType=game_type,
        roomId=room_id,
        userId=user_id,
        isPublic=False,
        noUi=no_ui,
        alignBottom=False,
        alignRight=False,
        noLog=no_log,
    )


if __name__ == '__main__':
    main()
