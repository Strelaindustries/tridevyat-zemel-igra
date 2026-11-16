// Горы, поселения и руины мазками, в том же письме, что и земля в land.js. Свет слева сверху.
const TAU = Math.PI * 2;
const clamp = v => Math.min(1, Math.max(0, v));
const mix = (a, b, t) => a + (b - a) * t;
const ROCK = ['#1d1d17', '#34332c', '#535045', '#7a7464'].map(s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16)));

function rockTone(t) {
  const k = clamp(t) * (ROCK.length - 1), i = Math.min(ROCK.length - 2, Math.floor(k)), f = k - i;
  return `rgb(${ROCK[i].map((v, n) => Math.round(mix(v, ROCK[i + 1][n], f))).join(',')})`;
}

const dab = (c, x, y, rx, ry, a, color) => {
  c.fillStyle = color;
  c.beginPath();
  c.ellipse(x, y, rx, ry, a, 0, TAU);
  c.fill();
};

function cliff(c, x, y, w, h, rnd) {
  const top = { x: x - w * 0.08 + rnd() * w * 0.12, y: y - h };
  const pts = [{ x: x - w / 2, y }];
  for (let i = 1; i < 5; i++) pts.push({ x: mix(x - w / 2, top.x, i / 5) + (rnd() - 0.5) * 7, y: mix(y, top.y, i / 5) + (rnd() - 0.5) * 6 });
  pts.push(top);
  for (let i = 1; i < 5; i++) pts.push({ x: mix(top.x, x + w / 2, i / 5) + (rnd() - 0.5) * 7, y: mix(top.y, y, i / 5) + (rnd() - 0.5) * 6 });
  pts.push({ x: x + w / 2, y: y + 2 });
  const body = new Path2D();
  pts.forEach((p, i) => (i ? body.lineTo(p.x, p.y) : body.moveTo(p.x, p.y)));
  body.closePath();
  c.fillStyle = '#23231d';
  c.fill(body);
  c.save();
  c.clip(body);
  // Склон мазками по падению, снег только на макушке.
  for (let i = 0; i < 80; i++) {
    const t = rnd(), s = rnd() * 2 - 1;
    const px = top.x + s * w * 0.5 * t, py = top.y + t * h;
    const lit = clamp(0.62 - s * 0.9 + (rnd() - 0.5) * 0.5);
    const a = s < 0 ? 1.12 : 2.0;
    c.strokeStyle = t < 0.28 && s < 0.25 ? '#a29e8f' : rockTone(lit * (1 - t * 0.35));
    c.lineWidth = 2.5 + rnd() * 4;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(px, py);
    c.lineTo(px + Math.cos(a) * (8 + rnd() * 11), py + Math.sin(a) * (8 + rnd() * 11));
    c.stroke();
  }
  c.restore();
}

const INK = '#17120b';
const STONE = '#b3a890', STONE_DARK = '#71675a';
const LOG = ['#7b5f3c', '#54402a', '#3a2c1c'];

// Всё строение обводится пером, как значки на листе с доски: заливка плотная, контур чёткий.
function shape(c, pts, fill, width = 1.3) {
  c.beginPath();
  pts.forEach(([a, b], i) => (i ? c.lineTo(a, b) : c.moveTo(a, b)));
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  c.strokeStyle = INK;
  c.lineWidth = width;
  c.lineJoin = 'round';
  c.stroke();
}

// Черта земли под постройкой: так значки стоят на листе.
function earth(c, x0, x1, y) {
  c.strokeStyle = INK;
  c.lineWidth = 1.1;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(x0, y); c.lineTo(x1, y);
  c.moveTo(x0 + 7, y + 3); c.lineTo(x0 + (x1 - x0) * 0.42, y + 3);
  c.moveTo(x0 + (x1 - x0) * 0.6, y + 3); c.lineTo(x1 - 5, y + 3);
  c.stroke();
}

// Стена или башня: белёный камень, правая сторона в тени, контур пером.
function block(c, x, y, w, h, lit = STONE, shade = STONE_DARK) {
  c.fillStyle = lit;
  c.fillRect(x - w / 2, y - h, w, h);
  c.fillStyle = shade;
  c.fillRect(x + w * 0.12, y - h, w * 0.38, h);
  c.strokeStyle = INK;
  c.lineWidth = 1.3;
  c.strokeRect(x - w / 2, y - h, w, h);
}

// Частокол: брёвна с заострёнными концами, правая часть в тени.
function palisade(c, x0, x1, y, h, rnd) {
  const mid = x0 + (x1 - x0) * 0.56;
  for (let x = x0; x < x1; x += 5) {
    const top = y - h - rnd() * 1.6;
    shape(c, [[x, y], [x, top + 2.6], [x + 2.5, top - 1.6], [x + 5, top + 2.6], [x + 5, y]], x < mid ? LOG[0] : LOG[1], 0.95);
  }
}

// Основание острога: скала с осыпью, дальний частокол и вежа.
function stockade(c, rnd) {
  dab(c, 12, 24, 32, 5, 0, 'rgba(10,10,6,.5)');
  shape(c, [[-38, 24], [-27, 9], [-15, 3], [17, 2], [28, 10], [38, 24]], '#55503f', 1.6);
  c.strokeStyle = INK;
  c.lineWidth = 1;
  c.beginPath();
  for (let i = 0; i < 9; i++) {
    const x = -30 + i * 6.8 + rnd() * 3, y = 13 + rnd() * 3;
    c.moveTo(x, y); c.lineTo(x + 2 + rnd() * 3, y + 5 + rnd() * 4);
  }
  c.stroke();
  palisade(c, -24, 24, 3, 10, rnd);
  vezha(c, 0, 3, 12, 20, 13);
}

function izba(c, x, y, s, rnd) {
  const w = (10 + rnd() * 2.4) * s, h = 7.4 * s, peak = (7.6 + rnd() * 2) * s, deep = (11 + rnd() * 5) * s, lift = 4.6 * s;
  const roof = rnd() < 0.6 ? ['#a18c58', '#6c5d3a'] : ['#6f4f3c', '#46322a'];
  dab(c, x + deep * 0.5 + 3 * s, y + 1, w + deep * 0.6, 3 * s, 0, 'rgba(10,10,6,.42)');
  shape(c, [[x + w, y], [x + w + deep, y - lift], [x + w + deep, y - lift - h], [x + w, y - h]], '#3b2e1e');
  shape(c, [[x, y - h - peak], [x + w, y - h], [x + w + deep, y - lift - h], [x + deep, y - lift - h - peak]], roof[1]);
  shape(c, [[x - w, y], [x + w, y], [x + w, y - h], [x, y - h - peak], [x - w, y - h]], '#79603e');
  shape(c, [[x - w - 1.4 * s, y - h + 1.2 * s], [x, y - h - peak - 1.4 * s], [x + 2.2 * s, y - h - peak + 0.4 * s], [x - w + 1.4 * s, y - h + 1.2 * s]], roof[0], 1);
  c.fillStyle = '#e0b35a';
  c.fillRect(x - 2 * s, y - h * 0.72, 4 * s, 3.2 * s);
  c.strokeStyle = INK;
  c.lineWidth = 0.8;
  c.strokeRect(x - 2 * s, y - h * 0.72, 4 * s, 3.2 * s);
}

function onion(c, x, y, r, fill = '#c9a24e') {
  c.beginPath();
  c.moveTo(x - r, y);
  c.bezierCurveTo(x - r * 1.5, y - r * 0.9, x - r * 0.3, y - r * 1.2, x, y - r * 2.2);
  c.bezierCurveTo(x + r * 0.3, y - r * 1.2, x + r * 1.5, y - r * 0.9, x + r, y);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  c.strokeStyle = INK;
  c.lineWidth = 1.2;
  c.stroke();
  c.save();
  c.clip();
  c.fillStyle = 'rgba(40,24,8,.42)';
  c.fillRect(x + r * 0.15, y - r * 2.4, r * 2, r * 2.6);
  c.restore();
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(x, y - r * 2.2); c.lineTo(x, y - r * 3.1);
  c.moveTo(x - r * 0.42, y - r * 2.72); c.lineTo(x + r * 0.42, y - r * 2.72);
  c.stroke();
}

function teeth(c, x0, x1, y) {
  c.strokeStyle = INK;
  c.lineWidth = 1.1;
  for (let x = x0; x < x1 - 3; x += 7.4) {
    c.fillStyle = x < (x0 + x1) / 2 + 8 ? STONE : STONE_DARK;
    c.fillRect(x, y - 3, 4.4, 3);
    c.strokeRect(x, y - 3, 4.4, 3);
  }
}

function tower(c, x, y, w, h, roof, tip = ['#4c5d4c', '#2a362c']) {
  block(c, x, y, w, h);
  c.fillStyle = INK;
  c.fillRect(x - 1, y - h * 0.74, 2, 4.4);
  shape(c, [[x - w * 0.68, y - h], [x, y - h - roof], [x, y - h]], tip[0]);
  shape(c, [[x, y - h - roof], [x + w * 0.68, y - h], [x, y - h]], tip[1]);
}

// Рубленая вежа: брёвна рядами, верхний сруб шире нижнего, шатровая кровля.
function vezha(c, x, y, w, h, roof) {
  block(c, x, y, w, h, LOG[0], LOG[2]);
  c.strokeStyle = INK;
  c.lineWidth = 0.7;
  c.beginPath();
  for (let k = 3; k < h; k += 4) { c.moveTo(x - w / 2, y - k); c.lineTo(x + w / 2, y - k); }
  c.stroke();
  c.fillStyle = INK;
  c.fillRect(x - 1.1, y - h * 0.72, 2.2, 4);
  block(c, x, y - h + 1, w + 5, 5.4, LOG[0], LOG[2]);
  const top = y - h - 4, half = (w + 9) / 2;
  shape(c, [[x - half, top], [x, top - roof], [x, top]], '#6d5a3a');
  shape(c, [[x, top - roof], [x + half, top], [x, top]], '#40341f');
}

// Общая кисть: поверх рисунка ложатся светлые и тёмные мазки в сторону света, как на земле и горах.
// Форма и контур не трогаются, меняется только фактура. size: ширина мазка в долях обычной.
export function brush(canvas, res, seed = 1, size = 1) {
  const W = canvas.width, H = canvas.height, c = canvas.getContext('2d');
  let a = (seed * 2654435761) >>> 0;
  const rnd = () => { a = (Math.imul(a ^ (a >>> 15), 1 | a) + 0x6d2b79f5) >>> 0; return a / 4294967296; };
  const step = 2.2 * res * size;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-atop';
  c.lineCap = 'round';
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const px = x + (rnd() - 0.5) * step, py = y + (rnd() - 0.5) * step, angle = -0.45 + (rnd() - 0.5) * 0.9;
      const len = (2.4 + rnd() * 3.6) * res * size;
      c.strokeStyle = rnd() < 0.5 ? `rgba(236,220,176,${0.03 + rnd() * 0.07})` : `rgba(18,14,8,${0.04 + rnd() * 0.09})`;
      c.lineWidth = (0.9 + rnd() * 1.2) * res * size;
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(px + Math.cos(angle) * len, py + Math.sin(angle) * len);
      c.stroke();
    }
  }
  const light = c.createLinearGradient(0, 0, W, H);
  light.addColorStop(0.3, 'rgba(226,206,150,.05)');
  light.addColorStop(0.72, 'rgba(14,14,8,.1)');
  c.fillStyle = light;
  c.fillRect(0, 0, W, H);
  c.restore();
  return canvas;
}

// Контур пером вокруг готового рисунка: так существа и лагеря встают в один ряд с постройками.
export function inked(canvas, res) {
  const W = canvas.width, H = canvas.height;
  const shadow = document.createElement('canvas');
  shadow.width = W;
  shadow.height = H;
  const g = shadow.getContext('2d');
  g.drawImage(canvas, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = INK;
  g.fillRect(0, 0, W, H);
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const c = out.getContext('2d'), d = 0.9 * res;
  for (let i = 0; i < 8; i++) c.drawImage(shadow, Math.cos((i * Math.PI) / 4) * d, Math.sin((i * Math.PI) / 4) * d);
  c.drawImage(canvas, 0, 0);
  return out;
}

// Межевой столбик: тёсаный столб с резьбой, поясок и кровелька в цвете царства.
export const POST = { w: 14, h: 18, foot: 16 };

export function borderPost(lit, dark) {
  const canvas = document.createElement('canvas');
  canvas.width = POST.w * 3;
  canvas.height = POST.h * 3;
  const c = canvas.getContext('2d');
  c.scale(3, 3);
  c.translate(POST.w / 2, POST.foot);
  dab(c, 3, -0.5, 6, 1.6, 0, 'rgba(8,8,5,.45)');
  c.fillStyle = lit; c.fillRect(-2.4, -8, 4.8, 8);
  c.fillStyle = dark; c.fillRect(0.4, -8, 2, 8);
  c.fillStyle = '#3a2a19'; c.fillRect(-2.4, -2.6, 4.8, 2.6);
  c.lineJoin = 'round';
  c.strokeStyle = '#17120b';
  c.lineWidth = 0.7;
  c.strokeRect(-2.4, -8, 4.8, 8);
  c.beginPath(); c.moveTo(-6, -7.4); c.lineTo(0, -14.4); c.lineTo(0, -7.4); c.closePath();
  c.fillStyle = lit; c.fill(); c.stroke();
  c.beginPath(); c.moveTo(0, -14.4); c.lineTo(6, -7.4); c.lineTo(0, -7.4); c.closePath();
  c.fillStyle = dark; c.fill(); c.stroke();
  return brush(canvas, 3, 7, 0.3);
}

export const PAINTED = {
  mountain(c, rnd) {
    cliff(c, -30, -10, 66, 56 + rnd() * 12, rnd);
    cliff(c, 32, -8, 62, 50 + rnd() * 14, rnd);
    cliff(c, 0, 20, 78, 64 + rnd() * 12, rnd);
  },
  // Острог с флагом царства. Столица прежняя: терем с куполами за стеной с башнями.
  ostrog(c, rnd) {
    stockade(c, rnd);
    palisade(c, -29, 29, 13, 11, rnd);
    c.fillStyle = INK;
    c.fillRect(-3, 6, 6, 7);
  },
  capital(c, rnd) {
    dab(c, 14, 24, 56, 6, 0, 'rgba(10,10,6,.5)');
    block(c, 0, -2, 26, 28);
    c.fillStyle = INK;
    for (const x of [-6.6, 0, 6.6]) c.fillRect(x - 1.2, -22, 2.4, 7);
    onion(c, 0, -30, 11);
    block(c, -19, 2, 13, 18);
    onion(c, -19, -16, 5.2);
    block(c, 19, 2, 13, 18);
    onion(c, 19, -16, 5.2);
    izba(c, -33, 6, 0.9, rnd);
    izba(c, 26, 7, 0.9, rnd);
    block(c, 0, 24, 88, 14);
    teeth(c, -43, 44, 10);
    tower(c, -46, 24, 13, 25, 16, ['#8a5a3c', '#5a3626']);
    tower(c, 46, 24, 13, 25, 16, ['#8a5a3c', '#5a3626']);
    tower(c, 0, 26, 16, 22, 15, ['#8a5a3c', '#5a3626']);
    c.fillStyle = INK;
    c.beginPath(); c.arc(0, 26, 5, Math.PI, 0); c.fill();
    earth(c, -60, 60, 27);
  },

  // Руины: обломки стен с рваным верхом и кладкой.
  ruins(c, rnd) {
    for (const [x, y, w, h] of [[-2, -10, 19, 24], [-25, 10, 22, 27], [17, 14, 29, 16]]) {
      const top = [[x - w / 2, y], [x - w / 2, y - h], [x - w * 0.18, y - h * (0.6 + rnd() * 0.2)], [x + w * 0.08, y - h * 0.84], [x + w * 0.3, y - h * 0.42], [x + w / 2, y - h * 0.34], [x + w / 2, y]];
      dab(c, x + 9, y + 1, w * 0.8, 3.4, 0, 'rgba(10,10,6,.45)');
      shape(c, top, STONE_DARK, 1.5);
      c.strokeStyle = INK;
      c.lineWidth = 0.9;
      c.beginPath();
      for (let k = 1; k < 4; k++) { c.moveTo(x - w * 0.42, y - (k * h) / 5); c.lineTo(x + w * 0.1, y - (k * h) / 5); }
      c.stroke();
      c.fillStyle = INK;
      c.fillRect(x - 1.6, y - h * 0.46, 3.4, 6);
    }
    earth(c, -40, 34, 18);
  },
};
