import path from 'node:path';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { Server as SocketIOServer } from 'socket.io';
import { UserStore } from './auth-store';
import { GameEngine } from './game-engine';
import { encodeReplayPatchBinary } from './replay-patch-binary';
import { isReplayIdValid, ReplayStore } from './replay-store';
import { ensureRuntimeEnv } from './runtime-env';
import { LobbyConfig, MAX_TEAMS } from './types';
import { AuthRequest, AuthService } from './server/auth-service';
import { CaptchaService } from './server/captcha-service';
import { EditableLobbyKey, LobbyService } from './server/lobby-service';
import { WebhookUpdater } from './server/webhook-updater';

const runtimeEnv = ensureRuntimeEnv();
const app = Fastify({ logger: true });

const replayStore = new ReplayStore(path.join(process.cwd(), 'data', 'replays'), {
  buildReplayFromActions: GameEngine.buildReplayFromActions,
});
const userStore = new UserStore(path.join(process.cwd(), 'data'));
const authService = new AuthService(userStore);
const captchaService = new CaptchaService();
const lobbyService = new LobbyService(replayStore);
const webhookUpdater = new WebhookUpdater(app.log, runtimeEnv.webhookSecret);

type PushWebhookPayload = { ref?: unknown };
const GENERAL_RATE_LIMIT = { max: 1000, timeWindow: '1 minute' };
const WEBHOOK_RATE_LIMIT = { max: 20, timeWindow: '1 minute' };
const AUTH_PAGE_RATE_LIMIT = { max: 60, timeWindow: '1 minute' };
const AUTH_ACTION_RATE_LIMIT = { max: 20, timeWindow: '1 minute' };

const parseJsonObject = (text: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
};

const readHeaderValue = (headers: Record<string, unknown>, key: string): string | null => {
  const value = headers[key];
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return null;
};

const parsePushWebhookPayload = (
  body: unknown,
  rawBody: Buffer,
  headers: Record<string, unknown>,
): PushWebhookPayload | null => {
  const rawText = rawBody.toString('utf8');
  const directJson = parseJsonObject(rawText);
  if (directJson) {
    return directJson;
  }

  const contentType = readHeaderValue(headers, 'content-type') ?? '';
  const mightBeFormBody =
    contentType.includes('application/x-www-form-urlencoded') || rawText.includes('payload=');
  if (mightBeFormBody) {
    const encodedPayload = new URLSearchParams(rawText).get('payload');
    if (encodedPayload) {
      const parsedPayload = parseJsonObject(encodedPayload);
      if (parsedPayload) {
        return parsedPayload;
      }
    }
  }

  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
    const bodyObject = body as Record<string, unknown>;
    if (typeof bodyObject.payload === 'string') {
      const payloadInBody = parseJsonObject(bodyObject.payload);
      if (payloadInBody) {
        return payloadInBody;
      }
    }
    if ('ref' in bodyObject) {
      return bodyObject;
    }
  }

  return null;
};

if (runtimeEnv.createdKeys.length > 0) {
  app.log.info({ keys: runtimeEnv.createdKeys }, '已自动补全缺失环境变量到 .env。');
}

const boot = async (): Promise<void> => {
  await replayStore.ensureReady();
  await userStore.ensureReady();

  await app.register(fastifyRateLimit, {
    max: GENERAL_RATE_LIMIT.max,
    timeWindow: GENERAL_RATE_LIMIT.timeWindow,
  });
  app.addHook('onRequest', app.rateLimit(GENERAL_RATE_LIMIT));

  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0];
    if (authService.isPublicPath(pathname)) {
      return;
    }

    const token = authService.getTokenFromCookie(request.headers.cookie);
    const authUser = authService.verifyAuthToken(token);
    if (!authUser) {
      if (pathname.startsWith('/api/')) {
        return reply.code(401).send({ error: '未登录或登录已失效。' });
      }
      return reply.redirect('/login');
    }

    (request as AuthRequest).authUser = authUser;
  });

  await app.register(fastifyStatic, {
    root: path.join(process.cwd(), 'static'),
    prefix: '/',
  });

  await app.register(async (webhookApp) => {
    webhookApp.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, payload, done) => {
      done(null, payload);
    });

    webhookApp.post('/postreceive', { config: { rateLimit: WEBHOOK_RATE_LIMIT } }, async (request, reply) => {
      const body = request.body;
      const rawBody = Buffer.isBuffer(body)
        ? body
        : Buffer.from(typeof body === 'string' ? body : body ? JSON.stringify(body) : '');
      const headers = request.headers as Record<string, unknown>;

      if (!webhookUpdater.isAuthorized(rawBody, headers)) {
        return reply.code(401).send({ error: 'Webhook signature verification failed.' });
      }

      const eventHeader = request.headers['x-github-event'];
      const event =
        typeof eventHeader === 'string'
          ? eventHeader
          : Array.isArray(eventHeader) && typeof eventHeader[0] === 'string'
            ? eventHeader[0]
            : '';

      if (event === 'ping') {
        return reply.send({ ok: true, event: 'ping' });
      }

      if (event === 'push') {
        const payload = parsePushWebhookPayload(body, rawBody, headers);
        if (!payload) {
          return reply.code(400).send({ error: 'Invalid webhook payload.' });
        }

        if (payload?.ref !== 'refs/heads/main') {
          return reply.send({ ok: true, ignored: true, reason: 'non-main push' });
        }
      }

      const queued = webhookUpdater.requestUpdate();
      return reply.code(202).send({ ok: true, queued });
    });
  });

  app.get('/login', { config: { rateLimit: AUTH_PAGE_RATE_LIMIT } }, async (request, reply) => {
    const token = authService.getTokenFromCookie(request.headers.cookie);
    const authUser = authService.verifyAuthToken(token);
    if (authUser) {
      return reply.redirect('/');
    }
    return reply.sendFile('login.html');
  });

  app.get('/api/auth/captcha', { config: { rateLimit: AUTH_ACTION_RATE_LIMIT } }, async (_request, reply) => {
    return reply.send(captchaService.createChallenge());
  });

  app.post(
    '/api/auth/register',
    { config: { rateLimit: AUTH_ACTION_RATE_LIMIT } },
    async (request, reply) => {
      const body = request.body as {
        username?: string;
        password?: string;
        captchaId?: string;
        captchaCode?: string;
      };
      const usernameRaw = String(body?.username ?? '');
      const password = String(body?.password ?? '');
      const captchaId = String(body?.captchaId ?? '');
      const captchaCode = String(body?.captchaCode ?? '');

      const captchaCheck = captchaService.verifyAndConsume(captchaId, captchaCode);
      if (!captchaCheck.ok) {
        return reply.code(400).send({ error: captchaCheck.error ?? '验证码校验失败。' });
      }

      try {
        const username = await userStore.register(usernameRaw, password);
        const sessionId = await userStore.rotateSession(username);
        authService.disconnectUserSockets(username);
        const token = authService.signAuthToken(username, sessionId);
        authService.setAuthCookie(reply, token);
        return reply.send({ username });
      } catch (error) {
        const message = error instanceof Error ? error.message : '注册失败。';
        const status = message.includes('存在') ? 409 : 400;
        return reply.code(status).send({ error: message });
      }
    },
  );

  app.post('/api/auth/login', { config: { rateLimit: AUTH_ACTION_RATE_LIMIT } }, async (request, reply) => {
    const body = request.body as {
      username?: string;
      password?: string;
      captchaId?: string;
      captchaCode?: string;
    };
    const usernameRaw = String(body?.username ?? '');
    const password = String(body?.password ?? '');
    const captchaId = String(body?.captchaId ?? '');
    const captchaCode = String(body?.captchaCode ?? '');

    const captchaCheck = captchaService.verifyAndConsume(captchaId, captchaCode);
    if (!captchaCheck.ok) {
      return reply.code(400).send({ error: captchaCheck.error ?? '验证码校验失败。' });
    }

    const username = userStore.verifyPassword(usernameRaw, password);
    if (!username) {
      return reply.code(401).send({ error: '用户名或密码错误。' });
    }

    const sessionId = await userStore.rotateSession(username);
    authService.disconnectUserSockets(username);

    const token = authService.signAuthToken(username, sessionId);
    authService.setAuthCookie(reply, token);
    return reply.send({ username });
  });

  app.post('/api/auth/logout', { config: { rateLimit: AUTH_ACTION_RATE_LIMIT } }, async (request, reply) => {
    const token = authService.getTokenFromCookie(request.headers.cookie);
    const authUser = authService.verifyAuthToken(token);
    if (authUser) {
      await userStore.clearSession(authUser.username);
      authService.disconnectUserSockets(authUser.username);
    }
    authService.clearAuthCookie(reply);
    return reply.send({ ok: true });
  });

  app.get('/api/auth/me', async (request, reply) => {
    const authUser = (request as AuthRequest).authUser;
    if (!authUser) {
      return reply.code(401).send({ error: '未登录或登录已失效。' });
    }
    return reply.send({ username: authUser.username });
  });

  app.get('/games/:game_id', async (request, reply) => {
    const params = request.params as { game_id: string };
    const gameId = params.game_id;
    if (gameId.length === 0 || gameId.length > 15) {
      return reply.redirect(`/games/${lobbyService.randomRoomId()}`);
    }
    return reply.sendFile('game.html');
  });

  app.get('/', async (_request, reply) => reply.sendFile('index.html'));

  app.get('/rooms', async (_request, reply) => reply.sendFile('rooms.html'));

  app.get('/replays', async (_request, reply) => reply.sendFile('replays.html'));

  app.get('/about', async (_request, reply) => reply.sendFile('about.html'));

  app.get('/games', async (_request, reply) => {
    let html = '';
    let count = 0;
    for (const game of lobbyService.gameInstances.values()) {
      count += 1;
      html += `房间${count}：${game.names.join(' ')}<br>`;
    }
    return reply.type('text/html').send(html);
  });

  app.get('/replays/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isReplayIdValid(id)) {
      return reply.type('text/plain').send('');
    }
    return reply.sendFile('game.html');
  });

  app.get('/api/getreplay/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isReplayIdValid(id)) {
      return reply.type('text/plain').send('');
    }
    try {
      const replay = await replayStore.loadReplay(id);
      const binary = encodeReplayPatchBinary(replay);
      return reply.type('application/octet-stream').send(binary);
    } catch {
      return reply.code(404).send({ error: '回放不存在。' });
    }
  });

  app.get('/api/replays', async (request, reply) => {
    const authUser = (request as AuthRequest).authUser;
    if (!authUser) {
      return reply.code(401).send({ error: '未登录或登录已失效。' });
    }

    const query = request.query as { offset?: unknown; limit?: unknown };
    const offsetRaw = Number.parseInt(String(query.offset ?? '0'), 10);
    const limitRaw = Number.parseInt(String(query.limit ?? '50'), 10);
    const offset = Number.isNaN(offsetRaw) || offsetRaw < 0 ? 0 : offsetRaw;
    const limit = Number.isNaN(limitRaw) || limitRaw <= 0 ? 50 : Math.min(limitRaw, 50);

    const allItems = await replayStore.listReplays();
    const ownItems = allItems.filter((item) => item.rank.includes(authUser.username));
    const items = ownItems.slice(offset, offset + limit);
    const next_offset = offset + items.length;
    const has_more = next_offset < ownItems.length;

    return reply.send({ items, next_offset, has_more });
  });

  app.get('/api/rooms', async (_request, reply) => {
    return reply.send(lobbyService.listLobbyRooms());
  });

  app.get('/favicon.ico', async (_request, reply) => reply.code(204).send());

  app.setNotFoundHandler(async (request, reply) => {
    const reqPath = request.url.split('?')[0] || '/';
    if (reqPath === '/favicon.ico' || reqPath.startsWith('/api/') || reqPath.startsWith('/socket.io/')) {
      return reply.code(404).type('text/plain').send('Not Found');
    }
    if (reqPath.includes('.') && !reqPath.startsWith('/games/')) {
      return reply.code(404).type('text/plain').send('Not Found');
    }
    return reply.redirect(`/games/${lobbyService.randomRoomId()}`);
  });

  const io = new SocketIOServer(app.server, {
    transports: ['websocket', 'polling'],
  });
  authService.attachSocketServer(io);

  io.use((socket, next) => {
    const fromHandshake =
      typeof socket.handshake.auth?.token === 'string' ? String(socket.handshake.auth.token) : null;
    const fromCookie = authService.getTokenFromCookie(socket.handshake.headers.cookie);
    const authUser = authService.verifyAuthToken(fromHandshake ?? fromCookie);

    if (!authUser) {
      next(new Error('未登录或登录已失效。'));
      return;
    }

    socket.data.username = authUser.username;
    next();
  });

  io.on('connection', (socket) => {
    const username = String(socket.data.username ?? '');
    if (!username) {
      socket.disconnect(true);
      return;
    }

    authService.disconnectOtherUserSockets(username, socket.id);
    authService.trackSocket(username, socket.id);
    socket.join(`sid_${socket.id}`);
    socket.emit('set_id', lobbyService.md5(socket.id));

    socket.on('attack', (data: { x: unknown; y: unknown; dx: unknown; dy: unknown; half: unknown }) => {
      const gid = lobbyService.gameUid.get(socket.id);
      if (!gid) {
        return;
      }
      lobbyService.gameInstances
        .get(gid)
        ?.addMove(
          socket.id,
          Number.parseInt(String(data.x), 10),
          Number.parseInt(String(data.y), 10),
          Number.parseInt(String(data.dx), 10),
          Number.parseInt(String(data.dy), 10),
          Boolean(data.half),
        );
    });

    socket.on('clear_queue', () => {
      const gid = lobbyService.gameUid.get(socket.id);
      if (!gid) {
        return;
      }
      lobbyService.gameInstances.get(gid)?.clearQueue(socket.id);
    });

    socket.on('pop_queue', () => {
      const gid = lobbyService.gameUid.get(socket.id);
      if (!gid) {
        return;
      }
      lobbyService.gameInstances.get(gid)?.popQueue(socket.id);
    });

    socket.on('join_game_room', (data: { room?: string }) => {
      const room = String(data.room ?? '').trim();
      if (room.length === 0 || room.length > 15) {
        return;
      }
      const roomVal = lobbyService.getLobbyVal(room);

      if (!lobbyService.lobbyOfSid.has(socket.id)) {
        lobbyService.joinLobby(socket.id, username, room);
        socket.join(`game_${roomVal}`);
        lobbyService.emitRoomUpdate(io, room);
        lobbyService.sendLobbySystemMessage(io, roomVal, `${username} 加入了自定义房间。`);
        if (lobbyService.isLobbyGameRunning(room)) {
          lobbyService.gameInstances.get(roomVal)?.addSpectator(socket.id);
        }
      }
    });

    socket.on('change_team', (data: { team: unknown }) => {
      const gid = lobbyService.lobbyOfSid.get(socket.id);
      if (!gid) {
        return;
      }
      if (lobbyService.isLobbyGameRunning(gid)) {
        lobbyService.emitRoomUpdate(io, gid);
        return;
      }

      const conf = lobbyService.lobbyConfig.get(gid);
      if (!conf) {
        return;
      }

      let team = Number.parseInt(String(data.team), 10);
      if (Number.isNaN(team) || team < 0 || team > MAX_TEAMS) {
        return;
      }
      if (!conf.allow_team && team !== 0) {
        team = 1;
      }

      const players = lobbyService.lobbyPlayers.get(gid);
      if (!players) {
        return;
      }

      const player = players.find((item) => item.sid === socket.id);
      if (!player) {
        return;
      }

      const currentTeam = player.team;
      const isCurrentPlayer = currentTeam !== 0;
      const isNextPlayer = team !== 0;
      const playingCount = players.filter((item) => item.team !== 0).length;
      if (isNextPlayer && !isCurrentPlayer && playingCount >= MAX_TEAMS) {
        lobbyService.emitRoomUpdate(io, gid);
        return;
      }

      let nickname = username;
      player.team = team;
      if (team === 0) {
        player.ready = false;
      }
      nickname = player.uid;

      lobbyService.emitRoomUpdate(io, gid);
      const teamName = team === 0 ? '观战席' : conf.allow_team ? `队伍 ${team}` : '参赛者';
      lobbyService.sendLobbySystemMessage(
        io,
        lobbyService.getLobbyVal(gid),
        `${nickname} 加入了${teamName}。`,
      );
    });

    socket.on('change_ready', (data: { ready: unknown }) => {
      const gid = lobbyService.lobbyOfSid.get(socket.id);
      if (!gid) {
        return;
      }
      if (lobbyService.isLobbyGameRunning(gid)) {
        lobbyService.emitRoomUpdate(io, gid);
        return;
      }

      const players = lobbyService.lobbyPlayers.get(gid);
      if (!players) {
        return;
      }

      for (const player of players) {
        if (player.sid === socket.id) {
          player.ready = player.team !== 0 && Boolean(data.ready);
          break;
        }
      }

      lobbyService.checkReady(io, gid);
    });

    socket.on('change_game_conf', (data: Record<string, unknown>) => {
      try {
        const gid = lobbyService.lobbyOfSid.get(socket.id);
        if (!gid) {
          return;
        }
        if (lobbyService.isLobbyGameRunning(gid)) {
          lobbyService.emitRoomUpdate(io, gid);
          return;
        }

        const oldConf = lobbyService.lobbyConfig.get(gid);
        if (!oldConf) {
          return;
        }

        const players = lobbyService.lobbyPlayers.get(gid);
        if (!players) {
          return;
        }

        const roomVal = lobbyService.getLobbyVal(gid);
        const isHost = players[0]?.sid === socket.id || players[0]?.uid === username;
        if (!isHost) {
          lobbyService.emitRoomUpdate(io, gid);
          return;
        }

        const payload = data && typeof data === 'object' ? data : {};
        const nextConf: LobbyConfig = { ...oldConf };
        const changed: EditableLobbyKey[] = [];
        const hasOwn = (key: string): boolean => Object.prototype.hasOwnProperty.call(payload, key);

        if (hasOwn('speed')) {
          const speed = lobbyService.parseFloatRange(payload.speed, 0.5, 4);
          if (speed !== oldConf.speed) {
            nextConf.speed = speed;
            changed.push('speed');
          }
        }

        if (hasOwn('allow_team')) {
          const allowTeamRaw = payload.allow_team;
          const allowTeam = Boolean(
            allowTeamRaw === true || allowTeamRaw === 1 || allowTeamRaw === '1' || allowTeamRaw === 'true',
          );
          if (allowTeam !== oldConf.allow_team) {
            nextConf.allow_team = allowTeam;
            changed.push('allow_team');
          }
        }

        if (hasOwn('map_mode')) {
          const mapModeRaw = String(payload.map_mode ?? oldConf.map_mode);
          const mapMode: LobbyConfig['map_mode'] = mapModeRaw === 'maze' ? 'maze' : 'random';
          if (mapMode !== oldConf.map_mode) {
            nextConf.map_mode = mapMode;
            changed.push('map_mode');
          }
        }

        if (hasOwn('map_token')) {
          const mapToken = lobbyService.normalizeMapToken(payload.map_token);
          if (mapToken !== oldConf.map_token) {
            nextConf.map_token = mapToken;
            changed.push('map_token');
          }
        }

        if (changed.length === 0) {
          return;
        }

        let playingCount = 0;
        for (const player of players) {
          if (player.team === 0) {
            continue;
          }
          if (playingCount >= MAX_TEAMS) {
            player.team = 0;
            player.ready = false;
            continue;
          }
          if (!nextConf.allow_team) {
            player.team = 1;
          }
          playingCount += 1;
        }

        lobbyService.lobbyConfig.set(gid, nextConf);

        lobbyService.emitRoomUpdate(io, gid);

        for (const key of changed) {
          lobbyService.sendLobbySystemMessage(
            io,
            roomVal,
            `${players[0].uid} 将${lobbyService.formatConfLabel(key)}改为 ${lobbyService.formatConfValue(key, nextConf[key])}。`,
          );
        }
      } catch {
        return;
      }
    });

    socket.on('send_message', (data: { text: string; team: boolean }) => {
      const text = String(data.text ?? '').trim();
      if (!text) {
        return;
      }

      const gid = lobbyService.gameUid.get(socket.id);
      if (gid) {
        lobbyService.gameInstances.get(gid)?.sendMessage(socket.id, {
          text,
          team: Boolean(data.team),
        });
        return;
      }

      const lobbyId = lobbyService.lobbyOfSid.get(socket.id);
      if (!lobbyId) {
        return;
      }

      const players = lobbyService.lobbyPlayers.get(lobbyId);
      if (!players) {
        return;
      }

      let color = 0;
      let uid = username;
      for (let i = 0; i < players.length; i += 1) {
        if (players[i].sid === socket.id) {
          color = i + 1;
          uid = players[i].uid;
          break;
        }
      }

      lobbyService.sendSystemMessage(io, lobbyService.getLobbyVal(lobbyId), 'room', uid, color, text);
    });

    socket.on('surrender', () => {
      const gid = lobbyService.gameUid.get(socket.id);
      if (!gid) {
        return;
      }
      lobbyService.gameInstances.get(gid)?.surrender(socket.id);
    });

    const doReturnRoom = (): void => {
      const changed = lobbyService.returnToRoom(io, socket.id);
      if (changed || lobbyService.lobbyOfSid.has(socket.id)) {
        io.to(`sid_${socket.id}`).emit('left', {});
      }
    };

    socket.on('return_room', doReturnRoom);
    socket.on('leave', doReturnRoom);

    socket.on('disconnect', () => {
      authService.untrackSocket(username, socket.id);
      socket.leave(`sid_${socket.id}`);
      lobbyService.checkLeave(io, socket.id, (room) => {
        socket.leave(room);
      });
    });
  });

  await app.listen({ host: '0.0.0.0', port: 23333 });
};

void boot();
