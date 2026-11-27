/*
 * A customer's answer to the quote, read without the AI (audit 27/11: the quote ends «Reply “YES” to approve, or tell us
 * which items you do not want» — and the manager read every answer and tapped «Согласен» himself). Only what the words
 * say for sure becomes a proposal; the manager's one tap decides (nothing is agreed by itself):
 *  - «yes / ok / go ahead / تمام / ماشي / haan / да / делайте» — all the lines;
 *  - «no / not now / لا / нет / не надо» — none;
 *  - «option 2 / вариант 2 / 2» (when options were sent) — that option;
 *  - «only the pads», «without discs», «no discs», «без дисков», «только колодки» — some of the lines, by their names;
 *  - a question («how much?», «why?», «когда?») or anything else — nothing proposed (the AI may look later).
 */

export interface ReplyLine {
  id: string;
  /** The line's name as the quote said it («FRONT BRAKE DISCS»). */
  name: string;
  /** The labour charge (named by the parts, v0.80): not decided by its words — it goes with the parts agreed. */
  labour?: boolean;
}

export type CustomerAnswer =
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'option'; option: number }
  | { kind: 'some'; agree: string[]; refuse: string[] }
  | { kind: 'question' }
  | { kind: 'unknown' };

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^\p{L}\p{N}?]+/gu, ' ')
    .trim();

const YES = [
  'yes', 'yess', 'yeah', 'yep', 'ya', 'ok', 'okay', 'okey', 'oky', 'k', 'kk', 'sure', 'fine', 'done', 'agree', 'agreed', 'approve', 'approved',
  'confirm', 'confirmed', 'proceed', 'go ahead', 'go on', 'do it', 'please do', 'carry on', 'alright', 'all right', 'good', 'perfect',
  'تمام', 'ماشي', 'موافق', 'اوكي', 'اوك', 'نعم', 'يلا', 'تم', 'اوكيه', 'اكيد', 'طيب',
  'haan', 'han', 'ha', 'ji', 'theek hai', 'thik hai', 'karo', 'kar do', 'kardo', 'ठीक है', 'हाँ', 'ہاں', 'ٹھیک ہے',
  'да', 'ок', 'окей', 'хорошо', 'делайте', 'делай', 'согласен', 'согласна', 'давай', 'давайте', 'подтверждаю', 'норм',
];
const NO = ['no', 'nope', 'not now', 'later', 'cancel', 'dont', 'do not', 'not needed', 'no need', 'leave it', 'لا', 'مو لازم', 'بعدين', 'نہیں', 'nahi', 'nahin', 'нет', 'не надо', 'не нужно', 'отмена', 'потом'];
const POLITE = ['please', 'pls', 'plz', 'thanks', 'thank you', 'thx', 'brother', 'bro', 'sir', 'habibi', 'шукран', 'спасибо', 'пожалуйста', 'شكرا', 'من فضلك', 'bhai'];
const QUESTION = /\?|؟|\b(how much|why|when|what|which|can you|price|cost|discount|сколько|почему|когда|зачем|какой|скидк)\b/i;

/** The phrase is one of these, and nothing else but polite words. */
function onlyOf(text: string, words: string[]): boolean {
  let t = ` ${text} `;
  for (const p of POLITE) t = t.replaceAll(` ${p} `, ' ');
  t = t.trim();
  if (!t) return false;
  // Every word of what is left belongs to one of the phrases.
  for (const w of [...words].sort((a, b) => b.length - a.length)) t = ` ${t} `.replaceAll(` ${w} `, ' ').trim();
  return !t || /^[!.\s👍🙏✅👌]*$/u.test(t);
}

const stem = (w: string) => w.replace(/(es|s)$/, '');
const RU_STEM = (w: string) => w.replace(/(ами|ями|ов|ев|ей|ам|ям|ах|ях|ы|и|а|я|у|ю|е|о)$/, '');
const EN_ALIAS: Record<string, string> = { pad: 'pad', disc: 'disc', disk: 'disc', rotor: 'disc', oil: 'oil', filter: 'filter', tyre: 'tire', tire: 'tire', battery: 'battery', wiper: 'wiper', plug: 'plug', belt: 'belt', bulb: 'bulb' };
const RU_ALIAS: Record<string, string> = { колодк: 'pad', диск: 'disc', масл: 'oil', фильтр: 'filter', шин: 'tire', аккумулятор: 'battery', дворник: 'wiper', свеч: 'plug', ремен: 'belt', ремн: 'belt', ламп: 'bulb' };
/** A word as a key: English stems and a few Russian names of parts in English. */
function keyOf(w: string): string {
  const e = stem(w);
  if (EN_ALIAS[e]) return EN_ALIAS[e];
  const r = RU_STEM(w);
  for (const [k, v] of Object.entries(RU_ALIAS)) if (r.startsWith(k) || w.startsWith(k)) return v;
  return e;
}
const SKIP = new Set(['the', 'a', 'an', 'and', 'only', 'just', 'without', 'except', 'no', 'not', 'dont', 'do', 'it', 'them', 'please', 'front', 'rear', 'only', 'и', 'без', 'только', 'кроме', 'не', 'надо', 'нужно', 'делайте', 'делай', 'передние', 'задние', 'ok', 'okay', 'yes', 'change', 'replace']);

/** The lines a few words name («the pads», «колодки») — by a part word they share. */
function linesNamed(words: string[], lines: ReplyLine[]): string[] {
  const keys = new Set(words.filter((w) => !SKIP.has(w) && w.length >= 3).map(keyOf));
  if (!keys.size) return [];
  return lines.filter((l) => !l.labour && norm(l.name).split(' ').some((w) => keys.has(keyOf(w)))).map((l) => l.id);
}

/** Some agreed: the labour charge with them; the rest refused. */
function some(agreeParts: string[], lines: ReplyLine[]): CustomerAnswer {
  const agree = [...agreeParts, ...lines.filter((l) => l.labour).map((l) => l.id)];
  return { kind: 'some', agree, refuse: lines.map((l) => l.id).filter((id) => !agree.includes(id)) };
}

/**
 * What the customer's message says about the quote's `lines`; `options` — how many options were sent (v0.90, #72), 0 if
 * none.
 */
export function readCustomerAnswer(text: string, lines: ReplyLine[], options = 0): CustomerAnswer {
  const t = norm(text);
  if (!t) return { kind: 'unknown' };
  // An option by its number: «option 2», «вариант 2», «2nd», a bare «2» — only when options were sent.
  if (options > 1) {
    const m = t.match(/^(?:option|opt|вариант|خيار|no|number|#)?\s*(\d)(?:st|nd|rd|th)?(?:\s*(?:option|вариант))?$/) ?? t.match(/\b(?:option|вариант|خيار)\s*(\d)\b/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= options) return { kind: 'option', option: n };
    }
  }
  if (onlyOf(t, YES)) return { kind: 'all' };
  if (onlyOf(t, NO)) return { kind: 'none' };
  const words = t.split(' ');
  // «only the pads» / «только колодки»: these agreed, the rest refused.
  const only = t.match(/^(?:(?:ok|okay|yes|да|ок)\s+)?(?:only|just|только|فقط)\s+(.+)$/);
  if (only) {
    const agree = linesNamed(only[1].split(' '), lines);
    if (agree.length && agree.length < lines.filter((l) => !l.labour).length) return some(agree, lines);
  }
  // «without discs», «no discs», «except discs», «без дисков», «кроме дисков», «discs not needed»: those refused.
  const without = t.match(/^(?:(?:ok|okay|yes|go ahead|да|ок|делайте)\s+)?(?:without|except|no|but not|без|кроме|не надо|بدون)\s+(.+)$/) ?? t.match(/^(.+?)\s+(?:not needed|no need|не надо|не нужно)$/);
  if (without) {
    const refuse = linesNamed(without[1].split(' '), lines);
    const parts = lines.filter((l) => !l.labour);
    if (refuse.length && refuse.length < parts.length) return some(parts.map((l) => l.id).filter((id) => !refuse.includes(id)), lines);
  }
  if (QUESTION.test(text) || words.some((w) => QUESTION.test(w))) return { kind: 'question' };
  return { kind: 'unknown' };
}
