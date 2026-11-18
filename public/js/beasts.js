// Горыныч и Водяной пером и штрихом: тень лежит справа, свет слева сверху.
const TAU = Math.PI * 2;
const INK = '#17120b';
const RED = { skin: '#a8432f', dark: '#74281f', belly: '#d2a860', wing: '#8c3527', horn: '#d8cdb0', eye: '#f0c75e' };
const SOM = { skin: '#55533f', back: '#34332a', water: '#2f4048', foam: 'rgba(214,226,220,.55)', hair: '#3a5240', tooth: '#d8cdb0', eye: '#e9a02e', maw: '#1c0e0c', throat: '#5e1f18', reed: '#8a6d2e' };
const WOOD = { bark: '#6b5238', moss: '#566f3f', leaf: '#7f9448', eye: '#f0c24a', hollow: '#140e08' };
const TUG = { horse: '#4a3424', mane: '#20160e', hoof: '#17110a', armor: '#5f6d3c', scale: '#3e4826', skin: '#9a7350', beard: '#2a1d12',
  cape: '#7c2018', wing: '#d9cdb2', blade: '#dcdad0', gold: '#c9a24a', eye: '#f2b544' };
const SOM_SIZE = 0.74;                  // сом заметно меньше клетки: страшен пастью, а не размером

// Заливка, штрих на теневой стороне правее from и контур пером.
function ink(c, d, fill, from = 0, width = 1.5) {
  const path = new Path2D(d);
  c.fillStyle = fill;
  c.fill(path);
  c.save();
  c.clip(path);
  c.beginPath();
  c.rect(from, -200, 400, 400);
  c.clip();
  c.fillStyle = 'rgba(16,12,8,.2)';
  c.fillRect(from, -200, 400, 400);
  c.strokeStyle = 'rgba(16,12,8,.62)';
  c.lineWidth = 0.8;
  c.beginPath();
  for (let x = from; x < from + 560; x += 3.2) { c.moveTo(x, -200); c.lineTo(x - 150, 200); }
  c.stroke();
  c.restore();
  c.strokeStyle = INK;
  c.lineWidth = width;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.stroke(path);
}

function pen(c, d, width = 1, color = INK) {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.lineCap = 'round';
  c.stroke(new Path2D(d));
}

function shadow(c, x, y, rx, ry = 6) {
  c.fillStyle = 'rgba(8,8,5,.5)';
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, TAU);
  c.fill();
}

// --- Горыныч ---

// Голова в профиль, смотрит влево: рога, раскрытая пасть, зубы.
function head(c, x, y) {
  c.save();
  c.translate(x, y);
  ink(c, 'M5,-8 L20,-18 L12,-5 Z', RED.horn, 99, 1.1);
  ink(c, 'M10,-5 L24,-9 L13,0 Z', RED.horn, 99, 1.1);
  ink(c, 'M11,6 L-13,10 L-19,7 L-3,3 Z', RED.dark, 99, 1.2);
  ink(c, 'M12,7 C17,-2 12,-10 4,-11 C-5,-12 -15,-6 -23,-1 L-21,3 L-6,2 L2,5 Z', RED.skin, 2, 1.4);
  c.fillStyle = '#e8e0c8';
  for (const x0 of [-19, -14, -9]) {
    c.beginPath(); c.moveTo(x0, 2); c.lineTo(x0 + 2.4, 6); c.lineTo(x0 + 4.4, 2); c.closePath(); c.fill();
  }
  c.fillStyle = RED.eye;
  c.beginPath(); c.arc(-4, -5.4, 2.2, 0, TAU); c.fill();
  c.fillStyle = INK;
  c.beginPath(); c.arc(-4.4, -5.4, 1.1, 0, TAU); c.fill();
  c.restore();
}

// Шея сужается к голове, по внешней стороне идут зубцы, поперёк лежат пластины.
function neck(c, x0, y0, cx, cy, x1, y1, side = 1) {
  const w0 = 9, w1 = 5;
  const normal = (ax, ay, bx, by) => {
    const a = Math.atan2(by - ay, bx - ax);
    return [-Math.sin(a), Math.cos(a)];
  };
  const [ax, ay] = normal(x0, y0, cx, cy), [bx, by] = normal(cx, cy, x1, y1), mx = ax + bx, my = ay + by;
  const at = t => {
    const u = 1 - t;
    return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1];
  };
  for (let t = 0.14; t < 0.95; t += 0.15) {
    const [x, y] = at(t), [p, q] = at(t + 0.06), [nx, ny] = normal(x, y, p, q), w = (w0 + (w1 - w0) * t) * side;
    ink(c, `M${x + nx * w},${y + ny * w} L${x + nx * (w + 5.5 * side) + (p - x)},${y + ny * (w + 5.5 * side) + (q - y)} L${p + nx * w},${q + ny * w} Z`, RED.dark, 99, 0.9);
  }
  ink(c, `M${x0 + ax * w0},${y0 + ay * w0} Q${cx + mx * 7},${cy + my * 7} ${x1 + bx * w1},${y1 + by * w1} L${x1 - bx * w1},${y1 - by * w1} Q${cx - mx * 7},${cy - my * 7} ${x0 - ax * w0},${y0 - ay * w0} Z`, RED.skin, cx + 1);
  const plates = [];
  for (let t = 0.2; t < 0.9; t += 0.13) {
    const [x, y] = at(t), [p, q] = at(t + 0.05), [nx, ny] = normal(x, y, p, q), w = (w0 + (w1 - w0) * t) * 0.8 * side;
    plates.push(`M${x - nx * w},${y - ny * w} L${x - nx * w * 0.2},${y - ny * w * 0.2}`);
  }
  pen(c, plates.join(' '), 0.9);
}

function claw(c, x, y, dir) {
  ink(c, `M${x - 9 * dir},${y - 4} L${x + 9 * dir},${y - 4} L${x + 12 * dir},${y + 3} L${x + 5 * dir},${y + 1} L${x + 2 * dir},${y + 4} L${x - 2 * dir},${y + 1} L${x - 6 * dir},${y + 4} L${x - 10 * dir},${y + 1} Z`, RED.dark, 99, 1.2);
}

// Сидит в профиль: крыло сложено, хвост свёрнут, шеи тянутся вперёд и вверх.
// Сдвиг держит рисунок внутри холста легенды.
function gorynych(c) {
  c.save();
  c.translate(2, 3);
  c.scale(0.96, 0.96);
  shadow(c, 12, 25, 50);
  ink(c, 'M30,14 C58,22 76,8 68,-14 C64,-24 52,-24 50,-14 C56,-12 58,-6 52,0 C44,8 34,6 26,0 Z', RED.skin, 46);
  ink(c, 'M50,-14 L44,-32 L60,-23 Z', RED.dark, 99, 1.1);
  ink(c, 'M8,-22 C18,-56 46,-74 74,-62 C64,-56 64,-46 54,-46 C56,-36 46,-34 40,-38 C38,-26 26,-22 20,-12 Z', RED.wing, 28);
  pen(c, 'M10,-22 L74,-62 M14,-18 L54,-46 M18,-14 L40,-38', 1.1);
  ink(c, 'M-28,24 C-36,-2 -22,-30 6,-32 C32,-34 46,-8 40,24 Z', RED.skin, 10);
  ink(c, 'M-27,24 C-31,4 -23,-14 -10,-22 C-3,-6 -3,10 -8,24 Z', RED.belly, 99, 1.2);
  pen(c, 'M-27,14 L-6,17 M-28,6 L-5,8 M-26,-3 L-5,-1 M-22,-11 L-6,-9');
  neck(c, 12, -26, 38, -58, 14, -86, -1);
  neck(c, -2, -26, 4, -58, -24, -74);
  neck(c, -14, -18, -30, -34, -50, -48);
  head(c, 8, -90);
  head(c, -30, -78);
  head(c, -56, -52);
  ink(c, 'M18,4 C34,0 42,12 34,24 L20,24 Z', RED.skin, 26);
  claw(c, 30, 24, -1);
  claw(c, -20, 25, 1);
  c.restore();
}

// --- Водяной ---

// Ус-щупальце: толстый у пасти, на конце крюк.
function feeler(c, d) {
  pen(c, d, 3.4);
  pen(c, d, 1.5, '#8d8768');
}

// Ряд зубов вдоль губы: зуб острый, длина неровная.
function teeth(c, lip, dir) {
  c.fillStyle = SOM.tooth;
  c.strokeStyle = INK;
  c.lineWidth = 0.9;
  c.lineJoin = 'round';
  [-31, -23, -15, -7, 2, 10, 18, 26].forEach((x, i) => {
    const y = lip(x), long = 7 + ((i * 5) % 3) * 2.5;
    c.beginPath();
    c.moveTo(x - 3.4, y);
    c.lineTo(x + 0.4, y + long * dir);
    c.lineTo(x + 3.4, lip(x + 3.4));
    c.closePath();
    c.fill();
    c.stroke();
  });
}

// Сом, хозяин омута: глаза щелями под тяжёлыми надбровьями, пасть полна зубов, усы крючьями, венец сгнил.
function vodyanoy(c) {
  c.save();
  c.translate(0, 7);
  c.scale(SOM_SIZE, SOM_SIZE);

  c.fillStyle = SOM.water;
  c.beginPath(); c.ellipse(0, 18, 60, 15, 0, 0, TAU); c.fill();
  c.strokeStyle = INK;
  c.lineWidth = 1.4;
  c.stroke();
  pen(c, 'M-46,23 Q-30,29 -14,25 M14,26 Q30,29 44,22', 1.2, SOM.foam);

  ink(c, 'M-44,14 L-72,-14 L-62,4 L-78,0 L-52,20 Z', SOM.back, 99, 1.3);
  ink(c, 'M44,14 L72,-14 L62,4 L78,0 L52,20 Z', SOM.back, 56, 1.3);
  feeler(c, 'M-34,2 C-54,-8 -66,-22 -62,-42 C-61,-48 -54,-49 -53,-43');
  feeler(c, 'M34,2 C54,-8 66,-22 62,-42 C61,-48 54,-49 53,-43');

  ink(c, 'M-42,16 C-56,-10 -46,-38 -22,-46 C-8,-51 8,-51 22,-46 C46,-38 56,-10 42,16 C22,24 -22,24 -42,16 Z', SOM.skin, 6);
  ink(c, 'M-30,-40 C-14,-50 14,-50 30,-40 C14,-44 -14,-44 -30,-40 Z', SOM.back, 99, 1);
  c.fillStyle = 'rgba(24,20,12,.75)';
  for (const [x, y, r] of [[-20, -32, 3.2], [-34, -8, 2.6], [36, -10, 2.2], [-8, -38, 1.8]]) {
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }
  pen(c, 'M8,-44 L22,-22 M11,-34 L18,-37 M15,-28 L22,-31', 1.2);

  // Глаза щелями под надбровьем: нависшая кость делает взгляд злым.
  for (const dir of [1, -1]) {
    c.save();
    c.scale(dir, 1);
    ink(c, 'M34,-15 L13,-7 C19,-2 29,-4 34,-15 Z', SOM.eye, 99, 1.1);
    ink(c, 'M42,-27 L9,-11 L13,-5 L37,-14 Z', SOM.back, 99, 1.2);
    c.fillStyle = INK;
    c.beginPath(); c.ellipse(22, -7.6, 1.1, 2.7, 0, 0, TAU); c.fill();
    c.restore();
  }

  const upper = x => 5 - (x / 38) ** 2 * 7, lower = x => 25 - (x / 38) ** 2 * 18;
  ink(c, 'M-38,-2 C-20,6 20,6 38,-2 C38,16 20,25 0,25 C-20,25 -38,16 -38,-2 Z', SOM.maw, 99, 1.6);
  c.fillStyle = SOM.throat;
  c.beginPath(); c.ellipse(0, 16, 15, 5.6, 0, 0, TAU); c.fill();
  teeth(c, lower, -1);
  teeth(c, upper, 1);

  feeler(c, 'M-36,10 C-52,16 -68,12 -74,-2 C-76,-8 -70,-11 -67,-6');
  feeler(c, 'M36,10 C52,16 68,12 74,-2 C76,-8 70,-11 67,-6');

  // Гнилой венец из камыша, с него свисает тина.
  ink(c, 'M-22,-45 L-26,-61 L-18,-53 L-13,-66 L-8,-54 L-2,-64 L3,-53 L9,-67 L13,-54 L20,-60 L22,-45 C8,-51 -8,-51 -22,-45 Z', SOM.reed, 2, 1.3);
  pen(c, 'M-20,-46 C-25,-38 -22,-32 -28,-24 M-13,-48 C-16,-42 -14,-36 -17,-30 M15,-48 C18,-42 15,-37 19,-31 M21,-46 C26,-38 23,-32 29,-25', 2, SOM.hair);

  c.restore();
}

// --- Леший ---

// Сухая коряга на двух корнях: рога-ветви, руки-сучья до колен, глаза горят из дупел, борода мхом.
function leshy(c) {
  shadow(c, 8, 25, 40);
  const horns = 'M-12,-56 C-22,-70 -30,-78 -30,-94 M-23,-72 C-31,-72 -38,-76 -43,-86 M-28,-84 L-20,-94 M12,-56 C22,-70 30,-78 30,-94 M23,-72 C31,-72 38,-76 43,-86 M28,-84 L20,-94';
  pen(c, horns, 6.2);
  pen(c, horns, 3.6, WOOD.bark);
  for (const [x, y, a] of [[-44, -89, -0.6], [-31, -97, -0.2], [-19, -97, 0.5], [44, -89, 0.6], [31, -97, 0.2], [19, -97, -0.5]]) {
    c.save();
    c.translate(x, y);
    c.rotate(a);
    ink(c, 'M0,-7 C4,-4 4,3 0,6 C-4,3 -4,-4 0,-7 Z', WOOD.leaf, 99, 1);
    c.restore();
  }
  ink(c, 'M-17,-38 C-34,-36 -46,-18 -46,2 L-53,12 L-46,9 L-44,16 L-40,8 L-33,11 L-38,0 C-36,-14 -28,-22 -15,-24 Z', WOOD.bark, 99);
  ink(c, 'M17,-38 C34,-36 46,-18 46,2 L53,12 L46,9 L44,16 L40,8 L33,11 L38,0 C36,-14 28,-22 15,-24 Z', WOOD.bark, 30);
  ink(c, 'M-25,25 L-17,8 C-22,-20 -20,-50 0,-56 C20,-50 22,-20 17,8 L25,25 L13,19 L5,26 L-5,19 L-14,26 Z', WOOD.bark, 3);
  pen(c, 'M-15,-30 C-13,-24 -16,-18 -14,-12 M15,-34 C13,-28 16,-22 14,-14 M-12,10 C-10,14 -12,18 -10,21 M11,8 C9,13 12,17 10,20', 1.1);
  ink(c, 'M-21,-44 C-12,-60 12,-60 21,-44 C10,-51 -10,-51 -21,-44 Z', WOOD.moss, 99, 1.1);
  for (const dir of [1, -1]) {
    c.save();
    c.scale(dir, 1);
    ink(c, 'M15,-41 C11,-47 3,-45 3,-38 C6,-33 13,-34 15,-41 Z', WOOD.hollow, 99, 1.1);
    c.fillStyle = WOOD.eye;
    c.beginPath(); c.arc(8.6, -39.4, 1.9, 0, TAU); c.fill();
    pen(c, 'M16,-46 L4,-41', 2.6);
    c.restore();
  }
  ink(c, 'M-2,-36 L6,-24 L-4,-27 Z', WOOD.bark, 99, 1.1);
  ink(c, 'M-12,-20 L-7,-17 L-3,-21 L2,-17 L7,-21 L12,-18 C8,-9 -7,-9 -12,-20 Z', WOOD.hollow, 99, 1.2);
  ink(c, 'M-17,-15 C-19,-2 -13,14 -8,18 C-7,10 -5,10 -3,20 C-1,10 2,10 4,19 C6,11 8,11 10,16 C15,6 19,-6 17,-15 C8,-7 -8,-7 -17,-15 Z', WOOD.moss, 3);
  pen(c, 'M-9,-6 C-10,0 -8,6 -9,10 M-2,-5 C-3,2 -1,8 -2,13 M6,-6 C5,0 7,5 6,10', 0.9);
}

// --- Тугарин Змеевич ---

// Великан на гнедом коне смотрит влево: змеиная чешуя на доспехе, змей на шлеме, сабля над головой,
// позади бунчук с красным хвостом. Его войско ходит по карте отдельными сотнями.
function tugarin(c) {
  shadow(c, 2, 25, 56, 7);
  // бунчук позади всадника
  pen(c, 'M16,-30 L22,-104', 3.4);
  pen(c, 'M16,-30 L22,-104', 1.6, '#6b4b2c');
  ink(c, 'M22,-100 C31,-90 31,-76 25,-60 C22,-72 19,-86 22,-100 Z', TUG.cape, 99, 1.2);
  pen(c, 'M23,-94 C26,-84 25,-74 24,-66', 0.9);
  c.fillStyle = TUG.gold;
  c.beginPath(); c.arc(22, -106, 3.2, 0, TAU); c.fill();
  c.strokeStyle = INK; c.lineWidth = 1.1; c.stroke();


  // конь: хвост, задние ноги, тело, передние ноги, шея и голова
  ink(c, 'M33,-8 C47,-6 52,8 46,22 C42,12 38,6 31,2 Z', TUG.mane, 99, 1.2);
  ink(c, 'M20,6 L24,22 L30,22 L28,6 Z', TUG.horse, 99, 1.1);
  ink(c, 'M-24,6 L-28,22 L-22,22 L-17,6 Z', TUG.horse, 99, 1.1);
  ink(c, 'M-34,-6 C-36,-20 -18,-27 4,-25 C22,-24 35,-17 35,-3 C35,8 25,12 10,12 L-20,12 C-30,12 -34,6 -34,-6 Z', TUG.horse, 12);
  ink(c, 'M12,6 L14,22 L20,22 L19,6 Z', TUG.horse, 99, 1.1);
  ink(c, 'M-15,6 L-17,22 L-11,22 L-8,6 Z', TUG.horse, 99, 1.1);
  c.fillStyle = TUG.hoof;
  for (const x of [-25, -14, 17, 27]) c.fillRect(x - 3, 20, 6, 3);
  // шея широкая, голова с длинной мордой опущена вниз-влево, ухо торчком, грива по гребню шеи
  ink(c, 'M-32,-8 C-37,-20 -43,-29 -47,-35 L-37,-47 C-31,-38 -23,-30 -15,-24 Z', TUG.horse, -40);
  ink(c, 'M-47,-35 L-59,-32 C-64,-31 -65,-25 -60,-23 L-49,-24 C-44,-26 -40,-32 -38,-38 L-37,-47 C-41,-50 -45,-48 -47,-44 Z', TUG.horse, -52, 1.3);
  ink(c, 'M-39,-46 L-38,-56 L-34,-47 Z', TUG.horse, 99, 1.1);
  ink(c, 'M-37,-47 C-31,-38 -23,-30 -15,-24 L-18,-31 L-22,-32 L-24,-38 L-28,-39 L-30,-45 Z', TUG.mane, 99, 1);
  c.fillStyle = INK;
  c.beginPath(); c.arc(-46, -38, 1.5, 0, TAU); c.fill();
  c.beginPath(); c.arc(-60, -27, 1, 0, TAU); c.fill();
  pen(c, 'M-60,-24 L-47,-31 L-33,-22 M-47,-31 L-42,-44', 1, '#2b1d10');
  // попона в чешуе
  ink(c, 'M-12,-24 C-4,-26 10,-26 18,-23 L16,-6 C8,-4 -6,-4 -14,-6 Z', TUG.cape, 6, 1.2);
  pen(c, 'M-12,-10 Q-8,-6 -4,-10 Q0,-6 4,-10 Q8,-6 12,-10 M-11,-16 Q-7,-12 -3,-16 Q1,-12 5,-16 Q9,-12 13,-16', 0.8, '#4a120d');

  // всадник: нога, тело в змеиной чешуе, плечи
  ink(c, 'M-2,-24 L-7,-4 L1,-3 L6,-22 Z', TUG.armor, 99, 1.2);
  ink(c, 'M-13,-25 C-16,-44 -11,-58 0,-62 C11,-58 15,-44 12,-25 Z', TUG.armor, 3);
  pen(c, 'M-10,-30 Q-7,-27 -4,-30 Q-1,-27 2,-30 Q5,-27 8,-30 M-11,-37 Q-8,-34 -5,-37 Q-2,-34 1,-37 Q4,-34 7,-37 Q10,-34 11,-37 M-10,-44 Q-7,-41 -4,-44 Q-1,-41 2,-44 Q5,-41 8,-44 M-8,-51 Q-5,-48 -2,-51 Q1,-48 4,-51 Q7,-48 8,-51', 0.8, TUG.scale);
  ink(c, 'M-14,-56 C-18,-58 -22,-54 -20,-50 L-11,-48 Z', TUG.scale, 99, 1.1);
  ink(c, 'M12,-56 C17,-58 20,-53 18,-49 L10,-48 Z', TUG.scale, 99, 1.1);
  // рука с бунчуком
  ink(c, 'M10,-50 L18,-36 L14,-33 L7,-45 Z', TUG.armor, 99, 1.1);

  // голова: лицо, чёрная борода, глаза горят
  ink(c, 'M-7,-62 C-9,-70 -5,-77 0,-77 C5,-77 9,-70 7,-62 Z', TUG.skin, 3, 1.2);
  ink(c, 'M-7,-65 C-8,-57 -3,-53 0,-52 C3,-53 8,-57 7,-65 C3,-61 -3,-61 -7,-65 Z', TUG.beard, 99, 1.1);
  c.fillStyle = TUG.eye;
  for (const x of [-3.4, 2.2]) c.fillRect(x - 1.2, -69.5, 2.6, 1.6);
  // островерхий шлем и змей на нём
  ink(c, 'M-9,-71 C-9,-80 -4,-88 0,-95 C4,-88 9,-80 9,-71 C4,-73 -4,-73 -9,-71 Z', TUG.gold, 2, 1.2);
  pen(c, 'M-8,-72 C-3,-74 3,-74 8,-72', 1.4, TUG.scale);
  pen(c, 'M0,-95 C-6,-100 4,-105 -2,-111 C-5,-114 -9,-112 -9,-108', 2.6);
  pen(c, 'M0,-95 C-6,-100 4,-105 -2,-111 C-5,-114 -9,-112 -9,-108', 1.4, TUG.armor);
  c.fillStyle = TUG.eye;
  c.beginPath(); c.arc(-8.6, -108.6, 1, 0, TAU); c.fill();

  // рука с саблей над головой
  ink(c, 'M-10,-50 L-25,-62 L-21,-67 L-6,-56 Z', TUG.armor, 99, 1.1);
  ink(c, 'M-23,-66 C-34,-79 -37,-93 -31,-106 C-33,-92 -29,-80 -19,-69 Z', TUG.blade, 99, 1.1);
  pen(c, 'M-27,-61 L-17,-71', 2.4, TUG.gold);
}

export const BEASTS = { gorynych, vodyanoy, leshy, tugarin };
