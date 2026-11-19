import { editDistance } from './ai';
import { lineName } from './items';

/*
 * The garage's own dictionary of part names (v0.49, the user: «большую часть задач приложение само делало без ИИ»):
 * the parts a garage in the UAE buys most, each with its English name as the invoices write it and the Russian words
 * that name it. A name typed on a line is looked up here first — its typing mistakes put right by the dictionary and
 * its English name given from it, in no time and for no tokens; only a name the dictionary does not know goes to the
 * AI. Pure: words and edit distances, no data, no network.
 *
 * Matching is by the words of the name in any order: «колодки тормозные передние» and «передние тормозные колодки»
 * are one part. Russian words are matched by their stems (the endings differ by case and number), English words by
 * their singular; a word a letter or two off a known word (a quarter of it at most) is that word.
 */

/** A part: its English name (the words in any order name it) and the Russian stem sets that name it. */
type Entry = { en: string; ru: string[][] };

const V: Entry[] = [
  // Brakes
  { en: 'FRONT BRAKE PADS', ru: [['передн', 'тормоз', 'колодк'], ['передн', 'колодк']] },
  { en: 'REAR BRAKE PADS', ru: [['задн', 'тормоз', 'колодк'], ['задн', 'колодк']] },
  { en: 'BRAKE PADS', ru: [['тормоз', 'колодк'], ['колодк']] },
  { en: 'FRONT BRAKE DISCS', ru: [['передн', 'тормоз', 'диск'], ['передн', 'диск']] },
  { en: 'REAR BRAKE DISCS', ru: [['задн', 'тормоз', 'диск'], ['задн', 'диск']] },
  { en: 'BRAKE DISCS', ru: [['тормоз', 'диск']] },
  { en: 'BRAKE SHOES', ru: [['барабан', 'колодк'], ['тормоз', 'барабан', 'колодк']] },
  { en: 'BRAKE DRUM', ru: [['тормоз', 'барабан']] },
  { en: 'BRAKE CALIPER', ru: [['суппорт'], ['тормоз', 'суппорт']] },
  { en: 'BRAKE CALIPER REPAIR KIT', ru: [['ремкомплект', 'суппорт']] },
  { en: 'BRAKE HOSE', ru: [['тормоз', 'шланг']] },
  { en: 'BRAKE MASTER CYLINDER', ru: [['главн', 'тормоз', 'цилиндр']] },
  { en: 'BRAKE BOOSTER', ru: [['вакуум', 'усилител'], ['усилител', 'тормоз'], ['вакуум', 'усилител', 'тормоз']] },
  { en: 'BRAKE FLUID', ru: [['тормоз', 'жидкост']] },
  { en: 'HANDBRAKE CABLE', ru: [['трос', 'ручник'], ['трос', 'стояночн', 'тормоз'], ['трос', 'ручн', 'тормоз']] },
  { en: 'ABS SENSOR', ru: [['датчик', 'абс'], ['датчик', 'abs']] },
  { en: 'BRAKE PAD WEAR SENSOR', ru: [['датчик', 'износ', 'колодк']] },
  // Engine service
  { en: 'ENGINE OIL', ru: [['моторн', 'масл'], ['масл', 'двигател'], ['масл', 'мотор']] },
  { en: 'OIL FILTER', ru: [['масл', 'фильтр']] },
  { en: 'AIR FILTER', ru: [['воздуш', 'фильтр']] },
  { en: 'CABIN FILTER', ru: [['салон', 'фильтр']] },
  { en: 'FUEL FILTER', ru: [['топлив', 'фильтр']] },
  { en: 'SPARK PLUGS', ru: [['свеч', 'зажиган'], ['свеч']] },
  { en: 'GLOW PLUGS', ru: [['свеч', 'накал'], ['свеч', 'накаливан']] },
  { en: 'IGNITION COIL', ru: [['катушк', 'зажиган'], ['катушк']] },
  { en: 'OIL DRAIN PLUG', ru: [['сливн', 'пробк'], ['пробк', 'поддон']] },
  { en: 'DRAIN PLUG WASHER', ru: [['шайб', 'сливн', 'пробк'], ['шайб', 'пробк']] },
  { en: 'TIMING BELT', ru: [['ремен', 'грм']] },
  { en: 'TIMING BELT KIT', ru: [['комплект', 'ремен', 'грм'], ['комплект', 'грм']] },
  { en: 'TIMING CHAIN', ru: [['цеп', 'грм']] },
  { en: 'TIMING CHAIN KIT', ru: [['комплект', 'цеп', 'грм']] },
  { en: 'ALTERNATOR BELT', ru: [['ремен', 'генератор']] },
  { en: 'SERPENTINE BELT', ru: [['приводн', 'ремен'], ['ремен', 'навесн'], ['поликлинов', 'ремен']] },
  { en: 'AC BELT', ru: [['ремен', 'кондиционер']] },
  { en: 'BELT TENSIONER', ru: [['натяжител', 'ремн'], ['ролик', 'натяжител'], ['натяжн', 'ролик'], ['натяжител']] },
  { en: 'IDLER PULLEY', ru: [['обводн', 'ролик'], ['паразитн', 'ролик']] },
  { en: 'VALVE COVER GASKET', ru: [['прокладк', 'клапанн', 'крышк']] },
  { en: 'HEAD GASKET', ru: [['прокладк', 'гбц'], ['прокладк', 'головк', 'блок'], ['прокладк', 'головк']] },
  { en: 'OIL PAN GASKET', ru: [['прокладк', 'поддон']] },
  { en: 'INTAKE MANIFOLD GASKET', ru: [['прокладк', 'впускн', 'коллектор']] },
  { en: 'EXHAUST MANIFOLD GASKET', ru: [['прокладк', 'выпускн', 'коллектор']] },
  { en: 'ENGINE MOUNT', ru: [['подушк', 'двигател'], ['опор', 'двигател'], ['подушк', 'мотор']] },
  { en: 'GEARBOX MOUNT', ru: [['подушк', 'кпп'], ['подушк', 'коробк'], ['опор', 'кпп']] },
  { en: 'CRANKSHAFT OIL SEAL', ru: [['сальник', 'коленвал']] },
  { en: 'CAMSHAFT OIL SEAL', ru: [['сальник', 'распредвал']] },
  { en: 'VALVE STEM SEALS', ru: [['маслосъемн', 'колпачк'], ['сальник', 'клапан']] },
  { en: 'PCV VALVE', ru: [['клапан', 'вентиляц', 'картер'], ['клапан', 'pcv']] },
  { en: 'EGR VALVE', ru: [['клапан', 'егр'], ['клапан', 'egr']] },
  { en: 'THROTTLE BODY', ru: [['дроссел', 'заслонк'], ['дроссел']] },
  { en: 'MAF SENSOR', ru: [['датчик', 'массов', 'расход', 'воздух'], ['дмрв'], ['датчик', 'расход', 'воздух']] },
  { en: 'MAP SENSOR', ru: [['датчик', 'абсолютн', 'давлен'], ['датчик', 'map']] },
  { en: 'OXYGEN SENSOR', ru: [['лямбд', 'зонд'], ['кислородн', 'датчик'], ['лямбд']] },
  { en: 'CAMSHAFT SENSOR', ru: [['датчик', 'распредвал']] },
  { en: 'CRANKSHAFT SENSOR', ru: [['датчик', 'коленвал']] },
  { en: 'KNOCK SENSOR', ru: [['датчик', 'детонац']] },
  { en: 'COOLANT TEMPERATURE SENSOR', ru: [['датчик', 'температур', 'охлаждающ'], ['датчик', 'температур', 'антифриз'], ['датчик', 'температур']] },
  { en: 'OIL PRESSURE SENSOR', ru: [['датчик', 'давлен', 'масл']] },
  { en: 'FUEL INJECTOR', ru: [['форсунк'], ['топлив', 'форсунк']] },
  { en: 'DIESEL INJECTOR', ru: [['дизел', 'форсунк']] },
  { en: 'FUEL PUMP', ru: [['топлив', 'насос'], ['бензонасос']] },
  { en: 'HIGH PRESSURE FUEL PUMP', ru: [['тнвд'], ['насос', 'высок', 'давлен']] },
  { en: 'TURBOCHARGER', ru: [['турбин'], ['турбокомпрессор'], ['турб']] },
  { en: 'INTERCOOLER', ru: [['интеркулер']] },
  { en: 'AIR INTAKE HOSE', ru: [['патрубок', 'воздуш'], ['впускн', 'патрубок'], ['гофр', 'воздуш']] },
  { en: 'DPF FILTER', ru: [['сажев', 'фильтр'], ['фильтр', 'dpf']] },
  // Cooling
  { en: 'RADIATOR', ru: [['радиатор', 'охлажден'], ['радиатор']] },
  { en: 'RADIATOR CAP', ru: [['крышк', 'радиатор'], ['пробк', 'радиатор']] },
  { en: 'RADIATOR HOSE', ru: [['патрубок', 'радиатор'], ['шланг', 'радиатор']] },
  { en: 'THERMOSTAT', ru: [['термостат']] },
  { en: 'WATER PUMP', ru: [['помп'], ['водян', 'насос']] },
  { en: 'RADIATOR FAN', ru: [['вентилятор', 'радиатор'], ['вентилятор', 'охлажден']] },
  { en: 'FAN CLUTCH', ru: [['вискомуфт'], ['муфт', 'вентилятор'], ['гидромуфт']] },
  { en: 'COOLANT', ru: [['антифриз'], ['охлаждающ', 'жидкост'], ['тосол']] },
  { en: 'EXPANSION TANK', ru: [['расширител', 'бачок']] },
  // Air conditioning
  { en: 'AC COMPRESSOR', ru: [['компрессор', 'кондиционер'], ['компрессор']] },
  { en: 'AC CONDENSER', ru: [['конденсатор'], ['радиатор', 'кондиционер']] },
  { en: 'AC EVAPORATOR', ru: [['испарител']] },
  { en: 'AC EXPANSION VALVE', ru: [['расширител', 'клапан'], ['трв'], ['клапан', 'трв']] },
  { en: 'AC RECEIVER DRIER', ru: [['осушител'], ['осушител', 'кондиционер']] },
  { en: 'BLOWER MOTOR', ru: [['мотор', 'печк'], ['вентилятор', 'печк'], ['мотор', 'отопител'], ['моторчик', 'печк']] },
  { en: 'BLOWER RESISTOR', ru: [['резистор', 'печк'], ['реостат', 'печк'], ['резистор', 'отопител']] },
  { en: 'HEATER CORE', ru: [['радиатор', 'печк'], ['радиатор', 'отопител']] },
  { en: 'AC GAS', ru: [['фреон'], ['газ', 'кондиционер'], ['хладагент']] },
  { en: 'AC HOSE', ru: [['шланг', 'кондиционер'], ['трубк', 'кондиционер']] },
  { en: 'AC PRESSURE SENSOR', ru: [['датчик', 'давлен', 'кондиционер']] },
  { en: 'AC COMPRESSOR CLUTCH', ru: [['муфт', 'компрессор']] },
  // Suspension and steering
  { en: 'FRONT SHOCK ABSORBERS', ru: [['передн', 'амортизатор'], ['передн', 'стойк', 'амортизатор']] },
  { en: 'REAR SHOCK ABSORBERS', ru: [['задн', 'амортизатор']] },
  { en: 'SHOCK ABSORBER', ru: [['амортизатор']] },
  { en: 'STRUT MOUNT', ru: [['опор', 'амортизатор'], ['опорн', 'подшипник'], ['опор', 'стойк']] },
  { en: 'COIL SPRING', ru: [['пружин'], ['пружин', 'подвеск']] },
  { en: 'LOWER CONTROL ARM', ru: [['нижн', 'рычаг']] },
  { en: 'UPPER CONTROL ARM', ru: [['верхн', 'рычаг']] },
  { en: 'CONTROL ARM', ru: [['рычаг'], ['рычаг', 'подвеск']] },
  { en: 'BALL JOINT', ru: [['шаров', 'опор'], ['шаров']] },
  { en: 'TIE ROD END', ru: [['наконечник', 'рулев', 'тяг'], ['наконечник', 'рулев'], ['наконечник']] },
  { en: 'TIE ROD', ru: [['рулев', 'тяг']] },
  { en: 'STABILIZER LINK', ru: [['стойк', 'стабилизатор'], ['линк', 'стабилизатор'], ['линк'], ['тяг', 'стабилизатор']] },
  { en: 'STABILIZER BUSHING', ru: [['втулк', 'стабилизатор']] },
  { en: 'CONTROL ARM BUSHING', ru: [['сайлентблок', 'рычаг'], ['сайлентблок']] },
  { en: 'WHEEL BEARING', ru: [['ступичн', 'подшипник'], ['подшипник', 'ступиц']] },
  { en: 'WHEEL HUB', ru: [['ступиц']] },
  { en: 'CV JOINT', ru: [['шрус'], ['гранат']] },
  { en: 'CV BOOT', ru: [['пыльник', 'шрус'], ['пыльник', 'гранат']] },
  { en: 'DRIVE SHAFT', ru: [['привод', 'вал'], ['полуос'], ['привод']] },
  { en: 'PROPELLER SHAFT', ru: [['кардан'], ['кардан', 'вал']] },
  { en: 'STEERING RACK', ru: [['рулев', 'рейк']] },
  { en: 'STEERING RACK BOOT', ru: [['пыльник', 'рулев', 'рейк'], ['пыльник', 'рейк']] },
  { en: 'POWER STEERING PUMP', ru: [['насос', 'гур'], ['гур', 'насос'], ['насос', 'гидроусилител']] },
  { en: 'POWER STEERING FLUID', ru: [['жидкост', 'гур'], ['масл', 'гур']] },
  { en: 'POWER STEERING HOSE', ru: [['шланг', 'гур'], ['трубк', 'гур']] },
  // Transmission
  { en: 'CLUTCH KIT', ru: [['комплект', 'сцеплен'], ['сцеплен']] },
  { en: 'CLUTCH DISC', ru: [['диск', 'сцеплен']] },
  { en: 'CLUTCH PRESSURE PLATE', ru: [['корзин', 'сцеплен']] },
  { en: 'CLUTCH RELEASE BEARING', ru: [['выжимн', 'подшипник']] },
  { en: 'CLUTCH MASTER CYLINDER', ru: [['главн', 'цилиндр', 'сцеплен']] },
  { en: 'CLUTCH SLAVE CYLINDER', ru: [['рабоч', 'цилиндр', 'сцеплен']] },
  { en: 'FLYWHEEL', ru: [['маховик']] },
  { en: 'GEARBOX OIL', ru: [['масл', 'кпп'], ['масл', 'коробк'], ['трансмиссион', 'масл']] },
  { en: 'ATF', ru: [['масл', 'акпп'], ['жидкост', 'акпп'], ['atf']] },
  { en: 'TRANSMISSION FILTER', ru: [['фильтр', 'акпп'], ['фильтр', 'коробк']] },
  { en: 'TRANSMISSION PAN GASKET', ru: [['прокладк', 'поддон', 'акпп']] },
  { en: 'DIFFERENTIAL OIL', ru: [['масл', 'редуктор'], ['масл', 'мост'], ['масл', 'дифференциал']] },
  { en: 'TRANSFER CASE OIL', ru: [['масл', 'раздатк'], ['масл', 'раздаточн']] },
  // Electrical
  { en: 'BATTERY', ru: [['аккумулятор'], ['акб']] },
  { en: 'ALTERNATOR', ru: [['генератор']] },
  { en: 'STARTER MOTOR', ru: [['стартер']] },
  { en: 'HEADLIGHT', ru: [['фар'], ['передн', 'фар']] },
  { en: 'HEADLIGHT BULB', ru: [['лампочк', 'фар'], ['ламп', 'фар'], ['лампочк', 'ближн'], ['ламп', 'ближн']] },
  { en: 'TAIL LIGHT', ru: [['задн', 'фонар'], ['фонар']] },
  { en: 'FOG LIGHT', ru: [['противотуман', 'фар'], ['птф'], ['противотуманк']] },
  { en: 'HORN', ru: [['звуков', 'сигнал'], ['клаксон'], ['гудок']] },
  { en: 'WIPER BLADES', ru: [['дворник'], ['щетк', 'стеклоочистител'], ['щетк', 'дворник'], ['щетк']] },
  { en: 'WIPER MOTOR', ru: [['мотор', 'дворник'], ['моторчик', 'дворник'], ['мотор', 'стеклоочистител']] },
  { en: 'WASHER PUMP', ru: [['насос', 'омывател'], ['моторчик', 'омывател']] },
  { en: 'WINDOW REGULATOR', ru: [['стеклоподъемник']] },
  { en: 'WINDOW MOTOR', ru: [['мотор', 'стеклоподъемник'], ['моторчик', 'стеклоподъемник']] },
  { en: 'DOOR LOCK ACTUATOR', ru: [['замок', 'двер'], ['актуатор', 'замк'], ['актуатор', 'двер']] },
  { en: 'FUSE', ru: [['предохранител']] },
  { en: 'RELAY', ru: [['реле']] },
  { en: 'IGNITION SWITCH', ru: [['замок', 'зажиган']] },
  { en: 'PARKING SENSOR', ru: [['парктроник'], ['датчик', 'парковк']] },
  { en: 'REVERSE CAMERA', ru: [['камер', 'задн', 'вид'], ['камер', 'заднего']] },
  { en: 'KEY BATTERY', ru: [['батарейк', 'ключ']] },
  { en: 'REMOTE KEY', ru: [['ключ'], ['брелок']] },
  { en: 'BATTERY TERMINAL', ru: [['клемм', 'аккумулятор'], ['клемм']] },
  // Exhaust
  { en: 'CATALYTIC CONVERTER', ru: [['катализатор']] },
  { en: 'MUFFLER', ru: [['глушител']] },
  { en: 'EXHAUST PIPE', ru: [['выхлопн', 'труб'], ['труб', 'глушител']] },
  { en: 'EXHAUST GASKET', ru: [['прокладк', 'глушител'], ['прокладк', 'выхлопн']] },
  { en: 'EXHAUST FLEX PIPE', ru: [['гофр', 'глушител'], ['гофр']] },
  // Body
  { en: 'FRONT BUMPER', ru: [['передн', 'бампер']] },
  { en: 'REAR BUMPER', ru: [['задн', 'бампер']] },
  { en: 'BUMPER', ru: [['бампер']] },
  { en: 'FENDER', ru: [['крыл']] },
  { en: 'BONNET', ru: [['капот']] },
  { en: 'GRILLE', ru: [['решетк', 'радиатор'], ['решетк']] },
  { en: 'SIDE MIRROR', ru: [['зеркал'], ['боков', 'зеркал']] },
  { en: 'MIRROR GLASS', ru: [['стекл', 'зеркал'], ['зеркальн', 'элемент']] },
  { en: 'DOOR HANDLE', ru: [['ручк', 'двер']] },
  { en: 'WINDSHIELD', ru: [['лобов', 'стекл']] },
  { en: 'BONNET STRUT', ru: [['амортизатор', 'капот'], ['упор', 'капот']] },
  { en: 'TAILGATE STRUT', ru: [['амортизатор', 'багажник'], ['упор', 'багажник']] },
  { en: 'FUEL CAP', ru: [['крышк', 'бензобак'], ['крышк', 'бак'], ['крышк', 'топливн', 'бак']] },
  { en: 'DOOR', ru: [['двер']] },
  // Wheels and tyres
  { en: 'TYRE', ru: [['шин'], ['покрышк'], ['резин']] },
  { en: 'WHEEL RIM', ru: [['колесн', 'диск'], ['лит', 'диск']] },
  { en: 'WHEEL NUT', ru: [['гайк', 'колес']] },
  { en: 'WHEEL BOLT', ru: [['болт', 'колес']] },
  { en: 'TPMS SENSOR', ru: [['датчик', 'давлен', 'шин']] },
  // Fluids and small things
  { en: 'WINDSHIELD WASHER FLUID', ru: [['жидкост', 'омывател'], ['омывайк']] },
  { en: 'GREASE', ru: [['смазк']] },
  { en: 'BRAKE CLEANER', ru: [['очистител', 'тормоз']] },
  { en: 'HYBRID BATTERY', ru: [['гибридн', 'батаре'], ['высоковольтн', 'батаре'], ['гибридн', 'аккумулятор']] },
];

/** English words spelt two ways, and words meaning the same on an invoice. */
const EN_ALIAS: Record<string, string> = { disk: 'disc', rotor: 'disc', tire: 'tyre', hood: 'bonnet', windscreen: 'windshield', absorber: 'absorber', shocks: 'shock', damper: 'absorber', dampers: 'absorber', pulley: 'pulley', ac: 'ac', 'a/c': 'ac', aircon: 'ac', airconditioning: 'ac', lamp: 'light', lamps: 'light', bulbs: 'bulb', plugs: 'plug', trans: 'transmission', gear: 'gearbox', antifreeze: 'coolant' };
/** Side and kit words: allowed beside a name, said after it. */
const EN_MODS: Record<string, string> = { lh: 'LH', left: 'LH', rh: 'RH', right: 'RH', kit: 'KIT', set: 'SET', pair: 'SET', pcs: '', pc: '', x2: '', x4: '', '2pcs': '', '4pcs': '' };
const RU_MODS: [stem: string, mod: string][] = [['лев', 'LH'], ['прав', 'RH'], ['комплект', 'KIT'], ['набор', 'SET'], ['шт', ''], ['пар', 'SET']];

/** An English word in its singular, aliases folded. */
function enWord(w: string): string {
  let x = w.toLowerCase();
  if (EN_ALIAS[x]) return EN_ALIAS[x];
  if (x.length > 3 && !x.endsWith('ss')) {
    if (x.endsWith('ies')) x = `${x.slice(0, -3)}y`;
    else if (/(sh|ch|x|s)es$/.test(x)) x = x.slice(0, -2);
    else if (x.endsWith('s')) x = x.slice(0, -1);
  }
  return EN_ALIAS[x] ?? x;
}

/** The known English words (the names' words, singular) and the known Russian stems. */
const EN_WORDS = new Set<string>(V.flatMap((e) => e.en.toLowerCase().split(' ').map(enWord)));
const RU_STEMS = [...new Set(V.flatMap((e) => e.ru.flat()))];

const cyr = (s: string) => /[а-яё]/i.test(s);
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
/** How many letters off a typed word may be from a known one: one in a word of 5–8, two from 9 — none in a short one. */
const slack = (len: number) => (len >= 9 ? 2 : len >= 5 ? 1 : 0);

/** The known English word a typed word is, exactly or a letter or two off; '' when none. */
function nearEn(typed: string): { word: string; exact: boolean } {
  const w = enWord(typed);
  if (EN_WORDS.has(w)) return { word: w, exact: true };
  let best = '';
  let bestD = 3;
  for (const k of EN_WORDS) {
    if (Math.abs(k.length - w.length) > 2) continue;
    const d = editDistance(w, k);
    if (d < bestD && d <= slack(Math.max(w.length, k.length))) {
      best = k;
      bestD = d;
    }
  }
  return { word: best, exact: false };
}

/**
 * The known Russian stem a typed word begins with — exactly, or a letter or two off within the stem (the ending is
 * left as typed); '' when none. `fixed` — the word with its stem put right.
 */
function nearRu(typed: string): { stem: string; exact: boolean; fixed: string } {
  const w = norm(typed);
  const exact = RU_STEMS.filter((s) => w.startsWith(s)).sort((a, b) => b.length - a.length)[0];
  if (exact) return { stem: exact, exact: true, fixed: typed };
  // A fleeting vowel («колодок», «прокладок», «гаек»): the stem with one vowel more inside is the word's own form, not
  // a mistake — the stem is known, the word stays as typed.
  for (const s of RU_STEMS) {
    if (w.length <= s.length) continue;
    const i = [...s].findIndex((ch, k) => w[k] !== ch);
    if (i > 0 && /[аеёиоуыэюя]/.test(w[i]) && w.slice(0, i) + w.slice(i + 1, s.length + 1) === s) return { stem: s, exact: true, fixed: typed };
  }
  let best = '';
  let bestD = 3;
  let cut = 0;
  for (const s of RU_STEMS) {
    if (s.length < 5 || w.length < s.length - 1) continue;
    // A letter dropped or added inside the stem shifts the ending by one: the stem is tried against the word's first
    // n letters for n a letter shorter and longer too; the ending starts where the stem fits best.
    for (const n of [s.length, s.length - 1, s.length + 1]) {
      if (n > w.length) continue;
      const d = editDistance(w.slice(0, n), s);
      if (d < bestD && d <= slack(s.length)) {
        best = s;
        bestD = d;
        cut = n;
      }
    }
  }
  if (!best) return { stem: '', exact: false, fixed: typed };
  return { stem: best, exact: false, fixed: best + w.slice(cut) };
}

export interface PartNameMatch {
  /** The name as typed with its typing mistakes put right (in capitals, the typed language); the typed name when none. */
  fixed: string;
  /** The English name from the dictionary, with the side/kit words typed («FRONT BRAKE PADS LH»); '' when the words name no part of it. */
  english: string;
  /** Every word was known (exactly or a letter or two off). */
  known: boolean;
  /** Something was put right. */
  changed: boolean;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * A typed part name against the dictionary: its words put right and its English name — or nothing it knows (`known`
 * false: the AI's turn). Numbers, sizes and codes in the name are left as typed and name no part («TYRE 265/65 R17»
 * is still a tyre).
 */
export function matchPartName(typed: string): PartNameMatch {
  const words = typed.trim().split(/\s+/).filter(Boolean);
  const none: PartNameMatch = { fixed: lineName(typed.trim()), english: '', known: false, changed: false };
  if (!words.length) return none;
  const russian = cyr(typed);
  const fixedWords: string[] = [];
  /** Each word's part in the name: a key word (its stem / English word), a side or kit word (`mod`), or both («комплект» names a kit and is one). */
  const parts: { key?: string; mod?: string }[] = [];
  let changed = false;
  for (const w of words) {
    if (/\d/.test(w) || /^[a-z]$/i.test(w)) {
      fixedWords.push(w);
      continue;
    }
    if (russian && cyr(w)) {
      const mod = RU_MODS.find(([stem]) => norm(w).startsWith(stem))?.[1];
      const r = nearRu(w);
      if (!r.stem && mod === undefined) return none;
      if (r.stem && !r.exact) changed = true;
      fixedWords.push(r.stem ? r.fixed : w);
      parts.push({ key: r.stem || undefined, mod });
    } else {
      const lw = w.toLowerCase();
      const mod = lw in EN_MODS ? EN_MODS[lw] : undefined;
      const r = mod === undefined ? nearEn(w) : { word: EN_WORDS.has(enWord(lw)) ? enWord(lw) : '', exact: true };
      if (!r.word && mod === undefined) return none;
      if (r.word && !r.exact) changed = true;
      fixedWords.push(r.word && !r.exact ? r.word : w);
      parts.push({ key: r.word || undefined, mod });
    }
  }
  const find = (keys: string[]) =>
    keys.length ? V.find((e) => (russian ? e.ru.some((set) => sameSet(set, keys)) : sameSet(e.en.toLowerCase().split(' ').map(enWord), keys))) : undefined;
  // First with every word as part of the name («комплект сцепления» is CLUTCH KIT), then with the side and kit words
  // taken out and said after it («фара левая» is HEADLIGHT LH).
  let entry = find(parts.flatMap((p) => (p.key ? [p.key] : [])));
  let used = (p: { key?: string; mod?: string }) => !!p.key;
  if (!entry) {
    entry = find(parts.flatMap((p) => (p.key && p.mod === undefined ? [p.key] : [])));
    used = (p) => !!p.key && p.mod === undefined;
  }
  // A side or kit word that did not go into the name is said after it.
  const mods = [...new Set(parts.flatMap((p) => (p.mod && !used(p) ? [p.mod] : [])))];
  // The words as typed, each put right where it was wrong — never reordered or renamed (that is the manager's wording).
  const fixed = lineName(fixedWords.join(' '));
  const english = entry ? lineName([entry.en, ...mods.filter((m) => !entry!.en.split(' ').includes(m))].join(' ')) : '';
  return { fixed, english, known: true, changed };
}

/** The dictionary's English name of a part, for matching one line with another («колодки передние» and «FRONT BRAKE PADS» are one part). */
export function partKey(name: string): string {
  const m = matchPartName(name);
  return (m.english || m.fixed).replace(/\s+(LH|RH|KIT|SET)$/g, '').trim();
}
