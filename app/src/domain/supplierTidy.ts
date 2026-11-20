import { canonicalMake } from './carCatalog';
import type { Emirate, Supplier } from './types';

/*
 * The supplier base put in order (v0.60, the user: «больше 1000 контактов поставщиков… по регионам разделены… фильтр по
 * маркам»; «название многих магазинов на арабском, перевести всех на английский»; «какие запчасти продают — во многих
 * неизвестно, постарайся угадать из названия магазина»). Pure rules, no AI and no network:
 *  - where a supplier is — its emirate and area, from the base's own columns, the address, the name, a landline's code;
 *  - its name in English — the English already beside the Arabic, else the trade's words by a dictionary and the rest
 *    spelled in Latin letters (the Arabic is kept: `Supplier.nameAr`);
 *  - what it sells and for which makes — by the words in its name and categories; a guess, marked as one
 *    (`Supplier.guessed`), only where nothing was known.
 */

/* ---------------- Region ---------------- */

export interface Region {
  emirate?: Emirate;
  /** A known area of it ("Al Quoz", "Industrial Area 4", "Mussafah"). */
  area?: string;
}

/** The emirate a word names (English, Arabic, Russian). */
const EMIRATE_WORDS: [Emirate, RegExp][] = [
  ['AUH', /abu\s*dhabi|ابوظبي|ابو ظبي|أبوظبي|أبو ظبي|абу-?\s*даби/i],
  ['RAK', /ras\s*al\s*khaimah|\bRAK\b|رأس الخيمة|راس الخيمة|рас-?\s*эль-?\s*хайм/i],
  ['UAQ', /umm\s*al\s*quwain|\bUAQ\b|أم القيوين|ام القيوين|умм-?\s*эль/i],
  ['FUJ', /fujairah|الفجيرة|фуджейр/i],
  ['AJM', /ajman|عجمان|аджман/i],
  ['SHJ', /sharjah|\bSHJ\b|الشارقة|шардж/i],
  ['DXB', /dubai|\bDXB\b|دبي|дубай/i],
];

/** Areas the trade knows, each in its emirate (named before "Industrial Area N": Dubai has industrial areas too). */
const AREAS: { area: string; emirate: Emirate; re: RegExp }[] = [
  { area: 'Al Quoz', emirate: 'DXB', re: /al\s*quoz|القوز/i },
  { area: 'Al Qusais', emirate: 'DXB', re: /qusais|damascus\s*st|القصيص/i },
  {
    area: 'Ras Al Khor',
    emirate: 'DXB',
    re: /ras\s*al\s*khor|راس الخور|رأس الخور/i,
  },
  { area: 'Deira', emirate: 'DXB', re: /deira|ديرة|naif|نايف/i },
  { area: 'Bur Dubai', emirate: 'DXB', re: /bur\s*dubai|بر دبي/i },
  { area: 'Karama', emirate: 'DXB', re: /karama|الكرامة/i },
  { area: 'Jebel Ali', emirate: 'DXB', re: /jebel\s*ali|jabal\s*ali|جبل علي/i },
  { area: 'Al Aweer', emirate: 'DXB', re: /aweer|awir|العوير/i },
  { area: 'Muhaisnah', emirate: 'DXB', re: /muhaisnah|muhaisna|محيصنة/i },
  { area: 'Al Khabaisi', emirate: 'DXB', re: /khabaisi|الخبيصي/i },
  { area: 'Port Saeed', emirate: 'DXB', re: /port\s*saeed|بور سعيد/i },
  { area: 'Garhoud', emirate: 'DXB', re: /garhoud|القرهود/i },
  { area: 'Umm Ramool', emirate: 'DXB', re: /umm\s*ramool|ام رمول|أم رمول/i },
  { area: 'Nad Al Hamar', emirate: 'DXB', re: /nad\s*al\s*hamar|ند الحمر/i },
  { area: 'Al Satwa', emirate: 'DXB', re: /satwa|السطوة/i },
  { area: 'Al Barsha', emirate: 'DXB', re: /barsha|البرشاء/i },
  {
    area: 'Dubai Investment Park',
    emirate: 'DXB',
    re: /\bDIP\b|investment\s*park/i,
  },
  { area: 'Al Warsan', emirate: 'DXB', re: /warsan|ورسان/i },
  { area: 'Hor Al Anz', emirate: 'DXB', re: /hor\s*al\s*anz|هور العنز/i },
  { area: 'Abu Hail', emirate: 'DXB', re: /abu\s*hail|ابو هيل/i },
  { area: 'Al Twar', emirate: 'DXB', re: /\btwar\b|الطوار/i },
  { area: 'Muwaileh', emirate: 'SHJ', re: /muwail[ia]h|مويلح/i },
  { area: 'Al Sajaa', emirate: 'SHJ', re: /saj['’]?a+|الصجعة/i },
  { area: 'Al Khan', emirate: 'SHJ', re: /al\s*khan\b|الخان/i },
  { area: 'Maysaloon', emirate: 'SHJ', re: /maysaloon|ميسلون/i },
  { area: 'Abu Shagara', emirate: 'SHJ', re: /abu\s*shag+ara|ابو شغارة/i },
  { area: 'Al Majaz', emirate: 'SHJ', re: /majaz|المجاز/i },
  { area: 'Al Qasimia', emirate: 'SHJ', re: /qasimi[ay]|القاسمية/i },
  { area: 'Rolla', emirate: 'SHJ', re: /\brolla\b|الرولة/i },
  { area: 'BMW Road', emirate: 'SHJ', re: /bmw\s*r(?:oa)?d/i },
  { area: 'Al Hamriyah', emirate: 'SHJ', re: /hamriyah|الحمرية/i },
  { area: 'Al Jurf', emirate: 'AJM', re: /al\s*jurf|الجرف/i },
  { area: 'Mussafah', emirate: 'AUH', re: /mus+af+ah|مصفح/i },
  { area: 'Mafraq', emirate: 'AUH', re: /mafraq|المفرق/i },
  { area: 'Al Ain', emirate: 'AUH', re: /al\s*ain\b|العين/i },
  { area: 'Al Nakheel', emirate: 'RAK', re: /nakheel|النخيل/i },
];

/** «Industrial Area 4», «Ind. Area No. 11», «الصناعية 6». */
const INDUSTRIAL = /ind(?:ustrial|\.)?\s*(?:area)?\s*(?:no\.?\s*)?(\d{1,2})\b|الصناعية\s*(\d{1,2})/i;

/** A landline's code: 04 Dubai, 02 and 03 Abu Dhabi (Al Ain), 07 Ras Al Khaimah, 09 Fujairah (06 — three emirates). */
function emirateOfPhone(phone?: string): Emirate | undefined {
  const m = /^\+971([23479])\d{7}$/.exec((phone ?? '').replace(/[^\d+]/g, ''));
  return m ? ({ '4': 'DXB', '2': 'AUH', '3': 'AUH', '7': 'RAK', '9': 'FUJ' } as const)[m[1] as '4'] : undefined;
}

/** The emirate a text names first (its earliest mention: «near Dubai–Sharjah road» is Dubai). */
function emirateIn(text: string): Emirate | undefined {
  let best: { e: Emirate; at: number } | undefined;
  for (const [e, re] of EMIRATE_WORDS) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.at)) best = { e, at: m.index };
  }
  return best?.e;
}

type RegionInput = Pick<Supplier, 'name' | 'address' | 'phone' | 'notes'> & {
  nameAr?: string;
  book?: Supplier['book'];
};

/** Where a supplier is: its emirate and, when known, its area. */
export function regionOf(s: RegionInput): Region {
  const cell = (k: string) => s.book?.contact?.[k]?.v ?? '';
  const said = emirateIn(cell('Эмират'));
  const text = [cell('Геозона'), cell('Район / адрес'), s.address, s.name, s.nameAr].filter(Boolean).join(' · ');
  const known = AREAS.find((a) => a.re.test(text));
  if (known && (!said || said === known.emirate)) return { emirate: known.emirate, area: known.area };
  const emirate = said ?? emirateIn(text) ?? emirateOfPhone(s.phone);
  const ind = INDUSTRIAL.exec(text);
  // An industrial area by number alone is Sharjah's (Dubai's are named: Al Qusais, Al Quoz, Ras Al Khor).
  if (ind && (!emirate || emirate === 'SHJ'))
    return {
      emirate: 'SHJ',
      area: `Industrial Area ${Number(ind[1] ?? ind[2])}`,
    };
  return emirate ? { emirate } : {};
}

/* ---------------- The name in English ---------------- */

const ARABIC = /[؀-ۿ]/;
export const hasArabic = (s: string) => ARABIC.test(s);

type Role = 'name' | 'origin' | 'auto' | 'what' | 'trade' | 'legal' | 'place' | 'skip';
/** Each role's place in an English name: «Al Barakah · Genuine · Auto · Spare Parts · Trading · LLC · Branch Dubai». */
const ORDER: Role[] = ['name', 'origin', 'auto', 'what', 'trade', 'legal', 'place'];

/** Arabic letters evened: no vowel marks or stretch, one alef, ة as ه, ى as ي. */
const evenAr = (w: string) => w.replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');

/** The trade's words (evened, without «ال»): English and their place. */
const WORDS: Record<string, [string, Role]> = {};
const add = (role: Role, en: string, ...ar: string[]) => ar.forEach((w) => (WORDS[evenAr(w)] = [en, role]));
add('what', 'Spare Parts', 'قطع غيار', 'قطع الغيار');
add('what', 'Parts', 'قطع');
add('what', 'Spare', 'غيار');
add('auto', 'Auto', 'سيارات', 'سياره', 'اوتو', 'اتو');
add('what', 'Accessories', 'اكسسوارات', 'إكسسوارات', 'زينه', 'زينة');
add('what', 'Batteries', 'بطاريات', 'بطاريه');
add('what', 'Tyres', 'اطارات', 'إطارات', 'تواير', 'كفرات');
add('what', 'Glass', 'زجاج');
add('what', 'Radiators', 'رديترات', 'رديتر', 'رادياتير', 'راديتر', 'ردياتير');
add('what', 'AC', 'تكييف', 'مكيفات', 'تبريد');
add('what', 'Engines', 'محركات', 'مكاين', 'مكائن', 'مكينه');
add('what', 'Gearbox', 'جير', 'قير', 'جيربوكس', 'قيربوكس');
add('what', 'Electrical', 'كهرباء', 'كهربائيات', 'كهربا');
add('what', 'Lights', 'اضواء', 'أضواء', 'انوار', 'انارة', 'إنارة', 'فوانيس');
add('what', 'Oils', 'زيوت', 'زيت');
add('what', 'Equipment', 'معدات');
add('what', 'Tools', 'ادوات', 'أدوات');
add('what', 'Fitting', 'تركيب');
add('what', 'Repair', 'تصليح', 'اصلاح', 'إصلاح');
add('what', 'Maintenance', 'صيانه', 'صيانة');
add('what', 'Garage', 'ورشه', 'ورشة', 'كراج', 'جراج');
add('what', 'Center', 'مركز');
add('what', 'Showroom', 'معرض');
add('what', 'Scrap', 'سكراب', 'تشليح');
add('what', 'Shop', 'محل');
add('what', 'Store', 'مخزن', 'متجر');
add('what', 'Warehouse', 'مستودع');
add('what', 'Brakes', 'فرامل', 'بريك');
add('what', 'Suspension', 'مساعدات', 'تعليق');
add('what', 'Body Parts', 'بودي', 'هياكل');
add('what', 'Exhaust', 'شكمان', 'عوادم', 'اكزوست');
add('what', 'Keys', 'مفاتيح');
add('what', 'Paint', 'اصباغ', 'أصباغ', 'دهانات', 'صبغ');
add('origin', 'Used', 'مستعمله', 'مستعمل', 'مستعملة');
add('origin', 'New', 'جديده', 'جديد', 'جديدة');
add('origin', 'Genuine', 'اصليه', 'اصلي', 'أصلية', 'أصلي', 'اصلية');
add('origin', 'Korean', 'كوريه', 'كوري', 'كورية');
add('origin', 'Japanese', 'يابانيه', 'ياباني', 'يابانية');
add('origin', 'German', 'المانيه', 'الماني', 'ألمانية', 'ألماني');
add('origin', 'American', 'امريكيه', 'امريكي', 'أمريكية', 'أمريكي');
add('origin', 'Chinese', 'صينيه', 'صيني', 'صينية');
add('origin', 'European', 'اوروبيه', 'اوروبي', 'أوروبية', 'أوروبي');
add('origin', 'Modern', 'حديثه', 'حديث', 'حديثة');
add('origin', 'International', 'دوليه', 'دولي', 'عالميه', 'عالمي', 'دولية', 'عالمية');
add('origin', 'National', 'وطنيه', 'وطني', 'وطنية');
add('origin', 'United', 'متحده', 'متحدة');
add('origin', 'Golden', 'ذهبي', 'ذهبيه', 'ذهبية');
add('origin', 'Premium', 'ممتاز', 'ممتازه');
add('origin', 'Toyota', 'تويوتا');
add('origin', 'Lexus', 'لكزس');
add('origin', 'Nissan', 'نيسان');
add('origin', 'Infiniti', 'انفينيتي', 'إنفينيتي');
add('origin', 'Mitsubishi', 'ميتسوبيشي', 'متسوبيشي');
add('origin', 'Honda', 'هوندا');
add('origin', 'Mazda', 'مازدا');
add('origin', 'Suzuki', 'سوزوكي');
add('origin', 'Hyundai', 'هيونداي', 'هونداي', 'هيوندا');
add('origin', 'Kia', 'كيا');
add('origin', 'Mercedes', 'مرسيدس');
add('origin', 'Benz', 'بنز');
add('origin', 'BMW', 'بي ام دبليو', 'بي إم دبليو');
add('origin', 'Audi', 'اودي', 'أودي');
add('origin', 'Volkswagen', 'فولكس واجن', 'فولكسفاجن', 'فولكس');
add('origin', 'Porsche', 'بورش', 'بورشه');
add('origin', 'Land Rover', 'لاند روفر');
add('origin', 'Range Rover', 'رنج روفر', 'رينج روفر');
add('origin', 'Ford', 'فورد');
add('origin', 'Chevrolet', 'شفروليه', 'شيفروليه', 'شفرليت', 'شيفي');
add('origin', 'GMC', 'جي ام سي', 'جمس');
add('origin', 'Jeep', 'جيب');
add('origin', 'Dodge', 'دودج');
add('origin', 'Chrysler', 'كرايسلر');
add('origin', 'Cadillac', 'كاديلاك');
add('origin', 'Lincoln', 'لينكولن');
add('origin', 'Peugeot', 'بيجو');
add('origin', 'Renault', 'رينو');
add('origin', 'Volvo', 'فولفو');
add('origin', 'MG', 'ام جي');
add('origin', 'Geely', 'جيلي');
add('origin', 'Chery', 'شيري');
add('trade', 'Trading', 'تجاره', 'تجارة', 'تجاريه', 'تجارية');
add('legal', 'Est.', 'مؤسسه', 'مؤسسة');
add('legal', 'Co.', 'شركه', 'شركة');
add('legal', 'LLC', 'ذمم');
add('place', 'Branch', 'فرع');
add('place', 'Dubai', 'دبي');
add('place', 'Sharjah', 'شارقه', 'شارقة');
add('place', 'Ajman', 'عجمان');
add('place', 'Abu Dhabi', 'ابوظبي', 'ابو ظبي');
add('place', 'Ras Al Khaimah', 'راس الخيمه', 'رأس الخيمة');
add('place', 'Umm Al Quwain', 'ام القيوين');
add('place', 'Fujairah', 'فجيره', 'فجيرة');
add('name', 'Emirates', 'امارات');
add('place', 'UAE', 'الامارات العربيه المتحده');
add('skip', '', 'و', 'في', 'من', 'الى', 'إلى', 'على');
/** Proper names the trade often takes («البركة» — Al Barakah): spelled as people spell them, not letter by letter. */
const NAMES: Record<string, string> = {};
const names = (pairs: [string, string][]) => pairs.forEach(([ar, en]) => (NAMES[evenAr(ar)] = en));
names([
  ['بركه', 'Barakah'],
  ['نور', 'Noor'],
  ['امل', 'Amal'],
  ['نجمه', 'Najma'],
  ['خليج', 'Khaleej'],
  ['سلام', 'Salam'],
  ['فجر', 'Fajr'],
  ['شرق', 'Sharq'],
  ['هلال', 'Hilal'],
  ['نخبه', 'Nukhba'],
  ['ماسه', 'Masa'],
  ['رياض', 'Riyadh'],
  ['صقر', 'Saqr'],
  ['اسد', 'Asad'],
  ['نسر', 'Nisr'],
  ['فارس', 'Faris'],
  ['محمد', 'Mohammed'],
  ['احمد', 'Ahmed'],
  ['علي', 'Ali'],
  ['عبدالله', 'Abdullah'],
  ['خالد', 'Khalid'],
  ['حسن', 'Hassan'],
  ['حسين', 'Hussain'],
  ['سعيد', 'Saeed'],
  ['راشد', 'Rashid'],
  ['سالم', 'Salem'],
  ['عمر', 'Omar'],
  ['يوسف', 'Yousef'],
  ['ابراهيم', 'Ibrahim'],
  ['عبد', 'Abdul'],
  ['بن', 'Bin'],
  ['ابو', 'Abu'],
  ['دار', 'Dar'],
  ['بيت', 'Bait'],
  ['ركن', 'Rukn'],
  ['جسر', 'Jisr'],
  ['نهده', 'Nahda'],
  ['قمه', 'Qimma'],
  ['وادي', 'Wadi'],
  ['بحر', 'Bahar'],
  ['جبل', 'Jabal'],
  ['زين', 'Zain'],
  ['رواد', 'Rowad'],
  ['ريم', 'Reem'],
  ['وفاء', 'Wafa'],
  ['اخوه', 'Brothers'],
  ['اخوان', 'Brothers'],
  ['علامه', 'Mark'],
  ['اتحاد', 'Ittihad'],
  ['ثقه', 'Thiqa'],
  ['اصيل', 'Aseel'],
  ['مستقبل', 'Mustaqbal'],
  ['ريان', 'Rayyan'],
  ['واحه', 'Waha'],
  ['جزيره', 'Jazeera'],
  ['قصر', 'Qasr'],
  ['صحراء', 'Sahara'],
  ['منار', 'Manar'],
  ['فيصل', 'Faisal'],
  ['ناصر', 'Nasser'],
  ['مصطفى', 'Mustafa'],
  ['طارق', 'Tariq'],
  ['عادل', 'Adel'],
  ['جمال', 'Jamal'],
  ['كريم', 'Karim'],
  ['امير', 'Amir'],
  ['ملك', 'Malik'],
  ['سيف', 'Saif'],
  ['حمد', 'Hamad'],
  ['زايد', 'Zayed'],
  ['مكتوم', 'Maktoum'],
  ['شيخ', 'Sheikh'],
  ['اوائل', 'Awael'],
  ['تميز', 'Tamayuz'],
  ['ابداع', 'Ibdaa'],
]);

/** Letters in Latin, as names are spelled in the Emirates (a vowel where the Arabic writes none, between two consonants). */
const LETTER: Record<string, string> = {
  ا: 'a',
  ب: 'b',
  ت: 't',
  ث: 'th',
  ج: 'j',
  ح: 'h',
  خ: 'kh',
  د: 'd',
  ذ: 'dh',
  ر: 'r',
  ز: 'z',
  س: 's',
  ش: 'sh',
  ص: 's',
  ض: 'd',
  ط: 't',
  ظ: 'z',
  ع: 'a',
  غ: 'gh',
  ف: 'f',
  ق: 'q',
  ك: 'k',
  ل: 'l',
  م: 'm',
  ن: 'n',
  ه: 'h',
  و: 'w',
  ي: 'y',
  ء: '',
  ئ: 'e',
  ؤ: 'o',
  پ: 'p',
  گ: 'g',
  چ: 'ch',
  ڤ: 'v',
};
function spell(word: string): string {
  const w = evenAr(word);
  let out = '';
  for (let i = 0; i < w.length; i++) {
    const c = w[i];
    const prev = w[i - 1];
    const next = w[i + 1];
    const vowelish = (x?: string) => x === 'ا' || x === 'و' || x === 'ي';
    if (c === 'ه' && i === w.length - 1) {
      out += i > 0 ? 'a' : 'h';
      continue;
    }
    if (c === 'و') out += i === 0 || vowelish(next) ? 'w' : 'o';
    else if (c === 'ي') out += i === 0 || vowelish(next) ? 'y' : 'i';
    else if (c === 'ع' && i > 0) out += vowelish(prev) ? '' : 'a';
    else out += LETTER[c] ?? '';
    // a vowel between two consonants (Arabic writes no short vowels)
    if (i < w.length - 1 && !vowelish(c) && c !== 'ع' && !vowelish(next) && !(next === 'ه' && i + 1 === w.length - 1)) out += 'a';
  }
  out = out.replace(/a{2,}/g, 'a');
  return out ? out[0].toUpperCase() + out.slice(1) : '';
}

/** A word read: what it is in English and its place; «ال» and the small words before it (و, ل, لل, ب) taken off first. */
function readWord(raw: string): {
  en: string;
  role: Role;
  the: boolean;
  fixed?: boolean;
} {
  const w = evenAr(raw);
  const tries: { s: string; the: boolean }[] = [{ s: w, the: false }];
  const bare = w.startsWith('و') && w.length > 3 ? w.slice(1) : w;
  if (bare !== w) tries.push({ s: bare, the: false });
  for (const b of [w, bare]) {
    if (b.startsWith('لل') && b.length > 3) tries.push({ s: b.slice(2), the: true });
    if (b.startsWith('ال') && b.length > 3) tries.push({ s: b.slice(2), the: true });
    if (b.startsWith('بال') && b.length > 4) tries.push({ s: b.slice(3), the: true });
    if ((b.startsWith('ل') || b.startsWith('ب')) && b.length > 3) tries.push({ s: b.slice(1), the: false });
  }
  for (const t of tries) {
    const hit = WORDS[t.s];
    if (hit) return { en: hit[0], role: hit[1], the: t.the, fixed: true };
    if (NAMES[t.s]) return { en: NAMES[t.s], role: 'name', the: t.the };
  }
  const the = w.startsWith('ال') && w.length > 3;
  return { en: spell(the ? w.slice(2) : w), role: 'name', the };
}

/** Arabic words in English, the trade's order: the name, what kind, «Auto», what it sells, «Trading», «LLC». */
export function arabicToEnglish(text: string): string {
  const legal = /(?:ش\s*\.?\s*)?ذ\s*\.?\s*م\s*\.?\s*م\s*\.?/g;
  const hasLlc = legal.test(text);
  const words = text
    .replace(legal, ' ')
    .split(/[\s,.;:|/\\()\-–—_"'«»]+/)
    .filter((w) => ARABIC.test(w));
  const by: Record<Role, string[]> = {
    name: [],
    origin: [],
    auto: [],
    what: [],
    trade: [],
    legal: [],
    place: [],
    skip: [],
  };
  for (let i = 0; i < words.length; i++) {
    // two words that are one («قطع غيار», «لاند روفر», «بي ام دبليو»): the longest first
    let took = 0;
    for (const n of [3, 2]) {
      if (i + n > words.length) continue;
      const joined = words.slice(i, i + n).join(' ');
      const r = readWord(joined);
      if (WORDS[evenAr(joined)] || WORDS[evenAr(joined).replace(/^(لل|ال|ل)/, '')]) {
        by[r.role].push(r.en);
        took = n;
        break;
      }
    }
    if (took) {
      i += took - 1;
      continue;
    }
    const r = readWord(words[i]);
    if (r.role === 'skip' || !r.en) continue;
    // «Al» before a proper name, not before a word the trade knows («الامارات» — Emirates)
    by[r.role].push(r.role === 'name' && r.the && !r.fixed ? `Al ${r.en}` : r.en);
  }
  if (hasLlc) by.legal.push('LLC');
  // «Spare» and «Parts» apart are «Spare Parts»
  if (by.what.includes('Spare') && by.what.includes('Parts')) by.what = by.what.filter((w) => w !== 'Spare' && w !== 'Parts').concat('Spare Parts');
  const out: string[] = [];
  for (const role of ORDER) for (const w of by[role]) if (out[out.length - 1] !== w && !out.includes(w)) out.push(w);
  return out.join(' ').trim();
}

/**
 * A supplier's name in English: as it is when it has no Arabic; the English beside the Arabic when there is one («SDM
 * Auto اس دي ام اوتو» → «SDM Auto»); else the Arabic in English (`arabicToEnglish`).
 */
export function englishName(name: string): string {
  if (!hasArabic(name)) return name.trim();
  const latin = name
    .replace(/[؀-ۿ]+/g, ' ')
    .replace(/\s*[|–—-]\s*(?=\s*$)/, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s|,.;:\-–—()]+|[\s|,;:\-–—(]+$/g, '')
    .trim();
  if ((latin.match(/[A-Za-z]/g) ?? []).length >= 3) return latin;
  return arabicToEnglish(name) || name.trim();
}

/* ---------------- What it sells, for which makes ---------------- */

/** Kinds of parts and services, by the words for them (English, Arabic, Russian) — a filter and a guess alike. */
export const PART_KINDS: { key: string; en: string; re: RegExp }[] = [
  {
    key: 'engine',
    en: 'Engines',
    re: /engine|motor|محرك|مكائن|مكاين|مكينة|двигат|мотор/i,
  },
  {
    key: 'gearbox',
    en: 'Gearboxes',
    re: /gear\s*box|transmission|\bgear\b|قير|جير|кпп|коробк|трансмис/i,
  },
  {
    key: 'body',
    en: 'Body parts',
    re: /body|bumper|bonnet|fender|بودي|صدام|هيكل|кузов|бампер/i,
  },
  {
    key: 'lights',
    en: 'Lights',
    re: /light|lamp|اضواء|أضواء|انارة|إنارة|فوانيس|انوار|фар|свет/i,
  },
  {
    key: 'electrical',
    en: 'Electrical',
    re: /electric|ecm|sensor|كهرب|электр|датчик/i,
  },
  {
    key: 'ac',
    en: 'AC & cooling',
    re: /\ba\/?c\b|air\s*con|cooling|radiator|تكييف|تبريد|رديتر|رادياتير|кондиц|радиатор|охлажд/i,
  },
  {
    key: 'suspension',
    en: 'Suspension & brakes',
    re: /suspension|shock|brake|steering|مساعد|فرامل|ходов|подвеск|тормоз|рулев/i,
  },
  {
    key: 'batteries',
    en: 'Batteries',
    re: /batter|بطاري|аккумул|(?:^|[^а-я])акб(?![а-я])/i,
  },
  {
    key: 'tyres',
    en: 'Tyres & wheels',
    re: /tyre|tire|wheel|\brims?\b|اطار|إطار|تواير|كفرات|шин|диск/i,
  },
  { key: 'glass', en: 'Glass', re: /glass|windshield|زجاج|стекл/i },
  {
    key: 'oils',
    en: 'Oils & fluids',
    re: /\boils?\b|lubric|زيوت|زيت|масл|химия/i,
  },
  { key: 'filters', en: 'Filters', re: /filter|فلتر|фильтр/i },
  {
    key: 'exhaust',
    en: 'Exhaust',
    re: /exhaust|muffler|silencer|شكمان|عادم|выхлоп|глушит/i,
  },
  {
    key: 'accessories',
    en: 'Accessories',
    re: /accessor|decor|زينة|زينه|اكسسوار|إكسسوار|аксессуар/i,
  },
  {
    key: 'keys',
    en: 'Keys',
    re: /\bkeys\b|locksmith|key\s*(?:cut|program|making|duplicat)|مفاتيح|ключ/i,
  },
  { key: 'paint', en: 'Paint', re: /paint|اصباغ|أصباغ|دهان|краск/i },
  {
    key: 'used',
    en: 'Used parts',
    re: /used|scrap|second\s*hand|salvage|مستعمل|سكراب|تشليح|б\/у|\bбу\b|разбор|металлолом/i,
  },
  {
    key: 'genuine',
    en: 'Genuine parts',
    re: /genuine|original|\boem\b|اصلي|أصلي|оригинал/i,
  },
];
/** A shop of spare parts at large (its kind not named). */
const SPARE = /spare|parts|auto\s*parts|قطع\s*غيار|قطع|запчаст/i;

/** The kinds a supplier is about — what it sells, its name, its categories in the base. */
export function kindsOf(
  s: Pick<Supplier, 'name' | 'parts'> & {
    nameAr?: string;
    book?: Supplier['book'];
  },
): string[] {
  const text = [s.parts, s.name, s.nameAr, s.book?.contact?.['Категории']?.v, s.book?.contact?.['Тип деталей']?.v].filter(Boolean).join(' · ');
  return PART_KINDS.filter((k) => k.re.test(text)).map((k) => k.key);
}

/** «What it sells» that says nothing: «неизвестно», «unknown», «—», «?». */
export const unknownParts = (v?: string) => !v || /^\s*(неизвестн\S*|не\s*известно|нет\s*данных|unknown|n\/?a|none|-+|—+|\?+|غير معروف)\s*\.?\s*$/i.test(v);

/** Makes of a kind: «Korean» is Hyundai and Kia. */
const MAKE_GROUPS: [RegExp, string[]][] = [
  [/korean|كوري|корейск/i, ['Hyundai', 'Kia']],
  [/japan|ياباني|японск/i, ['Toyota', 'Nissan', 'Mitsubishi', 'Honda', 'Mazda', 'Lexus']],
  [/german|الماني|ألماني|немецк/i, ['Mercedes-Benz', 'BMW', 'Audi', 'Volkswagen', 'Porsche']],
  [/american|امريكي|أمريكي|американск|сша/i, ['Ford', 'Chevrolet', 'GMC', 'Jeep', 'Dodge', 'Cadillac']],
  [/europe|اوروبي|أوروبي|европейск/i, ['Mercedes-Benz', 'BMW', 'Audi', 'Volkswagen', 'Land Rover', 'Volvo', 'Peugeot']],
  [/chinese|صيني|китайск/i, ['MG', 'Geely', 'Chery', 'Haval', 'Changan']],
];
/** Makes by name (English and Arabic) — a word of its own, not inside another («Kia» not in «Nikiah»). */
const MAKE_WORDS: [RegExp, string][] = [
  [/\btoyota\b|تويوتا/i, 'Toyota'],
  [/\blexus\b|لكزس/i, 'Lexus'],
  [/\bnissan\b|نيسان/i, 'Nissan'],
  [/\binfiniti\b|انفينيتي/i, 'Infiniti'],
  [/\bmitsubishi\b|ميتسوبيشي|متسوبيشي/i, 'Mitsubishi'],
  [/\bhonda\b|هوندا/i, 'Honda'],
  [/\bmazda\b|مازدا/i, 'Mazda'],
  [/\bsuzuki\b|سوزوكي/i, 'Suzuki'],
  [/\bhyundai\b|هيونداي/i, 'Hyundai'],
  [/\bkia\b|كيا/i, 'Kia'],
  [/\bmercedes\b|\bbenz\b|مرسيدس/i, 'Mercedes-Benz'],
  [/\bbmw\b|بي ام دبليو/i, 'BMW'],
  [/\baudi\b|اودي|أودي/i, 'Audi'],
  [/\bvolkswagen\b|\bvw\b|فولكس/i, 'Volkswagen'],
  [/\bporsche\b|بورش/i, 'Porsche'],
  [/\bland\s*rover\b|\brange\s*rover\b|لاند روفر|رنج روفر/i, 'Land Rover'],
  [/\bford\b|فورد/i, 'Ford'],
  [/\bchevrolet\b|\bchevy\b|شفروليه|شيفروليه/i, 'Chevrolet'],
  [/\bgmc\b|جمس/i, 'GMC'],
  [/\bjeep\b|جيب/i, 'Jeep'],
  [/\bdodge\b|دودج/i, 'Dodge'],
  [/\bcadillac\b|كاديلاك/i, 'Cadillac'],
  [/\bpeugeot\b|بيجو/i, 'Peugeot'],
  [/\brenault\b|رينو/i, 'Renault'],
  [/\bvolvo\b|فولفو/i, 'Volvo'],
  [/\bgeely\b|جيلي/i, 'Geely'],
  [/\bchery\b|شيري/i, 'Chery'],
  [/\bhaval\b|هافال/i, 'Haval'],
];

export interface Guess {
  parts?: string;
  makes?: string[];
  condition?: Supplier['condition'];
}

/**
 * What a supplier probably sells and for which makes, from its name (and the base's categories and make groups): only
 * what its words say — a shop of «spare parts» with nothing more is «Spare parts»; a name with no such word, nothing.
 */
export function guessFromName(s: Pick<Supplier, 'name'> & { nameAr?: string; book?: Supplier['book'] }): Guess {
  const cats = s.book?.contact?.['Категории']?.v ?? '';
  const group = s.book?.contact?.['Группа марок']?.v ?? '';
  const text = [s.name, s.nameAr, cats].filter(Boolean).join(' · ');
  const kinds = PART_KINDS.filter((k) => k.re.test(text) && k.key !== 'genuine' && k.key !== 'used');
  const used = PART_KINDS.find((k) => k.key === 'used')!.re.test(text);
  const genuine = PART_KINDS.find((k) => k.key === 'genuine')!.re.test(text);
  const parts = kinds.length ? kinds.map((k) => k.en).join(', ') : used ? 'Used parts' : SPARE.test(text) ? 'Spare parts' : undefined;
  const makes = new Set<string>();
  for (const [re, m] of MAKE_WORDS) if (re.test(text)) makes.add(canonicalMake(m));
  for (const [re, list] of MAKE_GROUPS) if (re.test(text) || re.test(group)) list.forEach((m) => makes.add(canonicalMake(m)));
  return {
    ...(parts ? { parts } : {}),
    ...(makes.size ? { makes: [...makes] } : {}),
    ...(used && genuine ? { condition: 'both' as const } : used ? { condition: 'used' as const } : genuine ? { condition: 'new' as const } : {}),
  };
}

/** What putting a supplier in order changes (only what it changes): its English name, its guessed parts, makes, condition. */
export function tidyOf(s: Supplier): Partial<Pick<Supplier, 'name' | 'nameAr' | 'parts' | 'makes' | 'condition' | 'guessed'>> | null {
  const out: Partial<Pick<Supplier, 'name' | 'nameAr' | 'parts' | 'makes' | 'condition' | 'guessed'>> = {};
  if (hasArabic(s.name)) {
    const en = englishName(s.name);
    if (en && en !== s.name) {
      out.name = en;
      out.nameAr = s.name;
    }
  }
  const g = guessFromName({
    name: s.name,
    nameAr: out.nameAr ?? s.nameAr,
    book: s.book,
  });
  const guessed = new Set(s.guessed ?? []);
  if (!s.service && unknownParts(s.parts) && g.parts) {
    out.parts = g.parts;
    guessed.add('parts');
  }
  if (!s.makes?.length && g.makes?.length) {
    out.makes = g.makes;
    guessed.add('makes');
  }
  if (!s.condition && g.condition) {
    out.condition = g.condition;
    guessed.add('condition');
  }
  if (guessed.size !== (s.guessed?.length ?? 0)) out.guessed = [...guessed];
  return Object.keys(out).length ? out : null;
}
