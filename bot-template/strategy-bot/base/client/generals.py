"""
    Checkmate-compatible Generals client adapter.

    This file intentionally keeps the same public interface as the original
    generals-bot client so the strategy core (bot_base/BotHost/bot_ek0x45)
    can run unchanged.
"""

from __future__ import annotations

import json
import os
import queue
import random
import threading
import time
import traceback
import typing
from collections import deque

import logbook
import socketio


class _SafeSocketClient(socketio.Client):
    """Socket.IO client with a disconnect handler safe against namespace mutation races."""

    def _handle_eio_disconnect(self, reason):
        self.logger.info('Engine.IO connection dropped')
        will_reconnect = self.reconnection and self.eio.state == 'connected'
        if self.connected:
            # python-socketio can mutate namespaces during disconnect callbacks.
            for namespace in list(self.namespaces):
                self._trigger_event('disconnect', namespace, reason)
                if not will_reconnect:
                    self._trigger_event('__disconnect_final', namespace)
            self.namespaces = {}
            self.connected = False
        self.callbacks = {}
        self._binary_packet = None
        self.sid = None
        if will_reconnect and not self._reconnect_task:
            self._reconnect_task = self.start_background_task(self._handle_reconnect)


class ChatUpdate(object):
    def __init__(self, fromUser: str, fromTeam: bool, message: str):
        self.from_user: str = fromUser
        self.is_team_chat: bool = fromTeam
        self.message: str = message

    def __str__(self):
        return f'{"[team] " if self.is_team_chat else ""}{self.from_user}: {self.message}'

    def __repr__(self):
        return str(self)


class _CheckmateFrameTranslator:
    """Translate Checkmate update payloads to generals-bot map protocol payloads."""

    def __init__(self):
        self.n: int = 0
        self.m: int = 0
        self.grid_type: list[int] = []
        self.army_cnt: list[int] = []

    def set_dimensions(self, n: int, m: int) -> None:
        if n <= 0 or m <= 0:
            raise ValueError(f'invalid map dimensions n={n}, m={m}')
        self.n = n
        self.m = m
        self.grid_type = [205] * (n * m)
        self.army_cnt = [0] * (n * m)

    def _apply_diff(self, diff_arr: list[int], target: list[int]) -> None:
        length = len(target)
        i = 0
        while i + 1 < len(diff_arr):
            idx = int(diff_arr[i])
            value = int(diff_arr[i + 1])
            if 0 <= idx < length:
                target[idx] = value
            i += 2

    def apply_update_payload(self, payload: dict) -> None:
        if self.n <= 0 or self.m <= 0:
            return

        is_diff = bool(payload.get('is_diff'))
        if is_diff:
            self._apply_diff(list(payload.get('grid_type') or []), self.grid_type)
            self._apply_diff(list(payload.get('army_cnt') or []), self.army_cnt)
            return

        grid = list(payload.get('grid_type') or [])
        army = list(payload.get('army_cnt') or [])
        expected = self.n * self.m
        if len(grid) != expected or len(army) != expected:
            raise ValueError(
                f'invalid full payload lengths grid={len(grid)} army={len(army)} expected={expected}',
            )
        self.grid_type = [int(v) for v in grid]
        self.army_cnt = [int(v) for v in army]

    def _tile_code_to_server_tile(self, code: int) -> tuple[int, bool, bool, bool]:
        """
        Returns: (tile_value, is_city_visible, is_general_visible, is_swamp)

        tile_value follows base/client/tile.py conventions:
          >=0 owner index, -1 empty, -2 mountain, -3 fog, -4 obstacle
        """

        if 1 <= code < 50:
            return code - 1, False, False, False
        if 50 <= code < 100:
            owner = code - 50
            tile_value = owner - 1 if owner > 0 else -1
            return tile_value, True, False, False
        if 100 <= code < 150:
            owner = code - 100
            tile_value = owner - 1 if owner > 0 else -1
            return tile_value, False, True, False
        if 150 <= code < 200:
            owner = code - 150
            tile_value = owner - 1 if owner > 0 else -1
            return tile_value, False, False, True

        if code == 200:
            return -1, False, False, False
        if code == 201:
            return -2, False, False, False
        if code == 202:
            return -3, False, False, False
        if code == 203:
            return -4, False, False, False
        if code == 204:
            return -1, False, False, True
        if code == 205:
            return -3, False, False, True

        return -1, False, False, False

    @staticmethod
    def _to_full_replace_diff(values: list[int]) -> list[int]:
        return [0, len(values), *values]

    def build_game_update(self, payload: dict, player_ids: list[str]) -> tuple[dict, dict[str, typing.Any]]:
        if self.n <= 0 or self.m <= 0:
            raise RuntimeError('translator dimensions were not initialized')

        tile_values: list[int] = []
        cities: list[int] = []
        generals: list[int] = []
        swamps: list[int] = []

        for idx, code in enumerate(self.grid_type):
            tile_value, is_city, is_general, is_swamp = self._tile_code_to_server_tile(int(code))
            tile_values.append(tile_value)
            if is_city:
                cities.append(idx)
            if is_general:
                generals.append(idx)
            if is_swamp:
                swamps.append(idx)

        map_private = [self.m, self.n, *self.army_cnt, *tile_values]

        leaderboard = payload.get('leaderboard') or []
        score_by_index: dict[int, dict[str, typing.Any]] = {
            i: {'i': i, 'total': 0, 'tiles': 0, 'dead': False} for i in range(len(player_ids))
        }

        for item in leaderboard:
            try:
                idx = int(item.get('id', 0)) - 1
            except Exception:
                continue
            if idx < 0 or idx >= len(player_ids):
                continue

            dead_flag = str(item.get('class_', '')) == 'dead'
            # Kept as requested by migration plan.
            total = int(item.get('army', 0))
            tiles = int(item.get('land', 0))
            score_by_index[idx] = {
                'i': idx,
                'total': total,
                'tiles': tiles,
                'dead': dead_flag,
            }

        scores = [score_by_index[i] for i in range(len(player_ids))]

        game_update = {
            'turn': int(payload.get('turn', 0)),
            'map_diff': self._to_full_replace_diff(map_private),
            'cities_diff': self._to_full_replace_diff(cities),
            'deserts_diff': self._to_full_replace_diff([]),
            'generals': generals,
            'scores': scores,
            'stars': [0 for _ in range(len(player_ids))],
            'result': None,
            # Preserve original payload to keep optional behaviors inspectable.
            '_checkmate_raw': payload,
        }

        meta = {
            'swamps': sorted(set(swamps)),
        }
        return game_update, meta


class GeneralsClient(object):
    def __init__(
        self,
        userid,
        username,
        mode='1v1',
        gameid: str | None = None,
        force_start=False,
        public_server=False,
    ):
        del force_start
        del public_server

        if username is None:
            raise ValueError('username empty')
        if userid is None:
            raise ValueError('userid empty')

        self.userid = str(userid)
        self.username = str(username)
        self.server_username = str(username)
        self.mode = str(mode)

        self.room_id = str(gameid or os.environ.get('BOT_ROOM', '')).strip()
        if not self.room_id:
            raise ValueError('Missing room id. Set BOT_ROOM or pass gameid.')

        self.server_url = str(os.environ.get('BOT_SERVER', 'http://127.0.0.1:23333')).strip()
        self.token = str(os.environ.get('BOT_TOKEN', '')).strip()
        if not self.token:
            raise ValueError('Missing BOT_TOKEN (auth_token cookie value).')

        self.target_team = max(1, int(os.environ.get('BOT_TEAM', '1') or 1))
        self.auto_ready = str(os.environ.get('BOT_AUTO_READY', '1')).strip() not in {'0', 'false', 'False'}

        self.terminated = False
        self.result = False
        self.start_data: dict[str, typing.Any] = {}
        self.currentCustomMapData = None
        self.modifiers: set[str] = set()
        self.map = None

        self._lock = threading.RLock()
        self._updates: queue.Queue[tuple[str, typing.Any]] = queue.Queue()
        self._translator = _CheckmateFrameTranslator()

        # Disable library-managed reconnection to avoid namespace mutation race
        # observed with python-socketio on Python 3.14. We reconnect manually.
        self._socket = _SafeSocketClient(reconnection=False, logger=False, engineio_logger=False)
        self._connected = False
        self._started = False
        self._stopped = False
        self._connect_lock = threading.Lock()
        self._reconnect_lock = threading.Lock()
        self._reconnect_thread: threading.Thread | None = None
        self._allow_reconnect = True

        self._client_id: str = ''
        self._player_ids: list[str] = []
        self._last_room_update: dict[str, typing.Any] = {}
        self._last_turn: int = -1
        self._last_lobby_action_at: float = 0.0
        self._pending_updates: deque[dict[str, typing.Any]] = deque()
        self._spectating_current_game = False

        self._register_handlers()
        self._connect()

    def _queue_update(self, update_type: str, payload: typing.Any) -> None:
        if self.terminated:
            return
        self._updates.put((update_type, payload))

    def _connect(self) -> None:
        with self._lock:
            if self._started:
                return
            self._started = True

        self._connect_once()

    def _connect_once(self) -> None:
        with self._connect_lock:
            if self.terminated:
                return
            if self._socket.connected:
                return
            logbook.info(f'Connecting to Checkmate {self.server_url}, room={self.room_id}')
            self._socket.connect(
                self.server_url,
                transports=['websocket', 'polling'],
                auth={'token': self.token},
                wait=True,
                wait_timeout=10,
            )

    def _ensure_reconnect_loop(self) -> None:
        if self.terminated or not self._allow_reconnect:
            return
        with self._reconnect_lock:
            if self._reconnect_thread and self._reconnect_thread.is_alive():
                return
            self._reconnect_thread = threading.Thread(target=self._reconnect_loop, daemon=True)
            self._reconnect_thread.start()

    def _reconnect_loop(self) -> None:
        delay = 1.0
        while not self.terminated and not self._socket.connected:
            time.sleep(delay)
            if self.terminated or self._socket.connected:
                break
            try:
                self._connect_once()
                if self._socket.connected:
                    logbook.info('Checkmate reconnect succeeded')
                    return
            except Exception:
                logbook.error('Checkmate reconnect failed:\n' + traceback.format_exc())
            delay = min(delay * 2.0, 5.0)

    def _register_handlers(self) -> None:
        @self._socket.event
        def connect():
            self._connected = True
            logbook.info('Checkmate socket connected')
            self._socket.emit('join_game_room', {'room': self.room_id})

        @self._socket.event
        def disconnect(reason=None):
            self._connected = False
            reason_text = '' if reason is None else str(reason)
            if reason_text:
                logbook.info(f'Checkmate socket disconnected ({reason_text})')
            else:
                logbook.info('Checkmate socket disconnected')
            if not self.terminated:
                # Server-enforced disconnect usually means another active socket for same account.
                # Reconnecting immediately causes join/leave ping-pong.
                if 'server disconnect' in reason_text:
                    self._allow_reconnect = False
                    logbook.info('Server disconnected this client; auto-reconnect disabled for this process.')
                    return
                self._ensure_reconnect_loop()
                return
            self._queue_update('__closed__', None)

        @self._socket.on('connect_error')
        def connect_error(err):
            logbook.error(f'connect_error: {err}')

        @self._socket.on('set_id')
        def on_set_id(client_id):
            self._client_id = str(client_id or '')
            logbook.info(f'set_id: {self._client_id}')

        @self._socket.on('room_update')
        def on_room_update(data):
            if isinstance(data, dict):
                self._last_room_update = data
            self._auto_ready_from_room_update(data)

        @self._socket.on('init_map')
        def on_init_map(data):
            try:
                self._handle_init_map(data)
            except Exception:
                logbook.error('init_map handling failed:\n' + traceback.format_exc())

        @self._socket.on('update')
        def on_update(payload):
            try:
                self._handle_update(payload)
            except Exception:
                logbook.error('update handling failed:\n' + traceback.format_exc())

        @self._socket.on('chat_message')
        def on_chat_message(data):
            try:
                if not isinstance(data, dict):
                    return
                sender = str(data.get('sender') or '')
                text = str(data.get('text') or '')
                if not sender or not text:
                    return
                team = bool(data.get('team'))
                self._queue_update('chat_message', ChatUpdate(sender, team, text))
            except Exception:
                logbook.error('chat_message handling failed:\n' + traceback.format_exc())

    def _build_synthetic_start_data(self, n: int, m: int, player_ids: list[str]) -> dict[str, typing.Any] | None:
        room_players = list((self._last_room_update or {}).get('players') or [])
        allow_team = bool((self._last_room_update or {}).get('allow_team'))

        sid_to_user: dict[str, str] = {}
        sid_to_team: dict[str, int] = {}
        for p in room_players:
            sid = str(p.get('sid') or '')
            if not sid:
                continue
            sid_to_user[sid] = str(p.get('uid') or f'player_{sid[:6]}')
            sid_to_team[sid] = int(p.get('team') or 0)

        usernames: list[str] = []
        raw_teams: list[int] = []
        for i, sid in enumerate(player_ids):
            usernames.append(sid_to_user.get(sid, f'player_{i + 1}'))
            raw_teams.append(int(sid_to_team.get(sid, 0)))

        if allow_team:
            teams = raw_teams
        else:
            teams = []
            next_team = 1
            for team_val in raw_teams:
                if team_val == 0:
                    teams.append(0)
                else:
                    teams.append(next_team)
                    next_team += 1

        player_index = -1
        if self._client_id:
            try:
                player_index = player_ids.index(self._client_id)
            except ValueError:
                player_index = -1

        if player_index < 0:
            return None

        speed = float((self._last_room_update or {}).get('speed') or 1.0)
        replay_id = f'checkmate_{int(time.time())}_{random.randint(1000, 9999)}'

        return {
            'playerIndex': player_index,
            'playerColors': [i for i in range(len(player_ids))],
            'replay_id': replay_id,
            'chat_room': f'checkmate_room_{self.room_id}',
            'team_chat_room': f'checkmate_room_{self.room_id}_team',
            'usernames': usernames,
            'teams': teams,
            'game_type': 'custom',
            'swamps': [],
            'lights': [],
            'options': {
                'game_speed': speed,
                'modifiers': [],
            },
            # Non-standard helper fields.
            '_n': n,
            '_m': m,
        }

    def _handle_init_map(self, data: dict[str, typing.Any]) -> None:
        if not isinstance(data, dict):
            return

        n = int(data.get('n') or 0)
        m = int(data.get('m') or 0)
        if n <= 0 or m <= 0:
            return

        player_ids = [str(x) for x in (data.get('player_ids') or [])]
        if not player_ids:
            return

        self._player_ids = player_ids
        self._translator.set_dimensions(n, m)
        maybe_start_data = self._build_synthetic_start_data(n, m, player_ids)
        if maybe_start_data is None:
            self._spectating_current_game = True
            self.start_data = {}
            self._last_turn = -1
            self._pending_updates.clear()
            logbook.info(
                'init_map received while not an active player in this match (spectator mode); '
                'skipping bot map initialization until next joined game.',
            )
            return

        self._spectating_current_game = False
        self.start_data = maybe_start_data
        self._last_turn = -1

        logbook.info(
            f'init_map n={n} m={m} players={len(player_ids)} playerIndex={self.start_data.get("playerIndex")}',
        )

        while self._pending_updates:
            self._handle_update(self._pending_updates.popleft())

    def _auto_ready_from_room_update(self, data: dict[str, typing.Any] | None) -> None:
        if not self.auto_ready:
            return
        if not isinstance(data, dict):
            return
        if not self._client_id:
            return
        if bool(data.get('in_game')):
            return

        players = data.get('players') or []
        self_player = None
        for p in players:
            if str(p.get('sid') or '') == self._client_id:
                self_player = p
                break

        if not self_player:
            return

        now = time.time()
        if now - self._last_lobby_action_at < 1.0:
            return

        allow_team = bool(data.get('allow_team'))
        team = int(self_player.get('team') or 0)
        ready = bool(self_player.get('ready'))
        need = int(data.get('need') or 0)

        target_team = self.target_team if allow_team else 1

        if team == 0:
            self._socket.emit('change_team', {'team': target_team})
            self._last_lobby_action_at = now
            return

        if need <= 1:
            return

        if not ready:
            self._socket.emit('change_ready', {'ready': True})
            self._last_lobby_action_at = now

    def _handle_update(self, payload: dict[str, typing.Any]) -> None:
        if not isinstance(payload, dict):
            return
        if not self.start_data:
            if self._spectating_current_game:
                return
            self._pending_updates.append(dict(payload))
            return

        turn_raw = payload.get('turn')
        if turn_raw is None:
            return
        try:
            turn = int(turn_raw)
        except Exception:
            return
        if turn < 0:
            return
        if turn == self._last_turn:
            return

        self._translator.apply_update_payload(payload)
        game_update, meta = self._translator.build_game_update(payload, self._player_ids)

        if self.start_data.get('swamps') == [] and meta.get('swamps'):
            self.start_data['swamps'] = list(meta['swamps'])

        self._queue_update('game_update', game_update)
        self._last_turn = turn

        if bool(payload.get('game_end')):
            kills = payload.get('kills') or {}
            lost = isinstance(kills, dict) and self._client_id in kills
            if lost:
                self._queue_update('game_lost', {'killer': -1})
            else:
                self._queue_update('game_won', None)

    def move(self, y1: int, x1: int, y2: int, x2: int, cols: int, move_half=False):
        del cols
        if self.terminated:
            raise ValueError('Cannot move after termination')

        attack_payload = {
            # Checkmate uses (x,y) as (row,col)
            'x': int(y1),
            'y': int(x1),
            'dx': int(y2),
            'dy': int(x2),
            'half': bool(move_half),
        }
        self._socket.emit('attack', attack_payload)

    def ping_tile(self, y1: int, x1: int, cols: int):
        del y1
        del x1
        del cols
        # Checkmate server does not expose ping_tile endpoint for bots.

    def send_chat(self, msg, teamChat: bool = False):
        if self.terminated:
            return
        text = str(msg or '').strip()
        if not text:
            return
        self._socket.emit('send_message', {'text': text, 'team': bool(teamChat)})

    def send_clear_moves(self):
        if self.terminated:
            return
        self._socket.emit('clear_queue')

    def send_surrender(self):
        if self.terminated:
            return
        self._socket.emit('surrender')

    def close(self):
        self._terminate()

    def _terminate(self):
        if self.terminated:
            return
        self.terminated = True
        self._stopped = True
        try:
            if self._socket.connected:
                self._socket.disconnect()
        except Exception:
            logbook.error('disconnect failed:\n' + traceback.format_exc())
        self._queue_update('__closed__', None)

    def get_updates(self) -> typing.Generator[typing.Tuple[str, dict], typing.Any, typing.Any]:
        while True:
            if self.terminated and self._updates.empty():
                break

            try:
                update_type, payload = self._updates.get(timeout=1.0)
            except queue.Empty:
                continue

            if update_type == '__closed__':
                break

            yield update_type, payload


# Keep original helper import path used by bot modules.
def _spawn(f):
    t = threading.Thread(target=f)
    t.daemon = True
    t.start()
    return t
