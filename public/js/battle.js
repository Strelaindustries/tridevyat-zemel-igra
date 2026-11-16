// Бой крупным планом, как на референсе: воины расходятся на поединки парами,
// переступают, замахиваются и рубят, на ударе остаётся полупрозрачная дуга.
// Позы идут кадрами по 80 мс. Отряд в море дерётся прямо из лодки.
import { STRIKE, SWING, boat, slashArc, soldier, soldierShadow } from './art.js';
import { BOAT_SCALE, SOLDIER_SCALE, factionId, formation } from './view.js';

const FRAME = 0.08;
const RUSH = 0.35, CLASH = 1.5, BACK = 0.35, TEMPO = CLASH / 3;
export const BATTLE_TIME = RUSH + CLASH + BACK;

const ease = t => t * t * (3 - 2 * t);
const lerp = (a, b, k) => a + (b - a) * k;
const STEPS = [0, 1, 2, 1, 0, -1, -2, -1];

// Места поединков только внутри двух воюющих клеток, вдоль линии между ними.
function duelGrounds(from, to, count) {
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const ux = (to.x - from.x) / len, uy = (to.y - from.y) / len;
  const list = [];
  for (let along = -1; along <= 1; along++) {
    for (let side = -2; side <= 2; side++) {
      list.push({
        x: mid.x + ux * along * 36 - uy * side * 20,
        y: mid.y + uy * along * 36 * 0.82 + ux * side * 20 * 0.82 + 6,
      });
    }
  }
  const away = p => Math.hypot(p.x - mid.x, (p.y - mid.y - 6) * 1.6);
  return list.sort((a, b) => away(a) - away(b)).slice(0, count);
}

export class Battle {
  constructor(ev, posA, posB, seaA, seaB) {
    let seed = ev.a.id * 31 + ev.d.id * 17 + 5;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    this.rnd = rnd;
    this.mid = { x: (posA.x + posB.x) / 2, y: (posA.y + posB.y) / 2 };
    this.y = Math.max(posA.y, posB.y) + 30;
    this.t = 0;
    this.boats = [];

    const a = this.crew(ev.a, posA, seaA), d = this.crew(ev.d, posB, seaB);
    this.men = [];
    if (!seaA && !seaB) this.pairUp(a, d, posA, posB);
    else this.shoreFight(a, d, posA, posB, seaA, seaB);
    this.setFates(a, d);
    for (const m of this.men) this.fillBeats(m);
  }

  crew(info, pos, onSea) {
    const fac = factionId(info.owner);
    const rnd = this.rnd;
    const spots = formation(info.n, fac);
    const order = spots.map((_, i) => i).sort(() => rnd() - 0.5);
    const doomed = new Set(order.slice(0, Math.min(info.lost, spots.length)));
    const after = formation(info.n - info.lost, fac);
    let kept = 0;
    const men = spots.map((p, i) => {
      const dies = doomed.has(i);
      const end = dies ? null : after[kept++];
      return {
        fac, onSea, dies, dieAt: null, foe: null, beats: [],
        home: { x: pos.x + p.x, y: pos.y + p.y },
        back: end ? { x: pos.x + end.x, y: pos.y + end.y } : null,
        spot: null, dir: 1, phase: Math.floor(rnd() * 8),
      };
    });
    return men.sort((p, q) => Number(q.dies) - Number(p.dies));
  }

  pairUp(a, d, posA, posB) {
    const aLeft = posA.x <= posB.x;
    const pairs = Math.min(a.length, d.length);
    const grounds = duelGrounds(posA, posB, Math.max(pairs, 1));
    const late = [...d].reverse();          // воины с другой стороны: выжившие первыми
    for (let i = 0; i < pairs; i++) {
      const g = grounds[i], ma = a[i], md = late[i], tilt = (this.rnd() - 0.5) * 4;
      ma.spot = { x: g.x + (aLeft ? -13 : 13), y: g.y + tilt };
      md.spot = { x: g.x + (aLeft ? 13 : -13), y: g.y - tilt };
      ma.foe = md;
      md.foe = ma;
    }
    // Лишние воины большего отряда встают за плечо своего товарища.
    const extras = [...a.slice(pairs), ...late.slice(pairs)];
    extras.forEach((m, i) => {
      const own = a.includes(m) ? a : late;
      const mate = own[i % pairs];
      m.foe = mate.foe;
      m.spot = { x: mate.spot.x + (m.fac === a[0].fac ? (aLeft ? -10 : 10) : (aLeft ? 10 : -10)), y: mate.spot.y + (i % 2 ? 12 : -12) };
    });
    for (const m of [...a, ...d]) {
      m.dir = m.foe.spot.x >= m.spot.x ? 1 : -1;
      this.men.push(m);
    }
  }

  shoreFight(a, d, posA, posB, seaA, seaB) {
    for (const [own, onSea, pos, other] of [[a, seaA, posA, posB], [d, seaB, posB, posA]]) {
      if (onSea) {
        this.boats.push({ men: own, pos, fac: own[0].fac, toward: other });
        continue;
      }
      for (const m of own) {
        m.spot = { x: lerp(m.home.x, other.x, 0.42), y: lerp(m.home.y, other.y, 0.42) };
        m.dir = other.x >= pos.x ? 1 : -1;
        this.men.push(m);
      }
    }
  }

  setFates(a, d) {
    const rnd = this.rnd;
    for (const [own, enemy] of [[a, d], [d, a]]) {
      const hitters = enemy.filter(m => !m.dies && m.spot);
      for (const m of own) {
        if (!m.dies) continue;
        const span = hitters.length || enemy[0].onSea ? [RUSH + TEMPO, RUSH + CLASH - 0.5 * TEMPO] : [RUSH + 0.35 * TEMPO, RUSH + 0.9 * TEMPO];
        m.dieAt = lerp(span[0], span[1], rnd());
        m.dieAt = Math.round(m.dieAt / FRAME) * FRAME;
        const killer = (m.foe && !m.foe.dies && m.foe) || hitters[Math.floor(rnd() * hitters.length)] || m.foe;
        if (killer?.spot) killer.beats.push({ at: m.dieAt - STRIKE * FRAME, leap: rnd() < 0.3 });
      }
    }
  }

  fillBeats(m) {
    const rnd = this.rnd;
    const last = m.dieAt ?? RUSH + CLASH - 0.6 * TEMPO;
    for (let at = RUSH + (0.15 + rnd() * 0.7) * TEMPO; at < last - 0.5 * TEMPO; at += (1 + rnd() * 0.6) * TEMPO) {
      const snapped = Math.round(at / FRAME) * FRAME;
      const busy = [...m.beats, ...(m.foe?.beats || [])];
      if (busy.some(b => Math.abs(b.at - snapped) < 0.56)) continue;
      m.beats.push({ at: snapped, leap: rnd() < 0.2 });
    }
  }

  get done() { return this.t >= BATTLE_TIME; }

  pose(m, t) {
    const end = RUSH + CLASH;
    const run = Math.floor(t / FRAME);
    if (t < RUSH) {
      const k = ease(t / RUSH);
      return {
        x: lerp(m.home.x, m.spot.x, k), y: lerp(m.home.y, m.spot.y, k),
        step: run, hop: run % 2 ? 2.4 : 0, dir: m.spot.x >= m.home.x ? 1 : -1,
      };
    }
    if (m.dieAt != null && t >= m.dieAt) {
      // Павший падает и остаётся лежать до конца сцены, а не тает на глазах.
      const fall = Math.min(1, (t - m.dieAt) / (FRAME * 3));
      return { x: m.spot.x - m.dir * 5 * fall, y: m.spot.y, fall, dir: m.dir };
    }
    if (t < end) {
      for (const b of m.beats) {
        const f = Math.floor((t - b.at) / FRAME + 1e-6);
        if (f < 0 || f >= SWING.length) continue;
        return {
          x: m.spot.x + m.dir * (f >= STRIKE ? 4 : -1.5), y: m.spot.y, frame: f, dir: m.dir,
          hop: b.leap && f < STRIKE ? [4, 8][f] : 0,
          arc: f === STRIKE ? 1 : f === STRIKE + 1 ? 0.4 : 0, big: b.leap,
        };
      }
      const beat = Math.floor(t / (FRAME * 3)) + m.phase;
      return { x: m.spot.x + STEPS[beat % 8] * m.dir, y: m.spot.y, step: beat, dir: m.dir };
    }
    const k = ease(Math.min(1, (t - end) / BACK));
    return {
      x: lerp(m.spot.x, m.back.x, k), y: lerp(m.spot.y, m.back.y, k),
      step: run, hop: run % 2 && k < 1 ? 2.4 : 0, dir: m.back.x >= m.spot.x ? 1 : -1,
    };
  }

  drawBoat(ctx, b, t, time) {
    const k = t < RUSH ? ease(t / RUSH) : t > RUSH + CLASH ? 1 - ease((t - RUSH - CLASH) / BACK) : 1;
    const x = lerp(b.pos.x, this.mid.x, 0.3 * k), y = lerp(b.pos.y, this.mid.y, 0.3 * k) + 6;
    const alive = b.men.filter(m => m.dieAt == null || t < m.dieAt).length;
    boat(ctx, x, y, BOAT_SCALE, b.fac, alive, time);
    if (t >= RUSH && t < RUSH + CLASH && Math.floor(t / FRAME) % 14 === 3) {
      slashArc(ctx, x + (b.toward.x >= b.pos.x ? 22 : -22), y - 24, SOLDIER_SCALE, b.toward.x >= b.pos.x ? 1 : -1, 0.9, false);
    }
  }

  draw(ctx, view, time) {
    const t = Math.floor(this.t / FRAME + 1e-6) * FRAME;
    for (const b of this.boats) this.drawBoat(ctx, b, t, time);
    const list = this.men
      .map(m => ({ m, p: this.pose(m, t) }))
      .filter(({ p }) => p.alpha !== 0)
      .sort((a, b) => a.p.y - b.p.y);
    for (const { p } of list) {
      if (p.alpha != null) ctx.globalAlpha = p.alpha;
      soldierShadow(ctx, p.x, p.y, SOLDIER_SCALE, p.fall || 0);
      ctx.globalAlpha = 1;
    }
    for (const { m, p } of list) {
      if (p.alpha != null) ctx.globalAlpha = p.alpha;
      soldier(ctx, p.x, p.y, SOLDIER_SCALE, m.fac, { ...p, shadow: false });
      ctx.globalAlpha = 1;
    }
    for (const { p } of list) {
      if (p.arc) slashArc(ctx, p.x, p.y - 10, SOLDIER_SCALE, p.dir, p.arc, p.big);
    }
  }
}
