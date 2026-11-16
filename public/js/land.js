// Земля как холст: подмалёвок, мазки, берега, реки, лес и пятна света. Всё считается из клеток карты, картинок нет.
// Мазок и крона зависят только от своего места на карте, поэтому перекрашенный кусок совпадает с полной картой без шва.
import { R, corners, isWater, neighbors, tileAt } from './hex.js';
import { seeded } from './art.js';
import { bloodLevel } from './balance.js';

const TAU = Math.PI * 2;
const WARP = 24;                        // на столько границы земель отходят от краёв клеток
const CUT = { near: 12, far: 26 };      // просека: столько от дороги чисто и столько до края
const LONE = 34;                        // дорога одной клетки без соседей: столько в каждую сторону от середины
const MARGIN = 130;                     // запас вокруг куска: столько захватывает размытие масок
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const rgb = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
const mixc = (p, q, t) => [mix(p[0], q[0], t), mix(p[1], q[1], t), mix(p[2], q[2], t)];
const stops = list => list.map(rgb);
const ramp = (list, t) => {
  const k = clamp(t) * (list.length - 1), i = Math.min(list.length - 2, Math.floor(k));
  return mixc(list[i], list[i + 1], k - i);
};

const MEADOW = stops(['#23291a', '#3c4324', '#5a5d2e', '#7d773a', '#a8934a', '#d2b562']);
const STEPPE = stops(['#3f3a26', '#6a5e3a', '#94804f', '#b9a26a', '#d6c28c']);
const PEAT = stops(['#1b1e15', '#2f3320', '#454a2a', '#6a6a38']);
const ROCK = stops(['#1d1d17', '#34332c', '#535045', '#7a7464']);
const WATER = stops(['#18242a', '#22313a', '#2f4048']);   // море, озёра и окна болот одного цвета
const RIVER = '#35494f';
const TRACK = ['#8a7648', '#5f5032', '#9c8654', '#74633c'];   // мазки укатанной земли
const FLOOR = [14, 18, 12];                               // земля под кронами
const CROWN_DARK = ['#1b2315', '#232d19', '#2e3a20', '#28331c'];
const CROWN_LIT = [['#303c25', '#2a3520', '#374329'], ['#4f5a30', '#414e2c', '#5d6636'], ['#8f8c48', '#6f7a3c', '#a89a50', '#59653a']];

// Коды местности в сетке. Вода меньше двух.
const BLOOD = '46,36,32';   // цвет, на который умножается клетка под кровью: земля и лес чернеют
const BONE = '#a89e86', BONE_INK = '#17120b', CROW = '#14110e';
const CODE = { sea: 0, lake: 1, field: 2, ruins: 2, forest: 3, swamp: 4, desert: 5, mountain: 6 };
const DRY = 2, WOOD = 3, MIRE = 4, SAND = 5, CRAG = 6;

function makeNoise(seed) {
  const rnd = seeded(seed), P = new Uint16Array(512), V = new Float32Array(256);
  const order = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  for (let i = 0; i < 512; i++) P[i] = order[i & 255];
  for (let i = 0; i < 256; i++) V[i] = rnd();
  const n = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = V[P[(P[ix & 255] + iy) & 255]], b = V[P[(P[(ix + 1) & 255] + iy) & 255]];
    const c = V[P[(P[ix & 255] + iy + 1) & 255]], d = V[P[(P[(ix + 1) & 255] + iy + 1) & 255]];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  n.fbm = (x, y, oct = 3) => {
    let sum = 0, amp = 0.5, f = 1, all = 0;
    for (let i = 0; i < oct; i++) { sum += n(x * f, y * f) * amp; all += amp; amp *= 0.5; f *= 2.03; }
    return sum / all;
  };
  return n;
}

// Случайное число, привязанное к месту: одно и то же при полной карте и при перекраске куска.
function hash(i, j, k = 0) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h = Math.imul(h ^ (h >>> 16), 2654435761);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function lattice(box, sx, sy, pad, visit) {
  const j0 = Math.floor((box.y0 - pad) / sy), j1 = Math.ceil((box.y1 + pad) / sy);
  const i0 = Math.floor((box.x0 - pad) / sx), i1 = Math.ceil((box.x1 + pad) / sx);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) visit(i, j, i * sx + (j & 1) * sx * 0.5, j * sy);
}

function boxBlur(src, w, h, r) {
  const a = new Float32Array(w * h), b = new Float32Array(w * h), n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[y * w + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      a[y * w + x] = sum / n;
      sum += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += a[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      b[y * w + x] = sum / n;
      sum += a[Math.min(h - 1, y + r + 1) * w + x] - a[Math.max(0, y - r) * w + x];
    }
  }
  return b;
}

// Кусок карты в частой сетке. Узлы сетки общие для всей карты, поэтому маски совпадают при любом размере куска.
class Patch {
  constructor(land, x0, y0, x1, y1) {
    const { map } = land.view, S = land.step, n = land.noise;
    Object.assign(this, { S, cache: new Map() });
    this.gx = Math.floor(x0 / S);
    this.gy = Math.floor(y0 / S);
    this.w = Math.ceil(x1 / S) - this.gx + 1;
    this.h = Math.ceil(y1 / S) - this.gy + 1;
    this.kind = new Uint8Array(this.w * this.h);
    for (let y = 0, i = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++, i++) {
        const px = (this.gx + x) * S, py = (this.gy + y) * S;
        const dx = (n.fbm(px * 0.011, py * 0.011) - 0.5) * 2 + (n(px * 0.05, py * 0.05) - 0.5) * 0.5;
        const dy = (n.fbm(px * 0.011 + 40, py * 0.011 + 9) - 0.5) * 2 + (n(px * 0.05 + 7, py * 0.05) - 0.5) * 0.5;
        const id = tileAt(map, px + dx * WARP, py + dy * WARP);
        this.kind[i] = id < 0 ? 0 : CODE[map.tiles[id].t] ?? DRY;
      }
    }
  }

  mask(name, test, radius) {
    const key = `${name}:${radius}`;
    if (this.cache.has(key)) return this.cache.get(key);
    let a = new Float32Array(this.kind.length);
    for (let i = 0; i < a.length; i++) a[i] = test(this.kind[i]) ? 1 : 0;
    const r = Math.max(1, Math.round((radius * 3) / this.S));
    for (let pass = 0; pass < 2; pass++) a = boxBlur(a, this.w, this.h, r);
    this.cache.set(key, a);
    return a;
  }

  dry(radius) { return this.mask('dry', k => k >= DRY, radius); }
  wood(radius) { return this.mask('wood', k => k === WOOD, radius); }

  // Индекс ближайшего узла или -1 за пределами куска.
  at(x, y) {
    const cx = Math.round(x / this.S) - this.gx, cy = Math.round(y / this.S) - this.gy;
    return cx < 0 || cy < 0 || cx >= this.w || cy >= this.h ? -1 : cy * this.w + cx;
  }

  // Изолиния поля: берега как настоящая линия, а не края шестиугольников.
  iso(field, level) {
    const path = new Path2D(), { w, h, S, gx, gy } = this;
    const t = (a, b) => (level - a) / (b - a);
    const seg = (p, q) => { path.moveTo((gx + p[0]) * S, (gy + p[1]) * S); path.lineTo((gx + q[0]) * S, (gy + q[1]) * S); };
    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const i = y * w + x, a = field[i], b = field[i + 1], c = field[i + w + 1], d = field[i + w];
        const k = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
        if (k === 0 || k === 15) continue;
        const top = () => [x + t(a, b), y], right = () => [x + 1, y + t(b, c)];
        const bottom = () => [x + t(d, c), y + 1], left = () => [x, y + t(a, d)];
        if (k === 1 || k === 14) seg(left(), bottom());
        else if (k === 2 || k === 13) seg(bottom(), right());
        else if (k === 3 || k === 12) seg(left(), right());
        else if (k === 4 || k === 11) seg(top(), right());
        else if (k === 6 || k === 9) seg(top(), bottom());
        else if (k === 7 || k === 8) seg(left(), top());
        else if (k === 5) { seg(left(), top()); seg(bottom(), right()); }
        else { seg(left(), bottom()); seg(top(), right()); }
      }
    }
    return path;
  }
}

// Реки: мягкая линия с волной, ширина растёт к устью.
function riverLines(map) {
  return map.rivers.map(river => {
    const rnd = seeded(Math.round(river[0].x + river[0].y)), raw = [];
    for (let i = 0; i < river.length - 1; i++) {
      const a = river[i], b = river[i + 1];
      const nx = -(b.y - a.y), ny = b.x - a.x, len = Math.hypot(nx, ny) || 1;
      for (let k = 0; k < 3; k++) {
        const t = k / 3, wave = Math.sin(t * Math.PI) * (rnd() - 0.5) * 26;
        raw.push({ x: a.x + (b.x - a.x) * t + (nx / len) * wave, y: a.y + (b.y - a.y) * t + (ny / len) * wave });
      }
    }
    raw.push(river[river.length - 1]);
    const out = [];
    for (let i = 0; i < raw.length - 1; i++) {
      const p = raw[Math.max(0, i - 1)], a = raw[i], b = raw[i + 1], q = raw[Math.min(raw.length - 1, i + 2)];
      for (let k = 0; k < 4; k++) {
        const t = k / 4, t2 = t * t, t3 = t2 * t;
        const f = (p0, p1, p2, p3) => 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
        out.push({ x: f(p.x, a.x, b.x, q.x), y: f(p.y, a.y, b.y, q.y), w: 3 + ((i + t) / raw.length) * 8 });
      }
    }
    return out;
  });
}

function strokeRiver(ctx, line, color, extra) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 1; i < line.length; i += 2) {
    const a = line[i - 1], b = line[Math.min(line.length - 1, i + 1)];
    ctx.lineWidth = Math.max(0.6, b.w + extra);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(line[i].x, line[i].y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

// Линия дороги со сдвигом вбок: колеи идут вдоль неё.
function offset(line, shift) {
  const path = new Path2D();
  line.forEach((p, i) => {
    const q = line[Math.min(line.length - 1, i + 1)], o = line[Math.max(0, i - 1)];
    const dx = q.x - o.x, dy = q.y - o.y, len = Math.hypot(dx, dy) || 1;
    const x = p.x - (dy / len) * shift, y = p.y + (dx / len) * shift;
    if (i) path.lineTo(x, y); else path.moveTo(x, y);
  });
  return path;
}

const dab = (c, x, y, rx, ry, a, color) => {
  c.fillStyle = color;
  c.beginPath();
  c.ellipse(x, y, rx, ry, a, 0, TAU);
  c.fill();
};

function spire(variant) {
  const canvas = document.createElement('canvas');
  canvas.width = 72;
  canvas.height = 132;
  const c = canvas.getContext('2d'), r = seeded(variant * 13 + 9);
  c.scale(3, 3);
  c.translate(12, 42);
  c.fillStyle = '#0f140d';
  c.beginPath();
  c.moveTo(0, -41);
  for (let k = 0; k <= 8; k++) c.lineTo(-(1 + k * 1.15) - r() * 1.4, -38 + k * 4.7);
  c.lineTo(0, -1);
  for (let k = 8; k >= 0; k--) c.lineTo((1 + k * 1.15) + r() * 1.4, -38 + k * 4.7);
  c.closePath();
  c.fill();
  return canvas;
}

function grain(size, seed, strength) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d'), rnd = seeded(seed), image = c.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = 128 + (rnd() - 0.5) * strength;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  c.putImageData(image, 0, 0);
  return canvas;
}

export class Land {
  constructor(view, { phone = false } = {}) {
    this.view = view;
    this.phone = phone;
    this.step = phone ? 5 : 3;
    this.noise = makeNoise(11);
    this.rivers = riverLines(view.map);
    this.spires = [0, 1, 2].map(spire);
    this.grain = grain(512, 7, 40);
    this.known = new Map();
    this.refresh();
  }

  // Линии дорог: на клетке дуга от входа к выходу, на развилке ветки сходятся в середине.
  roadLines() {
    const { map, centers, supply } = this.view, { tiles } = map, out = [];
    const carries = id => tiles[id].road || tiles[id].town;
    const straight = (a, b, n) => Array.from({ length: n + 1 }, (_, k) => ({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }));
    for (const t of tiles) {
      if (!t.road) continue;
      const a = centers[t.id];
      const ends = neighbors(map, t.id).filter(carries).map(id => ({ x: (a.x + centers[id].x) / 2, y: (a.y + centers[id].y) / 2 }));
      if (ends.length === 2) {
        const [p, q] = ends, line = [];
        for (let k = 0; k <= 16; k++) {
          const f = k / 16, u = 1 - f;
          line.push({ x: u * u * p.x + 2 * u * f * a.x + f * f * q.x, y: u * u * p.y + 2 * u * f * a.y + f * f * q.y });
        }
        out.push(line);
      } else if (ends.length) for (const e of ends) out.push(straight(a, e, 8));
      else out.push(straight({ x: a.x - LONE, y: a.y }, { x: a.x + LONE, y: a.y }, 8));
    }
    // Лагерь не дорога, но путь телег доходит до него. Морем туда идут лодочки, дороги на воде нет.
    // Путь к ненайденному лагерю обрезан: он кончается на дороге, поселении или воде, и линии там быть не должно.
    for (const { camp, cells } of supply) {
      const end = cells[cells.length - 1], by = cells[cells.length - 2];
      if (camp && !carries(end) && !isWater(map, end) && !isWater(map, by)) out.push(straight(centers[by], centers[end], 12));
    }
    return out;
  }

  // Сверяет дороги с клетками и возвращает изменившиеся линии, новые и исчезнувшие.
  refresh() {
    const key = l => [l[0], l[l.length >> 1], l[l.length - 1]].map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ');
    const lines = this.roadLines(), next = new Map(lines.map(l => [key(l), l]));
    const moved = [...lines.filter(l => !this.known.has(key(l))), ...[...this.known].filter(([k]) => !next.has(k)).map(([, l]) => l)];
    this.lines = lines;
    this.known = next;
    return moved;
  }

  // Колея: укатанная земля с рваным краем и две тёмные колеи. Мазок привязан к месту, поэтому перекраска не оставит шва.
  ruts(ctx, box) {
    const pad = 16, near = p => p.x > box.x0 - pad && p.x < box.x1 + pad && p.y > box.y0 - pad && p.y < box.y1 + pad;
    const lines = this.lines.filter(l => l.some(near));
    if (!lines.length) return;
    const whole = new Path2D();
    for (const line of lines) whole.addPath(offset(line, 0));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [color, width] of [['rgba(14,11,6,.55)', 12], ['#6f5e3b', 9]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke(whole);
    }
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        const p = line[i], o = line[i - 1], a = Math.atan2(p.y - o.y, p.x - o.x);
        for (const side of [-1, 1]) {
          const v = hash(Math.round(p.x * 10), Math.round(p.y * 10), side + 60), off = side * (2 + v * 3);
          ctx.strokeStyle = TRACK[Math.floor(v * TRACK.length)];
          ctx.lineWidth = 2.4 + v * 2.2;
          ctx.beginPath();
          ctx.moveTo(p.x - Math.sin(a) * off - Math.cos(a) * 4, p.y + Math.cos(a) * off - Math.sin(a) * 4);
          ctx.lineTo(p.x - Math.sin(a) * off + Math.cos(a) * 4, p.y + Math.cos(a) * off + Math.sin(a) * 4);
          ctx.stroke();
        }
      }
    }
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(20,14,7,.72)';
    ctx.lineWidth = 1.2;
    for (const line of lines) for (const shift of [-2.5, 2.5]) ctx.stroke(offset(line, shift));
  }

  // Просека в сетке куска: 1 у дороги, к краю сходит на нет.
  roadCut(p) {
    const cut = new Float32Array(p.w * p.h), S = p.S, r = Math.ceil(CUT.far / S);
    for (const { x, y } of this.lines.flat()) {
      const cx = Math.round(x / S) - p.gx, cy = Math.round(y / S) - p.gy;
      if (cx < -r || cy < -r || cx > p.w + r || cy > p.h + r) continue;
      for (let dy = -r; dy <= r; dy++) {
        const row = cy + dy;
        if (row < 0 || row >= p.h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const col = cx + dx;
          if (col < 0 || col >= p.w) continue;
          const v = 1 - smooth(CUT.near, CUT.far, Math.hypot(dx, dy) * S), i = row * p.w + col;
          if (v > cut[i]) cut[i] = v;
        }
      }
    }
    return cut;
  }

  // Подмалёвок: цвет земли, свет сквозь тучи, тень от леса, вода.
  underpaint(ctx, p) {
    const n = this.noise, { w, h, gx, gy, S, cut } = p, W = w;
    const dry = p.dry(3), forest = p.wood(3);
    const swamp = p.mask('mire', k => k === MIRE, 6), desert = p.mask('sand', k => k === SAND, 7), rock = p.mask('rock', k => k === CRAG, 3);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext('2d'), image = c.createImageData(w, h), { data } = image;
    const light = new Float32Array(w * h);
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i++) {
        const px = (gx + x) * S, py = (gy + y) * S;
        const fine = n.fbm(px * 0.022, py * 0.022, 3);
        const water = ramp(WATER, 0.5 + (fine - 0.5) * 0.9);
        let col = water;
        if (dry[i] > 0.4) {
          const broad = n.fbm(px * 0.0065, py * 0.0065, 3);
          const sun = smooth(0.42, 0.6, n.fbm(px * 0.0015 + 3, py * 0.0023 + 8, 4));
          light[i] = sun;
          const t = 0.14 + sun * 0.58 + (broad - 0.5) * 0.6 + (fine - 0.5) * 0.28;
          col = ramp(MEADOW, t);
          if (desert[i] > 0.2) col = mixc(col, ramp(STEPPE, t + 0.06), smooth(0.2, 0.7, desert[i]));
          if (swamp[i] > 0.2) {
            col = mixc(col, ramp(PEAT, t), smooth(0.2, 0.65, swamp[i]));
            if (swamp[i] > 0.42) col = mixc(col, water, smooth(0.54, 0.6, n.fbm(px * 0.021 + 5, py * 0.036, 3)) * smooth(0.42, 0.62, swamp[i]));
          }
          // Под горой камень того же тона, что её подножие: клетка читается как часть горы.
          if (rock[i] > 0.34) col = mixc(col, ramp(ROCK, 0.32 + (fine - 0.5) * 0.5 + (broad - 0.5) * 0.3), smooth(0.34, 0.56, rock[i]));
          const reach = i - Math.round(18 / S) * W - Math.round(33 / S);
          const cast = Math.max(0, (reach >= 0 ? forest[reach] : 0) - forest[i] * 0.6);
          if (cast > 0) col = mixc(col, [10, 12, 8], cast * 0.72 * (1 - cut[i] * 0.7));
          // На просеке лесной тени нет: там открытая земля.
          if (forest[i] > 0.34) col = mixc(col, FLOOR, smooth(0.34, 0.56, forest[i]) * (1 - cut[i]));
          col = mixc(water, col, smooth(0.45, 0.55, dry[i]));
        }
        data[i * 4] = col[0];
        data[i * 4 + 1] = col[1];
        data[i * 4 + 2] = col[2];
        data[i * 4 + 3] = 255;
      }
    }
    c.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, gx * S, gy * S, w * S, h * S);
    Object.assign(p, { data, light });
  }

  // Подмалёвок мазками: направление плывёт, на воде мазок лежит горизонтально.
  daubs(ctx, p, box) {
    const n = this.noise, dry = p.dry(3), { data } = p, thin = this.phone ? 1.5 : 1;
    ctx.lineCap = 'round';
    lattice(box, 8 * thin, 6.5 * thin, 34, (i, j, x, y) => {
      const qx = x + (hash(i, j, 1) - 0.5) * 8, qy = y + (hash(i, j, 2) - 0.5) * 7, at = p.at(qx, qy);
      if (at < 0) return;
      const wet = dry[at] < 0.5, k = at * 4;
      const v = (hash(i, j, 3) - 0.5) * (wet ? 7 : 20), warm = (hash(i, j, 4) - 0.5) * 7;
      const a = wet ? (hash(i, j, 5) - 0.5) * 0.12 : -0.45 + (n(qx * 0.004, qy * 0.004) - 0.5) * 2.2;
      const l = (wet ? 16 : 9) + hash(i, j, 6) * 15;
      ctx.strokeStyle = `rgb(${data[k] + v + warm | 0},${data[k + 1] + v | 0},${data[k + 2] + v - warm | 0})`;
      ctx.lineWidth = (3 + hash(i, j, 7) * 6) * thin;
      ctx.beginPath();
      ctx.moveTo(qx, qy);
      ctx.lineTo(qx + Math.cos(a) * l, qy + Math.sin(a) * l);
      ctx.stroke();
    });
  }

  // Блики травы там, где солнце дошло до земли, и осока на болоте.
  flecks(ctx, p, box) {
    const dry = p.dry(3), forest = p.wood(3), { light } = p;
    const rock = p.mask('rock', k => k === CRAG, 3), swamp = p.mask('mire', k => k === MIRE, 6);
    lattice(box, 38, 38, 16, (i, j, x, y) => {
      const qx = x + hash(i, j, 11) * 38, qy = y + hash(i, j, 12) * 38, at = p.at(qx, qy);
      if (at < 0 || dry[at] < 0.6 || forest[at] > 0.4 || rock[at] > 0.5) return;
      const lit = light[at];
      if (hash(i, j, 13) > 0.1 + lit * 0.7) return;
      const pick = hash(i, j, 14);
      ctx.strokeStyle = lit > 0.5 ? (pick < 0.5 ? '#e0c876' : '#b9b05a') : '#55592f';
      ctx.globalAlpha = 0.28 + hash(i, j, 15) * 0.4;
      ctx.lineWidth = 1 + hash(i, j, 16) * 1.6;
      ctx.beginPath();
      ctx.moveTo(qx, qy);
      ctx.lineTo(qx + 3 + hash(i, j, 17) * 7, qy - 2 - hash(i, j, 18) * 4);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    lattice(box, 57, 57, 16, (i, j, x, y) => {
      const qx = x + hash(i, j, 21) * 57, qy = y + hash(i, j, 22) * 57, at = p.at(qx, qy);
      if (at < 0 || swamp[at] < 0.45) return;
      const lit = light[at] > 0.5, pick = hash(i, j, 23);
      ctx.strokeStyle = lit ? (pick < 0.5 ? '#8f7d40' : '#6f6a36') : (pick < 0.5 ? '#4d4a26' : '#3a3d22');
      ctx.lineWidth = 1 + hash(i, j, 24) * 1.4;
      ctx.beginPath();
      ctx.moveTo(qx, qy + 3);
      ctx.lineTo(qx + 1 + hash(i, j, 25) * 3, qy - 5 - hash(i, j, 26) * 6);
      ctx.stroke();
    });
  }

  // Берег моря и озера одинаковый: тёмная кромка и песчаная нитка.
  shores(ctx, p, box) {
    const dry = p.dry(3);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#15170f';
    ctx.lineWidth = 6;
    ctx.stroke(p.iso(dry, 0.5));
    ctx.strokeStyle = 'rgba(168,150,100,.6)';
    ctx.lineWidth = 2.5;
    ctx.stroke(p.iso(dry, 0.56));
    for (const r of this.rivers) {
      if (!r.some(q => q.x > box.x0 - 12 && q.x < box.x1 + 12 && q.y > box.y0 - 12 && q.y < box.y1 + 12)) continue;
      strokeRiver(ctx, r, '#141710', 5);
      strokeRiver(ctx, r, RIVER, 0);
    }
  }

  // Лес: кроны и ели тёмной массой, край на солнце светится.
  woods(ctx, p, box) {
    const hard = p.wood(1), forest = p.wood(3), { light, cut } = p, thin = this.phone ? 1.25 : 1;
    // Дерево стоит на просеке, если заслоняет её стволом или кроной: кроны растут вверх от основания.
    const felled = (x, y, tall) => [0, 0.33, 0.66, 1].some(k => {
      const at = p.at(x, y - tall * k);
      return at >= 0 && cut[at] > 0.4;
    });
    const list = [];
    lattice(box, 15 * thin, 12.3 * thin, 60, (i, j, x, y) => {
      const qx = x + (hash(i, j, 31) - 0.5) * 13.5, qy = y + (hash(i, j, 32) - 0.5) * 10.5, at = p.at(qx, qy);
      if (at < 0 || hard[at] <= 0.46) return;
      const tall = hash(i, j, 40) < 0.32 ? 44 * (0.8 + hash(i, j, 42) * 0.5) : (11 + hash(i, j, 41) * 6) * thin * 1.6;
      if (!felled(qx, qy, tall)) list.push([qx, qy, i, j]);
    });
    list.sort((a, b) => a[1] - b[1]);
    for (const [x, y, i, j] of list) {
      let seq = 40;
      const rnd = () => hash(i, j, seq++);
      const back = p.at(x - 20, y - 16);
      const glow = clamp(light[p.at(x, y)] * 0.6 + (1 - (back < 0 ? 1 : forest[back])) * 0.7);
      const tone = CROWN_LIT[glow > 0.62 ? 2 : glow > 0.3 ? 1 : 0];
      if (rnd() < 0.32) {
        const s = this.spires[Math.floor(rnd() * 3)], k = 0.8 + rnd() * 0.5, sw = 24 * k, sh = 44 * k;
        ctx.drawImage(s, x - sw / 2, y - sh, sw, sh);
        for (let t = 0.3; t < 1; t += 0.14) {
          const py = y - sh * (1 - t), half = (sw * t) / 2.5;
          dab(ctx, x - half * (0.3 + rnd() * 0.6), py + rnd() * 3, 1.6 + rnd() * 2.2, 1.1 + rnd() * 1.2, -0.5, tone[0]);
        }
        continue;
      }
      const r = (11 + rnd() * 6) * thin;
      dab(ctx, x + 3, y - r * 0.2, r * 1.15, r, 0, '#11160e');
      for (let k = 0; k < (this.phone ? 8 : 16); k++) {
        const a = rnd() * TAU, d = r * 0.8 * Math.sqrt(rnd());
        dab(ctx, x + Math.cos(a) * d, y - r * 0.4 + Math.sin(a) * d * 0.72, 1.8 + rnd() * 3.2, 1.3 + rnd() * 2.2, a, CROWN_DARK[Math.floor(rnd() * 4)]);
      }
      for (let k = 0; k < (this.phone ? 6 : 11); k++) {
        const qx = x - r * 0.75 + rnd() * r * 1.1, qy = y - r * 1.05 + rnd() * r * 0.9;
        dab(ctx, qx, qy, 1.2 + rnd() * 2.2, 0.9 + rnd() * 1.5, rnd() * 3, tone[Math.floor(rnd() * tone.length)]);
      }
    }
  }

  // Следы побоища: редкие кости на открытой земле и вороны, где крови много. В горах ничего.
  battlefield(ctx, t, c, k) {
    if (t.t === 'mountain') return;
    const rnd = seeded(t.id * 13 + 5);
    const spot = () => {
      const a = rnd() * TAU, r = Math.sqrt(rnd()) * R * 0.7;
      return [c.x + Math.cos(a) * r, c.y + Math.sin(a) * r * 0.78];
    };
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = BONE_INK;
    ctx.fillStyle = BONE;
    ctx.globalAlpha = 0.7;
    for (let i = t.t === 'forest' ? 0 : Math.round(3 * k); i > 0; i--) {
      const [x, y] = spot(), a = rnd() * Math.PI, dx = Math.cos(a) * 5, dy = Math.sin(a) * 5;
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy); ctx.stroke();
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = BONE;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy); ctx.stroke();
      ctx.strokeStyle = BONE_INK;
      ctx.lineWidth = 0.7;
      for (const [ex, ey] of [[x, y], [x + dx, y + dy]]) {
        ctx.beginPath(); ctx.arc(ex, ey, 1.3, 0, TAU); ctx.fill(); ctx.stroke();
      }
    }
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = CROW;
    for (let i = k < 0.4 ? 0 : k < 0.8 ? 1 : 2; i > 0; i--) {
      const [x, y] = spot(), d = rnd() < 0.5 ? -1 : 1;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(d * 0.75, 0.75);
      ctx.beginPath(); ctx.ellipse(0, 0, 5, 3.2, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(4.5, -3, 2.2, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-4, -1); ctx.lineTo(-9, -3); ctx.lineTo(-8, 1.5); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(6.4, -3.4); ctx.lineTo(9, -2.6); ctx.lineTo(6.4, -2); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // Гниль и сетка клеток лежат и на лесу, и на земле под ним.
  finish(ctx, box) {
    const { view } = this, near = t => {
      const c = view.centers[t.id];
      return c.x > box.x0 - R * 2 && c.x < box.x1 + R * 2 && c.y > box.y0 - R * 2 && c.y < box.y1 + R * 2;
    };
    const list = view.map.tiles.filter(near);
    // Где пролилась кровь, земля и лес чернеют до предела, а по полю лежат кости и сидит вороньё.
    for (const t of list) {
      if (!t.blood) continue;
      const c = view.centers[t.id], k = bloodLevel(t.blood);
      const stain = ctx.createRadialGradient(0, 0, R * 0.35, 0, 0, R * 1.15);
      stain.addColorStop(0, `rgba(${BLOOD},${0.85 * k})`);
      stain.addColorStop(0.6, `rgba(${BLOOD},${0.65 * k})`);
      stain.addColorStop(1, `rgba(${BLOOD},0)`);
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.translate(c.x, c.y);
      ctx.scale(1, 0.8);
      ctx.fillStyle = stain;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.15, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    for (const t of list) if (t.blood) this.battlefield(ctx, t, view.centers[t.id], bloodLevel(t.blood));
    for (const t of list) {
      if (!t.rot) continue;
      const c = view.centers[t.id], dark = Math.min(0.72, t.rot * 0.18);
      const stain = ctx.createRadialGradient(0, 0, R * 0.55, 0, 0, R * 1.12);
      stain.addColorStop(0, `rgba(8,6,4,${dark})`);
      stain.addColorStop(1, 'rgba(8,6,4,0)');
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(1, 0.8);
      ctx.fillStyle = stain;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.12, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(238,228,192,.17)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const t of list) {
      const c = view.centers[t.id];
      corners(c.x, c.y).forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
    }
    ctx.stroke();
  }

  // Рисует кусок карты: box в координатах мира. Без куска рисуется вся карта.
  paint(box = { x0: 0, y0: 0, x1: this.view.size.w, y1: this.view.size.h }) {
    const { view } = this, { w, h } = view.size, ctx = view.groundCtx, under = view.bareCtx;
    const p = new Patch(this, Math.max(0, box.x0 - MARGIN), Math.max(0, box.y0 - MARGIN), Math.min(w, box.x1 + MARGIN), Math.min(h, box.y1 + MARGIN));
    p.cut = this.roadCut(p);
    const clip = c => { c.save(); c.beginPath(); c.rect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0); c.clip(); };
    clip(ctx);
    this.underpaint(ctx, p);
    this.daubs(ctx, p, box);
    this.flecks(ctx, p, box);
    this.shores(ctx, p, box);
    this.ruts(ctx, box);
    clip(under);
    const k = view.res;
    under.drawImage(ctx.canvas, box.x0 * k, box.y0 * k, (box.x1 - box.x0) * k, (box.y1 - box.y0) * k, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    this.finish(under, box);
    under.restore();
    this.woods(ctx, p, box);
    this.finish(ctx, box);
    // Лак и холст: фактура ложится поверх всего.
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = ctx.createPattern(this.grain, 'repeat');
    ctx.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    ctx.restore();
  }
}
