// Единственный источник реплик диктора. Голос записан заранее, поэтому реплика это целая фраза,
// а не склейка из кусков. lineFor даёт текст для события, allLines перечисляет всё, что можно записать.
// Имена царств постоянные, поэтому каждая реплика записана заранее.
// У события несколько формулировок: диктор не повторяется, пока не скажет все, и рассказывает партию как сказку.
import { FACTIONS, factionOf, setDarkSeat, setHordeSeat } from './hex.js';
import { BARE_STRUCK, HEROES, RAID_NAME, WEATHER } from './balance.js';
import { CLOSINGS, LEGENDS, OMENS, OPENINGS } from './legends.js';

export const MAX_TURN = 150;     // дальше номер хода диктор не называет
const MAX_COUNT = 100;           // дальше потери округляются: «больше ста»

// Падежи царств. Все имена среднего рода: «пало», «одолело».
const REALM = {
  red:    { gen: 'Тридесятого царства', dat: 'Тридесятому царству', ins: 'Тридесятым царством', loc: 'Тридесятом царстве' },
  yellow: { gen: 'Солнечного царства', dat: 'Солнечному царству', ins: 'Солнечным царством', loc: 'Солнечном царстве' },
  blue:   { gen: 'Морского царства', dat: 'Морскому царству', ins: 'Морским царством', loc: 'Морском царстве' },
  teal:   { gen: 'Лукоморья', dat: 'Лукоморью', ins: 'Лукоморьем', loc: 'Лукоморье' },
  green:  { gen: 'Лесного царства', dat: 'Лесному царству', ins: 'Лесным царством', loc: 'Лесном царстве' },
  copper: { gen: 'Медного царства', dat: 'Медному царству', ins: 'Медным царством', loc: 'Медном царстве' },
  snow:   { gen: 'Снежного царства', dat: 'Снежному царству', ins: 'Снежным царством', loc: 'Снежном царстве' },
  dark:   { gen: 'Тёмного царства', dat: 'Тёмному царству', ins: 'Тёмным царством', loc: 'Тёмном царстве' },
  // Войско Тугарина: в родительном просто «Тугарина», чтобы шаблоны «войско X», «рать X» не двоились.
  horde:  { gen: 'Тугарина', dat: 'Войску Тугарина', ins: 'Войском Тугарина', loc: 'Войске Тугарина' },
};
// with: творительный с предлогом, «со» перед сочетанием согласных: «со Снежным царством».
const realm = pid => {
  const forms = { nom: factionOf(pid).name, ...REALM[factionOf(pid).id] };
  return { ...forms, with: `${/^[СЗШЖсзшж][^аеёиоуыэюя]/.test(forms.ins) ? 'со' : 'с'} ${forms.ins}` };
};
export const realmForm = (pid, form) => realm(pid)[form];   // те же падежи для подписей на экране

// Нашествие Тугарина: предупреждение за ход, приход орды и разорённые поселения.
export const hordeLine = stage => ({
  warn: 'Пыль клубится на краю земли: идёт Тугарин Змеевич со своей ордой',
  came: 'Пришёл Тугарин Змеевич со своим войском. Кто одолеет самого Тугарина, тот и победит в этом сказе',
})[stage];
export const hordeRaidLine = (pid, capital) => (capital
  ? `Орда Тугарина разоряет столицу ${realm(pid).gen}`
  : `Орда Тугарина разоряет острог ${realm(pid).gen}`);

// Итоговый сказ в конце партии: как кончилась, кто дольше всех правил землёй, кто пал первым, и титулы.
const TITLE_LINES = {
  builder: n => `Строителем сказ называет ${n}: больше всех острогов поставило`,
  warlord: n => `Воеводой сказ называет ${n}: больше всех врагов побило`,
  merchant: n => `Купцом сказ называет ${n}: больше всех сделок заключило`,
  host: n => `Хлебосолом сказ называет ${n}: больше всех грибов собрало`,
  stood: n => `Устоявшим сказ называет ${n}: досталось ему больше всех, а оно выстояло`,
};
export const TITLE_NAMES = { builder: 'Строитель', warlord: 'Воевода', merchant: 'Купец', host: 'Хлебосол', stood: 'Устоявший' };
export const titleLine = (key, pid) => TITLE_LINES[key](realm(pid).nom);
const ENDINGS = {
  horde: n => `Тугарина Змеевича одолело ${n}, на том сказ и кончился`,
  camps: n => `${n} поставило лагеря на всех грибницах, и сказ кончился его победой`,
  last: n => `Одно ${n} устояло из всех царств`,
  end: n => `Победу по земле взяло ${n}`,
};
export const EPILOGUE_OPEN = 'Вот и сказу конец, а кто слушал, тот молодец';
export const EPILOGUE_NONE = 'Не уцелело ни одно царство, и сказ кончился горько';
export const leaderLine = pid => `Дольше всех землёй правило ${realm(pid).nom}`;
export const fallenLine = pid => `Первым пало ${realm(pid).nom}`;
export function epilogueLines({ winner, how, leader, fallen, titles }) {
  const lines = [EPILOGUE_OPEN, winner == null ? EPILOGUE_NONE : ENDINGS[how](realm(winner).nom)];
  if (leader != null) lines.push(leaderLine(leader));
  if (fallen != null) lines.push(fallenLine(fallen));
  for (const [key, pid] of titles) lines.push(titleLine(key, pid));
  return lines;
}

// Начало отсчёта «20 секунд последним»: общий экран берёт фразы по кругу.
export const HURRY_LINES = [
  'Все уже сходили, ждём последних. Двадцать секунд, и ход закончится сам',
  'Князья, поторопитесь: осталось двадцать секунд',
  'Песочные часы перевёрнуты: двадцать секунд на последний ход',
  'Царства ждут отстающих. Через двадцать секунд ход завершится без них',
  'Солнце не ждёт, и царства не ждут. Двадцать секунд на раздумья',
  'Думайте быстрее, князья: через двадцать секунд ход закончится сам',
  'Гонец уже седлает коня: двадцать секунд, и он уедет без вашего слова',
  'Дед считает до двадцати. Кто не успел, тот опоздал',
  'Последние думают за всех. Двадцать секунд, князья, не больше',
  'Время на исходе: двадцать секунд на последний ход',
];

// Спорная грибница и раздор Кощея звучат в начале хода. Имена царств идут в постоянном порядке: меньший номер первым.
export const disputeLine = (a, b) => `Меж ${realm(a).ins} и ${realm(b).ins} на ничьей земле открылась грибница. Её видят все: кто первым поставит лагерь, того и грибы`;
export const discordLine = (a, b, stage) => ({
  warn: `Кощей шепчет у тронов: ${realm(a).nom} и ${realm(b).nom} скоро рассорятся`,
  ally: `Кощей посеял раздор: нет больше союза между ${realm(a).ins} и ${realm(b).ins}`,
  truce: `Кощей посеял раздор: перемирию между ${realm(a).ins} и ${realm(b).ins} конец`,
})[stage];

const BEING = {
  tugarin:  { gen: 'Тугарина Змеевича', acc: 'Тугарина Змеевича', ins: 'Тугарином Змеевичем', with: 'с Тугарином Змеевичем' },
  gorynych: { gen: 'Змея Горыныча', acc: 'Змея Горыныча', ins: 'Змеем Горынычем', with: 'со Змеем Горынычем' },
  vodyanoy: { gen: 'Водяного', acc: 'Водяного', ins: 'Водяным', with: 'с Водяным' },
  leshy:    { gen: 'Лешего', acc: 'Лешего', ins: 'Лешим', with: 'с Лешим' },
  yaga:     { gen: 'Бабы Яги', acc: 'Бабу Ягу', ins: 'Бабой Ягой', with: 'с Бабой Ягой' },
  koschei:  { gen: 'Кощея Бессмертного', acc: 'Кощея Бессмертного', ins: 'Кощеем Бессмертным', with: 'с Кощеем Бессмертным' },
};
export const beingForm = (hero, form) => BEING[hero][form];

const UNITS = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять', 'одиннадцать',
  'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const UNITS_TH = ['', 'первый', 'второй', 'третий', 'четвёртый', 'пятый', 'шестой', 'седьмой', 'восьмой', 'девятый', 'десятый',
  'одиннадцатый', 'двенадцатый', 'тринадцатый', 'четырнадцатый', 'пятнадцатый', 'шестнадцатый', 'семнадцатый', 'восемнадцатый', 'девятнадцатый'];
const TENS_TH = ['', '', 'двадцатый', 'тридцатый', 'сороковой', 'пятидесятый', 'шестидесятый', 'семидесятый', 'восьмидесятый', 'девяностый'];

// Числа словами до 199: этого хватает и на ходы, и на потери.
export function numberWord(n) {
  if (n >= 100) return n === 100 ? 'сто' : `сто ${numberWord(n - 100)}`;
  if (n < 20) return UNITS[n];
  return [TENS[Math.floor(n / 10)], UNITS[n % 10]].filter(Boolean).join(' ');
}

// Порядковые до 199: «седьмой», «двадцать первый», «сто сороковой».
function ordinal(n) {
  if (n >= 100) return n === 100 ? 'сотый' : `сто ${ordinal(n - 100)}`;
  if (n < 20) return UNITS_TH[n];
  return n % 10 ? `${TENS[Math.floor(n / 10)]} ${UNITS_TH[n % 10]}` : TENS_TH[n / 10];
}

// «один гном», «два гнома», «пять гномов».
function plural(n, one, few, many) {
  const tens = n % 100, last = n % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (last === 1) return one;
  return last >= 2 && last <= 4 ? few : many;
}

const single = n => n % 10 === 1 && n % 100 !== 11;
// «погиб один гном», но «погибло пять гномов».
const died = (n, verb, verbs, one, few, many) => `${single(n) ? verb : verbs} ${numberWord(n)} ${plural(n, one, few, many)}`;
const up = text => text[0].toUpperCase() + text.slice(1);

const DEALS = {
  ally: (a, b) => [`${a.nom} и ${b.nom} заключают союз`, `${a.nom} и ${b.nom} теперь союзники`, `Побратались ${a.nom} и ${b.nom}: быть им в союзе`],
  peace: (a, b) => [`${a.nom} и ${b.nom} заключают мир`, `Помирились ${a.nom} и ${b.nom}`, `Сложили оружие ${a.nom} и ${b.nom}, наступил мир`],
  trade: (a, b) => [`${a.nom} и ${b.nom} заключают сделку`, `${a.nom} и ${b.nom} ударили по рукам`, `Сторговались ${a.nom} и ${b.nom}`],
  embassy: (a, b) => [`${a.nom} и ${b.nom} обмениваются посольствами`, `Поехали послы: ${a.nom} и ${b.nom} открыли посольства`,
    `В столицах ${a.gen} и ${b.gen} теперь сидят послы`],
};
const REFUSED = {
  ally: (to, from) => [`${to.nom} отказывает ${from.dat} в союзе`, `${to.nom} не хочет союза ${from.with}`],
  peace: (to, from) => [`${to.nom} отказывает ${from.dat} в мире`, `${to.nom} не хочет мира ${from.with}`],
  trade: (to, from) => [`${to.nom} отказывает ${from.dat} в сделке`, `${to.nom} не хочет торговать ${from.with}`],
  pass: (to, from) => [`${to.nom} отказывает ${from.dat} в пропуске`, `${to.nom} не пускает ${from.nom} на свои земли`],
  embassy: (to, from) => [`${to.nom} не принимает послов ${from.gen}`, `${to.nom} отказывает ${from.dat} в посольстве`],
};

const inTown = (state, tile) => state?.towns?.find(t => t[0] === tile);
const PLACE = {
  ostrog: { nom: 'острог', acc: 'острог', gen: 'острога', fell: 'Пал', it: 'его' },
  capital: { nom: 'столица', acc: 'столицу', gen: 'столицы', fell: 'Пала', it: 'её' },
};
const place = capital => PLACE[capital ? 'capital' : 'ostrog'];

// Реплика события: строка или список равноправных формулировок.
const LINES = {
  // Ход и слайды. type turn это настоящее событие сервера, остальное просит сам экран.
  turn: e => (e.ended <= MAX_TURN
    ? [`Ход ${numberWord(e.ended)} завершён`, `Минул ${ordinal(e.ended)} ход`, `Вот и ${ordinal(e.ended)} ход позади`]
    : ['Ход завершён', 'Минул ещё один ход', 'Вот и ещё один ход позади']),
  next: e => (e.turn <= MAX_TURN + 1
    ? [`Следующий ход ${numberWord(e.turn)}`, `Начинается ${ordinal(e.turn)} ход`, `Наступает ${ordinal(e.turn)} ход`]
    : ['Следующий ход', 'Начинается новый ход', 'Наступает новый ход']),
  summary: () => ['Вот что произошло за этот ход', 'А было за этот ход вот что', 'Послушайте, что приключилось за этот ход'],
  more: e => (e.n <= MAX_COUNT
    ? `И ещё ${numberWord(e.n).replace(/один$/, 'одно')} ${plural(e.n, 'событие', 'события', 'событий')}`
    : 'И ещё больше ста событий'),
  march: () => ['Войска выступают', 'Отряды в пути', 'Дружины на марше', 'Рати двинулись', 'Застучали сапоги по дорогам',
    'Пошли рати через леса и поля', 'Двинулись дружины, только пыль столбом'],
  losses: e => {
    if (!e.n) return ['Бой обошёлся без потерь', 'Разошлись без потерь, все живы'];
    if (e.n > MAX_COUNT) return ['В бою пало больше ста воинов', 'Полегло в сече больше ста воинов', 'Больше ста воинов не вернулись из боя'];
    return [
      `В бою ${died(e.n, 'пал', 'пало', 'воин', 'воина', 'воинов')}`,
      `${up(died(e.n, 'полёг', 'полегло', 'воин', 'воина', 'воинов'))} в сече`,
      `${up(numberWord(e.n))} ${plural(e.n, 'воин', 'воина', 'воинов')} ${single(e.n) ? 'не вернулся' : 'не вернулись'} из боя`,
    ];
  },
  toll: e => {
    if (!e.n) return ['За этот ход никто не погиб', 'Ни один гном не погиб за этот ход', 'Обошлось без потерь, все гномы живы'];
    if (e.n > MAX_COUNT) return ['За этот ход погибло больше ста гномов', 'Полегло за этот ход больше ста гномов', 'Горе в деревнях: погибло больше ста гномов'];
    return [
      `За этот ход ${died(e.n, 'погиб', 'погибло', 'гном', 'гнома', 'гномов')}`,
      `${up(died(e.n, 'полёг', 'полегло', 'гном', 'гнома', 'гномов'))} за этот ход`,
      `Горе в деревнях: ${died(e.n, 'погиб', 'погибло', 'гном', 'гнома', 'гномов')}`,
    ];
  },
  over: e => {
    if (e.winner == null) return ['Партия окончена. Все царства погибли', 'Тут и сказке конец: не уцелело ни одно царство'];
    const w = realm(e.winner);
    return [`Партия окончена. Победа за ${w.ins}`, `Тут и сказке конец. Победило ${w.nom}`, `Вот и сказке конец, а победу одержало ${w.nom}`];
  },

  // Бои и земли.
  battle: (e, state) => {
    const a = realm(e.a.owner), d = realm(e.d.owner);
    if (!e.d.militia) return [`${a.nom} нападает на ${d.nom}`, `Сошлись в бою ${a.nom} и ${d.nom}`, `Рать ${a.gen} бьётся с ратью ${d.gen}`, `${a.nom} ударило по войску ${d.gen}`];
    const p = place(inTown(state, e.d.tile)?.[1] === 'capital');
    return [`${a.nom} штурмует ${p.acc} ${d.gen}`, `Войско ${a.gen} идёт на приступ ${p.gen} ${d.gen}`, `Под стенами ${p.gen} ${d.gen} кипит бой с войском ${a.gen}`];
  },
  capture: e => {
    const o = realm(e.owner);
    return [`${o.nom} занимает ничейный острог`, `Пустой острог достаётся ${o.dat}`, `${o.nom} поднимает своё знамя над брошенным острогом`];
  },
  townFell: e => {
    const by = realm(e.by), from = realm(e.from);
    if (e.surrender) return [`Острог ${from.gen} сдаётся без боя`, `Ворота острога ${from.gen} открылись без боя`, `Без единого удара сдаётся острог ${from.gen}`];
    if (e.loot) {
      return [`${by.nom} разрушает последнюю столицу ${from.gen} и забирает казну`, `Пала последняя столица ${from.gen}, и вся казна достаётся ${by.dat}`,
        `Казна ${from.gen} уходит ${by.dat}: последняя столица лежит в руинах`];
    }
    if (e.captives) {
      return [`${by.nom} разрушает острог ${from.gen} и уводит гномов в плен`, `Пал острог ${from.gen}, и ${by.nom} гонит пленных гномов к себе`,
        `${by.nom} разоряет острог ${from.gen}, а гномов уводит в плен`];
    }
    const p = place(e.capital);
    return [`${by.nom} разрушает ${p.acc} ${from.gen}`, `${p.fell} ${p.nom} ${from.gen} под натиском ${by.gen}`, `${up(p.nom)} ${from.gen} лежит в руинах: ${p.it} разорило ${by.nom}`];
  },
  ransom: e => {
    const o = realm(e.owner);
    return [`${o.nom} выкупает своих гномов из плена`, `${o.nom} платит выкуп, и пленные гномы идут домой`, `За грибы ${o.nom} вызволяет своих гномов из плена`];
  },
  captivesStay: e => [`Пленные гномы ${realm(e.owner).gen} остаются у ${realm(e.by).gen}`, `Не выкупило ${realm(e.owner).nom} своих гномов, и они остаются у ${realm(e.by).gen}`],
  captivesFreed: e => {
    const o = realm(e.owner);
    return [`Пленные гномы ${o.gen} вернулись домой`, `Вернулись домой пленные гномы ${o.gen}`, `Отпустили пленных гномов ${o.gen}, и они вернулись домой`];
  },
  built: e => {
    const o = realm(e.owner);
    return [`${o.nom} основывает острог`, `Застучали топоры: ${o.nom} ставит новый острог`, `На новой земле ${o.nom} рубит острог`];
  },
  capital: e => {
    const o = realm(e.owner);
    return [`${o.nom} переносит столицу`, `Собирает ${o.nom} пожитки и переносит столицу`, `У ${o.gen} теперь новая столица`];
  },
  ruin: (e, state) => {
    const owner = e.owner ?? inTown(state, e.tile)?.[2];
    if (owner == null) return ['Покинутый острог развалился', 'Без хозяев рассыпался старый острог', 'Заброшенный острог зарос бурьяном и развалился'];
    const o = realm(owner);
    return [`Покинутый острог ${o.gen} развалился`, `Без хозяев рассыпался острог ${o.gen}`, `Заброшенный острог ${o.gen} зарос бурьяном и развалился`];
  },
  fell: e => {
    const p = realm(e.player);
    return [`Пало ${p.nom}`, `Не устояло ${p.nom}: пало оно под ударами врагов`, `Вот и пало ${p.nom}, осталась от него одна сказка`];
  },
  tradeOpen: e => {
    const a = realm(e.a), b = realm(e.b);
    return [`Открылся торговый путь между ${a.ins} и ${b.ins}`, `Дорога связала столицы: ${a.nom} и ${b.nom} начали торговать`,
      `Пошли обозы с грибами: ${a.nom} торгует с ${b.ins}`];
  },
  tradeCut: e => {
    const a = realm(e.a), b = realm(e.b);
    if (e.war) return [`Война перерезала торговый путь между ${a.ins} и ${b.ins}`, `Встали обозы: ${a.nom} и ${b.nom} воюют и больше не торгуют`,
      `Кончилась торговля между ${a.ins} и ${b.ins}: на дороге теперь войска`];
    return [`Прервался торговый путь между ${a.ins} и ${b.ins}`, `Дорога между ${a.ins} и ${b.ins} оборвалась, и торговля встала`,
      `${a.nom} и ${b.nom} больше не торгуют: путь между столицами прервался`];
  },
  blight: e => {
    const p = realm(e.player);
    return [`Хворь пала на ${p.nom}`, `Напала на ${p.nom} хворь`, `Худо ${p.dat}: по деревням ходит хворь`];
  },
  left: e => [`${realm(e.player).nom} покидает партию`, `Князь ${realm(e.player).gen} уходит из игры`],

  // Дипломатия.
  war: e => {
    const from = realm(e.from), to = realm(e.to);
    if (e.joined != null) {
      return [`${to.nom} вступает в войну против ${from.gen}`, `На помощь союзнику ${to.nom} выступает против ${from.gen}`,
        `${to.nom} встаёт плечом к плечу с союзником против ${from.gen}`];
    }
    return [`${from.nom} хочет посадить на кол ${to.nom}`, `${from.nom} объявляет войну ${to.dat}`, `${from.nom} идёт войной на ${to.nom}`,
      `Быть войне: ${from.nom} поднимает рать против ${to.gen}`];
  },
  deal: e => {
    const from = realm(e.from), to = realm(e.to);
    if (e.kind === 'pass') {
      return [`${to.nom} открывает границу ${from.dat}`, `${to.nom} пропускает войска ${from.gen} через свои земли`, `Путь через земли ${to.gen} открыт для ${from.gen}`];
    }
    return DEALS[e.kind](realm(Math.min(e.from, e.to)), realm(Math.max(e.from, e.to)));
  },
  refused: e => REFUSED[e.kind](realm(e.to), realm(e.from)),
  broken: e => {
    const from = realm(e.from), to = realm(e.to);
    return [`${from.nom} разрывает союз ${to.with}`, `Кончилась дружба: ${from.nom} рвёт союз ${to.with}`, `Нет больше союза между ${from.ins} и ${to.ins}`];
  },
  borderShut: e => {
    const from = realm(e.from), to = realm(e.to);
    return [`${from.nom} закрывает границу перед ${to.ins}`, `${from.nom} запирает рубежи от ${to.gen}`, `На границе ${from.gen} застава: ${to.dat} больше нет пути`];
  },

  // Сказочные существа.
  // На налёте Горыныч сам прилетает к царству, и by здесь это его цель.
  heroFound: e => {
    const by = realm(e.by);
    if (e.raid) return [`Змей Горыныч прилетел к ${by.dat}`, `Над ${by.ins} кружит Змей Горыныч`, `Прилетел Змей Горыныч, и задрожало ${by.nom}`];
    const h = BEING[e.hero];
    return [`${by.nom} находит ${h.acc}`, `Повстречало ${by.nom} ${h.acc}`, `В глуши ${by.nom} набредает на ${h.acc}`];
  },
  dragon: e => {
    if (e.owner == null) {
      return e.hide ? ['Змей Горыныч скрылся в лесу', 'Змей Горыныч уполз отсыпаться в чащу']
        : ['Змей Горыныч перелетел на новое место', 'Змей Горыныч расправил крылья и улетел прочь'];
    }
    const o = realm(e.owner);
    return e.ostrog == null ? [`Змей Горыныч летит к войскам ${o.gen}`, `Тень Змея Горыныча легла на войско ${o.gen}`]
      : [`Змей Горыныч летит на острог ${o.gen}`, `Змей Горыныч кружит над острогом ${o.gen}`];
  },
  encounter: e => {
    const o = realm(e.owner), h = BEING[e.hero];
    if (e.won === true) return [`${o.nom} сражается ${h.with} и побеждает`, `Одолело ${o.nom} ${h.acc} в честном бою`];
    if (e.won === false) return [`${o.nom} сражается ${h.with} и проигрывает`, `Не устояло ${o.nom} перед ${h.ins}`];
    // Тёмных встреч за ход бывает несколько: диктор говорит коротко, название судьбы остаётся в подписи.
    if (e.dark) return [`${o.nom} страдает от ${h.gen}`, `Худо ${o.dat} от проделок ${h.gen}`];
    return `${o.nom} страдает от ${h.gen}: ${e.text}`;
  },
  fire: e => {
    const from = realm(e.from), o = realm(e.owner);
    return [`${from.nom} насылает Змея Горыныча на острог ${o.gen}`, `По слову ${from.gen} Змей Горыныч жжёт острог ${o.gen}`,
      `${from.nom} натравливает Змея Горыныча на острог ${o.gen}`];
  },

  // Строки state.notices приходят с сервера готовым текстом для экрана.
  notice: e => e.text,
};

// Сказ между ходами: одна фраза о том, как идёт партия. Какую сказать, решает taleFor по тому, что на земле.
const HERO_TALES = {
  gorynych: ['Над горами вьётся дым: Змей Горыныч не спит', 'Говорят, Змей Горыныч опять проголодался'],
  vodyanoy: ['В омутах ворочается Водяной', 'Водяной мутит воду и ждёт гостей'],
  leshy: ['Леший путает тропы в чаще', 'Ухает в лесу Леший, ищет, кого закружить'],
  yaga: ['Баба Яга точит зубы в своей избушке'],
  koschei: ['Кощей Бессмертный пересчитывает своё злато', 'Из подвалов Кощея тянет холодом'],
};
const TALES = {
  start: () => ['Царства только обживаются на новых землях', 'Земли ещё не поделены, сказ только начинается', 'Пока все присматриваются к соседям'],
  late: () => ['Долго тянется эта сказка, а конца ей не видно', 'Много воды утекло с начала сказа', 'Старики уже и не помнят, с чего всё началось'],
  quiet: () => ['На землях пока тихо, ни одной войны', 'Мир да тишь стоят над землями', 'Царства живут мирно, гномы растят грибы'],
  losses: () => ['Тяжёлый выдался ход, много гномов полегло', 'Горько плачут по гномам в деревнях', 'Много свежих курганов прибавилось на земле'],
  war: ({ a, b }) => [`Не утихает война между ${realm(a).ins} и ${realm(b).ins}`, `Всё ещё воюют ${realm(a).nom} и ${realm(b).nom}`,
    `Гремит война: ${realm(a).nom} против ${realm(b).gen}`],
  ally: ({ a, b }) => [`Крепок союз ${realm(a).gen} и ${realm(b).gen}`, `Плечом к плечу стоят ${realm(a).nom} и ${realm(b).nom}`],
  lead: ({ a }) => [`Сильнее всех нынче ${realm(a).nom}`, `Крепче всех стоит ${realm(a).nom}`, `О ${realm(a).loc} уже слагают песни`],
  weak: ({ a }) => [`Тяжко приходится ${realm(a).dat}`, `Тают силы ${realm(a).gen}`, `Держится ${realm(a).nom} из последних сил`],
  hero: ({ hero }) => HERO_TALES[hero],
};

// Колода на каждый вид реплики: формулировки идут вперемешку и не повторяются, пока не прозвучат все.
// Новая колода не начинается с той, что прозвучала последней, поэтому двух одинаковых подряд не бывает.
const decks = new Map(), last = new Map();
function vary(key, options) {
  if (!Array.isArray(options)) return options;
  if (options.length === 1) return options[0];
  const id = `${key}/${options.length}`;
  let deck = decks.get(id);
  if (!deck?.length) {
    deck = options.map((_, i) => i);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    if (deck.at(-1) === last.get(id)) [deck[0], deck[deck.length - 1]] = [deck.at(-1), deck[0]];
    decks.set(id, deck);
  }
  const pick = deck.pop();
  last.set(id, pick);
  return options[pick];
}

export const lineFor = (event, state) => {
  const out = LINES[event.type]?.(event, state);
  return out == null ? null : vary(event.type, out);
};

// Чем больше у царства земли и войска, тем оно сильнее. Сказу хватает грубой оценки.
function ranked(state) {
  const power = new Map(state.players.filter(p => !p.out && !p.horde).map(p => [p.id, 0]));
  for (const [, owner] of state.terr || []) if (power.has(owner)) power.set(owner, power.get(owner) + 1);
  for (const u of state.units || []) if (power.has(u.owner)) power.set(u.owner, power.get(u.owner) + u.n);
  return [...power].map(([id, value]) => ({ id, value })).sort((x, y) => y.value - x.value);
}

let lastTale = null;
// Фраза сказа после хода: каждый раз о другом, если есть о чём, и всегда о том, что сейчас на земле.
export function taleFor(state) {
  const pick = list => list[Math.floor(Math.random() * list.length)];
  const alive = new Set(state.players.filter(p => !p.out && !p.horde).map(p => p.id));
  const ties = (state.relations || []).filter(([a, b]) => alive.has(a) && alive.has(b));
  const wars = ties.filter(r => r[2] === 'war'), allies = ties.filter(r => r[2] === 'ally');
  const pair = ([a, b]) => ({ a: Math.min(a, b), b: Math.max(a, b) });
  const top = ranked(state), early = state.turn <= 3;
  const can = [];
  if (early) can.push(['start', {}]);
  if (state.turn >= 40) can.push(['late', {}]);
  if (!wars.length && !early) can.push(['quiet', {}]);
  if ((state.fallenTotal || 0) >= 25) can.push(['losses', {}]);
  if (wars.length) can.push(['war', pair(pick(wars))]);
  if (allies.length) can.push(['ally', pair(pick(allies))]);
  if (!early && top.length >= 2 && top[0].value >= top[1].value * 1.4) can.push(['lead', { a: top[0].id }]);
  if (!early && top.length >= 3 && top.at(-1).value <= top[0].value * 0.5) can.push(['weak', { a: top.at(-1).id }]);
  if (HERO_TALES[state.legend?.hero]) can.push(['hero', { hero: state.legend.hero }]);
  if (!can.length) return null;
  const fresh = can.filter(([kind]) => kind !== lastTale);
  const [kind, data] = pick(fresh.length ? fresh : can);
  lastTale = kind;
  return vary(`tale:${kind}`, TALES[kind](data));
}

// Все реплики целиком, в том числе фразы легенд. Перебор идёт через те же LINES, поэтому текст не разойдётся.
// Тёмное царство может сесть на любое место: реплики перечисляются без него и с ним на каждом месте.
export function allLines() {
  const all = new Set();
  for (const seat of [null, ...FACTIONS.map((_, i) => i)]) {
    setDarkSeat(seat);
    linesInto(all);
  }
  // Войско Тугарина: имя одно на любом месте. Бои, штурмы и разорения с каждым царством, в том числе с Тёмным.
  for (const dark of [null, 0]) {
    setDarkSeat(dark);
    setHordeSeat(FACTIONS.length);
    hordeInto(all, FACTIONS.length);
  }
  setHordeSeat(null);
  setDarkSeat(null);
  return [...all];
}

function hordeInto(all, h) {
  const add = out => { for (const line of [out].flat()) if (line) all.add(line); };
  const say = (type, data = {}, state) => add(LINES[type]({ type, ...data }, state));
  const town = capital => ({ towns: [[0, capital ? 'capital' : 'ostrog', 0, 1]] });
  for (const pid of FACTIONS.map((_, i) => i)) {
    say('battle', { a: { owner: h }, d: { owner: pid } });
    say('battle', { a: { owner: pid }, d: { owner: h } });
    for (const capital of [false, true]) {
      say('battle', { a: { owner: h }, d: { owner: pid, militia: true, tile: 0 } }, town(capital));
      say('townFell', { by: h, from: pid, capital });
    }
    say('townFell', { by: h, from: pid, capital: false, captives: 1 });
    say('townFell', { by: h, from: pid, capital: false, captives: 1, surrender: true });
  }
  say('fell', { player: h });
}

function linesInto(all) {
  const add = out => { for (const line of [out].flat()) if (line) all.add(line); };
  const say = (type, data = {}, state) => add(LINES[type]({ type, ...data }, state));
  const realms = FACTIONS.map((_, pid) => pid);
  const pairs = realms.flatMap(a => realms.filter(b => b !== a).map(b => [a, b]));
  const town = capital => ({ towns: [[0, capital ? 'capital' : 'ostrog', 0, 1]] });

  for (let n = 1; n <= MAX_TURN; n++) {
    say('turn', { ended: n });
    say('next', { turn: n + 1 });
  }
  say('turn', { ended: MAX_TURN + 1 });
  say('next', { turn: MAX_TURN + 2 });
  say('next', { turn: MAX_TURN + 3 });
  say('summary');
  say('march');
  for (let n = 0; n <= MAX_COUNT + 1; n++) {
    say('toll', { n });
    say('losses', { n });
    if (n) say('more', { n });
  }
  for (const { text = [], after = [], struck = [], before = [], dark } of Object.values(WEATHER)) {
    for (const line of [...text, ...after, ...struck, ...before, dark]) if (line) all.add(line);
  }
  for (const line of BARE_STRUCK) all.add(line);
  say('dragon', { owner: null, hide: true });
  say('dragon', { owner: null, hide: false });
  say('ruin', {});
  say('over', { winner: null });

  for (const pid of realms) {
    for (const type of ['built', 'capital']) say(type, { owner: pid });
    for (const type of ['fell', 'blight', 'left']) say(type, { player: pid });
    say('capture', { owner: pid });
    say('captivesFreed', { owner: pid });
    say('ruin', { owner: pid });
    say('over', { winner: pid });
    say('dragon', { owner: pid, ostrog: 1 });
    say('dragon', { owner: pid, ostrog: null });
    for (const [key, hero] of Object.entries(HEROES)) {
      // Орду Тугарина не находят: она приходит сама, и тёмных встреч с ней не бывает.
      if (key !== 'vodyanoy' && !hero.horde) say('heroFound', { by: pid, hero: key });
      if (key === 'gorynych') say('heroFound', { by: pid, hero: key, raid: true });
      const told = LEGENDS.filter(l => l.hero === key);
      for (const fate of [hero.curse, ...told.map(l => l.curse)]) say('encounter', { hero: key, owner: pid, text: fate.name });
      if (!hero.horde) say('encounter', { hero: key, owner: pid, dark: true });
      for (const won of [true, false]) say('encounter', { hero: key, owner: pid, won });
    }
    say('encounter', { hero: 'gorynych', owner: pid, text: RAID_NAME });
    add(TALES.lead({ a: pid }));
    add(TALES.weak({ a: pid }));
  }

  for (const [a, b] of pairs) {
    if (a < b) add([disputeLine(a, b), ...['warn', 'ally', 'truce'].map(stage => discordLine(a, b, stage))]);
    say('battle', { a: { owner: a }, d: { owner: b } });
    for (const capital of [false, true]) {
      say('battle', { a: { owner: a }, d: { owner: b, militia: true, tile: 0 } }, town(capital));
      say('townFell', { by: a, from: b, capital });
    }
    say('townFell', { by: a, from: b, capital: true, loot: 1 });
    say('townFell', { by: a, from: b, capital: false, captives: 1 });
    say('townFell', { by: a, from: b, capital: false, captives: 1, surrender: true });
    say('ransom', { owner: a, by: b });
    say('captivesStay', { owner: a, by: b });
    say('war', { from: a, to: b });
    say('war', { from: a, to: b, joined: a });
    say('broken', { from: a, to: b });
    if (a < b) for (const type of ['tradeOpen', 'tradeCut']) for (const war of [false, true]) if (type === 'tradeCut' || !war) say(type, { a, b, ...(war ? { war } : {}) });
    say('borderShut', { from: a, to: b });
    say('fire', { from: a, owner: b });
    for (const kind of ['ally', 'peace', 'trade', 'pass', 'embassy']) {
      say('deal', { from: a, to: b, kind });
      say('refused', { from: a, to: b, kind });
    }
    if (a < b) {
      add(TALES.war({ a, b }));
      add(TALES.ally({ a, b }));
    }
  }
  for (const kind of ['start', 'late', 'quiet', 'losses']) add(TALES[kind]());
  for (const lines of Object.values(HERO_TALES)) add(lines);

  const told = [
    ...Object.values(OPENINGS), ...CLOSINGS,
    ...LEGENDS.flatMap(l => [...l.story, `Особый дар: ${l.gift.name}.`, `Особое проклятье: ${l.curse.name}.`]),
    ...OMENS.map(o => o.line),
  ];
  for (const line of told) all.add(line);
  add(HURRY_LINES);
  add([hordeLine('warn'), hordeLine('came'), EPILOGUE_OPEN, EPILOGUE_NONE]);
  for (const pid of realms) {
    add([hordeRaidLine(pid, true), hordeRaidLine(pid, false), leaderLine(pid), fallenLine(pid)]);
    add(Object.keys(TITLE_LINES).map(key => titleLine(key, pid)));
    add(Object.values(ENDINGS).map(end => end(realm(pid).nom)));
  }
}
