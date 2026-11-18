// Геометрия гексов и правила перемещения. Один файл и для сервера, и для браузера.

export const R = 60;                    // радиус гекса в мировых пикселях
export const SQUASH = 0.82;             // наклон земли: гекс чуть сплющен по вертикали
export const HEX_W = Math.sqrt(3) * R;
export const ROW_H = 1.5 * R * SQUASH;
export const MAX_SOLDIERS = 10;         // отряд целиком помещается в лодку на 10 человек
export const MOVES = 3;
export const ROAD_STEP = 0.5;           // шаг по дороге, в очках хода
export const RIVER_STEP = 1;            // доплата за переправу через реку
export const SEA_STEP = 0.75;           // шаг лодки: за обычный ход она проходит четыре клетки

export const TERRAIN = {
  sea:      { name: 'Море',    cost: 1 },
  field:    { name: 'Поле',    cost: 1 },
  desert:   { name: 'Пустыня', cost: 1 },
  ruins:    { name: 'Руины',   cost: 1 },
  forest:   { name: 'Лес',     cost: 1.5 },   // было 2: за ход две клетки леса вместо одной, по полю три
  swamp:    { name: 'Болото',  cost: 2 },
  mountain: { name: 'Горы',    cost: null },
  lake:     { name: 'Озеро',   cost: 1 },
};

// Куда превращается земля при деградации.
export const LAND_NEXT = { forest: 'swamp', field: 'desert', lake: 'swamp', swamp: 'desert' };

export const FACTIONS = [
  { id: 'red',    name: 'Тридесятое царство' },
  { id: 'yellow', name: 'Солнечное царство' },
  { id: 'blue',   name: 'Морское царство' },
  { id: 'teal',   name: 'Лукоморье' },
  { id: 'green',  name: 'Лесное царство' },
  { id: 'copper', name: 'Медное царство' },
  { id: 'snow',   name: 'Снежное царство' },
];

// Тёмное царство: им играет первый бот партии. Оно занимает место бота, но имя, цвет и знамя у него свои.
// Место тёмного царства задаёт партия: сервер при начале, пульт и экран по карте и состоянию.
export const DARK = { id: 'dark', name: 'Тёмное царство' };
let darkSeat = null;
export const setDarkSeat = pid => { darkSeat = pid ?? null; };
// Войско Тугарина приходит в конце партии отдельной стороной и садится на следующее после царств место.
export const HORDE = { id: 'horde', name: 'Войско Тугарина' };
let hordeSeat = null;
export const setHordeSeat = pid => { hordeSeat = pid ?? null; };
export const factionOf = pid => (pid != null && pid === hordeSeat ? HORDE : pid != null && pid === darkSeat ? DARK : FACTIONS[pid]);

const DIRS_EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
const DIRS_ODD  = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];

export const center = (g, id) => {
  const c = id % g.W, r = Math.floor(id / g.W);
  return { x: (c + (r & 1) / 2 + 0.5) * HEX_W, y: R * SQUASH + r * ROW_H };
};

export const worldSize = g => ({
  w: (g.W + 0.5) * HEX_W,
  h: (g.H - 1) * ROW_H + 2 * R * SQUASH,
});

export function neighbors(g, id) {
  const c = id % g.W, r = Math.floor(id / g.W);
  const out = [];
  for (const [dc, dr] of (r & 1 ? DIRS_ODD : DIRS_EVEN)) {
    const nc = c + dc, nr = r + dr;
    if (nc >= 0 && nc < g.W && nr >= 0 && nr < g.H) out.push(nr * g.W + nc);
  }
  return out;
}

export function corners(x, y, scale = 1) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 3;
    pts.push({ x: x + Math.cos(a) * R * scale, y: y + Math.sin(a) * R * SQUASH * scale });
  }
  return pts;
}

export function tileAt(g, wx, wy) {
  const px = wx - HEX_W / 2, py = (wy - R * SQUASH) / SQUASH;
  const q = (Math.sqrt(3) / 3 * px - py / 3) / R, s = (2 / 3 * py) / R;
  let rx = Math.round(q), rz = Math.round(s), ry = Math.round(-q - s);
  const dx = Math.abs(rx - q), dz = Math.abs(rz - s), dy = Math.abs(ry + q + s);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dz > dy) rz = -rx - ry;
  const row = rz, col = rx + (rz - (rz & 1)) / 2;
  if (col < 0 || col >= g.W || row < 0 || row >= g.H) return -1;
  return row * g.W + col;
}

const cube = (g, id) => {
  const c = id % g.W, r = Math.floor(id / g.W);
  const x = c - (r - (r & 1)) / 2;
  return [x, r, -x - r];
};

export function dist(g, a, b) {
  const p = cube(g, a), q = cube(g, b);
  return Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));
}

export const edgeKey = (a, b) => (a < b ? a * 100000 + b : b * 100000 + a);

function riverSet(g) {
  if (!g.riverSet) g.riverSet = new Set(g.riverEdges.map(([a, b]) => edgeKey(a, b)));
  return g.riverSet;
}

export const isWater = (g, id) => g.tiles[id].t === 'sea' || g.tiles[id].t === 'lake';

const paved = t => t.road || t.town;

// Цена шага: река доплачивается. Посадка в лодку и высадка на берег тратят весь оставшийся ход,
// а по воде лодка идёт быстрее пешего.
// По дороге войска идут вдвое быстрее обычного, а отряд с лесными тропами проходит лес и болото
// за одно очко. С прямыми тропами любой шаг не дороже одного очка. Знамение года меняет цену
// дороги и реки: они приходят с картой (g.roadStep).
export function stepCost(g, from, to, left = MOVES, trail = false, straight = false) {
  const kind = g.tiles[to].t;
  let cost = TERRAIN[kind].cost;
  if (cost == null) return null;
  if (isWater(g, from) !== isWater(g, to)) return left;
  if (isWater(g, to)) return SEA_STEP;
  if (paved(g.tiles[from]) && paved(g.tiles[to])) return g.roadStep ?? ROAD_STEP;
  if (trail && (kind === 'forest' || kind === 'swamp')) cost = 1;
  if (riverSet(g).has(edgeKey(from, to))) cost += RIVER_STEP;
  return straight ? Math.min(cost, 1) : cost;
}

const hasEffect = (u, key) => (u.effects || []).some(e => e.key === key);

// Поселение чужого царства закрыто для всех: и для союзника, и на войне. Ничейную острог занимают входом.
export const barred = (g, id, owner) => {
  const { town } = g.tiles[id];
  return !!town && town.owner != null && town.owner !== owner;
};

// Растекание хода: враги преграждают путь, свои и мирные войска пропускают.
// shut: закрытая чужая земля, Set клеток. Войти туда нельзя, а кто уже стоит на ней, может выйти.
function spread(g, units, u, foes, shut) {
  const enemy = new Set(units.filter(x => foes.includes(x.owner) && x.tile !== u.tile).map(x => x.tile));
  const best = new Map([[u.tile, { left: u.mp, from: -1 }]]);
  const open = [u.tile];
  const trail = hasEffect(u, 'trail'), straight = hasEffect(u, 'straight') || u.fresh, inside = shut?.has(u.tile);
  while (open.length) {
    const a = open.shift();
    const left = best.get(a).left;
    // В своё или ничейное поселение входят и останавливаются, сквозь него не ходят.
    // Кто уже стоит в чужом, покидает его обычным ходом.
    if (left <= 0 || (a !== u.tile && g.tiles[a].town)) continue;
    for (const b of neighbors(g, a)) {
      if (enemy.has(b) || barred(g, b, u.owner) || (shut?.has(b) && !inside)) continue;
      const cost = stepCost(g, a, b, left, trail, straight);
      if (cost == null || cost > left) continue;
      const rest = left - cost;
      const known = best.get(b);
      if (known && known.left >= rest) continue;
      best.set(b, { left: rest, from: a });
      open.push(b);
    }
  }
  return best;
}

// Все клетки, где отряд может закончить ход: Map(tile → {left, from}).
// На клетке со своим отрядом встать нельзя, с мирным чужим можно.
// join: на свой неполный отряд встать можно, тогда отряды сольются.
export function reachable(g, units, u, foes = [], join = false, shut = null) {
  const best = spread(g, units, u, foes, shut);
  best.delete(u.tile);
  for (const x of units) if (x.owner === u.owner && !(join && x.n < MAX_SOLDIERS)) best.delete(x.tile);
  return best;
}

export function pathTo(g, units, u, target, foes = [], shut = null) {
  const best = spread(g, units, u, foes, shut);
  if (!best.has(target)) return null;
  const path = [];
  for (let at = target; at !== -1; at = best.get(at).from) path.unshift(at);
  return { path, left: best.get(target).left };
}
