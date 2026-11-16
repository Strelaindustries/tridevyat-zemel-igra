// Генерация карты: один материк в море, ничьи гавани между царствами, заливы, мысы и острова,
// хребты с перевалами, долины в развилках хребтов, озёра с одним стоком, лес вдоль рек и подножий,
// равные условия у столиц, скрытые грибницы и логова сказочных героев.
import { HEX_W, TERRAIN, center, corners, dist, neighbors, tileAt } from '../public/js/hex.js';
import { HOME_RADIUS, PATCH_FLOOR, START } from '../public/js/balance.js';

// Карта подогнана под экран 16:9 с полосой внизу: ширина к высоте около 1,89.
const SIZES = { 2: [28, 21], 3: [32, 24], 4: [35, 26], 5: [39, 29], 6: [39, 29], 7: [42, 31] }; // на шестерых как на пятерых; семь столиц на 39×29 не встают
const TAU = Math.PI * 2;
const HARBOR_LENGTH = 6;                // залив не короче стольких клеток от бухты до моря
const HARBOR_AWAY = 7;                  // гавань ничья: ближе стольких клеток к столице её не ставят
const HARBOR_APART = 9;                 // две гавани не ближе стольких клеток друг к другу
const HARBOR_FAIR = 5;                  // пешком от столиц до ближайшей гавани разница не больше стольких клеток
const HARBOR_DEPTH = 4;                 // от бухты до открытой воды плыть не меньше стольких клеток
const MAX_ISLE = 12;                    // отрезанный заливом кусок больше этого портит карту
const ISLE_NECK = 3;                    // коса до острова не длиннее стольких клеток
const CAPITAL_DEPTH = 5;                // столица стоит не ближе стольких клеток от берега
const DARK_ROWS = 3;                    // в стольких рядах у верхнего и нижнего края высокий рисунок уходит в темноту

export function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(rand) {
  const N = 64;
  const v = Array.from({ length: N * N }, () => rand());
  const smooth = t => t * t * (3 - 2 * t);
  const cell = (i, j) => v[((i % N) + N) % N + (((j % N) + N) % N) * N];
  const at = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = smooth(x - xi), fy = smooth(y - yi);
    const top = cell(xi, yi) * (1 - fx) + cell(xi + 1, yi) * fx;
    const bottom = cell(xi, yi + 1) * (1 - fx) + cell(xi + 1, yi + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
  return (x, y) => at(x, y) * 0.6 + at(x * 2.1 + 7, y * 2.1 + 3) * 0.3 + at(x * 4.3 + 1, y * 4.3 + 9) * 0.1;
}

function shuffle(list, rand) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

const passable = t => t.t !== 'sea' && t.t !== 'lake' && TERRAIN[t.t].cost != null;

// Расстояние по суше в клетках от одной или нескольких точек.
function flood(g, sources, can = passable) {
  const d = new Array(g.tiles.length).fill(Infinity);
  const queue = [...sources];
  for (const s of sources) d[s] = 0;
  for (let i = 0; i < queue.length; i++) {
    for (const b of neighbors(g, queue[i])) {
      if (d[b] === Infinity && can(g.tiles[b])) {
        d[b] = d[queue[i]] + 1;
        queue.push(b);
      }
    }
  }
  return d;
}

function components(g, can) {
  const seen = new Set(), list = [];
  for (const t of g.tiles) {
    if (seen.has(t.id) || !can(t)) continue;
    const part = [t.id];
    seen.add(t.id);
    for (let i = 0; i < part.length; i++) {
      for (const b of neighbors(g, part[i])) {
        if (!seen.has(b) && can(g.tiles[b])) { seen.add(b); part.push(b); }
      }
    }
    list.push(part);
  }
  return list.sort((a, b) => b.length - a.length);
}

function disc(g, id, radius) {
  return g.tiles.filter(t => dist(g, t.id, id) <= radius);
}

// Прорубает проход сквозь горы и озёра от отрезанной долины к основной суше.
function carve(g, from, targets) {
  const goal = new Set(targets);
  const back = new Map(from.map(id => [id, -1]));
  const queue = [...from];
  for (let i = 0; i < queue.length; i++) {
    const a = queue[i];
    if (goal.has(a)) {
      for (let at = a; at !== -1; at = back.get(at)) {
        if (!passable(g.tiles[at])) g.tiles[at].t = 'field';
      }
      return true;
    }
    for (const b of neighbors(g, a)) {
      if (!back.has(b) && g.tiles[b].t !== 'sea') { back.set(b, a); queue.push(b); }
    }
  }
  return false;
}

function connectLand(g, can) {
  for (;;) {
    const parts = components(g, can);
    if (parts.length <= 1) return;
    const [main, ...rest] = parts;
    const part = rest[0];
    if (part.length < 4) {
      for (const id of part) g.tiles[id].t = 'mountain';
    } else if (!carve(g, part, main)) return;
  }
}

// Равные дуги эллипса: на широкой карте столицы не сбиваются к длинным сторонам и стоят на равных.
// На двоих царства всегда смотрят друг на друга через широкую сторону карты.
function ring(a, b, count, start) {
  const pts = [];
  let length = 0;
  for (let i = 0; i < 360; i++) {
    const t = (i / 360) * TAU;
    pts.push({ x: Math.cos(t) * a, y: Math.sin(t) * b, at: length });
    length += Math.hypot(Math.sin(t) * a, Math.cos(t) * b) * (TAU / 360);
  }
  return Array.from({ length: count }, (_, i) => {
    const at = (((start + i / count) % 1) + 1) % 1 * length;
    return pts.find(p => p.at >= at) || pts[0];
  });
}

// Гавани ничьи: каждая лежит между двумя царствами, и от любой столицы до ближайшей примерно одинаково далеко.
function chooseHarbors(g, depth, count, rand) {
  const spots = g.tiles.filter(t => depth[t.id] >= HARBOR_DEPTH && t.r >= DARK_ROWS && t.r < g.H - DARK_ROWS
    && g.capitals.every(c => dist(g, c, t.id) >= HARBOR_AWAY)).map(t => t.id);
  if (spots.length < count) return null;
  const away = new Map(spots.map(id => [id, g.capitals.map(c => dist(g, c, id))]));
  let best = null, bestScore = Infinity;
  for (let trial = 0; trial < 400; trial++) {
    const set = [];
    for (let i = 0; i < count * 3 && set.length < count; i++) {
      const id = spots[Math.floor(rand() * spots.length)];
      if (set.every(o => dist(g, o, id) >= HARBOR_APART)) set.push(id);
    }
    if (set.length < count) continue;
    const near = g.capitals.map((_, i) => Math.min(...set.map(id => away.get(id)[i])));
    const contest = set.reduce((sum, id) => {
      const [a, b] = [...away.get(id)].sort((x, y) => x - y);
      return sum + (b - a);
    }, 0);
    const score = (Math.max(...near) - Math.min(...near)) * 2 + contest + Math.max(...near) * 0.2;
    if (score < bestScore) { best = set; bestScore = score; }
  }
  return best;
}

// Гавань: извилистый залив от моря вглубь суши. Вход широкий, горло узкое, в конце круглая бухта.
function digHarbor(g, head, guard, rand, bays, depth) {
  const cost = new Map([[head, 0]]), steps = new Map([[head, 0]]);
  const back = new Map([[head, -1]]), queue = [head];
  let mouth = -1;
  while (queue.length && mouth < 0) {
    queue.sort((a, b) => cost.get(a) - cost.get(b));
    const a = queue.shift();
    if (g.tiles[a].t === 'sea') {
      if (steps.get(a) >= HARBOR_LENGTH) mouth = a;
      continue;
    }
    for (const b of neighbors(g, a)) {
      const next = cost.get(a) + 1 + rand() * 1.6 + (depth[b] <= 1 ? 1 : 0);   // вдоль самого берега залив не идёт
      if (guard.has(b) || (cost.has(b) && cost.get(b) <= next)) continue;
      cost.set(b, next);
      steps.set(b, steps.get(a) + 1);
      back.set(b, a);
      if (!queue.includes(b)) queue.push(b);
    }
  }
  if (mouth < 0) return false;
  const path = [];
  for (let at = back.get(mouth); at !== -1; at = back.get(at)) path.push(at);
  const water = new Set(path);
  path.forEach((id, i) => {
    const ends = i < path.length * 0.4 ? 2 : 0;
    for (const n of shuffle(neighbors(g, id), rand).slice(0, ends)) water.add(n);
  });
  for (const n of neighbors(g, path[path.length - 1])) if (rand() < 0.7) water.add(n);
  for (const id of water) {
    if (guard.has(id)) continue;
    g.tiles[id].t = 'sea';
    bays.add(id);
  }
  return true;
}

// Берег: заливы врезаются в сушу, мысы уходят в море, поодаль лежат острова без гор.
// Возвращает клетки островов или null, если берег не сложился.
function shapeCoast(g, rand, keep, players, bays) {
  const mid = center(g, Math.floor(g.H / 2) * g.W + Math.floor(g.W / 2));
  const rim = id => {
    const t = g.tiles[id];
    return Math.min(t.c, g.W - 1 - t.c, t.r, g.H - 1 - t.r);
  };
  const shore = want => shuffle(g.tiles.filter(t => want(t) && neighbors(g, t.id).some(n => (g.tiles[n].t === 'sea') !== (t.t === 'sea'))), rand);
  const away = id => { const c = center(g, id); return Math.atan2(c.y - mid.y, c.x - mid.x); };
  const spin = () => (rand() - 0.5) * 1.3, curl = () => (rand() - 0.5) * 0.3;

  let inlets = 1 + Math.floor(players / 2);
  for (const t of shore(x => x.t !== 'sea')) {
    if (inlets <= 0) break;
    const land = id => g.tiles[id].t !== 'sea' && !keep.has(id) && !neighbors(g, id).some(n => bays.has(n));
    const cut = walkRidge(g, t.id, away(t.id) + Math.PI + spin(), 3 + Math.floor(rand() * 4), curl(), 0.8, rand, land);
    if (cut.length < 3) continue;
    cut.slice(0, 2).forEach(id => { const n = neighbors(g, id).find(land); if (n != null) g.tiles[n].t = 'sea'; });
    for (const id of cut) g.tiles[id].t = 'sea';
    inlets--;
  }

  let capes = 2 + players;
  for (const t of shore(x => x.t === 'sea')) {
    if (capes <= 0) break;
    const near = neighbors(g, t.id).find(n => g.tiles[n].t !== 'sea');
    const sea = id => g.tiles[id].t === 'sea' && rim(id) >= 2 && !bays.has(id) && !neighbors(g, id).some(n => bays.has(n));
    if (near == null || !sea(t.id)) continue;
    const arm = walkRidge(g, t.id, away(t.id) + spin() * 0.7, 3 + Math.floor(rand() * 3), curl(), 0.8, rand, sea);
    if (arm.length < 3) continue;
    for (const id of arm) g.tiles[id].t = 'field';
    for (const n of neighbors(g, arm[arm.length - 1])) if (sea(n) && rand() < 0.6) g.tiles[n].t = 'field';
    capes--;
  }

  // Запертая мысом вода становится сушей. Гавань запирать нельзя.
  for (const part of components(g, x => x.t === 'sea').slice(1)) {
    if (part.some(id => bays.has(id))) return false;
    for (const id of part) g.tiles[id].t = 'field';
  }

  // То, что заливы отрезали от материка, становится островом, мелочь уходит под воду.
  const isles = new Set(), parts = components(g, t => t.t !== 'sea');
  if (g.capitals.some(id => !parts[0].includes(id))) return null;
  for (const part of parts.slice(1)) {
    if (part.length > MAX_ISLE) return null;
    for (const id of part) {
      if (part.length < 3) g.tiles[id].t = 'sea';
      else isles.add(id);
    }
  }

  // Остальные острова лежат в стороне от берега: с двух сторон косы к ним подходят проливы.
  const offshore = flood(g, g.tiles.filter(t => t.t !== 'sea').map(t => t.id), () => true);
  const roomy = id => offshore[id] >= 2 && rim(id) >= 1;
  let count = 2 + Math.floor(players / 2);
  for (const t of shuffle(g.tiles.filter(x => roomy(x.id)), rand)) {
    if (count <= 0) break;
    if (!roomy(t.id)) continue;
    const isle = [t.id], size = 3 + Math.floor(rand() * 5);
    for (let i = 0; i < isle.length && isle.length < size; i++) {
      for (const n of shuffle(neighbors(g, isle[i]), rand)) {
        if (isle.length < size && roomy(n) && !isle.includes(n)) isle.push(n);
      }
    }
    if (isle.length < 3) continue;
    for (const id of isle) {
      g.tiles[id].t = 'field';
      isles.add(id);
    }
    for (const c of g.tiles) if (isle.some(id => dist(g, id, c.id) <= 2)) offshore[c.id] = 0;
    count--;
  }
  return components(g, x => x.t === 'sea').length === 1 ? isles : null;
}

// Если хребет заставляет идти в долгий обход, в нём открывается перевал.
function openPasses(g, rand) {
  const mountains = shuffle(g.tiles.filter(t => t.t === 'mountain'), rand);
  let opened = 0;
  for (const m of mountains) {
    if (opened >= 8) break;
    const sides = neighbors(g, m.id).filter(id => passable(g.tiles[id]));
    if (sides.length < 2) continue;
    const d = flood(g, [sides[0]]);
    if (!sides.some(id => d[id] >= 18)) continue;
    m.t = 'field';
    opened++;
  }
}

// Хребет это одна линия гребня: она плавно заворачивает, но не дальше limit, поэтому в кольцо не сходится.
function walkRidge(g, start, heading, length, bend, limit, rand, allowed) {
  const cells = [];
  let { x, y } = center(g, start), a = heading;
  for (let i = 0; i < length * 3 && cells.length < length; i++) {
    const id = tileAt(g, x, y);
    if (id < 0 || !allowed(id)) break;
    if (!cells.includes(id)) cells.push(id);
    if (Math.abs(a - heading) < limit) a += bend;
    a += (rand() - 0.5) * 0.4;
    x += Math.cos(a) * HEX_W * 0.62;
    y += Math.sin(a) * HEX_W * 0.62;
  }
  return cells;
}

// Поднимает гряду: посередине она толще, к концам сходит на нет, сбоку отходят отроги, в гребне есть перевалы.
function raiseRidge(g, spine, rand, allowed) {
  const placed = new Set(spine), wide = new Map();
  const side = rand() < 0.5 ? 1 : 2;
  spine.forEach((id, i) => {
    const middle = i / (spine.length - 1 || 1);
    if (middle < 0.22 || middle > 0.78 || rand() > 0.62) return;
    const next = neighbors(g, id).filter(n => allowed(n) && !placed.has(n));
    if (!next.length) return;
    const extra = next[side % next.length];
    placed.add(extra);
    wide.set(i, extra);
  });
  for (let k = 0, spurs = Math.floor(spine.length / 5); k < spurs; k++) {
    const i = 2 + Math.floor(rand() * Math.max(1, spine.length - 4));
    const from = center(g, spine[i - 1]), to = center(g, spine[Math.min(spine.length - 1, i + 1)]);
    const along = Math.atan2(to.y - from.y, to.x - from.x);
    const spur = walkRidge(g, spine[i], along + (rand() < 0.5 ? 1 : -1) * (0.9 + rand() * 0.5), 3 + Math.floor(rand() * 2), 0, 0, rand, id => spine[i] === id || (allowed(id) && !placed.has(id)));
    spur.slice(1).forEach(id => placed.add(id));
  }
  for (const id of placed) g.tiles[id].t = 'mountain';
  if (spine.length < 7) return;
  for (let i = 4 + Math.floor(rand() * 3); i < spine.length - 3; i += 7 + Math.floor(rand() * 4)) {
    g.tiles[spine[i]].t = 'field';
    for (const k of [i - 1, i, i + 1]) if (wide.has(k)) g.tiles[wide.get(k)].t = 'field';
  }
}

function addRivers(g, rand, elev, want, zone) {
  const verts = new Map();
  const key = p => `${Math.round(p.x)},${Math.round(p.y)}`;
  for (const t of g.tiles) {
    const c = center(g, t.id);
    const pts = corners(c.x, c.y);
    pts.forEach((p, i) => {
      const k = key(p);
      if (!verts.has(k)) verts.set(k, { k, x: p.x, y: p.y, tiles: [], adj: new Set() });
      const v = verts.get(k);
      v.tiles.push(t.id);
      v.adj.add(key(pts[(i + 1) % 6]));
      v.adj.add(key(pts[(i + 5) % 6]));
    });
  }
  const sea = v => v.tiles.some(i => g.tiles[i].t === 'sea');
  const wet = v => v.tiles.some(i => ['sea', 'lake'].includes(g.tiles[i].t));
  const height = v => v.tiles.reduce((sum, i) => {
    const t = g.tiles[i];
    return sum + (t.t === 'sea' ? -1 : t.t === 'lake' ? -0.5 : elev[i]);
  }, 0) / v.tiles.length;

  const used = new Set();

  // Спускается под уклон, пока не дойдёт до воды или до другой реки: так рождаются притоки.
  const flow = (source, done, skip) => {
    const path = [source];
    const seen = new Set([source.k]);
    for (let step = 0; step < 70; step++) {
      const cur = path[path.length - 1];
      if (step && done(cur)) return path;
      const options = [...cur.adj].map(k => verts.get(k))
        .filter(v => v && !seen.has(v.k) && !v.tiles.some(i => zone.has(i)) && !skip(v));
      if (!options.length) return null;
      options.sort((a, b) => height(a) + rand() * 0.05 - height(b) - rand() * 0.05);
      seen.add(options[0].k);
      path.push(options[0]);
    }
    return null;
  };
  const lay = path => {
    for (const v of path) used.add(v.k);
    g.rivers.push(path.map(v => ({ x: v.x, y: v.y })));
    for (let i = 1; i < path.length; i++) {
      const both = path[i - 1].tiles.filter(id => path[i].tiles.includes(id));
      if (both.length === 2) g.riverEdges.push(both);
    }
  };

  // У озера один сток: из самой низкой точки берега к морю или в следующее озеро.
  for (const lake of components(g, t => t.t === 'lake')) {
    const own = new Set(lake);
    const shore = [...verts.values()]
      .filter(v => v.tiles.length === 3 && v.tiles.some(i => own.has(i)) && !sea(v) && !used.has(v.k))
      .sort((a, b) => height(a) - height(b));
    for (const v of shore.slice(0, 8)) {
      const path = flow(v, c => wet(c) || used.has(c.k), c => c.tiles.some(i => own.has(i)));
      if (!path || path.length < 3) continue;
      lay(path);
      break;
    }
  }

  // Ручьи текут от гор: одни впадают в море, другие в озёра и в большие реки.
  const sources = shuffle([...verts.values()].filter(v =>
    v.tiles.length === 3 && v.tiles.some(i => g.tiles[i].t === 'mountain') && !wet(v)), rand);
  let streams = 0;
  for (const source of sources) {
    if (streams >= want) break;
    if (used.has(source.k)) continue;
    const path = flow(source, c => wet(c) || used.has(c.k), () => false);
    if (!path || path.length < 5) continue;
    lay(path);
    streams++;
  }
}

function tryMap(players, seed) {
  const rand = rng32(seed);
  const [W, H] = SIZES[players] || SIZES[5];
  const g = { W, H, tiles: [], rivers: [], riverEdges: [], capitals: [], camps: [], heroes: [], valleys: [] };
  const shape = makeNoise(rand), warp = makeNoise(rand), ridge = makeNoise(rand), base = makeNoise(rand), damp = makeNoise(rand);

  const cx = (W - 1) / 2, cy = (H - 1) / 2;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const nx = (c - cx) / (W / 2 - 0.5), ny = (r - cy) / (H / 2 - 0.5);
      const blob = (Math.abs(nx) ** 5 + Math.abs(ny) ** 5) ** 0.2;
      const wobble = (shape(c * 0.11, r * 0.11) - 0.5) * 0.55 + (shape(c * 0.3 + 9, r * 0.3) - 0.5) * 0.28;
      // Кромка моря неровная: заливы и мысы вместо прямого края сетки.
      const edge = Math.min(c, W - 1 - c, r, H - 1 - r);
      const inner = edge >= Math.max(1, 1 + (shape(c * 0.17 + 20, r * 0.17 + 5) - 0.42) * 4.4);
      g.tiles.push({
        id: r * W + c, c, r, t: inner && blob + wobble < 1.12 ? 'field' : 'sea',
        town: null, patch: null, hero: null, terr: null, rot: 0, road: false,
        seed: Math.floor(rand() * 1e6),
      });
    }
  }

  // Один материк: лишние острова тонут, внутренние заливы засыпаются.
  const isLand = t => t.t !== 'sea';
  const lands = components(g, isLand);
  if (!lands.length) return null;
  for (const part of lands.slice(1)) for (const id of part) g.tiles[id].t = 'sea';
  for (const part of components(g, t => t.t === 'sea')) {
    const open = part.some(id => {
      const t = g.tiles[id];
      return t.c === 0 || t.r === 0 || t.c === W - 1 || t.r === H - 1;
    });
    if (!open) for (const id of part) g.tiles[id].t = 'field';
  }

  const depth = flood(g, g.tiles.filter(t => t.t === 'sea').map(t => t.id), () => true);

  // Столицы на равных дугах: подходящая ровная земля как можно ближе к идеальной точке.
  const apart = 16 - players;
  for (const seat of ring(W / 2 - 7, H / 2 - 5.5, players, players === 2 ? (rand() - 0.5) * 0.12 : rand())) {
    const tx = cx + seat.x, ty = cy + seat.y;
    const spot = g.tiles
      .filter(t => depth[t.id] >= CAPITAL_DEPTH)
      .filter(t => !g.capitals.some(c => dist(g, c, t.id) < apart))
      .sort((a, b) => Math.hypot(a.c - tx, a.r - ty) - Math.hypot(b.c - tx, b.r - ty))[0];
    if (!spot) return null;
    g.capitals.push(spot.id);
  }

  // Шаблон столицы одинаков у всех: ровная земля вокруг и отряды на соседних клетках.
  for (const id of g.capitals) {
    for (const t of disc(g, id, HOME_RADIUS)) {
      if (t.t === 'sea') return null;
      t.t = 'field';
    }
    g.camps.push(neighbors(g, id).slice(0, START.squads));
  }

  // Вокруг столиц ровная земля: хребты, озёра и реки её обходят.
  const zone = new Set(g.capitals.flatMap(id => disc(g, id, HOME_RADIUS).map(t => t.id)));
  const keep = new Set(g.capitals.flatMap(id => disc(g, id, HOME_RADIUS + 1).map(t => t.id)));

  // Сначала ничьи гавани, потом остальной берег.
  const harbors = chooseHarbors(g, depth, Math.ceil(players / 2), rand);
  if (!harbors) return null;
  const bays = new Set();
  for (const id of harbors) if (!digHarbor(g, id, keep, rand, bays, depth)) return null;
  g.harbors = harbors;
  const isles = shapeCoast(g, rand, keep, players, bays);
  if (!isles) return null;
  const onMain = t => passable(t) && !isles.has(t.id);

  // Гавань настоящая, только если от бухты до открытой воды долго плыть.
  const fromShore = flood(g, g.tiles.filter(t => t.t !== 'sea').map(t => t.id), () => true);
  for (const id of harbors) {
    const heads = disc(g, id, 1).filter(t => t.t === 'sea').map(t => t.id);
    if (!heads.length) return null;
    const route = flood(g, heads, t => t.t === 'sea');
    if (g.tiles.some(t => fromShore[t.id] >= 2 && route[t.id] < HARBOR_DEPTH)) return null;
  }
  const coast = flood(g, g.tiles.filter(t => t.t === 'sea').map(t => t.id), () => true);
  const ground = g.tiles.filter(isLand);

  const rim = new Set();                // клетки рядом с готовыми хребтами: гряды не смыкаются
  const lit = t => t.r >= DARK_ROWS && t.r < H - DARK_ROWS;
  const open = id => g.tiles[id].t === 'field' && coast[id] >= 2 && !keep.has(id) && !rim.has(id) && !isles.has(id) && lit(g.tiles[id]);
  const settled = new Set();
  const settle = () => {
    for (const t of g.tiles) {
      if (t.t !== 'mountain' || settled.has(t.id)) continue;
      settled.add(t.id);
      for (const c of disc(g, t.id, 2)) rim.add(c.id);
    }
  };

  // Долина лежит в развилке: хребет расходится двумя неравными плечами и открыт в сторону моря.
  const valleys = Math.max(1, Math.floor(players / 2));
  const seaTiles = g.tiles.filter(t => t.t === 'sea');
  const spots = shuffle(ground.filter(t => coast[t.id] >= 4 && g.capitals.every(c => dist(g, c, t.id) >= 7)), rand);
  for (const t of [...spots, ...spots]) {
    if (g.valleys.length >= valleys) break;
    if (g.valleys.some(v => dist(g, v, t.id) < 7)) continue;
    const c = center(g, t.id);
    const shore = seaTiles.reduce((best, s) => {
      const d = dist(g, s.id, t.id);
      return d < best.d ? { id: s.id, d } : best;
    }, { id: -1, d: Infinity });
    const to = center(g, shore.id);
    const mouth = Math.atan2(to.y - c.y, to.x - c.x) + (rand() - 0.5) * 0.9;
    const reach = HEX_W * (2.7 + rand() * 0.7);
    const apex = tileAt(g, c.x - Math.cos(mouth) * reach, c.y - Math.sin(mouth) * reach);
    if (apex < 0 || !open(apex)) continue;
    const inside = new Set(disc(g, t.id, 2).map(x => x.id));
    const free = id => open(id) && !inside.has(id);
    const bow = 0.18 + rand() * 0.06;
    const long = walkRidge(g, apex, mouth + 1.15, 7 + Math.floor(rand() * 3), -bow, 1.15, rand, free);
    const short = walkRidge(g, apex, mouth - 1.15, 4 + Math.floor(rand() * 3), bow, 1.15, rand, id => free(id) && !long.slice(1).includes(id));
    if (long.length < 5 || short.length < 3) continue;
    raiseRidge(g, [...long].reverse().concat(short.slice(1)), rand, free);
    settle();
    g.valleys.push(t.id);
  }
  if (g.valleys.length < valleys) return null;

  // Остальные хребты тянутся вдоль берега: так горы защищают глубину материка.
  const wantRock = Math.round(ground.length * 0.067);
  const rock = () => g.tiles.filter(t => t.t === 'mountain').length;
  for (const t of shuffle(ground.filter(x => coast[x.id] >= 3), rand)) {
    if (rock() >= wantRock) break;
    if (!open(t.id)) continue;
    const c = center(g, t.id), mid = center(g, Math.floor(H / 2) * W + Math.floor(W / 2));
    const along = Math.atan2(c.y - mid.y, c.x - mid.x) + Math.PI / 2 + (rand() - 0.5) * 1.2;
    const heading = rand() < 0.3 ? rand() * TAU : along;
    const bend = (rand() < 0.5 ? 1 : -1) * (0.02 + rand() * 0.09);
    const spine = walkRidge(g, t.id, heading, 10 + Math.floor(rand() * 9), bend, 0.9, rand, open);
    if (spine.length < 7) continue;
    raiseRidge(g, spine, rand, open);
    settle();
  }

  // Озеро это низина у подножия: длинное, вытянутое вдоль долины.
  const foot = flood(g, g.tiles.filter(t => t.t === 'mountain').map(t => t.id), () => true);
  const wantLake = Math.round(ground.length * 0.045);
  const lakeAt = [];
  const dry = id => g.tiles[id].t === 'field' && coast[id] >= 3 && !keep.has(id) && !isles.has(id) && foot[id] >= 2;
  for (const t of shuffle(ground.filter(x => foot[x.id] >= 2 && foot[x.id] <= 6 && coast[x.id] >= 3), rand)) {
    if (g.tiles.filter(x => x.t === 'lake').length >= wantLake) break;
    if (!dry(t.id) || lakeAt.some(l => dist(g, l, t.id) < 6) || g.valleys.some(v => dist(g, v, t.id) <= 2)) continue;
    const body = walkRidge(g, t.id, rand() * TAU, 3 + Math.floor(rand() * 4), (rand() - 0.5) * 0.3, 0.8, rand, dry);
    if (body.length < 3) continue;
    for (const id of [...body]) {
      if (rand() < 0.45) body.push(...neighbors(g, id).filter(dry).slice(0, 1));
    }
    for (const id of body) g.tiles[id].t = 'lake';
    lakeAt.push(t.id);
  }

  connectLand(g, onMain);
  openPasses(g, rand);
  connectLand(g, onMain);
  if (components(g, onMain).length !== 1) return null;
  if (g.tiles.filter(t => t.t === 'mountain').length < ground.length * 0.06) return null;

  // Высота падает от гор к морю: по ней текут реки.
  const fall = flood(g, g.tiles.filter(t => t.t === 'mountain').map(t => t.id), () => true);
  const elev = g.tiles.map(t => 0.62 / (1 + fall[t.id] * 0.45) + Math.min(1, coast[t.id] / 9) * 0.3 + base(t.c * 0.12, t.r * 0.12) * 0.22);
  addRivers(g, rand, elev, 3 + players, zone);

  // Болото там, где вода застаивается. Лес держится рек и подножий, пустыня лежит вдали от воды.
  const riverside = flood(g, [...new Set(g.riverEdges.flat())], () => true);
  const lakeside = flood(g, g.tiles.filter(t => t.t === 'lake').map(t => t.id), () => true);
  const shoreDist = flood(g, g.tiles.filter(t => t.t === 'lake' || t.t === 'sea').map(t => t.id), () => true);
  const flat = ground.filter(t => t.t === 'field' && !zone.has(t.id));
  const top = (list, share, score) => list
    .map(t => [t, score(t)]).sort((a, b) => b[1] - a[1])
    .slice(0, Math.round(flat.length * share)).map(([t]) => t);
  const mire = t => 0.7 / (1 + lakeside[t.id]) + (coast[t.id] <= 3 ? 0.4 : 0.1) / (1 + riverside[t.id] * 0.7)
    + damp(t.c * 0.08 + 40, t.r * 0.08) * 0.75 - 0.35 / (1 + fall[t.id]);
  top(flat, 0.12, mire).forEach(t => { t.t = 'swamp'; });
  const woods = t => warp(t.c * 0.16 + 3, t.r * 0.16) * 1.5 + 0.3 / (1 + riverside[t.id] * 0.6)
    + 0.16 * Math.exp(-((fall[t.id] - 2) ** 2) / 8);
  top(flat.filter(t => t.t === 'field'), 0.28, woods).forEach(t => { t.t = 'forest'; });
  const drought = t => (1 - damp(t.c * 0.075 + 40, t.r * 0.075)) * 0.9
    + Math.min(1, riverside[t.id] / 7) * 0.32 + Math.min(1, shoreDist[t.id] / 6) * 0.32;
  top(flat.filter(t => t.t === 'field'), 0.2, drought).forEach(t => { t.t = 'desert'; });
  for (let pass = 0; pass < 2; pass++) {
    for (const t of flat) {
      const kinds = {};
      for (const id of neighbors(g, t.id)) {
        const k = g.tiles[id].t;
        if (['field', 'forest', 'swamp', 'desert'].includes(k) && !zone.has(id)) kinds[k] = (kinds[k] || 0) + 1;
      }
      const best = Object.entries(kinds).sort((a, b) => b[1] - a[1])[0];
      if (best && (kinds[t.t] || 0) <= 1 && best[1] >= 3) t.t = best[0];
    }
  }

  const fromCapital = g.capitals.map(c => flood(g, [c]));

  // Горы могли увести дорогу в обход: пешком до ближайшей гавани от всех столиц тоже должно быть поровну.
  const shores = harbors.flatMap(id => disc(g, id, 2).map(t => t.id));
  const walk = fromCapital.map(d => Math.min(...shores.map(id => d[id])));
  if (Math.max(...walk) - Math.min(...walk) > HARBOR_FAIR || walk.includes(Infinity)) return null;
  const free = t => onMain(t) && !t.town && !t.patch && !t.hero && lit(t)
    && !g.capitals.includes(t.id) && !g.camps.flat().includes(t.id);
  const towns = [...g.capitals];

  // У каждой столицы по две нейтральные острога на одинаковом удалении.
  for (let i = 0; i < players; i++) {
    let placed = 0;
    for (const t of shuffle(g.tiles.filter(free), rand)) {
      if (placed >= 2) break;
      const d = fromCapital[i][t.id];
      if (d < 5 || d > 7 || towns.some(v => dist(g, v, t.id) < 4)) continue;
      t.town = { type: 'ostrog', owner: null, gnomes: 6, empty: 0 };
      t.t = 'field';
      towns.push(t.id);
      placed++;
    }
    if (placed < 2) return null;
  }
  let extra = players * 2 + valleys;
  for (const t of shuffle(g.tiles.filter(free), rand)) {
    if (extra <= 0) break;
    if (towns.some(v => dist(g, v, t.id) < 5)) continue;
    t.town = { type: 'ostrog', owner: null, gnomes: 5 + Math.floor(rand() * 5), empty: 0 };
    t.t = 'field';
    towns.push(t.id);
    extra--;
  }

  // Грибницы: одна вплотную к каждой столице, по две подальше, по две в каждой долине, ещё немного в ничьих землях.
  const patches = [];
  const putPatch = t => {
    t.patch = { dying: 0, camp: null };
    patches.push(t.id);
  };
  // Своя грибница в двух клетках от столицы есть у всех: сначала ищем на расстоянии 2, потом вплотную.
  // Лагерь и дорогу к ней ставит начало партии (game.js newGame).
  g.homePatches = [];
  for (const id of g.capitals) {
    const spot = shuffle(disc(g, id, 2).filter(t => free(t) && dist(g, id, t.id) >= 1), rand)
      .sort((a, b) => dist(g, id, b.id) - dist(g, id, a.id))[0];
    if (!spot) return null;
    putPatch(spot);
    g.homePatches.push(spot.id);
  }
  for (let i = 0; i < players; i++) {
    let placed = 0;
    for (const t of shuffle(g.tiles.filter(free), rand)) {
      if (placed >= 2) break;
      const d = fromCapital[i][t.id];
      if (d < 6 || d > 11 || fromCapital.some(f => f[t.id] < 6) || g.capitals.some(c => dist(g, c, t.id) < 6) || patches.some(p => dist(g, p, t.id) < 4)) continue;
      putPatch(t);
      placed++;
    }
    if (placed < 2) return null;
  }
  for (const v of g.valleys) {
    let placed = 0;
    for (const t of shuffle(disc(g, v, 2).filter(x => free(x) && g.capitals.every(c => dist(g, c, x.id) >= 6)), rand)) {
      if (placed >= 2) break;
      putPatch(t);
      placed++;
    }
    if (!placed) return null;
  }
  let wild = 1 + Math.floor(players / 2);
  for (const t of shuffle(g.tiles.filter(free), rand)) {
    if (wild <= 0) break;
    if (g.capitals.some(c => dist(g, c, t.id) < 9) || patches.some(p => dist(g, p, t.id) < 4)) continue;
    putPatch(t);
    wild--;
  }
  if (patches.length < PATCH_FLOOR) return null;

  // Логова героев: каждый в своей стихии и как можно ровнее от всех столиц.
  // Водяной живёт в море или в озере: до него плывут на лодке.
  const near = (t, kinds) => neighbors(g, t.id).filter(id => kinds.includes(g.tiles[id].t)).length;
  const offshore = flood(g, g.tiles.filter(t => t.t !== 'sea').map(t => t.id), () => true);
  const lairs = {
    gorynych: t => free(t) && near(t, ['mountain']) >= 2,
    vodyanoy: t => t.t === 'lake' || (t.t === 'sea' && offshore[t.id] <= 2),
    leshy: t => free(t) && t.t === 'forest',
    yaga: t => free(t) && t.t === 'swamp',
    koschei: t => free(t) && t.t === 'desert',
  };
  const chosen = [];
  for (const [key, fits] of Object.entries(lairs)) {
    const fair = t => {
      const ds = g.capitals.map(c => (key === 'vodyanoy' ? dist(g, c, t.id) : fromCapital[g.capitals.indexOf(c)][t.id]));
      return Math.max(...ds) - Math.min(...ds) + Math.abs(Math.min(...ds) - 10) * 0.5;
    };
    const list = g.tiles
      .filter(t => fits(t) && chosen.every(c => dist(g, c, t.id) >= 5) && towns.every(v => dist(g, v, t.id) >= 2))
      .sort((a, b) => fair(a) - fair(b));
    const spot = list[0];
    if (!spot) return null;
    spot.hero = key;
    chosen.push(spot.id);
    g.heroes.push([spot.id, key]);
  }
  return g;
}

export function generateMap(players, seed) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const map = tryMap(players, seed + attempt * 7919);
    if (map) return map;
  }
  throw new Error('Карта не сложилась');
}
