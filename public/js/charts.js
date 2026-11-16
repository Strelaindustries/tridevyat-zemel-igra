// Графики итогов партии: на показатель один SVG с одной осью и по линии на царство.
// Зелёный и бирюзовый на чёрном почти сливаются, поэтому у каждой линии ещё свой штрих
// и свой маркер, а подпись стоит прямо у конца линии. Текст всегда цвета текста.
const NS = 'http://www.w3.org/2000/svg';
const MARK = 4;

const shape = {
  circle: r => `M${-r} 0a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`,
  square: r => `M${-r * 0.88} ${-r * 0.88}h${r * 1.76}v${r * 1.76}h${-r * 1.76}Z`,
  diamond: r => `M0 ${-r * 1.28}L${r * 1.28} 0L0 ${r * 1.28}L${-r * 1.28} 0Z`,
  up: r => `M0 ${-r * 1.3}L${r * 1.25} ${r * 0.92}L${-r * 1.25} ${r * 0.92}Z`,
  down: r => `M0 ${r * 1.3}L${r * 1.25} ${-r * 0.92}L${-r * 1.25} ${-r * 0.92}Z`,
};

function draw(tag, attrs, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  parent?.append(node);
  return node;
}

function html(tag, className, parent, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  parent?.append(node);
  return node;
}

// Круглые деления: ось всегда начинается с нуля, шаг только целый.
function valueTicks(max) {
  if (max <= 0) return [0, 1];
  const rough = max / 4, size = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map(k => k * size).find(s => s >= rough));
  const whole = Number.isInteger(step) ? step : Math.ceil(step);
  const ticks = [0];
  while (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + whole);
  return ticks;
}

function turnTicks(turns) {
  const span = turns.length;
  const step = [1, 2, 5, 10, 20, 50, 100, 200].find(s => span / s <= 5.5) || 500;
  const ticks = turns.filter(t => t % step === 0);
  if (!ticks.length || ticks[0] - turns[0] > step * 0.45) ticks.unshift(turns[0]);
  return ticks;
}

const compact = v => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0).replace('.', ',')} тыс` : String(v));

// Подписи концов линий расходятся по вертикали, сохраняя порядок линий.
function spread(labels, gap, top, bottom) {
  labels.sort((a, b) => a.y - b.y);
  labels.forEach(l => { l.at = l.y; });
  for (let pass = 0; pass < 40; pass++) {
    for (let i = 1; i < labels.length; i++) {
      const lack = gap - (labels[i].at - labels[i - 1].at);
      if (lack > 0) { labels[i - 1].at -= lack / 2; labels[i].at += lack / 2; }
    }
    const shift = Math.max(0, top - labels[0].at) - Math.max(0, labels[labels.length - 1].at - bottom);
    if (shift) labels.forEach(l => { l.at += shift; });
  }
}

let serial = 0;

function chart(host, { title, data }, { turns, series, onHover }) {
  const box = html('figure', 'chart', host);
  html('figcaption', '', box, title);
  const room = html('div', 'chartRoom', box);
  const W = room.clientWidth, H = room.clientHeight, font = parseFloat(getComputedStyle(room).fontSize);
  const svg = draw('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${title} по ходам` }, room);
  const count = turns.length;
  const lastOf = s => Math.min(count - 1, s.end ?? count - 1);
  const max = Math.max(...series.flatMap((s, i) => data[i].slice(0, lastOf(s) + 1)), 0);
  const ticks = valueTicks(max), top = ticks[ticks.length - 1];

  // Ширина полей считается по настоящим подписям: так ничего не обрезается.
  const labels = series.map((s, i) => {
    const last = lastOf(s), text = draw('text', { class: 'endLabel', 'dominant-baseline': 'middle' }, svg);
    draw('tspan', { class: 'endName' }, text).textContent = `${s.short} `;
    if (last === count - 1) draw('tspan', { class: 'endValue' }, text).textContent = compact(data[i][last]);
    return { s, i, last, text, width: text.getComputedTextLength() };
  });
  const tickText = ticks.map(v => {
    const text = draw('text', { class: 'tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, svg);
    text.textContent = compact(v);
    return { v, text, width: text.getComputedTextLength() };
  });
  const alive = labels.filter(l => l.last === count - 1);
  const left = Math.max(...tickText.map(t => t.width)) + 7;
  const right = W - (Math.max(0, ...alive.map(l => l.width)) + 20);
  const lineHeight = Math.max(font * 1.2, tickText[0].text.getBBox().height);
  const roof = lineHeight * 0.6, floor = H - lineHeight - 4;
  const x = i => (count > 1 ? left + (i / (count - 1)) * (right - left) : (left + right) / 2);
  const y = v => floor - (v / top) * (floor - roof);

  const grid = draw('g', {}, svg);
  for (const { v, text } of tickText) {
    text.setAttribute('x', left - 7);
    text.setAttribute('y', y(v));
    draw('line', { class: v ? 'grid' : 'base', x1: left, x2: right, y1: y(v), y2: y(v) }, grid);
  }
  for (const t of turnTicks(turns)) {
    const label = draw('text', { class: 'tick', x: x(turns.indexOf(t)), y: H - lineHeight / 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, grid);
    label.textContent = t === turns[0] ? `ход ${t}` : t;
  }

  // Линии проявляются слева направо.
  const clipId = `chartClip${++serial}`;
  const clip = draw('clipPath', { id: clipId }, svg);
  draw('rect', { class: 'reveal', x: 0, y: 0, width: W, height: H }, clip);
  const lines = draw('g', { 'clip-path': `url(#${clipId})` }, svg);
  series.forEach((s, i) => {
    const last = lastOf(s), points = data[i].slice(0, last + 1).map((v, k) => `${x(k).toFixed(1)} ${y(v).toFixed(1)}`);
    draw('path', {
      class: 'line', d: `M${points.join('L')}`, stroke: s.color, ...(s.dash ? { 'stroke-dasharray': s.dash } : {}),
    }, lines);
    // Маркеры редко и вразбег, чтобы линии различались и там, где цвета близки.
    const stride = Math.max(1, Math.round(count / 5));
    for (let k = Math.round((stride * (i + 1)) / (series.length + 1)); k < last; k += stride) {
      draw('path', { class: 'mark', d: shape[s.mark](MARK), fill: s.color, transform: `translate(${x(k)} ${y(data[i][k])})` }, lines);
    }
    draw('path', { class: 'mark', d: shape[s.mark](MARK * 1.2), fill: s.color, transform: `translate(${x(last)} ${y(data[i][last])})` }, lines);
  });

  // Живые царства подписаны справа, линия выноски держит подпись у своей линии.
  // Павшие подписаны у места гибели, поверх остальных линий.
  const spot = alive.map(l => ({ ...l, y: y(data[l.i][l.last]) }));
  if (spot.length) spread(spot, lineHeight, roof, floor);
  for (const l of spot) {
    l.text.setAttribute('x', right + 15);
    l.text.setAttribute('y', l.at);
    if (Math.abs(l.at - l.y) > 2.5) {
      draw('line', { class: 'leader', x1: right + 6, y1: l.y, x2: right + 13, y2: l.at, stroke: l.s.color }, svg);
    }
    svg.append(l.text);
  }
  const taken = spot.map(l => ({ x: right + 15, y: l.at, w: l.width }));
  for (const l of labels.filter(k => k.last < count - 1)) {
    const px = x(l.last), py = y(data[l.i][l.last]);
    const flip = px + 9 + l.width > W;
    const at = { x: flip ? px - 9 - l.width : px + 9, y: Math.min(floor - font * 0.5, py - font * 0.1), w: l.width };
    while (taken.some(o => Math.abs(o.y - at.y) < lineHeight && at.x < o.x + o.w && o.x < at.x + at.w)) at.y -= lineHeight;
    taken.push(at);
    l.text.setAttribute('x', at.x);
    l.text.setAttribute('y', at.y);
    l.text.classList.add('fallen');
    svg.append(l.text);
  }

  // Слой наведения: прицел ищет ближайший ход, точки показывают значения всех линий.
  const cursor = draw('g', { class: 'cursor', visibility: 'hidden' }, svg);
  const rule = draw('line', { class: 'cursorRule', y1: roof, y2: floor }, cursor);
  const dots = series.map(s => draw('path', { class: 'mark', d: shape[s.mark](MARK), fill: s.color }, cursor));
  const tip = html('div', 'chartTip hidden', room);

  const show = (index, here) => {
    const px = x(index);
    cursor.setAttribute('visibility', 'visible');
    rule.setAttribute('x1', px);
    rule.setAttribute('x2', px);
    series.forEach((s, i) => {
      const live = index <= lastOf(s);
      dots[i].setAttribute('visibility', live ? 'inherit' : 'hidden');
      if (live) dots[i].setAttribute('transform', `translate(${px} ${y(data[i][index])})`);
    });
    tip.classList.toggle('hidden', !here);
    if (!here) return;
    tip.textContent = '';
    html('div', 'tipHead', tip, `Ход ${turns[index]}`);
    const rows = series.map((s, i) => ({ s, value: index <= lastOf(s) ? data[i][index] : null }))
      .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
    for (const { s, value } of rows) {
      const row = html('div', 'tipRow', tip);
      html('b', '', row, value == null ? 'пало' : compact(value));
      row.append(lineKey(s));
      html('span', '', row, s.short);
    }
    const width = tip.offsetWidth, height = tip.offsetHeight;
    tip.style.left = `${px + 14 + width > W ? Math.max(0, px - 14 - width) : px + 14}px`;
    tip.style.top = `${Math.max(0, Math.min(H - height, roof))}px`;
  };
  const hide = () => {
    cursor.setAttribute('visibility', 'hidden');
    tip.classList.add('hidden');
  };

  const hit = draw('rect', { class: 'hit', x: left, y: 0, width: Math.max(1, W - left), height: H }, svg);
  const pick = e => {
    const frame = svg.getBoundingClientRect();
    const k = count > 1 ? ((e.clientX - frame.left - left) / (right - left)) * (count - 1) : 0;
    return Math.max(0, Math.min(count - 1, Math.round(k)));
  };
  const self = { show, hide };
  hit.addEventListener('pointermove', e => onHover(pick(e), self));
  hit.addEventListener('pointerleave', () => onHover(null, self));
  return self;
}

// Образец линии для легенды и подсказки: тот же цвет, штрих и маркер.
function lineKey(s, wide = false) {
  const w = wide ? 34 : 22;
  const key = draw('svg', { class: 'lineKey', width: w, height: 12, viewBox: `0 0 ${w} 12` });
  draw('line', { x1: 1, x2: w - 1, y1: 6, y2: 6, stroke: s.color, 'stroke-width': 2, ...(s.dash ? { 'stroke-dasharray': s.dash } : {}) }, key);
  draw('path', { d: shape[s.mark](MARK), fill: s.color, stroke: '#000', 'stroke-width': 1.5, 'paint-order': 'stroke', transform: `translate(${w / 2} 6)` }, key);
  return key;
}

export function drawLegend(host, series) {
  host.textContent = '';
  for (const s of series) {
    const item = html('span', 'legendItem', host);
    item.append(lineKey(s, true));
    html('span', '', item, s.name);
  }
}

// turns: номера ходов, series: {name, short, color, dash, mark, end}, metrics: {title, data[линия][ход]}.
export function drawCharts(host, { turns, series, metrics }) {
  host.textContent = '';
  const list = [];
  const onHover = (index, source) => {
    for (const c of list) {
      if (index == null) c.hide();
      else c.show(index, c === source);
    }
  };
  for (const metric of metrics) list.push(chart(host, metric, { turns, series, onHover }));
}
