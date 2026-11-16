// QR-код для входа с телефона: байтовый режим, коррекция M, версии 1–6.
// Этого хватает на адрес вида http://192.168.100.200:3000 и заметно больше.

// Версия → [байт коррекции на блок, блоков, байт данных в блоке]
const BLOCKS = { 1: [10, 1, 16], 2: [16, 1, 28], 3: [26, 1, 44], 4: [18, 2, 32], 5: [24, 2, 43], 6: [16, 4, 27] };

const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];

const gfMul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    poly.forEach((c, j) => {
      next[j] ^= c;
      next[j + 1] ^= gfMul(c, EXP[i]);
    });
    poly = next;
  }
  return poly;
}

function remainder(data, degree) {
  const gen = generator(degree);
  const out = [...data, ...new Array(degree).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const factor = out[i];
    if (factor) gen.forEach((c, j) => { out[i + j] ^= gfMul(c, factor); });
  }
  return out.slice(data.length);
}

function codewords(bytes, version) {
  const [ecLen, blocks, dataLen] = BLOCKS[version];
  const capacity = blocks * dataLen;
  const bits = [];
  const push = (value, width) => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(4, 4);
  push(bytes.length, 8);
  bytes.forEach(b => push(b, 8));
  push(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => a * 2 + b, 0));
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);

  const parts = [], checks = [];
  for (let b = 0; b < blocks; b++) {
    const part = data.slice(b * dataLen, (b + 1) * dataLen);
    parts.push(part);
    checks.push(remainder(part, ecLen));
  }
  const out = [];
  for (let i = 0; i < dataLen; i++) parts.forEach(p => out.push(p[i]));
  for (let i = 0; i < ecLen; i++) checks.forEach(c => out.push(c[i]));
  return out;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  x => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
  (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];

function penalty(grid) {
  const size = grid.length;
  let score = 0, dark = 0;
  for (let i = 0; i < size; i++) {
    let rowRun = 1, colRun = 1;
    for (let j = 1; j < size; j++) {
      rowRun = grid[i][j] === grid[i][j - 1] ? rowRun + 1 : 1;
      colRun = grid[j][i] === grid[j - 1][i] ? colRun + 1 : 1;
      if (rowRun === 5) score += 3; else if (rowRun > 5) score++;
      if (colRun === 5) score += 3; else if (colRun > 5) score++;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (grid[y][x]) dark++;
      if (x && y && grid[y][x] === grid[y][x - 1] && grid[y][x] === grid[y - 1][x] && grid[y][x] === grid[y - 1][x - 1]) score += 3;
    }
  }
  return score + Math.floor(Math.abs(dark * 20 / (size * size) - 10)) * 10;
}

export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 1;
  while (version <= 6 && bytes.length + 2 > BLOCKS[version][1] * BLOCKS[version][2]) version++;
  if (version > 6) throw new Error('Адрес слишком длинный для QR-кода');

  const size = 17 + version * 4;
  const base = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const put = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    base[y][x] = dark;
    fixed[y][x] = true;
  };

  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const ring = Math.max(Math.abs(dx), Math.abs(dy));
        put(cx + dx, cy + dy, ring !== 2 && ring !== 4);
      }
    }
  }
  for (let i = 0; i < size; i++) {
    if (!fixed[6][i]) put(i, 6, i % 2 === 0);
    if (!fixed[i][6]) put(6, i, i % 2 === 0);
  }
  if (version > 1) {
    const c = size - 7;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) put(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  const format = mask => {
    const value = mask;              // старшие биты 00 — уровень M
    let rem = value;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    const bits = ((value << 10) | rem) ^ 0x5412;
    const bit = i => ((bits >> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) put(8, i, bit(i));
    put(8, 7, bit(6));
    put(8, 8, bit(7));
    put(7, 8, bit(8));
    for (let i = 9; i < 15; i++) put(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) put(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) put(8, size - 15 + i, bit(i));
    put(8, size - 8, true);
  };
  format(0);

  const stream = codewords(bytes, version);
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (fixed[y][x] || index >= stream.length * 8) continue;
        base[y][x] = ((stream[index >> 3] >> (7 - (index & 7))) & 1) === 1;
        index++;
      }
    }
  }

  let top = null, topScore = Infinity;
  MASKS.forEach((mask, id) => {
    format(id);
    const grid = base.map((row, y) => row.map((dark, x) => (!fixed[y][x] && mask(x, y) ? !dark : dark)));
    const score = penalty(grid);
    if (score < topScore) { top = grid; topScore = score; }
  });
  return top;
}

export function drawQR(canvas, text, css) {
  const grid = qrMatrix(text);
  const quiet = 4, cells = grid.length + quiet * 2;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const unit = Math.max(1, Math.floor((css * ratio) / cells));
  canvas.width = canvas.height = unit * cells;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#000';
  grid.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) g.fillRect((x + quiet) * unit, (y + quiet) * unit, unit, unit);
  }));
}
