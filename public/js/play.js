// Пульт на телефоне: своя копия карты, отряды, поселения, дороги и дипломатия.
import { MAX_SOLDIERS, R, TERRAIN, center, dist, factionOf, isWater, neighbors, reachable, setDarkSeat, tileAt } from './hex.js';
import * as B from './balance.js';
import { FAC, banner } from './art.js';
import { MapView, factionId } from './view.js';
import { listen, post } from './net.js';

const $ = id => document.getElementById(id);
const canvas = $('world');
const ctx = canvas.getContext('2d');

let token = localStorage.getItem('token') || null;
let faction = -1, me = -1, map = null, view = null, state = null, source = null;
let selected = null, focus = -1, marks = [], reach = new Map(), roadMode = false, giveTo = null;
let shownOffer = null, sheet = null, onYes = null, askExtra = null;
let seenTurn = 0, held = [];                // подтверждённый ход и сообщения за экраном хода
let legendHeard = false;                    // легенду уже рассказал общий экран
let meet = null, framedMeet = null;         // встреча в окне и встреча, к которой уже подъехала камера
const walks = new Map();                    // отряды, идущие по экрану: по правилам они уже на месте
const processions = [];                     // свои переселенцы на дороге: по правилам они уже дошли
const cam = { x: 0, y: 0, s: 0.8 };
let vw = 0, vh = 0, dpr = 1, dirty = true, framedTurn = -1;

function show(...ids) {
  for (const id of ['joinPage', 'waitPage', 'view', 'topBar', 'bottomBar']) {
    $(id).classList.toggle('hidden', !ids.includes(id));
  }
}

function resize() {
  const box = $('view').getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  vw = box.width; vh = box.height;
  canvas.width = Math.round(vw * dpr);
  canvas.height = Math.round(vh * dpr);
  dirty = true;
}
window.addEventListener('resize', resize);

const covered = () => !$('turnCover').classList.contains('hidden');

// Имя царства едет в строке вместе с меткой цвета, а кружок ставит paint.
const DOT = '\uE000';
const tagged = (id, name) => `${DOT}${id}${DOT}${name}`;
const realm = id => tagged(id, factionOf(id).name);

function dot(id) {
  const mark = document.createElement('i');
  mark.className = 'realmDot';
  mark.style.background = FAC[factionId(id)].main;
  return mark;
}

function paint(el, text) {
  el.replaceChildren(...String(text).split(DOT).map((part, i) => (i % 2 ? dot(Number(part)) : part)));
}

const say = text => paint($('info'), text);

// За один ход сообщений бывает несколько: они идут стопкой, а за экраном хода ждут «Далее».
function toast(text) {
  if (covered()) { held.push(text); return; }
  const box = $('toast');
  const line = [...box.children].find(x => x.dataset.text === text) || document.createElement('div');
  line.dataset.text = text;
  paint(line, text);
  box.append(line);
  clearTimeout(line.timer);
  line.timer = setTimeout(() => line.remove(), 3500);
  while (box.children.length > 3) box.firstChild.remove();
}

function clampCamera() {
  const { w, h } = view.size;
  cam.s = Math.min(3, Math.max(Math.min(vw / w, vh / h), cam.s));
  // Камера не уезжает в темноту дальше, чем на одну клетку за край моря. Полосы закрывают
  // верх и низ экрана, поэтому по высоте запас больше: край карты не прячется под ними.
  const span = (size, half, at, lo = 0, hi = 0) => {
    const min = half - lo - R * 1.2, max = size - half + hi + R * 1.2;
    return min > max ? (min + max) / 2 : Math.max(min, Math.min(max, at));
  };
  cam.x = span(w, vw / 2 / cam.s, cam.x);
  // Окно встречи закрывает низ экрана, поэтому существо у края карты должно подняться над ним.
  const low = meet ? $('meetCard').offsetHeight : $('bottomBar').offsetHeight;
  cam.y = span(h, vh / 2 / cam.s, cam.y, $('topBar').offsetHeight / cam.s, low / cam.s);
}

// Панель снизу растёт вместе с кнопками и не должна закрывать выбранную клетку.
function reveal(tile) {
  const y = vh / 2 + (center(map, tile).y - cam.y) * cam.s;
  const high = $('topBar').offsetHeight + 80, low = vh - $('bottomBar').offsetHeight - 40;
  if (y > low) cam.y += (y - low) / cam.s;
  else if (y < high) cam.y -= (high - y) / cam.s;
  clampCamera();
  dirty = true;
}

const toWorld = (px, py) => ({ x: cam.x + (px - vw / 2) / cam.s, y: cam.y + (py - vh / 2) / cam.s });

const myTurn = () => state && state.phase === 'play' && !state.players[me].done && !state.players[me].out;
const mine = () => state.players[me];
const ownOn = tile => state.units.find(u => u.tile === tile && u.owner === me);
const townOn = tile => state.towns.find(t => t[0] === tile);
const patchOn = tile => state.patches.find(p => p[0] === tile);
const terrOf = tile => state.terr.find(t => t[0] === tile)?.[1] ?? null;
const relationTo = id => state.relations.find(r => r.includes(me) && r.includes(id))?.[2] || 'peace';
const foes = () => state.players.filter(p => p.id !== me && relationTo(p.id) === 'war').map(p => p.id);
const friendsOf = id => state.relations.filter(r => r[2] === 'ally' && r.includes(id)).map(r => (r[0] === id ? r[1] : r[0]));
// Сколько ходов держит перемирие с этим царством или с его союзниками: они вступили бы в войну.
const warBar = id => Math.max(0, ...state.truces.filter(t => [id, ...friendsOf(id)].includes(t[0])).map(t => t[1]));
const peerLand = tile => {
  const owner = terrOf(tile);
  return owner != null && owner !== me && !state.players[owner].out && relationTo(owner) === 'peace';
};
const foeOn = tile => state.units.find(u => u.tile === tile && u.owner !== me && relationTo(u.owner) === 'war');
const enemyTown = tile => {
  const town = townOn(tile);
  return town && town[2] != null && town[2] !== me && relationTo(town[2]) === 'war' ? town : null;
};
const guardOf = town => state.units.find(u => u.tile === town[0] && u.owner === town[2]);
const canReach = (tile, u) => neighbors(map, tile).some(id => id === u.tile || (reach.has(id) && !ownOn(id)));

function clearPick() {
  selected = null; focus = -1; reach = new Map();
  marks = roadMode ? roadMarks() : [];
  dirty = true;
  renderInfo();
}

function pick(u) {
  selected = u; focus = -1;
  // В дипломатию войска стоят: отряд выбран, но ходов и целей у него нет.
  const free = state.kind === 'march' && u.mp > 0;
  reach = free ? reachable(map, state.units, u, foes(), true, new Set(state.shut)) : new Map();
  marks = [{ tile: u.tile, kind: 'pick' }];
  for (const tile of reach.keys()) marks.push({ tile, kind: 'move' });
  if (free) {
    for (const e of state.units) {
      if (e.owner === me || relationTo(e.owner) !== 'war') continue;
      if (e.tile === u.tile || canReach(e.tile, u)) marks.push({ tile: e.tile, kind: 'attack' });
    }
    // В чужое поселение не войти: на войне оно красное, отряд бьёт его с соседней клетки.
    for (const [tile] of state.towns) if (enemyTown(tile) && canReach(tile, u)) marks.push({ tile, kind: 'attack' });
  }
  dirty = true;
  renderInfo();
}

function pickTile(tile) {
  selected = null; focus = tile; reach = new Map();
  marks = [{ tile, kind: 'pick' }];
  dirty = true;
  renderInfo();
}

// Цели приказов и заказанный огонь видны и без выбора отряда.
const targetMarks = () => [
  ...state.orders.map(([, target]) => state.units.find(u => u.id === target)).filter(Boolean).map(u => ({ tile: u.tile, kind: 'attack' })),
  ...state.storms.map(([, tile]) => ({ tile, kind: 'attack' })),
  ...state.fires.map(([tile]) => ({ tile, kind: 'attack' })),
];

// Дорогу можно строить в любом месте своей земли, связь с сетью нужна только снабжению.
function roadMarks() {
  return map.tiles.filter(t => terrOf(t.id) === me && !t.road && townOn(t.id)?.[1] !== 'capital' && !isWater(map, t.id) && TERRAIN[t.t].cost != null)
    .map(t => ({ tile: t.id, kind: 'road' }));
}

// Клетку отдают из дипломатии: сначала выбирают царство, потом клетку, потом подтверждают.
function startGive(id) {
  setRoadMode(false);
  giveTo = id;
  // Клетку с грибницей тоже можно отдать: свой лагерь на ней переходит вместе с ней.
  marks = map.tiles.filter(t => terrOf(t.id) === me && !townOn(t.id) && !isWater(map, t.id)).map(t => ({ tile: t.id, kind: 'road' }));
  toast(`Коснитесь клетки, которую отдаёте: ${realm(id)}`);
}

function giveTile(tile) {
  const to = giveTo, can = marks.some(m => m.tile === tile);
  giveTo = null;
  marks = [];
  if (!can) return toast('Эту клетку не отдать');
  const camp = state.patches.find(c => c[0] === tile && c[2] === me);
  const what = camp ? `Она сразу перейдёт вместе с лагерем на грибнице (в ней осталось ${camp[3]}): ${realm(to)}` : `Она сразу перейдёт: ${realm(to)}`;
  ask('Отдать клетку?', [what], 'Да, отдать', () => { clearPick(); command({ type: 'giveLand', tile, other: to }); });
}

function setRoadMode(on) {
  roadMode = on;
  $('roadBtn').classList.toggle('on', on);
  clearPick();
}

async function command(body) {
  const out = await post('cmd', { token, ...body });
  if (out.error) toast(out.error);
}

function tap(px, py) {
  if (!state) return;
  const { x, y } = toWorld(px, py);
  const tile = tileAt(map, x, y);
  if (tile < 0) { giveTo = null; return clearPick(); }
  if (giveTo != null) return giveTile(tile);
  if (roadMode) {
    if (marks.some(m => m.tile === tile)) command({ type: 'road', tile });
    else toast('Дорогу можно строить только на своей земле');
    return;
  }
  if (selected) {
    const aimed = marks.some(m => m.tile === tile && m.kind === 'attack');
    // Защитник в поселении принимает бой первым, само поселение бьют потом. Поселение бьют штурмом: дружина принимает удар первой.
    const foe = aimed && !enemyTown(tile) ? foeOn(tile) : null;
    if (foe && tile !== selected.tile) {
      const attacker = selected.id;
      clearPick();
      return command({ type: 'attack', unit: attacker, target: foe.id });
    }
    if (aimed && enemyTown(tile)) {
      const stormer = selected.id;
      clearPick();
      return command({ type: 'storm', unit: stormer, tile });
    }
    if (reach.has(tile)) {
      const mover = selected, mate = ownOn(tile);
      if (mate) {
        return askMerge(mover, mate, () => {
          clearPick();
          command({ type: 'move', unit: mover.id, tile });
        });
      }
      clearPick();
      return command({ type: 'move', unit: mover.id, tile });
    }
  }
  // Повторное касание отряда открывает клетку под ним: там бывают острог и дорога.
  const own = ownOn(tile);
  if (own && myTurn() && own.id !== selected?.id) pick(own);
  else pickTile(tile);
  reveal(tile);
}

// Вместе с воинами в другой отряд переходят дары и порча: у одних и тех же чар остаётся больший срок.
function askMerge(u, to, fn) {
  const moved = Math.min(u.n, MAX_SOLDIERS - to.n), charms = [...new Set(u.effects.map(e => B.EFFECT_NAMES[e.key]))];
  const lines = [`Перейдёт воинов: ${moved}. В отряде максимум ${MAX_SOLDIERS}, остальные останутся на месте`];
  if (charms.length) lines.push(`С ними перейдут дары и порча: ${charms.join(', ')}. У одних и тех же чар остаётся больший срок`);
  ask(`Объединить с отрядом ${to.name}?`, lines, 'Да, объединить', fn);
}

function actionButton(label, fn, enabled = true) {
  const b = document.createElement('button');
  paint(b, label);
  b.disabled = !enabled;
  b.onclick = fn;
  $('actions').append(b);
}

function renderSquad(u) {
  const t = map.tiles[u.tile], sea = isWater(map, u.tile), march = state.kind === 'march';
  // Срок чар это походы впереди, поэтому в дипломатию цифра та же, что будет в ближайший поход.
  const notes = u.effects.map(e => [B.EFFECT_NAMES[e.key], e.turns - B.effectPad(e.key, state.kind)]).filter(e => e[1] > 0).map(e => e.join(' ')).join(', ');
  const shore = [...reach.keys()].some(id => isWater(map, id) !== sea);
  const lines = [`${sea ? 'В лодке' : 'Пешком'}: ${u.name}, ${u.n}/${MAX_SOLDIERS}${march ? `, ходов ${String(u.mp).replace('.', ',')}` : ''}${notes ? `. ${notes}` : ''}`];
  if (!march) lines.push('Ход дипломатии: войска стоят');
  if (shore) lines.push(sea ? 'На берег: высадка заканчивает поход отряда' : 'На воду: лодка сядет сама, посадка и высадка заканчивают поход отряда');
  const order = state.orders.find(o => o[0] === u.id);
  if (order) {
    lines.push(`Атака в конце хода: ${state.units.find(e => e.id === order[1])?.name ?? 'враг'}`);
    actionButton('Отменить атаку', () => command({ type: 'cancel', unit: u.id }), myTurn());
  }
  if (state.storms.some(o => o[0] === u.id)) {
    lines.push('Штурм поселения в конце хода: ополчение ответит ударом');
    actionButton('Отменить штурм', () => command({ type: 'cancel', unit: u.id }), myTurn());
  } else if (march && u.mp > 0) {
    // В поселение не войти: его бьют с соседней клетки, а защитник принимает бой первым.
    const siege = neighbors(map, u.tile).map(enemyTown).find(Boolean);
    if (siege) lines.push(guardOf(siege) ? 'Рядом вражеское поселение с отрядом: коснитесь его, отряд примет удар первым' : 'Рядом вражеское поселение: коснитесь его, чтобы разрушить');
  }
  for (const e of state.units) {
    if (e.tile !== u.tile || e.owner === me) continue;
    const rel = relationTo(e.owner);
    if (rel === 'war') {
      if (!march || u.mp <= 0) continue;
      actionButton(`Атаковать: ${realm(e.owner)}`, () => { clearPick(); command({ type: 'attack', unit: u.id, target: e.id }); }, myTurn());
      continue;
    }
    const truce = rel === 'peace' ? warBar(e.owner) : 0;
    if (rel === 'peace' && march && u.mp > 0 && !truce) {
      const attack = () => { clearPick(); command({ type: 'attack', unit: u.id, target: e.id }); };
      actionButton(`Напасть: ${realm(e.owner)}`, () => ask('Напасть на мирный отряд?', [realm(e.owner), 'С этого начнётся война'], 'Да, напасть', attack), myTurn());
      continue;
    }
    const hint = rel === 'ally' ? 'Сначала разорвите союз' : truce ? `Перемирие: напасть нельзя ещё ходов ${truce}` : march ? 'Ходов не осталось' : 'Напасть можно в поход';
    if (!lines.includes(hint)) lines.push(hint);
  }
  say(lines.join('\n'));
  if (march) {
    if (u.mp > 0) {
      for (const o of state.units) {
        if (o.owner !== me || !neighbors(map, u.tile).includes(o.tile)) continue;
        const merge = () => { clearPick(); command({ type: 'merge', unit: u.id, target: o.id }); };
        actionButton(`Объединить: ${o.name} (${o.n})`, () => (u.effects.length ? askMerge(u, o, merge) : merge()), myTurn() && o.n < MAX_SOLDIERS);
      }
    }
    const patch = patchOn(u.tile);
    if (patch && (patch[2] == null || patch[2] === me)) {
      if (patch[2] == null) actionButton('Поставить лагерь', () => { clearPick(); command({ type: 'camp', unit: u.id }); }, myTurn());
      const loss = [
        patch[2] === me ? 'Лагерь исчезнет вместе с грибницей' : 'Грибница исчезнет навсегда',
        'Её гниль прекратится, но почерневшая земля останется. Поход отряда закончится',
      ];
      actionButton('Уничтожить грибницу', () => ask('Уничтожить грибницу?', loss, 'Да, уничтожить', () => { clearPick(); command({ type: 'destroy', unit: u.id }); }), myTurn() && u.mp > 0);
    }
    if (!sea && u.n >= B.OSTROG_MIN && !patch && !townOn(u.tile) && terrOf(u.tile) === me) {
      actionButton(`Основать острог: ${B.OSTROG_COST} гр.`, () => { clearPick(); command({ type: 'ostrog', unit: u.id }); }, myTurn() && mine().mushrooms >= B.OSTROG_COST);
    }
  }
  const home = townOn(u.tile);
  if (home?.[2] === me) {
    const room = B.CAP[home[1]] - home[3], n = Math.min(u.n, room), order = [state.orders, state.storms].some(list => list.some(o => o[0] === u.id));
    actionButton(room > 0 ? `Заселить в город: ${n} гн.` : 'В городе нет места', () => { clearPick(); command({ type: 'garrison', unit: u.id }); }, myTurn() && room > 0 && !order);
  }
  if (t.road) {
    // Свою дорогу можно снять всегда, чужую ломают только в поход и только на войне.
    const owner = terrOf(u.tile);
    const open = owner === me || (march && (owner == null || relationTo(owner) === 'war'));
    actionButton(owner === me ? `Сломать дорогу: вернётся ${B.ROAD_REFUND} гр.` : 'Сломать дорогу', () => command({ type: 'raze', tile: u.tile }), myTurn() && open);
  }
  actionButton('Переименовать', () => openRename(u), u.named || state.units.filter(x => x.owner === me && x.named).length < B.NAMED_SQUADS);
}

function renderTown(town) {
  const [tile, type, owner, gnomes] = town;
  const name = type === 'capital' ? 'Столица' : 'Острог';
  if (owner !== me) {
    const fire = state.fires.some(f => f[0] === tile), loss = B.fireLoss(gnomes);
    const head = `${name}${owner == null ? ', нейтральная' : `: ${realm(owner)}`}. Гномов: ${gnomes}`;
    const entry = owner == null ? 'Отряд займёт её, войдя сюда'
      : !enemyTown(tile) ? 'Войти нельзя: только обойти, а на войне разрушить'
        : guardOf(town) ? 'Войти нельзя. Отряд в поселении примет удар первым, остаток падает на гномов'
          : type === 'ostrog' ? `Войти нельзя, только взять штурмом с соседней клетки. Когда гномов меньше ${B.OSTROG_MIN}, острог сдаётся и они уходят к вам в плен`
            : 'Войти нельзя, только разрушить: отряд бьёт поселение с соседней клетки';
    say(fire ? `${head}\nГорыныч сожжёт гномов: ${loss} в конце хода` : `${head}\n${entry}`);
    // Горыныч жжёт только вражеский острог: столицы он не трогает. Дар тратится раньше грибов.
    if (!fire && type === 'ostrog' && enemyTown(tile) && state.kind === 'march') {
      const cost = B.FIRE_COST, { burns } = mine();
      if (burns) actionButton(`Дар Горыныча: сжечь, зарядов ${burns}`, () => command({ type: 'fire', tile }), myTurn());
      else if (state.heroes.some(h => h[1] === 'gorynych')) actionButton(`Нанять Горыныча: ${cost} гр.`, () => command({ type: 'fire', tile }), myTurn() && mine().mushrooms >= cost);
    }
    return;
  }
  const linked = state.net.includes(tile);
  const crop = '';   // столица и острога грибов не приносят, их дают только лагеря
  const road = map.tiles[tile].road || neighbors(map, tile).some(id => map.tiles[id].road || townOn(id));
  const cut = road ? 'Дорога не доходит до столицы' : 'Нет дороги';
  const head = `${name}, гномов: ${gnomes}${crop}${linked ? '' : `. ${cut}: грибы не доходят, минус ${B.CUT_OFF} житель в ход`}`;
  say(head);
  const spare = type === 'capital' ? free().gnomes : gnomes - 1;
  actionButton('Собрать дружину', () => openMobilize(tile, spare), myTurn() && spare > 0 && !ownOn(tile));
  if (type === 'ostrog') {
    const room = Math.min(free().gnomes, B.CAP.ostrog - gnomes);
    const sieged = id => state.units.some(u => u.tile === id && u.owner !== me && relationTo(u.owner) === 'war');
    const open = !sieged(tile) && !sieged(mine().capital);
    if (!open) say(`${head}\nЗдесь или в столице стоит враг: переселять нельзя`);
    // Гномы ходят только по дороге: без неё переселять нельзя ни туда, ни обратно.
    const road = linked ? '' : ': нет дороги';
    actionButton(`Переселить из столицы${road}`, () => openSettle(tile, room), myTurn() && room > 0 && open && linked);
    const back = Math.min(gnomes - 1, B.CAP.capital - state.census.capital);
    actionButton(`Переселить в столицу${road}`, () => openSettle(tile, back, true), myTurn() && back > 0 && open && linked);
    const cost = B.MOVE_CAPITAL;
    const lines = [`Цена: ${cost} гр.`, 'Прежняя столица станет острогом, а грибы столицы будут приходить сюда'];
    actionButton(`Столица сюда: ${cost} гр.`, () => ask('Перенести столицу сюда?', lines, 'Да, перенести', () => { clearPick(); command({ type: 'capital', tile }); }), myTurn() && linked && mine().mushrooms >= cost);
  }
}

// Горыныч встречает только на своей клетке, Водяной только лодки, остальные всех, кто прошёл рядом.
const HERO_MEETS = { gorynych: 'Встреча на его клетке', vodyanoy: 'Рядом с лодкой случится встреча' };

function describeTile(tile) {
  const t = map.tiles[tile];
  const hero = view.heroAt.get(tile);
  const town = townOn(tile), patch = patchOn(tile);
  if (town) return renderTown(town);
  if (hero) {
    const mark = state.legend?.hero === hero ? '. Особые дар и проклятье легенды партии' : '';
    say(`${B.HEROES[hero].name}. ${HERO_MEETS[hero] ?? 'Рядом с отрядом случится встреча'}: бой или беда${mark}`);
    return;
  }
  if (patch) {
    const [, dying, owner, left] = patch;
    if (owner === me) {
      const linked = state.net.includes(tile);
      const away = peerLand(tile) ? '. Это земля соседа: нужны дорога и союз' : '';
      say(`Ваш лагерь: в грибнице осталось ${left}, ${linked ? `грибов в ход ${B.campYield(state.mods.camp)}` : `нет дороги к столице: грибы не идут${away}`}${dying ? `. Исчезнет через ${dying}` : ''}`);
    } else say(`Грибница${owner != null ? `, лагерь: ${realm(owner)}` : ''}${dying ? `. Исчезнет через ${dying}` : ''}`);
    return;
  }
  const owner = terrOf(tile);
  const parts = [TERRAIN[t.t].name];
  if (t.road) parts.push('дорога');
  if (t.rot) parts.push('земля чернеет');
  if (owner != null) parts.push(realm(owner));
  if (state.shut.includes(tile)) parts.push('граница закрыта');
  say(parts.join(' · '));
}

function renderTile(tile) {
  describeTile(tile);
  if (map.tiles[tile].road && terrOf(tile) === me) {
    actionButton(`Сломать дорогу: вернётся ${B.ROAD_REFUND} гр.`, () => command({ type: 'raze', tile }), myTurn());
  }
}

function renderOver() {
  say(state.winner === me ? 'Вы победили!' : state.winner == null ? 'Все царства погибли' : `Победа: ${realm(state.winner)}`);
  actionButton('Итоги партии', openResults);
}

function renderInfo() {
  $('actions').textContent = '';
  if (state?.phase === 'over') renderOver();
  else if (roadMode) say(`Дорога: ${B.ROAD_COST} гр. за клетку. Коснитесь подсвеченной`);
  else if (selected) renderSquad(selected);
  else if (focus >= 0) renderTile(focus);
  else if (myTurn()) say(state.kind === 'march' ? 'Ваш ход: коснитесь отряда' : 'Ваш ход: войска стоят, переговоры в «Дипломатии»');
  else if (state?.phase === 'play') {
    const rest = state.players.filter(p => !p.out && !p.left && !p.done).map(p => realm(p.id));
    say(rest.length ? `Ждём: ${rest.join(', ')}` : 'Новый ход…');
  }
}

const signed = n => (n < 0 ? `−${-n}` : `+${n}`);

const OMEN_HEAD = 'Знамение года: ';
const LEGEND_TAIL = 4;                      // после сказа идут дар, проклятье, знамение и концовка
const MEET_ZOOM = 110 / (R * 1.73);         // при встрече клетка шириной 110 точек
const WALK_MS = 320;                        // столько идёт отряд через клетку на экране телефона
const MEET_VERB = { gorynych: 'прилетел', vodyanoy: 'выплыл', leshy: 'вышел', yaga: 'вышла', koschei: 'вышел' };

// Запас и прогноз держатся вместе: строка переносится только между ними.
function stockPart(name, have, ...next) {
  const part = document.createElement('span');
  part.textContent = [name, have, ...next].join(' ');
  return part;
}

function renderBars() {
  if (!state) return;
  const p = mine(), { forecast: f, census: c } = state, lost = f.starved + f.cutOff;
  $('stock').replaceChildren(
    stockPart('Грибы', p.mushrooms, signed(f.mushrooms)), ' · ',
    // Родится и убудет по всему царству в следующем ходу, ноль не показываем.
    stockPart('Гномы', c.capital, ...(f.born ? [signed(f.born)] : []), ...(lost ? [signed(-lost)] : [])),
  );
  paint($('realmBtn'), realm(me));
  $('turnInfo').textContent = `Ход ${state.turn} · ${B.TURN_NAMES[state.kind]} · ${B.WEATHER[state.weather].name}${p.blight ? ' · Хворь' : ''}`;
  $('endBtn').disabled = !myTurn();
  $('endBtn').textContent = myTurn() ? 'Конец хода' : state.phase === 'over' ? 'Партия окончена' : 'Ждём других';
  $('roadBtn').disabled = !myTurn();
}

// Легенда партии: то же самое на экране хода и в окне «Легенда».
function legendLine(head, text) {
  const line = document.createElement('p');
  line.className = 'legendLine';
  const name = document.createElement('b');
  name.textContent = head;
  line.append(name, text);
  return line;
}

function legendBlock(story) {
  const { title, hero, gift, curse, lines } = state.legend;
  const omen = lines.find(line => line.startsWith(OMEN_HEAD))?.slice(OMEN_HEAD.length) ?? state.legend.omenName;
  return [
    legendLine('Легенда: ', title),
    ...(story ? lines.slice(0, -LEGEND_TAIL).map(line => note(line, 'legendStory')) : []),
    legendLine('Существо легенды: ', B.HEROES[hero].name),
    legendLine(`Особый дар. ${gift.name}: `, gift.text),
    legendLine(`Особое проклятье. ${curse.name}: `, curse.text),
    legendLine('Знамение года: ', omen),
  ];
}

// Сколько погибло за прошедший ход. Потери врагов не секрет: это не запасы.
function fallenLine() {
  if (state.turn < 2 || !state.fallen) return '';
  const row = state.fallen.find(r => r.id === me), own = row?.total ?? 0, all = state.fallenTotal ?? 0;
  if (!all) return `За ход ${state.turn - 1} никто не погиб`;
  const why = Object.entries(B.FALLEN_NAMES).filter(([key]) => row?.[key]).map(([key, name]) => `${name.toLowerCase()} ${row[key]}`);
  return `За ход ${state.turn - 1} погибло: у вас ${own}${why.length ? ` (${why.join(', ')})` : ''}, всего ${all}`;
}

// Экран хода: пока общий экран показывает легенду или итоги, потом название нового хода и кнопка «Далее».
function renderCover() {
  const on = state?.phase === 'play' && (state.showing || seenTurn !== state.turn);
  $('turnCover').classList.toggle('hidden', !on);
  if (!on) {
    held.splice(0).forEach(toast);
    renderMeet();
    return;
  }
  renderMeet();
  const wait = state.showing, telling = wait && state.turn === 1 && !!state.legend;
  if (telling) legendHeard = true;
  $('turnCover').classList.toggle('wait', wait);
  $('coverNext').classList.toggle('hidden', wait);
  $('coverTitle').textContent = telling ? state.legend.title : wait ? `Ход ${state.turn - 1} завершён` : `Ход ${state.turn}`;
  $('coverName').textContent = telling ? 'Слушайте легенду на общем экране' : wait ? 'Смотрите на общий экран' : B.TURN_NAMES[state.kind];
  $('coverHint').textContent = wait ? '' : `${B.TURN_HINTS[state.kind]} · Погода: ${B.WEATHER[state.weather].name}`;
  $('coverFallen').textContent = wait ? '' : fallenLine();
  $('coverLegend').replaceChildren(
    ...(state.turn === 1 ? [legendLine('Цель: ', B.GOAL)] : []),
    ...((telling || !wait) && state.turn === 1 && state.legend ? legendBlock(telling || !legendHeard) : []),
  );
  $('coverList').replaceChildren(...(wait ? [] : state.notices).map(text => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }));
}

$('coverNext').onclick = () => {
  seenTurn = state.turn;
  renderCover();
};

// Встреча с существом: окно нельзя закрыть, решить можно боем или бедой.
// Сразиться может только живой отряд встречи.
function fillMeet() {
  const e = meet, hero = B.HEROES[e.hero].name, squad = state.units.find(u => u.id === e.unit);
  const whom = e.ostrog != null ? 'вашему острогу' : squad ? `отряду «${squad.name}»` : 'вам';
  $('meetTitle').textContent = hero;
  $('meetText').textContent = `${hero} ${MEET_VERB[e.hero]} к ${whom}. Выбор нельзя отложить`;
  $('meetMark').textContent = e.dark ? 'Тёмные времена: дар и беда сильнее'
    : state.legend?.hero === e.hero ? `Особые дар и проклятье легенды «${state.legend.title}»` : '';
  $('meetCurse').textContent = `${e.curse.name}: ${e.curse.text}`;
  $('meetFight').classList.toggle('hidden', e.chance == null);
  if (e.chance != null) {
    $('meetOdds').textContent = `Сразиться: ${Math.round(e.chance * 100)}%`;
    const n = Math.min(MAX_SOLDIERS, squad ? squad.n : townOn(e.ostrog)[3]);
    $('meetStake').textContent = `${squad ? `«${squad.name}», воинов` : 'Гномы острога, бьются'} ${n}. Победа: ${e.gift.name} (${e.gift.text}) и ${e.price} гр., потери ${B.fightWinLoss(n)} из ${n}. Поражение: потери ${B.fightLoseLoss(n)} из ${n} и беда`;
  }
  $('meetFight').disabled = $('meetHurt').disabled = false;
}

// Чем кончилась встреча: у боя ещё исход и потери.
function meetToast(e) {
  const hero = B.HEROES[e.hero].name;
  if (e.won == null) return `${hero}: ${e.text}`;
  return `${hero}: ${e.won ? `победа, грибы +${e.gold}` : 'поражение'}, потери ${e.lost}, ${e.text}`;
}

// Камера подъезжает так, чтобы существо стояло над окном встречи.
function frameMeet() {
  const { x, y } = center(map, meet.tile);
  cam.s = Math.max(cam.s, MEET_ZOOM);
  const spot = ($('topBar').offsetHeight + (vh - $('meetCard').offsetHeight)) / 2;
  cam.x = x;
  cam.y = y + (vh / 2 - spot) / cam.s;
  clampCamera();
  dirty = true;
}

function renderMeet() {
  meet = state?.phase === 'play' && !covered() ? state.encounters[0] ?? null : null;
  $('meetBox').classList.toggle('hidden', !meet);
  if (!meet) return;
  fillMeet();
  if (framedMeet === meet.id) return;
  framedMeet = meet.id;
  closeAsk();
  closeSheet();
  frameMeet();
}

async function settleMeet(fight) {
  $('meetFight').disabled = $('meetHurt').disabled = true;
  await command({ type: 'encounter', id: meet.id, fight });
  if (meet) renderMeet();
}

$('meetFight').onclick = () => settleMeet(true);
$('meetHurt').onclick = () => settleMeet(false);

function jumpTo(tile, scale) {
  const c = center(map, tile);
  cam.x = c.x; cam.y = c.y;
  if (scale) cam.s = Math.max(cam.s, scale);
  clampCamera();
  dirty = true;
}

function frameFirstSquad() {
  const list = state.units.filter(u => u.owner === me);
  const u = list.find(x => x.mp > 0) || list[0];
  if (u) jumpTo(u.tile, 76 / (R * 1.73));
}

function apply(next) {
  setDarkSeat(next.dark);
  const fresh = next.turn !== state?.turn || next.phase !== state?.phase;
  state = next;
  me = state.you ?? me;
  view.setTowns(state.towns);
  view.setRealms(state.players);
  // Встреченное существо видно на своей клетке, даже Водяной.
  view.setHeroes([...state.heroes, ...state.encounters.map(e => [e.tile, e.hero])]);
  view.applyLand(state.land);
  view.setTerritory(state.terr);
  view.setSupply(state.supply);
  view.setPiers(state.piers);
  view.setWeather(state.weather);
  // С новым ходом старые окна и выбор теряют смысл.
  if (fresh) clearLocal();
  if (selected) {
    const same = state.units.find(u => u.id === selected.id);
    if (same && myTurn()) pick(same); else clearPick();
  } else if (roadMode) {
    if (myTurn()) marks = roadMarks(); else setRoadMode(false);
  }
  if (myTurn() && framedTurn !== state.turn) {
    framedTurn = state.turn;
    frameFirstSquad();
  }
  renderInfo();
  renderBars();
  if (sheet?.live) renderSheet();
  if (askExtra) renderAskExtra();
  showOffer();
  renderCover();
  dirty = true;
}

// Отряд идёт по своему пути и перебирает ногами, чужие тоже: телефон видит их ходы сразу.
function walkOut(e) {
  if (covered()) return;
  const points = e.path.map(id => ({ ...center(map, id), sea: isWater(map, id) }));
  walks.set(e.unit, { points, start: performance.now(), ms: (points.length - 1) * WALK_MS, ghost: { id: e.unit, owner: e.owner, n: e.n, name: e.name, tile: e.path[0], effects: [] } });
}

function walkers(now) {
  const positions = new Map();
  for (const [id, w] of walks) {
    const k = (now - w.start) / w.ms;
    if (k >= 1) { walks.delete(id); continue; }
    const along = Math.max(0, k) * (w.points.length - 1), i = Math.floor(along), f = along - i;
    const a = w.points[i], b = w.points[i + 1];
    positions.set(id, { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, march: true, boat: (f < 0.5 ? a : b).sea, dir: Math.sign(b.x - a.x) || undefined });
  }
  return positions;
}

function onEvents(events) {
  for (const e of events) {
    if (e.type === 'move') walkOut(e);
    else if (e.type === 'resettle' && e.owner === me && !covered()) {
      processions.push(view.procession(e, performance.now(), Math.max(900, (e.cells.length - 1) * WALK_MS * 1.4)));
    }
    else if (e.type === 'found') {
      toast(e.hint ? 'Баба Яга подсказала грибницу' : 'Найдена грибница!');
      jumpTo(e.tile);
    } else if (e.type === 'note') toast(e.text);
    else if (e.type === 'encounter' && e.owner === me) toast(meetToast(e));
    else if (e.type === 'merged' && e.owner === me) toast(`Отряды объединены, перешло воинов: ${e.moved}`);
    else if (e.type === 'razed' && e.by === me) toast(e.owner === me ? `Дорога сломана, вернулся ${B.ROAD_REFUND} гриб` : 'Дорога сломана');
    else if (e.type === 'razed' && e.owner === me) toast(`Вашу дорогу сломали, вернулся ${B.ROAD_REFUND} гриб`);
    else if (e.type === 'fire' && e.from === me) toast(`Горыныч сжёг гномов: ${e.burned}`);
    else if (e.type === 'fire' && e.owner === me) toast(`Горыныч сжёг у вас гномов: ${e.burned}`);
    else if (e.type === 'war' && e.to === me) toast(`${realm(e.from)} хочет посадить вас на кол`);
    else if (e.type === 'capital' && e.owner === me) toast('Столица перенесена');
    else if (e.type === 'borderShut' && e.to === me) toast(`${realm(e.from)} закрывает границу`);
    else if (e.type === 'broken' && e.to === me) toast(`${realm(e.from)} разрывает союз`);
    else if (e.type === 'deal' && e.from === me) toast(`${realm(e.to)}: согласны`);
    else if (e.type === 'refused' && e.from === me) toast(`${realm(e.to)}: отказ`);
    else if (e.type === 'townFell' && e.captives && e.by === me) toast(`Острог сдался: у вас в плену гномов ${e.captives}`);
    else if (e.type === 'ransom' && e.by === me) toast(`${realm(e.owner)} выкупает пленных: грибов +${e.price}`);
    else if (e.type === 'captivesStay' && e.by === me) toast(`Пленных не выкупили: в столице гномов +${e.n}`);
    else if (e.type === 'captivesStay' && e.owner === me) toast(`Пленных не выкупили, они остались: ${realm(e.by)}`);
    else if (e.type === 'captivesFreed' && e.owner === me) toast(`Пленные вернулись домой: гномов ${e.n}`);
  }
}

// --- окна ---

// live: окно перерисовывается с каждым новым состоянием. Поле ввода так потеряло бы фокус.
function openSheet(title, build, live = false) {
  sheet = { title, build, live };
  $('sheet').classList.remove('hidden');
  renderSheet();
}

function renderSheet() {
  if (!sheet) return;
  paint($('sheetTitle'), sheet.title);
  $('sheetBody').textContent = '';
  sheet.build($('sheetBody'));
}

function closeSheet() {
  sheet = null;
  $('sheet').classList.add('hidden');
}
$('sheetClose').onclick = closeSheet;

// Подтверждение поверх всех окон. lines: что именно подтверждается, yes: подпись кнопки согласия.
// extra: живая часть вопроса, она перерисовывается с каждым новым состоянием.
function ask(title, lines, yes, fn, extra = null) {
  $('askTitle').textContent = title;
  paint($('askText'), lines.join('\n'));
  $('askYes').textContent = yes;
  onYes = fn;
  askExtra = extra;
  renderAskExtra();
  $('askBox').classList.remove('hidden');
}

function renderAskExtra() {
  $('askExtra').replaceChildren(...(askExtra?.() ?? []));
}

function closeAsk() {
  onYes = null;
  askExtra = null;
  renderAskExtra();
  $('askBox').classList.add('hidden');
}

$('askNo').onclick = closeAsk;
$('askYes').onclick = () => {
  const fn = onYes;
  closeAsk();
  fn?.();
};

function button(label, fn, enabled = true) {
  const b = document.createElement('button');
  paint(b, label);
  b.disabled = !enabled;
  b.onclick = fn;
  return b;
}

function stepper(label, value, max, change) {
  const row = document.createElement('div');
  row.className = 'stepper';
  const name = document.createElement('span');
  name.textContent = label;
  const count = document.createElement('b');
  count.textContent = value;
  const box = document.createElement('div');
  box.append(button('−', () => change(value - 1), value > 0), count, button('+', () => change(value + 1), value < max));
  row.append(name, box);
  return row;
}

function note(text, name = 'note2') {
  const p = document.createElement('p');
  p.className = name;
  p.textContent = text;
  return p;
}

function scaleBar(text, chance) {
  const box = document.createElement('div');
  box.className = 'scale';
  box.textContent = `${text}: ${Math.round(chance * 100)}%. Бот ответит один раз за ход`;
  const bar = document.createElement('div');
  bar.className = 'scaleBar';
  const fill = document.createElement('div');
  fill.style.width = `${Math.round(chance * 100)}%`;
  bar.append(fill);
  box.append(bar);
  return box;
}

function openRename(u) {
  openSheet('Имя отряда', body => {
    const input = document.createElement('input');
    input.maxLength = 14;
    input.value = u.name;
    input.className = 'nameField';
    const save = () => {
      const name = input.value;
      closeSheet();
      command({ type: 'rename', unit: u.id, name });
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    body.append(input, button('Сохранить', save));
    input.focus();
    input.select();
  });
}

function openMobilize(tile, max) {
  let count = Math.min(MAX_SOLDIERS, max);
  const limit = Math.min(MAX_SOLDIERS, max);
  openSheet('Сбор дружины', body => {
    body.append(stepper('Гномов в отряд', count, limit, n => { count = Math.max(1, n); renderSheet(); }));
    body.append(button('Собрать отряд', () => {
      closeSheet();
      clearPick();
      command({ type: 'mobilize', tile, count });
    }, myTurn()));
  });
}

// Гномов из столицы можно переселить в любой свой острог, куда доходит дорога, в любой ход.
// back: из острога в столицу. Идут они по дороге, это видно в показе хода.
function openSettle(tile, limit, back = false) {
  let count = Math.min(5, limit);
  openSheet(back ? 'Переселение в столицу' : 'Переселение из столицы', body => {
    body.append(stepper(back ? 'Гномов в столицу' : 'Гномов в острог', count, limit, n => { count = Math.max(1, n); renderSheet(); }));
    body.append(button('Переселить', () => {
      closeSheet();
      clearPick();
      command({ type: 'settle', tile, count, back });
    }, myTurn()));
  });
}

// Имя князя: по нему игрок входит заново, в партии оно меняется сразу. Царство зовётся всегда одинаково.
function openPrince() {
  openSheet('Имя князя', body => {
    const input = document.createElement('input');
    input.maxLength = B.NAME_MAX;
    input.value = state?.players[me]?.name || localStorage.getItem('name') || '';
    input.className = 'nameField';
    const save = async () => {
      const name = input.value;
      closeSheet();
      const out = await post('prince', { token, name });
      if (out.error) toast(out.error);
      else localStorage.setItem('name', out.name);
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    body.append(input, button('Сохранить', save));
    input.focus();
    input.select();
  });
}

function openLegend() {
  openSheet('Легенда', body => {
    body.append(...legendBlock(true));
  });
}

function stockRow(label, value, sum = false) {
  const row = document.createElement('div');
  row.className = `stockRow${sum ? ' sum' : ''}`;
  const name = document.createElement('span');
  name.textContent = label;
  const count = document.createElement('b');
  count.textContent = value;
  row.append(name, count);
  return row;
}

// Остаток урожая после еды игрок делит каждый ход: сколько грибов отдать гномам, остальное идёт в запас.
function shareBlock() {
  const { forecast: f } = state, spare = Math.max(0, f.crop - f.eaten);
  if (!spare) return [stockHead('Урожай'), note('После еды ничего не останется.', 'stockText')];
  const count = share => Math.floor(spare * share) * state.mods.growth;
  const row = document.createElement('div');
  row.className = 'row';
  const shares = B.BIRTH_SHARES.filter((share, i) => i === 0 || count(share) !== count(B.BIRTH_SHARES[i - 1]));
  for (const share of shares) {
    const b = button(String(count(share)), () => command({ type: 'births', share }), myTurn());
    b.classList.toggle('chosen', share === mine().birthShare);
    row.append(b);
  }
  return [
    stockHead(`Урожай: останется ${spare}`),
    note('Сколько из них отдать на новых гномов?', 'stockText'),
    row,
    stockRow('Гномам', f.born),
    stockRow('В запас', Math.max(0, spare - f.born)),
    note('Из гномов собирают отряды. Запас кормит войско и идёт на стройку.', 'stockText'),
  ];
}

function stockHead(text) {
  const head = document.createElement('h3');
  head.className = 'stockHead';
  head.textContent = text;
  return head;
}

// Кто убудет в следующем ходу и почему. Касание ведёт к этому месту на карте.
function lossRow({ where, have, lost, cause, tile }) {
  const b = button(`${where}, ${have}: ${signed(-lost)}, ${cause === 'road' ? 'нет дороги' : cause === 'blight' ? 'хворь' : 'голод'}`, () => {
    closeSheet();
    jumpTo(tile);
    pickTile(tile);
  });
  b.className = 'ostrogBtn';
  return b;
}

// Окно «Запасы» словами объясняет числа с верхней полосы. Числа со знаком это следующий ход.
function openStock() {
  openSheet('Запасы', body => {
    const p = mine(), { forecast: f, census: c } = state;
    body.append(
      ...(p.blight ? [
        stockHead('Хворь'),
        stockRow('Умрёт за ход', f.starved),
        note('Грибов нет: столица вымирает, остроги пусты.', 'stockText'),
        note('Лечение: лагерь на грибнице с дорогой до столицы или чужой лагерь.', 'stockText'),
      ] : []),
      stockHead('Гномы'),
      stockRow('В столице', c.capital, true),
      stockRow('В острогах', c.ostrogs),
      stockRow('В отрядах', c.squads),
      stockRow('Всего', c.capital + c.ostrogs + c.squads),
      stockHead('Гномы за ход'),
      stockRow('Родятся', signed(f.born)),
      ...(f.cutOff ? [stockRow('Уйдут без дороги', signed(-f.cutOff))] : []),
      ...(f.starved ? [stockRow(p.blight ? 'Умрут от хвори' : 'Умрут от голода', signed(-f.starved))] : []),
      ...f.losses.map(lossRow),
      stockRow('Столица изменится', signed(f.capital), true),
      note(`Рождаются только в столице: гриб за гнома. Столица не ест, остроги и отряды едят гриб на ${B.EAT_PER} едоков. Без дороги поселение теряет жителя в ход.`, 'stockText'),
      stockHead('Грибы'),
      stockRow('Запас', p.mushrooms),
      stockRow('Сбор', signed(f.crop)),
      ...(f.flooded ? [stockRow('Зальёт гроза', signed(-f.flooded))] : []),
      stockRow('Съедят', signed(-f.eaten)),
      ...(f.born ? [stockRow('На новых гномов', signed(-f.born))] : []),
      stockRow('Останется', p.mushrooms + f.mushrooms, true),
      ...shareBlock(),
      note('Грибы дают только лагеря на грибницах, если к ним есть дорога или лодочка. Столица и острога грибов не приносят. Кончатся грибницы, придёт хворь.', 'stockText'),
      stockHead('Погода'),
      stockRow('Сейчас', B.WEATHER[state.weather].name),
      stockRow('Следующий ход', B.WEATHER[state.nextWeather].name),
      note('Действует ходом позже. Дождь: сбор в полтора раза больше. Гроза: сбор вдвое меньше.', 'stockText'),
      ...(B.WEATHER[state.nextWeather].dark ? [note(`Будет гроза: спрячьте отряды в остроге или столице. Вне поселений их найдут злодеи, и царство потеряет от ${B.DARK_SLAY[0]} до ${B.DARK_SLAY[1]} воинов.`, 'stockText')] : []),
      stockHead('Цель'),
      stockRow('Ваших лагерей', state.patches.filter(x => x[2] === me).length),
      stockRow('Найдено грибниц', state.patches.length),
      note('Лагеря на всех грибницах карты или остаться последним царством.', 'stockText'),
      ...(p.burns ? [stockHead('Дар Горыныча'), stockRow('Сожжений', p.burns), note('Коснитесь вражеского острога в поход: Горыныч сожжёт его даром.', 'stockText')] : []),
    );
  }, true);
}

// Те же итоги, что на общем экране: узкий телефон показывает их списком, а не таблицей.
function openResults() {
  const { turns, players } = state.results;
  openSheet(`Итоги: ходов ${turns}`, body => {
    if (state.legend) body.append(note(`Легенда партии: ${state.legend.title}`));
    for (const p of [...players].sort((a, b) => (b.id === state.winner) - (a.id === state.winner) || b.land - a.land)) {
      const row = document.createElement('div');
      row.className = 'realmRow';
      const name = document.createElement('div');
      name.className = 'name';
      paint(name, `${realm(p.id)} (${p.bot ? 'бот' : p.name})`);
      const about = document.createElement('div');
      about.className = 'note';
      about.textContent = `${p.id === state.winner ? 'Победа' : p.fellOn != null ? `Пало на ходу ${p.fellOn}` : 'Выстояло'} · земля ${p.land} · поселения ${p.towns} · гномы ${p.gnomes}`
        + ` · грибы ${p.picked} · разрушено поселений ${p.taken} · побито врагов ${p.killed} · потери ${p.lost}`;
      row.append(name, about);
      body.append(row);
    }
  });
}

// --- дипломатия ---

const bundleText = b => {
  const parts = [];
  if (b.mushrooms) parts.push(`грибы: ${b.mushrooms}`);
  if (b.gnomes) parts.push(`гномы на балансе: ${b.gnomes}`);
  if (b.ostrogs.length) parts.push(`остроги: ${b.ostrogs.length}`);
  return parts.join(', ') || 'ничего';
};

const OFFER_NAMES = { trade: 'сделку', ally: 'союз', peace: 'мир', pass: 'пропуск' };
const TRUCE_TEXT = `Ещё ${B.TRUCE_TURNS} ходов никто из вас не сможет напасть снова`;

const offerTerms = o => (o.kind === 'trade'
  ? [`Вы получаете: ${bundleText(o.give)}`, `Вы отдаёте: ${bundleText(o.take)}`]
  : [`Подарок вам: ${bundleText(o.give)}`]);

function showOffer() {
  const offer = state.offers.find(o => o.to === me);
  shownOffer = offer || null;
  $('offerBox').classList.toggle('hidden', !offer);
  if (!offer) return;
  const able = canGive(offer.take);
  paint($('offerText'), [`${realm(offer.from)} ${offer.kind === 'pass' ? 'просит' : 'предлагает'} ${OFFER_NAMES[offer.kind]}`, ...offerTerms(offer), ...(able ? [] : ['Вам нечем заплатить: можно только отказаться'])].join('\n'));
  $('offerYes').disabled = !able;
}

async function answer(offer, accept) {
  $('offerBox').classList.add('hidden');
  const out = await post('answer', { token, offer, accept });
  if (out.error) toast(out.error);
}

$('offerYes').onclick = () => {
  if (!shownOffer) return;
  const { id, kind, from } = shownOffer;
  const terms = [realm(from), ...offerTerms(shownOffer), ...(kind === 'peace' ? [TRUCE_TEXT] : [])];
  if (kind === 'pass') ask('Открыть границу?', [...terms, 'Их отряды смогут входить на вашу землю'], 'Да, открыть', () => answer(id, true));
  else ask(`Принять ${OFFER_NAMES[kind]}?`, terms, 'Да, принять', () => answer(id, true));
};
$('offerNo').onclick = () => { if (shownOffer) answer(shownOffer.id, false); };

const ostrogsOf = pid => state.towns.filter(t => t[2] === pid && t[1] === 'ostrog');
// Свободный запас: уже обещанное в неотвеченных предложениях второй раз отдать нельзя.
function free(who = me) {
  const p = state.players[who], sent = who === me ? state.offers.filter(o => o.from === me) : [];
  const owed = key => sent.reduce((sum, o) => sum + o.give[key], 0);
  return {
    mushrooms: Math.max(0, p.mushrooms - owed('mushrooms')), gnomes: Math.max(0, p.stock - 1 - owed('gnomes')),
    ostrogs: ostrogsOf(who).filter(t => !sent.some(o => o.give.ostrogs.includes(t[0]))),
  };
}
function canGive(b) {
  const have = free();
  return have.mushrooms >= b.mushrooms && have.gnomes >= b.gnomes
    && b.ostrogs.every(id => have.ostrogs.some(t => t[0] === id));
}
const worth = b => b.mushrooms + b.gnomes * B.GNOME_VALUE
  + b.ostrogs.reduce((sum, id) => sum + B.OSTROG_VALUE + townOn(id)[3] * B.GNOME_VALUE, 0);

function dealSide(title, who, bundle) {
  const side = document.createElement('div');
  side.className = 'dealSide';
  const head = document.createElement('h3');
  head.textContent = title;
  side.append(head);
  // Запасы видны сразу, а больше, чем есть, выставить нельзя, даже если они убыли, пока окно открыто.
  const have = free(who), row = (label, key) => {
    bundle[key] = Math.min(bundle[key], have[key]);
    side.append(stepper(`${label}, есть ${have[key]}`, bundle[key], have[key], n => { bundle[key] = n; renderSheet(); }));
  };
  bundle.ostrogs = bundle.ostrogs.filter(id => have.ostrogs.some(t => t[0] === id));
  row('Грибы', 'mushrooms');
  row('Гномы на балансе', 'gnomes');
  for (const [id, , , gnomes] of have.ostrogs) {
    const on = bundle.ostrogs.includes(id);
    const b = button(`Острог, гномов: ${gnomes}`, () => {
      bundle.ostrogs = on ? bundle.ostrogs.filter(v => v !== id) : [...bundle.ostrogs, id];
      renderSheet();
    });
    b.className = `ostrogBtn${on ? ' on' : ''}`;
    side.append(b);
  }
  return side;
}

async function sendOffer(body) {
  const out = await post('offer', { token, ...body });
  closeSheet();
  if (out.error) toast(out.error);
  else if (out.answer === 'sent') toast('Предложение отправлено');
}

const talkable = () => myTurn();

function openDeal(p) {
  const give = { mushrooms: 0, gnomes: 0, ostrogs: [] }, take = { mushrooms: 0, gnomes: 0, ostrogs: [] };
  const offer = () => ask(
    'Предложить сделку?',
    [realm(p.id), `Вы отдаёте: ${bundleText(give)}`, `Вы получаете: ${bundleText(take)}`],
    'Да, предложить',
    () => sendOffer({ to: p.id, kind: 'trade', give, take }),
  );
  openSheet(`Сделка: ${realm(p.id)}`, body => {
    body.append(dealSide('Вы отдаёте', me, give), dealSide('Вы получаете', p.id, take));
    if (p.bot) body.append(scaleBar('Шанс согласия', B.dealChance(worth(give), worth(take), relationTo(p.id) === 'war')));
    body.append(button('Предложить', offer, talkable() && worth(give) + worth(take) > 0));
  }, true);
}

// Союз и мир предлагаются с подарком: перед отправкой показываем итог.
const offerGift = (p, kind, gift) => ask(
  kind === 'pass' ? 'Попросить пропуск?' : `Предложить ${OFFER_NAMES[kind]}?`,
  [realm(p.id), gift ? `Вы дарите: грибы: ${gift}` : 'Без подарка'],
  kind === 'pass' ? 'Да, попросить' : 'Да, предложить',
  () => sendOffer({ to: p.id, kind, give: { mushrooms: gift } }),
);

function openAlly(p) {
  let gift = p.bot ? Math.min(free().mushrooms, 10) : 0;
  openSheet(`Союз: ${realm(p.id)}`, body => {
    body.append(note('Союзники не занимают землю друг друга, ходят по земле друг друга и возят грибы по дорогам друг друга. Если на союзника нападут, вы станете врагом нападавшего.'));
    if (p.bot) body.append(note(`Бот разорвёт союз, когда тому будет больше ${B.BOT_ALLY} ходов, его войско окажется больше вашего и сильнее его не будет никого вокруг. Против общего сильного врага бот идёт в союз охотнее.`));
    body.append(stepper(`Подарок, грибы, есть ${free().mushrooms}`, gift, free().mushrooms, n => { gift = n; renderSheet(); }));
    if (p.bot) body.append(scaleBar('Шанс согласия', B.leaned(B.allyChance(gift, relationTo(p.id) === 'war'), p.lean?.ally)));
    body.append(button('Предложить союз', () => offerGift(p, 'ally', gift), talkable()));
  });
}

function openPeace(p) {
  let gift = p.bot ? Math.min(free().mushrooms, 10) : 0;
  openSheet(`Мир: ${realm(p.id)}`, body => {
    body.append(note(`Если они согласятся, война закончится. ${TRUCE_TEXT}.`));
    body.append(stepper(`Подарок, грибы, есть ${free().mushrooms}`, gift, free().mushrooms, n => { gift = n; renderSheet(); }));
    if (p.bot) body.append(scaleBar('Шанс согласия', B.leaned(B.peaceChance(gift), p.lean?.peace)));
    body.append(button('Предложить мир', () => offerGift(p, 'peace', gift), talkable()));
  });
}

// Пропуск просит гость, а согласиться может только хозяин.
function openPass(p) {
  let gift = p.bot ? Math.min(free().mushrooms, 5) : 0;
  openSheet(`Пропуск: ${realm(p.id)}`, body => {
    body.append(note('Ваши отряды смогут входить на их землю. Пропуск действует, пока не начнётся война или они не закроют ворота.'));
    body.append(stepper(`Подарок, грибы, есть ${free().mushrooms}`, gift, free().mushrooms, n => { gift = n; renderSheet(); }));
    if (p.bot) body.append(scaleBar('Шанс согласия', B.passChance(gift)));
    body.append(button('Попросить пропуск', () => offerGift(p, 'pass', gift), talkable()));
  });
}

const RELATION = { peace: 'Мир', war: 'Война', ally: 'Союз' };

// Вместе с целью на войну встают её союзники: так начинается любая война.
function askWar(p) {
  ask('Посадить на кол?', [`Начнётся война: ${[p.id, ...friendsOf(p.id)].map(realm).join(', ')}`], 'Да, начать войну', () => {
    closeSheet();
    command({ type: 'war', other: p.id });
  });
}

function openDiplomacy() {
  openSheet('Дипломатия', body => {
    const pause = state.phase !== 'play' ? 'Партия окончена'
        : myTurn() ? '' : 'Вы уже закончили ход';
    if (pause) body.append(note(pause, 'warn'));
    if (state.legend) body.append(button('Легенда', openLegend));
    for (const p of state.players) {
      if (p.id === me || p.out) continue;
      const row = document.createElement('div');
      row.className = 'realmRow';
      const name = document.createElement('div');
      name.className = 'name';
      paint(name, realm(p.id));
      const about = document.createElement('div');
      about.className = 'note';
      const rel = relationTo(p.id), truce = warBar(p.id);
      const pass = (host, guest) => state.passes.some(x => x[0] === host && x[1] === guest);
      const ours = pass(p.id, me), theirs = pass(me, p.id);
      about.textContent = `${RELATION[rel]} · ${p.bot ? 'бот' : p.name} · грибы ${p.mushrooms}, гномы на балансе ${p.stock}${p.blight ? ' · хворь' : ''}${truce ? ` · перемирие, ходов ${truce}` : ''}${ours ? ' · у вас пропуск' : ''}${theirs ? ' · у них пропуск' : ''}`;
      const buttons = document.createElement('div');
      buttons.className = 'row';
      const leave = fn => () => { closeSheet(); fn(); };
      const open = talkable();
      const asked = kind => state.asked.some(a => a[0] === p.id && a[1] === kind);
      buttons.append(button(asked('trade') ? 'Сделка: уже предложена' : 'Сделка', () => openDeal(p), open && !asked('trade')));
      if (rel === 'ally') {
        buttons.append(button('Разорвать союз', leave(() => command({ type: 'break', other: p.id })), open));
      } else {
        buttons.append(button(asked('ally') ? 'Союз: уже предложен' : 'Союз', () => openAlly(p), open && !asked('ally')));
        if (rel === 'peace') buttons.append(button('Посадить на кол', () => askWar(p), open && !truce));
        else buttons.append(button(asked('peace') ? 'Мир: уже предложен' : 'Мир', () => openPeace(p), open && !asked('peace')));
      }
      const gates = document.createElement('div');
      gates.className = 'row';
      if (rel === 'peace') {
        gates.append(button(ours ? 'Пропуск есть' : asked('pass') ? 'Пропуск: уже предложен' : 'Пропуск', () => openPass(p), open && !ours && !asked('pass')));
      }
      gates.append(button('Отдать клетку', leave(() => startGive(p.id)), open));
      if (theirs) gates.append(button('Закрыть границу', leave(() => command({ type: 'shut', other: p.id })), open));
      row.append(name, about, buttons, gates);
      body.append(row);
    }
    // Пленные: свои можно выкупить, чужие останутся у вас, если их не выкупят.
    if (state.captives.length) body.append(stockHead('Пленные'));
    const home = state.towns.some(t => t[2] === me && t[1] === 'capital');
    for (const [id, owner, by, n, left] of state.captives) {
      const price = n * B.RANSOM_PRICE, line = note('', 'warLine');
      if (owner === me) {
        paint(line, `${realm(by)} держит в плену ваших гномов: ${n}. Выкуп ${price} гр., ${left === 1 ? 'это последний ход' : `ходов на выкуп: ${left}`}`);
        const label = !home ? 'Выкупить нельзя: нет столицы' : mine().mushrooms < price ? `Выкуп ${price} гр.: не хватает грибов` : `Выкупить за ${price} гр.`;
        body.append(line, button(label, () => { closeSheet(); command({ type: 'ransom', id }); }, talkable() && home && mine().mushrooms >= price));
      } else {
        paint(line, `${realm(owner)}: у вас в плену их гномов ${n}. Если не выкупят, станут вашими через ходов: ${left}`);
        body.append(line);
      }
    }
    // Внизу всем видно, кто с кем воюет.
    const wars = state.relations.filter(r => r[2] === 'war' && !state.players[r[0]].out && !state.players[r[1]].out);
    body.append(stockHead('Кто с кем воюет'));
    if (!wars.length) body.append(note('Сейчас никто не воюет.', 'stockText'));
    for (const [a, b] of wars) {
      const line = note('', 'warLine');
      paint(line, `${realm(a)} и ${realm(b)}`);
      body.append(line);
    }
  }, true);
}

$('stockBtn').onclick = openStock;
$('realmBtn').onclick = openPrince;
$('waitName').onclick = openPrince;
$('waitRealm').onclick = openPrince;
$('diploBtn').onclick = openDiplomacy;
$('roadBtn').onclick = () => setRoadMode(!roadMode);

// --- рисование и жесты ---

// Вид кладёт метки под рисунки, а поселение их закрывает. Поэтому метка на нём идёт поверх кадра.
const TOWN_MARKS = {
  attack: ['#e0504a', 'rgba(179,53,53,.38)'],
  move: ['rgba(233,206,79,.85)', 'rgba(233,206,79,.2)'],
  road: ['rgba(242,242,242,.75)', 'rgba(242,242,242,.14)'],
};

function drawTownMarks(list) {
  const tiles = list.filter(m => TOWN_MARKS[m.kind] && townOn(m.tile));
  if (!tiles.length) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(vw / 2, vh / 2);
  ctx.scale(cam.s, cam.s);
  ctx.translate(-cam.x, -cam.y);
  ctx.lineWidth = 3;
  for (const { tile, kind } of tiles) {
    [ctx.strokeStyle, ctx.fillStyle] = TOWN_MARKS[kind];
    view.hexPath(ctx, tile, 0.92);
    ctx.fill();
    ctx.stroke();
  }
}

function draw(now) {
  requestAnimationFrame(draw);
  if (!view || !state) return;
  // Телеги едут и без новых состояний. За окнами и чёрным экраном кадры не нужны.
  for (let i = processions.length - 1; i >= 0; i--) if (now > processions[i].until + 400) processions.splice(i, 1);
  if (!dirty && !walks.size && !processions.length && (sheet || covered() || !view.moving(now))) return;
  dirty = false;
  const ready = new Set(myTurn() && state.kind === 'march' ? state.units.filter(u => u.owner === me && u.mp > 0).map(u => u.id) : []);
  const list = [...targetMarks(), ...marks];
  const positions = walkers(now);
  const gone = [...walks].filter(([id]) => positions.has(id) && !state.units.some(u => u.id === id)).map(([, w]) => w.ghost);
  view.draw(ctx, dpr, cam, vw, vh, { time: now / 1000, units: [...state.units, ...gone], marks: list, ready, patches: state.patches, positions, fx: processions });
  drawTownMarks(list);
}
requestAnimationFrame(draw);

// Страница не масштабируется ни щипком, ни двойным нажатием: приближается только карта.
let lastTouch = 0;
document.addEventListener('touchend', e => {
  const now = Date.now();
  if (now - lastTouch < 350 && !e.target.closest('button, input')) e.preventDefault();
  lastTouch = now;
}, { passive: false });
document.addEventListener('touchmove', e => {
  if (e.touches.length > 1 && e.target !== canvas) e.preventDefault();
}, { passive: false });
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, e => e.preventDefault(), { passive: false });
}

// Один палец двигает карту, два приближают.
const pointers = new Map();
let gesture = null;

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  gesture = pointers.size === 1
    ? { sx: e.clientX, sy: e.clientY, moved: false, at: performance.now() }
    : { moved: true };
});

canvas.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const old = [...pointers.values()].map(q => ({ ...q }));
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 1) {
    if (Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) > 10) gesture.moved = true;
    if (gesture.moved) {
      cam.x -= (e.clientX - old[0].x) / cam.s;
      cam.y -= (e.clientY - old[0].y) / cam.s;
    }
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const before = Math.hypot(old[0].x - old[1].x, old[0].y - old[1].y);
    const after = Math.hypot(a.x - b.x, a.y - b.y);
    if (before > 0) cam.s *= after / before;
  }
  clampCamera();
  dirty = true;
});

function release(e) {
  const had = pointers.delete(e.pointerId);
  if (had && !pointers.size && gesture && !gesture.moved && performance.now() - gesture.at < 500) {
    const box = canvas.getBoundingClientRect();
    tap(e.clientX - box.left, e.clientY - box.top);
  }
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  cam.s *= e.deltaY < 0 ? 1.1 : 0.9;
  clampCamera();
  dirty = true;
}, { passive: false });

$('endBtn').onclick = () => {
  const free = state.units.filter(u => u.owner === me && u.mp > 0).length;
  const left = state.kind === 'march' ? `Отрядов, которые ещё могут идти в поход: ${free}` : 'Войска стоят до следующего хода';
  ask(`Завершить ход ${state.turn}?`, [left], 'Да, завершить', () => {
    setRoadMode(false);
    command({ type: 'end' });
  }, shareBlock);
};

function paintCrest() {
  const crest = $('crest');
  crest.width = 220; crest.height = 380;
  const g = crest.getContext('2d');
  g.clearRect(0, 0, 220, 380);
  g.scale(2, 2);
  banner(g, 44, 186, 1.3, factionId(faction));
}

function enterLobby() {
  paint($('waitRealm'), tagged(faction, factionOf(faction).name));
  paintCrest();
  show('waitPage');
}

function clearLocal() {
  selected = null; focus = -1; marks = []; reach = new Map(); roadMode = false; giveTo = null;
  $('roadBtn').classList.remove('on');
  closeAsk();
  closeSheet();
  $('offerBox').classList.add('hidden');
}

function dropGame() {
  map = null; view = null; state = null; framedTurn = -1; seenTurn = 0; held = [];
  legendHeard = false; framedMeet = null;
  clearLocal();
  $('toast').textContent = '';
  renderCover();
}

// Выход: в партии царство стоит без хозяина, под тем же именем можно вернуться.
async function leaveGame() {
  await post('leave', { token }).catch(() => {});
  source?.close();
  source = null;
  token = null;
  localStorage.removeItem('token');
  dropGame();
  $('nameInput').value = localStorage.getItem('name') || '';
  $('joinNote').textContent = 'Как вас зовут?';
  show('joinPage');
}

function askLeave() {
  const lines = state?.phase === 'play' ? ['Ваше царство останется на карте, но ход не будет вас ждать. Вернуться можно под тем же именем'] : [];
  ask('Выйти из игры?', lines, 'Да, выйти', leaveGame);
}

$('leaveBtn').onclick = askLeave;
$('waitLeave').onclick = askLeave;

// Сервер забыл телефон: в лобби он входит сам под прежним именем, а идущую партию не трогает.
function seatLost({ playing }) {
  source.close();
  source = null;
  token = null;
  localStorage.removeItem('token');
  dropGame();
  const name = localStorage.getItem('name');
  if (name && !playing) return join(name);
  $('nameInput').value = name || '';
  $('joinNote').textContent = 'Началась другая партия. Войдите снова';
  show('joinPage');
}

function connect() {
  if (source) source.close();
  source = listen(`/events?token=${encodeURIComponent(token)}`, {
    gone: seatLost,
    lobby(data) {
      const seat = data.humans.find(h => h.name === localStorage.getItem('name'));
      faction = seat?.faction ?? faction;
      if (!data.playing && !map) enterLobby();
      if (!data.playing && map) { dropGame(); enterLobby(); }
    },
    map(data) {
      map = data;
      setDarkSeat(data.dark);
      show('view', 'topBar', 'bottomBar');
      resize();
      view = new MapView(map, { groundRes: 1.6, spriteRes: 1.8, phone: true });
      cam.s = 0.5;
      clampCamera();
    },
    state: apply,
    batch(data) {
      apply(data.after);
      onEvents(data.events);
    },
    offers(list) {
      if (!state) return;
      state.offers = list;
      showOffer();
    },
  });
}

async function join(name) {
  const out = await post('join', { name, token });
  if (out.error) {
    $('joinNote').textContent = out.error;
    $('nameInput').value ||= localStorage.getItem('name') || '';
    token = null;
    localStorage.removeItem('token');
    show('joinPage');
    return;
  }
  token = out.token;
  faction = me = out.faction;
  localStorage.setItem('token', token);
  localStorage.setItem('name', out.name);
  enterLobby();
  connect();
}

$('joinBtn').onclick = () => join($('nameInput').value);
$('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') join(e.target.value); });

if (token) join('');
else {
  $('nameInput').value = localStorage.getItem('name') || '';
  show('joinPage');
}
