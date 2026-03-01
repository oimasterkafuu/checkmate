const Bot = require('./src/Bot');

const BOT_SERVER = String(process.env.BOT_SERVER || 'http://127.0.0.1:23333').trim();
const BOT_ROOM = String(process.env.BOT_ROOM || '').trim();
const BOT_TOKEN = String(process.env.BOT_TOKEN || '').trim();
const BOT_TEAM = Math.max(1, Number.parseInt(String(process.env.BOT_TEAM || '1'), 10) || 1);
const BOT_AUTO_READY = String(process.env.BOT_AUTO_READY || '1') !== '0';

if (!BOT_ROOM) {
  throw new Error('Missing BOT_ROOM. Example: BOT_ROOM=abc123');
}

if (!BOT_TOKEN) {
  throw new Error('Missing BOT_TOKEN. Copy auth_token from browser cookie after login.');
}

const bot = new Bot({
  server: BOT_SERVER,
  room: BOT_ROOM,
  token: BOT_TOKEN,
  team: BOT_TEAM,
  autoReady: BOT_AUTO_READY,
});

bot.start();

process.on('SIGINT', () => {
  console.log('[bot] shutting down');
  bot.stop();
  process.exit(0);
});
