// Общий экран: вся карта целиком, а когда все сходили, показ хода:
// чёрный экран, мультик на карте и слайды. Телефоны ждут, пока показ не кончится.
import { R, center, factionOf, isWater, setDarkSeat, setHordeSeat } from './hex.js';
import { FALLEN_NAMES, GOAL, HEROES, TURN_HINTS, TURN_NAMES, WEATHER } from './balance.js';
import { FAC, STRIKE, banner, dragonFlight, paintObject, soldier, soldierShadow, seeded } from './art.js';
import { MapView, factionId, formation } from './view.js';
import { Battle, BATTLE_TIME } from './battle.js';
import { listen, post } from './net.js';
import { drawQR } from './qr.js';
import { drawCharts, drawLegend } from './charts.js';
import { HURRY_LINES, TITLE_NAMES, lineFor, realmForm, taleFor } from './lines.js';
import { tiesView } from './ties.js';
import * as sound from './sound.js';

const $ = id => document.getElementById(id);
const canvas = $('world');
const ctx = canvas.getContext('2d');

const FALL = 500;              // затемнение перед чёрным экраном
const BLACK = 2200;            // чёрный экран стоит ровно столько
const FADE = 700;              // мягкий уход слайда или занавеса
const TEXT_FADE = 450;         // смена текста между слайдами
const SLIDE_MIN = 3000;        // слайд висит не меньше
const READ_LIMIT = 10;         // столько строк диктор читает со слайда, остальное называет числом
const READ_MS = 34;            // чтение глазами, мс на знак: расчётное время слайда без голоса
const OVER_FADE = 900;         // проявление итогов партии
const FLAME_TIME = 3.2;        // огонь Горыныча, секунды
const POSE = 0.08;             // кадр боя и пламени, секунды
const DRAGON_MS = 3000;        // перелёт Горыныча через карту
const DARK_PACE = 0.6;         // тёмные встречи идут быстрее обычных
const DRAGON_RISE = 0.18;      // доля перелёта на взлёт и на посадку
const TALE_KEEP = 3;           // столько фраз легенды стоит на экране
const TALE_MIN = 2000;         // фраза легенды без голоса держится не меньше
const TALE_END = 2500;         // итог легенды держится после последней фразы

let map = null, view = null;
let shown = null;              // состояние, которое сейчас на экране
let base = null;               // партия на начало хода: с неё мультик показывает ход
let lobby = null;
const queue = [];              // показы, которые ждут своей очереди
let playing = false;
let session = 0;               // растёт при сбросе партии, чтобы старый показ не доигрывался
let freshPlayers = null;       // статус, пришедший во время показа
let freshLive = null;          // свежая партия, пришедшая во время показа: встанет на карту после него
let finale = null;             // состояние с итогами, пока открыт финальный слайд
let peek = null;               // итоги посреди партии, пока открыта статистика

const cam = { x: 0, y: 0, s: 1 };
let flight = null;
const positions = new Map();
const marching = [];
const hidden = new Set();
const fx = [];
const dropFx = f => { const i = fx.indexOf(f); if (i >= 0) fx.splice(i, 1); };
const rising = new Map();

let vw = 0, vh = 0, dpr = 1;

function resize() {
  const box = $('stage').getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  vw = box.width; vh = box.height;
  canvas.width = Math.round(vw * dpr);
  canvas.height = Math.round(vh * dpr);
  if (view && !playing) Object.assign(cam, overview());
}
window.addEventListener('resize', resize);

function overview() {
  const { w, h } = view.size;
  return { x: w / 2, y: h / 2, s: Math.min(vw / w, vh / h) };
}

const closeUp = () => Math.min(vw, vh * 1.5) / (R * 7.5);
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const wait = ms => new Promise(r => setTimeout(r, ms));

// Камера летит по часам: в скрытой вкладке кадров нет, а полёт всё равно кончается по таймеру.
function flyTo(target, ms = 900) {
  flight?.done();
  return new Promise(resolve => {
    const me = { from: { ...cam }, to: target, start: performance.now(), ms };
    me.done = () => {
      clearTimeout(me.timer);
      if (flight === me) { flight = null; Object.assign(cam, target); }
      resolve();
    };
    me.timer = setTimeout(me.done, ms);
    flight = me;
  });
}

// Царства зовутся всегда одинаково, игрок меняет только имя князя.
const realmName = pid => factionOf(pid).name;

function realmDot(pid) {
  const dot = document.createElement('i');
  dot.className = 'dot';
  dot.style.background = FAC[factionId(pid)].main;
  return dot;
}

// Метка в строке разворачивается в кружок цвета царства прямо перед именем.
const DOT = '\uE000';
const named = pid => `${DOT}${pid}${realmName(pid)}`;

// Родительный падеж: «острог Морского царства».
const realmOf = pid => `${DOT}${pid}${realmForm(pid, 'gen')}`;

function putText(node, text) {
  node.textContent = '';
  text.split(new RegExp(`${DOT}(\\d)`)).forEach((part, i) => {
    if (i % 2) node.append(realmDot(Number(part)));
    else if (part) node.append(part);
  });
}

function caption(text) {
  const line = document.createElement('span');
  putText(line, text);
  $('caption').replaceChildren(...(text ? [line] : []));
}

function realmIcon(pid, scale = 2) {
  const icon = document.createElement('canvas');
  paintBanner(icon, pid, scale);
  return icon;
}

function paintBanner(icon, pid, scale) {
  icon.width = 26 * scale; icon.height = 44 * scale;
  const g = icon.getContext('2d');
  g.scale(scale, scale);
  banner(g, 12, 44, 0.3, factionId(pid));
}

function renderBand() {
  if (!shown) return;
  $('turnLabel').textContent = `Ход ${shown.turn} · ${TURN_NAMES[shown.kind]} · ${WEATHER[shown.weather].name}`;
  const box = $('realms');
  box.textContent = '';
  const realms = shown.players.filter(p => !p.horde);
  box.classList.toggle('many', realms.length > 5);
  realms.forEach(p => {
    const row = document.createElement('div');
    row.className = `realm${p.done ? '' : ' active'}${p.out ? ' out' : ''}`;
    const icon = realmIcon(p.id);
    const label = document.createElement('span');
    const ties = shown.relations.filter(r => r[0] === p.id || r[1] === p.id);
    const allies = ties.filter(r => r[2] === 'ally').length, wars = ties.filter(r => r[2] === 'war').length;
    label.append(realmDot(p.id), realmName(p.id));
    const status = document.createElement('small');
    const lost = !p.bot && lobby?.humans.find(h => h.name === p.name)?.online === false;
    const state = p.left ? 'вышел' : lost ? 'нет связи' : p.done ? 'ход сделан' : 'думает';
    status.textContent = [p.bot ? 'бот' : p.name, state, allies ? 'союз' : '', wars ? 'война' : '', p.blight ? 'хворь' : ''].filter(Boolean).join(', ');
    if (lost && !p.left) status.className = 'lost';
    label.append(status);
    row.append(icon, label);
    box.append(row);
  });
}

// «20 секунд последним» живёт на сервере: экран лишь показывает его и переключает.
function renderSwitches() {
  const pairs = [['musicBtn', 'Музыка', sound.isMusicOn()], ['voiceBtn', 'Диктор', sound.isVoiceOn()],
    ['hurryBtn', '20 секунд последним', !!lobby?.hurry]];
  for (const [id, name, on] of pairs) {
    $(id).textContent = `${name}: ${on ? 'вкл' : 'выкл'}`;
    $(id).classList.toggle('on', on);
    $(id).setAttribute('aria-pressed', String(on));
  }
}

// Музыка следует за игрой: тревожнее на войне и в грозу, глуше в дождь и туман, мрачнее всего в хворь.
// Война не заглушает остальное: она добавляет темп и барабан к погоде или хвори.
function fitMood() {
  if (!shown) return;
  const alive = id => !shown.players[id].out;
  const sky = shown.weather, war = shown.relations?.some(r => r[2] === 'war' && alive(r[0]) && alive(r[1]));
  const base = sky === 'storm' ? 'storm' : shown.players.some(p => p.blight) ? 'blight' : sky === 'sun' ? 'calm' : sky;
  sound.setMood(base === 'calm' && war ? 'war' : war ? `${base}+war` : base);
}

function syncWorld() {
  if (!view || !shown) return;
  view.setTowns(shown.towns);
  view.setRealms(shown.players);
  view.setHeroes(shown.heroes);
  view.applyLand(shown.land);
  view.setTerritory(shown.terr);
  view.setSupply(shown.supply);
  view.setPiers(shown.piers);
  view.setWeather(shown.weather);
  fitMood();
}

function setTurnCaption() {
  if (!shown) return;
  const active = shown.players.filter(p => !p.out && !p.left && !p.done && !p.horde);
  const waiting = active.filter(p => !p.bot).map(p => p.name);
  caption(waiting.length ? `Ждём: ${waiting.join(', ')}` : active.length ? 'Все ходят одновременно' : 'Все сходили');
}

const unitById = id => shown?.units.find(u => u.id === id);
const townAt = (state, tile) => state.towns.find(t => t[0] === tile);

// Огонь Горыныча: три струи падают с неба, острог вспыхивает языками, кадрами по 80 мс, как бой.
const SMOOTH = t => { const k = Math.max(0, Math.min(1, t)); return k * k * (3 - 2 * k); };
const FLAME_COLORS = ['#a32a14', '#e0641a', '#f6c14a', '#fbeea0'];

function tongue(g, x, y, w, h, lean) {
  g.beginPath();
  g.moveTo(x - w, y);
  g.bezierCurveTo(x - w * 1.1, y - h * 0.42, x - w * 0.25 + lean * 0.4, y - h * 0.62, x + lean, y - h);
  g.bezierCurveTo(x + w * 0.3 + lean * 0.4, y - h * 0.6, x + w * 1.15, y - h * 0.36, x + w, y);
  g.quadraticCurveTo(x, y + w * 0.5, x - w, y);
  g.fill();
}

class Flame {
  constructor(c, big) {
    this.c = c;
    this.y = c.y + 44;
    this.t = 0;
    this.start = performance.now();
    const rnd = seeded(Math.round(c.x * 3 + c.y));
    const size = big ? 1.15 : 1;
    this.tongues = Array.from({ length: 13 }, (_, i) => ({
      x: ((i - 6) * 11 + (rnd() - 0.5) * 10) * size, y: (rnd() - 0.5) * 26 + 14,
      w: (14 + rnd() * 9) * size, h: (48 + rnd() * 52) * (1 - Math.abs(i - 6) * 0.075) * size,
      a: rnd() * 6.3, b: rnd() * 6.3,
    }));
    this.sparks = Array.from({ length: 22 }, () => ({ x: (rnd() - 0.5) * 120 * size, speed: 70 + rnd() * 110, life: rnd(), sway: rnd() * 6.3 }));
    this.smoke = Array.from({ length: 8 }, () => ({ x: (rnd() - 0.5) * 80 * size, r: 16 + rnd() * 22, life: rnd() }));
  }

  // Три головы бьют из верхнего края кадра в одну точку.
  breath(g, t) {
    const { c } = this;
    for (let head = 0; head < 3; head++) {
      const fly = SMOOTH((t - head * 0.1) / 0.6);
      if (fly <= 0 || fly >= 1) continue;
      const from = { x: c.x + 300 + head * 70, y: c.y - 560 + head * 46 };
      const x = from.x + (c.x - from.x) * fly, y = from.y + (c.y - 20 - from.y) * fly;
      const tail = Math.max(0, fly - 0.34);
      const bx = from.x + (c.x - from.x) * tail, by = from.y + (c.y - 20 - from.y) * tail;
      g.lineCap = 'round';
      [[20, FLAME_COLORS[0]], [12, FLAME_COLORS[1]], [5, FLAME_COLORS[2]]].forEach(([width, color]) => {
        g.strokeStyle = color;
        g.lineWidth = width;
        g.beginPath();
        g.moveTo(bx, by);
        g.lineTo(x, y);
        g.stroke();
      });
    }
  }

  draw(g, _view, time) {
    const t = Math.floor(this.t / POSE) * POSE, { c } = this;
    this.breath(g, t);
    const k = SMOOTH((t - 0.5) / 0.4) * (1 - SMOOTH((t - FLAME_TIME + 0.75) / 0.75));
    if (k <= 0) return;
    g.save();
    for (const puff of this.smoke) {
      const life = (puff.life + t * 0.42) % 1;
      const x = c.x + puff.x * (1 + life * 0.5), y = c.y - 70 - life * 150, r = puff.r * (1.1 + life * 1.4);
      const cloud = g.createRadialGradient(x, y, 0, x, y, r);
      cloud.addColorStop(0, `rgba(26,21,16,${0.55 * k * (1 - life)})`);
      cloud.addColorStop(1, 'rgba(26,21,16,0)');
      g.fillStyle = cloud;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = 'lighter';
    const glow = g.createRadialGradient(c.x, c.y - 16, 8, c.x, c.y - 16, 165);
    glow.addColorStop(0, `rgba(255,136,44,${0.5 * k})`);
    glow.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = glow;
    g.fillRect(c.x - 170, c.y - 186, 340, 340);
    g.globalCompositeOperation = 'source-over';
    const beat = Math.floor(time / POSE) * POSE;
    this.tongues.forEach((f, i) => {
      const flicker = 0.78 + 0.2 * Math.sin(beat * 9 + f.a) + 0.1 * Math.sin(beat * 17 + f.b);
      const lean = Math.sin(beat * 6 + f.b) * 9;
      const h = f.h * flicker * k, x = c.x + f.x, y = c.y + f.y;
      FLAME_COLORS.forEach((color, layer) => {
        if (layer === 3 && i % 2) return;
        g.fillStyle = color;
        tongue(g, x, y - layer * 2, f.w * (1 - layer * 0.24) * k, h * (1 - layer * 0.25), lean * (1 - layer * 0.2));
      });
    });
    g.fillStyle = FLAME_COLORS[2];
    for (const s of this.sparks) {
      const life = (s.life + t * 0.9) % 1;
      const x = c.x + s.x + Math.sin(life * 7 + s.sway) * 12, y = c.y - 20 - life * s.speed * 1.5;
      g.globalAlpha = k * (1 - life);
      g.fillRect(x, y, 3, 3);
    }
    g.restore();
  }
}

// Найденный герой появляется в золотом свете.
class Glow {
  constructor(c) {
    this.c = c;
    this.y = c.y - 2;
    this.t = 0;
    this.start = performance.now();
  }

  draw(g) {
    const { c, t } = this, k = SMOOTH(t / 0.5) * (1 - SMOOTH((t - 1.2) / 0.6));
    if (k <= 0) return;
    g.save();
    g.globalCompositeOperation = 'lighter';
    const light = g.createRadialGradient(c.x, c.y - 24, 6, c.x, c.y - 24, 150);
    light.addColorStop(0, `rgba(240,214,130,${0.5 * k})`);
    light.addColorStop(1, 'rgba(240,200,100,0)');
    g.fillStyle = light;
    g.fillRect(c.x - 155, c.y - 180, 310, 310);
    g.restore();
  }
}

// Горыныч летит через карту: тень идёт по земле, на концах взлёт и посадка. На обзоре он не мельчает.
class Flight {
  constructor(from, to, ms) {
    Object.assign(this, { from, to, ms, y: 1e9, t: 0, start: performance.now(), dir: to.x >= from.x ? 1 : -1 });
  }

  draw(g, _view, time) {
    const { from, to } = this, k = Math.min(1, (this.t * 1000) / this.ms), e = easeInOut(k);
    const lift = SMOOTH(k / DRAGON_RISE) * SMOOTH((1 - k) / DRAGON_RISE);
    dragonFlight(g, from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e, 1, time, this.dir, lift);
  }
}

// Удар по поселению: летят камни, на обвале ещё и клубы пыли.
class Rubble {
  constructor(c, big) {
    Object.assign(this, { c, y: c.y + 50, t: 0, start: performance.now() });
    const rnd = seeded(Math.round(c.x + c.y * 3)), wide = big ? 170 : 90;
    this.stones = Array.from({ length: big ? 34 : 14 }, () => ({
      x: (rnd() - 0.5) * wide, up: 130 + rnd() * 190, side: (rnd() - 0.5) * 170, r: 3 + rnd() * 5, at: rnd() * 0.3,
    }));
    this.dust = Array.from({ length: big ? 12 : 4 }, () => ({ x: (rnd() - 0.5) * wide, r: 26 + rnd() * 30, at: rnd() * 0.4 }));
  }

  draw(g) {
    const { c } = this, t = Math.floor(this.t / POSE) * POSE;
    g.save();
    for (const puff of this.dust) {
      const life = Math.max(0, Math.min(1, (t - puff.at) / 1.3));
      if (life <= 0 || life >= 1) continue;
      const x = c.x + puff.x * (1 + life * 0.5), y = c.y - 20 - life * 60, r = puff.r * (0.7 + life * 1.3);
      const cloud = g.createRadialGradient(x, y, 0, x, y, r);
      cloud.addColorStop(0, `rgba(120,108,90,${0.55 * (1 - life)})`);
      cloud.addColorStop(1, 'rgba(120,108,90,0)');
      g.fillStyle = cloud;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.fillStyle = '#6d675c';
    for (const s of this.stones) {
      const age = t - s.at;
      if (age <= 0 || age >= 1.1) continue;
      g.fillRect(c.x + s.x + s.side * age, c.y - 40 - s.up * age + 330 * age * age, s.r, s.r);
    }
    g.restore();
  }
}

// --- тексты показа ---

const fellLine = e => {
  if (e.surrender) return `Острог ${realmOf(e.from)} сдаётся без боя: ${named(e.by)} уводит в плен гномов: ${e.captives}`;
  if (e.loot) return `${named(e.by)} разрушает последнюю столицу ${realmOf(e.from)} и забирает казну: грибов ${e.loot}`;
  const razed = `${named(e.by)} разрушает ${e.capital ? 'столицу' : 'острог'} ${realmOf(e.from)}`;
  return e.captives ? `${razed}, в плен уведено гномов: ${e.captives}` : razed;
};

const fireLine = (e, target) => `${named(e.from)} насылает Горыныча на ${target} ${realmOf(e.owner)}: сгорело гномов ${e.burned}`;

// Кто пострадал и чем, а кто сражался и чем кончилось.
const encounterLine = e => {
  const who = HEROES[e.hero].name;
  if (e.won) return `${named(e.owner)} сражается: ${who}, победа, дар «${e.text}», грибы +${e.gold}, потери ${e.lost}`;
  if (e.won === false) return `${named(e.owner)} сражается: ${who}, поражение, беда «${e.text}», потери ${e.lost}${e.burned ? `, сгорело гномов ${e.burned}` : ''}`;
  return `${named(e.owner)} страдает: ${who}, беда «${e.text}»${e.burned ? `, сгорело гномов ${e.burned}` : ''}`;
};

// На налёте Горыныч сам прилетает, и by здесь это царство, к которому он прилетел.
const foundLine = e => {
  if (!e.raid) return `${named(e.by)} находит: ${HEROES[e.hero].name}`;
  return `Змей Горыныч прилетел к ${DOT}${e.by}${realmForm(e.by, 'dat')}`;
};


// Первый слайд: порядок ключей это порядок важности, самое громкое стоит выше.
const OFFER_NAMES = { ally: 'союз', peace: 'мир', trade: 'сделку', pass: 'пропуск' };
const NOTICES = {
  fell: e => [`Пало царство: ${named(e.player)}`, [e.player]],
  blight: e => [`На царство пала хворь: ${named(e.player)}`, [e.player]],
  left: (e, reel) => [`Игрок вышел из партии: ${reel.after.players[e.player].name}, ${named(e.player)}`, [e.player]],
  war: e => (e.joined != null
    ? [`Союзник вступает в войну: ${named(e.to)} против ${realmOf(e.from)}`, [e.to, e.from]]
    : [`${named(e.from)} хочет посадить на кол ${named(e.to)}`, [e.from, e.to]]),
  deal: e => (e.kind === 'pass'
    ? [`${named(e.to)} открывает границу: ${named(e.from)}`, [e.to, e.from]]
    : [`${{ ally: 'Союз', peace: 'Мир', trade: 'Сделка' }[e.kind]}: ${named(e.from)} и ${named(e.to)}`, [e.from, e.to]]),
  broken: e => [`Союз разорван: ${named(e.from)} и ${named(e.to)}`, [e.from, e.to]],
  ransom: e => [`${named(e.owner)} выкупает пленных у ${realmOf(e.by)}: гномов ${e.n} за ${e.price} гр.`, [e.owner, e.by]],
  captivesStay: e => [`Пленные ${realmOf(e.owner)} остаются у ${realmOf(e.by)}: гномов ${e.n}`, [e.by, e.owner]],
  captivesFreed: e => [`Пленные ${realmOf(e.owner)} вернулись домой: гномов ${e.n}`, [e.owner]],
  borderShut: e => [`${named(e.from)} закрывает границу: ${named(e.to)}`, [e.from, e.to]],
  refused: e => [`Отказ: ${named(e.to)} не принимает ${OFFER_NAMES[e.kind]} от ${realmOf(e.from)}`, [e.to, e.from]],
  capture: e => [`${named(e.owner)} занимает ничейный острог`, [e.owner]],
  townFell: e => [fellLine(e), [e.by, e.from]],
  dragon: e => {
    if (e.owner == null) return [e.hide ? 'Змей Горыныч скрылся в лесу' : 'Змей Горыныч перелетел на новое место', []];
    return [`Змей Горыныч прилетает в царство: ${named(e.owner)}`, [e.owner]];
  },
  encounter: e => [encounterLine(e), [e.owner]],
  fire: e => [fireLine(e, townAt(shown, e.tile)?.[1] === 'capital' ? 'столицу' : 'острог'), [e.from, e.owner]],
  battle: e => (e.d.militia
    ? [`Штурм: ${named(e.a.owner)} против ополчения ${realmOf(e.d.owner)}, потери ${e.a.lost} и ${e.d.lost}`, [e.a.owner, e.d.owner]]
    : [`Бой: ${named(e.a.owner)} против ${realmOf(e.d.owner)}, потери ${e.a.lost} и ${e.d.lost}`, [e.a.owner, e.d.owner]]),
  built: e => [`${named(e.owner)} основывает острог`, [e.owner]],
  capital: e => [`${named(e.owner)} переносит столицу`, [e.owner]],
  ruin: e => {
    const owner = townAt(shown, e.tile)?.[2];
    return [owner == null ? 'Покинутый острог развалился' : `Покинутый острог ${realmOf(owner)} развалился`, owner == null ? [] : [owner]];
  },
  heroFound: e => [foundLine(e), [e.by]],
};

// На слайд идёт то, чего не было в мультике: бои, разрушения и встречи уже показаны там.
// Диктор рассказывает и мелочи хода: сделки, границы, столицы и развалины.
// Немыми пользователь оставил потери в бою (их называет итог хода), отказы, перелёт Горыныча без нападения и его налёт.
// О новом остроге после хода ни слова: он просто появляется на карте после походов.
const ON_SLIDE = new Set(['fell', 'blight', 'left', 'war', 'deal', 'broken', 'ransom', 'captivesStay', 'captivesFreed',
  'borderShut', 'capital', 'ruin']);

function noticesOf(reel) {
  const order = Object.keys(NOTICES);
  return reel.events.filter(e => ON_SLIDE.has(e.type))
    .map(e => {
      const [text, realms] = NOTICES[e.type](e, reel);
      return { text, realms, rank: order.indexOf(e.type), say: lineFor(e, shown) };
    })
    .sort((a, b) => a.rank - b.rank);
}

// --- мультик ---

// После хода не показываются бой отряда с существом и занятие ничейного острога: так решил пользователь.
// Их итог на карте всё равно виден: в конце показа экран сверяется с ходом целиком.
const QUIET = e => e.type === 'capture' || (e.type === 'encounter' && e.won != null);

// Сценарий мультика: на отряд один склеенный путь, остальное сцены с подъездом камеры.
function cartoonOf(reel) {
  const paths = new Map(), joined = new Set(), born = [], merges = [], built = [], scenes = [], resettles = [], flights = [];
  const tiles = new Map(shown.units.map(u => [u.id, u.tile]));
  const stays = new Set(reel.after.units.map(u => u.id));
  const pathOf = id => {
    if (!paths.has(id)) paths.set(id, tiles.has(id) ? [tiles.get(id)] : []);
    return paths.get(id);
  };
  for (const e of reel.events) {
    if (e.type === 'move') {
      const path = pathOf(e.unit);
      path.push(...e.path.slice(path[path.length - 1] === e.path[0] ? 1 : 0));
      tiles.set(e.unit, e.path[e.path.length - 1]);
    } else if (e.type === 'spawn') {
      born.push(e.unit);
      tiles.set(e.unit.id, e.unit.tile);
    } else if (e.type === 'merged') {
      merges.push(e);
      // Кто влился целиком, на глазах уходит к соседу и исчезает.
      if (!stays.has(e.unit) && tiles.has(e.target)) {
        pathOf(e.unit).push(tiles.get(e.target));
        joined.add(e.unit);
      }
    } else if (e.type === 'built') built.push(e);
    else if (e.type === 'resettle') resettles.push(e);
    // Горыныч просто перелетел и ни на кого не напал: об этом молчим, он тихо меняет место.
    else if (e.type === 'dragon' && e.owner == null) flights.push(e);
    else if (SCENES[e.type] && !QUIET(e)) scenes.push(e);
  }
  // Несколько поджогов Горынычем за ход показываются разом, одной сценой на месте первого.
  const fires = scenes.filter(e => e.type === 'fire');
  if (fires.length > 1) {
    const first = scenes.indexOf(fires[0]);
    for (let i = scenes.length - 1; i >= 0; i--) if (scenes[i].type === 'fire') scenes.splice(i, 1);
    scenes.splice(first, 0, { type: 'fires', list: fires });
  }
  const moving = [...paths].filter(([id, path]) => path.length > 1 && unitById(id));
  const razed = new Set(scenes.filter(e => e.type === 'townFell').map(e => e.tile));
  const bled = new Set(scenes.filter(e => e.type === 'battle').flatMap(e => [e.a.tile, e.d.tile]));
  return { moving, joined, born, merges, built, scenes, stays, razed, bled, resettles, flights, any: moving.length + born.length + scenes.length > 0 };
}

const stackShift = u => {
  const stack = shown.units.filter(x => x.tile === u.tile);
  return (stack.indexOf(u) - (stack.length - 1) / 2) * 56;
};

function stepMarch(now) {
  for (const m of marching) {
    const k = Math.max(0, Math.min(1, (now - m.start) / m.ms));
    if (m.points.length < 2) { positions.set(m.id, { ...m.points[0], alpha: k }); continue; }
    const along = k * (m.points.length - 1), i = Math.min(m.points.length - 2, Math.floor(along)), f = along - i;
    const a = m.points[i], b = m.points[i + 1];
    const dir = Math.sign(b.x - a.x) || undefined;
    positions.set(m.id, { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, march: k < 1, boat: (f < 0.5 ? a : b).sea, dir });
  }
}

// Все перемещения хода разом. Кадры считают положение по часам, конец держит таймер.
async function playMarch(reel, plan, mine) {
  const { after } = reel;
  const starts = new Map(shown.units.map(u => [u.id, stackShift(u)]));
  for (const [id, path] of plan.moving) unitById(id).tile = path[path.length - (plan.joined.has(id) ? 2 : 1)];
  for (const unit of plan.born) shown.units.push({ ...unit });

  const longest = Math.max(1, ...plan.moving.map(([, path]) => path.length - 1));
  const stepMs = Math.max(190, Math.min(430, 3400 / longest));
  const start = performance.now() + 120;
  let total = 900;
  for (const [id, path] of plan.moving) {
    const u = unitById(id);
    const points = path.map(tile => ({ ...center(map, tile), sea: isWater(map, tile) }));
    points[0].x += starts.get(id) || 0;
    if (!plan.joined.has(id)) points[points.length - 1].x += stackShift(u);
    const ms = (path.length - 1) * stepMs;
    marching.push({ id, owner: u.owner, points, start, ms });
    total = Math.max(total, ms);
  }
  for (const unit of plan.born) {
    const u = unitById(unit.id), c = center(map, unit.tile);
    marching.push({ id: unit.id, points: [{ x: c.x + stackShift(u), y: c.y }], start, ms: 800 });
  }
  // Переселенцы идут по дороге сами по себе: показ хода их не ждёт, они доходят во время сцен.
  const walkers = plan.walkers = plan.resettles.map(e => view.procession(e, start, Math.max(900, (e.cells.length - 1) * stepMs * 1.4)));
  fx.push(...walkers);
  if (plan.moving.length) {
    const word = lineFor({ type: 'march', turn: reel.ended });
    caption(word);
    sound.say(word);
  }
  await wait(total + 420);
  if (mine !== session) return;

  marching.length = 0;
  positions.clear();
  for (const e of plan.merges) {
    const from = unitById(e.unit), to = unitById(e.target);
    if (from) from.n -= e.moved;
    if (to) to.n += e.moved;
  }
  // Кто растворился в лагере или остроге, дальше на карте не стоит. Бойцы доживают до своих сцен.
  const fighting = new Set(plan.scenes.flatMap(e => (e.type === 'battle' ? [e.a.id, e.d.id] : e.won != null ? [e.unit] : [])));
  shown.units = shown.units.filter(u => u.n > 0 && (plan.stays.has(u.id) || fighting.has(u.id)));
  for (const e of plan.built) {
    const town = townAt(after, e.tile);
    if (town) shown.towns.push([...town]);
  }
  if (plan.built.length) view.setTowns(shown.towns);
  // Рухнувшее поселение стоит до своей сцены, а кровь проступает после своего боя.
  view.applyLand(after.land.filter(row => !plan.razed.has(row[0]) && !plan.bled.has(row[0])));
  view.setTerritory(after.terr);
  view.setSupply(after.supply);
  view.setPiers(after.piers);
}

const look = (tile, lift = 20) => {
  const c = center(map, tile);
  return { x: c.x, y: c.y - lift, s: closeUp() };
};

// Подпись пишет имена царств, диктор читает свою реплику из lines.js.
async function tell(text, ms, line) {
  caption(text);
  await Promise.all([wait(ms), sound.say(line)]);
}

async function showHero(e, reel, pace, mine) {
  await flyTo(look(e.tile), 900 * pace);
  if (mine !== session) return;
  const glow = new Glow(center(map, e.tile));
  fx.push(glow);
  view.heroAt.set(e.tile, e.hero);
  // Про налёт диктор уже сказал в сцене перелёта.
  await tell(foundLine(e), 1800 * pace, e.raid ? null : lineFor(e, shown));
  dropFx(glow);
}

async function showCapture(e, reel, pace, mine) {
  await flyTo(look(e.tile), 900 * pace);
  if (mine !== session) return;
  const town = townAt(shown, e.tile), then = townAt(reel.after, e.tile);
  if (town) {
    town[2] = e.owner;
    if (then) [, town[1]] = then;
  }
  view.setTowns(shown.towns);
  rising.set(e.tile, performance.now());
  await tell(NOTICES.capture(e)[0], 1500 * pace, lineFor(e, shown));
  rising.delete(e.tile);
}

// Гномов не осталось: поселение рушится в пыли, на его месте руины. Дорога, если была, остаётся.
async function showTownFell(e, reel, pace, mine) {
  await flyTo(look(e.tile, 30), 700 * pace);
  if (mine !== session) return;
  const rubble = new Rubble(center(map, e.tile), true);
  fx.push(rubble);
  sound.clash(1);
  const told = tell(fellLine(e), 2000 * pace, lineFor(e, shown));
  await wait(500);
  if (mine !== session) return;
  shown.towns = shown.towns.filter(t => t[0] !== e.tile);
  view.setTowns(shown.towns);
  view.applyLand(reel.after.land.filter(row => row[0] === e.tile));
  await told;
  dropFx(rubble);
}

// Острог горит, пока диктор договаривает, жители убывают посреди пламени.
async function flameOn(tile, reel, told, mine) {
  const town = townAt(shown, tile), then = townAt(reel.after, tile);
  const flame = new Flame(center(map, tile), town?.[1] === 'capital');
  fx.push(flame);
  sound.fire(FLAME_TIME);
  await wait(1500);
  if (mine !== session) return;
  if (town) {
    town[3] = then ? then[3] : 0;
    view.setTowns(shown.towns);
  }
  await told;
  dropFx(flame);
}

async function showFire(e, reel, pace, mine) {
  await flyTo(look(e.tile, 40), 900 * pace);
  if (mine !== session) return;
  const target = townAt(shown, e.tile)?.[1] === 'capital' ? 'столицу' : 'острог';
  await flameOn(e.tile, reel, tell(fireLine(e, target), FLAME_TIME * 1000, lineFor(e, shown)), mine);
}

// Кадр, в который входят все клетки, с запасом по краям и не ближе крупного плана.
function lookAll(tiles, lift = 40) {
  const cs = tiles.map(t => center(map, t)), xs = cs.map(c => c.x), ys = cs.map(c => c.y);
  const w = Math.max(...xs) - Math.min(...xs) + R * 9, h = Math.max(...ys) - Math.min(...ys) + R * 9;
  return { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 - lift, s: Math.min(closeUp(), vw / w, vh / h) };
}

// Несколько поджогов за ход: камера охватывает все поселения, пламя встаёт везде разом,
// жители убывают везде одновременно, а диктор читает строки подряд, пока всё горит.
async function showFires(e, reel, pace, mine) {
  const list = e.list;
  await flyTo(lookAll(list.map(f => f.tile)), 900 * pace);
  if (mine !== session) return;
  const flames = list.map(f => new Flame(center(map, f.tile), townAt(shown, f.tile)?.[1] === 'capital'));
  fx.push(...flames);
  sound.fire(FLAME_TIME);
  const burn = wait(1500).then(() => {
    if (mine !== session) return;
    for (const f of list) {
      const town = townAt(shown, f.tile), then = townAt(reel.after, f.tile);
      if (town) town[3] = then ? then[3] : 0;
    }
    view.setTowns(shown.towns);
  });
  const told = (async () => {
    for (const f of list) {
      if (mine !== session) return;
      const target = townAt(shown, f.tile)?.[1] === 'capital' ? 'столицу' : 'острог';
      await tell(fireLine(f, target), 1600 * pace, lineFor(f, shown));
    }
  })();
  await Promise.all([wait(FLAME_TIME * 1000), burn, told]);
  for (const flame of flames) dropFx(flame);
}

// Горыныч перелетает через всю карту: с обзора видно, откуда и куда, потом камера идёт к посадке.
async function showDragon(e, reel, pace, mine) {
  await flyTo(overview(), 900 * pace);
  if (mine !== session) return;
  const ms = DRAGON_MS * Math.max(0.75, pace);
  const flight = new Flight(center(map, e.from), center(map, e.to), ms);
  view.heroAt.delete(e.from);
  fx.push(flight);
  const told = tell(NOTICES.dragon(e)[0], ms, lineFor(e, shown));
  await wait(ms);
  if (mine !== session) return;
  dropFx(flight);
  if (e.hide) return told;
  view.heroAt.set(e.to, 'gorynych');
  await Promise.all([told, flyTo(look(e.to), 900 * pace)]);
}

// Встреча: существо стоит на своей клетке, пока о нём рассказывают. Кто скрыт, снова исчезает.
// Бой с существом звенит мечами, а тёмных встреч за ход бывает несколько: они идут короче.
async function showEncounter(e, reel, pace, mine) {
  const burns = e.burned > 0 && e.ostrog != null, brief = e.dark ? DARK_PACE : 1;
  await flyTo(look(burns ? e.ostrog : e.tile, burns ? 40 : 20), 900 * pace * brief);
  if (mine !== session) return;
  const glow = new Glow(center(map, e.tile));
  fx.push(glow);
  view.heroAt.set(e.tile, e.hero);
  if (e.won != null) for (const at of [0, 300, 600]) setTimeout(() => { if (mine === session) sound.clash(0.9); }, at);
  const told = tell(encounterLine(e), (burns ? FLAME_TIME * 1000 : 2400 * brief) * Math.max(0.75, pace), lineFor(e, shown));
  if (burns) await flameOn(e.ostrog, reel, told, mine);
  else await told;
  if (mine !== session) return;
  dropFx(glow);
  const squad = e.won != null ? unitById(e.unit) : null;
  if (squad) {
    squad.n -= e.lost;
    shown.units = shown.units.filter(u => u.n > 0);
  }
  if (!reel.after.heroes.some(([tile, key]) => tile === e.tile && key === e.hero)) view.heroAt.delete(e.tile);
}

// Звон мечей совпадает с настоящими ударами воинов на экране.
function ringSwords(fight, mine) {
  const beats = fight.men.flatMap(m => m.beats.map(b => b.at + STRIKE * POSE)).sort((a, b) => a - b);
  const heard = [];
  for (const at of beats) if (!heard.length || at - heard[heard.length - 1] > 0.2) heard.push(at);
  if (heard.length < 4) for (let at = 0.4; at < BATTLE_TIME - 0.4; at += 0.25) heard.push(at);
  for (const at of heard.slice(0, 16)) {
    setTimeout(() => { if (mine === session) sound.clash(0.75 + Math.random() * 0.35); }, at * 1000);
  }
}

async function showBattle(e, reel, pace, mine) {
  const a = center(map, e.a.tile), d = center(map, e.d.tile);
  if (e.a.tile === e.d.tile) { a.x -= 30; d.x += 30; }
  const mid = { x: (a.x + d.x) / 2, y: (a.y + d.y) / 2 };
  await flyTo({ x: mid.x, y: mid.y - 10, s: closeUp() * 1.15 }, 500 * pace);
  if (mine !== session) return;
  const target = townAt(shown, e.d.tile)?.[1] === 'capital' ? 'столицу' : 'острог';
  const line = e.d.militia ? `${named(e.a.owner)} штурмует ${target} ${realmOf(e.d.owner)}` : `${named(e.a.owner)} нападает на ${named(e.d.owner)}`;
  const fight = new Battle(e, a, d, isWater(map, e.a.tile), isWater(map, e.d.tile));
  fight.start = performance.now();
  sound.setMood('battle');
  hidden.add(e.a.id); hidden.add(e.d.id);
  fx.push(fight);
  ringSwords(fight, mine);
  // Когда сцен много, диктор молчит: бои идут быстрее его речи.
  await tell(line, BATTLE_TIME * 1000, pace < 0.7 ? null : lineFor(e, shown));
  if (mine !== session) return;
  dropFx(fight);
  hidden.clear();
  for (const side of [e.a, e.d]) {
    const u = unitById(side.id);
    if (u) u.n = side.n - side.lost;
  }
  shown.units = shown.units.filter(u => u.n > 0);
  // Бой кончился: на его клетках проступает кровь. Павшее поселение ждёт своей сцены.
  const falls = new Set(reel.events.filter(x => x.type === 'townFell').map(x => x.tile));
  view.applyLand(reel.after.land.filter(row => (row[0] === e.a.tile || row[0] === e.d.tile) && !falls.has(row[0])));
  await tell(`Потери: ${named(e.a.owner)} ${e.a.lost}, ${named(e.d.owner)} ${e.d.lost}`, 700 * pace);
  fitMood();
}

const SCENES = {
  heroFound: showHero, capture: showCapture, fire: showFire, fires: showFires, battle: showBattle,
  dragon: showDragon, encounter: showEncounter, townFell: showTownFell,
};

async function playCartoon(reel, plan, mine) {
  document.body.classList.add('story');
  await wait(FADE * 0.6);
  if (mine !== session) return;
  for (const e of plan.flights) {
    view.heroAt.delete(e.from);
    if (!e.hide) view.heroAt.set(e.to, 'gorynych');
  }
  await playMarch(reel, plan, mine);
  // Длинный ход идёт бодрее: сцены короче, а смысл тот же.
  const pace = Math.max(0.5, Math.min(0.85, 8 / Math.max(1, plan.scenes.length)));
  for (const e of plan.scenes) {
    if (mine !== session) return;
    await SCENES[e.type](e, reel, pace, mine);
  }
  if (mine !== session) return;
  for (const w of plan.walkers || []) dropFx(w);
  caption('');
  if (plan.scenes.length) await flyTo(overview(), 900);
  if (mine === session) document.body.classList.remove('story');
}

// --- чёрный экран и слайды ---

async function blackout(text, line) {
  $('curtainText').textContent = text;
  $('curtain').classList.remove('hidden');
  $('curtain').getBoundingClientRect();
  $('curtain').classList.add('on');
  sound.horn();
  await wait(FALL);
  sound.say(line);
  await wait(BLACK);
}

function liftCurtain(mine) {
  $('curtain').classList.remove('on');
  setTimeout(() => { if (mine === session) $('curtain').classList.add('hidden'); }, FADE);
}

function fillSlide(title, hint, items, none) {
  $('slideTitle').textContent = title;
  $('slideHint').textContent = hint;
  const list = $('slideList');
  list.textContent = '';
  list.classList.toggle('pairs', items.some(item => item.realms?.length > 1));
  $('slideBox').classList.toggle('dense', items.length > 12);
  items.forEach((item, i) => {
    const row = document.createElement('li');
    row.style.setProperty('--i', Math.min(i, 24));
    const marks = document.createElement('span');
    marks.className = 'marks';
    for (const pid of item.realms || []) marks.append(realmIcon(pid, 4));
    const text = document.createElement('span');
    putText(text, item.text);
    row.append(marks, text);
    list.append(row);
  });
  if (!items.length && none) {
    const row = document.createElement('li');
    row.className = 'none';
    row.textContent = none;
    list.append(row);
  }
}

// Кегль и колонки подбираются под список: на каждое число колонок свой наибольший кегль,
// а лучшим считается самый крупный вариант без переносов строк.
function fitSlide() {
  const list = $('slideList'), room = $('slideRoom'), box = $('slideBox');
  const pad = parseFloat(getComputedStyle(box).paddingTop) + parseFloat(getComputedStyle(box).paddingBottom);
  const height = box.clientHeight - pad - $('slideHead').offsetHeight;
  const width = room.clientWidth;
  const setup = (columns, size) => {
    list.style.columnCount = columns;
    list.style.width = columns > 1 ? '100%' : 'auto';
    list.style.fontSize = `${size}px`;
  };
  let best = null;
  for (let columns = 1; columns <= 4; columns++) {
    for (let size = Math.round(window.innerHeight * 0.054); size >= 12; size--) {
      if (width / columns < size * 14) continue;
      setup(columns, size);
      if (list.offsetHeight > height || list.offsetWidth > width) continue;
      const wrapped = [...list.children].some(row => row.lastChild.offsetHeight > size * 1.7);
      const score = wrapped ? size * 0.78 : size;
      if (!best || score > best.score) best = { columns, size, score };
      if (!wrapped) break;
    }
  }
  if (best) setup(best.columns, best.size);
  return !!best;
}

// Список не лезет даже мелким кеглем: хвост сворачивается в одну строку.
function fitOrCut(items) {
  for (let keep = items.length; !fitSlide() && keep > 1;) {
    keep = Math.ceil(keep * 0.9) - 1;
    fillSlide($('slideTitle').textContent, $('slideHint').textContent, [...items.slice(0, keep), { text: `И ещё событий: ${items.length - keep}` }]);
  }
}

async function showSlide({ title, hint = '', items, none = '', table = null }, mine) {
  const box = $('slide'), inner = $('slideBox');
  const open = !box.classList.contains('hidden');
  if (open) {
    inner.classList.add('out');
    await wait(TEXT_FADE);
    if (mine !== session) return;
  }
  fillSlide(title, hint, items, none);
  $('slideList').classList.toggle('hidden', !!table);
  $('slideToll').classList.toggle('hidden', !table);
  $('slideToll').replaceChildren(...(table ? [table] : []));
  box.classList.remove('hidden');
  if (!table) fitOrCut(items);
  inner.classList.remove('out');
  if (open) { await wait(TEXT_FADE); return; }
  // Над занавесом слайд открывается сразу: иначе в просвете мелькнула бы карта.
  const covered = !$('curtain').classList.contains('hidden');
  box.classList.toggle('instant', covered);
  box.getBoundingClientRect();
  box.classList.add('on');
  if (covered) liftCurtain(mine);
  await wait(FADE);
  box.classList.remove('instant');
}

// Слайд висит не меньше трёх секунд и не обрывает диктора. Если голоса нет, живёт расчётное время.
// silent: строки, которые диктор не читает, но глазами их прочитать надо успеть.
async function holdSlide(texts, mine, silent = []) {
  const started = performance.now();
  const reckoned = 1200 + [...texts, ...silent].join('').length * READ_MS;
  const unread = silent.length ? 1200 + silent.join('').length * READ_MS : 0;
  let heard = 0;
  for (const text of texts) {
    if (mine !== session) return;
    if (await sound.say(text)) heard++;
  }
  if (mine !== session) return;
  const need = Math.max(SLIDE_MIN, heard ? unread : reckoned);
  await wait(need - (performance.now() - started));
}

// Что диктор читает со слайда: заголовок, затем строки, лишнее называет числом.
function readable(head, items) {
  const told = [...head, ...items.slice(0, READ_LIMIT).map(item => item.say)];
  if (items.length > READ_LIMIT) told.push(lineFor({ type: 'more', n: items.length - READ_LIMIT }));
  return told.filter(Boolean);
}

// Потери за ход: по строке на царство, колонки по причинам, полоска для наглядности.
function tollTable(fallen) {
  const rows = fallen.filter(r => r.total > 0).sort((a, b) => b.total - a.total);
  const most = Math.max(...rows.map(r => r.total));
  const table = document.createElement('table');
  const head = table.insertRow();
  for (const title of ['Царство', ...Object.values(FALLEN_NAMES), 'Всего', '']) {
    const th = document.createElement('th');
    th.textContent = title;
    head.append(th);
  }
  for (const r of rows) {
    const row = table.insertRow();
    putText(row.insertCell(), named(r.id));
    for (const cause of Object.keys(FALLEN_NAMES)) {
      const cell = row.insertCell();
      cell.textContent = r[cause] || '·';
      cell.classList.toggle('nil', !r[cause]);
    }
    row.insertCell().textContent = r.total;
    const bar = document.createElement('div');
    bar.className = 'tollBar';
    bar.style.width = `${(r.total / most) * 100}%`;
    bar.style.background = FAC[factionId(r.id)].main;
    row.insertCell().append(bar);
  }
  return table;
}

function closeSlide(mine) {
  $('slide').classList.remove('on');
  setTimeout(() => { if (mine === session) $('slide').classList.add('hidden'); }, FADE);
}

function adopt(after) {
  base = structuredClone(after);
  shown = freshPlayers ? { ...after, players: freshPlayers } : after;
  freshPlayers = null;
  syncWorld();
  renderBand();
  Object.assign(cam, overview());       // окно могло измениться во время показа
}

// Под заставкой карта возвращается к началу хода: мультик показывает ход с начала.
// Земля и дороги остаются свежими: показ их не рисует.
function rewind() {
  if (!base) return;
  shown = { ...structuredClone(base), players: shown.players, land: shown.land, roads: shown.roads };
  syncWorld();
}

// Свежая партия во время хода: войска, остроги и земля сразу такие, как у игроков.
// Старый сервер присылает только царства и дороги: тогда остальное ждёт показа хода.
function showLive(data) {
  if (finale || data.phase === 'over') return;   // итоги партии уже на экране
  if ('dark' in data) setDarkSeat(data.dark);
  if ('hordeSeat' in data) setHordeSeat(data.hordeSeat);
  if (!data.units) shown.players = data.players;
  else { shown = data; syncWorld(); }
  renderTies();
  view.setRoads(data.roads);
  renderBand();
  setTurnCaption();
}

const ack = id => post('ack', { id }).catch(() => {});   // связь пропала: сервер не ждёт дольше своего предела

async function playReel(reel, mine) {
  const { after, ended } = reel;
  const dead = after.fallenTotal || 0;
  const tollLine = lineFor({ type: 'toll', n: dead });
  freshPlayers = null;
  // Показ идёт, когда все сходили: последний статус этого уже не сказал.
  shown.players = shown.players.map(p => ({ ...p, done: true }));
  renderBand();
  caption('');

  await blackout(`Ход ${ended} завершён`, lineFor({ type: 'turn', ended }));
  if (mine !== session) return;
  rewind();
  const notes = noticesOf(reel);       // до мультика: он меняет поселения на экране
  const plan = cartoonOf(reel);

  if (plan.any) {
    liftCurtain(mine);
    await playCartoon(reel, plan, mine);
    if (mine !== session) return;
  }

  if (notes.length) {
    const items = dead ? notes : [...notes, { text: 'Потерь нет', say: tollLine }];
    await showSlide({ title: `Что произошло за ход ${ended}`, items }, mine);
    if (mine !== session) return;
    const unsaid = items.filter(item => item.say);
    await holdSlide(unsaid.length ? readable([lineFor({ type: 'summary' })], unsaid) : [], mine, items.filter(item => !item.say).map(item => item.text));
    if (mine !== session) return;
  }

  if (dead) {
    const table = tollTable(after.fallen);
    await showSlide({ title: `Потери за ход ${ended}`, hint: `Всего погибло: ${dead}`, items: [], table }, mine);
    if (mine !== session) return;
    // Все потери были в боях мультика: диктор их уже назвал, таблица говорит сама.
    const told = plan.scenes.filter(e => e.type === 'battle').reduce((sum, e) => sum + e.a.lost + e.d.lost, 0);
    await holdSlide(told === dead ? [] : [tollLine], mine);
    if (mine !== session) return;
  }

  if (after.phase === 'over') {
    adopt(after);
    showFinal(after, mine);
    ack(reel.id);
    sound.say(lineFor({ type: 'over', winner: after.winner }));
    return;
  }

  const title = `Следующий ход: ${after.turn} · ${TURN_NAMES[after.kind]}`;
  const hint = `${TURN_HINTS[after.kind]} · Погода: ${WEATHER[after.weather].name}`;
  const items = after.notices.map(text => ({ text, say: lineFor({ type: 'notice', text }) }));
  await showSlide({ title, hint, items }, mine);
  if (mine !== session) return;
  adopt(after);
  // Слайда с итогом не было: о потерях диктор говорит здесь. Перед новым ходом звучит фраза сказа о том, как идёт партия.
  const head = [
    ...(notes.length || dead ? [] : [tollLine]),
    taleFor(after),
    lineFor({ type: 'next', turn: after.turn }),
  ];
  await holdSlide(readable(head, items), mine);
  if (mine !== session) return;

  closeSlide(mine);
  setTurnCaption();
  await wait(FADE);
  if (mine !== session) return;
  ack(reel.id);
}

// --- легенда партии ---

function taleLine(text) {
  const box = $('taleLines');
  while (box.children.length >= TALE_KEEP) box.firstChild.remove();
  for (const old of box.children) old.classList.add('past');
  const row = document.createElement('p');
  row.textContent = text;
  box.append(row);
}

function taleFate(label, name, text) {
  const row = document.createElement('div');
  row.className = 'taleFate';
  const title = document.createElement('b');
  title.textContent = label;
  const what = document.createElement('span');
  what.textContent = `${name}: ${text}`;
  row.append(title, what);
  $('taleFates').append(row);
}

function paintTaleHero(hero) {
  const art = $('taleHero'), size = 420, res = 2;
  art.width = art.height = size * res;
  const g = art.getContext('2d');
  g.scale(res, res);
  g.translate(size / 2, size * 0.7);
  g.scale(2.7, 2.7);
  paintObject(g, hero, 7);
}

// Легенда перед ходом 1: фразы идут за диктором, в конце особые дар, проклятье и знамение года.
async function playTale({ id, legend }, mine) {
  const { lines, gift, curse, omenName } = legend;
  const fates = lines.findIndex(line => line.startsWith('Особый дар'));
  const omen = lines[fates + 2] ?? '';
  let skipped = false, skip = null;
  const stopped = new Promise(resolve => { skip = resolve; });
  $('taleSkip').onclick = () => { skipped = true; sound.hush(); skip(); };
  const over = () => skipped || mine !== session;
  const hold = ms => Promise.race([wait(ms), stopped]);
  const read = async text => {
    const started = performance.now();
    const heard = await Promise.race([sound.say(text), stopped]);
    if (!over() && !heard) await hold(Math.max(TALE_MIN, text.length * READ_MS) - (performance.now() - started));
  };

  sound.preload(lines);
  $('taleTitle').textContent = legend.title;
  $('taleLines').textContent = '';
  $('taleFates').textContent = '';
  paintTaleHero(legend.hero);
  $('tale').classList.remove('hidden');
  $('tale').getBoundingClientRect();
  $('tale').classList.add('on');
  await hold(FADE);

  for (const text of lines.slice(0, fates)) {
    if (over()) break;
    taleLine(text);
    await read(text);
  }
  $('taleLines').textContent = '';
  const rows = [['Особый дар', gift], ['Особое проклятье', curse], ['Знамение года', { name: omenName, text: omen.slice(omen.indexOf('. ') + 2) }]];
  for (const [i, [label, fate]] of rows.entries()) {
    if (over()) break;
    taleFate(label, fate.name, fate.text);
    await read(lines[fates + i]);
  }
  for (const text of lines.slice(fates + 3)) {
    if (over()) break;
    taleLine(text);
    await read(text);
  }
  if (!over()) await hold(TALE_END);
  if (mine !== session) return;
  $('taleSkip').onclick = null;
  $('tale').classList.remove('on');
  await wait(FADE);
  if (mine !== session) return;
  $('tale').classList.add('hidden');
  setTurnCaption();
  ack(id);
}

async function pump() {
  if (playing) return;
  playing = true;
  const mine = session;
  while (queue.length) {
    const next = queue[0];
    await (next.tale ? playTale(next.tale, mine) : playReel(next, mine));
    if (mine !== session) return;
    queue.shift();
  }
  playing = false;
  // Пока шёл показ, игроки уже могли начать новый ход.
  if (freshLive) { const live = freshLive; freshLive = null; showLive(live); }
}

// Сброс партии или новое состояние с сервера: от показа не остаётся ничего.
function stopShow() {
  sound.setMood('calm');
  session++;
  playing = false;
  queue.length = 0;
  flight?.done();
  flight = null;
  fx.length = 0;
  hidden.clear();
  positions.clear();
  marching.length = 0;
  rising.clear();
  finale = null;
  peek = null;
  freshPlayers = null;
  freshLive = null;
  sound.hush();
  document.body.classList.remove('story');
  $('curtain').classList.remove('on');
  $('curtain').classList.add('hidden');
  $('slide').classList.remove('on', 'instant');
  $('slide').classList.add('hidden');
  $('slideBox').classList.remove('out');
  $('overBox').classList.remove('on', 'instant');
  $('overBox').classList.add('hidden');
  $('tale').classList.remove('on');
  $('tale').classList.add('hidden');
  caption('');
}

// --- итоги партии ---

const RESULT_COLUMNS = [
  ['Земля', 'land'], ['Поселения', 'towns'], ['Гномы', 'gnomes'], ['Собрано грибов', 'picked'],
  ['Разрушено поселений', 'taken'], ['Побито врагов', 'killed'], ['Потери', 'lost'], ['Сожжено Горынычем', 'burned'],
  ['Дорог', 'roads'], ['Острогов', 'built'], ['Сделок', 'deals'],
];

const METRICS = [['Земля, клеток', 'land'], ['Гномы', 'gnomes'], ['Войско, воинов', 'army'], ['Грибы в запасе', 'mushrooms']];

// Штрих и маркер у каждого царства свои: цвета зелёного и бирюзового на чёрном почти сливаются.
const LINES = {
  red: { mark: 'circle' }, yellow: { mark: 'square' }, blue: { mark: 'diamond', dash: '9 4' },
  teal: { mark: 'up', dash: '3 4' }, green: { mark: 'down' },
  copper: { mark: 'square', dash: '3 4' }, snow: { mark: 'circle', dash: '9 4' }, dark: { mark: 'diamond' },
};

function lineSeries(results, turns) {
  return results.players.map(p => {
    const id = factionId(p.id);
    const end = p.fellOn == null ? null : turns.reduce((last, turn, i) => (turn <= p.fellOn ? i : last), 0);
    const name = realmName(p.id);
    return { ...LINES[id], name, short: name.split(' ')[0], color: FAC[id].main, end };
  });
}

function renderCharts(results) {
  // В ход конца партии снимок делается дважды, на графике нужен последний.
  const history = results.history.filter((h, i, all) => all[i + 1]?.turn !== h.turn);
  const turns = history.map(h => h.turn);
  const series = lineSeries(results, turns);
  drawLegend($('overLegend'), series);
  drawCharts($('overCharts'), {
    turns, series,
    metrics: METRICS.map(([title, key]) => ({ title, data: results.players.map(p => history.map(h => h.players[p.id][key])) })),
  });
}

function renderTable(results, winner, live = false) {
  const lasted = p => p.fellOn ?? results.turns + 1;
  const rows = [...results.players].sort((a, b) => (b.id === winner) - (a.id === winner) || lasted(b) - lasted(a) || b.land - a.land);
  const table = document.createElement('table');
  const head = table.insertRow();
  for (const title of ['Царство', 'Итог', ...RESULT_COLUMNS.map(c => c[0])]) {
    const th = document.createElement('th');
    th.textContent = title;
    head.append(th);
  }
  for (const p of rows) {
    const row = table.insertRow();
    if (p.id === winner) row.className = 'winner';
    const name = document.createElement('div');
    name.className = 'realmCell';
    const who = document.createElement('span');
    who.append(realmDot(p.id), realmName(p.id));
    const player = document.createElement('small');
    player.textContent = p.bot ? 'бот' : p.name;
    who.append(player);
    name.append(realmIcon(p.id), who);
    row.insertCell().append(name);
    row.insertCell().textContent = p.id === winner ? 'Победа' : p.fellOn != null ? `Пало на ходу ${p.fellOn}` : live ? 'В игре' : 'Выстояло';
    for (const [, key] of RESULT_COLUMNS) row.insertCell().textContent = p[key];
  }
  $('overTable').replaceChildren(table);
}

// Графики строятся под настоящий размер, он меняется и с окном, и когда приходит шрифт.
new ResizeObserver(() => { const open = finale ?? peek; if (open) renderCharts(open.results); }).observe($('overCharts'));

// Титулы конца партии строкой под итогами: Строитель, Воевода, Купец, Хлебосол, Устоявший.
function fillTitles(epilogue) {
  const box = $('overTitles');
  box.replaceChildren();
  for (const [key, pid] of epilogue?.titles || []) {
    const item = document.createElement('span');
    item.append(`${TITLE_NAMES[key]}: `, realmDot(pid), realmName(pid));
    box.append(item);
  }
}

// Итоговый сказ дед рассказывает один раз за партию, строка за строкой, подпись идёт вместе с ним.
let toldEpilogue = -1;
async function tellEpilogue(epilogue, mine) {
  if (!epilogue?.tale?.length || toldEpilogue === mine) return;
  toldEpilogue = mine;
  await wait(1200);
  for (const line of epilogue.tale) {
    if (mine !== session) return;
    caption(line);
    await Promise.all([wait(2600), sound.say(line)]);
  }
  if (mine === session) caption('');
}

function fillOver(results, legend) {
  $('overWorld').textContent = `Ходов: ${results.turns} · Погибло в боях: ${results.killed} · Умерло от голода: ${results.starved}`
    + ` · Стало руин: ${results.ruins} · Испорчено клеток: ${results.turned}`;
  $('overTale').textContent = legend ? `Легенда партии: ${legend.title} · Знамение года: ${legend.omenName}` : '';
}

// Статистика посреди партии: тот же слайд итогов, но без победителя и с кнопкой «Закрыть».
async function showStats() {
  const mine = session, out = await post('stats').catch(() => ({}));
  if (!out.results || mine !== session || finale) return;
  peek = out;
  putText($('overTitle'), `Статистика · ход ${out.results.turns}`);
  $('overBanner').classList.add('hidden');
  $('againBtn').classList.add('hidden');
  $('overClose').classList.remove('hidden');
  fillOver(out.results, shown?.legend);
  renderTable(out.results, null, true);
  const box = $('overBox');
  box.classList.remove('hidden', 'instant');
  box.getBoundingClientRect();
  box.classList.add('on');
  renderCharts(out.results);
}

function closeStats() {
  if (!peek) return;
  peek = null;
  $('overBox').classList.remove('on', 'instant');
  $('overBox').classList.add('hidden');
}

function showFinal(state, mine = session) {
  const { results, winner } = state;
  const box = $('overBox');
  finale = state;
  peek = null;
  $('againBtn').classList.remove('hidden');
  $('overClose').classList.add('hidden');
  putText($('overTitle'), winner == null ? 'Все царства погибли' : `Победа: ${named(winner)}`);
  $('overBanner').classList.toggle('hidden', winner == null);
  if (winner != null) paintBanner($('overBanner'), winner, 4);
  fillOver(results, state.legend);
  fillTitles(state.epilogue);
  renderTable(results, winner);
  box.classList.remove('hidden');
  tellEpilogue(state.epilogue, mine);
  const covered = !$('curtain').classList.contains('hidden');
  box.classList.toggle('instant', covered);
  box.getBoundingClientRect();
  box.classList.add('on');
  caption('');
  if (covered) liftCurtain(mine);
  // Слайд уходит из-под итогов, когда они проявились: иначе в просвете мелькнула бы карта.
  setTimeout(() => {
    if (mine !== session) return;
    $('slide').classList.remove('on');
    $('slide').classList.add('hidden');
  }, OVER_FADE);
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!view || !shown) return;
  if (flight) {
    const k = Math.max(0, Math.min(1, (now - flight.start) / flight.ms));
    const e = easeInOut(k);
    const { from, to } = flight;
    cam.s = from.s * (to.s / from.s) ** e;
    cam.x = from.x + (to.x - from.x) * e;
    cam.y = from.y + (to.y - from.y) * e;
  }
  stepMarch(now);
  for (const f of fx) if (f.start) f.t = Math.max(0, (now - f.start) / 1000);
  const rise = new Map([...rising].map(([id, born]) => [id, Math.min(1, (now - born) / 600)]));
  view.draw(ctx, dpr, cam, vw, vh, {
    time: now / 1000, units: shown.units, positions, fx, hide: hidden, rising: rise, hideCounts: true, patches: shown.patches, horde: shown.horde,
  });
}
requestAnimationFrame(frame);

function showGame() {
  $('lobby').classList.add('hidden');
  $('stage').classList.remove('hidden');
  $('band').classList.remove('hidden');
  resize();
}

function renderLobby() {
  if (!lobby) return;
  $('address').textContent = lobby.address;
  if ($('qr').dataset.text !== lobby.address) {
    drawQR($('qr'), lobby.address, 300);
    $('qr').dataset.text = lobby.address;
  }
  const seats = $('seats');
  seats.textContent = '';
  lobby.humans.forEach(h => {
    const li = document.createElement('li');
    li.append(realmDot(h.faction), `${factionOf(h.faction).name}, князь ${h.name}`);
    if (!h.online) li.className = 'off';
    seats.append(li);
  });
  $('botCount').textContent = lobby.bots;
  $('botLess').disabled = lobby.bots <= 0;
  $('botMore').disabled = lobby.humans.length + lobby.bots >= lobby.maxSeats;
  $('startBtn').disabled = lobby.humans.length + lobby.bots < 2;
  if (lobby.playing) return;
  $('lobby').classList.remove('hidden');
  $('stage').classList.add('hidden');
  $('band').classList.add('hidden');
  $('qrBox').classList.add('hidden');
  $('restartBox').classList.add('hidden');
  $('finishBox').classList.add('hidden');
  stopShow();
  shown = null; view = null; map = null;
  paintLobbyArt();
}

const lobbyLand = new Image();
lobbyLand.src = '/lobby.jpg';
lobbyLand.onload = () => { if (lobby && !lobby.playing) paintLobbyArt(); };

function paintLobbyArt() {
  const art = $('lobbyArt');
  const w = window.innerWidth, h = window.innerHeight, ratio = Math.min(window.devicePixelRatio || 1, 2);
  art.width = w * ratio; art.height = h * ratio;
  const g = art.getContext('2d');
  g.scale(ratio, ratio);
  // Фон это настоящая земля игры, чуть притемнённая под надписи.
  if (lobbyLand.complete && lobbyLand.naturalWidth) {
    const k = Math.max(w / lobbyLand.naturalWidth, h / lobbyLand.naturalHeight);
    g.drawImage(lobbyLand, (w - lobbyLand.naturalWidth * k) / 2, (h - lobbyLand.naturalHeight * k) / 2, lobbyLand.naturalWidth * k, lobbyLand.naturalHeight * k);
    g.fillStyle = 'rgba(14,12,9,.42)';
    g.fillRect(0, 0, w, h);
  }
  const size = Math.min(1.2, w / 1300);
  const groups = [['red', 0.09, 0.6], ['yellow', 0.91, 0.44], ['blue', 0.1, 0.3], ['teal', 0.88, 0.88], ['green', 0.9, 0.2],
    ['copper', 0.1, 0.88], ['snow', 0.9, 0.66]];
  for (const [fac, fx0, fy] of groups) {
    const x = w * fx0, y = h * fy;
    const men = formation(10, fac);
    for (const p of men) soldierShadow(g, x + p.x * size * 1.7, y + p.y * size * 1.7, size);
    banner(g, x - 3 * size, y + 6 * size, size * 1.3, fac);
    for (const p of men) soldier(g, x + p.x * size * 1.7, y + p.y * size * 1.7, size, fac, { shadow: false });
  }
}

window.addEventListener('resize', () => { if (lobby && !lobby.playing) paintLobbyArt(); });

$('botLess').onclick = () => post('bots', { count: lobby.bots - 1 });
$('botMore').onclick = () => post('bots', { count: lobby.bots + 1 });
$('startBtn').onclick = async () => {
  sound.unlock();
  const out = await post('start');
  $('lobbyError').textContent = out.error || '';
};
$('againBtn').onclick = () => post('reset');

// Браузер даёт звук только после жеста, годится любой щелчок или клавиша.
for (const gesture of ['pointerdown', 'keydown']) window.addEventListener(gesture, sound.unlock);
$('musicBtn').onclick = () => { sound.setMusic(!sound.isMusicOn()); renderSwitches(); };
$('voiceBtn').onclick = () => { sound.setVoice(!sound.isVoiceOn()); renderSwitches(); };
$('hurryBtn').onclick = () => { if (lobby) post('hurry', { on: !lobby.hurry }).catch(() => {}); };   // ответ придёт новым лобби
$('lobbyBand').textContent = `Цель: ${GOAL}`;
// Видео с правилами открывается из лобби, если оно лежит рядом с игрой.
fetch('/how-to-play.mp4', { method: 'HEAD' }).then(r => $('howBtn').classList.toggle('hidden', !r.ok)).catch(() => {});
$('howBtn').onclick = () => {
  sound.quiet(true);
  $('howBox').classList.remove('hidden');
  $('howVideo').play().catch(() => {});
};
$('howClose').onclick = () => {
  $('howVideo').pause();
  $('howBox').classList.add('hidden');
  sound.quiet(false);
};
// Все кнопки партии собраны в «Настройках»: в лобби их нет, после конца остаётся только QR-код.
function toggleSettings() {
  const live = !!shown && !$('stage').classList.contains('hidden');
  $('gameRow').classList.toggle('hidden', !live);
  for (const id of ['statsBtn', 'tiesBtn', 'finishBtn', 'restartBtn']) $(id).classList.toggle('hidden', !live || shown.phase === 'over');
  $('settingsBox').classList.toggle('hidden');
}
const fromSettings = open => () => { $('settingsBox').classList.add('hidden'); open(); };
for (const id of ['settingsBtn', 'lobbySettings', 'overSettings']) $(id).onclick = toggleSettings;
$('settingsClose').onclick = () => $('settingsBox').classList.add('hidden');
$('musicVolume').value = Math.round(sound.getVolume() * 100);
$('musicVolume').oninput = e => sound.setVolume(Number(e.target.value) / 100);
renderSwitches();

// QR-код во время партии: кто случайно вышел, возвращается на своё место.
$('qrBtn').onclick = fromSettings(() => {
  drawQR($('qrBig'), lobby.address, 460);
  $('qrAddress').textContent = lobby.address;
  $('qrBox').classList.remove('hidden');
});
$('qrClose').onclick = () => $('qrBox').classList.add('hidden');

// Заново посреди партии: без подтверждения её можно потерять случайным нажатием.
$('restartBtn').onclick = fromSettings(() => $('restartBox').classList.remove('hidden'));
$('restartNo').onclick = () => $('restartBox').classList.add('hidden');
$('restartYes').onclick = () => post('reset', { force: true });
$('statsBtn').onclick = fromSettings(showStats);

// Отсчёт «20 секунд последним». Сервер считает сам, а экран повторяет его правило по последнему состоянию партии:
// правило включено, хотя бы один человек уже сходил, ждут не больше двух людей и среди ждущих нет бота.
// Во время показа хода сервер не считает, экран тоже. Сервер заканчивает ход на 0–2 секунды позже нуля на экране.
const HURRY_MS = 20000;
let hurryFrom = null;          // { turn, at }: с какого мгновения экран ведёт отсчёт
let hurrySaid = Math.floor(Math.random() * HURRY_LINES.length);   // фразы начала отсчёта идут по кругу
function hurryWatch() {
  const clock = $('hurryClock'), list = shown?.players || [];
  const active = list.filter(p => !p.out && !p.left), waiting = active.filter(p => !p.done);
  const on = !!lobby?.hurry && shown?.phase === 'play' && !playing && !finale && waiting.length > 0
    && waiting.length <= (lobby.lastFew ?? 1) && !waiting.some(p => p.bot) && active.some(p => !p.bot && p.done);
  if (!on) {
    hurryFrom = null;
    clock.classList.add('hidden');
    return;
  }
  if (hurryFrom?.turn !== shown.turn) {
    hurryFrom = { turn: shown.turn, at: performance.now() };
    sound.say(HURRY_LINES[hurrySaid++ % HURRY_LINES.length]);
  }
  const left = Math.max(0, Math.ceil((HURRY_MS - (performance.now() - hurryFrom.at)) / 1000));
  const digits = clock.querySelector('b');
  if (digits.textContent !== String(left)) digits.textContent = left;
  clock.classList.toggle('late', left <= 5);
  clock.classList.remove('hidden');
}
setInterval(hurryWatch, 250);

// Союзы и войны: окно обновляется вместе с партией, пока открыто.
let tiesOpen = false;
function renderTies() {
  if (!tiesOpen || !shown) return;
  const army = {};
  for (const u of shown.units || []) army[u.owner] = (army[u.owner] || 0) + u.n;
  const { svg, list } = tiesView({ players: shown.players.filter(p => !p.horde), relations: shown.relations || [], pacts: shown.pacts || [], army });
  $('tiesDraw').innerHTML = svg;
  $('tiesList').innerHTML = list;
}
$('tiesBtn').onclick = fromSettings(() => {
  tiesOpen = true;
  $('tiesBox').classList.remove('hidden');
  renderTies();
});
$('tiesClose').onclick = () => {
  tiesOpen = false;
  $('tiesBox').classList.add('hidden');
};
$('overClose').onclick = closeStats;
$('finishBtn').onclick = fromSettings(() => $('finishBox').classList.remove('hidden'));
$('finishNo').onclick = () => $('finishBox').classList.add('hidden');
$('finishYes').onclick = () => {
  $('finishBox').classList.add('hidden');
  post('finish');
};

listen('/events', {
  lobby(data) { lobby = data; renderLobby(); renderBand(); renderSwitches(); },
  map(data) {
    stopShow();
    showGame();
    map = data;
    setDarkSeat(data.dark);
    view = new MapView(map, { groundRes: 2, spriteRes: 2.6, politics: true });   // общий экран: политическая карта
    view.onBolt = sound.thunder;
    Object.assign(cam, overview());
  },
  state(data) {
    stopShow();
    setDarkSeat(data.dark);
    setHordeSeat(data.hordeSeat);
    shown = data;
    base = structuredClone(data);
    syncWorld();
    view.setRoads(data.roads);
    renderBand();
    setTurnCaption();
    renderTies();
    if (data.phase === 'over') showFinal(data);
  },
  status(data) {
    if (!shown) return;
    if (playing) { freshPlayers = data.players; if (data.units) freshLive = data; return; }
    showLive(data);
  },
  reel(data) {
    if (!shown) return;
    closeStats();   // ход пришёл: показ идёт на карте, статистика уходит
    queue.push(data);
    pump();
  },
  legend(data) {
    if (!shown) { ack(data.id); return; }
    queue.push({ tale: data });
    pump();
  },
});
