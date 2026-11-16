// Сервер игры: раздаёт страницы, держит партию и рассылает её телефонам и общему экрану.
// Никаких зависимостей: хватает Node. Запуск: node server.js
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { FACTIONS } from './public/js/hex.js';
import { cleanName } from './public/js/balance.js';
import { makeLegend } from './public/js/legends.js';
import {
  applyAction, cmdAnswer, cmdLeave, cmdOffer, cmdReturn, endGame, newGame, publicMap, publicState, restoreState, results, saveReplacer, saveReviver,
} from './src/game.js';
import { botAccepts, botAction } from './src/bot.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.jpg': 'image/jpeg',
};
const MAX_SEATS = FACTIONS.length;
const REEL_LIMIT = 300000;  // дольше показа хода партия не ждёт
const SHOWING = 'Идёт показ хода на общем экране';

let humans = [];            // { token, name, online }: name это имя князя
let botCount = 1;
let lastLegend = null;      // { hero, omen } прошлой партии: новая их не повторяет
let game = null;
let seats = [];             // token → номер игрока в партии, по порядку мест
let seq = 0;
let reel = [];              // события хода, которые ждут показа на общем экране
let reelId = 0, ackReel = 0;
let showing = false;        // общий экран показывает итоги хода, телефоны ждут
let stage = null;           // партия на начало хода: с неё общий экран начинает показ хода
let liveTimer = null;       // свежая партия для общего экрана уже ждёт отправки
let botsRunning = false;
const clients = new Set();  // { res, role, token }

// Сохранение. Партия и места игроков пишутся на диск раз в ход: в начале партии и в конце каждого хода.
// Действия посреди хода на диск не пишутся, только отмечаются: их сохранит конец хода или остановка сервера.
// После перезапуска сервер продолжает партию с того же места, телефоны входят на свои места по своим токенам;
// после падения — с начала текущего хода. Кончилась партия или нажато «Заново» — сохранение удаляется.
const SAVE_FILE = process.env.SAVE_FILE || join(fileURLToPath(new URL('.', import.meta.url)), 'save', 'game.json');
let saveDirty = false;
const markSave = () => { saveDirty = true; };

function dropSave() {
  try { unlinkSync(SAVE_FILE); } catch {}
}

function saveNow() {
  saveDirty = false;
  if (!game || game.phase !== 'play') return dropSave();
  try {
    mkdirSync(dirname(SAVE_FILE), { recursive: true });
    const data = {
      version: 1, savedAt: Date.now(), seats, humans: humans.map(({ token, name }) => ({ token, name })),
      botCount, lastLegend, hurry: hurryOn, game,
    };
    writeFileSync(`${SAVE_FILE}.tmp`, JSON.stringify(data, saveReplacer));
    renameSync(`${SAVE_FILE}.tmp`, SAVE_FILE);
  } catch (err) {
    console.error(`Сохранение не записалось: ${err.message}`);
  }
}

function loadSave() {
  if (!existsSync(SAVE_FILE)) return;
  try {
    const data = JSON.parse(readFileSync(SAVE_FILE, 'utf8'), saveReviver);
    if (data.game?.phase !== 'play') return;
    game = restoreState(data.game, Math.floor(Math.random() * 1e9));
    seats = data.seats;
    humans = data.humans.map(h => ({ ...h, online: false }));
    botCount = data.botCount ?? botCount;
    lastLegend = data.lastLegend ?? null;
    hurryOn = data.hurry ?? hurryOn;
    stage = publicState(game, null);
    console.log(`Партия продолжена с хода ${game.turn}`);
  } catch (err) {
    console.error(`Сохранение не прочиталось: ${err.message}`);
  }
}

// Сервер останавливают: несохранённое пишется перед выходом.
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, () => {
    if (saveDirty) saveNow();
    process.exit(0);
  });
}

function send(client, type, data) {
  client.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}
const broadcast = (type, data) => { for (const c of clients) send(c, type, data); };

function lanAddress(port) {
  const found = Object.values(networkInterfaces()).flat()
    .filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
  const ip = found.find(a => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a)) || found[0] || 'localhost';
  return `http://${ip}:${port}`;
}

const lobbyView = () => ({
  address: lanAddress(server.address().port),
  humans: humans.map((h, i) => ({ name: h.name, online: h.online, faction: i })),
  bots: botCount,
  maxSeats: MAX_SEATS,
  playing: !!game,
  canLateJoin: !!game && game.players.some(p => p.bot && !p.out),
  lastWait: LAST_WAIT,        // правило «20 секунд последним» есть на сервере
  lastFew: LAST_FEW,          // и оно ждёт двоих: внешний сторож не нужен
  hurry: hurryOn,             // включено ли оно в настройках общего экрана
});

const viewerOf = client => {
  if (client.role !== 'phone') return null;
  const pid = seats.indexOf(client.token);
  return pid >= 0 ? pid : null;
};

const phoneState = viewer => ({ ...publicState(game, viewer), showing });

// Дороги на общем экране: клетки с дорогой прямо сейчас.
const roadCells = () => game.map.tiles.filter(t => t.road).map(t => t.id);

function stateFor(client) {
  if (client.role === 'phone') return { ...phoneState(viewerOf(client)), seq };
  return { ...stage, players: publicState(game, null).players, roads: roadCells(), seq };
}

function welcome(client) {
  send(client, 'lobby', lobbyView());
  if (game) {
    send(client, 'map', publicMap(game.map));
    send(client, 'state', stateFor(client));
    if (client.role === 'screen' && !showing) sendLive(client);
  }
}

const screens = () => [...clients].filter(c => c.role === 'screen').length;

// Общий экран видит партию сразу, как телефоны: войска, остроги, землю. Находок и лагерей ему не видно.
// Частые приказы сливаются в одну отправку, не чаще раза в LIVE_GAP.
const LIVE_GAP = 250;
const liveView = () => ({ ...publicState(game, null), roads: roadCells() });

function sendLive(client) {
  if (game) send(client, 'status', liveView());
}

function sendStatus() {
  if (liveTimer || !screens()) return;
  liveTimer = setTimeout(() => {
    liveTimer = null;
    if (!game) return;
    const live = liveView();
    for (const c of clients) if (c.role === 'screen') send(c, 'status', live);
  }, LIVE_GAP);
}

// Телефон сразу получает всю карту, в том числе ходы соперников, а находки только свои.
// Общий экран тоже видит ход сразу, а в конце хода показывает его целиком, с начала. Состояние уходит
// и без событий: приказ и его отмена в журнал не пишутся.
function flush() {
  if (!game) return;
  const events = game.log.splice(0);
  const ended = events.some(e => e.type === 'turn' || e.type === 'over');
  seq++;
  reel.push(...events.filter(e => e.only == null && e.type !== 'ready'));
  if (ended && screens()) showing = true;
  if (ended) saveNow();
  else markSave();
  for (const c of clients) {
    if (c.role !== 'phone') continue;
    const viewer = viewerOf(c);
    const seen = events.filter(e => e.only == null || e.only === viewer);
    send(c, 'batch', { seq, events: seen, after: phoneState(viewer) });
  }
  if (ended) playReel();
  else sendStatus();
}

// Общий экран показывает итоги хода, и только потом начинается следующий.
function waitForScreen(id, session) {
  return new Promise(resolve => {
    const started = Date.now();
    const check = () => {
      if (game !== session || !screens() || ackReel >= id || Date.now() - started > REEL_LIMIT) return resolve();
      setTimeout(check, 100);
    };
    check();
  });
}

// Экран дождались: телефоны продолжают, а боты начинают ход.
async function endShow(id, session) {
  await waitForScreen(id, session);
  if (game !== session) return;
  showing = false;
  for (const c of clients) if (c.role === 'phone') send(c, 'state', stateFor(c));
  runBots();
}

async function playReel() {
  const session = game, events = reel.splice(0);
  stage = publicState(game, null);
  if (!showing) return;
  const id = ++reelId;
  const ended = events.find(e => e.type === 'turn')?.ended ?? game.turn;
  for (const c of clients) if (c.role === 'screen') send(c, 'reel', { id, ended, events, after: stage });
  await endShow(id, session);
}

// Перед первым ходом общий экран рассказывает легенду, телефоны ждут, как при показе хода.
function playLegend() {
  const id = ++reelId;
  for (const c of clients) if (c.role === 'screen') send(c, 'legend', { id, legend: stage.legend });
  return endShow(id, game);
}

function sendOffers() {
  for (const c of clients) {
    const viewer = viewerOf(c);
    if (viewer != null) send(c, 'offers', game.offers.filter(o => o.to === viewer || o.from === viewer));
  }
}

const breath = ms => new Promise(resolve => setTimeout(resolve, ms));

// Предложение бота: другой бот отвечает сразу, человек увидит его на пульте и ответит сам.
function botOffer(pid, { to, kind, give }) {
  const out = cmdOffer(game, pid, { to, kind, give });
  if (out.error) return;
  if (game.players[to].bot) cmdAnswer(game, to, out.offer.id, botAccepts(game, out.offer));
  sendOffers();
}

// Боты ходят, как только начался ход: общий экран всё равно покажет его целиком в конце.
async function runBots() {
  if (botsRunning) return;
  botsRunning = true;
  try {
    while (game && game.phase === 'play' && !showing) {
      // Порядок случаен: кто ходит последним, тот выбирает бои, и это не должно доставаться одному месту за столом.
      const waiting = game.players.filter(p => p.bot && !p.out && !p.done);
      if (!waiting.length) break;
      const bot = waiting[Math.floor(Math.random() * waiting.length)];
      const pid = bot.id, done = new Set();
      let act;
      // Ход бота уходит телефонам одним пакетом: пакет на каждый шаг перерисовывал пульт десятки раз подряд.
      while (game.phase === 'play' && (act = botAction(game, pid, done))) {
        if (act.type === 'offer') { botOffer(pid, act); continue; }
        if (applyAction(game, pid, act)) break;
      }
      if (game.phase === 'play') applyAction(game, pid, { type: 'end' });
      flush();
      await breath(screens() ? 0 : 120);
    }
  } finally {
    botsRunning = false;
  }
}

// Последние: остальные уже сходили, ждут не больше двух людей. Через 20 секунд ход за них заканчивается,
// новых ходов за них никто не делает. Отсчёт идёт с минуты, когда ждать осталось двоих или одного,
// и не начинается заново, если один из них сходил сам. Хотя бы один человек должен уже сходить:
// начало хода и игру одного с ботами это не торопит. Пока ходит бот, отсчёта нет.
// Включается в настройках общего экрана, после запуска сервера выключено.
const LAST_WAIT = 20000, LAST_FEW = 2;
let hurryOn = true;           // «20 секунд последним» включено сразу после запуска (с 15 ноября), выключается в настройках экрана
let lastWait = null;          // { turn, since }: с какого времени ждут последних
function hurryLast() {
  if (!hurryOn || !game || game.phase !== 'play' || showing) { lastWait = null; return; }
  const active = game.players.filter(p => !p.out && !p.left);
  const waiting = active.filter(p => !p.done);
  const someoneDone = active.some(p => !p.bot && p.done);
  if (!waiting.length || waiting.length > LAST_FEW || waiting.some(p => p.bot) || !someoneDone) { lastWait = null; return; }
  if (lastWait?.turn !== game.turn) { lastWait = { turn: game.turn, since: Date.now() }; return; }
  if (Date.now() - lastWait.since < LAST_WAIT) return;
  lastWait = null;
  let ended = false;
  for (const p of waiting) if (!applyAction(game, p.id, { type: 'end' })) ended = true;
  if (!ended) return;
  flush();
  sendOffers();
  runBots();
}
setInterval(hurryLast, 1000);

function startGame() {
  // Телефоны, которые давно отключились, места не занимают: их ход повесил бы партию.
  humans = humans.filter(h => h.online);
  const list = [
    ...humans.map(h => ({ name: h.name, token: h.token })),
    ...Array.from({ length: botCount }, () => ({ name: 'Бот', bot: true })),
  ];
  if (list.length < 2) return 'Нужно хотя бы двое: игрок и бот или два бота';
  seats = list.map(p => p.token || null);
  // Легенда случайна сама по себе и не зависит от зерна карты.
  const legend = makeLegend(Math.random, list.length, lastLegend);
  lastLegend = { hero: legend.hero, omen: legend.omen };
  game = newGame(list, undefined, { legend });
  seq = 0;
  reel = [];
  showing = screens() > 0;
  game.log.length = 0;
  stage = publicState(game, null);
  broadcast('lobby', lobbyView());
  for (const c of clients) {
    send(c, 'map', publicMap(game.map));
    send(c, 'state', stateFor(c));
  }
  saveNow();
  if (showing) playLegend();
  else runBots();
  return null;
}

const api = {
  join({ name, token }) {
    const clean = cleanName(name);
    let seat = humans.find(h => h.token === token);
    if (!seat && clean) {
      const same = humans.find(h => h.name.toLowerCase() === clean.toLowerCase());
      if (same?.online && !game) return { error: 'Это имя уже занято' };
      seat = same;             // вошёл заново, например с другого телефона
    }
    if (seat) {
      const pid = game ? seats.indexOf(seat.token) : -1;
      if (pid >= 0 && game.players[pid].left) { cmdReturn(game, pid); flush(); }
      return { token: seat.token, name: seat.name, faction: Math.max(0, game ? pid : humans.indexOf(seat)) };
    }
    if (!clean) return { error: 'Введите имя' };
    if (game) {
      // Новый игрок в идущей партии занимает место бота.
      // Тёмное царство отдают человеку последним.
      const bots = game.phase === 'play' ? game.players.filter(p => p.bot && !p.out) : [];
      const free = bots.find(p => p.id !== game.dark) || bots[0] || null;
      if (!free) return { error: `Партия уже идёт. Войдите под своим именем: ${humans.map(h => h.name).join(', ')}` };
      seat = { token: randomBytes(8).toString('hex'), name: clean, online: false };
      humans.push(seat);
      free.bot = false;
      free.name = clean;
      seats[free.id] = seat.token;
      markSave();
      broadcast('lobby', lobbyView());
      return { token: seat.token, name: seat.name, faction: free.id };
    }
    // Отключившийся уступает место, если новому игроку иначе некуда сесть.
    if (humans.length >= MAX_SEATS) humans = humans.filter(h => h.online);
    if (humans.length >= MAX_SEATS) return { error: 'Мест больше нет' };
    seat = { token: randomBytes(8).toString('hex'), name: clean, online: false };
    humans.push(seat);
    botCount = Math.min(botCount, MAX_SEATS - humans.length);
    broadcast('lobby', lobbyView());
    return { token: seat.token, name: seat.name, faction: humans.length - 1 };
  },
  // Переключатель «20 секунд последним» с общего экрана. Отсчёт начинается заново с момента включения.
  hurry({ on }) {
    hurryOn = on === true;
    lastWait = null;
    markSave();
    broadcast('lobby', lobbyView());
    return {};
  },
  bots({ count }) {
    if (game) return { error: 'Партия уже идёт' };
    botCount = Math.max(0, Math.min(MAX_SEATS - humans.length, Math.floor(Number(count)) || 0));
    broadcast('lobby', lobbyView());
    return {};
  },
  // Имя князя: по нему игрок входит заново, поэтому оно не повторяет чужое. Царство зовётся всегда одинаково.
  prince({ token, name }) {
    const seat = humans.find(h => h.token === token);
    if (!token || !seat) return { error: 'Вы не в этой партии' };
    const clean = cleanName(name);
    if (!clean) return { error: 'Введите имя князя' };
    if (humans.some(h => h !== seat && h.name.toLowerCase() === clean.toLowerCase())) return { error: 'Это имя уже занято' };
    if (game) {
      if (showing) return { error: SHOWING };
      const pid = seats.indexOf(token);
      if (pid < 0) return { error: 'Вы не в этой партии' };
      const error = applyAction(game, pid, { type: 'prince', name: clean });
      if (error) return { error };
      flush();
    }
    seat.name = clean;
    broadcast('lobby', lobbyView());
    return { name: clean };
  },
  start() {
    if (game) return { error: 'Партия уже идёт' };
    const error = startGame();
    return error ? { error } : {};
  },
  // Идущую партию сбрасывает только кнопка «Заново» на общем экране.
  // Общий экран заканчивает партию в любой момент и показывает итоги.
  finish() {
    if (!game) return { error: 'Партии нет' };
    const error = endGame(game);
    if (error) return { error };
    flush();
    return {};
  },
  // Статистика посреди партии: те же итоги, что в конце, партия идёт дальше.
  stats() {
    if (!game) return { error: 'Партии нет' };
    return { results: results(game, true) };
  },
  reset({ force } = {}) {
    if (game && game.phase === 'play' && !force) return { error: 'Партия ещё идёт' };
    game = null;
    dropSave();
    seats = [];
    reel = [];
    stage = null;
    showing = false;
    humans = humans.filter(h => h.online);
    botCount = Math.min(botCount, MAX_SEATS - humans.length);
    broadcast('lobby', lobbyView());
    return {};
  },
  // Выход: в лобби место освобождается, а в партии царство стоит без хозяина.
  // Вернуться можно под тем же именем.
  leave({ token }) {
    const seat = humans.find(h => h.token === token);
    if (!seat) return {};
    if (!game) {
      humans = humans.filter(h => h !== seat);
      broadcast('lobby', lobbyView());
      return {};
    }
    const pid = seats.indexOf(token);
    if (pid >= 0 && game.phase === 'play') {
      cmdLeave(game, pid, showing);
      flush();
      runBots();
    }
    return {};
  },
  ack({ id }) {
    ackReel = Math.max(ackReel, Number(id) || 0);
    return {};
  },
  cmd({ token, ...act }) {
    if (!game) return { error: 'Партия не идёт' };
    if (act.type === 'prince') return api.prince({ token, name: act.name });
    if (showing) return { error: SHOWING };
    const pid = seats.indexOf(token);
    if (pid < 0 || !token) return { error: 'Вы не в этой партии' };
    const error = applyAction(game, pid, act);
    if (error) return { error };
    flush();
    sendOffers();
    runBots();
    return {};
  },
  offer({ token, to, kind, give, take }) {
    if (!game) return { error: 'Партия не идёт' };
    if (showing) return { error: SHOWING };
    const pid = seats.indexOf(token);
    if (pid < 0 || !token) return { error: 'Вы не в этой партии' };
    const out = cmdOffer(game, pid, { to, kind, give, take });
    if (out.error) return out;
    let answer = 'sent';
    if (game.players[out.offer.to].bot) {
      const accept = botAccepts(game, out.offer);
      cmdAnswer(game, out.offer.to, out.offer.id, accept);
      answer = accept ? 'accepted' : 'refused';
    }
    sendOffers();
    flush();
    return { answer };
  },
  answer({ token, offer, accept }) {
    if (!game) return { error: 'Партия не идёт' };
    if (showing) return { error: SHOWING };
    const pid = seats.indexOf(token);
    if (pid < 0 || !token) return { error: 'Вы не в этой партии' };
    const error = cmdAnswer(game, pid, offer, !!accept);
    sendOffers();
    if (error) return { error };
    flush();
    runBots();
    return {};
  },
};

function events(req, res, url) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 1500\n\n');
  const token = url.searchParams.get('token');
  const client = { res, role: token ? 'phone' : 'screen', token };
  const seat = humans.find(h => h.token === token);
  // Старый токен: сервер перезапущен или партия сменилась, места у телефона больше нет.
  if (token && !seat) {
    send(client, 'gone', { playing: !!game });
    return res.end();
  }
  if (seat) seat.online = true;
  clients.add(client);
  if (seat) broadcast('lobby', lobbyView());
  welcome(client);
  if (client.role === 'screen' && game) ackReel = reelId;
  const beat = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(beat);
    clients.delete(client);
    if (seat && ![...clients].some(c => c.token === token)) {
      seat.online = false;
      broadcast('lobby', lobbyView());
    }
  });
}

function readBody(req) {
  return new Promise(resolve => {
    let raw = '';
    req.on('data', chunk => { if (raw.length < 4096) raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw) || {}); } catch { resolve({}); }
    });
  });
}

async function serveFile(res, path) {
  const safe = normalize(path).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(ROOT, safe));
    res.writeHead(200, { 'Content-Type': MIME[extname(safe)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Не найдено');
  }
}

// Видео идёт кусками: так его можно перематывать, и большой файл не лежит в памяти целиком.
async function serveVideo(req, res, path) {
  const file = join(ROOT, path), size = await stat(file).then(info => info.size).catch(() => 0);
  if (!size) { res.writeHead(404); return res.end('Не найдено'); }
  const head = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' };
  const [, from, to] = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '') || [];
  const start = Number(from || 0), end = Math.min(size - 1, to ? Number(to) : size - 1);
  if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
  if (from === undefined) res.writeHead(200, { ...head, 'Content-Length': size });
  else res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file, { start, end }).pipe(res);
}

const isLocal = req => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '');

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  if (path === '/events') return events(req, res, url);
  if (path.startsWith('/api/') && req.method === 'POST') {
    const name = path.slice(5);
    if (!Object.hasOwn(api, name)) { res.writeHead(404); return res.end(); }
    const body = await readBody(req);
    let out;
    try {
      out = await api[name](body);
    } catch (err) {
      // Партия живёт только в памяти: кривой запрос не должен её убить.
      console.error(err);
      out = { error: 'Ошибка сервера' };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(out || {}));
  }
  // Компьютер с сервером открывает общий экран, а телефоны попадают сразу на пульт.
  if (path === '/') {
    if (isLocal(req)) return serveFile(res, 'screen.html');
    res.writeHead(302, { Location: '/play' });
    return res.end();
  }
  if (path === '/screen') return serveFile(res, 'screen.html');
  if (path === '/play') return serveFile(res, 'play.html');
  if (path === '/how-to-play.mp4') return serveVideo(req, res, 'how-to-play.mp4');
  return serveFile(res, path.slice(1));
});

function listen(port) {
  server.once('error', err => {
    if (err.code === 'EADDRINUSE') listen(port + 1);
    else throw err;
  });
  server.listen(port, '0.0.0.0', () => {
    const { port: bound } = server.address();
    console.log(`Общий экран:  http://localhost:${bound}`);
    console.log(`Для телефонов: ${lanAddress(bound)}`);
    // Запуск с рабочего стола сам открывает общий экран в Google Chrome, какой бы порт ни достался.
    // Хрома нет: подойдёт обычный браузер.
    const url = `http://localhost:${bound}`;
    if (process.env.OPEN_SCREEN) execFile('open', ['-a', 'Google Chrome', url], error => { if (error) execFile('open', [url], () => {}); });
  });
}

loadSave();
listen(Number(process.env.PORT) || 3000);
if (game) runBots();
