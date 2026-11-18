// Боты играют по тем же правилам и в том же тумане: ищут грибницы, ставят лагеря,
// ведут дороги и воюют, когда сильнее соседа. Они следят за обстановкой: просят мира, когда проигрывают,
// ищут союзников против сильного врага, вступаются за союзника и не начинают войну на пустой желудок.
import { MAX_SOLDIERS, TERRAIN, barred, dist, isWater, neighbors, stepCost } from '../public/js/hex.js';
import * as B from '../public/js/balance.js';
import {
  allied, allyAge, atWar, foodSpare, friendsOf, meetChance, offerChance, peerLand, powerOf, reachOf, relation, roadLand, roadNet, sharedAlly, shutOf, underTruce,
  warSide,
} from './game.js';

// Поиск пути от клетки: цена до всех клеток и откуда в них пришли.
// Цена до чужого поселения есть, чтобы выбрать его целью, но сквозь него пути нет: туда не войти.
function flood(s, pid, from) {
  const g = s.map, shut = shutOf(s, pid);
  const cost = new Array(g.tiles.length).fill(Infinity), back = new Array(g.tiles.length).fill(-1);
  const buckets = [[from]];
  cost[from] = 0;
  for (let c = 0; c < buckets.length; c++) {
    for (const a of buckets[c] || []) {
      if (cost[a] !== c || (a !== from && barred(g, a, pid))) continue;
      for (const b of neighbors(g, a)) {
        const step = stepCost(g, a, b, 3);
        if (step == null || (shut.has(b) && !shut.has(a))) continue;
        const next = c + Math.ceil(step);
        if (next < cost[b]) {
          cost[b] = next;
          back[b] = a;
          (buckets[next] ||= []).push(b);
        }
      }
    }
  }
  return { cost, back };
}

function stepToward(reach, path, target) {
  for (let at = target; at !== -1; at = path.back[at]) {
    if (reach.has(at)) return at;
  }
  return -1;
}

// В чужое поселение не войти: отряд идёт к ближайшей клетке рядом с ним, где ещё нет своих.
// Так войско обступает поселение со всех сторон, а не встаёт в очередь на одной дороге.
function sideOf(s, pid, path, target) {
  const taken = new Set(s.units.filter(m => m.owner === pid).map(m => m.tile));
  const free = neighbors(s.map, target).filter(id => path.cost[id] < Infinity && !taken.has(id));
  return free.sort((a, b) => path.cost[a] - path.cost[b])[0] ?? target;
}

const armyOf = (s, pid) => s.units.filter(u => u.owner === pid).reduce((sum, u) => sum + u.n, 0);

// Хватит ли грибов на трату. После неё остаётся keep и то, чего сбору следующего хода не хватит на еду,
// поэтому бот не тратит запас до голода. В грозу отложенное зальёт, и откладывать надо больше.
function canSpend(s, pid, cost, keep = 0) {
  const short = Math.max(0, -foodSpare(s, pid)), spoil = B.WEATHER[s.weather].spoil || 0;
  return s.players[pid].mushrooms - cost >= Math.max(keep, Math.ceil(short / (1 - spoil)));
}

// Союз не вечен: когда он затянулся, а бот стал сильнее союзника, бот его разрывает.
// Пока рядом есть кто-то сильнее самого бота, союз держится: одному против него не выстоять.
function considerBreak(s, pid) {
  const mine = powerOf(s, pid);
  const outside = s.players.filter(p => !p.out && p.id !== pid && !allied(s, pid, p.id));
  if (outside.some(p => powerOf(s, p.id) > mine)) return null;
  const other = friendsOf(s, pid).find(id => !s.players[id].out && allyAge(s, pid, id) > B.BOT_ALLY && mine > powerOf(s, id));
  return other == null ? null : { type: 'break', other };
}

// Когда бот последний раз предлагал что-то царству: людей он не заваливает одним и тем же каждый ход.
const asks = new WeakMap();
const askedAt = (s, key) => asks.get(s)?.get(key) ?? -Infinity;
function noteAsk(s, key) {
  if (!asks.has(s)) asks.set(s, new Map());
  asks.get(s).set(key, s.turn);
}

// Подарок к предложению: сколько не жалко, шагами по 5, не трогая запаса на еду.
function giftOf(s, pid, want) {
  for (let gift = want; gift > 0; gift -= 5) if (canSpend(s, pid, gift, B.BOT_STOCK)) return gift;
  return 0;
}

// Переговоры по обстановке. Сторона врага сильнее: бот просит мира с подарком, начиная с самого сильного врага.
// Враг или вожак сильнее самого бота: бот зовёт в союз того, кто с ним уже воюет, или самого сильного из мирных.
function considerTalks(s, pid, done) {
  const alive = s.players.filter(p => !p.out && !p.horde && p.id !== pid);
  const foes = alive.filter(p => atWar(s, pid, p.id)).sort((a, b) => powerOf(s, b.id) - powerOf(s, a.id));
  for (const e of foes) {
    const key = `peace:${e.id}`;
    if (done.has(key)) continue;
    done.add(key);
    if (warSide(s, e.id, pid) < warSide(s, pid, e.id) * B.BOT_SUE) continue;
    if (!e.bot && s.turn - askedAt(s, key) < B.BOT_ASK_GAP) continue;
    noteAsk(s, key);
    return { type: 'offer', to: e.id, kind: 'peace', give: { mushrooms: giftOf(s, pid, B.BOT_PEACE_GIFT) } };
  }
  if (done.has('ally') || friendsOf(s, pid).length >= B.BOT_ALLIES) return null;
  done.add('ally');
  const mine = powerOf(s, pid), top = Math.max(0, ...alive.map(p => powerOf(s, p.id)));
  const threat = alive.filter(p => !allied(s, pid, p.id) && powerOf(s, p.id) > mine * B.BOT_THREAT
    && (atWar(s, pid, p.id) || powerOf(s, p.id) === top)).sort((a, b) => powerOf(s, b.id) - powerOf(s, a.id))[0];
  if (!threat) return null;
  const pals = alive.filter(p => p.id !== threat.id && relation(s, pid, p.id) === 'peace' && !allied(s, p.id, threat.id))
    .sort((a, b) => Number(atWar(s, b.id, threat.id)) - Number(atWar(s, a.id, threat.id)) || powerOf(s, b.id) - powerOf(s, a.id));
  for (const c of pals) {
    const key = `ally:${c.id}`;
    if (s.turn - askedAt(s, key) < B.BOT_ASK_GAP) continue;
    noteAsk(s, key);
    return { type: 'offer', to: c.id, kind: 'ally', give: { mushrooms: giftOf(s, pid, B.BOT_ALLY_GIFT) } };
  }
  return null;
}

// Сперва ближний сосед: так война не зависит от места за столом. Когда затянулось, бот идёт и на самого слабого.
function considerWar(s, pid) {
  if (s.turn < B.BOT_PEACE) return null;
  // На пустой желудок войну не начинают.
  if (foodSpare(s, pid) < 0 && s.players[pid].mushrooms < B.BOT_STOCK) return null;
  const g = s.map, home = s.players[pid].capital, mine = powerOf(s, pid);
  const free = x => relation(s, pid, x) === 'peace' && ![x, ...friendsOf(s, x)].some(id => underTruce(s, pid, id)) && sharedAlly(s, pid, x) == null;
  // Союзник воюет: бот вступается за него, если вместе они сильнее врага.
  for (const a of friendsOf(s, pid)) {
    if (s.players[a].out) continue;
    for (const x of s.players) {
      if (x.out || x.id === pid || !atWar(s, a, x.id) || !free(x.id)) continue;
      if (mine + warSide(s, a, x.id) >= warSide(s, x.id, a) * B.BOT_EDGE && mine >= B.BOT_ARMY) return { type: 'war', other: x.id };
    }
  }
  // Сосед, который уже с кем-то воюет, занят: на него идти легче.
  const busy = id => s.players.some(o => !o.out && o.id !== id && o.id !== pid && atWar(s, id, o.id));
  const guard = id => powerOf(s, id) * (busy(id) ? 0.7 : 1);
  // Соседи на почти равном расстоянии идут по кругу стола: иначе все выбирали бы первое место.
  const far = p => (home == null || p.capital == null ? g.W + g.H : Math.round(dist(g, home, p.capital) / 3))
    + ((p.id - pid + s.players.length) % s.players.length) / 10;
  const late = s.turn >= B.BOT_PATIENCE;
  if (!late && s.players.some(p => p.id !== pid && !p.out && atWar(s, pid, p.id))) return null;
  const aims = s.players.filter(p => p.id !== pid && !p.out && free(p.id))
    .sort((a, b) => (late ? guard(a.id) - guard(b.id) : far(a) - far(b)));
  for (const p of aims) {
    // Сперва бот ждёт перевеса, а в затянувшейся партии идёт и на равного. Союзники врага встанут за него.
    const foe = guard(p.id) + friendsOf(s, p.id).filter(id => !s.players[id].out).reduce((sum, id) => sum + powerOf(s, id), 0);
    if (mine >= foe * (late ? 1 : B.BOT_EDGE) && mine >= B.BOT_ARMY) return { type: 'war', other: p.id };
  }
  return null;
}

const campedAndLinked = (s, pid, net) => s.map.tiles.some(t => t.patch?.camp?.owner === pid && net.has(t.id));

// Вода, которой касаются поселения: сеть вышла на её берег, и лодочки довезут груз сами.
// Поселение на чужой земле лодочки не подключат, так же как и дорога.
function waterOf(s, pid, tiles) {
  const g = s.map, water = new Set(), queue = [];
  const add = id => {
    if (!isWater(g, id) || water.has(id)) return;
    water.add(id);
    queue.push(id);
  };
  for (const t of tiles) {
    if (t.terr !== pid && (t.terr == null || !allied(s, t.terr, pid))) continue;
    for (const id of neighbors(g, t.id)) add(id);
  }
  for (let i = 0; i < queue.length; i++) {
    for (const id of neighbors(g, queue[i])) add(id);
  }
  return water;
}

// Клетка, где отряд может основать острог.
const ostrogSpot = (s, pid, t) => t.terr === pid && !isWater(s.map, t.id) && !t.town && !t.patch && !t.hero
  && s.map.tiles.every(o => !o.town || dist(s.map, o.id, t.id) >= B.OSTROG_GAP);

// Остаток сбора. Сначала рост упирается в гномов, и всё идёт им. Перед концом своей грибницы сбор упадёт,
// и остаток нужен в запас. Лишние гномы в столице только ждут хвори: кормить их в отрядах нечем.
function birthShare(s, pid) {
  const p = s.players[pid];
  if (p.homeLeft > 0 && p.homeLeft <= B.BOT_SAVE * B.CAPITAL_MUSHROOMS) return 0;
  if (s.turn < B.BOT_EARLY) return 1;
  return (s.map.tiles[p.capital]?.town?.gnomes ?? 0) - B.BOT_HOME > B.BOT_IDLE ? 0.25 : 0.5;
}

// Острог с лишними гномами: они едят, а для сбора хватает и немногих. В столице они бесплатны.
function thinOstrog(s, pid) {
  const home = s.players[pid].capital, g = s.map;
  const foes = s.units.filter(u => atWar(s, u.owner, pid));
  if (foes.some(u => u.tile === home)) return null;
  const net = roadNet(s, pid);
  const t = g.tiles.find(x => x.town?.owner === pid && x.town.type === 'ostrog' && x.town.gnomes > B.BOT_THIN && net.has(x.id) && !foes.some(u => u.tile === x.id));
  return t ? { type: 'settle', tile: t.id, count: t.town.gnomes - B.BOT_THIN, back: true } : null;
}

// Отряд ест каждый ход. Его кормит излишек сбора, а нехватку должен покрыть запас на несколько ходов вперёд.
function canFeed(s, pid, count) {
  const short = B.squadNeed(count) - foodSpare(s, pid);
  return short <= 0 || s.players[pid].mushrooms >= B.BOT_STOCK + short * B.BOT_AHEAD;
}

function economy(s, pid, march) {
  const g = s.map;
  const units = s.units.filter(u => u.owner === pid);
  const net = roadNet(s, pid);

  const share = birthShare(s, pid);
  if (share !== s.players[pid].birthShare) return { type: 'births', share };
  const thin = thinOstrog(s, pid);
  if (thin) return thin;

  for (const u of march ? units : []) {
    const t = g.tiles[u.tile];
    if (!t.patch || t.patch.camp || peerLand(s, pid, t) || s.orders.some(o => o.unit === u.id)) continue;
    return { type: 'camp', unit: u.id };
  }

  // Дорога к ближайшему отрезанному поселению по земле, где её можно вести. Чужие поселения она обходит.
  // Поселению на другом берегу хватит дороги к ближайшему берегу той же воды, дальше его подключат лодочки.
  const cut = g.tiles.filter(t => (t.town?.owner === pid || t.patch?.camp?.owner === pid) && !net.has(t.id));
  if (cut.length && canSpend(s, pid, B.ROAD_COST)) {
    const seen = new Map([...net].map(id => [id, -1]));
    const queue = [...net];
    const camps = campedAndLinked(s, pid, net) ? [] : cut.filter(t => t.patch?.camp);
    const aims = camps.length ? camps : cut;
    const wanted = new Set(aims.map(t => t.id)), water = waterOf(s, pid, aims);
    for (let i = 0; i < queue.length; i++) {
      const a = queue[i];
      if (wanted.has(a) || (!net.has(a) && neighbors(g, a).some(id => water.has(id)))) {
        let at = a;
        while (seen.get(at) !== -1 && !net.has(seen.get(at))) at = seen.get(at);
        const t = g.tiles[at];
        if (!t.road && !t.town && !t.patch?.camp) return { type: 'road', tile: at };
        break;
      }
      for (const b of neighbors(g, a)) {
        const t = g.tiles[b];
        if (seen.has(b) || !roadLand(s, pid, t) || (t.town && t.town.owner !== pid) || TERRAIN[t.t].cost == null || isWater(g, b)) continue;
        seen.set(b, a);
        queue.push(b);
      }
    }
  }

  // С хода расширения, когда лагерь уже есть, лишний отряд становится острогом: она кормит себя и растит новых гномов.
  if (march && s.turn >= B.BOT_EXPAND && s.players[pid].tally.built < B.BOT_BUILD && units.length > B.BOT_KEEP && canSpend(s, pid, B.OSTROG_COST) && g.tiles.some(t => t.patch?.camp?.owner === pid)) {
    const u = units.find(x => x.n >= B.OSTROG_MIN && !s.orders.some(o => o.unit === x.id) && ostrogSpot(s, pid, g.tiles[x.tile]));
    if (u) return { type: 'ostrog', unit: u.id };
  }

  // Город растёт тем быстрее, чем он больше, поэтому бот забирает только излишек, а не всех подряд.
  // Войско почти выбито: тогда идут все, кого можно собрать.
  const few = units.length < B.BOT_FEW;
  const spareOf = t => {
    if (!net.has(t.id)) return t.town.gnomes - 1;
    return t.town.gnomes - (few ? B.BOT_LAST : t.town.type === 'capital' ? B.BOT_HOME : B.BOT_OSTROG);
  };
  const enough = t => (few || !net.has(t.id) ? 3 : t.town.type === 'capital' ? MAX_SOLDIERS : B.BOT_MUSTER);
  const camp = g.tiles.find(t => t.town?.owner === pid && spareOf(t) >= enough(t) && !units.some(u => u.tile === t.id));
  if (!camp) return null;
  // Отряд ест больше гномов: его кормит излишек сбора или большой запас.
  const count = Math.min(B.BOT_SQUAD, spareOf(camp));
  return canFeed(s, pid, count) ? { type: 'mobilize', tile: camp.id, count } : null;
}

// Поселение врага: его не занять, а только разрушить приказом с соседней клетки.
function enemyTown(s, pid, tile) {
  return barred(s.map, tile, pid) && atWar(s, pid, s.map.tiles[tile].town.owner);
}

// Вражеские поселения бот видит с соседней клетки: войти в них нельзя.
const sighted = (s, p, id) => [id, ...neighbors(s.map, id)].some(n => p.seen.has(n));

// Дар Горыныча бот тратит на самую людную вражеский острог из тех, что видел.
// Дара нет: бот нанимает Змея за грибы, как и игрок, когда тот виден на карте и грибов остаётся на важное.
function burnAim(s, pid) {
  const p = s.players[pid];
  const hire = canSpend(s, pid, B.FIRE_COST, B.BOT_FIRE_KEEP) && [...s.heroes].some(id => s.map.tiles[id].hero === 'gorynych');
  if (!p.burns && !hire) return null;
  const aims = s.map.tiles.filter(t => t.town?.type === 'ostrog' && t.town.gnomes > 0 && sighted(s, p, t.id)
    && enemyTown(s, pid, t.id) && !s.fires.some(f => f.from === pid && f.tile === t.id));
  return aims.sort((a, b) => b.town.gnomes - a.town.gnomes)[0] ?? null;
}

// Что важнее всего для отряда: найденная грибница, острог, враг или разведка.
function chooseTarget(s, pid, path, claimed, u) {
  const g = s.map, p = s.players[pid];
  const friends = friendsOf(s, pid);
  // Войско идёт на врага всем числом, поэтому такие цели отряды не делят между собой.
  // Пока лагерей мало, самый маленький отряд ищет грибницы и на войну не идёт.
  const short = g.tiles.filter(t => t.patch?.camp?.owner === pid).length < B.BOT_CAMPS;
  const settler = short && s.units.filter(x => x.owner === pid).sort((a, b) => a.n - b.n)[0] === u;
  const fighter = u.n >= B.BOT_STORM && !settler;
  const weak = s.players.filter(x => !x.out && atWar(s, pid, x.id)).sort((a, b) => armyOf(s, a.id) - armyOf(s, b.id))[0]?.id;
  // Новый острог берём, только если сможем его кормить и подвести дорогу.
  const spare = canSpend(s, pid, 0, 6) ? foodSpare(s, pid) : 0;
  const home = p.capital;
  let top = -1, topScore = Infinity;
  const rate = (id, bonus, shared = false, apart = false) => {
    if ((!shared && claimed.has(id)) || path.cost[id] === Infinity) return;
    const score = path.cost[id] - bonus;
    if (score >= topScore) return;
    // Разведчики расходятся в стороны, а не идут к одной опушке.
    if (apart && [...claimed].some(id2 => dist(g, id2, id) <= B.BOT_APART)) return;
    top = id;
    topScore = score;
  };
  for (const t of g.tiles) {
    if (t.town && t.town.owner !== pid) {
      const o = t.town.owner;
      if (o == null) { if (spare > 0) rate(t.id, 6); }
      else if (atWar(s, pid, o) && fighter) rate(t.id, B.BOT_ASSAULT + (t.town.type === 'capital' ? 6 : 0) + (o === weak ? 10 : 0), true);
    }
    if (t.patch && p.known.has(t.id)) {
      const c = t.patch.camp;
      // Спорную грибницу видят все: за неё надо успеть первым.
      if (!c || c.owner == null) { if (!peerLand(s, pid, t)) rate(t.id, (short ? B.BOT_ASSAULT + 20 : 16) + (t.patch.disputed ? 8 : 0)); }
      else if (c.owner !== pid && atWar(s, pid, c.owner)) rate(t.id, 12);
    }
    // Грибницы лежат далеко от столицы, поэтому разведка сразу идёт вдаль.
    if (!p.seen.has(t.id) && !isWater(g, t.id) && !friends.includes(t.terr) && !barred(g, t.id, pid)) rate(t.id, home == null ? 0 : Math.min(B.BOT_FAR, dist(g, home, t.id)) * 2, false, true);
  }
  // Остатки разбитых отрядов идут к своим и вливаются в них.
  if (!fighter && !settler) {
    for (const m of s.units) if (m.owner === pid && m !== u && m.n < MAX_SOLDIERS) rate(m.tile, 14, true);
  }
  // Пришла орда Тугарина: кто её разобьёт, тот победит. Боевые отряды идут к ней все вместе.
  if (fighter && s.horde && s.horde.fallen == null) rate(s.horde.tile, B.BOT_ASSAULT + 15, true);
  // Царство падает, только когда не осталось ни поселений, ни отрядов: уцелевших надо догнать.
  if (fighter) {
    for (const e of s.units) {
      if (e.owner !== pid && atWar(s, pid, e.owner) && !g.tiles.some(t => t.town?.owner === e.owner)) rate(e.tile, B.BOT_ASSAULT, true);
    }
  }
  return top;
}

// На столицу войско идёт волной: отряды сходятся на подступах, пока рядом не наберётся сила.
// Раз в несколько ходов подступы отпускают и малую волну: на перевале иначе стояли бы вечно.
// В столицу не войти: ближе соседней клетки не подойти, и кто дошёл до неё, бьёт без ожидания.
// При BOT_STAGE = 0 волну никто не ждёт: на соседней клетке ожидание только даёт столице отрасти.
function holdsBack(s, pid, u, target) {
  const g = s.map, town = g.tiles[target].town;
  if (town?.type !== 'capital' || !enemyTown(s, pid, target) || u.n < B.BOT_STORM) return false;
  const togo = dist(g, u.tile, target);
  if (togo > B.BOT_STAGE || togo < Math.max(2, B.BOT_STAGE - 1) || s.turn % B.BOT_PULSE === 1) return false;
  const near = s.units.filter(m => m.owner === pid && m.n >= B.BOT_STORM && dist(g, m.tile, u.tile) <= B.BOT_RALLY);
  return near.reduce((sum, m) => sum + m.n, 0) < B.BOT_WAVE;
}

// Следующее действие бота или null, если все отряды закончили.
// Встреча с существом решается первой: при хорошем шансе бот сражается,
// иначе принимает беду.
// Войско Тугарина: каждая сотня бьёт соседний вражеский отряд, штурмует соседнее поселение
// или идёт к ближайшему поселению царств. Ничего не строит и не договаривается.
function hordeAction(s, pid, done) {
  const g = s.map;
  for (const u of s.units.filter(x => x.owner === pid && x.mp > 0 && !done.has(x.id))) {
    done.add(u.id);
    if (s.orders.some(o => o.unit === u.id)) continue;
    const prey = s.units.filter(e => e.owner !== pid && atWar(s, pid, e.owner) && (e.tile === u.tile || neighbors(g, u.tile).includes(e.tile)))
      .sort((a, b) => a.n - b.n)[0];
    if (prey) return enemyTown(s, pid, prey.tile) ? { type: 'storm', unit: u.id, tile: prey.tile } : { type: 'attack', unit: u.id, target: prey.id };
    const wall = neighbors(g, u.tile).find(id => enemyTown(s, pid, id));
    if (wall != null) return { type: 'storm', unit: u.id, tile: wall };
    const path = flood(s, pid, u.tile), reach = reachOf(s, u);
    const aim = g.tiles.filter(t => t.town?.owner != null && t.town.owner !== pid && path.cost[t.id] < Infinity)
      .sort((a, b) => path.cost[a.id] - path.cost[b.id])[0];
    if (!aim) continue;
    const spot = stepToward(reach, path, sideOf(s, pid, path, aim.id));
    if (spot >= 0 && spot !== u.tile) return { type: 'move', unit: u.id, tile: spot };
  }
  return null;
}

export function botAction(s, pid, done) {
  if (s.players[pid].horde) return hordeAction(s, pid, done);
  const meet = s.encounters.find(e => e.pid === pid);
  // С ордой Тугарина бот бьётся всегда: только так её можно разбить, а беда всё равно бьёт по отряду.
  if (meet) return { type: 'encounter', id: meet.id, fight: meet.hero === 'tugarin' || meetChance(s, meet) >= B.BOT_FIGHT };
  const g = s.map, march = B.turnKind(s.turn) === 'march';
  const talk = considerTalks(s, pid, done);
  if (talk) return talk;
  const quit = considerBreak(s, pid);
  if (quit) return quit;
  const war = done.has('war') ? null : considerWar(s, pid);
  done.add('war');
  if (war) return war;

  // Своих пленных бот выкупает, когда грибов хватает и на еду.
  const ransom = s.players[pid].capital != null && s.captives.find(c => c.owner === pid && canSpend(s, pid, c.n * B.RANSOM_PRICE));
  if (ransom) return { type: 'ransom', id: ransom.id };

  const burn = march ? burnAim(s, pid) : null;
  if (burn) return { type: 'fire', tile: burn.id };

  const spend = economy(s, pid, march);
  if (spend) return spend;
  if (!march) return null;

  const squads = s.units.filter(u => u.owner === pid && u.mp > 0 && !done.has(u.id));
  if (!squads.length) return null;
  const claimed = done.claimed ||= new Set();
  const homes = g.tiles.filter(t => t.town?.owner === pid);
  const guarded = id => homes.some(t => dist(g, t.id, id) <= B.BOT_GUARD);

  for (const u of squads) {
    const reach = reachOf(s, u);
    // В поле войско за врагом не гоняется: оно идёт на поселения. Бой на ходу только у своих стен,
    // со стражей поселения и с теми, кому уже негде жить.
    const prey = s.units
      .filter(e => e.owner !== pid && atWar(s, pid, e.owner))
      .filter(e => e.tile === u.tile || (neighbors(g, e.tile).some(id => id === u.tile || reach.has(id))
        && (guarded(e.tile) || g.tiles[e.tile].town || !g.tiles.some(t => t.town?.owner === e.owner))))
      .filter(e => u.n >= e.n * 0.75)
      .sort((a, b) => a.n - b.n)[0];
    done.add(u.id);
    // Дружину в поселении бьют штурмом: остаток удара падает на гномов.
    if (prey) return enemyTown(s, pid, prey.tile) ? { type: 'storm', unit: u.id, tile: prey.tile } : { type: 'attack', unit: u.id, target: prey.id };
    if (u.n < B.BOT_STORM) {
      const mate = s.units.find(m => m.owner === pid && m !== u && m.n < MAX_SOLDIERS && neighbors(g, u.tile).includes(m.tile));
      if (mate && !s.orders.some(o => o.unit === u.id)) return { type: 'merge', unit: u.id, target: mate.id };
    }

    // До хода расширения войско копится дома: только выходит из поселения, иначе столица не соберёт следующий отряд.
    if (s.turn < B.BOT_EXPAND) {
      const out = g.tiles[u.tile].town ? [...reach.keys()].filter(id => !g.tiles[id].town && g.tiles[id].terr === pid).sort((a, b) => dist(g, a, u.tile) - dist(g, b, u.tile))[0] : null;
      if (out != null) return { type: 'move', unit: u.id, tile: out };
      continue;
    }

    // Перед грозой отряд укрывается в своём поселении, если успевает дойти.
    if (B.WEATHER[s.nextWeather].dark && g.tiles[u.tile].town?.owner !== pid) {
      const shelter = [...reach.keys()].filter(id => g.tiles[id].town?.owner === pid).sort((a, b) => dist(g, a, u.tile) - dist(g, b, u.tile))[0];
      if (shelter != null) return { type: 'move', unit: u.id, tile: shelter };
    }

    const path = flood(s, pid, u.tile);
    const target = chooseTarget(s, pid, path, claimed, u);
    if (target < 0 || holdsBack(s, pid, u, target)) continue;
    claimed.add(target);
    // Отряд уже рядом с целью: бьёт поселение, а дружина внутри принимает удар первой.
    if (enemyTown(s, pid, target) && neighbors(g, target).includes(u.tile)) return { type: 'storm', unit: u.id, tile: target };
    const aim = barred(g, target, pid) ? sideOf(s, pid, path, target) : target;
    const spot = stepToward(reach, path, aim);
    if (spot >= 0 && spot !== u.tile) return { type: 'move', unit: u.id, tile: spot };

    // Дорога перекрыта: на перевале очередь стояла бы вечно. Первый бьёт того, кто мешает, остальные вливаются в него.
    const block = s.units.filter(e => e.owner !== pid && atWar(s, pid, e.owner) && neighbors(g, e.tile).includes(u.tile))
      .sort((a, b) => a.n - b.n)[0];
    if (block && u.n >= block.n * 0.75) return { type: 'attack', unit: u.id, target: block.id };
    let next = aim;
    while (path.back[next] !== u.tile && path.back[next] !== -1) next = path.back[next];
    const mate = s.units.find(m => m.owner === pid && m !== u && m.tile === next && m.n < MAX_SOLDIERS);
    if (mate) return { type: 'merge', unit: u.id, target: mate.id };
  }
  return null;
}

// Бот отвечает случайно с тем же шансом, который игрок видит на шкале.
export const botAccepts = (s, offer) => s.rand() < offerChance(s, offer);
