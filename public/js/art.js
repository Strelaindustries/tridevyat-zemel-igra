// Вся графика рисуется вектором на canvas: плоские силуэты, стальные шлемы,
// песочные кроны и мягкие тени, цвета сняты пипеткой с референсов.
import { R, SQUASH } from './hex.js';
import { BEASTS } from './beasts.js';
import { PAINTED } from './painted.js';

const TAU = Math.PI * 2;

// Палитра мира «Дремучий бор». Цвета войск живут отдельно и не меняются.
export const PAL = {
  ground: '#5d5d48', groundLo: '#4a4b3a', groundHi: '#676752', tuft: '#4c4d3a',
  shade: '#322a1d', bush: '#2c3024', tan: '#a59a78', tanLo: '#7d7560', tanDk: '#5f5a4a',
  steel: '#bdbdbd', steelLo: '#9a9a9a', white: '#f2f2f2', black: '#000',
  sea: '#2c3f46', seaLo: '#24343a', seaHi: '#3e5a60', shallow: '#c9d6d2', sand: '#8c8c74',
  swamp: '#7c7c5e', murk: '#c4d2c6', desert: '#83805f', desertHi: '#96926e', desertLo: '#6d6a50',
  rock: '#3a3a30', river: '#b9d3dc', lake: '#a3bcbf',
  peakDark: '#3a3a30', peakMid: '#6d6a58', peakLit: '#a39a80', peakCap: '#b4b0a0',
  wall: '#a59a78', wallLo: '#7d7560', roof: '#26261e', grid: 'rgba(0,0,0,.22)',
  stone: '#c4bfae', stoneLo: '#8d897a', stoneDk: '#2b2a24',
};

const CANOPY = '#171c15';
const CROWNS = ['#2c3a28', '#344430', '#3d4e33', '#29352a'];
const CROWN_LIGHT = 'rgba(112,134,92,.42)';
const FIR = '#1b261d';
const INK = 'rgba(8,10,6,.72)';
const WASHES = ['#6d6d54', '#515242', '#787860'];
const BOAT_TRIM = '#8f7a4f', BOAT_TIPS = '#b49964', GNOME_HAT = '#b49964';
const CART_SIDE = '#94713f', CART_END = '#7a5c33', CART_PLANK = 'rgba(38,26,12,.6)', CART_INK = '#17130c', CART_RIM = '#c9a667';

export const FAC = {
  red:    { main: '#b33535', dark: '#952b2d', edge: '#6f2024', shield: 'heater', weapon: 'sword',    cloth: 'swallow', emblem: 'castle', dir: 1 },
  yellow: { main: '#e9ce4f', dark: '#d2b03a', edge: '#a78a2c', shield: 'round',  weapon: 'scimitar', cloth: 'capsule', emblem: 'swirl',  dir: -1 },
  blue:   { main: '#425ea8', dark: '#35508f', edge: '#27396a', shield: 'boss',   weapon: 'axe',      cloth: 'flag',    emblem: 'waves',  dir: 1 },
  teal:   { main: '#34b58f', dark: '#2a9676', edge: '#1d6d56', shield: null,     weapon: 'katana',   cloth: 'nobori',  emblem: 'dots',   dir: 1, hood: true, flagBack: true },
  green:  { main: '#719d48', dark: '#5e843c', edge: '#42602a', shield: null,     weapon: 'claymore', cloth: 'kite',    emblem: 'clover', dir: 1, hood: true, kilt: true },
  copper: { main: '#c9732f', dark: '#ab5f26', edge: '#7c441b', shield: 'round',  weapon: 'sword',    cloth: 'swallow', emblem: 'bell',   dir: 1 },
  snow:   { main: '#d9dde0', dark: '#b9bfc4', edge: '#7f878e', shield: 'round',  weapon: 'sword',    cloth: 'swallow', emblem: 'snow',   dir: 1 },
  dark:   { main: '#4a3a5e', dark: '#382b49', edge: '#211a2c', shield: 'heater', weapon: 'axe',      cloth: 'swallow', emblem: 'moon',   dir: 1 },
  // Войско Тугарина: чёрные знамёна с белой саблей, чёрные щиты, кривые сабли. Ни одно царство так не выглядит.
  horde:  { main: '#3b352b', dark: '#2a2520', edge: '#120f0b', shield: 'round',  weapon: 'scimitar', cloth: 'swallow', emblem: 'saber',  dir: -1 },
};

export function seeded(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Мягкая тень под всем, что стоит на земле. Пятно рисуется один раз и дальше просто штампуется.
const blobs = {};
function shadowBlob(solid) {
  if (blobs[solid]) return blobs[solid];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(33,28,19,1)');
  grad.addColorStop(solid, 'rgba(33,28,19,.86)');
  grad.addColorStop(1, 'rgba(33,28,19,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  blobs[solid] = canvas;
  return canvas;
}

export function softShadow(ctx, x, y, rx, ry, alpha = 0.72, solid = 0.6) {
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * alpha;
  ctx.drawImage(shadowBlob(solid), x - rx, y - ry, rx * 2, ry * 2);
  ctx.globalAlpha = prev;
}

// --- воин: начало координат у ног, высота примерно 35 единиц ---
// Позы сняты покадрово с референса: кадр длится 80 мс, замах, удар, возврат в стойку.

const P = {};
function paths() {
  if (P.helm) return P;
  P.helm = new Path2D('M.6 -36.4 C2.6 -35.2 5.2 -31.6 5.4 -27.8 L5.4 -25.4 L3.3 -25.4 L3.1 -21.4 L1.4 -21.4 L1.2 -25.4 L-4.6 -25.4 L-4.6 -27.8 C-4.4 -31.6 -1.4 -35.2 .6 -36.4Z');
  P.hood = new Path2D('M0 -33.5 C3.4 -33.5 4.6 -30 4.4 -26 L3.6 -22 L-3.6 -22 L-4.4 -26 C-4.6 -30 -3.4 -33.5 0 -33.5Z');
  P.heater = new Path2D('M1.2 -21 L14.2 -21 L14.2 -13 C14.2 -9 11 -6.4 7.8 -3.8 C4.6 -6.4 1.2 -9 1.2 -13Z');
  P.kilt = new Path2D('M-5.8 -10 L5.8 -10 L6.8 -3.4 L-6.4 -3.4Z');
  P.legs = new Path2D('M-4 -24 C-6 -18 -6.4 -13 -6 -9 L6 -9 C6.4 -13 6 -18 4 -24Z M-3.6 -4 L-3.6 0 L-1.6 0 L-1.6 -4Z M1.6 -4 L1.6 0 L3.6 0 L3.6 -4Z');
  P.trunk = new Path2D('M-4 -24 C-6 -18 -6.4 -13 -6 -9 L6 -9 C6.4 -13 6 -18 4 -24Z');
  P.scimitar = new Path2D('M0 0 C1 -7 -1 -16 -10 -24 C-4 -15 -2 -7 -2 0Z');
  P.katana = new Path2D('M0 0 L1.6 .6 C10 -4 18 -10 25 -18 C17 -11 8 -5 0 0Z');
  P.axeHead = new Path2D('M0 -22 C-5 -24 -8 -23 -10 -21 C-9 -18 -9 -15 -9.6 -12 C-6 -15 -3 -16.5 0 -17Z');
  P.blade = new Path2D('M-1.6 0 L-1.6 -17 Q-1.2 -20.4 0 -21.6 Q1.2 -20.4 1.6 -17 L1.6 0Z');
  P.claymore = new Path2D('M-1.5 0 L-1.5 -33 L0 -38 L1.5 -33 L1.5 0Z');
  P.swirl = new Path2D('M0 -4 C4 -4 5 2 1 3 C-1 3.5 -2 1 0 0 C-3 1 -3 5 1 5 C7 5 7 -5 0 -6 Z');
  return P;
}

const GUARD = {
  sword:    { x: -8.8, y: -12, a: -0.22 },
  scimitar: { x: -8, y: -10, a: -0.1 },
  axe:      { x: -7, y: -11, a: -0.1 },
  katana:   { x: 5, y: -6, a: 0 },
  claymore: { x: -6.5, y: -12, a: 0 },
};

// Шаги на месте: куда расходятся носки ног.
const LEGS = [[-7, 6.8], [-5, 7.6], [-7, 6.8], [-7.6, 5]];

// Удар по кадрам: смещение руки и оружия от стойки, поворот корпуса и щита.
export const SWING = [
  { a: -0.42, x: -1.5, y: -2 },
  { a: -1.05, x: -3, y: -4, lean: -0.1 },
  { a: 2.1, x: 11, y: 7, bell: true, turn: 0.55, front: true, lean: 0.12 },
  { a: 1.75, x: 9, y: 2, bell: true, turn: 0.6, front: true, lean: 0.08 },
  { a: 1.1, x: 8, y: -4, bell: true, turn: 0.8, front: true },
  { a: 0.2, x: 4, y: -7, turn: 0.95 },
];
export const STRIKE = 2;

function stand(ctx, l, r) {
  ctx.beginPath();
  ctx.moveTo(-3.6, -25.4);
  ctx.lineTo(3.6, -25.4);
  ctx.lineTo(3.8, -21.6);
  ctx.bezierCurveTo(5, -20.6, 5.8, -19, 5.8, -17);
  ctx.lineTo(6, -9);
  ctx.bezierCurveTo(6.2, -6, r - 0.6, -3, r, 0.4);
  ctx.lineTo(r - 2.6, -2.4);
  ctx.bezierCurveTo(2.4, -3.4, 1, -3.8, 0, -3.8);
  ctx.bezierCurveTo(-1, -3.8, -2.4, -3.4, l + 2.6, -2.4);
  ctx.lineTo(l, 0.4);
  ctx.bezierCurveTo(l + 0.6, -3, -6.2, -6, -6, -9);
  ctx.lineTo(-5.8, -17);
  ctx.bezierCurveTo(-5.8, -19, -5, -20.6, -3.8, -21.6);
  ctx.closePath();
  ctx.fill();
}

// В ударе плащ разворачивается колоколом, как на кадрах референса.
function bell(ctx) {
  ctx.beginPath();
  ctx.moveTo(1, -27);
  ctx.bezierCurveTo(7, -26, 10, -13, 10.5, 0.4);
  ctx.bezierCurveTo(7, -3.5, 3, -6, 0, -6.4);
  ctx.bezierCurveTo(-4, -6, -7.6, -3.5, -10, 0.4);
  ctx.bezierCurveTo(-10, -11, -6, -26, 1, -27);
  ctx.closePath();
  ctx.fill();
}

function weapon(ctx, st, frame) {
  const p = paths(), g = GUARD[st.weapon];
  const hx = g.x + (frame?.x || 0), hy = g.y + (frame?.y || 0);
  if (st.weapon !== 'katana') {
    ctx.strokeStyle = PAL.black;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-4.4, -18.6);
    ctx.lineTo(hx, hy);
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(g.a + (frame?.a || 0));
  if (st.weapon === 'sword') {
    ctx.fillStyle = '#c8c8c8';
    ctx.fill(p.blade);
    ctx.fillStyle = PAL.black;
    ctx.fillRect(-3.8, -0.8, 7.6, 1.8);
    ctx.fillRect(-1.1, 0.8, 2.2, 2.6);
  } else if (st.weapon === 'scimitar') {
    ctx.fillStyle = PAL.steel;
    ctx.fill(p.scimitar);
    ctx.fillStyle = PAL.black;
    ctx.fillRect(-3.4, -0.2, 6, 1.6);
    ctx.fillRect(-2, 1, 2.2, 3);
  } else if (st.weapon === 'axe') {
    ctx.fillStyle = PAL.black;
    ctx.fillRect(-.9, -22, 1.8, 26);
    ctx.fillStyle = PAL.white;
    ctx.fill(p.axeHead);
  } else if (st.weapon === 'katana') {
    ctx.fillStyle = '#e4e4e4';
    ctx.fill(p.katana);
    ctx.fillStyle = PAL.black;
    ctx.fillRect(-3.4, -1, 4.6, 2);
  } else {
    ctx.fillStyle = '#d8d8d8';
    ctx.fill(p.claymore);
    ctx.fillStyle = PAL.white;
    ctx.fillRect(-4.6, -1.2, 9.2, 2);
    ctx.fillRect(-4.6, -2.6, 1.8, 2);
    ctx.fillRect(2.8, -2.6, 1.8, 2);
    ctx.fillStyle = PAL.black;
    ctx.fillRect(-1, 0, 2, 3.4);
  }
  ctx.restore();
}

function shield(ctx, st, turn) {
  if (!st.shield) return;
  const p = paths();
  ctx.save();
  ctx.translate(7.6, -12);
  ctx.scale(turn, 1);
  ctx.translate(-7.6, 12);
  if (st.shield === 'heater') {
    ctx.fillStyle = st.main;
    ctx.fill(p.heater);
    ctx.strokeStyle = st.edge;
    ctx.lineWidth = 0.9;
    ctx.stroke(p.heater);
  } else {
    if (st.shield === 'boss') {
      ctx.fillStyle = '#1b2a4d';
      ctx.beginPath();
      ctx.arc(6.5, -12, 7.6, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = st.main;
    ctx.beginPath();
    ctx.arc(6.5, -12, 6.8, 0, TAU);
    ctx.fill();
    if (st.shield === 'boss') {
      ctx.fillStyle = PAL.steel;
      ctx.beginPath();
      ctx.arc(6.5, -12, 2.3, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

function sashimono(ctx, st) {
  ctx.fillStyle = PAL.black;
  ctx.fillRect(-5.4, -56, 1.3, 34);
  ctx.fillRect(-15.5, -56, 11, 1.3);
  ctx.fillStyle = st.edge;
  ctx.fillRect(-15, -54.8, 9.6, 21.6);
  ctx.fillStyle = st.main;
  ctx.fillRect(-14.6, -54.8, 8.8, 21.2);
  ctx.fillStyle = PAL.white;
  ctx.fillRect(-11.8, -51, 3.2, 3.2);
  ctx.fillRect(-11.8, -44, 3.2, 3.2);
}

export function soldierShadow(ctx, x, y, s, fall = 0) {
  softShadow(ctx, x - 1.5 * s, y + s, 18.5 * s * (1 + fall * 0.4), 5.6 * s, 0.82, 0.8);
}

// Голени под юбкой ходят навстречу друг другу, нога в воздухе приподнята.
function shins(ctx, stride) {
  for (const [side, phase] of [[-2.6, stride], [2.6, stride + Math.PI]]) {
    const swing = Math.sin(phase), lift = Math.max(0, Math.cos(phase)) * 3.4;
    ctx.save();
    ctx.translate(side, -9);
    ctx.rotate(-swing * 0.85);
    ctx.fillRect(-1.2, 0, 2.4, 10 - lift);
    ctx.restore();
  }
}

// o: dir — куда смотрит, frame — кадр удара, stride — фаза ходьбы в радианах, fall — падение 0..1.
export function soldier(ctx, x, y, s, facId, o = {}) {
  const st = FAC[facId], p = paths(), { stride } = o;
  const dir = o.dir ?? st.dir, fall = o.fall || 0;
  const frame = o.frame != null ? SWING[o.frame] : null;
  if (o.shadow !== false) soldierShadow(ctx, x, y, s, fall);
  ctx.save();
  // На шаге тело подскакивает, качается с ноги на ногу и подаётся вперёд.
  ctx.translate(x, y - (stride == null ? o.hop || 0 : Math.abs(Math.sin(stride)) * 4.2 * s));
  ctx.scale(s * dir, s);
  if (stride != null) ctx.rotate(0.1 + Math.cos(stride) * 0.13);
  if (fall) {
    ctx.translate(0, -fall);
    ctx.rotate(-fall * Math.PI / 2 * 0.97);
  } else if (frame?.lean) ctx.rotate(frame.lean);
  if (st.flagBack) sashimono(ctx, st);

  const bent = frame?.bell;
  ctx.fillStyle = PAL.black;
  if (bent) {
    bell(ctx);
  } else if (st.kilt) {
    if (stride == null) ctx.fill(p.legs);
    else {
      ctx.fill(p.trunk);
      shins(ctx, stride);
    }
    ctx.fillStyle = st.main;
    ctx.fill(p.kilt);
  } else if (stride != null) {
    const open = Math.abs(Math.cos(stride)) * 8;
    stand(ctx, -3.2 - open, 3.2 + open);
  } else {
    const [l, r] = LEGS[(o.step || 0) % 4];
    stand(ctx, l, r);
  }

  ctx.save();
  if (bent) {
    ctx.translate(3, 1.5);
    ctx.rotate(0.16);
  }
  if (st.hood) {
    ctx.fillStyle = PAL.black;
    ctx.fill(p.hood);
    if (st.flagBack) {
      ctx.strokeStyle = '#dcdcdc';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, -25.5, 5.6, 0.3, Math.PI - 0.3);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = PAL.steel;
    ctx.fill(p.helm);
  }
  ctx.restore();

  const front = frame?.front;
  if (!front) weapon(ctx, st, frame);
  shield(ctx, st, frame?.turn ?? 1);
  if (front) weapon(ctx, st, frame);
  ctx.restore();
}

// Полупрозрачный след клинка: появляется на один-два кадра удара.
export function slashArc(ctx, x, y, s, dir, alpha, big) {
  const r = (big ? 50 : 36) * s;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);
  ctx.rotate(big ? -0.45 : 0.2);
  ctx.scale(1, big ? 0.74 : 0.5);
  const from = -2.75, to = 0.6, n = 20;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const th = from + (to - from) * (i / n);
    ctx.lineTo(Math.cos(th) * r, Math.sin(th) * r);
  }
  for (let i = n; i >= 0; i--) {
    const k = i / n, th = from + (to - from) * k;
    const inner = r * (1 - 0.66 * Math.sin(Math.PI * k ** 1.5));
    ctx.lineTo(Math.cos(th) * inner, Math.sin(th) * inner);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(-r, 0, r, 0);
  g.addColorStop(0, 'rgba(205,200,188,0)');
  g.addColorStop(0.45, `rgba(205,200,188,${0.5 * alpha})`);
  g.addColorStop(1, `rgba(214,210,198,${0.86 * alpha})`);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

// --- знамя: начало координат у основания древка ---

function emblem(ctx, kind, cx, cy, s) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  if (kind === 'castle') {
    ctx.fillStyle = PAL.white;
    ctx.beginPath();
    ctx.moveTo(-10, 6); ctx.lineTo(-10, -3); ctx.lineTo(-6.5, -3); ctx.lineTo(-6.5, 0);
    ctx.lineTo(-3.6, 0); ctx.lineTo(-3.6, -6); ctx.lineTo(-1, -6); ctx.lineTo(-1, -2);
    ctx.lineTo(1.6, -2); ctx.lineTo(1.6, -6); ctx.lineTo(4, -6); ctx.lineTo(4, 0);
    ctx.lineTo(6.6, 0); ctx.lineTo(6.6, -3); ctx.lineTo(10, -3); ctx.lineTo(10, 6);
    ctx.lineTo(2, 6); ctx.lineTo(2, 3); ctx.lineTo(-2, 3); ctx.lineTo(-2, 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#d4d4d4';
    ctx.fillRect(-10, 3, 8, 3);
    ctx.fillRect(2, 3, 8, 3);
  } else if (kind === 'swirl') {
    ctx.fillStyle = PAL.white;
    ctx.beginPath();
    ctx.arc(0, 0, 9.4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = FAC.yellow.main;
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.rotate(i * TAU / 3);
      ctx.translate(0, -3.2);
      ctx.fill(paths().swirl);
      ctx.restore();
    }
  } else if (kind === 'waves') {
    ctx.strokeStyle = PAL.white;
    ctx.lineWidth = 1.7;
    ctx.lineCap = 'round';
    for (let row = 0; row < 2; row++) {
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const x = -9 + i * 6;
        ctx.moveTo(x, -2 + row * 5);
        ctx.quadraticCurveTo(x + 1.5, -6 + row * 5, x + 3, -3 + row * 5);
        ctx.quadraticCurveTo(x + 4.4, -1 + row * 5, x + 6, -3 + row * 5);
      }
      ctx.stroke();
    }
  } else if (kind === 'bell') {
    // Медное царство: колокол с языком и ушком.
    ctx.fillStyle = PAL.white;
    ctx.beginPath();
    ctx.moveTo(-2, -7);
    ctx.quadraticCurveTo(-7.4, -6.4, -7.4, 1.6);
    ctx.lineTo(-9.6, 5.6); ctx.lineTo(9.6, 5.6); ctx.lineTo(7.4, 1.6);
    ctx.quadraticCurveTo(7.4, -6.4, 2, -7);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 7.8, 2.2, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = PAL.white;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, -8.6, 1.9, 0, TAU);
    ctx.stroke();
  } else if (kind === 'saber') {
    // Войско Тугарина: белая кривая сабля.
    ctx.strokeStyle = PAL.white;
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(-6, 8); ctx.quadraticCurveTo(-5, -5, 7, -9); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-10, 5); ctx.lineTo(-2, 9); ctx.stroke();
  } else if (kind === 'moon') {
    // Тёмное царство: белый месяц рогами вправо.
    ctx.fillStyle = PAL.white;
    ctx.beginPath();
    ctx.arc(0, 0, 8, Math.PI * 0.35, Math.PI * 1.65);
    ctx.arc(4.5, 0, 7.18, -1.692, 1.692, true);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'snow') {
    // Снежное царство: полотнище белое, поэтому снежинка тёмная.
    ctx.strokeStyle = '#56616b';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.rotate(i * Math.PI / 3);
      ctx.beginPath();
      ctx.moveTo(0, -9); ctx.lineTo(0, 9);
      for (const k of [-1, 1]) {
        ctx.moveTo(0, k * 5.4); ctx.lineTo(-2.6, k * 7.8);
        ctx.moveTo(0, k * 5.4); ctx.lineTo(2.6, k * 7.8);
      }
      ctx.stroke();
      ctx.restore();
    }
  } else if (kind === 'dots') {
    ctx.fillStyle = PAL.white;
    ctx.fillRect(-2.6, -8, 5.2, 5.2);
    ctx.fillRect(-2.6, 2.8, 5.2, 5.2);
  } else {
    ctx.fillStyle = PAL.white;
    for (const a of [-Math.PI / 2, Math.PI / 6, Math.PI * 5 / 6]) {
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 4.3, Math.sin(a) * 4.3 - 0.8, 4.2, 0, TAU);
      ctx.fill();
    }
    ctx.fillRect(-0.9, 1, 1.8, 8);
  }
  ctx.restore();
}

// Складки полотнища: острые серпы, как на референсе.
function folds(ctx, st, w, top, h) {
  ctx.fillStyle = st.dark;
  ctx.beginPath();
  ctx.moveTo(-w * 0.86, top + 2);
  ctx.quadraticCurveTo(-w * 0.5, top + h * 0.34, w * 0.14, top + h * 0.33);
  ctx.quadraticCurveTo(-w * 0.42, top + h * 0.42, -w * 0.86, top + 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(w * 0.7, top + h * 0.06);
  ctx.quadraticCurveTo(w * 1.02, top + h * 0.4, w * 0.42, top + h * 0.7);
  ctx.quadraticCurveTo(w * 0.72, top + h * 0.36, w * 0.7, top + h * 0.06);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-w * 0.72, top + h * 0.3);
  ctx.quadraticCurveTo(-w * 0.72, top + h * 0.5, -w * 0.46, top + h * 0.66);
  ctx.quadraticCurveTo(-w * 0.58, top + h * 0.46, -w * 0.72, top + h * 0.3);
  ctx.fill();
}

export function banner(ctx, x, y, s, facId, sway = 0) {
  const st = FAC[facId];
  const H = 108, W = 17, L = 72;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);

  ctx.fillStyle = PAL.black;
  ctx.fillRect(-1.8, -H, 3.6, H);

  if (st.cloth !== 'capsule') {
    ctx.fillStyle = PAL.steel;
    ctx.beginPath();
    ctx.ellipse(0, -H - 21, 3.2, 3.8, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-2.2, -H - 19); ctx.lineTo(2.2, -H - 19); ctx.lineTo(2.6, -H - 10); ctx.lineTo(-2.6, -H - 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(-2.6, -H - 7, 5.2, 2.2);
    ctx.fillStyle = PAL.black;
    ctx.fillRect(-1.8, -H - 10, 3.6, 10);
  }

  ctx.translate(0, -H);
  if (sway) ctx.transform(1, 0, sway * 0.05, 1, 0, 0);

  if (st.cloth === 'swallow' || st.cloth === 'kite') {
    ctx.fillStyle = PAL.black;
    ctx.fillRect(-W - 5, -1.6, 2 * W + 10, 3.2);
    ctx.fillStyle = st.main;
    ctx.strokeStyle = st.edge;
    ctx.lineWidth = 0.9;
    for (const sx of [-W - 3, W + 3]) {
      ctx.beginPath();
      ctx.arc(sx, 0, 2.1, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-W, 1.5);
    ctx.quadraticCurveTo(0, 4.5, W, 1.5);
    if (st.cloth === 'swallow') {
      ctx.lineTo(W, L); ctx.lineTo(0, L - 12); ctx.lineTo(-W, L);
    } else {
      ctx.lineTo(W, L - 22); ctx.quadraticCurveTo(W - 2, L - 10, 0, L + 1);
      ctx.quadraticCurveTo(-W + 2, L - 10, -W, L - 22);
    }
    ctx.closePath();
    ctx.fillStyle = st.main;
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.clip();
    folds(ctx, st, W, 2, L - 12);
    ctx.restore();
    emblem(ctx, st.emblem, 0, 40, 1.15);
  } else if (st.cloth === 'capsule') {
    const w = 15;
    ctx.fillStyle = st.main;
    ctx.beginPath();
    ctx.moveTo(-w, 6);
    ctx.quadraticCurveTo(-w, -3, 0, -3);
    ctx.quadraticCurveTo(w, -3, w, 6);
    ctx.lineTo(w, 54);
    ctx.quadraticCurveTo(w, 72, 0, 72);
    ctx.quadraticCurveTo(-w, 72, -w, 54);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = st.dark;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-5, 62);
    ctx.quadraticCurveTo(3, 56, 8, 44);
    ctx.stroke();
    ctx.restore();
    emblem(ctx, st.emblem, 0, 18, 1.08);
  } else if (st.cloth === 'flag') {
    ctx.fillStyle = st.main;
    ctx.beginPath();
    ctx.moveTo(1, 0);
    ctx.bezierCurveTo(14, 5, 24, -5, 40, 0);
    ctx.lineTo(34, 13);
    ctx.lineTo(42, 27);
    ctx.bezierCurveTo(26, 22, 14, 33, 1, 28);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = st.edge;
    ctx.lineWidth = 1;
    ctx.stroke();
    emblem(ctx, st.emblem, 19, 13, 1);
  } else {
    ctx.fillStyle = PAL.black;
    ctx.fillRect(-1.5, -1.6, 30, 3.2);
    ctx.fillStyle = st.main;
    ctx.fillRect(2, 1.5, 25, 70);
    ctx.strokeStyle = st.edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(2, 1.5, 25, 70);
    emblem(ctx, st.emblem, 14.5, 30, 1.25);
  }
  ctx.restore();
}

// --- лодка на 10 человек ---

export function boat(ctx, x, y, s, facId, n, time = 0) {
  const st = FAC[facId];
  const bob = Math.sin(time * 1.6 + x * 0.05) * 1.2 * s;
  softShadow(ctx, x, y + 6 * s, 64 * s, 10 * s, 0.5);
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.scale(s, s);

  banner(ctx, 0, -6, 0.62, facId, Math.sin(time * 1.4 + x));

  const seat = i => -39 + (i % 5) * 19.5;
  for (let i = 0; i < Math.min(n, 5); i++) soldier(ctx, seat(i) + 4, -5, 0.64, facId, { shadow: false, dir: 1 });
  for (let i = 5; i < n; i++) soldier(ctx, seat(i) - 3, -1, 0.64, facId, { shadow: false, dir: 1 });

  ctx.fillStyle = '#17130c';
  ctx.beginPath();
  ctx.moveTo(-60, -22);
  ctx.quadraticCurveTo(-56, -6, -50, -3);
  ctx.lineTo(50, -3);
  ctx.quadraticCurveTo(58, -7, 62, -24);
  ctx.quadraticCurveTo(70, -8, 52, 12);
  ctx.quadraticCurveTo(0, 18, -50, 12);
  ctx.quadraticCurveTo(-68, -6, -60, -22);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = BOAT_TRIM;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-55, 4);
  ctx.quadraticCurveTo(0, 10, 55, 4);
  ctx.stroke();

  for (let i = 0; i < n; i++) {
    const sx = -40 + (i + 0.5) * (80 / Math.max(n, 1));
    ctx.fillStyle = st.edge;
    ctx.beginPath();
    ctx.arc(sx, -1, 5.6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = st.main;
    ctx.beginPath();
    ctx.arc(sx, -1, 4.8, 0, TAU);
    ctx.fill();
  }

  ctx.fillStyle = BOAT_TIPS;
  ctx.beginPath();
  ctx.arc(63, -25, 3, 0, TAU);
  ctx.arc(-60, -23, 3, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(189,189,189,.45)';
  ctx.lineWidth = 1.6 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 46 * s, y + 16 * s + bob);
  ctx.quadraticCurveTo(x, y + 21 * s + bob, x + 46 * s, y + 16 * s + bob);
  ctx.stroke();
}

// --- рельеф: кроны, горы, домики и ресурсы ---

// Лес: плотный полог круглых крон, как на виде сверху, с редкими тёмными елями над ним.
function crownPuff(ctx, x, y, r, rnd) {
  const tone = CROWNS[Math.floor(rnd() * CROWNS.length)];
  ctx.fillStyle = tone;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + rnd();
    ctx.moveTo(x + Math.cos(a) * r * 0.5 + r * 0.7, y + Math.sin(a) * r * 0.4);
    ctx.arc(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.4, r * 0.7, 0, TAU);
  }
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.02, 0.15, Math.PI - 0.3);
  ctx.stroke();
  ctx.fillStyle = CROWN_LIGHT;
  ctx.beginPath();
  ctx.ellipse(x - r * 0.3, y - r * 0.36, r * 0.42, r * 0.24, -0.4, 0, TAU);
  ctx.fill();
}

function forest(ctx, rnd) {
  softShadow(ctx, 8, 12, 78, 58, 0.8);
  ctx.fillStyle = CANOPY;
  ctx.beginPath();
  ctx.ellipse(0, 2, 68, 52, 0, 0, TAU);
  ctx.fill();
  const spots = [];
  for (let y = -44; y <= 46; y += 13) {
    for (let x = -60; x <= 60; x += 16) {
      const px = x + (y % 2 ? 8 : 0) + (rnd() - 0.5) * 8, py = y + (rnd() - 0.5) * 6;
      if ((px / 68) ** 2 + (py / 52) ** 2 <= 1.02) spots.push([px, py]);
    }
  }
  for (const [x, y] of spots) {
    if (rnd() < 0.1) {
      const h = 22 + rnd() * 12, w = 7 + rnd() * 2;
      ctx.fillStyle = FIR;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(x, y - h);
      ctx.lineTo(x + w, y + 3);
      ctx.lineTo(x - w, y + 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else crownPuff(ctx, x, y, 8.5 + rnd() * 4.5, rnd);
  }
}

// Поганка: длинная бледная ножка с юбочкой и клубнем, колпак чёрный и острый.
// Увядающая грибница теряет цвет: чем ближе конец, тем серее.
function toadstool(ctx, x, y, s, fade = 0) {
  const stem = fade ? '#9a9a96' : '#d4cdb6';
  const cap = fade ? `rgb(${40 + fade * 90},${40 + fade * 90},${40 + fade * 90})` : '#0d0b08';
  softShadow(ctx, x + s, y + s, 11 * s, 3.4 * s, 0.7);
  ctx.fillStyle = stem;
  ctx.beginPath();
  ctx.ellipse(x, y - 1.8 * s, 4.2 * s, 2.8 * s, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - 2 * s, y - 2 * s);
  ctx.quadraticCurveTo(x - 1.2 * s, y - 16 * s, x - 1.4 * s, y - 27 * s);
  ctx.lineTo(x + 1.4 * s, y - 27 * s);
  ctx.quadraticCurveTo(x + 1.2 * s, y - 16 * s, x + 2 * s, y - 2 * s);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - 1.6 * s, y - 20 * s);
  ctx.lineTo(x - 5 * s, y - 16.5 * s);
  ctx.lineTo(x + 5 * s, y - 16.5 * s);
  ctx.lineTo(x + 1.6 * s, y - 20 * s);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = cap;
  ctx.beginPath();
  ctx.moveTo(x - 10 * s, y - 24 * s);
  ctx.quadraticCurveTo(x - 9 * s, y - 34 * s, x, y - 41 * s);
  ctx.quadraticCurveTo(x + 9 * s, y - 34 * s, x + 10 * s, y - 24 * s);
  ctx.quadraticCurveTo(x, y - 27.5 * s, x - 10 * s, y - 24 * s);
  ctx.fill();
}

const toadstools = fade => (ctx) => {
  toadstool(ctx, -22, -4, 0.82, fade);
  toadstool(ctx, 21, -2, 0.92, fade);
  toadstool(ctx, -1, 14, 1.2, fade);
  toadstool(ctx, -28, 20, 0.62, fade);
  toadstool(ctx, 30, 22, 0.58, fade);
};

// Лагерь на грибнице: шатёр и пара поганок.
function tent(ctx, x, y, s) {
  softShadow(ctx, x, y + s, 22 * s, 7 * s, 0.75);
  ctx.fillStyle = PAL.tan;
  ctx.beginPath();
  ctx.moveTo(x, y - 26 * s);
  ctx.lineTo(x + 19 * s, y);
  ctx.lineTo(x - 19 * s, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PAL.tanLo;
  ctx.beginPath();
  ctx.moveTo(x, y - 26 * s);
  ctx.lineTo(x + 19 * s, y);
  ctx.lineTo(x + 4 * s, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PAL.black;
  ctx.beginPath();
  ctx.moveTo(x - 1 * s, y - 15 * s);
  ctx.lineTo(x + 6 * s, y);
  ctx.lineTo(x - 7 * s, y);
  ctx.closePath();
  ctx.fill();
}

function camp(ctx) {
  toadstool(ctx, 26, -10, 0.82);
  toadstool(ctx, -26, 12, 0.72);
  tent(ctx, -6, 8, 1.1);
  toadstool(ctx, 24, 22, 0.9);
}

// --- тележка гнома ---

// Тележка поворачивает плавно, поэтому собирается не из картинки, а по своим осям:
// a вдоль тележки, b поперёк, h вверх. Начало координат на земле под осью.
// Гном тянет её за оглоблю, два высоких колеса стоят посередине кузова.
export const CART_TILT = 0.62;          // сжатие земли под тележкой, по нему же считается курс
const CART_RISE = 0.8;                  // сжатие высоты
const BED = { a: 13, b: 7, low: 8, top: 15, flare: 1.14 };
const WHEEL = { r: 10, b: 9.4 };
const BAR = { len: 15, h: 9, grip: 3.6 };
const DECK = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const CART_FINE = 1;                    // с такого размера видны спицы и доски

// Груз лежит по штукам: в тележке видно ровно столько, сколько она везёт, не больше пяти.
// Первым заполняется дно, пятая штука ложится сверху.
const HEAP = [[0, -2.8, 15], [0, 3, 15], [-8, 0, 15], [8, 0, 15], [0, 0, 20]];

function mushroomOne(g, x, y, s) {
  g.fillStyle = '#d9d2bd';
  g.fillRect(x - 2 * s, y - 6 * s, 4 * s, 9 * s);
  g.fillStyle = '#2b2233';
  g.beginPath();
  g.moveTo(x - 8 * s, y - 4 * s);
  g.quadraticCurveTo(x, y - 17 * s, x + 8 * s, y - 4 * s);
  g.closePath();
  g.fill();
  g.fillStyle = '#b9a9c9';
  for (const [dx, dy] of [[-3.4, -6.5], [1.4, -9.5], [4, -6]]) g.fillRect(x + dx * s, y + dy * s, 1.6 * s, 1.6 * s);
}

// Гриб рисуется один раз и штампуется, мелкая копия нужна для обзора.
const STAMP = { w: 16, h: 22, y: 15, s: 0.62 };
const stamps = {};
function goodsStamp(res) {
  if (stamps[res]) return stamps[res];
  const canvas = document.createElement('canvas');
  canvas.width = STAMP.w * res;
  canvas.height = STAMP.h * res;
  const g = canvas.getContext('2d');
  g.scale(res, res);
  mushroomOne(g, STAMP.w / 2, STAMP.y + 2, STAMP.s);
  stamps[res] = canvas;
  return canvas;
}

// Колесо стоит поперёк оси тележки: на экране это эллипс, который сужается, когда она едет к зрителю.
function wheel(ctx, x, y, ax, ay, up, angle, s, fine) {
  const sides = fine ? 20 : 10, r = WHEEL.r;
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const t = (i / sides) * TAU, c = Math.cos(t) * r, n = Math.sin(t) * r;
    ctx.lineTo(x + ax * c, y + ay * c - up * n);
  }
  ctx.closePath();
  if (!fine) {
    ctx.fillStyle = CART_INK;
    ctx.fill();
    return;
  }
  ctx.strokeStyle = CART_INK;
  ctx.lineWidth = 2.4 * s;
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const t = angle + (i * Math.PI) / 4, c = Math.cos(t) * r, n = Math.sin(t) * r;
    ctx.moveTo(x - ax * c, y - ay * c + up * n);
    ctx.lineTo(x + ax * c, y + ay * c - up * n);
  }
  ctx.strokeStyle = CART_RIM;
  ctx.lineWidth = 1.2 * s;
  ctx.stroke();
  ctx.fillStyle = CART_INK;
  ctx.beginPath();
  ctx.arc(x, y, 2 * s, 0, TAU);
  ctx.fill();
}

// heading — курс на земле, rolled — сколько проехала, detail — точек экрана на единицу тележки.
// goods — что везёт: 'mushroom' или ничего, когда едет порожняком. count — сколько штук.
export function cart(ctx, x, y, s, heading, rolled, detail, goods = null, count = HEAP.length, hat) {
  const fine = detail >= CART_FINE;
  const cos = Math.cos(heading), sin = Math.sin(heading);
  const ax = cos * s, ay = sin * CART_TILT * s;
  const bx = -sin * s, by = cos * CART_TILT * s;
  const up = CART_RISE * s;
  const px = (a, b) => x + ax * a + bx * b;
  const py = (a, b, h) => y + ay * a + by * b - up * h;
  const near = by >= 0 ? 1 : -1, front = ay >= 0 ? 1 : -1;
  const { a: A, b: B, low, top, flare } = BED;

  // Края кузова расходятся кверху, как у настоящей телеги.
  const wall = (color, a0, b0, a1, b1) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(px(a0, b0), py(a0, b0, low));
    ctx.lineTo(px(a1, b1), py(a1, b1, low));
    ctx.lineTo(px(a1 * flare, b1 * flare), py(a1 * flare, b1 * flare, top));
    ctx.lineTo(px(a0 * flare, b0 * flare), py(a0 * flare, b0 * flare, top));
    ctx.closePath();
    ctx.fill();
  };
  const deck = (color, k) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const [p, q] of DECK) ctx.lineTo(px(p * A * k, q * B * k), py(p * A * k, q * B * k, top));
    ctx.closePath();
    ctx.fill();
  };
  const axle = b => wheel(ctx, px(0, b), py(0, b, WHEEL.r), ax, ay, up, -rolled / WHEEL.r, s, fine);
  // Оглобля с поперечиной, за которую держится гном. Он идёт в ногу с колёсами.
  const puller = () => {
    ctx.strokeStyle = CART_INK;
    ctx.lineWidth = 2 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px(A, 0), py(A, 0, low + 2));
    ctx.lineTo(px(A + BAR.len, 0), py(A + BAR.len, 0, BAR.h));
    ctx.moveTo(px(A + BAR.len, -BAR.grip), py(A + BAR.len, -BAR.grip, BAR.h));
    ctx.lineTo(px(A + BAR.len, BAR.grip), py(A + BAR.len, BAR.grip, BAR.h));
    ctx.stroke();
    const at = A + BAR.len + 4, hop = Math.abs(Math.sin(rolled * 0.16)) * 1.8 * s;
    softShadow(ctx, px(at, 0), py(at, 0, 0) + s, 6 * s, 2.4 * s, 0.7);
    gnome(ctx, px(at, 0), py(at, 0, 0) - hop, 0.92 * s, hat);
  };

  softShadow(ctx, x, y + 1.5 * s, Math.abs(ax) * 18 + Math.abs(bx) * 12, Math.abs(ay) * 18 + Math.abs(by) * 12 + 2 * s, 0.82);
  axle(-near * WHEEL.b);
  if (front < 0) puller();

  // Вблизи видна и дальняя стенка: иначе при смене ближней перескакивала бы полоска расхода.
  if (fine) {
    wall(CART_SIDE, -A, -near * B, A, -near * B);
    wall(CART_END, -front * A, -B, -front * A, B);
  }
  wall(CART_SIDE, -A, near * B, A, near * B);
  wall(CART_END, front * A, -B, front * A, B);
  if (fine) {
    const mid = (low + top) / 2, rim = (1 + flare) / 2;
    ctx.strokeStyle = CART_PLANK;
    ctx.lineWidth = 0.9 * s;
    ctx.beginPath();
    ctx.moveTo(px(-A * rim, near * B * rim), py(-A * rim, near * B * rim, mid));
    ctx.lineTo(px(A * rim, near * B * rim), py(A * rim, near * B * rim, mid));
    ctx.moveTo(px(front * A * rim, -B * rim), py(front * A * rim, -B * rim, mid));
    ctx.lineTo(px(front * A * rim, B * rim), py(front * A * rim, B * rim, mid));
    ctx.stroke();
  }

  // Верх кузова: светлый край и тёмное нутро под грузом.
  deck(CART_RIM, flare);
  deck(CART_INK, 1);

  if (goods) {
    const stamp = goodsStamp(detail > 2.5 ? 6 : 2), w = STAMP.w * s, h = STAMP.h * s, lift = STAMP.y * s;
    const heap = HEAP.slice(0, count).sort((p, q) => p[2] - q[2] || ay * p[0] + by * p[1] - ay * q[0] - by * q[1]);
    for (const [a, b, z] of heap) ctx.drawImage(stamp, px(a, b) - w / 2, py(a, b, z) - lift, w, h);
  }

  axle(near * WHEEL.b);
  if (front > 0) puller();
}

// --- сказочные герои ---

function yaga(ctx) {
  softShadow(ctx, 0, 14, 34, 10, 0.8);
  // изба на курьих ножках
  ctx.strokeStyle = '#6c5d46';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-10, -18); ctx.lineTo(-16, 0); ctx.lineTo(-8, 12); ctx.moveTo(-8, 12); ctx.lineTo(-20, 13); ctx.moveTo(-8, 12); ctx.lineTo(-2, 14);
  ctx.moveTo(12, -18); ctx.lineTo(18, 0); ctx.lineTo(10, 12); ctx.moveTo(10, 12); ctx.lineTo(22, 13); ctx.moveTo(10, 12); ctx.lineTo(4, 14);
  ctx.stroke();
  ctx.fillStyle = PAL.tanLo;
  ctx.fillRect(-26, -42, 52, 26);
  ctx.fillStyle = PAL.tan;
  ctx.fillRect(-26, -42, 34, 26);
  ctx.strokeStyle = PAL.shade;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (const y of [-36, -29, -22]) { ctx.moveTo(-26, y); ctx.lineTo(26, y); }
  ctx.stroke();
  ctx.fillStyle = PAL.black;
  ctx.beginPath();
  ctx.moveTo(-34, -40); ctx.lineTo(0, -66); ctx.lineTo(34, -40);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = FAC.yellow.main;
  ctx.fillRect(-8, -36, 12, 12);
  ctx.fillStyle = PAL.black;
  ctx.fillRect(-3, -36, 2, 12);
  // Яга в ступе
  ctx.fillStyle = '#6c5d46';
  ctx.beginPath();
  ctx.moveTo(30, -4); ctx.lineTo(52, -4); ctx.lineTo(48, 14); ctx.lineTo(34, 14);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PAL.black;
  ctx.beginPath();
  ctx.moveTo(35, -4); ctx.quadraticCurveTo(36, -24, 41, -26); ctx.quadraticCurveTo(46, -24, 47, -4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PAL.steel;
  ctx.beginPath();
  ctx.moveTo(36, -22); ctx.quadraticCurveTo(41, -33, 46, -22);
  ctx.closePath();
  ctx.fill();
}

function koschei(ctx) {
  softShadow(ctx, 0, 10, 46, 15, 0.85);
  // чёрная башня
  ctx.fillStyle = '#0d0b08';
  ctx.fillRect(-46, -58, 26, 68);
  for (let i = 0; i < 3; i++) ctx.fillRect(-46 + i * 10, -66, 6, 10);
  ctx.fillRect(22, -38, 22, 48);
  for (let i = 0; i < 3; i++) ctx.fillRect(22 + i * 8, -45, 5, 8);
  // сам Кощей
  ctx.fillStyle = PAL.black;
  ctx.beginPath();
  ctx.moveTo(-13, 10);
  ctx.lineTo(-7, -40);
  ctx.lineTo(7, -40);
  ctx.lineTo(13, 10);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#d6d2c6';
  ctx.beginPath();
  ctx.ellipse(0, -48, 6.5, 8.5, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = PAL.black;
  for (const x of [-2.6, 2.6]) { ctx.beginPath(); ctx.arc(x, -49, 1.6, 0, TAU); ctx.fill(); }
  ctx.fillRect(-2.4, -43, 4.8, 1.2);
  ctx.fillStyle = FAC.yellow.main;
  ctx.beginPath();
  ctx.moveTo(-8, -54); ctx.lineTo(-9, -64); ctx.lineTo(-4, -59); ctx.lineTo(0, -66); ctx.lineTo(4, -59); ctx.lineTo(9, -64); ctx.lineTo(8, -54);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#d6d2c6';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(10, -30); ctx.lineTo(18, -22); ctx.lineTo(16, 10);
  ctx.stroke();
}

// Гном: крошечная фигурка с колпаком и белой бородой, живёт у своей острога.
// hat: цвет шапки. У гномов царства он свой, ничейные ходят в обычной.
export function gnome(ctx, x, y, s, hat = GNOME_HAT) {
  ctx.fillStyle = PAL.black;
  ctx.fillRect(x - 3 * s, y - 8 * s, 6 * s, 8 * s);
  ctx.fillStyle = PAL.white;
  ctx.beginPath();
  ctx.moveTo(x - 3 * s, y - 9 * s);
  ctx.lineTo(x + 3 * s, y - 9 * s);
  ctx.lineTo(x, y - 3 * s);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PAL.black;
  ctx.beginPath();
  ctx.moveTo(x - 5 * s, y - 8.5 * s);
  ctx.lineTo(x + 5 * s, y - 8.5 * s);
  ctx.lineTo(x + 1.2 * s, y - 21 * s);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = hat;
  ctx.beginPath();
  ctx.moveTo(x - 4 * s, y - 9 * s);
  ctx.lineTo(x + 4 * s, y - 9 * s);
  ctx.lineTo(x + 1 * s, y - 19 * s);
  ctx.closePath();
  ctx.fill();
}

// Причал: мостки с берега на воду, от центра клетки суши к центру клетки воды.
export function pier(ctx, x0, y0, x1, y1, s) {
  const len = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / len, uy = (y1 - y0) / len;
  const at = (k, side) => [x0 + ux * len * k - uy * side * s, y0 + uy * len * k + ux * side * s];
  ctx.fillStyle = CART_INK;
  for (const k of [0.56, 0.74]) {
    for (const side of [-7, 7]) {
      const [x, y] = at(k, side);
      ctx.fillRect(x - 1.5 * s, y, 3 * s, 8 * s);
    }
  }
  ctx.fillStyle = CART_SIDE;
  ctx.strokeStyle = CART_INK;
  ctx.lineWidth = 1.2 * s;
  ctx.beginPath();
  for (const [k, side] of [[0.34, -8], [0.8, -8], [0.8, 8], [0.34, 8]]) ctx.lineTo(...at(k, side));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = CART_PLANK;
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  for (let k = 0.4; k < 0.8; k += 0.06) {
    ctx.moveTo(...at(k, -8));
    ctx.lineTo(...at(k, 8));
  }
  ctx.stroke();
}

// Лодочка снабжения идёт вместо тележки там, где кончается суша: гном на корме, груз посередине.
export function rowboat(ctx, x, y, s, heading, goods, time, hat) {
  const bob = Math.sin(time * 1.8 + x * 0.05) * 0.9 * s;
  softShadow(ctx, x, y + 5 * s, 21 * s, 3.8 * s, 0.5);
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.scale(s * (Math.cos(heading) < 0 ? -1 : 1), s);
  gnome(ctx, -9, 1, 1, hat);
  if (goods) {
    ctx.fillStyle = '#a8763f';
    ctx.beginPath();
    ctx.ellipse(5, -2.6, 7, 4.2, 0, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = '#17130c';
  ctx.beginPath();
  ctx.moveTo(-19, -5);
  ctx.quadraticCurveTo(-16, -1, -13, -1);
  ctx.lineTo(13, -1);
  ctx.quadraticCurveTo(17, -2, 20, -6);
  ctx.quadraticCurveTo(21, 2, 14, 5);
  ctx.quadraticCurveTo(0, 7, -14, 5);
  ctx.quadraticCurveTo(-21, 2, -19, -5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = BOAT_TRIM;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-15, 2);
  ctx.quadraticCurveTo(0, 4, 15, 2);
  ctx.stroke();
  ctx.restore();
}

// --- Змей Горыныч в полёте ---

// Светлее, чем на земле, и с контуром: летит и над лесом, и над тёмным морем.
const DRAGON = { body: '#a8432f', belly: '#d2a860', web: '#b5573a', farWeb: '#74281f', ink: '#17120b', height: 92, beat: 7.5 };

// Крыло: от плеча три луча, между ними перепонка с выемками. rise от -1 (вниз) до 1 (вверх).
function dragonWing(ctx, rise, far) {
  const up = rise * (far ? 0.84 : 1), shift = far ? 16 : 0;
  const tip = [-46 + shift, -14 - 62 * up], mid = [-78 + shift, -2 - 32 * up], back = [-60 + shift, 14 - 6 * up];
  ctx.fillStyle = far ? DRAGON.farWeb : DRAGON.web;
  ctx.beginPath();
  ctx.moveTo(18 + shift, -8);
  ctx.quadraticCurveTo(-8 + shift, -18 - 40 * up, tip[0], tip[1]);
  ctx.quadraticCurveTo(-54 + shift, -12 - 38 * up, mid[0], mid[1]);
  ctx.quadraticCurveTo(-62 + shift, 2 - 14 * up, back[0], back[1]);
  ctx.quadraticCurveTo(-40 + shift, 2 - 2 * up, -22 + shift, 6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = DRAGON.ink;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.strokeStyle = DRAGON.body;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const end of [tip, mid, back]) {
    ctx.moveTo(14 + shift, -8);
    ctx.lineTo(end[0], end[1]);
  }
  ctx.stroke();
}

// Шея с головой. Головы смотрят по курсу, средняя вытянута дальше.
function dragonHead(ctx, reach, lift, sway, flicker) {
  const hx = 34 + reach, hy = -18 - lift + sway;
  ctx.lineCap = 'round';
  for (const [color, width] of [[DRAGON.ink, 11.5], [DRAGON.body, 8.5]]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(26, -6);
    ctx.quadraticCurveTo(38 + reach * 0.4, -6 - lift * 1.1, hx, hy);
    ctx.stroke();
  }
  ctx.fillStyle = DRAGON.body;
  ctx.strokeStyle = DRAGON.ink;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(hx - 6, hy - 4);
  ctx.lineTo(hx - 9, hy - 10);
  ctx.lineTo(hx + 3, hy - 7);
  ctx.lineTo(hx + 12, hy - 3);
  ctx.lineTo(hx + 18, hy + 1);
  ctx.lineTo(hx + 10, hy + 4);
  ctx.lineTo(hx - 5, hy + 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = FAC.yellow.main;
  ctx.beginPath();
  ctx.arc(hx + 2, hy - 3, 1.8, 0, TAU);
  ctx.fill();
  // огонёк из пасти
  ctx.fillStyle = '#d9772e';
  ctx.beginPath();
  ctx.moveTo(hx + 16, hy);
  ctx.lineTo(hx + 26 + flicker * 4, hy + 2 + flicker);
  ctx.lineTo(hx + 15, hy + 3);
  ctx.closePath();
  ctx.fill();
}

function dragonTail(ctx, time) {
  const wag = Math.sin(time * 4.5) * 7, wag2 = Math.sin(time * 4.5 - 1) * 11;
  ctx.fillStyle = DRAGON.body;
  ctx.beginPath();
  ctx.moveTo(-18, -12);
  ctx.quadraticCurveTo(-52, -6 + wag, -86, 4 + wag2);
  ctx.lineTo(-102, 2 + wag2);
  ctx.lineTo(-90, 12 + wag2);
  ctx.quadraticCurveTo(-52, 6 + wag, -16, 8);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = DRAGON.ink;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

// Летит над точкой (x, y) на земле, там же его тень. dir: 1 вправо, -1 влево.
// lift: высота от 0 (стоит на земле) до 1 (полёт), для взлёта и посадки.
export function dragonFlight(ctx, x, y, s, time, dir = 1, lift = 1) {
  const rise = Math.sin(time * DRAGON.beat) * (0.25 + 0.75 * lift);
  const bob = -rise * 5 * lift;
  softShadow(ctx, x, y, (66 + 34 * Math.abs(Math.cos(time * DRAGON.beat))) * s, (15 - 3 * lift) * s, 0.78 - 0.26 * lift);
  softShadow(ctx, x, y, 34 * s, 9 * s, 0.6);
  ctx.save();
  ctx.translate(x, y - (DRAGON.height * lift + 22 * (1 - lift) + bob) * s);
  ctx.scale(dir * s, s);
  dragonWing(ctx, rise, true);
  dragonTail(ctx, time);
  const flicker = Math.sin(time * 23) * 0.5 + 0.5;
  dragonHead(ctx, 8, 24, Math.sin(time * 3.1) * 2.4, flicker);
  ctx.fillStyle = DRAGON.body;
  ctx.beginPath();
  ctx.ellipse(2, -2, 33, 17, -0.05, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = DRAGON.ink;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = DRAGON.belly;
  ctx.beginPath();
  ctx.ellipse(8, 5, 22, 8, -0.05, 0, TAU);
  ctx.fill();
  dragonHead(ctx, 24, 10, Math.sin(time * 2.6 + 1) * 2.4, 1 - flicker);
  dragonHead(ctx, 12, -8, Math.sin(time * 3.7 + 2) * 2.4, flicker * 0.7);
  dragonWing(ctx, rise, false);
  ctx.restore();
}

const OBJECTS = {
  forest, camp, ...PAINTED, ...BEASTS,
  patch: toadstools(0), patch1: toadstools(0.35), patch2: toadstools(0.7), patch3: toadstools(1),
  yaga, koschei,
};

export function paintObject(ctx, kind, seed) {
  const rnd = seeded(seed);
  OBJECTS[kind](ctx, rnd);
}

export const hasObject = kind => kind in OBJECTS;
