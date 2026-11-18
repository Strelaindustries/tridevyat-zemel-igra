// Отрисовка мира: земля, объекты, отряды и темнота за краем моря.
// Общий экран и телефон используют один и тот же класс.
import { R, SQUASH, center, corners, factionOf, isWater, neighbors, tileAt, worldSize } from './hex.js';
import { CART_TILT, FAC, PAL, banner, boat, cart, gnome, hasObject, paintObject, pier, rowboat, seeded, soldier, soldierShadow } from './art.js';
import { Land } from './land.js';
import { bloodLevel } from './balance.js';
import { POST, borderPost, brush, inked } from './painted.js';

const SPRITE_W = R * 3, SPRITE_H = R * 3.6, SPRITE_OY = R * 2.6;
const VARIANTS = 4;
const MAX_PIXELS = { host: 28e6, phone: 11e6 };

// Строй на 10 человек: две косые шеренги плечом к плечу, как на референсах.
// Потери снимают воинов с краёв, середина держится дольше.
const SPOTS = [];
for (let rank = 0; rank < 2; rank++) {
  for (let file = 0; file < 5; file++) {
    const along = file - 2, across = rank - 0.5;
    SPOTS.push({ x: along * 11.4 + across * 16.5, y: along * -7.2 + across * 10.4, order: Math.abs(along) * 2 + rank });
  }
}
SPOTS.sort((a, b) => a.order - b.order);

export const SOLDIER_SCALE = 0.62;
export const BANNER_SCALE = 0.72;
export const BOAT_SCALE = 0.62;
const GROUND_OFFSET = 8;
const REALM_FONT = '500 31px "Alegreya SC", Alegreya, Georgia, serif';
const REALM_FONT_BIG = '500 58px "Alegreya SC", Alegreya, Georgia, serif';   // на политической карте имя видно с дивана
const REALM_NAME = 104;                 // имя царства лежит на столько ниже столицы
const SMOOTH = new Set(['mountain']);   // эти уже написаны мазками
// Эти нарисованы без пера: контур даётся им при запекании.
const OUTLINE = new Set(['yaga', 'koschei', 'camp', 'patch', 'patch1', 'patch2', 'patch3']);

// Лес на клетке с войсками редеет. Идущий отряд заранее разводит его на следующей клетке
// и смыкает за собой: расстояния взяты так, чтобы не задевать клетки по сторонам пути.
const FOREST_THIN = 0.4, THIN_NEAR = 52, THIN_FAR = 72;

// Межевые столбики стоят на серединах краёв клетки, чуть внутри своей земли: соседние царства не сливаются.
// Кровелька светлее цвета войск: на тёмной земле ряд столбиков должен читаться через всю карту.
const BLOOD_TINT = '46,36,32';   // кровь на постройках и горах: они чернеют вместе с землёй
const WALKERS = 5, WALK_GAP = 11;    // переселенцев в цепочке видно не больше пяти, шаг между ними
const ROOF = { red: '#ff5040', yellow: '#ffdc3a', blue: '#6c94ff', teal: '#2fe6b4', green: '#96e24a', copper: '#ff9440', snow: '#f6fafd', dark: '#b88cff', horde: '#e0503a' };
const LABEL_SIZE = 24;                  // подписи отрядов меняются вместе с картой
const POST_IN = 0.09, POST_SIZE = 1, POST_FAR = 1.4;
const REALM_TINT = 0.1;                 // прозрачность цвета царства на его клетках
// Политическая карта общего экрана: земля царства залита его цветом, по краю ровная граница.
// Ширины в пикселях экрана: граница читается издали одинаково на обзоре и вблизи.
// Цвет берётся приглушённый, цвет войск, а не яркая кровля: карта не должна слепить.
const POLITICS = { fill: 0.26, band: 0.2, bandPx: 14, line: 0.8, linePx: 4, seamPx: 1.4 };
const postStamps = {};
const postOf = id => (postStamps[id] ||= borderPost(ROOF[id], FAC[id].main));

// Телеги. Скорость в мировых пикселях в секунду, разворот на концах в секундах.
const CART = {
  speed: 40, turn: 1.5,
  lane: 5,                              // смещение от середины дороги, чтобы встречные разъезжались
  step: 5,                              // шаг точек маршрута
  corner: 46,                           // поворот начинается за столько до центра клетки: дорога там уже дуга
  fork: 16,                             // на развилке дорога идёт прямо к центру, и телега поворачивает круче
  gate: 46,                             // у поселения телега разворачивается на краю клетки
  shortest: 30,                         // короче такого пути телега не ездит
  load: 5,                              // столько штук груза помещается в тележку, остаток берёт следующая
  perRoute: 3, perRealm: 12,            // чтобы в одном месте не толпились
  size: 0.8,                            // телега меньше избы и держит масштаб карты
  fps: 15,                              // чаще телефону перерисовывать незачем
  rest: 4,                              // после кадра телефон отдыхает вчетверо дольше, чем его рисовал
};
// Ходьба: фаза шага в радианах за секунду и сдвиг фазы от воина к воину, чтобы шли не в ногу.
const STEP_RATE = 9, STEP_SHIFT = 2.1;

// Погода поверх кадра: цветовой слой, туман, дождь и молнии. Числа капель на обычный экран.
const SKY = {
  sun:   { tint: 'rgba(255,212,136,.05)' },
  fog:   { tint: 'rgba(188,197,199,.08)', fog: 0.28 },
  rain:  { tint: 'rgba(22,34,54,.3)', drops: 150, len: 20, speed: 950 },
  storm: { tint: 'rgba(9,13,28,.48)', drops: 260, len: 30, speed: 1400, bolts: [20, 30] },
};
const WIND = 0.28;                      // косина капель
const BOLT_TIME = 0.42;                 // сколько секунд светит вспышка

// Где телега скрывается: ближе первого числа её не видно, дальше второго видно целиком.
const CART_HIDE = { forest: [48, 80], town: [14, 40] };

// Ломаная через центры клеток со скруглёнными углами. Дуга короткая и остаётся на дороге.
function roundCorners(points, forks) {
  const toward = (a, b, corner) => {
    const k = corner / Math.hypot(b.x - a.x, b.y - a.y);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  };
  const line = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const corner = forks[i] ? CART.fork : CART.corner;
    const c = points[i], p = toward(c, points[i - 1], corner), q = toward(c, points[i + 1], corner);
    for (let k = 0; k <= 6; k++) {
      const t = k / 6, u = 1 - t;
      line.push({ x: u * u * p.x + 2 * u * t * c.x + t * t * q.x, y: u * u * p.y + 2 * u * t * c.y + t * t * q.y });
    }
  }
  line.push(points[points.length - 1]);
  return line;
}

// Маршрут как ряд точек через равный шаг: положение на нём находится сразу, без поиска.
// Курс в каждой точке непрерывен, поэтому телега не дёргается на поворотах.
function evenTrack(line) {
  const x = [], y = [], angle = [];
  let left = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], len = Math.hypot(b.x - a.x, b.y - a.y);
    for (; left < len; left += CART.step) {
      x.push(a.x + ((b.x - a.x) * left) / len);
      y.push(a.y + ((b.y - a.y) * left) / len);
    }
    left -= len;
  }
  const end = line[line.length - 1];
  x.push(end.x);
  y.push(end.y);
  for (let i = 0; i < x.length; i++) {
    const j = Math.min(i, x.length - 2);
    const raw = Math.atan2((y[j + 1] - y[j]) / CART_TILT, x[j + 1] - x[j]);
    angle.push(i ? raw + Math.PI * 2 * Math.round((angle[i - 1] - raw) / (Math.PI * 2)) : raw);
  }
  return { x, y, angle, cover: new Array(x.length).fill(0), length: (x.length - 1) * CART.step };
}

// Смещения воинов от центра клетки; строй зеркалится вместе с царством.
export function formation(n, facId) {
  const mirror = FAC[facId].dir;
  return SPOTS.slice(0, n)
    .map(p => ({ x: p.x * mirror, y: p.y + GROUND_OFFSET }))
    .sort((a, b) => a.y - b.y);
}

export const factionId = i => factionOf(i).id;

// Кусок пересекается с уже ждущим: они сливаются в один, иначе встаёт в очередь отдельно.
function joinBox(boxes, box) {
  const near = boxes.find(b => b.x0 <= box.x1 && box.x0 <= b.x1 && b.y0 <= box.y1 && box.y0 <= b.y1);
  if (!near) { boxes.push(box); return; }
  Object.assign(near, {
    x0: Math.min(near.x0, box.x0), y0: Math.min(near.y0, box.y0),
    x1: Math.max(near.x1, box.x1), y1: Math.max(near.y1, box.y1),
  });
}

export class MapView {
  constructor(map, { groundRes = 2, spriteRes = 2.5, phone = false, politics = false } = {}) {
    this.map = map;
    this.phone = phone;
    this.politics = politics;
    this.size = worldSize(map);
    // Большая карта не должна упереться в предел холста, особенно на телефоне.
    const limit = phone ? MAX_PIXELS.phone : MAX_PIXELS.host;
    this.res = Math.min(groundRes, Math.sqrt(limit / (this.size.w * this.size.h)));
    this.spriteRes = spriteRes;
    this.centers = map.tiles.map(t => center(map, t.id));
    this.sprites = new Map();
    this.towns = new Map();
    this.landKey = '[]';
    this.terrKey = '';
    this.roads = null;
    this.carts = [];
    this.supply = [];
    this.supplyKey = '[]';
    this.weather = 'sun';
    this.drops = null;
    this.fogTile = null;
    this.rolling = false;
    this.drawnAt = 0;
    this.drawCost = 0;
    this.paintQueue = [];         // куски земли, которые ждут перекраски
    this.painting = false;
    this.freshPaint = false;
    this.territory = [];
    this.posts = [];
    this.realms = [];
    this.nameRects = [];
    this.heroAt = new Map();
    this.bakeGround();
    this.bakeDarkness();
  }

  // Изменения с сервера: местность, гниль и дороги. Перепекается только затронутое.
  applyLand(list) {
    const key = JSON.stringify(list);
    if (key === this.landKey) return;
    this.landKey = key;
    const changed = [];
    let roadsDirty = !this.roads;
    for (const [id, t, rot, road, blood = 0] of list) {
      const tile = this.map.tiles[id];
      if (!tile.road !== !road) roadsDirty = true;
      if (tile.t !== t || tile.rot !== rot || (tile.blood || 0) !== blood) changed.push(id);
      Object.assign(tile, { t, rot, road, blood });
    }
    // Телегам важна и местность: лес, под которым они скрывались, мог исчезнуть.
    if (roadsDirty || changed.length) this.buildRoads(changed);
  }

  // Найденные герои: до находки клетка выглядит обычной землёй.
  setHeroes(list) {
    this.heroAt = new Map(list);
  }

  // Пути снабжения с сервера: телеги ездят только там, откуда в столицу реально идёт добро.
  // Дороги текущего хода: клетки с дорогой, остальная земля меняется после показа хода.
  setRoads(ids) {
    const on = new Set(ids);
    let dirty = false;
    for (const t of this.map.tiles) {
      if (!t.road !== !on.has(t.id)) dirty = true;
      t.road = on.has(t.id) ? 1 : 0;
    }
    if (dirty) this.buildRoads();
  }

  setPiers(list = []) {
    this.piers = list;
  }

  setSupply(list = []) {
    const key = JSON.stringify(list);
    if (key === this.supplyKey) return;
    this.supplyKey = key;
    this.supply = list;
    this.buildRoads();
  }

  setWeather(kind = 'sun') {
    this.weather = kind;
  }

  // Имена царств на карте: подпись стоит под столицей и идёт за ней, если столица переехала.
  setRealms(players = []) {
    this.realms = players.filter(p => p.capital != null && !p.out).map(p => ({ tile: p.capital, name: p.realm.toUpperCase() }));
  }

  // Отметка town на клетке нужна правилам: по ней на телефоне считается дорога в stepCost,
  // а по её владельцу spread закрывает чужие поселения.
  setTowns(list) {
    for (const id of this.towns.keys()) this.map.tiles[id].town = false;
    this.towns = new Map(list.map(([id, type, owner, gnomes]) => [id, { type, owner, gnomes }]));
    for (const [id, { owner }] of this.towns) this.map.tiles[id].town = { owner };
    this.buildRoads();
  }

  // Территория: прозрачный цвет царства и межевые столбики по внешнему краю.
  setTerritory(list) {
    const key = JSON.stringify(list);
    if (key === this.terrKey) return;
    this.terrKey = key;
    const held = new Map(list), byOwner = new Map(), edges = new Map(), posts = [], { tiles } = this.map;
    for (const [id, owner] of list) {
      if (!byOwner.has(owner)) { byOwner.set(owner, new Path2D()); edges.set(owner, new Path2D()); }
      const path = byOwner.get(owner), edge = edges.get(owner), c = this.centers[id], pts = corners(c.x, c.y);
      pts.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
      path.closePath();
      pts.forEach((p, i) => {
        const q = pts[(i + 1) % 6], beyond = tileAt(this.map, p.x + q.x - c.x, p.y + q.y - c.y);
        // Край царства для политической карты: всякая сторона, за которой не его клетка, и берег тоже.
        if (held.get(beyond) !== owner) { edge.moveTo(p.x, p.y); edge.lineTo(q.x, q.y); }
        // У воды своя граница: столбики нужны только на суше.
        if (held.get(beyond) === owner || beyond < 0 || tiles[beyond].t === 'sea' || tiles[beyond].t === 'lake') return;
        const x = (p.x + q.x) / 2, y = (p.y + q.y) / 2;
        posts.push({ x: x + (c.x - x) * POST_IN, y: y + (c.y - y) * POST_IN, owner });
      });
    }
    this.territory = [...byOwner].map(([owner, path]) => ({ color: ROOF[factionId(owner)], muted: FAC[factionId(owner)].main, path, edge: edges.get(owner) }));
    this.posts = posts.sort((a, b) => a.y - b.y);
  }

  // Дорога лежит в земле: перекрашивается только кусок вокруг изменившихся линий.
  buildRoads(changed = []) {
    const moved = this.land.refresh();
    if (changed.length || moved.length) this.repaint(changed, moved);
    this.roads = this.land.lines;
    this.buildCarts();
  }

  // Переселенцы: до пяти гномов цепочкой идут по дороге из поселения в поселение. Выходят из ворот,
  // скрываются в воротах и под кронами леса, как телеги. В колпаках цвета своего царства.
  // begin и ms: когда выходят и за сколько доходят. Рисуется через scene.fx, until: когда можно убрать.
  procession(e, begin, ms) {
    const track = this.trackOf(e.cells), lens = [0];
    for (let i = 1; i < track.x.length; i++) lens.push(lens[i - 1] + Math.hypot(track.x[i] - track.x[i - 1], track.y[i] - track.y[i - 1]));
    const total = lens[lens.length - 1], count = Math.min(e.n, WALKERS), hat = ROOF[factionId(e.owner)];
    const spot = d => {
      let i = 1;
      while (i < lens.length - 1 && lens[i] < d) i++;
      const f = (d - lens[i - 1]) / (lens[i] - lens[i - 1] || 1);
      return { x: track.x[i - 1] + (track.x[i] - track.x[i - 1]) * f, y: track.y[i - 1] + (track.y[i] - track.y[i - 1]) * f, cover: track.cover[i] || 0 };
    };
    const walk = {
      y: track.y[0],
      until: begin + ms,
      draw(ctx, _, time) {
        const k = Math.max(0, Math.min(1, (time * 1000 - begin) / ms)), lead = k * (total + (count - 1) * WALK_GAP);
        for (let j = 0; j < count; j++) {
          const d = lead - j * WALK_GAP;
          if (d <= 0 || d >= total) continue;
          const p = spot(d);
          ctx.globalAlpha = Math.min(1, Math.min(d, total - d) / 24) * (1 - p.cover);
          gnome(ctx, p.x, p.y + 4 - Math.abs(Math.sin(time * 11 + j * 1.7)) * 1.6, 0.9, hat);
        }
        ctx.globalAlpha = 1;
        walk.y = spot(Math.max(1, Math.min(total - 1, lead))).y + 4;
      },
    };
    return walk;
  }

  // Маршруты телег: из столицы с грибами в острога и порожняком обратно, из лагерей порожняком туда и с грибами в столицу.
  buildCarts() {
    const routes = [];
    for (const { realm, out, back, cells } of this.supply) {
      const id = cells[cells.length - 1], track = this.trackOf(cells);
      const start = CART.gate, end = track.length - (this.towns.has(id) ? CART.gate : 0);
      if (end - start >= CART.shortest) routes.push({ id, cells, track, start, end, realm, out, back });
    }

    // Самые длинные дороги получают телеги первыми, остаток царства достаётся коротким.
    const used = new Map();
    this.carts = [];
    for (const route of routes.sort((a, b) => b.end - b.start - (a.end - a.start))) {
      const room = CART.perRealm - (used.get(route.realm) || 0);
      const count = Math.min(room, CART.perRoute, Math.max(1, Math.ceil(Math.max(route.out, route.back) / CART.load)));
      if (count <= 0) continue;
      used.set(route.realm, (used.get(route.realm) || 0) + count);
      const first = seeded(route.id + 1)();
      for (let k = 0; k < count; k++) {
        const part = total => Math.max(0, Math.min(CART.load, total - k * CART.load));
        this.carts.push({ ...route, phase: first + k / count, there: part(route.out), home: part(route.back) });
      }
    }
  }

  // Дорога под телегой: под кронами леса и среди домов проезжей острога телега скрывается,
  // иначе в общей сортировке она выскакивала бы поверх них на середине клетки.
  trackOf(cells) {
    const points = cells.map(id => this.centers[id]);
    const { tiles } = this.map, carries = id => tiles[id].road || this.towns.has(id);
    const track = evenTrack(roundCorners(points, cells.map(id => neighbors(this.map, id).filter(carries).length > 2)));
    const steps = points.map((p, i) => (i ? Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) : 0));
    const scale = track.length / steps.reduce((sum, len) => sum + len);
    let passed = 0;
    cells.forEach((id, i) => {
      passed += steps[i];
      // По просеке телега едет открыто, под кроны она уходит только с дороги.
      const tile = this.map.tiles[id], wooded = this.objectOf(tile) === 'forest' && !tile.road;
      if (!wooded && !(this.towns.has(id) && i && i < cells.length - 1)) return;
      const [near, far] = wooded ? CART_HIDE.forest : CART_HIDE.town;
      const mid = (passed * scale) / CART.step;
      for (let j = Math.max(0, Math.ceil(mid - far / CART.step)); j <= mid + far / CART.step && j < track.cover.length; j++) {
        const k = (far - Math.abs(j - mid) * CART.step) / (far - near);
        track.cover[j] = Math.max(track.cover[j], Math.min(1, k));
      }
    });
    return track;
  }

  // Где телега в момент time: ровный ход туда, разворот на месте, ровный ход обратно, разворот.
  cartAt(c, time) {
    const { speed, turn } = CART;
    const drive = (c.end - c.start) / speed, lap = 2 * (drive + turn);
    const t = (time + c.phase * lap) % lap;
    let went, half, rolled;
    if (t < drive) { went = t; half = 0; rolled = t; }
    else if (t < drive + turn) { went = drive; half = (t - drive) / turn; rolled = drive; }
    else if (t < 2 * drive + turn) { went = 2 * drive + turn - t; half = 1; rolled = t - turn; }
    else { went = 0; half = 1 + (t - 2 * drive - turn) / turn; rolled = 2 * drive; }

    const { track } = c;
    const at = (c.start + went * speed) / CART.step;
    const i = Math.min(track.x.length - 2, Math.floor(at)), f = at - i;
    const mix = list => list[i] + (list[i + 1] - list[i]) * f;
    const k = half % 1, swing = half - k + k * k * (3 - 2 * k);
    const road = mix(track.angle), lane = CART.lane * Math.cos(Math.PI * swing);
    return {
      x: mix(track.x) - Math.sin(road) * lane,
      y: mix(track.y) + Math.cos(road) * lane * CART_TILT,
      heading: road - Math.PI * swing,
      rolled: rolled * speed,
      alpha: 1 - mix(track.cover),
      returning: half >= 0.5 && half < 1.5,
    };
  }

  // Телефон рисует только по изменениям. Пока рядом с кадром есть телеги, ему нужны новые кадры,
  // но на них уходит не больше пятой части времени: слабый телефон рисует реже, а не тормозит.
  moving(now) {
    // Только что дорисован кусок земли: его надо показать, даже если телеги стоят.
    if (this.freshPaint) { this.freshPaint = false; return true; }
    return this.rolling && now - this.drawnAt >= Math.max(1000 / CART.fps, this.drawCost * (1 + CART.rest));
  }

  hexPath(ctx, id, scale = 1) {
    const c = this.centers[id];
    ctx.beginPath();
    corners(c.x, c.y, scale).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  }

  // Перекраска клеток на готовой земле: кусок вокруг каждой, остальная карта не трогается.
  // lines: новые и сломанные дороги, их просека дотягивается до соседних клеток.
  repaint(ids, lines = []) {
    const { w, h } = this.size, boxes = [];
    for (const [c, reach] of [...ids.map(id => [this.centers[id], R * 2]), ...lines.map(l => [l[l.length >> 1], R * 2.6])]) {
      const box = {
        x0: Math.max(0, Math.floor(c.x - reach)), y0: Math.max(0, Math.floor(c.y - reach)),
        x1: Math.min(w, Math.ceil(c.x + reach)), y1: Math.min(h, Math.ceil(c.y + reach)),
      };
      joinBox(boxes, box);
    }
    // Кусок земли рисуется долго, на телефоне до сотен миллисекунд: куски идут по одному за кадр,
    // чтобы пульт не замирал. Клетки к этому времени уже новые, поэтому рисуется последнее состояние.
    for (const box of boxes) joinBox(this.paintQueue, box);
    if (this.painting) return;
    this.painting = true;
    setTimeout(() => this.paintNext(), 0);
  }

  paintNext() {
    const box = this.paintQueue.shift();
    this.painting = !!box;
    if (!box) return;
    this.land.paint(box);
    this.freshPaint = true;
    setTimeout(() => this.paintNext(), 16);
  }

  // Два слоя: земля с лесом и земля без крон, она проступает там, где лес редеет под отрядами.
  bakeGround() {
    const { w, h } = this.size;
    const layer = res => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(w * res);
      canvas.height = Math.ceil(h * res);
      const ctx = canvas.getContext('2d');
      ctx.scale(res, res);
      return ctx;
    };
    this.groundCtx = layer(this.res);
    this.ground = this.groundCtx.canvas;
    this.bareCtx = layer(this.res / 2);
    this.bare = this.bareCtx.canvas;
    this.land = new Land(this, { phone: this.phone });
    this.land.paint();
  }

  // За морем начинается темнота: карта тонет в ней, а не обрывается.
  bakeDarkness() {
    const { w, h } = this.size;
    const step = 12, pad = 240;
    const cols = Math.ceil((w + pad * 2) / step), rows = Math.ceil((h + pad * 2) / step);
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(cols, rows);
    const rnd = seeded(this.map.tiles[0].seed + 5);
    const wobble = Array.from({ length: 8 }, () => [rnd() * 6.3, 0.004 + rnd() * 0.012, 0.004 + rnd() * 0.012]);
    const hx = w / 2, hy = h / 2, radius = 90;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * step - pad, y = row * step - pad;
        const qx = Math.abs(x - hx) - (hx - radius), qy = Math.abs(y - hy) - (hy - radius);
        let sdf = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
        for (const [p, fx, fy] of wobble) sdf += Math.sin(x * fx + y * fy + p) * 7;
        const k = Math.min(1, Math.max(0, (sdf + 44) / 64));
        const a = k * k * (3 - 2 * k);
        image.data[(row * cols + col) * 4 + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(image, 0, 0);
    this.dark = { canvas, x: -pad, y: -pad, w: cols * step, h: rows * step };
  }

  // blood: сколько крови на клетке, от 0 до 4. Постройки, руины, горы и лес на ней темнеют и краснеют, как и земля.
  sprite(kind, variant, dark = 0, blood = 0) {
    const key = `${kind}:${variant}:${dark}:${blood}`;
    if (this.sprites.has(key)) return this.sprites.get(key);
    let canvas = document.createElement('canvas');
    canvas.width = Math.ceil(SPRITE_W * this.spriteRes);
    canvas.height = Math.ceil(SPRITE_H * this.spriteRes);
    let ctx = canvas.getContext('2d');
    ctx.scale(this.spriteRes, this.spriteRes);
    ctx.translate(SPRITE_W / 2, SPRITE_OY);
    paintObject(ctx, kind, variant * 977 + 3);
    if (!SMOOTH.has(kind)) brush(canvas, this.spriteRes, variant * 31 + kind.length, 0.6);
    if (OUTLINE.has(kind)) {
      canvas = inked(canvas, this.spriteRes);
      ctx = canvas.getContext('2d');
      ctx.scale(this.spriteRes, this.spriteRes);
      ctx.translate(SPRITE_W / 2, SPRITE_OY);
    }
    if (dark) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(12,9,6,${dark * 0.24})`;
      ctx.fillRect(-SPRITE_W / 2, -SPRITE_OY, SPRITE_W, SPRITE_H);
    }
    if (blood) {
      // Умножение, а не заливка: постройка темнеет, но не сереет. Маска возвращает прозрачный фон.
      const mask = document.createElement('canvas');
      mask.width = canvas.width;
      mask.height = canvas.height;
      mask.getContext('2d').drawImage(canvas, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgba(${BLOOD_TINT},${blood * 0.17})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(mask, 0, 0);
    }
    this.sprites.set(key, canvas);
    return canvas;
  }

  objectOf(t) {
    if (this.heroAt.has(t.id)) return this.heroAt.get(t.id);
    const town = this.towns.get(t.id);
    if (town) return town.type;
    return hasObject(t.t) ? t.t : null;
  }

  // Прозрачный рисунок идёт только через готовую картинку, иначе кроны просвечивают друг через друга.
  drawKind(ctx, t, kind) {
    const c = this.centers[t.id];
    const variant = t.seed % VARIANTS;
    const flip = (t.seed >> 3) & 1 && kind === 'mountain';
    const dark = kind.startsWith('patch') || kind === 'camp' ? 0 : Math.min(3, Math.ceil((t.rot || 0) / 2));
    const blood = Math.ceil(bloodLevel(t.blood) * 4);
    ctx.save();
    ctx.translate(c.x, c.y);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(this.sprite(kind, variant, dark, blood), -SPRITE_W / 2, -SPRITE_OY, SPRITE_W, SPRITE_H);
    ctx.restore();
  }

  // Поляна в лесу: сквозь кроны проступает земля, края мягкие.
  clearing(ctx, id, k) {
    const c = this.centers[id], { w, h } = this.size, half = R * 1.2;
    const x = Math.max(0, c.x - half), y = Math.max(0, c.y - half), right = Math.min(w, c.x + half), low = Math.min(h, c.y + half);
    const s = this.res / 2;
    ctx.save();
    ctx.globalAlpha = k * (1 - FOREST_THIN) * 0.45;
    for (const scale of [1.08, 0.9, 0.72]) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, R * scale, R * SQUASH * scale, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(this.bare, x * s, y * s, (right - x) * s, (low - y) * s, x, y, right - x, low - y);
      ctx.restore();
    }
    ctx.restore();
  }

  // Клетки, где лес редеет: под стоящими отрядами и на пути идущих. Значения от 0 до 1.
  thinForest(scene) {
    const thin = new Map();
    for (const u of scene.units || []) {
      const p = scene.positions?.get(u.id);
      if (!p) { thin.set(u.tile, 1); continue; }
      const at = tileAt(this.map, p.x, p.y);
      if (at < 0) continue;
      for (const id of [at, ...neighbors(this.map, at)]) {
        const c = this.centers[id];
        const k = (THIN_FAR - Math.hypot(c.x - p.x, c.y - p.y)) / (THIN_FAR - THIN_NEAR);
        if (k > (thin.get(id) || 0)) thin.set(id, Math.min(1, k));
      }
    }
    return thin;
  }

  // Гномы живут у своей острога: видно до пяти, рядом табличка с точным числом.
  drawGnomes(ctx, c, n, hideCount, hat) {
    const spots = [[-38, 26], [-22, 34], [-6, 37], [10, 35], [26, 29]];
    spots.slice(0, n).forEach(([dx, dy]) => gnome(ctx, c.x + dx, c.y + dy, 0.9, hat));
    if (!hideCount) this.drawCount(ctx, c, n);
  }

  // Значок числа жителей стоит всегда сбоку снизу.
  drawCount(ctx, c, n) {
    const label = String(n);
    ctx.font = '500 15px Alegreya, Georgia, serif';
    const w = ctx.measureText(label).width + 10;
    ctx.fillStyle = PAL.black;
    ctx.fillRect(c.x - 50 - w / 2, c.y + 8, w, 18);
    ctx.fillStyle = '#f2efe6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, c.x - 50, c.y + 17.5);
  }

  visible(cam, vw, vh) {
    const hw = vw / 2 / cam.s + R * 2, hh = vh / 2 / cam.s + R * 3;
    return this.map.tiles.filter(t => {
      const c = this.centers[t.id];
      return Math.abs(c.x - cam.x) < hw && Math.abs(c.y - cam.y) < hh;
    }).map(t => t.id);
  }

  drawSquad(ctx, u, x, y, time, o = {}) {
    const fac = factionId(u.owner);
    const alpha = o.alpha ?? 1;
    if (alpha < 1) { ctx.save(); ctx.globalAlpha = alpha; }
    if (o.boat) {
      boat(ctx, x, y + 6, BOAT_SCALE, fac, u.n, time);
    } else {
      const spots = formation(u.n, fac);
      for (const p of spots) soldierShadow(ctx, x + p.x, y + p.y, SOLDIER_SCALE);
      let planted = false;
      spots.forEach((p, i) => {
        if (!planted && p.y >= 5) {
          planted = true;
          banner(ctx, x - 2, y + 4, BANNER_SCALE, fac, Math.sin(time * 1.4 + u.id));
        }
        const walk = o.march ? { stride: time * STEP_RATE + i * STEP_SHIFT, dir: o.dir } : {};
        soldier(ctx, x + p.x, y + p.y, SOLDIER_SCALE, fac, { ...walk, shadow: false });
      });
      if (!planted) banner(ctx, x - 2, y + 4, BANNER_SCALE, fac, Math.sin(time * 1.4 + u.id));
    }
    if (alpha < 1) ctx.restore();
  }

  // scene: units, positions (id → {x,y,march,boat}), patches, marks, fx, rising, hide.
  draw(ctx, dpr, cam, vw, vh, scene) {
    const began = performance.now();
    const { tiles } = this.map;
    const time = scene.time || 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, vw, vh);
    ctx.translate(vw / 2, vh / 2);
    ctx.scale(cam.s, cam.s);
    ctx.translate(-cam.x, -cam.y);

    const ids = this.visible(cam, vw, vh);
    ctx.drawImage(this.ground, 0, 0, this.size.w, this.size.h);

    const seen = new Set(ids);
    const thin = this.thinForest(scene);
    for (const [id, k] of thin) if (seen.has(id) && tiles[id].t === 'forest') this.clearing(ctx, id, k);

    if (this.politics) this.drawPolitics(ctx, cam.s);
    else {
      ctx.globalAlpha = REALM_TINT;
      for (const { color, path } of this.territory) {
        ctx.fillStyle = color;
        ctx.fill(path);
      }
      ctx.globalAlpha = 1;
    }

    // Имя царства не лежит на столбиках: под ним они не ставятся, а подписи его обходят.
    const names = this.nameBoxes(ctx);
    // Издали столбики чуть крупнее, иначе граница теряется на обзоре. На политической карте их заменяет граница.
    const post = Math.min(POST_FAR, Math.max(POST_SIZE, 0.55 / cam.s)), pw = POST.w * post, ph = POST.h * post, foot = POST.foot * post;
    const reachX = vw / 2 / cam.s + pw, reachY = vh / 2 / cam.s + ph;
    for (const { x, y, owner } of this.politics ? [] : this.posts) {
      if (Math.abs(x - cam.x) > reachX || Math.abs(y - cam.y) > reachY) continue;
      if (names.some(n => Math.abs(x - n.x) < n.half + 8 && y - ph < n.y + 8 && y > n.y - 28)) continue;
      ctx.drawImage(postOf(factionId(owner)), x - pw / 2, y - foot, pw, ph);
    }

    for (const m of scene.marks || []) {
      const fill = m.kind === 'attack' ? 'rgba(179,53,53,.38)' : m.kind === 'road' ? 'rgba(242,242,242,.14)' : 'rgba(233,206,79,.2)';
      const line = m.kind === 'attack' ? '#e0504a' : m.kind === 'road' ? 'rgba(242,242,242,.75)' : 'rgba(233,206,79,.85)';
      this.hexPath(ctx, m.tile, m.kind === 'pick' ? 0.97 : 0.92);
      if (m.kind !== 'pick') { ctx.fillStyle = fill; ctx.fill(); }
      ctx.strokeStyle = m.kind === 'pick' ? PAL.white : line;
      ctx.lineWidth = m.kind === 'pick' ? 3.5 : 2.2;
      ctx.stroke();
    }

    // Лес уже в земле, остальное стоит на ней по рядам.
    const items = [];
    for (const id of ids) {
      const t = tiles[id], kind = this.objectOf(t);
      if (!kind || kind === 'forest') continue;
      items.push([this.centers[id].y - 1, () => this.drawKind(ctx, t, kind)]);
    }
    for (const [id, dying, owner] of scene.patches || []) {
      if (!seen.has(id)) continue;
      const fade = dying ? Math.min(3, Math.ceil((7 - dying) / 2)) : 0;
      const kind = owner != null && !dying ? 'camp' : fade ? `patch${fade}` : 'patch';
      items.push([this.centers[id].y, () => this.drawKind(ctx, tiles[id], kind)]);
    }
    for (const [id, town] of this.towns) {
      if (!seen.has(id)) continue;
      const c = this.centers[id];
      const hat = town.owner == null ? undefined : ROOF[factionId(town.owner)];
      items.push([c.y + 2, () => this.drawGnomes(ctx, c, town.gnomes, scene.hideCounts, hat)]);
      if (town.owner == null) continue;
      const big = town.type === 'capital';
      const rise = scene.rising?.get(id) ?? 1;
      items.push([c.y + 8, () => banner(ctx, c.x + (big ? 30 : 12), c.y + (big ? 18 : 5), (big ? 0.72 : 0.5) * rise, factionId(town.owner), Math.sin(time * 1.2 + id))]);
    }
    // Войска на одной клетке стоят рядом, а не друг в друге.
    const labels = [];
    const stacks = new Map();
    for (const u of scene.units || []) stacks.set(u.tile, [...(stacks.get(u.tile) || []), u.id]);
    for (const u of scene.units || []) {
      if (scene.hide && scene.hide.has(u.id)) continue;
      const stack = stacks.get(u.tile), c = this.centers[u.tile];
      const shift = (stack.indexOf(u.id) - (stack.length - 1) / 2) * 56;
      const p = scene.positions?.get(u.id) || { x: c.x + shift, y: c.y };
      const onSea = p.boat ?? (tiles[u.tile].t === 'sea' || tiles[u.tile].t === 'lake');
      labels.push({ u, x: p.x, y: p.y });
      items.push([p.y + 14, () => {
        this.drawSquad(ctx, u, p.x, p.y, time, { boat: onSea, march: p.march, alpha: p.alpha, dir: p.dir });
        if (scene.ready?.has(u.id)) this.readyMark(ctx, p.x, p.y, time);
      }]);
    }
    for (const fx of scene.fx || []) items.push([fx.y, () => fx.draw(ctx, this, time)]);

    const size = CART.size, detail = cam.s * size * dpr;
    this.rolling = this.weather !== 'sun';
    this.drawnAt = time * 1000;
    for (const { land, water } of this.piers || []) {
      if (!seen.has(land)) continue;
      const a = this.centers[land], b = this.centers[water];
      items.push([Math.min(a.y, b.y) + 2, () => pier(ctx, a.x, a.y, b.x, b.y, size)]);
    }
    for (const c of this.carts) {
      if (!c.cells.some(id => seen.has(id))) continue;
      this.rolling = true;
      const p = this.cartAt(c, time);
      if (p.alpha <= 0 || !seen.has(tileAt(this.map, p.x, p.y))) continue;
      items.push([p.y + 6, () => {
        ctx.globalAlpha = p.alpha;
        const count = p.returning ? c.home : c.there;
        const goods = count ? 'mushroom' : null, hat = ROOF[factionId(c.realm)];
        if (isWater(this.map, tileAt(this.map, p.x, p.y))) rowboat(ctx, p.x, p.y, size, p.heading, goods, time, hat);
        else cart(ctx, p.x, p.y, size, p.heading, p.rolled, detail, goods, count, hat);
        ctx.globalAlpha = 1;
      }]);
    }

    items.sort((a, b) => a[0] - b[0]);
    for (const [, paint] of items) paint();
    this.drawRealms(ctx, names, seen);
    const placed = [];
    for (const { u, x, y } of labels.sort((a, b) => b.y - a.y)) this.drawLabel(ctx, u.named ? `${u.name} · ${u.n}` : String(u.n), FAC[factionId(u.owner)].main, x, y, placed);
    // Над Тугарином его сила: чем меньше, тем легче его одолеть.
    const horde = scene.horde;
    if (horde && seen.has(horde.tile) && this.heroAt.get(horde.tile) === 'tugarin') {
      const c = this.centers[horde.tile];
      this.drawLabel(ctx, `Тугарин · ${horde.power}`, '#8a2418', c.x, c.y - 12, placed);
    }

    const d = this.dark;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(d.canvas, d.x, d.y, d.w, d.h);
    this.drawWeather(ctx, dpr, vw, vh, time);
    this.drawCost = performance.now() - began;
  }

  // Погода рисуется в координатах экрана: она висит над картой и не зависит от приближения.
  drawWeather(ctx, dpr, vw, vh, time) {
    const sky = SKY[this.weather] || SKY.sun;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = sky.tint;
    ctx.fillRect(0, 0, vw, vh);
    if (sky.fog) this.drawFog(ctx, vw, vh, time, sky.fog);
    if (sky.drops) this.drawRain(ctx, vw, vh, time, sky);
    if (sky.bolts) this.drawBolt(ctx, vw, vh, time, sky.bolts);
  }

  // Туман: большие мягкие пятна, два слоя ползут с разной скоростью.
  drawFog(ctx, vw, vh, time, level) {
    if (!this.fogTile) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 512;
      const g = canvas.getContext('2d'), rnd = seeded(77);
      for (let i = 0; i < 46; i++) {
        const x = rnd() * 512, y = rnd() * 512, r = 60 + rnd() * 120;
        for (const dx of [-512, 0, 512]) {
          for (const dy of [-512, 0, 512]) {
            const spot = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
            spot.addColorStop(0, 'rgba(226,231,231,.22)');
            spot.addColorStop(1, 'rgba(226,231,231,0)');
            g.fillStyle = spot;
            g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
          }
        }
      }
      this.fogTile = canvas;
    }
    const span = Math.max(vw, vh) * 1.2;
    for (const [speed, rise, alpha] of [[14, 5, level], [-23, -3, level * 0.7]]) {
      ctx.globalAlpha = alpha;
      const x = ((time * speed) % span + span) % span - span, y = ((time * rise) % span + span) % span - span;
      for (const ox of [0, span]) for (const oy of [0, span]) ctx.drawImage(this.fogTile, x + ox, y + oy, span, span);
    }
    ctx.globalAlpha = 1;
  }

  // Капли лежат в постоянном порядке, поэтому дождь идёт ровно, без дрожи.
  drawRain(ctx, vw, vh, time, { drops, len, speed }) {
    if (!this.drops) {
      const rnd = seeded(31);
      this.drops = Array.from({ length: 320 }, () => [rnd(), rnd(), 0.7 + rnd() * 0.6]);
    }
    const count = Math.round(drops * Math.min(1.4, (vw * vh) / 1e6));
    const wide = vw + vh * WIND, tall = vh + len;
    ctx.strokeStyle = 'rgba(190,212,232,.42)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const [a, b, k] of this.drops.slice(0, count)) {
      const y = (b * tall + time * speed * k) % tall - len;
      const x = (((a * wide - time * speed * k * WIND) % wide) + wide) % wide;
      ctx.moveTo(x, y);
      ctx.lineTo(x - len * k * WIND, y + len * k);
    }
    ctx.stroke();
  }

  // Молния бьёт неровно, раз в 20–30 секунд, в разных местах: ломаная и вспышка всего неба.
  // На каждую вспышку зовётся onBolt: общий экран отвечает громом, а телефон молчит.
  drawBolt(ctx, vw, vh, time, [least, most]) {
    this.boltNext ??= time + Math.random() * least / 2;
    if (time >= this.boltNext) {
      this.boltNext = time + least + Math.random() * (most - least);
      this.boltAt = time;
      this.onBolt?.();
    }
    const at = time - (this.boltAt ?? -most);
    if (at > BOLT_TIME) return;
    const rnd = seeded(Math.floor(this.boltAt * 613) + 9), flicker = at < 0.12 || (at > 0.2 && at < 0.28) ? 1 : 0.45;
    ctx.fillStyle = `rgba(226,232,255,${0.34 * flicker * (1 - at / BOLT_TIME)})`;
    ctx.fillRect(0, 0, vw, vh);
    let x = vw * (0.15 + rnd() * 0.7), y = 0;
    ctx.strokeStyle = `rgba(240,244,255,${flicker})`;
    ctx.lineWidth = 2.6;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    while (y < vh * 0.62) {
      x += (rnd() - 0.5) * 70;
      y += 24 + rnd() * 34;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Политическая карта: заливка цветом царства, у края полоса гуще и сплошная линия, по стыку тёмный шов.
  // Полоса и линия рисуются по краю внутри своей земли, поэтому у соседей не наезжают друг на друга.
  drawPolitics(ctx, scale) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const { muted: color, path, edge } of this.territory) {
      ctx.globalAlpha = POLITICS.fill;
      ctx.fillStyle = color;
      ctx.fill(path);
      ctx.save();
      ctx.clip(path);
      ctx.strokeStyle = color;
      ctx.globalAlpha = POLITICS.band;
      ctx.lineWidth = (POLITICS.bandPx * 2) / scale;
      ctx.stroke(edge);
      ctx.globalAlpha = POLITICS.line;
      ctx.lineWidth = (POLITICS.linePx * 2) / scale;
      ctx.stroke(edge);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(14,12,8,.8)';
    ctx.lineWidth = POLITICS.seamPx / scale;
    for (const { edge } of this.territory) ctx.stroke(edge);
    ctx.restore();
  }

  // Где лежат имена царств: под столицей, но в пределах карты.
  nameBoxes(ctx) {
    ctx.font = this.politics ? REALM_FONT_BIG : REALM_FONT;
    ctx.letterSpacing = this.politics ? '6px' : '4px';
    const below = this.politics ? REALM_NAME + 18 : REALM_NAME;
    const boxes = this.realms.map(({ tile, name }) => {
      const c = this.centers[tile], half = ctx.measureText(name).width / 2 + 8;
      return { tile, name, half, rise: this.politics ? 56 : 30, x: Math.max(half + 30, Math.min(this.size.w - half - 30, c.x)), y: c.y + below };
    });
    ctx.letterSpacing = '0px';
    this.nameRects = boxes;
    return boxes;
  }

  drawRealms(ctx, names, seen) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.font = this.politics ? REALM_FONT_BIG : REALM_FONT;
    ctx.letterSpacing = this.politics ? '6px' : '4px';
    for (const { tile, name, x, y } of names) {
      if (!seen.has(tile)) continue;
      ctx.lineWidth = this.politics ? 11 : 7;
      ctx.strokeStyle = 'rgba(20,20,12,.75)';
      ctx.strokeText(name, x, y);
      ctx.fillStyle = '#e9dfbf';
      ctx.fillText(name, x, y);
    }
    ctx.letterSpacing = '0px';
  }

  // Подпись держит один размер на экране и не наезжает на соседние.
  drawLabel(ctx, text, color, x, y, placed) {
    const size = LABEL_SIZE;
    ctx.font = `500 ${size}px Alegreya, Georgia, serif`;
    const w = ctx.measureText(text).width + size * 0.9, h = size * 1.4;
    let top = y - 94;
    const hits = t => placed.some(p => Math.abs(p.x - x) < (p.w + w) / 2 + size * 0.2 && Math.abs(p.top - t) < h + size * 0.1)
      || this.nameRects.some(n => Math.abs(n.x - x) < n.half + w / 2 && t > n.y - n.rise && t - h < n.y + 8);
    while (hits(top)) top -= h + size * 0.15;
    placed.push({ x, top, w });
    ctx.fillStyle = 'rgba(0,0,0,.72)';
    ctx.fillRect(x - w / 2, top - h, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x - w / 2, top - size * 0.1, w, size * 0.1);
    ctx.fillStyle = '#f2efe6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, top - h / 2);
  }

  readyMark(ctx, x, y, time) {
    const lift = Math.sin(time * 3) * 1.6;
    ctx.fillStyle = FAC.yellow.main;
    ctx.strokeStyle = PAL.black;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x + 16, y - 74 + lift);
    ctx.lineTo(x + 30, y - 74 + lift);
    ctx.lineTo(x + 23, y - 64 + lift);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
