// Союзы и войны для общего экрана: живые царства по кругу, между ними линии.
// Союз — зелёная, война — красная, перемирие — серый пунктир с числом оставшихся ходов.
// Коалиция — три и больше царства, которые все в союзе друг с другом: они стоят подряд, под ними зелёная дуга
// с подписью «коалиция». Союз двух царств виден зелёной линией. Расстановка по кругу выбирается так,
// чтобы линии пересекались как можно реже: союзники рядом, враги напротив.
import { factionOf } from './hex.js';
import { FAC } from './art.js';
import { TRADE_CUT } from './balance.js';

const ALLY = '#8fd16a', WAR = '#e5483b', TRUCE = '#a89c84', TRADE = '#e2b64a', INK = '#f2efe6', DIM = '#a89c84';
const LIGHT = new Set(['yellow', 'snow']);   // на светлом кружке число войска пишется тёмным

const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const nameOf = id => factionOf(id).name;
const colorOf = id => FAC[factionOf(id).id].main;

// Царства, связанные союзами напрямую или через союзника: по ним царства расставляются по кругу.
function chains(ids, relations) {
  const root = new Map(ids.map(id => [id, id]));
  const find = x => {
    while (root.get(x) !== x) x = root.get(x);
    return x;
  };
  for (const [a, b, kind] of relations) {
    if (kind === 'ally' && root.has(a) && root.has(b)) root.set(find(a), find(b));
  }
  const groups = new Map();
  for (const id of ids) groups.set(find(id), [...(groups.get(find(id)) || []), id]);
  return [...groups.values()];
}

// Коалиции: наибольшие группы от трёх царств, где каждое в союзе с каждым (поиск клик Брона — Кербоша).
export function coalitions(ids, relations) {
  const pair = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const ally = new Set(relations.filter(r => r[2] === 'ally').map(([a, b]) => pair(a, b)));
  const linked = (a, b) => ally.has(pair(a, b));
  const out = [];
  const grow = (group, can, seen) => {
    if (!can.length && !seen.length) {
      if (group.length >= 3) out.push(group);
      return;
    }
    for (const v of [...can]) {
      grow([...group, v], can.filter(u => u !== v && linked(u, v)), seen.filter(u => linked(u, v)));
      can = can.filter(u => u !== v);
      seen = [...seen, v];
    }
  };
  grow([], [...ids], []);
  return out;
}

// Порядок по кругу. Перебираются все расстановки (царств не больше семи), первое царство стоит на месте,
// поэтому повороты круга не перебираются. Коалиция, разорванная по кругу, стоит очень дорого.
// Пересечение двух союзов дороже, чем союза с войной, а две войны пересекаются почти даром; длинный союз немного дороже короткого.
// При равной цене остаётся первая найденная расстановка: схема не прыгает, пока союзы и войны те же.
const breaks = (ids, place, n) => {
  const idx = ids.map(id => place.get(id)).sort((a, b) => a - b);
  let gaps = 0;
  for (let k = 0; k < idx.length; k++) if ((idx[(k + 1) % idx.length] - idx[k] + n) % n !== 1) gaps++;
  return gaps;
};

function arrange(ids, rel, groups) {
  const n = ids.length;
  if (n <= 3) return ids;
  const edges = rel.map(([a, b, kind]) => [a, b, kind === 'ally' ? 3 : 1]);
  const place = new Map();
  const between = (x, a, b) => {
    const d = (b - a + n) % n, e = (x - a + n) % n;
    return e > 0 && e < d;
  };
  const cost = order => {
    order.forEach((id, i) => place.set(id, i));
    let c = 0;
    for (const g of groups) if (breaks(g, place, n) > 1) c += 1000;
    for (let i = 0; i < edges.length; i++) {
      const [a, b, w1] = edges[i], A = place.get(a), B = place.get(b);
      for (let j = i + 1; j < edges.length; j++) {
        const [p, q, w2] = edges[j];
        if (p === a || p === b || q === a || q === b) continue;
        if (between(place.get(p), A, B) !== between(place.get(q), A, B)) c += w1 * w2;
      }
      if (w1 === 3) c += 0.5 * Math.min((A - B + n) % n, (B - A + n) % n);
    }
    return c;
  };
  let best = ids, bestCost = Infinity;
  const permute = (prefix, left) => {
    if (!left.length) {
      const order = [ids[0], ...prefix], c = cost(order);
      if (c < bestCost) [best, bestCost] = [order, c];
      return;
    }
    for (let i = 0; i < left.length; i++) permute([...prefix, left[i]], [...left.slice(0, i), ...left.slice(i + 1)]);
  };
  permute([], ids.slice(1));
  return best;
}

// players: [{id, out}], relations: [a, b, 'ally'|'war'], pacts: [a, b, ходов], army: {id: воинов}.
export function tiesView({ players, relations, pacts = [], trade = [], army = {} }) {
  const alive = players.filter(p => !p.out).map(p => p.id);
  const live = new Set(alive);
  const rel = relations.filter(([a, b]) => live.has(a) && live.has(b));
  const truce = pacts.filter(([a, b]) => live.has(a) && live.has(b));
  const groups = coalitions(alive, rel);
  const order = arrange(chains(alive, rel).sort((a, b) => b.length - a.length || a[0] - b[0]).flat(), rel, groups);
  const W = 1200, H = 760, cx = W / 2, cy = H / 2, R = 250;
  const step = (2 * Math.PI) / Math.max(1, order.length);
  const angle = new Map(order.map((id, i) => [id, -Math.PI / 2 + i * step]));
  const at = (id, r = R) => ({ x: cx + r * Math.cos(angle.get(id)), y: cy + r * Math.sin(angle.get(id)) });
  const most = Math.max(1, ...alive.map(id => army[id] || 0));
  const size = id => 30 + 22 * Math.sqrt((army[id] || 0) / most);
  const parts = [];

  // Подложка коалиции: широкая зелёная дуга по кругу под её царствами и подпись внутри круга.
  // Если двум коалициям с общим царством не хватило места стоять подряд, такая рисуется многоугольником.
  const place = new Map(order.map((id, i) => [id, i])), n = order.length;
  const tag = i => (groups.length > 1 ? `коалиция ${i + 1}` : 'коалиция');
  const point = a => `${(cx + R * Math.cos(a)).toFixed(1)} ${(cy + R * Math.sin(a)).toFixed(1)}`;
  groups.forEach((group, gi) => {
    let mid;
    if (group.length === n) {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${ALLY}" stroke-opacity=".2" stroke-width="120"/>`);
      mid = -Math.PI / 2 + Math.PI;
    } else if (breaks(group, place, n) <= 1) {
      const member = new Set(group);
      const first = group.find(id => !member.has(order[(place.get(id) - 1 + n) % n]));
      const a0 = angle.get(first) - step * 0.42, a1 = angle.get(first) + step * (group.length - 1) + step * 0.42;
      parts.push(`<path d="M ${point(a0)} A ${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${point(a1)}" fill="none" stroke="${ALLY}" stroke-opacity=".2" stroke-width="120" stroke-linecap="round"/>`);
      mid = (a0 + a1) / 2;
    } else {
      const points = [...group].sort((a, b) => place.get(a) - place.get(b)).map(id => at(id)).map(q => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');
      parts.push(`<g opacity=".16"><polygon points="${points}" fill="${ALLY}" stroke="${ALLY}" stroke-width="120" stroke-linejoin="round"/></g>`);
      mid = angle.get(group[0]);
    }
    const lx = cx + (R - 100) * Math.cos(mid), ly = cy + (R - 100) * Math.sin(mid);
    parts.push(`<text x="${lx.toFixed(1)}" y="${(ly + 8).toFixed(1)}" fill="${ALLY}" font-size="26" font-weight="600" text-anchor="middle" stroke="#14120e" stroke-width="6" paint-order="stroke">${tag(gi)}</text>`);
  });

  // Линии: сначала перемирия, поверх союзы и войны.
  const line = (a, b, color, width, dash = '') => {
    const p = at(a), q = at(b);
    return `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.y.toFixed(1)}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  };
  for (const [a, b, left] of truce) {
    if (rel.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) continue;
    parts.push(line(a, b, TRUCE, 4, '12 10'));
    const p = at(a), q = at(b);
    parts.push(`<text x="${((p.x + q.x) / 2).toFixed(1)}" y="${((p.y + q.y) / 2 - 8).toFixed(1)}" fill="${DIM}" font-size="22" text-anchor="middle">мир ${left}</text>`);
  }
  for (const [a, b, kind] of rel) parts.push(kind === 'war' ? line(a, b, WAR, 6) : line(a, b, ALLY, 9));
  // Торговый путь: золотая точечная нить поверх союза или мира.
  const routes = trade.filter(([a, b]) => live.has(a) && live.has(b));
  for (const [a, b] of routes) parts.push(line(a, b, TRADE, 4, '2 10'));

  // Царства: кружок цвета знамени, внутри войско, снаружи имя.
  for (const id of order) {
    const p = at(id), r = size(id), out = at(id, R + r + 18), cos = Math.cos(angle.get(id)), sin = Math.sin(angle.get(id));
    const anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle';
    const dy = sin > 0.5 ? 22 : sin < -0.5 ? -6 : 8;
    parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${colorOf(id)}" stroke="#14120e" stroke-width="4"/>`);
    parts.push(`<text x="${p.x.toFixed(1)}" y="${(p.y + 9).toFixed(1)}" fill="${LIGHT.has(factionOf(id).id) ? '#1d1a14' : INK}" font-size="26" font-weight="600" text-anchor="middle">${army[id] || 0}</text>`);
    parts.push(`<text x="${out.x.toFixed(1)}" y="${(out.y + dy).toFixed(1)}" fill="${INK}" font-size="28" text-anchor="${anchor}">${esc(nameOf(id))}</text>`);
  }

  const svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Союзы и войны">${parts.join('')}</svg>`;

  // Под схемой словами: легенда, коалиции и войны.
  const dot = id => `<i class="tiesDot" style="background:${colorOf(id)}"></i>`;
  const who = id => `${dot(id)}${esc(nameOf(id))}`;
  const rows = [];
  const unions = groups;
  for (const [gi, g] of unions.entries()) {
    const total = g.reduce((sum, id) => sum + (army[id] || 0), 0);
    rows.push(`<div class="tiesRow wide"><b>${unions.length > 1 ? `Коалиция ${gi + 1}` : 'Коалиция'}</b><span>${g.map(who).join(' + ')}</span><small>войско ${total}</small></div>`);
  }
  const wars = rel.filter(r => r[2] === 'war');
  for (const [a, b] of wars) rows.push(`<div class="tiesRow"><b class="war">Война</b><span>${who(a)} — ${who(b)}</span><small>${army[a] || 0} против ${army[b] || 0}</small></div>`);
  for (const [a, b] of routes) rows.push(`<div class="tiesRow"><b class="trade">Торговля</b><span>${who(a)} — ${who(b)}</span><small>еда −${Math.round(TRADE_CUT * 100)}%</small></div>`);
  if (!unions.length && !wars.length && !routes.length) rows.push(`<div class="tiesRow wide"><span>${rel.length ? 'Коалиций и войн нет, союзы видны на схеме' : 'Пока все живут в мире и без союзов'}</span></div>`);
  const legend = `<div class="tiesLegend"><span><i style="background:${ALLY}"></i>союз</span><span><i style="background:${WAR}"></i>война</span><span><i class="dash"></i>перемирие, ходов</span><span><i class="dots"></i>торговый путь</span><span>в кружке — войско</span></div>`;
  // Войн больше трёх: они идут в две колонки, коалиции по-прежнему во всю ширину.
  return { svg, list: `${legend}<div class="tiesGrid${wars.length + routes.length > 3 ? ' two' : ''}">${rows.join('')}</div>` };
}
