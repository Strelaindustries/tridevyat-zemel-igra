// Правила партии. Сервер вызывает команды, а экран проигрывает накопленные события.
import { LAND_NEXT, MAX_SOLDIERS, MOVES, TERRAIN, barred, dist, factionOf, isWater, neighbors, pathTo, reachable, setDarkSeat, setHordeSeat } from '../public/js/hex.js';
import * as B from '../public/js/balance.js';
import { generateMap, rng32 } from './mapgen.js';
import { discordLine, disputeLine, epilogueLines, hordeLine, hordeRaidLine } from '../public/js/lines.js';

const emit = (s, type, data) => s.log.push({ type, ...data });
const tell = (s, pid, type, data) => s.log.push({ type, ...data, only: pid });
const pairKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export const relation = (s, a, b) => s.rel.get(pairKey(a, b)) || 'peace';
export const allied = (s, a, b) => relation(s, a, b) === 'ally';
export const atWar = (s, a, b) => relation(s, a, b) === 'war';
export const friendsOf = (s, pid) => s.players.filter(p => p.id !== pid && allied(s, pid, p.id)).map(p => p.id);
export const underTruce = (s, a, b) => s.turn < (s.truce.get(pairKey(a, b)) ?? 0);
const truceLeft = (s, a, b) => Math.max(0, (s.truce.get(pairKey(a, b)) ?? 0) - s.turn);
export const allyAge = (s, a, b) => s.turn - (s.allySince.get(pairKey(a, b)) ?? s.turn);

export const foesOf = (s, pid) => s.players.filter(p => p.id !== pid && atWar(s, pid, p.id)).map(p => p.id);

// Почему с этим царством пока нельзя драться.
const notAtWar = (s, a, b) => (allied(s, a, b) ? 'Сначала разорвите союз' : 'Сначала посадите на кол');

// Земля открыта для всех: в мирное войска просто стоят рядом. В чужое поселение входа нет никому:
// его обходят, а на войне разрушают приказом с соседней клетки (cmdStorm). Ничейный острог занимают входом.

// Пропуск: хозяин открыл гостю границу. Действует до войны или пока хозяин её не закроет.
const passKey = (host, guest) => `${host}>${guest}`;
const hasPass = (s, host, guest) => s.passes.has(passKey(host, guest));
const opens = (s, owner, pid) => owner === pid || allied(s, owner, pid) || hasPass(s, owner, pid);

// Чужая земля закрыта: войти можно на войне, в союзе или с пропуском. Кто уже стоит на ней, может выйти.
export const shutOf = (s, pid) => new Set(s.map.tiles.filter(t => t.terr != null && !s.players[t.terr].out && !atWar(s, pid, t.terr) && !opens(s, t.terr, pid)).map(t => t.id));

export const reachOf = (s, u) => reachable(s.map, s.units, u, foesOf(s, u.owner), false, shutOf(s, u.owner));
const hasEffect = (u, key) => u.effects.some(e => e.key === key);

// Очки хода отряда: обычные, знамение года и чары. Корни не оставляют меньше одного очка.
function fullMoves(s, u) {
  const moves = u.effects.reduce((sum, e) => sum + (B.EFFECT_MOVES[e.key] || 0), MOVES + s.mods.move);
  return hasEffect(u, 'roots') ? Math.max(1, moves) : moves;
}

const tollRow = id => ({ id, battle: 0, storm: 0, fire: 0, hunger: 0, blight: 0, road: 0, plague: 0, curse: 0, total: 0 });

// Погибшие за ход по причинам. Счёт закрывается, когда начался следующий ход или партия кончилась.
function lose(s, pid, cause, n) {
  if (pid == null || n <= 0) return;
  s.toll[pid][cause] += n;
  s.toll[pid].total += n;
}

// Болезнь пришла с новым ходом и идёт в его счёт. Партия кончилась сразу: другого счёта не будет.
function countSick(s) {
  for (const [pid, n] of s.sick) lose(s, pid, 'plague', n);
  s.sick = [];
}

function closeToll(s) {
  s.fallen = s.toll;
  s.toll = s.players.map(p => tollRow(p.id));
}

function addUnit(s, owner, tile, n = MAX_SOLDIERS, mp = MOVES) {
  const p = s.players[owner];
  p.squads = (p.squads || 0) + 1;
  const unit = { id: s.nextUnit++, owner, tile, n, mp, effects: [], name: `Отряд ${p.squads}` };
  s.units.push(unit);
  return unit;
}

// legend: легенда партии из makeLegend. Её знамение меняет обычные правила на всю партию.
export function newGame(seats, seed = Math.floor(Math.random() * 1e9), { legend = null } = {}) {
  const map = generateMap(seats.length, seed);
  const rand = rng32(seed ^ 0x5bd1e995);
  const mods = { ...B.MODS, ...legend?.mods };
  // Тёмное царство: первый бот партии.
  const darkAt = seats.findIndex(p => p.bot), dark = darkAt < 0 ? null : darkAt;
  setDarkSeat(dark);
  setHordeSeat(null);
  map.dark = dark;
  // Цену дороги и реки знает и клиент: она уходит вместе с картой.
  map.roadStep = mods.roadStep;
  const s = {
    phase: 'play', map, turn: 1, winner: null, nextUnit: 1, nextOffer: 1, nextMeet: 1, nextCaptive: 1, captives: [], log: [], rand, orders: [], fires: [],
    weather: 'sun', pastWeather: 'sun', nextWeather: B.rollWeather(rand()),
    legend, mods, encounters: [], asked: new Set(), passes: new Set(), watered: false,
    toll: seats.map((_, i) => tollRow(i)), fallen: seats.map((_, i) => tollRow(i)),
    players: seats.map((p, i) => ({
      id: i, name: p.name, realm: factionOf(i).name, bot: !!p.bot, out: false, left: false, done: false, capital: map.capitals[i],
      mushrooms: B.START.mushrooms + mods.mushrooms,
      known: new Set(), seen: new Set(), hints: 0, fellOn: null, raids: 0, darks: 0, burns: 0, homeLeft: B.CAPITAL_STOCK, birthShare: B.BIRTH_SHARE,
      tally: { picked: 0, killed: 0, lost: 0, taken: 0, burned: 0, roads: 0, built: 0, deals: 0 }, grudges: {},
    })),
    units: [], rel: new Map(), truce: new Map(), allySince: new Map(), trade: new Set(), embassies: new Set(), offers: [], plagued: 0, sick: [], heroes: new Set(), history: [],
    landDirty: false, stats: { rot: 0, turned: 0, ruins: 0, faded: 0, starved: 0, killed: 0, sieges: 0 }, dark,
  };
  s.nextDispute = B.DISPUTE_FIRST[0] + Math.floor(s.rand() * (B.DISPUTE_FIRST[1] - B.DISPUTE_FIRST[0] + 1));
  s.hordeTurn = B.TUGARIN_TURN[0] + Math.floor(s.rand() * (B.TUGARIN_TURN[1] - B.TUGARIN_TURN[0] + 1));
  s.horde = null;
  for (const p of s.players) if (p.bot) p.nature = natureFor(s, p.id);
  map.capitals.forEach((id, owner) => {
    map.tiles[id].town = { type: 'capital', owner, gnomes: B.START.gnomes, empty: 0 };
    for (const t of map.tiles) {
      if (isWater(map, t.id) || TERRAIN[t.t].cost == null || dist(map, t.id, id) > B.HOME_RADIUS) continue;
      t.terr = owner;
    }
    s.players[owner].seen.add(id);
    map.camps[owner].forEach(tile => {
      addUnit(s, owner, tile);
      s.players[owner].seen.add(tile);
    });
    // Своя грибница рядом: лагерь на ней стоит с начала партии, а если она не вплотную, дорога ведёт к ней от столицы.
    const home = map.homePatches?.[owner];
    if (home == null) return;
    map.tiles[home].patch.camp = { owner };
    s.players[owner].known.add(home);
    s.players[owner].seen.add(home);
    if (neighbors(map, id).includes(home)) return;
    const link = neighbors(map, id).find(n => neighbors(map, n).includes(home) && !isWater(map, n)
      && TERRAIN[map.tiles[n].t].cost != null && !map.tiles[n].town);
    if (link == null) return;
    map.tiles[link].road = true;
    s.players[owner].seen.add(link);
  });
  emit(s, 'turn', { turn: s.turn });
  for (const p of s.players) beginTurn(s, p.id);
  record(s);
  return s;
}

// Посольства: царства обменялись послами. Без них торгового пути нет, война их закрывает.
export const hasEmbassy = (s, a, b) => !!s.embassies?.has(pairKey(a, b));

// Торговый путь: от столицы одного царства до столицы другого по дорогам и поселениям земли этих двух царств.
// Царства не воюют, оба живы и обменялись посольствами. Ключ пути — пара номеров через двоеточие, меньший первым.
export function tradeRoutes(s) {
  const g = s.map, out = new Set();
  const alive = s.players.filter(p => !p.out && !p.horde && p.capital != null);
  for (const a of alive) {
    for (const b of alive) {
      if (b.id <= a.id || atWar(s, a.id, b.id) || !hasEmbassy(s, a.id, b.id)) continue;
      const pass = t => (t.road || t.town?.owner === a.id || t.town?.owner === b.id) && (t.terr === a.id || t.terr === b.id);
      const seen = new Set([a.capital]), queue = [a.capital];
      for (let i = 0; i < queue.length && !seen.has(b.capital); i++) {
        for (const n of neighbors(g, queue[i])) {
          if (seen.has(n) || !pass(g.tiles[n])) continue;
          seen.add(n);
          queue.push(n);
        }
      }
      if (seen.has(b.capital)) out.add(pairKey(a.id, b.id));
    }
  }
  return out;
}

export const tradePartners = (s, pid) => [...(s.trade || [])].map(k => k.split(':').map(Number)).filter(pair => pair.includes(pid)).map(([a, b]) => (a === pid ? b : a));

// Новый круг: пути открываются и рвутся, дед об этом говорит.
function updateTrade(s) {
  const now = tradeRoutes(s), was = s.trade || new Set();
  for (const k of now) {
    if (was.has(k)) continue;
    const [a, b] = k.split(':').map(Number);
    emit(s, 'tradeOpen', { a, b });
  }
  for (const k of was) {
    if (now.has(k)) continue;
    const [a, b] = k.split(':').map(Number);
    if (s.players[a].out || s.players[b].out) continue;
    emit(s, 'tradeCut', { a, b, ...(atWar(s, a, b) ? { war: true } : {}) });
  }
  s.trade = now;
}

// Нрав бота выпадает случайно, Тёмное царство всегда воевода.
const NATURE_KEYS = Object.keys(B.NATURES);
const natureFor = (s, pid) => (pid === s.dark ? 'warlord' : NATURE_KEYS[Math.floor(s.rand() * NATURE_KEYS.length)]);

// Обида свежая: обидчик напал на царство или разорвал с ним союз не больше GRUDGE_TURNS ходов назад.
export const grudge = (s, pid, other) => s.turn - (s.players[pid].grudges?.[other] ?? -Infinity) <= B.GRUDGE_TURNS;
const offend = (s, victim, by) => { (s.players[victim].grudges ||= {})[by] = s.turn; };

const towns = s => s.map.tiles.filter(t => t.town);
const townsOf = (s, pid) => towns(s).filter(t => t.town.owner === pid);
const campsOf = (s, pid) => s.map.tiles.filter(t => t.patch?.camp?.owner === pid);
const allPatches = s => s.map.tiles.filter(t => t.patch);
const capitalOf = (s, pid) => s.map.tiles[s.players[pid].capital]?.town;
const armyOf = (s, pid) => s.units.filter(u => u.owner === pid).reduce((sum, u) => sum + u.n, 0);

export const gnomesOf = (s, pid) =>
  townsOf(s, pid).reduce((sum, t) => sum + t.town.gnomes, 0)
  + armyOf(s, pid);

// Где живут гномы царства. Баланс на пульте — это гномы столицы.
function census(s, pid) {
  const cap = capitalOf(s, pid);
  const inTowns = townsOf(s, pid).reduce((sum, t) => sum + t.town.gnomes, 0);
  return {
    capital: cap?.gnomes || 0,
    ostrogs: inTowns - (cap?.gnomes || 0),
    squads: armyOf(s, pid),
  };
}

// Павшее царство земли не держит.
const noMan = (s, t) => t.terr == null || s.players[t.terr].out;

// Дорога идёт только по своей земле.
export const roadLand = (s, pid, t) => t.terr === pid;

// Земля мирного соседа: дороги сюда нет, поэтому лагерь здесь не подключится без союза.
export const peerLand = (s, pid, t) => !noMan(s, t) && t.terr !== pid && relation(s, t.terr, pid) === 'peace';

// Сеть снабжения: столица, дорожные клетки, а также острога и лагеря, куда они подходят. Союзная земля её не прерывает.
// Вышла к воде: лодочки гномов везут груз по ней к любому своему берегу. Сама вода в сеть дорог не входит.
function supplyNet(s, pid) {
  const cap = s.players[pid].capital;
  if (cap == null) return { net: new Set(), water: new Set() };
  const g = s.map, net = new Set([cap]), water = new Set(), queue = [cap];
  const held = t => t.terr === pid || (t.terr != null && allied(s, t.terr, pid));
  const carries = t => held(t) && (t.road || t.town || t.patch?.camp);
  for (let i = 0; i < queue.length; i++) {
    for (const b of neighbors(g, queue[i])) {
      if (net.has(b) || water.has(b)) continue;
      if (isWater(g, b)) { water.add(b); queue.push(b); }
      else if (carries(g.tiles[b])) { net.add(b); queue.push(b); }
    }
  }
  return { net, water };
}

export const roadNet = (s, pid) => supplyNet(s, pid).net;

// Лагеря, откуда грибы доходят до столицы: без дороги или лодочки лагерь работает впустую.
function pickingCamps(s, pid) {
  const net = roadNet(s, pid);
  return campsOf(s, pid).filter(t => net.has(t.id));
}

// Сбор этого хода вырос при прошлой погоде: грибы дают только лагеря, к которым есть дорога или лодочка.
const cropRate = s => B.WEATHER[s.pastWeather].harvest * s.mods.harvest;

// Остроги, откуда грибы доходят до столицы.
function payingOstrogs(s, pid) {
  const net = roadNet(s, pid);
  return townsOf(s, pid).filter(t => t.town.type === 'ostrog' && t.town.gnomes > 0 && net.has(t.id));
}

// Хворь: живой грибницы у царства нет, своя в столице иссякла, а лагерей с дорогой не осталось. Острогам тоже неоткуда брать грибы.
const barren = (s, pid) => s.players[pid].homeLeft <= 0 && !pickingCamps(s, pid).length;

export function harvestOf(s, pid) {
  const p = s.players[pid];
  if (p.capital == null || barren(s, pid)) return 0;
  const home = p.homeLeft > 0 ? B.CAPITAL_MUSHROOMS : 0;
  const camps = pickingCamps(s, pid).length * B.campYield(s.mods.camp);
  const dark = pid === s.dark ? B.DARK_HARVEST : 1;
  return Math.floor((home + camps + payingOstrogs(s, pid).length * B.OSTROG_YIELD) * cropRate(s) * dark);
}

// План кормления из запаса: сначала острога, затем отряды. Кто живёт в столице, еды не тратит. Лагерь снабжать не надо: он не ест и не голодает.
// Грибы идут только по дороге: поселение без неё теряет жителя в ход, сколько бы грибов ни было в столице.
// После еды столица растёт на выбранную игроком долю того, что осталось от сбора этого хода: один гриб даёт одного нового гнома.
// На царство без живых грибниц падает хворь: голод бьёт сильнее, а столица тоже ест из запаса. Кому грибов хватило, тот от хвори не умирает.
// Ход выполняет этот план, а пульт по нему показывает прогноз. Убыль в плане: [кто, сколько, причина, клетка].
const stored = (s, p) => Math.ceil(p.mushrooms * (1 - (B.WEATHER[s.pastWeather].spoil || 0)));

function planFeed(s, pid, stock) {
  const net = roadNet(s, pid), dying = barren(s, pid), storm = dying || !!B.WEATHER[s.pastWeather].spoil, cause = dying ? 'blight' : 'hunger';
  // Торговые пути сберегают еду: часть всей нужды кормится без запаса.
  const home = capitalOf(s, pid);
  const cut = Math.min(B.TRADE_MAX, tradePartners(s, pid).length * B.TRADE_CUT);
  const need = townsOf(s, pid).filter(t => t.town.gnomes && t.town.type !== 'capital' && net.has(t.id)).reduce((sum, t) => sum + B.eatNeed(t.town.gnomes), 0)
    + s.units.filter(x => x.owner === pid).reduce((sum, u) => sum + B.squadNeed(u.n), 0) + (dying && home?.gnomes ? B.eatNeed(home.gnomes) : 0);
  let eaten = 0, free = Math.floor(need * cut), saved = 0;
  const eat = want => {
    const use = Math.min(free, want);
    if (stock < want - use) return false;
    free -= use;
    saved += use;
    stock -= want - use;
    eaten += want - use;
    return true;
  };
  const changes = [];
  for (const t of townsOf(s, pid)) {
    const town = t.town;
    if (!town.gnomes || town.type === 'capital') continue;
    if (!net.has(t.id)) changes.push([town, -Math.min(town.gnomes, B.CUT_OFF), 'road', t.id]);
    else if (!eat(B.eatNeed(town.gnomes))) changes.push([town, -Math.min(town.gnomes, B.hunger(town.gnomes, storm)), cause, t.id]);
  }
  for (const u of s.units.filter(x => x.owner === pid)) if (!eat(B.squadNeed(u.n))) changes.push([u, -Math.min(u.n, B.hunger(u.n, storm)), cause, u.tile]);
  // Гномы рождаются только в столице, на выбранную долю сбора этого хода, не ушедшего на еду: гриб за гнома.
  // В хворь столица кормится из запаса после острогов и отрядов: сколько грибов осталось, столько гномов и сыты.
  // Голодная часть вымирает волной.
  if (dying && home?.gnomes) {
    const fed = Math.min(home.gnomes, (stock + free) * B.EAT_PER), hungry = home.gnomes - fed;
    eat(B.eatNeed(fed));
    if (hungry > 0) changes.push([home, -Math.min(hungry, B.hunger(hungry, true)), cause, s.players[pid].capital]);
  }
  const add = home?.gnomes ? Math.min(stock, Math.floor(Math.max(0, harvestOf(s, pid) - eaten) * s.players[pid].birthShare) * s.mods.growth) : 0;
  if (add > 0) {
    changes.push([home, add]);
    stock -= add;
  }
  return { stock, eaten, saved, changes };
}

const bornOf = changes => changes.reduce((sum, [, delta]) => sum + Math.max(0, delta), 0);

// Следующий ход идёт при нынешней погоде: и его запас, и его сбор считаются по ней.
const nextTurn = s => ({ ...s, pastWeather: s.weather });

// Сбор следующего хода минус вся еда. Минус значит, что царство проедает запас.
export function foodSpare(s, pid) {
  const next = nextTurn(s);
  return harvestOf(next, pid) - planFeed(next, pid, Infinity).eaten;
}

function feed(s, pid) {
  const p = s.players[pid], plan = planFeed(s, pid, p.mushrooms);
  p.mushrooms = plan.stock;
  for (const [holder, delta, cause] of plan.changes) {
    if ('n' in holder) holder.n += delta;
    else holder.gnomes += delta;
    if (delta >= 0) continue;
    s.stats.starved -= delta;
    lose(s, pid, cause, -delta);
  }
  s.units = s.units.filter(u => u.n > 0);
  return plan;
}

// Черновик партии: на нём ход считается по настоящим правилам, а сама партия не меняется.
function draft(s) {
  return {
    ...s, log: [], stats: { ...s.stats }, toll: s.toll.map(row => ({ ...row })),
    players: s.players.map(p => ({ ...p, known: new Set(p.known), tally: { ...p.tally } })),
    units: s.units.map(u => ({ ...u, effects: u.effects.map(e => ({ ...e })) })),
    map: {
      ...s.map,
      tiles: s.map.tiles.map(t => ({
        ...t, town: t.town && { ...t.town },
        patch: t.patch && { ...t.patch, camp: t.patch.camp && { ...t.patch.camp } },
      })),
    },
  };
}

// Как пульт называет того, кто убудет: у отряда своё имя, а поселения безымянны.
const placeName = holder => holder.name ?? { capital: 'Столица', ostrog: 'Острог' }[holder.type];

// Что будет в следующем ходу, если ничего не менять: всё, что случится без броска кубика.
function forecast(s, pid) {
  const next = draft(s), p = next.players[pid];
  const { mushrooms } = p, capital = capitalOf(next, pid)?.gnomes || 0;
  next.turn++;
  collapseTowns(next);
  countDown(next);
  const flooded = mushrooms - stored(next, p);
  const { crop, plan } = upkeep(next, pid);
  const lost = plan.changes.filter(([, delta]) => delta < 0);
  const cost = cause => lost.filter(row => row[2] === cause).reduce((sum, [, delta]) => sum - delta, 0);
  return {
    crop, trade: plan.saved, eaten: plan.eaten, flooded,
    mushrooms: p.mushrooms - mushrooms,
    capital: (capitalOf(next, pid)?.gnomes || 0) - capital,
    born: bornOf(plan.changes),
    // В счёте хода и те, кому некуда уйти из исчезнувшего лагеря.
    starved: next.toll[pid].hunger + next.toll[pid].blight - s.toll[pid].hunger - s.toll[pid].blight, cutOff: cost('road'),
    // Где и почему: план уже выполнен на черновике, поэтому численность до убыли считаем обратно.
    losses: [
      ...lost.map(([holder, delta, cause, tile]) => ({ where: placeName(holder), have: (holder.n ?? holder.gnomes) - delta, lost: -delta, cause, tile })),
    ],
  };
}

// Снимок хода для графиков в итогах. Конец партии заменяет снимок своего хода.
function record(s) {
  if (s.history.at(-1)?.turn === s.turn) s.history.pop();
  s.history.push(snapshot(s));
}

function snapshot(s) {
  return {
    turn: s.turn,
    players: s.players.map(p => ({
      land: s.map.tiles.filter(t => t.terr === p.id).length,
      gnomes: gnomesOf(s, p.id),
      army: armyOf(s, p.id),
      towns: townsOf(s, p.id).length,
      mushrooms: p.mushrooms,
    })),
  };
}

// Собранная грибница отравляет всё царство: страдает случайная клетка его земли.
function rot(s, pid) {
  const land = s.map.tiles.filter(t => t.terr === pid && !t.patch && !t.town);
  if (!land.length) return;
  const t = land[Math.floor(s.rand() * land.length)];
  t.rot++;
  s.stats.rot++;
  s.landDirty = true;
  if (t.rot % B.ROT_STEP !== 0 || !LAND_NEXT[t.t]) return;
  t.t = LAND_NEXT[t.t];
  s.stats.turned++;
}

// Начатая грибница травит царство и без лагеря, пока её не уничтожат.
function spoilLand(s, pid) {
  const spread = Math.max(1, B.ROT_PER_PATCH + s.mods.rot);
  for (const t of allPatches(s)) {
    if (t.patch.rotBy !== pid) continue;
    for (let i = 0; i < spread; i++) rot(s, pid);
  }
}

// Поселения больше нет: на клетке руины, дорога остаётся, а столица переезжает. Земля пока за прежним хозяином.
function ruinTown(s, t) {
  const { owner } = t.town;
  t.town = null;
  t.t = 'ruins';
  t.rot = Math.max(t.rot, 4);
  s.landDirty = true;
  s.stats.ruins++;
  if (owner != null && s.players[owner].capital === t.id) moveCapitalAway(s, owner);
}

function collapseTowns(s) {
  for (const t of towns(s)) {
    const town = t.town;
    town.empty = town.gnomes > 0 ? 0 : town.empty + 1;
    if (town.empty < B.EMPTY_TURNS) continue;
    emit(s, 'ruin', { tile: t.id });
    ruinTown(s, t);
  }
}

// Начало хода царства без случайностей: и настоящий ход, и прогноз идут через эту функцию.
function upkeep(s, pid) {
  const p = s.players[pid], march = B.turnKind(s.turn) === 'march';
  for (const u of s.units) {
    if (u.owner !== pid) continue;
    // Дары и порчи считают походы: в дипломатию войска стоят.
    if (march) {
      for (const e of u.effects) {
        e.turns--;
        wound(s, u, B.EFFECT_WASTE[e.key] || 0);
      }
      u.effects = u.effects.filter(e => e.turns > 0);
    }
    u.mp = fullMoves(s, u);
    delete u.fresh;
  }
  s.units = s.units.filter(u => u.n > 0);
  // Войско Тугарина не ест и грибов не собирает.
  if (p.horde) return { crop: 0, plan: { stock: 0, eaten: 0, saved: 0, changes: [] } };
  const crop = harvestOf(s, pid);
  for (const t of pickingCamps(s, pid)) t.patch.rotBy = pid;
  p.mushrooms = stored(s, p) + crop;
  p.tally.picked += crop;
  const plan = feed(s, pid);
  p.homeLeft = Math.max(0, p.homeLeft - B.CAPITAL_MUSHROOMS);
  return { crop, plan };
}

// Падение и победа проверяются после того, как поели все: иначе при общей гибели выживал бы тот, кто дальше по списку.
function beginTurn(s, pid) {
  upkeep(s, pid);
  spoilLand(s, pid);
  emitLand(s);
}

function emitLand(s) {
  if (!s.landDirty) return;
  s.landDirty = false;
  emit(s, 'land', {});
}

// Счётчики нового круга: приходит объявленная погода, иссякшие грибницы исчезают.
function countDown(s) {
  s.pastWeather = s.weather;
  s.weather = s.nextWeather;
  for (const t of allPatches(s)) {
    if (t.patch.dying > 0 && --t.patch.dying === 0) removePatch(s, t);
  }
}

// На карте не осталось ни одной живой грибницы: иссякшая доживает последний ход и уже не считается.
const bareLand = s => !allPatches(s).some(t => !t.patch.dying);

// Новый круг: запас грибниц тает. Болезнь приходит только на голую карту, тумана больше нет. Погоду следующего хода знают заранее: по ней считается прогноз сбора.
function beginRound(s) {
  const had = new Set(s.units);
  countDown(s);
  dropLooseLand(s);
  updateTrade(s);
  for (const u of s.units) if (!had.has(u)) touchHeroes(s, u, u.tile);
  for (const p of s.players.filter(x => !x.out && !x.horde)) {
    drainCamps(s, p.id);
    noteBlight(s, p.id);
  }
  s.nextWeather = B.rollWeather(s.rand());
  const sick = B.WEATHER[s.pastWeather].sick;
  if (s.rand() < (bareLand(s) ? Math.max(sick, B.BARE_SICK) : sick)) plague(s);
  if (s.turn >= (s.nextDispute ?? Infinity)) {
    openDispute(s);
    s.nextDispute = s.turn + B.DISPUTE_GAP[0] + Math.floor(s.rand() * (B.DISPUTE_GAP[1] - B.DISPUTE_GAP[0] + 1));
  }
  sowDiscord(s);
  hordeTurn(s);
}

// --- нашествие Тугарина ---
function hordeTurn(s) {
  if (s.phase !== 'play') return;
  if (s.horde) return hordeMarch(s);
  if (s.turn >= (s.hordeTurn ?? Infinity)) hordeArrive(s);
}

// Орда приходит с дальнего края земли: на свободную клетку суши, куда пешком дальше всего от любой столицы.
function hordeArrive(s) {
  const g = s.map, alive = s.players.filter(p => !p.out && !p.horde && p.capital != null);
  if (!alive.length) return;
  const busy = new Set(s.units.map(u => u.tile));
  const steps = alive.map(p => stepsFrom(s, p.capital));
  const spots = g.tiles.filter(t => !isWater(g, t.id) && TERRAIN[t.t].cost != null && !t.town && !t.patch && !t.hero && !busy.has(t.id)
    && t.r >= 3 && t.r < g.H - 3).map(t => ({ t, near: Math.min(...steps.map(d => d[t.id])) })).filter(x => x.near < Infinity);
  if (!spots.length) return;
  spots.sort((a, b) => b.near - a.near);
  const spot = spots[Math.floor(s.rand() * Math.min(5, spots.length))].t;
  spot.hero = 'tugarin';
  s.heroes.add(spot.id);
  const power = B.TUGARIN_BASE + B.TUGARIN_PER * alive.length;
  s.horde = { tile: spot.id, power, start: power, came: s.turn };
  raiseHorde(s, spot.id, B.hordeSquads(alive.length));
  emit(s, 'hordeCame', { tile: spot.id, power });
}

// Войско Тугарина: отдельная сторона на следующем после царств месте, со всеми в войне.
// Сотни по 10 воинов встают на ближайшие к Тугарину свободные клетки и ходят со следующего хода.
function raiseHorde(s, tile, count) {
  const g = s.map, pid = s.players.length;
  s.players.push({
    id: pid, name: 'Тугарин Змеевич', realm: '', bot: true, horde: true, out: false, left: false, done: false, capital: null,
    mushrooms: 0, known: new Set(), seen: new Set(), hints: 0, fellOn: null, raids: 0, darks: 0, burns: 0, homeLeft: 0, birthShare: 0,
    tally: { picked: 0, killed: 0, lost: 0, taken: 0, burned: 0, roads: 0, built: 0, deals: 0 },
  });
  s.hordeSeat = pid;
  setHordeSeat(pid);
  s.players[pid].realm = factionOf(pid).name;
  s.toll.push(tollRow(pid));
  s.fallen.push(tollRow(pid));
  for (const p of s.players) if (p.id !== pid) s.rel.set(pairKey(p.id, pid), 'war');
  const busy = new Set(s.units.map(u => u.tile)), d = stepsFrom(s, tile);
  const spots = g.tiles.filter(t => t.id !== tile && d[t.id] < Infinity && !t.town && !t.hero && !busy.has(t.id))
    .sort((a, b) => d[a.id] - d[b.id] || a.id - b.id).slice(0, count);
  spots.forEach((t, i) => {
    const u = addUnit(s, pid, t.id, MAX_SOLDIERS, 0);
    u.name = `Сотня ${i + 1}`;
  });
}

// Ход орды: до TUGARIN_STEP клеток к ближайшему живому поселению, в поселения и на чужие отряды она не ступает.
// Подошла вплотную — разоряет его. Потом каждое царство, чей отряд стоит рядом, встречает орду.
function hordeMarch(s) {
  const h = s.horde, g = s.map;
  if (!h || h.fallen != null) return;
  // Путь обходит поселения, отряды и других существ. До ближайшего не пройти — орда идёт к следующему по близости.
  const busy = new Set(s.units.map(u => u.tile));
  const open = id => !g.tiles[id].town && !busy.has(id) && (!g.tiles[id].hero || id === h.tile);
  const from = stepsFrom(s, h.tile);
  const towns = g.tiles.filter(t => t.town?.owner != null && t.town.gnomes > 0 && !s.players[t.town.owner].out && from[t.id] < Infinity)
    .sort((a, b) => from[a.id] - from[b.id]);
  let aim = null, toAim = null;
  for (const t of towns) {
    const d = stepsFrom(s, t.id, open);
    if (d[h.tile] < Infinity) { aim = t; toAim = d; break; }
  }
  h.news = [];
  // Пока войско цело, Тугарин держится позади него и сам не разоряет. Войско разбито — идёт до поселения сам.
  const army = s.units.some(u => u.owner === s.hordeSeat), stop = army ? B.TUGARIN_BEHIND : 1;
  if (aim) {
    let at = h.tile;
    for (let k = 0; k < B.TUGARIN_STEP && toAim[at] > stop; k++) {
      const next = neighbors(g, at).find(n => toAim[n] === toAim[at] - 1 && open(n));
      if (next == null) break;
      at = next;
    }
    if (at !== h.tile) {
      const lair = g.tiles[h.tile];
      lair.hero = null;
      s.heroes.delete(h.tile);
      g.tiles[at].hero = 'tugarin';
      s.heroes.add(at);
      emit(s, 'hordeMove', { from: h.tile, to: at });
      h.tile = at;
    }
    if (!army && toAim[h.tile] <= 1) {
      const town = aim.town, capital = town.type === 'capital';
      const lost = capital ? Math.max(1, Math.ceil(town.gnomes * B.TUGARIN_CAPITAL)) : B.fireLoss(town.gnomes);
      town.gnomes -= lost;
      s.stats.killed += lost;
      s.players[town.owner].tally.lost += lost;
      lose(s, town.owner, 'fire', lost);
      h.news.push({ owner: town.owner, capital, lost });
      emit(s, 'hordeRaid', { tile: aim.id, owner: town.owner, capital, lost });
    }
  }
  h.newsTurn = s.turn;
  // Кто стоит рядом с ордой, встречает её: бой или беда. От царства выходит самый большой отряд.
  const near = s.units.filter(u => dist(g, u.tile, h.tile) <= 1);
  for (const p of s.players.filter(x => !x.horde)) {
    const u = top(near.filter(x => x.owner === p.id), x => x.n);
    if (u) meetHero(s, 'tugarin', p.id, u, h.tile);
  }
}

// Бой с ордой: шанс по силе орды. Победа кончает партию, поражение ослабляет орду.
function fightHorde(s, meet) {
  const side = meetSide(s, meet), n = Math.min(MAX_SOLDIERS, side.n ?? side.gnomes), won = s.rand() < meetChance(s, meet);
  const lost = Math.min(side.n ?? side.gnomes, (won ? B.fightWinLoss : B.fightLoseLoss)(n));
  if ('n' in side) wound(s, side, lost);
  else {
    side.gnomes -= lost;
    lose(s, meet.pid, 'curse', lost);
  }
  s.units = s.units.filter(x => x.n > 0);
  s.encounters = s.encounters.filter(e => e !== meet);
  const h = s.horde;
  if (!won) h.power = Math.max(B.TUGARIN_FLOOR, h.power - n * B.TUGARIN_WEAR);
  const fate = B.HEROES.tugarin[won ? 'gift' : 'curse'];
  emit(s, 'encounter', { hero: 'tugarin', tile: meet.tile, owner: meet.pid, text: fate.name, won, lost, unit: meet.unit, power: h.power });
  if (!won) return dropDefeated(s);
  const t = s.map.tiles[h.tile];
  t.hero = null;
  s.heroes.delete(h.tile);
  h.fallen = s.turn;
  h.by = meet.pid;
  emit(s, 'hordeFell', { tile: h.tile, owner: meet.pid });
  finish(s, meet.pid, 'horde');
}

// Шаги пешком от клетки: вода и горы не пускают.
// pass: куда ещё можно ступить (по умолчанию на любую сушу без гор).
function stepsFrom(s, start, pass = () => true) {
  const g = s.map, d = new Array(g.tiles.length).fill(Infinity), queue = [start];
  d[start] = 0;
  for (let i = 0; i < queue.length; i++) {
    for (const n of neighbors(g, queue[i])) {
      if (d[n] !== Infinity || isWater(g, n) || TERRAIN[g.tiles[n].t].cost == null || !pass(n)) continue;
      d[n] = d[queue[i]] + 1;
      queue.push(n);
    }
  }
  return d;
}

// Спорная грибница: на ничьей земле, пешком почти поровну от двух столиц и как можно ближе к обеим.
// Пара, у которой спорная грибница уже была, выбирается, только если другой нет. Запас обычный, знают её все.
function openDispute(s) {
  const g = s.map, alive = s.players.filter(p => !p.out && p.capital != null), used = s.disputes || [];
  const steps = new Map(alive.map(p => [p.id, stepsFrom(s, p.capital)]));
  const spots = g.tiles.filter(t => !isWater(g, t.id) && TERRAIN[t.t].cost != null && !t.town && !t.patch && !t.hero && !t.road
    && noMan(s, t) && t.r >= 3 && t.r < g.H - 3 && !s.units.some(u => u.tile === t.id)
    && !allPatches(s).some(x => dist(g, x.id, t.id) < 3));
  let best = null;
  alive.forEach((pa, i) => {
    for (const pb of alive.slice(i + 1)) {
      const da = steps.get(pa.id), db = steps.get(pb.id), again = used.some(([a, b]) => a === pa.id && b === pb.id) ? 100 : 0;
      for (const t of spots) {
        const x = da[t.id], y = db[t.id];
        if (x === Infinity || y === Infinity || Math.abs(x - y) > 1 || Math.min(x, y) < 4) continue;
        const score = x + y + again + ((t.id * 7919 + s.turn * 104729) % 997) / 997;
        if (!best || score < best.score) best = { a: pa.id, b: pb.id, t, score };
      }
    }
  });
  if (!best) return;
  best.t.patch = { dying: 0, camp: null, disputed: true };
  for (const p of s.players) if (!p.out) p.known.add(best.t.id);
  s.disputes = [...used, [best.a, best.b]];
  s.dispute = { turn: s.turn, a: best.a, b: best.b, tile: best.t.id };
}

// Кощей сеет раздор раз за партию. Сначала шепчет: дед называет два самых сильных по войску царства
// в союзе или перемирии. В следующий ход их союз или перемирие рвётся, если ещё держится. Войну Кощей не объявляет.
function sowDiscord(s) {
  const d = s.discord;
  if (d && !d.kind && s.turn === d.strike) {
    const pair = pairKey(d.a, d.b);
    const kind = allied(s, d.a, d.b) ? 'ally' : underTruce(s, d.a, d.b) ? 'truce' : 'none';
    if (kind === 'ally') s.rel.delete(pair);
    if (kind === 'truce') s.truce.delete(pair);
    s.discord = { ...d, kind };
    return;
  }
  if (d || s.turn < B.DISCORD_FROM || s.rand() >= B.DISCORD_CHANCE) return;
  const alive = s.players.filter(p => !p.out && !p.horde);
  let best = null;
  alive.forEach((pa, i) => {
    for (const pb of alive.slice(i + 1)) {
      if (!allied(s, pa.id, pb.id) && truceLeft(s, pa.id, pb.id) < 2) continue;
      const power = armyOf(s, pa.id) + armyOf(s, pb.id);
      if (!best || power > best.power) best = { a: pa.id, b: pb.id, power };
    }
  });
  if (best) s.discord = { a: best.a, b: best.b, warn: s.turn, strike: s.turn + 1 };
}

// Пропавшую грибницу все забывают: новую на этом месте снова надо найти.
// Запас грибницы тает со сбором. Пустая исчезает в следующий ход вместе с лагерем.
function drainCamps(s, pid) {
  const { homeLeft } = s.players[pid];
  if (homeLeft > 0 && homeLeft <= B.CAPITAL_MUSHROOMS) tell(s, pid, 'note', { text: 'Грибница столицы иссякла' });
  for (const t of pickingCamps(s, pid)) {
    const { patch } = t;
    patch.left = (patch.left ?? B.PATCH_STOCK) - B.campYield(s.mods.camp);
    if (patch.left > 0 || patch.dying === 1) continue;
    patch.dying = 1;
    tell(s, pid, 'note', { text: 'Грибница иссякла' });
  }
}

// О хвори сообщают один раз, пока она не отступит.
function noteBlight(s, pid) {
  const p = s.players[pid], sick = barren(s, pid);
  if (sick && !p.blighted) {
    tell(s, pid, 'note', { text: 'На царство пала хворь: живых грибниц не осталось' });
    emit(s, 'blight', { player: pid });
  }
  p.blighted = sick;
}

function clearPatch(s, t) {
  t.patch = null;
  for (const p of s.players) p.known.delete(t.id);
}

function removePatch(s, t) {
  clearPatch(s, t);
  s.stats.faded++;
}

function plague(s) {
  const sick = [];
  const cut = (owner, n) => {
    const lost = B.plagueLoss(n, s.rand());
    sick.push([owner, lost]);
    return n - lost;
  };
  for (const t of towns(s)) t.town.gnomes = cut(t.town.owner, t.town.gnomes);
  for (const u of s.units) u.n = cut(u.owner, u.n);
  s.units = s.units.filter(u => u.n > 0);
  s.plagued = s.turn;
  s.sick = sick;
  emit(s, 'plague', {});
}

// how: чем кончилась партия — horde (одолели Тугарина), camps (лагеря на всех грибницах), last (уцелело одно царство),
// end (кнопка «Закончить», победа по земле). Дед рассказывает итоговый сказ и раздаёт титулы.
function finish(s, winner, how = 'end') {
  if (s.phase !== 'play') return;
  s.phase = 'over';
  s.winner = winner;
  s.encounters = [];
  countSick(s);
  closeToll(s);
  record(s);
  s.epilogue = epilogue(s, winner, how);
  emit(s, 'over', { winner });
}

// Итоговый сказ: как кончилась партия, кто дольше всех правил землёй, кто пал первым, и титулы.
// Строитель — больше всех основал острогов, Воевода — больше всех побил врагов, Купец — больше всех сделок,
// Хлебосол — больше всех собрал грибов, Устоявший — из уцелевших больше всех потерял.
const TITLE_KEYS = [['builder', 'built'], ['warlord', 'killed'], ['merchant', 'deals'], ['host', 'picked']];
function epilogue(s, winner, how) {
  const best = (list, value) => list.filter(p => value(p) > 0).sort((a, b) => value(b) - value(a) || a.id - b.id)[0]?.id ?? null;
  const realms = s.players.filter(p => !p.horde);
  const titles = TITLE_KEYS.map(([key, field]) => [key, best(realms, p => p.tally[field])]);
  titles.push(['stood', best(realms.filter(p => !p.out && p.id !== winner), p => p.tally.lost)]);
  const leads = new Map();
  for (const snap of s.history) {
    const top = snap.players.reduce((b, p, i) => (p.land > (snap.players[b]?.land ?? -1) ? i : b), 0);
    if (snap.players[top]?.land > 0) leads.set(top, (leads.get(top) || 0) + 1);
  }
  const leader = [...leads].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
  const fallen = s.players.filter(p => !p.horde && p.fellOn != null).sort((a, b) => a.fellOn - b.fellOn || a.id - b.id)[0]?.id ?? null;
  const got = titles.filter(([, pid]) => pid != null);
  return { how, titles: got, tale: epilogueLines({ winner, how, leader, fallen, titles: got }) };
}

// Что ждёт всех в начавшемся ходу: общий экран и телефоны показывают это перед ходом.
// Погодные фразы чередуются по номеру хода: одна и та же погода звучит по-разному.
function notices(s) {
  const list = [];
  const say = phrases => { if (phrases) list.push(phrases[s.turn % phrases.length]); };
  if (s.plagued === s.turn) say(B.BARE_STRUCK);
  say(B.WEATHER[s.nextWeather].before);
  say(B.WEATHER[s.pastWeather].after);
  const { text, dark } = B.WEATHER[s.weather];
  say(text);
  if (dark) list.push(dark);
  if (s.dispute?.turn === s.turn) list.push(disputeLine(s.dispute.a, s.dispute.b));
  const d = s.discord;
  if (d?.warn === s.turn) list.push(discordLine(d.a, d.b, 'warn'));
  if (d?.strike === s.turn && (d.kind === 'ally' || d.kind === 'truce')) list.push(discordLine(d.a, d.b, d.kind));
  // Нашествие: за ход до прихода предупреждение, в ход прихода объявление, потом разорённые поселения.
  if (!s.horde && s.turn === s.hordeTurn - 1) list.push(hordeLine('warn'));
  if (s.horde?.came === s.turn) list.push(hordeLine('came'));
  if (s.horde?.newsTurn === s.turn) for (const r of s.horde.news || []) list.push(hordeRaidLine(r.owner, r.capital));
  return list;
}

function checkWin(s) {
  if (s.phase !== 'play') return;
  const patches = allPatches(s);
  if (!patches.length) return;
  const first = patches[0].patch.camp?.owner;
  if (first != null && patches.every(t => t.patch.camp?.owner === first)) finish(s, first, 'camps');
}

// Столица ушла: переезд в самый большой острог, запас грибов остаётся, а грибы столицы приходят уже туда.
function moveCapitalAway(s, pid, target = null) {
  const p = s.players[pid];
  const list = townsOf(s, pid).filter(t => t.id !== p.capital).sort((a, b) => b.town.gnomes - a.town.gnomes);
  const next = target ?? list[0]?.id ?? null;
  const old = p.capital;
  if (old != null && s.map.tiles[old].town?.owner === pid) s.map.tiles[old].town.type = 'ostrog';
  p.capital = next;
  if (next == null) return;
  s.map.tiles[next].town.type = 'capital';
  emit(s, 'capital', { owner: pid, tile: next });
}

// Чужое нельзя трогать без войны. Павшее царство ничего не держит: его земля и крепости ничьи.
const closed = (s, pid, owner) => owner != null && !s.players[owner].out && !atWar(s, pid, owner);

function paint(s, pid, id) {
  if (s.players[pid].horde) return;   // войско Тугарина земли не держит
  const t = s.map.tiles[id];
  if (t.t === 'sea' || t.terr === pid) return;
  if (t.town?.owner != null && t.town.owner !== pid) return;  // цвет живого поселения не меняется
  if (closed(s, pid, t.terr)) return;
  t.terr = pid;
}

// Земля держится, пока своими клетками связана с поселением, лагерем или отрядом своего царства.
// Оторванная земля в начале хода становится ничьей: так пропадают обрывки после войн и походов, а остров держит стоящий на нём отряд.
function dropLooseLand(s) {
  const g = s.map, held = new Set(), queue = [];
  const hold = (id, pid) => {
    if (pid == null || held.has(id) || g.tiles[id].terr !== pid) return;
    held.add(id);
    queue.push(id);
  };
  for (const t of g.tiles) {
    hold(t.id, t.town?.owner);
    hold(t.id, t.patch?.camp?.owner);
  }
  for (const u of s.units) hold(u.tile, u.owner);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const n of neighbors(g, id)) hold(n, g.tiles[id].terr);
  }
  for (const t of g.tiles) {
    if (t.terr == null || held.has(t.id)) continue;
    t.terr = null;
    s.landDirty = true;
  }
}

// Лагерь занимают приходом, ничейный острог входом. Живое поселение войска не забирают: его только разрушают.
function capture(s, u) {
  const t = s.map.tiles[u.tile], pid = u.owner, p = s.players[pid];
  if (p.horde) return;   // войско Тугарина ничего не занимает, только разоряет
  if (t.patch) {
    p.known.add(t.id);
    const camp = t.patch.camp;
    if (camp && camp.owner !== pid && (camp.owner == null || atWar(s, pid, camp.owner))) {
      camp.owner = pid;
      tell(s, pid, 'note', { text: 'Лагерь захвачен' });
    }
  }
  const town = t.town;
  if (town && town.owner == null) {
    town.owner = pid;
    t.terr = pid;
    if (p.capital == null) {
      p.capital = t.id;
      town.type = 'capital';
    }
    emit(s, 'capture', { tile: t.id, owner: pid });
  }
  dropDefeated(s);
  checkWin(s);
}

// Войска, которые не воюют, просто стоят вместе, а клетка становится ничьей.
// Союзники, поселения, дороги и лагеря исключение: цвет такой земли не меняется.
function meet(s, u) {
  const others = s.units.filter(x => x.tile === u.tile && x.owner !== u.owner);
  const t = s.map.tiles[u.tile];
  if (!t.town && !t.road && !t.patch?.camp && others.some(x => relation(s, x.owner, u.owner) === 'peace')) t.terr = null;
}

// Отряд ступил на клетку: красит землю, находит грибницы и встречает существ.
function stepOn(s, u, id) {
  const p = s.players[u.owner];
  p.seen.add(id);
  paint(s, u.owner, id);
  touchHeroes(s, u, id);
  // Грибницу видно и с соседней клетки.
  for (const n of [id, ...neighbors(s.map, id)]) {
    if (!s.map.tiles[n].patch || p.known.has(n)) continue;
    p.known.add(n);
    tell(s, u.owner, 'found', { tile: n });
  }
}

function walk(s, u, target) {
  const route = pathTo(s.map, s.units, u, target, foesOf(s, u.owner), shutOf(s, u.owner));
  if (!route) return false;
  u.tile = target;
  u.mp = s.map.tiles[target].town ? 0 : route.left;
  // Клетка, откуда отряд ушёл, цвет не меняет: ничья остаётся ничьей.
  for (const id of route.path.slice(1)) stepOn(s, u, id);
  meet(s, u);
  emit(s, 'move', { unit: u.id, owner: u.owner, n: u.n, name: u.name, path: route.path });
  capture(s, u);
  return true;
}

function dropDefeated(s) {
  for (const p of s.players) {
    if (p.out) continue;
    if (!s.units.some(u => u.owner === p.id) && !townsOf(s, p.id).length) {
      p.out = true;
      p.capital = null;
      p.fellOn = s.turn;
      s.encounters = s.encounters.filter(e => e.pid !== p.id);
      // Лагеря павшего царства ничьи: их занимает первый, кто придёт.
      for (const t of campsOf(s, p.id)) t.patch.camp.owner = null;
      emit(s, 'fell', { player: p.id });
    }
  }
  const alive = s.players.filter(p => !p.out && !p.horde);
  if (alive.length <= 1) finish(s, alive[0]?.id ?? null, 'last');
}

// Для итогов партии: потери одной стороны идут в счёт другой.
function countBattle(s, a, lostA, b, lostB) {
  s.players[a].tally.killed += lostB;
  s.players[a].tally.lost += lostA;
  s.players[b].tally.killed += lostA;
  s.players[b].tally.lost += lostB;
}

function strike(s, a, d, roll) {
  let power = (a.n / MAX_SOLDIERS) * (B.HIT_BASE + roll * B.HIT_SPREAD) * s.mods.hit;
  if (a.owner != null && a.owner === s.dark) power *= B.DARK_POWER;
  if (a.militia) power *= B.MILITIA;
  if (hasEffect(a, 'fire')) power *= 1.5;
  if (hasEffect(a, 'blaze')) power *= 2;
  if (hasEffect(a, 'char')) power *= 0.5;
  if (hasEffect(a, 'hex')) power *= 0.7;
  if (hasEffect(d, 'ward')) power *= 0.7;
  if (hasEffect(d, 'aegis')) power /= 3;
  return Math.min(d.n, Math.max(1, Math.round(power)));
}

// Один обмен ударами: стороны бьют одновременно, каждая своей силой на начало боёв.
// crew: сколько отрядов делят ответный удар. Бросок решает дробную часть доли.
const clash = (s, a, d, town = null, crew = 1) => ({
  a, d, town, nA: a.n, nD: d.n, hitD: strike(s, a, d, s.rand()), hitA: Math.floor(strike(s, d, a, s.rand()) / crew + s.rand()),
});

// Удар того, кого уже потрепали в другом бою этого похода, слабее: сила отряда растёт с числом воинов.
const worn = (hit, now, was) => (hit && now < was ? Math.max(1, Math.round(hit * now / Math.max(1, was))) : hit);

// Бои идут по очереди. Отряд, павший в другом бою, больше не бьётся: на него не тратят удар и он никого не убивает.
// На экране не появляется воин, которого уже нет. Потрёпанный отряд бьёт слабее.
function landBlows(s, { a, d, town, nA, nD, hitA, hitD }) {
  if (town) d.n = Math.min(d.n, town.gnomes);
  if (!a.n || !d.n) return;
  let lostA = Math.min(a.n, worn(hitA, d.n, nD)), lostD = Math.min(d.n, worn(hitD, a.n, nA));
  // Ополчение острога бьётся, пока гномов не меньше, чем нужно для основания: остальные сдаются в плен.
  if (town?.type === 'ostrog') lostD = Math.min(lostD, Math.max(0, town.gnomes - (B.OSTROG_MIN - 1)));
  // Бой отрядов идёт до конца: обмен ударами повторяется, пока одна сторона не падёт. Штурм ополчения идёт по ходу.
  let lastA = a.n, lastD = d.n;
  while (!town && lostA < a.n && lostD < d.n) {
    const leftA = { ...a, n: a.n - lostA }, leftD = { ...d, n: d.n - lostD };
    [lastA, lastD] = [leftA.n, leftD.n];
    lostD = Math.min(d.n, lostD + strike(s, leftA, leftD, s.rand()));
    lostA = Math.min(a.n, lostA + strike(s, leftD, leftA, s.rand()));
  }
  // Победитель есть всегда: пали обе стороны разом, уцелел один воин той, что была сильнее перед последним обменом.
  if (!town && a.n && d.n && lostA >= a.n && lostD >= d.n) {
    if (lastA > lastD || (lastA === lastD && s.rand() < 0.5)) lostA = a.n - 1;
    else lostD = d.n - 1;
  }
  emit(s, 'battle', {
    a: { id: a.id, owner: a.owner, tile: a.tile, n: Math.max(1, a.n), lost: lostA },
    d: { id: d.id, owner: d.owner, tile: d.tile, n: Math.max(1, d.n), lost: lostD, ...(town ? { militia: true } : {}) },
  });
  a.n -= lostA;
  d.n -= lostD;
  bleed(s, a.tile, lostA);
  bleed(s, d.tile, lostD);
  if (town) {
    town.gnomes -= lostD;
    s.stats.sieges++;
  }
  s.stats.killed += lostA + lostD;
  countBattle(s, a.owner, lostA, d.owner, lostD);
  const cause = town ? 'storm' : 'battle';
  lose(s, a.owner, cause, lostA);
  lose(s, d.owner, cause, lostD);
}

// Где гибнут воины, земля чернеет. Кровь копится до предела и не смывается. Бой в лодке крови на воде не оставляет.
function bleed(s, tile, n) {
  if (n <= 0 || isWater(s.map, tile)) return;
  const t = s.map.tiles[tile];
  t.blood = Math.min(B.BLOOD_MAX, (t.blood || 0) + n);
  s.landDirty = true;
}

// Отряд хозяина в поселении принимает бой первым.
const guardIn = (s, t) => s.units.find(x => x.tile === t.id && x.owner === t.town.owner);

// Почему отряд не бьёт поселение в конце хода. Приказ могла отменить сделка или мир, подошедшая стража его не отменяет.
function stormBar(s, a, t) {
  if (!t.town) return 'поселения уже нет';
  return atWar(s, a.owner, t.town.owner) ? null : 'войны здесь больше нет';
}

// Поселение пало: столица, когда гномов не осталось, острог, когда сдался. В счёт идёт сильнейшему из штурмующих,
// при равенстве любому из них. Гномы сдавшегося острога уходят к нему в плен.
function razeTown(s, t, list, surrender = false) {
  const by = top(list, v => v.n).owner, from = t.town.owner, capital = t.town.type === 'capital';
  s.players[by].tally.taken++;
  const captives = capital ? 0 : takeCaptives(s, t.town, by);
  const loot = capital ? takeTreasury(s, from, by) : 0;
  emit(s, 'townFell', { tile: t.id, by, from, capital, ...(captives ? { captives } : {}), ...(loot ? { loot } : {}), ...(surrender ? { surrender } : {}) });
  ruinTown(s, t);
}

// Пала последняя столица: вся казна побитого царства переходит тому, кто её разрушил. Войско Тугарина грибов не берёт.
function takeTreasury(s, from, by) {
  const loser = s.players[from], winner = s.players[by], n = loser.mushrooms;
  if (townsOf(s, from).length > 1 || winner.horde || n <= 0) return 0;
  loser.mushrooms = 0;
  winner.mushrooms += n;
  return n;
}

// Сдавшиеся гномы сами оказываются в столице захватчика и ждут выкупа. Столицы у него нет: они возвращаются домой.
function takeCaptives(s, town, by) {
  const n = town.gnomes, from = town.owner;
  town.gnomes = 0;
  if (n <= 0) return 0;
  if (!capitalOf(s, by)) {
    if (capitalOf(s, from)) capitalOf(s, from).gnomes += n;
    return 0;
  }
  s.captives.push({ id: s.nextCaptive++, owner: from, by, n, until: s.turn + B.CAPTIVE_TURNS + 1 });
  tell(s, from, 'note', { text: `Острог сдался: гномов в плену ${n}. Выкуп в окне «Дипломатия», ходов на него ${B.CAPTIVE_TURNS}` });
  return n;
}

// Острог без дороги до столицы и без своего отряда может сдаться штурму без боя: чем больше врагов вокруг, тем вероятнее.
function surrenders(s, t, nets) {
  const { owner, gnomes } = t.town;
  if (t.town.type !== 'ostrog' || guardIn(s, t)) return false;
  if (!nets.has(owner)) nets.set(owner, roadNet(s, owner));
  if (nets.get(owner).has(t.id)) return false;
  const around = new Set(neighbors(s.map, t.id));
  const enemies = s.units.filter(u => around.has(u.tile) && atWar(s, u.owner, owner)).reduce((sum, u) => sum + u.n, 0);
  return s.rand() < B.surrenderChance(enemies, gnomes);
}

// Пленные, которых не выкупили за отведённые ходы, остаются у захватчика его гномами.
// Захватчик пал или остался без столицы: пленные уходят домой.
function keepCaptives(s) {
  for (const c of [...s.captives]) {
    const gone = s.players[c.by].out || !capitalOf(s, c.by);
    if (!gone && s.turn < c.until) continue;
    s.captives = s.captives.filter(x => x !== c);
    const home = gone ? capitalOf(s, c.owner) : capitalOf(s, c.by);
    if (!home) continue;
    home.gnomes += c.n;
    emit(s, gone ? 'captivesFreed' : 'captivesStay', { owner: c.owner, by: c.by, n: c.n });
  }
}

// Гномы острога гибнут в огне Горыныча: нанятого или прилетевшего самого.
function burn(s, town) {
  const burned = B.fireLoss(town.gnomes);
  town.gnomes -= burned;
  s.stats.killed += burned;
  s.players[town.owner].tally.lost += burned;
  lose(s, town.owner, 'fire', burned);
  return burned;
}

// Огонь Горыныча падает до боёв. Если жечь уже нечего или некого, грибы или заряд дара возвращаются.
function burnOstrogs(s) {
  for (const { from, tile, gift } of s.fires.splice(0)) {
    const town = s.map.tiles[tile].town;
    const owner = town?.owner;
    const burned = town?.type === 'ostrog' && atWar(s, from, owner) ? burn(s, town) : 0;
    if (!burned) {
      if (gift) s.players[from].burns++;
      else s.players[from].mushrooms += B.FIRE_COST;
      tell(s, from, 'note', { text: gift ? 'Гореть нечему: дар вернулся' : 'Гореть нечему: грибы вернулись' });
      continue;
    }
    s.players[from].tally.burned += burned;
    emit(s, 'fire', { tile, from, owner, burned, ...(gift ? { gift } : {}) });
  }
}

function shuffled(s, list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(s.rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// Штурм одного поселения. Дружина принимает удар первой и бьётся как обычный отряд, а что от удара осталось,
// падает на ополчение: один гном в поселении штурм не отменяет. Ополчение одно на поселение, его удар один на всех.
function stormClashes(s, t, list, fought) {
  const guard = guardIn(s, t), out = [];
  const militia = t.town.gnomes > 0 && { id: 0, owner: t.town.owner, tile: t.id, n: Math.min(MAX_SOLDIERS, t.town.gnomes), effects: [], militia: true };
  let shield = guard?.n ?? 0;
  for (const a of list) {
    const siege = militia && clash(s, a, militia, t.town, list.length);
    if (shield > 0 && !fought.has(pairKey(a.id, guard.id))) {
      const fight = clash(s, a, guard), taken = Math.min(shield, fight.hitD);
      shield -= taken;
      out.push(fight);
      if (siege) siege.hitD -= Math.min(siege.hitD, taken);
    }
    if (siege?.hitD) out.push(siege);
  }
  return out;
}

// Все бои похода идут в его конце, по очереди в случайном порядке. Удары считаются по силам на начало боёв,
// а кого уже потрепали, бьёт слабее; павший в другом бою не бьётся. Встречные приказы двух отрядов это один бой.
// Победитель встаёт на клетку разбитого отряда или разрушенного поселения.
// Поселение бьют с соседних клеток: гномы бьются как ополчение, а когда их не осталось, оно разрушено.
function resolveBattles(s) {
  burnOstrogs(s);
  const clashes = [], fought = new Set(), storms = new Map(), attacks = [];
  for (const o of shuffled(s, s.orders.splice(0))) {
    const a = s.units.find(x => x.id === o.unit), d = s.units.find(x => x.id === o.target);
    if (!a) continue;
    if (o.town != null) {
      storms.set(o.town, [...storms.get(o.town) ?? [], a]);
      continue;
    }
    if (!d || !(a.tile === d.tile || neighbors(s.map, a.tile).includes(d.tile))) {
      tell(s, a.owner, 'note', { text: `${a.name}: враг ушёл, боя не было` });
      continue;
    }
    attacks.push([a, d]);
    const pair = pairKey(a.id, d.id);
    if (fought.has(pair)) continue;
    fought.add(pair);
    clashes.push(clash(s, a, d));
  }
  const sieges = [], nets = new Map();
  for (const [tile, crew] of storms) {
    const t = s.map.tiles[tile], list = crew.filter(a => {
      const bar = stormBar(s, a, t);
      if (bar) tell(s, a.owner, 'note', { text: `${a.name}: ${bar}, штурма не было` });
      return !bar;
    });
    if (!list.length) continue;
    if (surrenders(s, t, nets)) {
      razeTown(s, t, list, true);
      for (const a of strongest(list)) advance(s, a, t.id);
      continue;
    }
    sieges.push({ t, list });
    clashes.push(...stormClashes(s, t, list, fought));
  }
  for (const c of clashes) landBlows(s, c);
  s.units = s.units.filter(u => u.n > 0);
  // Столица стоит до последнего гнома, острог сдаётся, когда гномов в нём меньше, чем нужно для основания.
  for (const { t, list } of sieges) {
    if (t.town.gnomes >= (t.town.type === 'capital' ? 1 : B.OSTROG_MIN) || guardIn(s, t)) continue;
    razeTown(s, t, list);
    for (const a of strongest(list)) advance(s, a, t.id);
  }
  // Кто разбил отряд врага, встаёт на его клетку.
  for (const [a, d] of attacks.sort(([x], [y]) => y.n - x.n)) if (d.n <= 0) advance(s, a, d.tile);
  emitLand(s);
  dropDefeated(s);
  // Лагерь не обороняется: отряд, стоящий на нём без врагов рядом, занимает его в конце похода.
  for (const u of [...s.units]) {
    const camp = s.map.tiles[u.tile].patch?.camp;
    if (!camp || camp.owner === u.owner || s.phase !== 'play') continue;
    if (!s.units.some(x => x.tile === u.tile && atWar(s, x.owner, u.owner))) capture(s, u);
  }
}

// Победитель встаёт на отбитую клетку, если сам уцелел, врагов там не осталось и в неё можно войти.
// Двум своим отрядам на одной клетке не стоять: встаёт самый сильный, остальные остаются на местах.
const strongest = list => [...list].sort((a, b) => b.n - a.n);
function advance(s, u, tile) {
  const g = s.map, t = g.tiles[tile];
  if (u.n <= 0 || u.tile === tile || isWater(g, tile) || TERRAIN[t.t].cost == null || barred(g, tile, u.owner)) return;
  if (s.units.some(x => x.tile === tile && x.n > 0 && (x.owner === u.owner || atWar(s, x.owner, u.owner)))) return;
  const from = u.tile;
  u.tile = tile;
  stepOn(s, u, tile);
  meet(s, u);
  emit(s, 'move', { unit: u.id, owner: u.owner, n: u.n, name: u.name, path: [from, tile] });
  capture(s, u);
}

// --- сказочные существа ---

const anyOf = (s, list) => list[Math.floor(s.rand() * list.length)];
const brief = ({ name, text }) => ({ name, text });
const isLegend = (s, key) => s.legend?.hero === key;
const isDark = s => !!B.WEATHER[s.weather].dark;

// Дар и проклятье: в тёмный ход тёмные, у существа легенды особые, у остальных обычные.
const fateOf = (s, key, side, dark = false) => (dark ? B.HEROES[key].dark : isLegend(s, key) ? s.legend : B.HEROES[key])[side];
const sharpFate = (s, key, dark) => dark || isLegend(s, key);

// Пока встреча не решена, игрок ничего другого сделать не может.
function meetFirst(s, pid) {
  const meet = s.encounters.find(e => e.pid === pid);
  return meet ? `Сначала решите встречу: ${B.HEROES[meet.hero].name}` : null;
}

// Что грозит при отказе. Налёт на острог бьёт по жителям, а особое или тёмное проклятье ещё и по отряду.
function threat(s, key, ostrog, dark) {
  const curse = fateOf(s, key, 'curse', dark);
  if (ostrog == null) return brief(curse);
  const { gnomes } = s.map.tiles[ostrog].town;
  const fire = `в остроге сгорит гномов: ${B.fireLoss(gnomes)} из ${gnomes}`;
  return sharpFate(s, key, dark) ? { name: curse.name, text: `${curse.text}, а ${fire}` } : { name: B.RAID_NAME, text: fire };
}

function meetHero(s, key, pid, u, tile, ostrog = null) {
  if (s.players[pid]?.horde) return;   // существа войско Тугарина не трогают
  if (s.encounters.some(e => e.hero === key && e.pid === pid)) return;
  if (key === 'vodyanoy') s.watered = true;
  const dark = isDark(s) && !B.HEROES[key].horde;
  const meet = {
    id: s.nextMeet++, hero: key, pid, unit: u?.id ?? null, tile, ostrog,
    price: B.ransom(s.turn, s.mods.ransom * (dark ? B.DARK_RANSOM : 1)),
    gift: brief(fateOf(s, key, 'gift', dark)), curse: threat(s, key, ostrog, dark),
    ...(dark ? { dark } : {}),
  };
  s.encounters.push(meet);
  if (s.players[pid].left) settleMeet(s, meet);
}

function reveal(s, tile, key, by, raid = false) {
  s.heroes.add(tile);
  s.stats.heroTurn ??= s.turn;
  emit(s, 'heroFound', { tile, hero: key, by, raid });
}

// Встреча начинается, когда отряд ступил на клетку существа, прошёл через неё или рядом.
// Водяной встречает только лодки и на глаза никому не показывается. Горыныч прилетает сам,
// а на земле его встречает только тот, кто столкнулся с ним на его клетке, даже если он скрылся в лесу.
function touchHeroes(s, u, id) {
  const g = s.map, boat = isWater(g, id);
  for (const n of [id, ...neighbors(g, id)]) {
    const key = g.tiles[n].hero;
    if (!key || (key === 'vodyanoy' && !boat)) continue;
    if (key === 'gorynych' && n !== id) continue;
    if (key !== 'vodyanoy' && !s.heroes.has(n)) reveal(s, n, key, u.owner);
    meetHero(s, key, u.owner, u, n);
  }
}

// После встречи существо уходит на новое место своей земли и снова скрыто,
// поэтому встреча не повторяется на месте. Горыныч улетает, как обычным ходом без налёта.
function rehide(s, key, from) {
  const g = s.map, { land } = B.HEROES[key], lair = g.tiles[from];
  if (lair.hero !== key) return;
  if (!land) return dragonRoam(s, lair);
  s.heroes.delete(from);
  const close = new Set(s.units.flatMap(u => [u.tile, ...neighbors(g, u.tile)]));
  const empty = t => !t.hero && !t.town && !t.patch && !close.has(t.id);
  const own = t => (land === 'sea' ? isWater(g, t.id) && dist(g, t.id, from) <= B.WATER_SWIM : t.t === land);
  const home = g.tiles.filter(t => empty(t) && own(t));
  // Гниль могла съесть всю его землю: тогда подойдёт любая свободная суша.
  const spots = home.length || land === 'sea' ? home : g.tiles.filter(t => empty(t) && !isWater(g, t.id) && TERRAIN[t.t].cost != null);
  if (!spots.length) return;
  lair.hero = null;
  anyOf(s, spots).hero = key;
}

// Побеждённое существо уходит и скрывается. Горыныч улетает в лес, а леса нет, так на любую свободную клетку.
function banish(s, key, from) {
  const g = s.map, lair = g.tiles[from];
  if (B.HEROES[key].land || lair.hero !== key) return rehide(s, key, from);
  const free = perch(s, from), spots = g.tiles.filter(t => free(t) && t !== lair);
  const woods = spots.filter(t => t.t === 'forest');
  if (!spots.length) return;
  s.heroes.delete(from);
  lair.hero = null;
  anyOf(s, woods.length ? woods : spots).hero = key;
}

function enchant(s, u, key, turns) {
  const had = u.effects.find(e => e.key === key), moves = fullMoves(s, u), span = turns + B.effectPad(key, B.turnKind(s.turn));
  if (had) had.turns = Math.max(had.turns, span);
  else u.effects.push({ key, turns: span });
  // Очки хода меняются сразу. Отряд с приказом уже никуда не идёт.
  if (!s.orders.some(o => o.unit === u.id)) u.mp = Math.max(0, u.mp + fullMoves(s, u) - moves);
}

// Потери от порчи и проклятий считаются и в итогах партии, и в погибших за ход.
function curseLoss(s, pid, n) {
  s.players[pid].tally.lost += n;
  lose(s, pid, 'curse', n);
}

function wound(s, u, n) {
  const lost = Math.min(u.n, n);
  u.n -= lost;
  curseLoss(s, u.owner, lost);
}

function hintPatch(s, pid) {
  const p = s.players[pid], hidden = allPatches(s).filter(t => !p.known.has(t.id));
  if (!hidden.length) return;
  const t = anyOf(s, hidden);
  p.known.add(t.id);
  tell(s, pid, 'found', { tile: t.id, hint: true });
}

// Заблудившийся отряд уходит куда придётся и теряет ход.
function wander(s, u) {
  s.orders = s.orders.filter(o => o.unit !== u.id);
  if (u.mp <= 0) return;
  u.mp = MOVES;
  const spots = [...reachOf(s, u).keys()].filter(id => !isWater(s.map, id));
  if (spots.length) walk(s, u, anyOf(s, spots));
  u.mp = 0;
}

// Унесённый отряд оказывается на случайной суше без своих и без врагов, и ход его кончается.
function sendFar(s, u) {
  const g = s.map, busy = new Set(s.units.filter(x => x.owner === u.owner || atWar(s, x.owner, u.owner)).map(x => x.tile));
  const spots = g.tiles.filter(t => !isWater(g, t.id) && TERRAIN[t.t].cost != null && !t.town && !busy.has(t.id));
  s.orders = s.orders.filter(o => o.unit !== u.id);
  u.mp = 0;
  if (!spots.length) return;
  const from = u.tile;
  u.tile = anyOf(s, spots).id;
  stepOn(s, u, u.tile);
  meet(s, u);
  emit(s, 'move', { unit: u.id, owner: u.owner, n: u.n, path: [from, u.tile] });
  capture(s, u);
}

// Судьба от существа: одни и те же данные у обычных и особых даров и проклятий.
// Части судьбы, которым нужен отряд, без него пропускаются.
function applyFate(s, pid, fate, u) {
  const p = s.players[pid], home = capitalOf(s, pid);
  if (fate.gold) p.mushrooms = Math.max(0, p.mushrooms + fate.gold);
  if (fate.goldCut) p.mushrooms -= Math.ceil(p.mushrooms * fate.goldCut);
  if (fate.burns) p.burns += fate.burns;
  if (fate.gnomes && home) {
    const left = Math.max(Math.min(home.gnomes, 1), home.gnomes + fate.gnomes);
    curseLoss(s, pid, Math.max(0, home.gnomes - left));
    home.gnomes = left;
  }
  for (let i = 0; i < (fate.hint || 0); i++) hintPatch(s, pid);
  if (u) {
    if (fate.cut) wound(s, u, Math.min(u.n - 1, Math.round(u.n * fate.cut)));
    if (fate.fill) u.n = MAX_SOLDIERS;
    for (const [key, turns] of fate.effects || []) enchant(s, u, key, turns);
    if (fate.lost) wander(s, u);
    if (fate.far) sendFar(s, u);
  }
  if (fate.slay) slay(s, pid, fate.slay);
}

// В грозу злодей губит воинов царства, которые не укрылись в своих поселениях: по одному из случайных отрядов.
function slay(s, pid, [min, max]) {
  let left = min + Math.floor(s.rand() * (max - min + 1));
  const open = () => s.units.filter(u => u.owner === pid && u.n > 0 && s.map.tiles[u.tile].town?.owner !== pid);
  for (let list = open(); left > 0 && list.length; list = open(), left--) wound(s, list[Math.floor(s.rand() * list.length)], 1);
  s.units = s.units.filter(u => u.n > 0);
}

// Победа в бою приносит дар, всё остальное беду. Налёт на острог бьёт по её жителям, а отряду встречи
// достаётся проклятье, только если это тёмный ход или легенда о самом Горыныче.
// fight: чем кончился бой. Победа приносит дар и ещё грибы, поражение беду.
function settleMeet(s, meet, fight = null) {
  const { hero: key, pid, tile, ostrog, dark } = meet, gift = !!fight?.won;
  const fate = fateOf(s, key, gift ? 'gift' : 'curse', dark), sharp = sharpFate(s, key, dark);
  s.encounters = s.encounters.filter(e => e !== meet);
  if (fight?.won) s.players[pid].mushrooms += meet.price;
  const raid = !gift && ostrog != null, town = raid ? s.map.tiles[ostrog].town : null;
  const burned = town?.owner === pid && town.type === 'ostrog' ? burn(s, town) : 0;
  emit(s, 'encounter', {
    hero: key, tile, owner: pid, text: raid && !sharp ? B.RAID_NAME : fate.name,
    ...(ostrog == null ? {} : { ostrog }), ...(raid ? { burned } : {}),
    ...(dark ? { dark } : {}), ...(fight ? { ...fight, unit: meet.unit, ...(fight.won ? { gold: meet.price } : {}) } : {}),
  });
  // Существо уходит раньше, чем судьба двинет отряд: иначе встреча повторилась бы на месте. Орда стоит, где стояла.
  if (key !== 'tugarin') (fight?.won ? banish : rehide)(s, key, tile);
  if (!raid || sharp) applyFate(s, pid, fate, s.units.find(u => u.id === meet.unit));
}

// Кто бьётся на встрече: отряд, а на налёте без отряда гномы острога.
const meetSide = (s, meet) => s.units.find(x => x.id === meet.unit)
  ?? (meet.ostrog != null && s.map.tiles[meet.ostrog].town?.gnomes ? s.map.tiles[meet.ostrog].town : null);

// Шанс победы на встрече. Некому биться, значит шанса нет.
export function meetChance(s, meet) {
  const side = meetSide(s, meet);
  const power = meet.hero === 'tugarin' ? s.horde?.power ?? 0 : B.HEROES[meet.hero].power;
  return side ? B.fightChance(Math.min(MAX_SOLDIERS, side.n ?? side.gnomes), power) : null;
}

// Бой с существом решается сразу, шанс виден на кнопке. Потери отряда считаются как проклятья.
function fightMeet(s, meet) {
  if (meet.hero === 'tugarin') return fightHorde(s, meet);
  const side = meetSide(s, meet), won = s.rand() < meetChance(s, meet);
  const lost = Math.min(side.n ?? side.gnomes, (won ? B.fightWinLoss : B.fightLoseLoss)(Math.min(MAX_SOLDIERS, side.n ?? side.gnomes)));
  if ('n' in side) wound(s, side, lost);
  else {
    side.gnomes -= lost;
    lose(s, meet.pid, 'curse', lost);
  }
  s.units = s.units.filter(x => x.n > 0);
  settleMeet(s, meet, { won, lost });
  dropDefeated(s);
}

export function cmdEncounter(s, pid, id, fight = false) {
  const meet = s.encounters.find(e => e.id === id && e.pid === pid);
  if (!meet) return 'Такой встречи нет';
  if (fight && meetChance(s, meet) == null) return 'Сражаться некому';
  if (fight) fightMeet(s, meet);
  else settleMeet(s, meet);
  return null;
}

const top = (list, size) => list.reduce((best, x) => (!best || size(x) > size(best) ? x : best), null);

// Цель налёта внутри царства: самый людный острог, а без деревень самый большой отряд.
function raidAim(s, pid) {
  const ostrog = top(townsOf(s, pid).filter(t => t.town.type === 'ostrog' && t.town.gnomes > 0), t => t.town.gnomes);
  if (ostrog) return { pid, ostrog: ostrog.id, near: ostrog.id };
  const unit = top(s.units.filter(u => u.owner === pid), u => u.n);
  return unit && { pid, ostrog: null, near: unit.tile, unit };
}

// Очередь налётов: следующее то живое царство, где Горыныч был реже всех, среди равных случайное.
// Это та же случайная очередь, поэтому разница в числе налётов не больше одного.
// Вышедшего налёт облетает, а вернувшийся должен пропущенное (cmdReturn).
function raidTarget(s) {
  for (let i = 0; i < 2 * s.players.length; i++) {
    const live = s.players.filter(p => !p.out && !p.horde && (!p.left || p.raidDue));
    if (!live.length) return null;
    const least = Math.min(...live.map(p => p.raids));
    const p = anyOf(s, live.filter(x => x.raids === least));
    p.raids++;
    p.raidDue = false;
    const aim = raidAim(s, p.id);
    if (aim) return aim;
  }
  return null;
}

// Где Горыныч может сесть: свободная сухая клетка.
function perch(s, self) {
  const g = s.map, busy = new Set(s.units.map(u => u.tile));
  return t => !isWater(g, t.id) && TERRAIN[t.t].cost != null && !t.town && !t.patch
    && !busy.has(t.id) && (!t.hero || t.id === self);
}

// На налёте он садится на соседнюю свободную клетку. Занято всё вокруг: на ближайшую свободную.
function landing(s, near, self) {
  const g = s.map, free = perch(s, self);
  const around = neighbors(g, near).map(id => g.tiles[id]).filter(free);
  if (around.length) return anyOf(s, around);
  return g.tiles.filter(free).sort((a, b) => dist(g, a.id, near) - dist(g, b.id, near))[0];
}

// Без налёта Горыныч летит куда хочет: на виду у всех или в лес, где исчезает.
// Скрытый так же перебирается с места на место, но этого никто не видит.
function dragonRoam(s, lair) {
  const free = perch(s, lair.id), spots = s.map.tiles.filter(t => free(t) && t !== lair);
  const woods = spots.filter(t => t.t === 'forest'), hide = s.rand() < B.DRAGON_HIDE && woods.length > 0;
  if (!spots.length) return;
  const spot = anyOf(s, hide ? woods : spots), known = s.heroes.delete(lair.id);
  lair.hero = null;
  spot.hero = 'gorynych';
  if (known || !hide) emit(s, 'dragon', { from: lair.id, to: spot.id, owner: null, ostrog: null, hide });
  if (hide) return;
  s.heroes.add(spot.id);
  s.stats.heroTurn ??= s.turn;
}

// Горыныч перелетает через всю карту к очередному царству. Столицы он не трогает.
// В тёмный ход он летит без броска кубика, а лететь не к кому, так просто перебирается.
// Возвращает царство, к которому прилетел.
function dragonFlight(s, dark = false) {
  const g = s.map, lair = g.tiles.find(t => t.hero === 'gorynych');
  if (!lair) return null;
  if (!dark && s.rand() >= s.mods.raid) {
    dragonRoam(s, lair);
    return null;
  }
  const aim = raidTarget(s);
  const spot = aim && !(dark && darkFull(s, aim.pid)) && landing(s, aim.near, lair.id);
  if (!spot) {
    if (dark) dragonRoam(s, lair);
    return null;
  }
  const { pid, ostrog } = aim, known = s.heroes.delete(lair.id);
  lair.hero = null;
  spot.hero = 'gorynych';
  emit(s, 'dragon', { from: lair.id, to: spot.id, owner: pid, ostrog });
  if (known) s.heroes.add(spot.id);
  else reveal(s, spot.id, 'gorynych', pid, true);
  const unit = aim.unit ?? s.units.filter(u => u.owner === pid).sort((a, b) => dist(g, a.tile, spot.id) - dist(g, b.tile, spot.id))[0];
  meetHero(s, 'gorynych', pid, unit, spot.id, ostrog);
  return pid;
}

// Водяной переплывает на другую клетку моря или озера, а если рядом лодки, чаще плывёт к ним. На сушу он не выходит.
function swim(s) {
  const g = s.map, lair = g.tiles.find(t => t.hero === 'vodyanoy');
  if (!lair || (waterDue(s) && waterCall(s, lair))) return;
  const water = g.tiles.filter(t => isWater(g, t.id) && !t.hero && dist(g, t.id, lair.id) <= B.WATER_SWIM);
  const boats = s.units.filter(u => isWater(g, u.tile));
  const hunt = water.filter(t => boats.some(u => dist(g, t.id, u.tile) <= 1));
  const pool = hunt.length && s.rand() < B.WATER_HUNT ? hunt : water;
  if (!pool.length) return;
  const spot = anyOf(s, pool);
  lair.hero = null;
  spot.hero = 'vodyanoy';
  for (const u of boats) if (dist(g, spot.id, u.tile) <= 1) meetHero(s, 'vodyanoy', u.owner, u, spot.id);
}

// Водяной должен встретиться хотя бы раз за партию: подошёл срок, а его никто не видел.
const waterDue = s => !s.watered && s.turn >= B.WATER_DUE && B.turnKind(s.turn) === 'march';

// К сроку он сам приплывает: сначала к лодке, а лодок нет, к отряду на берегу, на соседнюю водную клетку.
// На сушу он не выходит. Нет никого у воды: false, он попробует в следующий поход.
function waterCall(s, lair) {
  const g = s.map, free = id => isWater(g, id) && (!g.tiles[id].hero || id === lair.id);
  const spots = u => [u.tile, ...neighbors(g, u.tile)].filter(free);
  const near = s.units.filter(u => !s.players[u.owner].left && !(isDark(s) && darkFull(s, u.owner)) && spots(u).length);
  const boats = near.filter(u => isWater(g, u.tile)), list = boats.length ? boats : near;
  if (!list.length) return false;
  const u = anyOf(s, list), spot = g.tiles[anyOf(s, spots(u))];
  relocate(s, 'vodyanoy', lair, spot);
  if (isDark(s)) s.players[u.owner].darks++;
  meetHero(s, 'vodyanoy', u.owner, u, spot.id);
  return true;
}

// Открытое всем существо остаётся открытым на новом месте, скрытое остаётся скрытым.
function relocate(s, key, lair, spot) {
  const known = s.heroes.delete(lair.id);
  lair.hero = null;
  spot.hero = key;
  if (known) s.heroes.add(spot.id);
}

// Сколько встреч уже ждёт царство: больше нормы тёмных времён ему не приходит.
const darkFull = (s, pid) => s.encounters.filter(e => e.pid === pid).length >= B.DARK_CAP;

// Честная очередь тёмных встреч: следующее то царство, где существа были реже всех, среди равных случайное.
// Вышедшего она облетает, а царство с полной нормой за этот ход ждёт следующих тёмных времён.
// Кому некого встречать, тот долга не копит: иначе все существа разом пришли бы к его первому новому отряду.
function darkVictim(s, fits) {
  const live = s.players.filter(p => !p.out && !p.horde && !p.left && !darkFull(s, p.id));
  const able = live.filter(p => fits(p.id));
  if (!able.length) return null;
  const least = Math.min(...able.map(p => p.darks));
  for (const p of live) if (!fits(p.id)) p.darks = Math.max(p.darks, least);
  return anyOf(s, able.filter(p => p.darks === least));
}

// Водяной плывёт только по воде и только к лодкам: садится рядом с самой большой лодкой очередного царства.
function darkSwim(s) {
  const g = s.map, lair = g.tiles.find(t => t.hero === 'vodyanoy');
  if (!lair) return;
  const boats = pid => s.units.filter(u => u.owner === pid && isWater(g, u.tile));
  const p = darkVictim(s, pid => boats(pid).length);
  const boat = p && top(boats(p.id), u => u.n);
  const spots = boat ? g.tiles.filter(t => isWater(g, t.id) && dist(g, t.id, boat.tile) <= 1 && (!t.hero || t === lair)) : [];
  if (!spots.length) {
    if (!waterDue(s) || !waterCall(s, lair)) rehide(s, 'vodyanoy', lair.id);
    return;
  }
  const spot = anyOf(s, spots);
  relocate(s, 'vodyanoy', lair, spot);
  p.darks++;
  meetHero(s, 'vodyanoy', p.id, boat, spot.id);
}

// Леший, Яга и Кощей выходят к самому большому отряду очередного царства на суше.
function darkWalk(s, key) {
  const g = s.map, lair = g.tiles.find(t => t.hero === key);
  if (!lair) return;
  // От тёмных времён прячутся в своих поселениях: злодеи выходят к отрядам вне них.
  const squads = pid => s.units.filter(u => u.owner === pid && !isWater(g, u.tile) && g.tiles[u.tile].town?.owner !== pid);
  const p = darkVictim(s, pid => squads(pid).length);
  const u = p && top(squads(p.id), x => x.n);
  const spot = u && landing(s, u.tile, lair.id);
  if (!spot) return rehide(s, key, lair.id);
  relocate(s, key, lair, spot);
  p.darks++;
  meetHero(s, key, p.id, u, spot.id);
}

// Тёмный ход: все существа выходят разом, и у каждого царства за ход не больше двух таких встреч.
// Горыныч идёт по своей очереди налётов, остальные по общей. Кому не к кому прийти, просто перемещается.
function darkHeroes(s) {
  const raided = dragonFlight(s, true);
  if (raided != null) s.players[raided].darks++;
  darkSwim(s);
  for (const key of shuffled(s, Object.keys(B.HEROES).filter(k => k !== 'gorynych' && k !== 'vodyanoy' && !B.HEROES[k].horde))) darkWalk(s, key);
}

// Каждый поход, начиная с третьего хода, Горыныч и Водяной меняют место.
// Тёмные времена поднимают всех существ в любой ход, и в поход, и в дипломатию.
function stirHeroes(s) {
  if (isDark(s)) return darkHeroes(s);
  if (B.turnKind(s.turn) !== 'march') return;
  dragonFlight(s);
  swim(s);
}

// Отряд можно назвать как угодно, имя видно над ним всем.
export function cmdRename(s, pid, unitId, name) {
  const u = ownUnit(s, pid, unitId);
  if (!u) return 'Это не ваш отряд';
  const clean = String(name || '').trim().slice(0, 14);
  if (!clean) return 'Введите имя отряда';
  if (!u.named && s.units.filter(x => x.owner === pid && x.named).length >= B.NAMED_SQUADS) return `Назвать можно только ${B.NAMED_SQUADS} отряда`;
  u.name = clean;
  u.named = true;
  emit(s, 'renamed', { unit: u.id });
  return null;
}

// Царство зовётся всегда одинаково, а имя князя игрок может сменить.
export function cmdPrince(s, pid, name) {
  const clean = B.cleanName(name);
  if (!clean) return 'Введите имя князя';
  s.players[pid].name = clean;
  return null;
}

const myTurn = (s, pid) => s.phase === 'play' && !s.players[pid].out && !s.players[pid].done;
const ownUnit = (s, pid, id) => s.units.find(u => u.id === id && u.owner === pid);
const hasOrder = (s, u) => s.orders.some(o => o.unit === u.id);
const HAS_ORDER = 'Сначала отмените приказ';

export function cmdMove(s, pid, unitId, tile) {
  if (!myTurn(s, pid)) return 'Вы уже закончили ход';
  const u = ownUnit(s, pid, unitId);
  if (!u) return 'Это не ваш отряд';
  if (u.mp <= 0) return 'Этот отряд уже походил';
  if (!reachable(s.map, s.units, u, foesOf(s, pid), true, shutOf(s, pid)).has(tile)) return 'Туда не дойти';
  const mate = s.units.find(x => x.owner === pid && x.tile === tile);
  // Отряд, который влезает целиком, идёт на клетку. Остальные шлют только тех, кто влез.
  if (!mate || u.n <= MAX_SOLDIERS - mate.n) walk(s, u, tile);
  if (mate && s.units.includes(u)) pour(s, u, mate);
  return null;
}

// Воины переходят в другой отряд, максимум до полного. Кто не влез, остаётся на месте.
// Вместе с воинами идут дары и порча: у одних и тех же чар остаётся больший срок.
function pour(s, u, to) {
  const moved = Math.min(u.n, MAX_SOLDIERS - to.n);
  to.n += moved;
  u.n -= moved;
  u.mp = 0;
  for (const e of u.effects) enchant(s, to, e.key, e.turns);
  s.units = s.units.filter(x => x.n > 0);
  for (const meet of s.encounters) if (meet.unit === u.id && !u.n) meet.unit = to.id;
  emit(s, 'merged', { unit: u.id, target: to.id, owner: u.owner, moved });
}

// Отряд подходит вплотную к цели, если ещё не рядом. false: дойти нельзя.
function approach(s, u, around) {
  if (around.includes(u.tile)) return true;
  const reach = reachOf(s, u);
  const spots = around.filter(id => reach.has(id)).sort((a, b) => reach.get(b).left - reach.get(a).left);
  if (!spots.length) return false;
  walk(s, u, spots[0]);
  return true;
}

// Нападение это приказ: отряд подходит вплотную, а бой начнётся в конце хода.
export function cmdAttack(s, pid, unitId, targetId) {
  if (!myTurn(s, pid)) return 'Вы уже закончили ход';
  const u = ownUnit(s, pid, unitId);
  const e = s.units.find(x => x.id === targetId && x.owner !== pid);
  if (!u || !e) return 'Цель не найдена';
  // На своей клетке можно напасть и на мирный отряд: с этого начинается война.
  const breach = e.tile === u.tile && relation(s, pid, e.owner) === 'peace';
  if (!atWar(s, pid, e.owner) && !breach) return notAtWar(s, pid, e.owner);
  if (u.mp <= 0) return 'Этот отряд уже походил';
  if (breach) {
    const refused = startWar(s, pid, e.owner);
    if (refused) return refused;
  }
  if (e.tile !== u.tile && !approach(s, u, neighbors(s.map, e.tile))) return 'До врага не дойти';
  if (s.phase !== 'play') return null;
  s.orders.push({ unit: u.id, target: e.id, left: u.mp });
  u.mp = 0;
  return null;
}

// Поселение бьют приказом: отряд подходит вплотную, а в конце похода бьёт по гномам.
// Без войны его только обходят. Отряд хозяина внутри принимает удар первым, остаток удара падает на гномов.
export function cmdStorm(s, pid, unitId, tile) {
  if (!myTurn(s, pid)) return 'Вы уже закончили ход';
  const u = ownUnit(s, pid, unitId);
  if (!u) return 'Это не ваш отряд';
  const t = s.map.tiles[tile];
  if (!t?.town) return 'Здесь нет поселения';
  if (t.town.owner == null) return 'Ничейный острог занимают входом';
  if (t.town.owner === pid) return 'Это ваше поселение';
  if (!atWar(s, pid, t.town.owner)) return notAtWar(s, pid, t.town.owner);
  if (u.mp <= 0) return 'Этот отряд уже походил';
  if (!approach(s, u, neighbors(s.map, tile))) return 'До поселения не дойти';
  if (s.phase !== 'play') return null;
  s.orders.push({ unit: u.id, town: tile, left: u.mp });
  u.mp = 0;
  return null;
}

// Передумал до конца хода: приказ снимается, очки хода возвращаются.
export function cmdCancel(s, pid, unitId) {
  if (!myTurn(s, pid)) return 'Вы уже закончили ход';
  const u = ownUnit(s, pid, unitId), order = s.orders.find(o => o.unit === unitId);
  if (!u || !order) return 'Приказа нет';
  s.orders = s.orders.filter(o => o !== order);
  u.mp = order.left;
  return null;
}

// Два своих отряда рядом становятся одним. Кто не влез, остаётся в прежнем отряде.
export function cmdMerge(s, pid, unitId, targetId) {
  if (!myTurn(s, pid)) return 'Вы уже закончили ход';
  const u = ownUnit(s, pid, unitId), to = ownUnit(s, pid, targetId);
  if (!u || !to || u === to) return 'Это не ваш отряд';
  if (!neighbors(s.map, u.tile).includes(to.tile)) return 'Отряды должны стоять рядом';
  if (u.mp <= 0) return 'Этот отряд уже походил';
  if (to.n >= MAX_SOLDIERS) return 'Отряд уже полон';
  pour(s, u, to);
  return null;
}

// Нанятый Горыныч жжёт вражеский острог в конце похода. Плата в грибах вперёд.
// Дар Горыныча сжигает бесплатно, и самого его видеть для этого не нужно: заряд тратится первым.
export function cmdFire(s, pid, tile) {
  if (!myTurn(s, pid)) return 'Вы уже закончили ход';
  const town = s.map.tiles[tile]?.town, p = s.players[pid];
  if (!town || town.owner == null || town.owner === pid) return 'Горыныч жжёт только вражеские остроги';
  if (town.type === 'capital') return 'Столицы Горыныч не трогает';
  if (!atWar(s, pid, town.owner)) return notAtWar(s, pid, town.owner);
  const gift = p.burns > 0;
  if (!gift && ![...s.heroes].some(id => s.map.tiles[id].hero === 'gorynych')) return 'Горыныча сейчас не видно';
  if (s.fires.some(f => f.from === pid && f.tile === tile)) return 'Огонь уже заказан';
  if (!gift && p.mushrooms < B.FIRE_COST) return 'Не хватает грибов';
  if (gift) p.burns--;
  else p.mushrooms -= B.FIRE_COST;
  s.fires.push({ from: pid, tile, gift });
  tell(s, pid, 'note', { text: 'Горыныч прилетит в конце хода' });
  return null;
}

// Уничтоженная грибница больше не травит землю. Уже почерневшее остаётся чёрным.
export function cmdDestroy(s, pid, unitId) {
  if (!myTurn(s, pid)) return 'Вы уже закончили ход';
  const u = ownUnit(s, pid, unitId);
  if (!u) return 'Это не ваш отряд';
  const t = s.map.tiles[u.tile];
  if (!t.patch) return 'Здесь нет грибницы';
  if (u.mp <= 0) return 'Этот отряд уже походил';
  const camp = t.patch.camp;
  if (camp && camp.owner != null && camp.owner !== pid) return 'Здесь чужой лагерь';
  clearPatch(s, t);
  u.mp = 0;
  s.stats.destroyed = (s.stats.destroyed || 0) + 1;
  tell(s, pid, 'note', { text: 'Грибница уничтожена' });
  checkWin(s);
  return null;
}

// Гномов можно переселять между столицей и своим острогом в любой ход и без дороги.
// back: из острога в столицу. Один гном остаётся на месте, иначе поселение опустеет.
export function cmdSettle(s, pid, tile, count, back = false) {
  if (!myTurn(s, pid)) return 'Вы уже закончили ход';
  const town = s.map.tiles[tile]?.town, home = capitalOf(s, pid);
  if (town?.owner !== pid || town.type !== 'ostrog') return 'Это не ваш острог';
  if (!home) return 'Столицы нет';
  // Где стоит враг, гномов не вывести и не ввести: ни в остроге, ни в столице.
  if (s.units.some(u => (u.tile === tile || u.tile === s.players[pid].capital) && atWar(s, u.owner, pid))) return 'В поселении стоят вражеские войска';
  // Гномы ходят только по дороге: туда, куда грибы из столицы доходят. Путь нужен и показу хода.
  const cells = routesFrom(s, pid).pathOf(tile);
  if (!cells) return 'Дорога не доходит до столицы: переселять нельзя';
  const [from, to] = back ? [town, home] : [home, town];
  const n = Math.min(Math.max(1, Math.floor(Number(count) || 1)), back ? from.gnomes - 1 : freeGnomes(s, pid), B.CAP[to.type] - to.gnomes);
  if (n <= 0) return 'Некого переселить';
  from.gnomes -= n;
  to.gnomes += n;
  // Острог заселили: счёт пустых ходов начинается заново, развалится он только после двух полных пустых ходов.
  to.empty = 0;
  emit(s, 'resettle', { owner: pid, n, cells: back ? [...cells].reverse() : cells });
  tell(s, pid, 'note', { text: `Переселено гномов: ${n}` });
  return null;
}

// Остаток сбора после еды игрок делит сам: выбранная доля станет гномами, остальное идёт в запас.
export function cmdBirths(s, pid, share) {
  if (!myTurn(s, pid)) return 'Вы уже закончили ход';
  if (!B.BIRTH_SHARES.includes(share)) return 'Такой доли нет';
  s.players[pid].birthShare = share;
  return null;
}

// Отряд, стоящий в своём поселении, расходится по домам. Кому не хватило места, остаются в строю.
export function cmdGarrison(s, pid, unitId) {
  if (!myTurn(s, pid)) return 'Вы уже закончили ход';
  const u = ownUnit(s, pid, unitId);
  if (!u) return 'Это не ваш отряд';
  if (hasOrder(s, u)) return HAS_ORDER;
  const town = s.map.tiles[u.tile].town;
  if (town?.owner !== pid) return 'Здесь нет вашего поселения';
  const n = Math.min(u.n, B.CAP[town.type] - town.gnomes);
  if (n <= 0) return 'Поселение полно';
  town.gnomes += n;
  town.empty = 0;   // заселённое поселение снова считает пустые ходы с нуля
  u.n -= n;
  s.units = s.units.filter(x => x.n > 0);
  tell(s, pid, 'note', { text: `Заселено гномов: ${n}` });
  return null;
}

// Свою клетку можно отдать любому живому царству сразу и без ответа. Поселение отдают сделкой.
export function cmdGiveLand(s, pid, tile, other) {
  if (!myTurn(s, pid)) return 'Вы уже закончили ход';
  const t = s.map.tiles[tile], to = s.players[other];
  if (t?.terr !== pid) return 'Это не ваша клетка';
  if (!to || to.out || other === pid) return 'Некому отдать';
  if (t.town) return 'Поселение так не отдать';
  t.terr = other;
  s.landDirty = true;
  // Клетка с грибницей уходит вместе с ней: свой лагерь на ней становится лагерем нового хозяина, остаток запаса тот же.
  const camp = t.patch?.camp?.owner === pid;
  if (t.patch) to.known.add(tile);
  if (camp) t.patch.camp.owner = other;
  tell(s, other, 'note', { text: `${s.players[pid].realm} отдаёт вам клетку${camp ? ' с лагерем на грибнице' : t.patch ? ' с грибницей' : ''}` });
  emitLand(s);
  if (camp) checkWin(s);
  return null;
}

export function cmdMobilize(s, pid, tile, count) {
  if (!myTurn(s, pid)) return 'Вы уже закончили ход';
  const t = s.map.tiles[tile];
  if (!t) return 'Нет такой клетки';
  const home = t.town?.owner === pid ? t.town : null;
  if (!home) return 'Здесь нет ваших гномов';
  if (s.units.some(u => u.tile === tile && u.owner === pid)) return 'Клетка занята отрядом';
  const spare = home.type === 'capital' ? freeGnomes(s, pid) : home.gnomes - 1;
  const n = Math.min(MAX_SOLDIERS, spare, Math.max(1, Math.floor(Number(count) || MAX_SOLDIERS)));
  if (n <= 0) return 'Некого собрать';
  home.gnomes -= n;
  // Дружина из столицы сразу делает шаг на соседнюю клетку, какой бы трудной та ни была.
  const unit = addUnit(s, pid, tile, n, home.type === 'capital' ? 1 : 0);
  if (home.type === 'capital') unit.fresh = true;
  emit(s, 'spawn', { unit: { ...unit } });
  touchHeroes(s, unit, tile);
  return null;
}

export function cmdRoad(s, pid, tile) {
  if (!myTurn(s, pid)) return 'Вы уже закончили ход';
  const t = s.map.tiles[tile], p = s.players[pid];
  if (!t || !roadLand(s, pid, t)) return 'Дорога идёт только по своей земле';
  if (t.road || t.town?.type === 'capital') return 'Здесь дорога уже есть';
  if (isWater(s.map, tile) || TERRAIN[t.t].cost == null) return 'Здесь дорогу не проложить';
  if (purse(s, pid) < B.ROAD_COST) return 'Не хватает грибов';
  p.mushrooms -= B.ROAD_COST;
  t.road = true;
  p.tally.roads++;
  s.landDirty = true;
  emitLand(s);
  return null;
}

// Свою дорогу можно снять где угодно. Вражескую ломает отряд, стоящий на ней, в поход.
export function cmdRazeRoad(s, pid, tile) {
  if (!myTurn(s, pid)) return 'Вы уже закончили ход';
  const t = s.map.tiles[tile];
  if (!t?.road) return 'Здесь нет дороги';
  if (t.terr !== pid) {
    if (B.turnKind(s.turn) !== 'march') return 'Чужие дороги ломают в поход';
    if (!s.units.some(u => u.owner === pid && u.tile === tile)) return 'Нужен ваш отряд на этой клетке';
    if (closed(s, pid, t.terr)) return notAtWar(s, pid, t.terr);
  }
  t.road = false;
  t.dug = true;
  s.landDirty = true;
  // Гриб возвращается хозяину земли, кто бы дорогу ни сломал.
  const owner = t.terr != null && !s.players[t.terr].out ? t.terr : null;
  if (owner != null) s.players[owner].mushrooms += B.ROAD_REFUND;
  emit(s, 'razed', { tile, by: pid, ...(owner != null ? { owner } : {}) });
  emitLand(s);
  return null;
}

// Лагерю гномы не нужны: отряд отмечает грибницу и идёт дальше целиком.
export function cmdCamp(s, pid, unitId) {
  if (!myTurn(s, pid)) return 'Вы уже закончили ход';
  const u = ownUnit(s, pid, unitId);
  if (!u) return 'Это не ваш отряд';
  if (hasOrder(s, u)) return HAS_ORDER;
  const t = s.map.tiles[u.tile];
  if (!t.patch) return 'Здесь нет грибницы';
  if (t.patch.camp?.owner === pid) return 'Лагерь уже стоит';
  if (t.patch.camp && t.patch.camp.owner != null) return 'Здесь чужой лагерь';
  t.patch.camp = { owner: pid };
  paint(s, pid, t.id);
  tell(s, pid, 'note', { text: 'Лагерь поставлен' });
  checkWin(s);
  return null;
}

export function cmdOstrog(s, pid, unitId) {
  if (!myTurn(s, pid)) return 'Вы уже закончили ход';
  const u = ownUnit(s, pid, unitId);
  if (!u) return 'Это не ваш отряд';
  if (hasOrder(s, u)) return HAS_ORDER;
  const t = s.map.tiles[u.tile];
  if (u.n < B.OSTROG_MIN) return `Нужно ${B.OSTROG_MIN} гномов`;
  if (isWater(s.map, t.id) || t.town || t.patch || t.hero) return 'Здесь строить нельзя';
  if (t.terr !== pid) return 'Строить можно только на своей земле';
  if (towns(s).some(o => dist(s.map, o.id, t.id) < B.OSTROG_GAP)) return 'Слишком близко к другому острогу';
  const p = s.players[pid], cost = p.capital == null ? 0 : B.OSTROG_COST;
  if (purse(s, pid) < cost) return 'Не хватает грибов';
  p.mushrooms -= cost;
  t.town = { type: p.capital == null ? 'capital' : 'ostrog', owner: pid, gnomes: u.n, empty: 0 };
  // Новое поселение расчищает руины на своём месте.
  if (t.t === 'ruins') Object.assign(t, { t: 'field', rot: 0 });
  t.dug = true;
  if (p.capital == null) p.capital = t.id;
  s.units = s.units.filter(x => x !== u);
  p.tally.built++;
  s.landDirty = true;
  emit(s, 'built', { tile: t.id, owner: pid });
  emitLand(s);
  return null;
}

export function cmdCapital(s, pid, tile) {
  if (!myTurn(s, pid)) return 'Вы уже закончили ход';
  const t = s.map.tiles[tile], p = s.players[pid];
  if (t?.town?.owner !== pid || t.town.type !== 'ostrog') return 'Это не ваш острог';
  if (!roadNet(s, pid).has(tile)) return 'К острогу нет дороги от столицы';
  if (purse(s, pid) < B.MOVE_CAPITAL) return 'Не хватает грибов';
  p.mushrooms -= B.MOVE_CAPITAL;
  moveCapitalAway(s, pid, tile);
  return null;
}

// --- сделки, союзы и война ---

const emptyBundle = () => ({ mushrooms: 0, gnomes: 0, ostrogs: [] });
const whole = n => Math.max(0, Math.floor(Number(n) || 0));

function cleanBundle(b) {
  const { mushrooms, gnomes, ostrogs } = b || {};
  return {
    mushrooms: whole(mushrooms), gnomes: whole(gnomes),
    ostrogs: [...new Set((Array.isArray(ostrogs) ? ostrogs : []).map(Number))],
  };
}

// Сделки идут с баланса: в обмене участвуют только гномы столицы.
const spareGnomes = (s, pid) => Math.max(0, (capitalOf(s, pid)?.gnomes || 0) - 1);

// Что уже обещано в неотвеченных предложениях: дважды этим распорядиться нельзя.
const promised = (s, pid, key) => s.offers.filter(o => o.from === pid).reduce((sum, o) => sum + o.give[key], 0);
const freeGnomes = (s, pid) => spareGnomes(s, pid) - promised(s, pid, 'gnomes');
function purse(s, pid) {
  return s.players[pid].mushrooms - promised(s, pid, 'mushrooms');
}

function canPay(s, pid, b) {
  if (purse(s, pid) < b.mushrooms) return false;
  if (b.gnomes && freeGnomes(s, pid) < b.gnomes) return false;
  const given = new Set(s.offers.filter(o => o.from === pid).flatMap(o => o.give.ostrogs));
  return b.ostrogs.every(id => {
    const town = s.map.tiles[id]?.town;
    return town?.owner === pid && town.type === 'ostrog' && !given.has(id);
  });
}

export const bundleValue = (s, b) => b.mushrooms + b.gnomes * B.GNOME_VALUE
  + b.ostrogs.reduce((sum, id) => sum + B.OSTROG_VALUE + s.map.tiles[id].town.gnomes * B.GNOME_VALUE, 0);

function moveGnomes(s, from, to, count) {
  capitalOf(s, from).gnomes -= count;
  capitalOf(s, to).gnomes += count;
}

function transfer(s, from, to, b) {
  s.players[from].mushrooms -= b.mushrooms;
  s.players[to].mushrooms += b.mushrooms;
  if (b.gnomes) moveGnomes(s, from, to, b.gnomes);
  for (const id of b.ostrogs) {
    s.map.tiles[id].town.owner = to;
    s.map.tiles[id].terr = to;
    // Царство без столицы получает её с первым острогом, как при занятии ничейной.
    if (s.players[to].capital == null) moveCapitalAway(s, to, id);
  }
}

const OFFER_KINDS = ['ally', 'trade', 'peace', 'pass', 'embassy'];
const askKey = (a, b, kind) => `${pairKey(a, b)}:${kind}`;

export function cmdOffer(s, pid, { to, kind, give, take }) {
  const first = meetFirst(s, pid);
  if (first) return { error: first };
  if (!myTurn(s, pid)) return { error: 'Вы уже закончили ход' };
  const other = Number.isInteger(to) ? s.players[to] : null;
  if (!other || other.id === pid || other.out) return { error: 'Такого царства нет' };
  if (other.horde || s.players[pid].horde) return { error: 'С войском Тугарина не договориться' };
  if (!OFFER_KINDS.includes(kind)) return { error: 'Неизвестное предложение' };
  if (kind === 'ally' && allied(s, pid, to)) return { error: 'Союз уже заключён' };
  if (kind === 'peace' && !atWar(s, pid, to)) return { error: 'Войны нет' };
  if (kind === 'pass' && atWar(s, pid, to)) return { error: 'Сначала заключите мир' };
  if (kind === 'pass' && allied(s, pid, to)) return { error: 'Союзникам пропуск не нужен' };
  if (kind === 'pass' && hasPass(s, to, pid)) return { error: 'Пропуск уже есть' };
  if (kind === 'embassy' && atWar(s, pid, to)) return { error: 'Сначала заключите мир' };
  if (kind === 'embassy' && hasEmbassy(s, pid, to)) return { error: 'Посольства уже есть' };
  if (s.offers.some(o => o.from === pid && o.to === to)) return { error: 'Ответа ещё нет' };
  // Бот отвечает на каждый вид предложения раз за ход: иначе отказ ничего не стоит, а шкала шанса ничего не значит.
  // Люди договариваются сколько хотят, раз за ход ограничен только союз.
  const once = kind === 'ally' || other.bot, key = askKey(pid, to, kind);
  if (once && s.asked.has(key)) return { error: kind === 'ally' ? 'Союз можно предложить раз в ход' : 'Бот уже ответил в этот ход' };
  const offer = {
    id: s.nextOffer++, from: pid, to: other.id, kind,
    give: cleanBundle(give), take: kind === 'trade' ? cleanBundle(take) : emptyBundle(),
  };
  const empty = b => !b.mushrooms && !b.gnomes && !b.ostrogs.length;
  if (kind === 'trade' && empty(offer.give) && empty(offer.take)) return { error: 'Сделка пустая' };
  if (!canPay(s, pid, offer.give)) return { error: 'Вам нечем заплатить' };
  if (!canPay(s, to, offer.take)) return { error: 'У них этого нет' };
  if (offer.take.gnomes && !capitalOf(s, pid)) return { error: 'Гномам негде жить' };
  if (offer.give.gnomes && !capitalOf(s, to)) return { error: 'Гномам негде жить' };
  s.offers.push(offer);
  if (once) s.asked.add(key);
  return { offer };
}

// Шанс, что бот согласится: та же формула, что на шкале пульта.
// Сила царства в бою: тёмное бьёт в полтора раза сильнее.
export const powerOf = (s, pid) => armyOf(s, pid) * (pid === s.dark ? B.DARK_POWER : 1);

// Сторона pid в войне с foe: само царство и его союзники, которые тоже воюют с foe.
export const warSide = (s, pid, foe) => [pid, ...friendsOf(s, pid).filter(id => !s.players[id].out && atWar(s, id, foe))]
  .reduce((sum, id) => sum + powerOf(s, id), 0);

// Бот смотрит на обстановку: проигрывая войну, он охотнее мирится, выигрывая, требует больше.
// Общий сильный враг сближает его с другим царством, а усиливать вожака он не спешит. Прибавка идёт к шансу на шкале.
export function botLean(s, bot, other, kind) {
  if (kind === 'peace') {
    if (!atWar(s, bot, other)) return 0;
    const ratio = warSide(s, other, bot) / Math.max(1, warSide(s, bot, other));
    const nature = B.NATURES[s.players[bot].nature]?.peace ?? 0;
    return nature + (ratio >= B.LEAN_LOSING ? B.LEAN_PEACE.losing : ratio >= 1 ? B.LEAN_PEACE.even : ratio <= B.LEAN_WINNING ? B.LEAN_PEACE.winning : 0);
  }
  if (kind === 'embassy') return ((B.NATURES[s.players[bot].nature]?.trade ?? 1) - 1) * 0.1 - (grudge(s, bot, other) ? B.GRUDGE_ALLY : 0);
  if (kind !== 'ally') return 0;
  const alive = s.players.filter(p => !p.out), mine = powerOf(s, bot), theirs = powerOf(s, other);
  const top = Math.max(0, ...alive.map(p => powerOf(s, p.id)));
  const common = alive.some(p => p.id !== bot && p.id !== other && powerOf(s, p.id) > Math.max(mine, theirs)
    && (atWar(s, p.id, bot) || atWar(s, p.id, other) || powerOf(s, p.id) === top));
  return (common ? B.LEAN_ALLY.common : 0) + (theirs === top && theirs > mine * 1.5 ? B.LEAN_ALLY.leader : 0) - (grudge(s, bot, other) ? B.GRUDGE_ALLY : 0);
}

export function offerChance(s, offer) {
  const war = atWar(s, offer.from, offer.to);
  const lean = s.players[offer.to].bot ? botLean(s, offer.to, offer.from, offer.kind) : 0;
  if (offer.kind === 'ally') return B.leaned(B.allyChance(offer.give.mushrooms, war), lean);
  if (offer.kind === 'peace') return B.leaned(B.peaceChance(offer.give.mushrooms), lean);
  if (offer.kind === 'pass') return B.passChance(offer.give.mushrooms);
  if (offer.kind === 'embassy') return B.leaned(B.embassyChance(offer.give.mushrooms), lean);
  return B.dealChance(bundleValue(s, offer.give), bundleValue(s, offer.take), war);
}

export function cmdAnswer(s, pid, offerId, accept) {
  const first = meetFirst(s, pid);
  if (first) return first;
  const offer = s.offers.find(o => o.id === offerId && o.to === pid);
  if (!offer) return 'Предложение уже не действует';
  s.offers = s.offers.filter(o => o !== offer);
  if (!accept) {
    emit(s, 'refused', { from: offer.from, to: offer.to, kind: offer.kind });
    return null;
  }
  if ((offer.kind === 'pass' || offer.kind === 'embassy') && atWar(s, offer.from, offer.to)) return 'Условия больше не выполнить';
  if (offer.kind === 'peace' && !atWar(s, offer.from, offer.to)) return 'Мир уже заключён';
  if (!canPay(s, offer.from, offer.give) || !canPay(s, offer.to, offer.take)) return 'Условия больше не выполнить';
  transfer(s, offer.from, offer.to, offer.give);
  transfer(s, offer.to, offer.from, offer.take);
  emitLand(s);
  const pair = pairKey(offer.from, offer.to);
  if (offer.kind === 'ally') {
    s.rel.set(pair, 'ally');
    s.allySince.set(pair, s.turn);
  }
  if (offer.kind === 'pass') s.passes.add(passKey(offer.to, offer.from));
  if (offer.kind === 'embassy') (s.embassies ||= new Set()).add(pair);
  if (offer.kind === 'peace' && atWar(s, offer.from, offer.to)) {
    s.rel.delete(pair);
    s.truce.set(pair, s.turn + B.TRUCE_TURNS);
  }
  s.players[offer.from].tally.deals++;
  s.players[offer.to].tally.deals++;
  emit(s, 'deal', { from: offer.from, to: offer.to, kind: offer.kind });
  dropDefeated(s);
  settleRound(s);
  return null;
}

export function cmdBreak(s, pid, other) {
  if (!myTurn(s, pid)) return 'Вы уже закончили ход';
  if (!allied(s, pid, other)) return 'Союза нет';
  offend(s, other, pid);
  s.rel.delete(pairKey(pid, other));
  emit(s, 'broken', { from: pid, to: other });
  return null;
}

// Хозяин закрывает границу: пропуск гостя больше не действует.
// Прежний хозяин выкупает своих пленных: они сразу возвращаются в его столицу, грибы уходят захватчику.
export function cmdRansom(s, pid, id) {
  if (!myTurn(s, pid)) return 'Вы уже закончили ход';
  const c = s.captives.find(x => x.id === id && x.owner === pid);
  if (!c) return 'Таких пленных нет';
  const home = capitalOf(s, pid), price = c.n * B.RANSOM_PRICE, p = s.players[pid];
  if (!home) return 'Без столицы пленных некуда вернуть';
  if (p.mushrooms < price) return `На выкуп нужно грибов: ${price}`;
  p.mushrooms -= price;
  s.players[c.by].mushrooms += price;
  home.gnomes += c.n;
  s.captives = s.captives.filter(x => x !== c);
  emit(s, 'ransom', { owner: pid, by: c.by, n: c.n, price });
  return null;
}

export function cmdShut(s, pid, guest) {
  if (!myTurn(s, pid)) return 'Вы уже закончили ход';
  if (!hasPass(s, pid, guest)) return 'Пропуска нет';
  s.passes.delete(passKey(pid, guest));
  emit(s, 'borderShut', { from: pid, to: guest });
  return null;
}

// Общий союзник двух царств: война между ними сделала бы его врагом.
export const sharedAlly = (s, a, b) => friendsOf(s, b).find(id => allied(s, a, id));

// Начавший войну становится врагом и для всех союзников жертвы,
// поэтому союз с союзником жертвы надо сначала разорвать.
export function cmdWar(s, pid, other) {
  if (!myTurn(s, pid)) return 'Вы уже закончили ход';
  if (!s.players[other] || other === pid || s.players[other].out) return 'Такого царства нет';
  if (allied(s, pid, other)) return 'Сначала разорвите союз';
  if (atWar(s, pid, other)) return 'Война уже идёт';
  return startWar(s, pid, other);
}

function startWar(s, pid, other) {
  const shared = sharedAlly(s, pid, other);
  if (shared != null) return `Сначала разорвите союз: ${s.players[shared].realm}`;
  // Перемирие связывает обе стороны. Союзники цели вступили бы в войну, поэтому оно действует и с ними.
  const foes = [other, ...friendsOf(s, other)], held = foes.find(foe => underTruce(s, pid, foe));
  if (held != null) return `Перемирие: ${s.players[held].realm}, ещё ходов ${truceLeft(s, pid, held)}`;
  s.players[pid].warAt = s.turn;
  for (const foe of foes) {
    offend(s, foe, pid);
    s.rel.set(pairKey(pid, foe), 'war');
    // С войной пропуска кончаются в обе стороны.
    s.passes.delete(passKey(pid, foe));
    s.passes.delete(passKey(foe, pid));
    s.embassies?.delete(pairKey(pid, foe));
    emit(s, 'war', { from: pid, to: foe, ...(foe === other ? {} : { joined: other }) });
  }
  return null;
}

// Все ходят одновременно. Когда последний закончил, начинается следующий ход.
export function cmdEndTurn(s, pid) {
  if (!myTurn(s, pid)) return 'Вы уже закончили ход';
  s.players[pid].done = true;
  emit(s, 'ready', { player: pid });
  return null;
}

// Игрок вышел из партии: его царство стоит, а круг его больше не ждёт.
// Нерешённые встречи решаются сами: царство страдает.
// hold: пока общий экран показывает ход, новый круг закрывать нельзя.
export function cmdLeave(s, pid, hold = false) {
  s.players[pid].left = true;
  for (const meet of s.encounters.filter(e => e.pid === pid)) settleMeet(s, meet, false);
  emit(s, 'left', { player: pid });
  if (!hold) settleRound(s);
}

// Вернулся: всё, что он пропустил, прощается, кроме одного налёта. От него снова выйти нельзя.
export function cmdReturn(s, pid) {
  const p = s.players[pid];
  p.left = false;
  const others = s.players.filter(x => x !== p && !x.out && !x.left), rest = others.map(x => x.raids);
  const least = Math.min(...rest);
  if (others.length) p.darks = Math.max(p.darks, Math.min(...others.map(x => x.darks)));
  if (!rest.length || p.raids >= least) return;
  p.raids = least - 1;
  p.raidDue = true;
}

// Круг кончается, когда думать больше некому, в том числе если последний погиб или вышел.
function settleRound(s) {
  if (s.phase === 'play' && s.players.every(p => p.out || p.left || p.done)) nextRound(s);
}

function nextRound(s) {
  const ended = s.turn;
  if (B.turnKind(ended) === 'march') resolveBattles(s);
  s.offers = [];
  s.asked.clear();
  if (s.phase !== 'play') return;
  s.turn++;
  emit(s, 'turn', { turn: s.turn, ended });
  keepCaptives(s);
  // Пустой острог считает ходы партии до кормления: опустевшая сейчас начнёт счёт со следующего хода.
  collapseTowns(s);
  beginRound(s);
  for (const p of s.players) p.done = false;
  for (const p of s.players) if (!p.out && s.phase === 'play') beginTurn(s, p.id);
  if (s.phase !== 'play') return;
  emitLand(s);
  dropDefeated(s);
  checkWin(s);
  if (s.phase === 'play') stirHeroes(s);
  if (s.phase !== 'play') return;
  closeToll(s);
  countSick(s);
  record(s);
}

const WHOLE = ['unit', 'tile', 'target', 'other'];  // номера приходят из сети: только целые числа

// Одно действие от имени игрока: так ходят и телефоны, и боты.
function runAction(s, pid, act) {
  if (WHOLE.some(key => act[key] !== undefined && !Number.isInteger(act[key]))) return 'Неверная команда';
  if (act.type === 'encounter') return cmdEncounter(s, pid, act.id, !!act.fight);
  const first = meetFirst(s, pid);
  if (first) return first;
  if (act.type === 'move') return cmdMove(s, pid, act.unit, act.tile);
  if (act.type === 'attack') return cmdAttack(s, pid, act.unit, act.target);
  if (act.type === 'cancel') return cmdCancel(s, pid, act.unit);
  if (act.type === 'merge') return cmdMerge(s, pid, act.unit, act.target);
  if (act.type === 'fire') return cmdFire(s, pid, act.tile);
  if (act.type === 'storm') return cmdStorm(s, pid, act.unit, act.tile);
  if (act.type === 'raze') return cmdRazeRoad(s, pid, act.tile);
  if (act.type === 'rename') return cmdRename(s, pid, act.unit, act.name);
  if (act.type === 'prince') return cmdPrince(s, pid, act.name);
  if (act.type === 'destroy') return cmdDestroy(s, pid, act.unit);
  if (act.type === 'mobilize') return cmdMobilize(s, pid, act.tile, act.count);
  if (act.type === 'settle') return cmdSettle(s, pid, act.tile, act.count, !!act.back);
  if (act.type === 'garrison') return cmdGarrison(s, pid, act.unit);
  if (act.type === 'births') return cmdBirths(s, pid, act.share);
  if (act.type === 'giveLand') return cmdGiveLand(s, pid, act.tile, act.other);
  if (act.type === 'road') return cmdRoad(s, pid, act.tile);
  if (act.type === 'camp') return cmdCamp(s, pid, act.unit);
  if (act.type === 'ostrog') return cmdOstrog(s, pid, act.unit);
  if (act.type === 'capital') return cmdCapital(s, pid, act.tile);
  if (act.type === 'war') return cmdWar(s, pid, act.other);
  if (act.type === 'break') return cmdBreak(s, pid, act.other);
  if (act.type === 'shut') return cmdShut(s, pid, act.other);
  if (act.type === 'ransom') return Number.isInteger(act.id) ? cmdRansom(s, pid, act.id) : 'Неверная команда';
  if (act.type === 'end') return cmdEndTurn(s, pid);
  return 'Неизвестная команда';
}

// Партию можно закончить с общего экрана в любой момент. Побеждает живое царство с наибольшей землёй,
// при равенстве то, где больше гномов.
export function endGame(s) {
  if (s.phase !== 'play') return 'Партия уже окончена';
  const land = p => s.map.tiles.filter(t => t.terr === p.id).length;
  const best = s.players.filter(p => !p.out && !p.horde).sort((a, b) => land(b) - land(a) || gnomesOf(s, b.id) - gnomesOf(s, a.id))[0];
  finish(s, best?.id ?? null, 'end');
  return null;
}

export function applyAction(s, pid, act) {
  const error = runAction(s, pid, act);
  settleRound(s);
  return error;
}

// Итоги партии: после конца они приходят всем, а общий экран открывает их и посреди партии.
// Посреди партии последняя точка графиков считается сейчас, как и таблица, а история хода не трогается.
export function results(s, live = false) {
  return {
    turns: s.turn, killed: s.stats.killed, starved: s.stats.starved, ruins: s.stats.ruins, turned: s.stats.turned,
    history: live ? [...s.history.filter(h => h.turn !== s.turn), snapshot(s)] : s.history,
    // Войско Тугарина в итогах не царство: его строки нет. Оно всегда последнее, поэтому номера царств не сдвигаются.
    players: s.players.filter(p => !p.horde).map(p => ({
      id: p.id, name: p.name, realm: p.realm, bot: p.bot, fellOn: p.fellOn,
      land: s.map.tiles.filter(t => t.terr === p.id).length,
      towns: townsOf(s, p.id).length,
      gnomes: gnomesOf(s, p.id),
      ...p.tally,
    })),
  };
}

// Пути от столицы по сети снабжения. Сначала суша: на воду груз уходит только там, куда дорогой не доехать.
// pathOf(id): клетки от столицы до id, а если дороги туда нет, null.
function routesFrom(s, pid) {
  const g = s.map, cap = s.players[pid].capital, from = new Map(), queue = [];
  if (cap != null) { from.set(cap, -1); queue.push(cap); }
  const { net, water } = supplyNet(s, pid);
  const spread = open => {
    for (let i = 0; i < queue.length; i++) {
      for (const b of neighbors(g, queue[i])) {
        if (open(b) && !from.has(b)) { from.set(b, queue[i]); queue.push(b); }
      }
    }
  };
  spread(b => net.has(b));
  spread(b => net.has(b) || water.has(b));
  const pathOf = id => {
    if (!from.has(id)) return null;
    const cells = [];
    for (let at = id; at !== -1; at = from.get(at)) cells.unshift(at);
    return cells;
  };
  return { from, pathOf };
}

// Пути снабжения: только по ним ездят тележки. Из столицы грибы идут в острога на дорогах,
// а из лагерей грибы едут в столицу. out и back: сколько штук везут туда и обратно за ход.
// Грибов не хватило: тележка всё равно едет, но пустая.
function supplyOf(s, pid) {
  const p = s.players[pid], cap = p.capital;
  if (cap == null) return [];
  const { from, pathOf } = routesFrom(s, pid);
  // Запас считается так же, как при настоящем кормлении в следующем ходу.
  const next = nextTurn(s);
  const { changes } = planFeed(next, pid, stored(next, p) + harvestOf(next, pid));
  const hungry = new Set(changes.filter(([, delta]) => delta < 0).map(([holder]) => holder));
  const food = holder => (hungry.has(holder) ? 0 : B.eatNeed(holder.gnomes));
  const routes = [];
  for (const t of townsOf(s, pid)) {
    if (t.id !== cap && from.has(t.id) && t.town.gnomes) routes.push({ realm: pid, out: food(t.town), back: t.town.type === 'ostrog' ? Math.floor(B.OSTROG_YIELD * cropRate(next)) : 0, cells: pathOf(t.id) });
  }
  for (const t of campsOf(s, pid)) {
    if (from.has(t.id)) routes.push({ realm: pid, out: 0, back: Math.floor(B.campYield(s.mods.camp) * cropRate(next)), camp: true, cells: pathOf(t.id) });
  }
  return routes;
}

// Причал стоит там, где груз сходит с суши на воду. Пока плыть некуда, он стоит у первого выхода сети к воде.
function piersOf(s, pid) {
  const g = s.map, found = new Map();
  for (const { cells } of supplyOf(s, pid)) {
    for (let i = 1; i < cells.length; i++) {
      const [a, b] = [cells[i - 1], cells[i]];
      if (isWater(g, a) !== isWater(g, b)) found.set(isWater(g, a) ? b : a, isWater(g, a) ? a : b);
    }
  }
  if (!found.size) {
    for (const id of roadNet(s, pid)) {
      const sea = neighbors(g, id).find(b => isWater(g, b));
      if (sea != null) { found.set(id, sea); break; }
    }
  }
  return [...found].map(([land, water]) => ({ realm: pid, land, water }));
}

// Легенду знают все, а её числа работают только в правилах.
const legendView = ({ id, hero, title, gift, curse, omen, omenName, lines }) => ({ id, hero, title, gift, curse, omen, omenName, lines });

// viewer — номер игрока. У общего экрана viewer равен null: из грибниц и лагерей ему видны только спорные.
export function publicState(s, viewer = null) {
  const g = s.map, me = viewer != null ? s.players[viewer] : null;
  const open = me ? [...me.known] : allPatches(s).filter(t => t.patch.disputed).map(t => t.id);
  const patches = open.filter(id => g.tiles[id].patch).map(id => {
    const { dying, camp, left = B.PATCH_STOCK } = g.tiles[id].patch;
    return [id, dying, camp?.owner ?? null, Math.max(0, left)];
  });
  const relations = [...s.rel].map(([k, v]) => [...k.split(':').map(Number), v]);
  const orders = viewer == null ? [] : s.orders.filter(o => ownUnit(s, viewer, o.unit));
  return {
    phase: s.phase, turn: s.turn, kind: B.turnKind(s.turn), winner: s.winner, you: viewer, dark: s.dark ?? null, hordeSeat: s.hordeSeat ?? null,
    weather: s.weather, nextWeather: s.nextWeather, notices: notices(s),
    legend: s.legend && legendView(s.legend), mods: s.mods,
    fallen: s.fallen, fallenTotal: s.fallen.reduce((sum, row) => sum + row.total, 0),
    players: s.players.map(p => ({
      id: p.id, name: p.name, realm: p.realm, bot: p.bot, nature: B.NATURES[p.nature]?.name ?? null, out: p.out, left: p.left, done: p.done, capital: p.capital, blight: !p.out && !p.horde && barren(s, p.id),
      ...(p.horde ? { horde: true } : {}),
      ...(viewer == null ? {} : {
        mushrooms: p.mushrooms, burns: p.burns, gnomes: gnomesOf(s, p.id),
        stock: capitalOf(s, p.id)?.gnomes || 0,
        // В сборе есть доход лагерей: чужие лагеря он выдал бы.
        ...(p.id === viewer ? { harvest: harvestOf(s, p.id), homeLeft: p.homeLeft, birthShare: p.birthShare } : {}),
        // Настрой бота к этому игроку: прибавка к шансу согласия на мир и союз, её учитывает шкала на пульте.
        ...(p.bot && p.id !== viewer && !p.out ? { lean: { ally: botLean(s, p.id, viewer, 'ally'), peace: botLean(s, p.id, viewer, 'peace') } } : {}),
      }),
    })),
    units: s.units.map(u => ({ ...u, effects: u.effects.map(e => ({ ...e })) })),
    towns: towns(s).map(t => [t.id, t.town.type, t.town.owner, viewer == null ? Math.min(t.town.gnomes, 5) : t.town.gnomes]),
    terr: g.tiles.filter(t => t.terr != null).map(t => [t.id, t.terr]),
    land: g.tiles.filter(t => t.rot || t.road || t.dug || t.blood || t.t === 'ruins').map(t => [t.id, t.t, t.rot, t.road ? 1 : 0, t.blood || 0]),
    // Закрытая для игрока земля и его пропуска: [хозяин, гость].
    shut: me ? [...shutOf(s, viewer)] : [],
    // Пленные видны тем, чьи они, и тем, у кого они сидят: номер, чьи, у кого, сколько, ходов на выкуп.
    captives: s.captives.filter(c => viewer == null || c.owner === viewer || c.by === viewer).map(c => [c.id, c.owner, c.by, c.n, c.until - s.turn]),
    passes: me ? [...s.passes].map(key => key.split('>').map(Number)).filter(pair => pair.includes(viewer)) : [],
    supply: s.players.filter(p => !p.out).flatMap(p => supplyOf(s, p.id)).flatMap(r => {
      if (r.realm === viewer) return [r];
      // Чужой лагерь не выдаём: пока его не нашли, тележка едет только до него.
      const stop = r.cells.findIndex(id => g.tiles[id].patch?.camp && !me?.known.has(id));
      const cells = stop < 0 ? r.cells : r.cells.slice(0, stop);
      return cells.length > 1 ? [{ ...r, cells }] : [];
    }),
    piers: s.players.filter(p => !p.out).flatMap(p => piersOf(s, p.id))
      .filter(p => p.realm === viewer || !g.tiles[p.land].patch?.camp || me?.known.has(p.land)),
    patches, relations,
    // Орда Тугарина на карте: клетка и сила; после конца партии итоговый сказ и титулы.
    horde: s.horde && s.horde.fallen == null ? { tile: s.horde.tile, power: s.horde.power, start: s.horde.start } : null,
    ...(s.epilogue ? { epilogue: s.epilogue } : {}),
    // Перемирия всех царств: [a, b, сколько ходов осталось]. Их видно в окне «Союзы и войны» общего экрана.
    trade: [...(s.trade || [])].map(k => k.split(':').map(Number)),
    embassies: [...(s.embassies || [])].map(k => k.split(':').map(Number)),
    pacts: [...s.truce].map(([k, end]) => [...k.split(':').map(Number), end - s.turn]).filter(r => r[2] > 0),
    ...(s.phase === 'over' ? { results: results(s) } : {}),
    heroes: [...s.heroes].map(id => [id, g.tiles[id].hero]),
    net: me ? [...roadNet(s, viewer)] : [],
    offers: viewer == null ? [] : s.offers.filter(o => o.to === viewer || o.from === viewer),
    // Перемирия: [царство, сколько ходов осталось].
    truces: me ? s.players.map(p => [p.id, truceLeft(s, viewer, p.id)]).filter(row => row[1] > 0) : [],
    // Что уже предложено в этом ходу: [царство, вид].
    asked: me ? s.players.flatMap(p => OFFER_KINDS.filter(kind => s.asked.has(askKey(viewer, p.id, kind))).map(kind => [p.id, kind])) : [],
    orders: orders.filter(o => o.target != null).map(o => [o.unit, o.target]),
    storms: orders.filter(o => o.town != null).map(o => [o.unit, o.town]),
    fires: viewer == null ? [] : s.fires.filter(f => f.from === viewer).map(f => [f.tile]),
    encounters: viewer == null ? [] : s.encounters.filter(e => e.pid === viewer).map(e => ({ ...e, chance: meetChance(s, e) })),
    ...(me ? { forecast: forecast(s, viewer), census: census(s, viewer) } : {}),
  };
}

// На клиент уходит только то, что нужно для рисования. Цену дороги и реки меняет знамение года.
// --- сохранение партии ---
// Партия пишется в JSON целиком: Map и Set как {"$map": [...]} и {"$set": [...]}.
// Генератор случая и кеш рек не пишутся: при чтении генератор получает новое зерно, а кеш строится заново.
export const saveReplacer = (key, value) => {
  if (key === 'rand' || key === 'riverSet') return undefined;
  if (value instanceof Map) return { $map: [...value] };
  if (value instanceof Set) return { $set: [...value] };
  return value;
};

export const saveReviver = (key, value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (Array.isArray(value.$map)) return new Map(value.$map);
    if (Array.isArray(value.$set)) return new Set(value.$set);
  }
  return value;
};

// Прочитанная партия снова готова к ходу: новый генератор случая, пустой журнал, место Тёмного царства.
export function restoreState(s, seed) {
  s.rand = rng32(seed);
  s.log = [];
  setDarkSeat(s.dark ?? null);
  setHordeSeat(s.hordeSeat ?? null);
  // Партия, сохранённая до нашествия Тугарина, тоже получает ход прихода орды.
  s.trade ||= new Set();
  s.embassies ||= new Set();
  for (const p of s.players) {
    p.grudges ||= {};
    if (p.bot && !p.horde && !p.nature) p.nature = natureFor(s, p.id);
  }
  if (s.hordeTurn == null) s.hordeTurn = Math.max(s.turn + 2, B.TUGARIN_TURN[0] + Math.floor(s.rand() * (B.TUGARIN_TURN[1] - B.TUGARIN_TURN[0] + 1)));
  return s;
}

export const publicMap = g => ({
  dark: g.dark ?? null,
  W: g.W, H: g.H, rivers: g.rivers, riverEdges: g.riverEdges, roadStep: g.roadStep,
  tiles: g.tiles.map(t => ({ id: t.id, t: t.t, seed: t.seed, rot: 0, road: 0 })),
});
