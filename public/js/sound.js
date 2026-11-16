// Звук общего экрана: музыка без файлов, короткие звуки и диктор. На телефонах этого модуля нет.
// Оркестр не знает, куда играет: тот же код работает и в колонки, и в OfflineAudioContext.
import { seeded } from './art.js';

// --- партитура ---

const STEP = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const pitchOf = name => {
  const [, step, flat, octave] = /^([a-g])(b?)(\d)$/.exec(name);
  return 12 * (Number(octave) + 1) + STEP[step] - (flat ? 1 : 0);
};

// Напев пишется тактами: «нота доли», прочерк это пауза, в такте четыре доли.
function tune(text) {
  const notes = [];
  text.split('|').forEach((bar, index) => {
    const items = bar.trim().split(/\s+/);
    let at = index * 4;
    for (let i = 0; i < items.length; i += 2) {
      const len = Number(items[i + 1]);
      if (items[i] !== '-') notes.push({ at, len, pitch: pitchOf(items[i]) });
      at += len;
    }
  });
  notes.forEach((n, i) => { n.tied = notes[i + 1]?.at === n.at + n.len; });
  return notes;
}

const harmony = text => text.split('|').map(bar => bar.trim().split(' '));

// Лад: натуральный ре минор. Вводного тона нет: запев обрывается на пятой ступени,
// ответ поднимается к вершине и приходит в тонику снизу, через седьмую, как в протяжной песне.
const VERSE = tune(`
  a4 1  d5 1  f5 1.5  e5 .5 |
  d5 1.5  c5 .5  a4 2 |
  bb4 1  c5 .5  d5 .5  c5 1  bb4 1 |
  a4 3  - 1 |
  a4 1  d5 1  f5 1  g5 1 |
  a5 1.5  g5 .5  f5 1  e5 .5  f5 .5 |
  e5 1  d5 .5  c5 .5  d5 1  e5 .5  c5 .5 |
  d5 3  - 1`);

// Тот же запев с украшениями: форшлаги и опевания вокруг опорных нот.
const VERSE_FINE = tune(`
  a4 .75  g4 .125  a4 .125  d5 1  e5 .125  f5 1.375  e5 .25  d5 .25 |
  e5 .125  d5 1.375  c5 .5  a4 1.5  c5 .25  a4 .25 |
  bb4 1  c5 .25  d5 .25  e5 .25  d5 .25  c5 1  bb4 .5  c5 .5 |
  bb4 .125  a4 2.875  - 1 |
  a4 1  c5 .125  d5 .875  f5 .75  e5 .25  f5 .5  g5 .5 |
  bb5 .125  a5 1.375  g5 .5  f5 .75  g5 .25  e5 .5  f5 .5 |
  e5 .75  f5 .25  d5 .5  c5 .5  d5 .75  e5 .25  d5 .5  c5 .5 |
  c5 .125  d5 2.875  - 1`);

// Подголосок: идёт под запевом терциями и сходится с ним в пустую квинту на каденции.
const VERSE_LOW = tune(`
  - 1  a4 1  a4 1.5  g4 .5 |
  f4 1.5  e4 .5  e4 2 |
  f4 1  g4 1  a4 1  f4 1 |
  e4 3  - 1 |
  - 1  f4 1  a4 1  bb4 1 |
  c5 1.5  bb4 .5  a4 1  g4 .5  a4 .5 |
  g4 2  f4 1  g4 .5  e4 .5 |
  a4 3  - 1`);

// Долгие верхние ноты над напевом, когда его ведут гусли.
const VERSE_HIGH = tune(`
  a5 4 |
  f5 2  e5 2 |
  f5 4 |
  e5 4 |
  a5 4 |
  c6 2  bb5 2 |
  g5 4 |
  a5 3  - 1`);

// Припев уходит в параллельный фа мажор и возвращается в тонику тем же оборотом.
const CHORUS = tune(`
  c5 1  f5 1  a5 1.5  g5 .5 |
  f5 1  g5 .5  f5 .5  e5 1  c5 1 |
  d5 1  e5 .5  f5 .5  g5 1  a5 1 |
  g5 3  - 1 |
  a5 1  c6 1  bb5 .5  a5 .5  g5 1 |
  a5 1  f5 1  d5 2 |
  e5 1  f5 .5  e5 .5  d5 1  c5 1 |
  d5 3  - 1`);

const CHORUS_FINE = tune(`
  c5 .75  e5 .25  f5 1  g5 .125  a5 1.375  g5 .25  f5 .25 |
  f5 1  g5 .25  a5 .25  g5 .25  f5 .25  e5 .75  f5 .25  c5 1 |
  d5 .75  e5 .25  f5 .5  e5 .25  f5 .25  g5 1  a5 .5  g5 .5 |
  a5 .125  g5 2.875  - 1 |
  a5 .75  bb5 .25  c6 1  bb5 .5  a5 .5  g5 .75  a5 .25 |
  bb5 .125  a5 .875  f5 1  e5 .125  d5 1.875 |
  e5 .75  g5 .25  f5 .5  e5 .5  d5 .75  e5 .25  c5 1 |
  c5 .125  d5 2.875  - 1`);

const CHORUS_LOW = tune(`
  - 1  c5 1  f5 1.5  e5 .5 |
  d5 1.5  c5 .5  c5 1  g4 1 |
  bb4 1.5  a4 .5  bb4 1  c5 1 |
  c5 3  - 1 |
  f5 1  e5 1  d5 1  c5 .5  bb4 .5 |
  c5 2  a4 2 |
  g4 1.5  a4 .5  bb4 1  g4 1 |
  a4 3  - 1`);

// Два аккорда на такт, по одному на половину.
const VERSE_CHORDS = harmony('Dm Dm | Dm Am | Bb F | Am Am | Dm Gm | F Bb | C C | Dm Dm');
const CHORUS_CHORDS = harmony('F F | F C | Bb C | C C | F Gm | F Dm | C C | Dm Dm');
const OPENING = harmony('Dm Dm | C C | Bb Bb | Am Am');
const INTERLUDE = harmony('Dm Dm | Bb Bb | F F | C C | Dm Dm | Gm Gm | Am Am | Dm Dm');

// Струны аккорда: бас, квинта, октава, терция, квинта и верхняя октава.
const CHORDS = { Dm: [50, 3], F: [53, 4], C: [48, 4], Bb: [46, 4], Am: [45, 3], Gm: [43, 3] };
const chordStrings = name => {
  const [root, third] = CHORDS[name];
  return [root, root + 7, root + 12, root + 12 + third, root + 19, root + 24];
};

// Переборы гуслей на половину такта: доля, номер струны, сила.
const HARP = {
  flow: [[0, 0, 1], [.5, 2, .62], [1, 3, .74], [1.5, 4, .62]],
  wave: [[0, 0, 1], [.5, 3, .62], [1, 5, .72], [1.5, 4, .58]],
  lilt: [[0, 0, 1], [.75, 3, .55], [1, 4, .66], [1.75, 2, .48]],
  sparse: [[0, 0, .9], [1, 3, .55]],
  storm: [[0, 0, 1], [.25, 1, .5], [.5, 0, .8], [.75, 2, .5], [1, 0, .9], [1.25, 1, .5], [1.5, 0, .8], [1.75, 3, .55]],
};

// Круг за кругом напев меняет голос, лад стоит на другой ступени, между кругами ухо отдыхает
// на одних гуслях. Четыре круга идут около десяти минут и не повторяются.
const ROUNDS = [
  { key: 0, bpm: 76, parts: [
    { chords: OPENING, harp: 'roll', drone: .6 },
    { chords: VERSE_CHORDS, flute: VERSE, harp: 'flow' },
    { chords: VERSE_CHORDS, flute: VERSE_FINE, harp: 'wave', run: true },
    { chords: CHORUS_CHORDS, flute: CHORUS, harp: 'flow', drone: .75 },
    { chords: VERSE_CHORDS, flute: VERSE, under: VERSE_LOW, harp: 'wave', run: true },
    { chords: INTERLUDE, harp: 'lilt', drone: .55 },
  ] },
  { key: -5, bpm: 72, parts: [
    { chords: OPENING, harp: 'roll', drone: .6 },
    { chords: VERSE_CHORDS, strings: VERSE, flute: VERSE_HIGH, harp: 'sparse' },
    { chords: CHORUS_CHORDS, flute: CHORUS_FINE, under: CHORUS_LOW, harp: 'wave', drone: .75 },
    { chords: VERSE_CHORDS, flute: VERSE_FINE, harp: 'flow', run: true },
    { chords: INTERLUDE, harp: 'sparse', drone: .5 },
  ] },
  { key: 2, bpm: 78, parts: [
    { chords: VERSE_CHORDS, reed: VERSE, harp: 'lilt', drone: .8 },
    { chords: VERSE_CHORDS, flute: VERSE, under: VERSE_LOW, harp: 'flow' },
    { chords: CHORUS_CHORDS, strings: CHORUS, harp: 'sparse', drone: .75 },
    { chords: CHORUS_CHORDS, flute: CHORUS, under: CHORUS_LOW, harp: 'wave', drone: .75, run: true },
    { chords: INTERLUDE, harp: 'lilt', drone: .55 },
  ] },
  { key: -2, bpm: 74, parts: [
    { chords: OPENING, harp: 'roll', drone: .6 },
    { chords: CHORUS_CHORDS, flute: CHORUS_FINE, harp: 'flow', drone: .75 },
    { chords: VERSE_CHORDS, reed: VERSE, flute: VERSE_HIGH, harp: 'sparse' },
    { chords: VERSE_CHORDS, flute: VERSE_FINE, under: VERSE_LOW, harp: 'wave', run: true },
    { chords: INTERLUDE, harp: 'sparse', drone: .5 },
  ] },
];

// --- инструменты ---

const hz = pitch => 440 * 2 ** ((pitch - 69) / 12);
const MINOR = [0, 2, 3, 5, 7, 8, 10];

// Мягкое ограничение на выходе: пик никогда не доходит до единицы.
function softCurve() {
  const curve = new Float32Array(4097);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = (Math.tanh(x * 1.2) / Math.tanh(1.2)) * 0.98;
  }
  return curve;
}

// Зал: шумовой отклик, который спадает и темнеет к концу.
function hallResponse(ctx, seconds = 3.2) {
  const length = Math.floor(ctx.sampleRate * seconds), start = Math.floor(ctx.sampleRate * 0.022);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel), rnd = seeded(71 + channel);
    let dark = 0;
    for (let i = start; i < length; i++) {
      const t = i / ctx.sampleRate;
      dark += ((rnd() * 2 - 1) - dark) * (0.08 + 0.5 * Math.exp(-t * 1.4));
      data[i] = dark * (1 - Math.exp(-t * 90)) * Math.exp((-6.9 * t) / seconds);
    }
  }
  return buffer;
}

function noiseBuffer(ctx, seconds, dark = false) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0), rnd = seeded(dark ? 23 : 41);
  let low = 0;
  for (let i = 0; i < length; i++) {
    const white = rnd() * 2 - 1;
    low = (low + white * 0.02) / 1.02;
    data[i] = dark ? low * 3.5 : white;
  }
  return buffer;
}

// Струна по Карплусу и Стронгу: шумовой щипок бежит по линии задержки и затухает.
// ring: сколько звенит, edge: чем больше, тем ближе к краю щипок и звонче тон, keep: чем больше, тем ярче хвост.
const GUSLI = { ring: 2.8, edge: 7, keep: 0.62, seed: 5 };
const BALALAIKA = { ring: 1.6, edge: 4, keep: 0.7, seed: 9 };
function stringBuffer(ctx, pitch, { ring, edge, keep, seed } = GUSLI) {
  const rate = ctx.sampleRate, size = Math.round(rate / hz(pitch));
  const length = Math.floor(rate * ring);
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0), wire = new Float32Array(size), rnd = seeded(pitch * 13 + seed);
  const pick = Math.max(1, Math.round(size / edge));
  let mean = 0;
  for (let i = 0; i < size; i++) { wire[i] = rnd() * 2 - 1; mean += wire[i]; }
  for (let i = 0; i < size; i++) wire[i] -= mean / size;
  // Щипок у края струны гасит часть обертонов и даёт звонкий, а не шипящий тон.
  const plucked = wire.map((v, i) => v - 0.8 * wire[(i + size - pick) % size]);
  const fade = 10 ** (-3 / ((rate / size) * ring));
  let at = 0, peak = 0;
  for (let i = 0; i < length; i++) {
    const v = plucked[at], next = (at + 1) % size;
    data[i] = v;
    peak = Math.max(peak, Math.abs(v));
    plucked[at] = fade * (v * keep + plucked[next] * (1 - keep));
    at = next;
  }
  const tail = Math.floor(rate * 0.25);
  for (let i = 0; i < length; i++) {
    data[i] /= peak;
    if (i > length - tail) data[i] *= (length - i) / tail;
  }
  return { buffer, rate: hz(pitch) / (rate / size) };
}

// Духовой голос живёт весь вечер: высоту и громкость ведут только огибающие.
class Wind {
  constructor(ctx, out, noise, { partials, level, air, bright }) {
    this.level = level;
    this.air = air;
    this.sounding = false;
    const wave = ctx.createPeriodicWave(new Float32Array(partials.length + 1), Float32Array.from([0, ...partials]));
    this.pipes = [0, 5].map(cents => {
      const pipe = ctx.createOscillator();
      pipe.setPeriodicWave(wave);
      pipe.detune.value = cents;
      return pipe;
    });
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = bright;
    const twin = ctx.createGain();
    twin.gain.value = 0.32;
    this.env = ctx.createGain();
    this.env.gain.value = 0;
    this.pipes[0].connect(tone);
    this.pipes[1].connect(twin).connect(tone);
    tone.connect(this.env).connect(out);

    // Дрожание вступает позже самой ноты, как у живого дыхания.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.3;
    this.depth = ctx.createGain();
    this.depth.gain.value = 0;
    lfo.connect(this.depth);
    for (const pipe of this.pipes) this.depth.connect(pipe.detune);

    const hiss = ctx.createBufferSource();
    hiss.buffer = noise;
    hiss.loop = true;
    this.band = ctx.createBiquadFilter();
    this.band.type = 'bandpass';
    this.band.Q.value = 1.4;
    this.breath = ctx.createGain();
    this.breath.gain.value = air;
    hiss.connect(this.band).connect(this.breath).connect(this.env);

    const start = ctx.currentTime;
    for (const node of [...this.pipes, lfo, hiss]) node.start(start);
  }

  play(t, note, beat, shift = 0, velocity = 1) {
    const pitch = note.pitch + shift, f = hz(pitch), len = note.len * beat;
    const peak = this.level * velocity * (1 + (pitch - 72) / 70);
    const gain = this.env.gain;
    for (const pipe of this.pipes) {
      if (this.sounding) pipe.frequency.setTargetAtTime(f, t, note.len < 0.2 ? 0.006 : 0.017);
      else pipe.frequency.setValueAtTime(f, t);
    }
    this.band.frequency.setValueAtTime(f * 2.3, t);
    this.depth.gain.setTargetAtTime(0, t, 0.03);
    if (this.sounding) {
      gain.setTargetAtTime(peak * 0.78, t - 0.012, 0.012);
      gain.setTargetAtTime(peak, t + 0.02, 0.05);
    } else {
      gain.setTargetAtTime(peak, t, 0.05);
      this.breath.gain.setValueAtTime(this.air * 2.8, t);
      this.breath.gain.setTargetAtTime(this.air, t + 0.03, 0.07);
    }
    if (len > 0.55) {
      this.depth.gain.setTargetAtTime(13, t + 0.3, 0.24);
      gain.setTargetAtTime(peak * 1.14, t + 0.2, len * 0.5);
    }
    this.sounding = note.tied;
    if (!note.tied) gain.setTargetAtTime(0, t + len - 0.04, 0.08);
  }

  // Напев ушёл к другому голосу посреди связной ноты: эту ноту надо отпустить, иначе она тянется одна.
  release(t) {
    if (!this.sounding) return;
    this.sounding = false;
    this.env.gain.setTargetAtTime(0, t, 0.3);
  }
}

const FLUTE = { partials: [1, 0.34, 0.12, 0.05, 0.02], level: 0.085, air: 0.035, bright: 4200 };
const UNDER = { partials: [1, 0.22, 0.06, 0.02], level: 0.05, air: 0.022, bright: 2600 };
const REED = { partials: [1, 0.06, 0.62, 0.05, 0.38, 0.04, 0.22, 0.03, 0.12], level: 0.075, air: 0.012, bright: 1900 };
const MUSIC_LEVEL = 0.28, DUCKED = 0.12;

// Настроение музыки: напев тот же, а темп, окраска, зал и тёмный гул следуют за игрой.
// dread: низкий гул с малой секундой и колокол, bell: колокол раз в столько тактов (0: нет), wind: ветер.
// lead: reed отдаёт напев свирели тёмному рожку октавой ниже. harp: перебор гуслей вместо записанного.
// bala: балалайка трелью, её слышно только на войне и в грозу. melody ведёт напев, ostinato дробит низкую малую секунду.
// drone: бурдон под напевом, он идёт за аккордами гуслей и дышит. В солнце, тумане, на войне и в бою его нет.
const MOODS = {
  calm:   { pace: 1, bright: 12000, wet: 0.5, level: 1, dread: 0, lead: 'flute', drone: 0 },
  war:    { pace: 1.1, bright: 12000, wet: 0.42, level: 1.08, dread: 0, lead: 'flute', bala: 'melody', balaLevel: 0.8, drone: 0 },
  battle: { pace: 1.22, bright: 12000, wet: 0.36, level: 1.18, dread: 0, lead: 'flute', drone: 0 },
  fog:    { pace: 0.85, bright: 2800, wet: 0.8, level: 1.45, dread: 0, lead: 'flute', drone: 0 },
  rain:   { pace: 0.92, bright: 3000, wet: 0.62, level: 0.95, dread: 0, lead: 'flute', drone: 1 },
  storm:  { pace: 1.12, bright: 2200, wet: 0.6, level: 1.05, dread: 0.7, lead: 'reed', harp: 'storm', bell: 0, wind: 1, bala: 'ostinato', balaLevel: 0.55, drone: 1 },
  blight: { pace: 0.8, bright: 1400, wet: 0.78, level: 0.9, dread: 0.6, lead: 'reed', drone: 1 },
};
const moodOf = name => {
  const [base, war] = name.split('+'), mood = MOODS[base] || MOODS.calm;
  // На войне погода и хворь слышны по-прежнему: война добавляет к ним темп, громкость и балалайку.
  const w = MOODS.war;
  return war ? { ...mood, pace: mood.pace * w.pace, level: mood.level * w.level, bala: mood.bala || w.bala, balaLevel: mood.balaLevel || w.balaLevel } : mood;
};
const MOOD_GLIDE = 1.6;          // секунд на смену окраски
const STORM_GLIDE = 4.5;         // гроза приходит и уходит медленнее: ветер, гул и окраска тают несколько секунд
const DREAD_LEVEL = 0.6;         // тёмный гул слышен, но не громче самой музыки

// Весь оркестр на одном контексте: until дописывает партитуру вперёд, остальное звучит по вызову.
export function createOrchestra(ctx, destination = ctx.destination) {
  const rnd = seeded(1147);
  const gainNode = (value, ...next) => {
    const node = ctx.createGain();
    node.gain.value = value;
    for (const to of next) node.connect(to);
    return node;
  };

  const clip = ctx.createWaveShaper();
  clip.curve = softCurve();
  const output = gainNode(1, destination);
  clip.connect(output);
  const press = ctx.createDynamicsCompressor();
  press.threshold.value = -15;
  press.knee.value = 12;
  press.ratio.value = 4;
  press.attack.value = 0.008;
  press.release.value = 0.25;
  press.connect(clip);

  const hall = ctx.createConvolver();
  hall.buffer = hallResponse(ctx);
  const wet = gainNode(0.5, hall);
  hall.connect(press);

  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = MOODS.calm.bright;
  tone.connect(press);
  const music = gainNode(MUSIC_LEVEL, tone), effects = gainNode(0.7, press);
  const send = amount => gainNode(amount, wet);
  const hallMusic = gainNode(1, wet);                 // посылы музыки в зал идут за громкостью
  const musicSend = amount => gainNode(amount, hallMusic);

  const air = noiseBuffer(ctx, 2);
  const flutes = gainNode(1, music, musicSend(0.75));
  const flute = new Wind(ctx, flutes, air, FLUTE);
  const under = new Wind(ctx, gainNode(0.9, flutes), air, UNDER);
  const reed = new Wind(ctx, gainNode(0.95, music, musicSend(0.5)), air, REED);

  // Гусли: поднятая середина даёт дерево корпуса, низ не мешает бурдону.
  const harpFloor = ctx.createBiquadFilter();
  harpFloor.type = 'highpass';
  harpFloor.frequency.value = 85;
  const harpBody = ctx.createBiquadFilter();
  harpBody.type = 'peaking';
  harpBody.frequency.value = 520;
  harpBody.Q.value = 0.8;
  harpBody.gain.value = 3;
  harpFloor.connect(harpBody);
  harpBody.connect(gainNode(0.82, music, musicSend(0.42)));

  const strings = new Map();
  function pluck(t, pitch, velocity) {
    if (!strings.has(pitch)) strings.set(pitch, stringBuffer(ctx, pitch));
    const { buffer, rate } = strings.get(pitch);
    const voice = ctx.createBufferSource();
    voice.buffer = buffer;
    voice.playbackRate.value = rate;
    voice.detune.value = (rnd() - 0.5) * 5;
    const side = ctx.createStereoPanner();
    side.pan.value = Math.max(-0.6, Math.min(0.6, (pitch - 62) / 30));
    voice.connect(gainNode(velocity * 0.42, side));
    side.connect(harpFloor);
    voice.start(t);
  }

  // Балалайка: две струны в унисон чуть врозь, корпус поднимает середину, верх приглушён.
  const balaBody = ctx.createBiquadFilter();
  balaBody.type = 'peaking';
  balaBody.frequency.value = 1300;
  balaBody.Q.value = 1;
  balaBody.gain.value = 4;
  const balaTop = ctx.createBiquadFilter();
  balaTop.type = 'lowpass';
  balaTop.frequency.value = 5200;
  const balaOut = gainNode(0, music, musicSend(0.35));
  balaBody.connect(balaTop).connect(balaOut);
  const balaStrings = new Map();
  function balaPluck(t, pitch, velocity) {
    if (!balaStrings.has(pitch)) balaStrings.set(pitch, stringBuffer(ctx, pitch, BALALAIKA));
    const { buffer, rate } = balaStrings.get(pitch);
    for (const cents of [-4, 4]) {
      const voice = ctx.createBufferSource();
      voice.buffer = buffer;
      voice.playbackRate.value = rate;
      voice.detune.value = cents + (rnd() - 0.5) * 3;
      voice.connect(gainNode(velocity * 0.3, balaBody));
      voice.start(t);
    }
  }

  // Трель: частые удары вниз и вверх, вверх тише, к концу ноты чуть гаснет.
  function trill(t, len, pitches, level) {
    for (let at = 0, k = 0; at < len - 0.04; at += 0.105, k++) {
      const shape = 1 - 0.25 * (at / len);
      for (const pitch of pitches) balaPluck(t + at + (rnd() - 0.5) * 0.008, pitch, level * shape * (k % 2 ? 0.7 : 1));
    }
  }

  // На войне балалайка трелью ведёт напев, короткие ноты берёт одним щипком.
  // В грозу она без передышки дробит малую секунду в низах.
  function balalaika(t, sheet, bar, beat, key) {
    if (mood.bala === 'ostinato') {
      trill(t, 2 * beat, [50 + key, 51 + key], mood.balaLevel);
      trill(t + 2 * beat, 2 * beat, [50 + key, 51 + key], mood.balaLevel * 0.85);
      return;
    }
    const melody = sheet.flute || sheet.strings || sheet.reed;
    for (const n of melody ? barNotes(melody, bar) : []) {
      const at = t + (n.at - bar * 4) * beat;
      if (n.len < 0.5) balaPluck(at, n.pitch + key, mood.balaLevel * 0.8);
      else trill(at, n.len * beat, [n.pitch + key], mood.balaLevel);
    }
  }

  // Ветер: шум в узкой полосе, полоса медленно гуляет вверх и вниз, порывы то сильнее, то тише.
  const gale = ctx.createBufferSource();
  gale.buffer = air;
  gale.loop = true;
  const galeBand = ctx.createBiquadFilter();
  galeBand.type = 'bandpass';
  galeBand.frequency.value = 700;
  galeBand.Q.value = 0.9;
  const gusts = gainNode(0.5);
  const windLevel = gainNode(0, music, musicSend(0.4));
  gale.connect(galeBand).connect(gusts).connect(windLevel);
  const howl = ctx.createOscillator();
  howl.frequency.value = 0.07;
  howl.connect(gainNode(520, galeBand.frequency));
  const puff = ctx.createOscillator();
  puff.frequency.value = 0.23;
  puff.connect(gainNode(0.4, gusts.gain));
  for (const node of [gale, howl, puff]) node.start(ctx.currentTime);

  // Тёмный гул грозы и хвори: низкий тон, малая секунда и тритон над ним медленно качаются.
  const dreadRoom = ctx.createBiquadFilter();
  dreadRoom.type = 'lowpass';
  dreadRoom.frequency.value = 420;
  dreadRoom.Q.value = 0.9;
  const dreadLevel = gainNode(0, dreadRoom);
  dreadRoom.connect(gainNode(1, music, musicSend(0.5)));
  const swell = ctx.createOscillator();
  swell.frequency.value = 0.18;
  swell.connect(gainNode(160, dreadRoom.frequency));
  const dreadPipes = [[1, -3, 'sawtooth', 0.05], [2 ** (1 / 12), 4, 'sawtooth', 0.032], [2 ** (6 / 12), 0, 'triangle', 0.035], [0.5, 0, 'sine', 0.09]].map(([ratio, cents, type, level]) => {
    const pipe = ctx.createOscillator();
    pipe.type = type;
    pipe.detune.value = cents;
    pipe.connect(gainNode(level, dreadLevel));
    pipe.start(ctx.currentTime);
    return { pipe, ratio };
  });
  swell.start(ctx.currentTime);
  const setDread = (t, key) => {
    for (const { pipe, ratio } of dreadPipes) pipe.frequency.setValueAtTime(hz(38 + key) * ratio, t);
  };

  // Колокол: низкий удар с неслаженными обертонами, долго гудит. Бьёт на сильную долю в тёмном настроении.
  function bell(t, key, level) {
    const f = hz(50 + key);
    for (const [ratio, mix, ring] of [[0.5, 0.5, 5], [1, 0.4, 4], [1.19, 0.22, 3], [2, 0.18, 2.6], [2.76, 0.12, 1.8], [5.4, 0.05, 0.9]]) {
      const tone = ctx.createOscillator();
      tone.frequency.value = f * ratio;
      const body = gainNode(0, music, musicSend(0.7));
      body.gain.setValueAtTime(0.16 * mix * level, t);
      body.gain.exponentialRampToValueAtTime(0.0003, t + ring);
      tone.connect(body);
      tone.start(t);
      tone.stop(t + ring + 0.05);
    }
  }

  // Бурдон: квинта на мягких волнах, высота идёт за басом аккорда, на каждом аккорде он набирает силу и отступает.
  const droneRoom = ctx.createBiquadFilter();
  droneRoom.type = 'lowpass';
  droneRoom.frequency.value = 340;
  droneRoom.Q.value = 0.6;
  const droneLevel = gainNode(0, droneRoom), droneBreath = gainNode(0.5, droneLevel);
  droneRoom.connect(gainNode(1, music, musicSend(0.22)));
  const breathing = ctx.createOscillator();
  breathing.frequency.value = 0.07;
  breathing.connect(gainNode(110, droneRoom.frequency));
  const dronePipes = [[1, -4, 'triangle', 0.075], [1, 4, 'triangle', 0.075], [1.5, 2, 'sine', 0.04], [0.5, 0, 'sine', 0.07]].map(([ratio, cents, type, level]) => {
    const pipe = ctx.createOscillator();
    pipe.type = type;
    pipe.detune.value = cents;
    pipe.connect(gainNode(level, droneBreath));
    pipe.start(ctx.currentTime);
    return { pipe, ratio };
  });
  breathing.start(ctx.currentTime);

  // Громкость бурдона: сколько задала часть круга, умноженное на настроение.
  let droneBase = 0;
  const setDrone = (t, level) => {
    droneBase = level;
    droneLevel.gain.setTargetAtTime(level * mood.drone, t, 1.6);
  };
  // Аккорд на полтакта: бас скользит к своей ноте, бурдон вдыхает и к концу аккорда отступает.
  function droneChord(t, name, key, beat) {
    const root = hz(CHORDS[name][0] + key + (CHORDS[name][0] < 46 ? 12 : 0));
    for (const { pipe, ratio } of dronePipes) pipe.frequency.setTargetAtTime(root * ratio, t, 0.09);
    droneBreath.gain.setTargetAtTime(1, t, 0.25);
    droneBreath.gain.setTargetAtTime(0.35, t + beat, 0.45);
  }

  // Быстрый проход по струнам на каденции: так гусли завершают фразу.
  function sweep(t, key) {
    const scale = [];
    for (let octave = 0; octave < 2; octave++) for (const step of MINOR) scale.push(62 + key + octave * 12 + step);
    scale.push(86 + key);
    scale.forEach((pitch, i) => pluck(t + i * 0.052, pitch, 0.22 + 0.32 * Math.sin((i / scale.length) * Math.PI)));
  }

  function harp(t, name, pattern, beat, key) {
    const tones = chordStrings(name).map(pitch => pitch + key);
    if (pattern === 'roll') {
      tones.forEach((pitch, i) => pluck(t + i * 0.045, pitch, 0.5 + i * 0.05));
      return;
    }
    for (const [at, index, velocity] of HARP[pattern]) {
      pluck(t + at * beat + (rnd() - 0.5) * 0.014, tones[index], velocity * (0.9 + rnd() * 0.16));
    }
  }

  const barNotes = (list, bar) => list.filter(n => n.at >= bar * 4 && n.at < (bar + 1) * 4);

  function playBar(t, sheet, bar, beat, key) {
    // Без бурдона раскаты вступления звучат с долгими паузами: гусли тогда играют ровным перебором.
    const pattern = mood.harp || (sheet.harp === 'roll' && !mood.drone ? 'flow' : sheet.harp), [first, then] = sheet.chords[bar];
    harp(t, first, pattern, beat, key);
    if (pattern === 'roll') {
      chordStrings(first).slice(2).forEach((pitch, i) => pluck(t + 2 * beat + i * 0.06, pitch + key, 0.3 + i * 0.03));
    } else harp(t + 2 * beat, then, pattern, beat, key);
    const voice = (wind, list, shift, velocity) => {
      if (!list) return;
      for (const n of barNotes(list, bar)) wind.play(t + (n.at - bar * 4) * beat, n, beat, key + shift, velocity * (0.94 + rnd() * 0.1));
    };
    // В тёмном настроении напев свирели ведёт рожок октавой ниже, если сам он в этой части молчит.
    const dark = mood.lead === 'reed' && !sheet.reed, lead = dark ? reed : flute;
    if (sheet.flute && lead !== leadWind) {
      leadWind.release(t);
      leadWind = lead;
    }
    voice(lead, sheet.flute, dark ? -12 : 0, 1);
    voice(under, sheet.under, 0, 1);
    voice(reed, sheet.reed, -12, 1);
    if (mood.bala) balalaika(t, sheet, bar, beat, key);
    if (mood.drone) {
      droneChord(t, first, key, beat);
      droneChord(t + 2 * beat, then, key, beat);
    }
    if (sheet.strings) {
      for (const n of barNotes(sheet.strings, bar)) {
        const at = t + (n.at - bar * 4) * beat;
        pluck(at, n.pitch + key, 0.8);
        pluck(at + 0.012, n.pitch + key - 12, 0.5);
      }
    }
    if (sheet.run && bar === sheet.chords.length - 1) sweep(t + 2.6 * beat, key);
  }

  let round = 0, part = 0, bar = 0, mood = MOODS.calm, volume = 1, ducked = false;
  let leadWind = flute;           // кто сейчас ведёт напев свирели: она сама или рожок в тёмном настроении
  let pace = 1;                   // темп идёт к темпу настроения за пару тактов
  let next = ctx.currentTime + 0.08;
  let tonic = 50;
  const current = () => ROUNDS[round % ROUNDS.length];

  // Партитура вперёд до времени end. Такты, которые проспала скрытая вкладка, пропускаются.
  function until(end) {
    while (next < end) {
      pace += (mood.pace - pace) * 0.45;
      const { key, bpm, parts } = current(), beat = 60 / (bpm * pace), sheet = parts[part];
      if (bar === 0) {
        setDrone(next, sheet.drone ?? 1);
        setDread(next, key);
        tonic = 50 + key;
      }
      if (next + 4 * beat > ctx.currentTime) {
        playBar(next, sheet, bar, beat, key);
        const toll = mood.bell ?? 2;
        if (mood.dread && toll && bar % toll === 0) bell(next, key, mood.dread);
      }
      // Бурдон стихает перед новым кругом: новая ступень вступает из тишины, без скольжения.
      if (part === parts.length - 1 && bar === sheet.chords.length - 1) {
        droneBase = 0;
        droneLevel.gain.setTargetAtTime(0, next + 2 * beat, 0.35);
      }
      next += 4 * beat;
      if (++bar >= sheet.chords.length) {
        bar = 0;
        if (++part >= parts.length) { part = 0; round++; }
      }
    }
  }

  // Рог: квинта снизу вверх в ладу музыки, далёкая и с длинным хвостом.
  function hornCall(t, pitch, len, level) {
    const f = hz(pitch);
    const mouth = ctx.createBiquadFilter();
    mouth.type = 'lowpass';
    mouth.Q.value = 1.1;
    mouth.frequency.setValueAtTime(240, t);
    mouth.frequency.exponentialRampToValueAtTime(1500, t + 0.2);
    mouth.frequency.exponentialRampToValueAtTime(620, t + len);
    const body = gainNode(0, effects, send(0.9));
    body.gain.setValueAtTime(0, t);
    body.gain.linearRampToValueAtTime(level, t + 0.14);
    body.gain.setTargetAtTime(level * 0.72, t + 0.2, len * 0.4);
    body.gain.setTargetAtTime(0, t + len - 0.2, 0.12);
    mouth.connect(body);
    for (const [ratio, cents, type, mix] of [[1, -5, 'sawtooth', 0.5], [1, 6, 'sawtooth', 0.5], [0.5, 0, 'triangle', 0.7]]) {
      const pipe = ctx.createOscillator();
      pipe.type = type;
      pipe.detune.value = cents;
      pipe.frequency.setValueAtTime(f * ratio * 0.93, t);
      pipe.frequency.exponentialRampToValueAtTime(f * ratio, t + 0.1);
      pipe.connect(gainNode(mix, mouth));
      pipe.start(t);
      pipe.stop(t + len + 0.6);
    }
  }

  function horn(t = ctx.currentTime) {
    hornCall(t, tonic, 0.62, 0.16);
    hornCall(t + 0.5, tonic + 7, 1.9, 0.18);
  }

  // Удар мечей: несколько неслаженных обертонов стали и короткий шумовой щелчок.
  function clash(t = ctx.currentTime, force = 1) {
    const base = 1500 + rnd() * 1000;
    const side = ctx.createStereoPanner();
    side.pan.value = (rnd() - 0.5) * 0.9;
    side.connect(effects);
    side.connect(send(0.5));
    for (const [ratio, level, ring] of [[1, 0.13, 0.17], [1.48, 0.1, 0.13], [2.13, 0.085, 0.09], [2.79, 0.06, 0.07], [3.77, 0.04, 0.05]]) {
      const tone = ctx.createOscillator();
      tone.frequency.value = base * ratio * (0.99 + rnd() * 0.02);
      const body = gainNode(0, side);
      body.gain.setValueAtTime(level * force, t);
      body.gain.exponentialRampToValueAtTime(0.0004, t + ring);
      tone.connect(body);
      tone.start(t);
      tone.stop(t + ring + 0.02);
    }
    const hit = ctx.createBufferSource();
    hit.buffer = air;
    const edge = ctx.createBiquadFilter();
    edge.type = 'highpass';
    edge.frequency.value = 2400;
    const snap = gainNode(0, side);
    snap.gain.setValueAtTime(0.16 * force, t);
    snap.gain.exponentialRampToValueAtTime(0.0004, t + 0.04);
    hit.connect(edge).connect(snap);
    hit.start(t, rnd() * 1.5, 0.05);
  }

  // Огонь: рокочущий шум с плавающим фильтром, вспышка в начале и треск.
  const rumble = noiseBuffer(ctx, 2.5, true);
  function fire(t = ctx.currentTime, len = 3) {
    const roar = ctx.createBufferSource();
    roar.buffer = rumble;
    roar.loop = true;
    const lid = ctx.createBiquadFilter();
    lid.type = 'lowpass';
    lid.Q.value = 0.9;
    lid.frequency.setValueAtTime(240, t);
    lid.frequency.exponentialRampToValueAtTime(1700, t + 0.45);
    for (let at = 0.6; at < len; at += 0.17) lid.frequency.linearRampToValueAtTime(520 + rnd() * 900, t + at);
    const body = gainNode(0, effects, send(0.3));
    body.gain.setValueAtTime(0, t);
    body.gain.linearRampToValueAtTime(0.42, t + 0.32);
    body.gain.setTargetAtTime(0.28, t + 0.5, 0.5);
    body.gain.setTargetAtTime(0, t + len - 0.7, 0.28);
    roar.connect(lid).connect(body);
    roar.start(t);
    roar.stop(t + len + 0.6);
    for (let i = 0; i < 34; i++) {
      const at = t + 0.3 + rnd() * (len - 0.6);
      const spark = ctx.createBufferSource();
      spark.buffer = air;
      const pitch = ctx.createBiquadFilter();
      pitch.type = 'bandpass';
      pitch.frequency.value = 1500 + rnd() * 3800;
      pitch.Q.value = 2.4;
      const snap = gainNode(0, effects);
      snap.gain.setValueAtTime(0.1 + rnd() * 0.18, at);
      snap.gain.exponentialRampToValueAtTime(0.0004, at + 0.012 + rnd() * 0.03);
      spark.connect(pitch).connect(snap);
      spark.start(at, rnd() * 1.5, 0.06);
    }
  }

  // Гром: удар низкого шума и затихающие раскаты. Громкость идёт за настройкой музыки.
  function thunder(t = ctx.currentTime, force = 1) {
    const len = 2.4 + force * 2.2, peak = 0.62 * force * volume;
    const roll = ctx.createBufferSource();
    roll.buffer = rumble;
    roll.loop = true;
    const lid = ctx.createBiquadFilter();
    lid.type = 'lowpass';
    lid.frequency.setValueAtTime(260 + force * 520, t);
    lid.frequency.exponentialRampToValueAtTime(80, t + len);
    const body = gainNode(0, effects, send(0.4));
    body.gain.setValueAtTime(0, t);
    body.gain.linearRampToValueAtTime(peak, t + 0.05 + (1 - force) * 0.3);
    for (let at = 0.4; at < len - 0.8; at += 0.3 + rnd() * 0.5) {
      body.gain.linearRampToValueAtTime(peak * (0.25 + rnd() * 0.5) * (1 - at / len), t + at);
    }
    body.gain.setTargetAtTime(0, t + len - 0.8, 0.3);
    roll.connect(lid).connect(body);
    roll.start(t, rnd() * 2);
    roll.stop(t + len + 0.6);
  }

  // На время речи музыка отступает, а голос остаётся поверх.
  const level = (glide = 0.18) => {
    const target = (ducked ? DUCKED : MUSIC_LEVEL) * mood.level * volume;
    music.gain.setTargetAtTime(target, ctx.currentTime, glide);
    hallMusic.gain.setTargetAtTime(target / MUSIC_LEVEL, ctx.currentTime, glide);
  };
  const duck = down => {
    ducked = down;
    level();
  };
  const setVolume = value => {
    volume = value;
    level(0.05);
  };
  const setMood = name => {
    const was = mood;
    mood = moodOf(name);
    const glide = was.wind || mood.wind ? STORM_GLIDE : MOOD_GLIDE, now = ctx.currentTime;
    tone.frequency.setTargetAtTime(mood.bright, now, glide / 3);
    wet.gain.setTargetAtTime(mood.wet, now, glide / 3);
    dreadLevel.gain.setTargetAtTime(mood.dread * DREAD_LEVEL, now, glide / 2);
    windLevel.gain.setTargetAtTime((mood.wind || 0) * 0.5, now, glide / 2);
    droneLevel.gain.setTargetAtTime(droneBase * mood.drone, now, glide / 2);
    balaOut.gain.setTargetAtTime(mood.bala ? 0.7 : 0, now, glide / 3);
    level(glide / 3);
  };

  return { output, until, horn, clash, fire, thunder, duck, setVolume, setMood };
}

// --- выключатели и живой звук ---

const read = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value === '1';
  } catch { return fallback; }
};
const store = (key, on) => {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* приватное окно: настройка живёт до перезагрузки */ }
};

const readNumber = (key, fallback) => {
  try {
    const value = Number(localStorage.getItem(key));
    return localStorage.getItem(key) != null && Number.isFinite(value) ? value : fallback;
  } catch { return fallback; }
};

let musicOn = read('tz-music', true);
let voiceOn = read('tz-voice', true);
let musicVolume = readNumber('tz-music-volume', 1);
let currentMood = 'calm';
let ctx = null, band = null, voiceOut = null, sleeping = 0;

export const isMusicOn = () => musicOn;
export const isVoiceOn = () => voiceOn;
export const getVolume = () => musicVolume;

// Браузер даёт звук только после жеста: вызывается на нажатие «Начать» или первый щелчок.
// Контекст нужен и диктору, поэтому при выключенной музыке оркестр просто молчит.
export function unlock() {
  if (!musicOn && !voiceOn) return;
  if (!ctx) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    ctx = new Context();
    band = createOrchestra(ctx);
    band.setVolume(musicVolume);
    band.setMood(currentMood);
    voiceOut = ctx.createGain();
    voiceOut.connect(ctx.destination);
    if (!musicOn) band.output.gain.value = 0;
    setInterval(() => { if (musicOn && ctx.state === 'running') band.until(ctx.currentTime + 3); }, 500);
    if (musicOn) band.until(ctx.currentTime + 3);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

// Контекст спит, только когда молчат и музыка, и диктор.
function rest() {
  clearTimeout(sleeping);
  if (ctx && !musicOn && !voiceOn) sleeping = setTimeout(() => ctx.suspend(), 450);
}

export function setMusic(on) {
  musicOn = on;
  store('tz-music', on);
  clearTimeout(sleeping);
  if (on) {
    unlock();
    band?.output.gain.setTargetAtTime(1, ctx.currentTime, 0.12);
  } else if (band) {
    band.output.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    rest();
  }
}

// Громкость музыки из настроек: от тишины до полуторной.
export function setVolume(value) {
  musicVolume = value;
  try { localStorage.setItem('tz-music-volume', String(value)); } catch { /* настройка живёт до перезагрузки */ }
  band?.setVolume(value);
}

export function setMood(name) {
  if (name === currentMood) return;
  currentMood = name;
  band?.setMood(name);
}

// Пока идёт видео с правилами, у него своя музыка: оркестр молчит, настройки не меняются.
export function quiet(on) {
  if (musicOn) band?.output.gain.setTargetAtTime(on ? 0 : 1, ctx.currentTime, 0.1);
}

const playing = () => musicOn && ctx?.state === 'running';
export const horn = () => { if (playing()) band.horn(); };
export const clash = force => { if (playing()) band.clash(ctx.currentTime, force); };
export const fire = len => { if (playing()) band.fire(ctx.currentTime, len); };

// Гром идёт вскоре за вспышкой: чем дальше гроза, тем позже и тише раскат.
export function thunder() {
  if (!playing()) return;
  const far = Math.random();
  band.thunder(ctx.currentTime + 0.4 + far * 2.2, 1 - far * 0.65);
}

// --- диктор ---

const talks = new Set();      // живые реплики: Chrome теряет onend, если на них нет ссылки
const VOICE_DIR = '/voice/';
const clips = new Map();      // текст → обещание AudioBuffer: один раз скачали, дальше из кэша
const missing = new Set();    // о какой реплике уже предупредили
let hushes = 0;               // растёт при hush: реплики из очереди после него не звучат
let line = Promise.resolve(); // реплики идут строго друг за другом

// Оглавление записей: текст → файл и длительность. Нет оглавления, значит нет записей.
const voiceIndex = fetch(`${VOICE_DIR}index.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({}));

// Запись оглавления: имя файла строкой, парой или объектом с полем file.
const fileOf = entry => (typeof entry === 'string' ? entry : entry?.file ?? entry?.[0] ?? null);

function clipOf(text) {
  if (!clips.has(text)) {
    clips.set(text, voiceIndex.then(async index => {
      const file = fileOf(index[text]);
      if (!file) { clips.delete(text); return null; }
      const data = await fetch(`${VOICE_DIR}${file}`).then(r => r.arrayBuffer());
      return ctx.decodeAudioData(data);
    }).catch(() => { clips.delete(text); return null; }));
  }
  return clips.get(text);
}

// Легенда подгружается заранее, чтобы фразы шли без пауз. Без контекста подгрузка подождёт первой реплики.
export function preload(texts) {
  if (ctx) for (const text of texts) clipOf(text);
}

// Готовая запись через Web Audio. Сторож держит реплику, если onended не придёт.
function playClip(buffer) {
  return new Promise(resolve => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(voiceOut);
    let timer = 0;
    const talk = {
      done() {
        clearTimeout(timer);
        if (!talks.delete(talk)) return;
        if (!talks.size) band?.duck(false);
        resolve(true);
      },
      stop() {
        source.onended = null;
        try { source.stop(); } catch { /* уже кончилась */ }
        talk.done();
      },
    };
    source.onended = talk.done;
    timer = setTimeout(talk.done, buffer.duration * 1000 + 1500);
    talks.add(talk);
    band?.duck(true);
    source.start();
  });
}

async function speak(text, mine) {
  if (mine !== hushes || !voiceOn) return false;
  const running = ctx?.state === 'running';
  const buffer = running ? await clipOf(text) : null;
  if (mine !== hushes || !voiceOn) return false;
  if (buffer) return playClip(buffer);
  // Контекст ещё не получил жест: это не беда записи, предупреждать не о чем.
  if (running && !missing.has(text)) {
    missing.add(text);
    console.warn(`Нет записи реплики: ${text}`);
  }
  return false;
}

// Истина значит, что голос говорил.
export function say(text) {
  if (!voiceOn || !text) return Promise.resolve(false);
  const mine = hushes;
  const turn = line.then(() => speak(text, mine));
  line = turn.catch(() => false);
  return line;
}

export function hush() {
  hushes++;
  for (const talk of [...talks]) talk.stop();
}

export function setVoice(on) {
  voiceOn = on;
  store('tz-voice', on);
  if (on) unlock();
  else hush();
  rest();
}

