import { normalizeText } from './search';
import type { Plate } from './types';

/*
 * The board's own search (v0.81, the user's brief: «строка поиска вверху экрана «Все»… по госномеру или имени клиента
 * можно искать сразу с главного экрана»): which of the cars on the board a query is about — its plate (the number, the
 * code with it, «A 12345» or «A12345»), the customer's name or company, the phone (its digits anywhere in it), the car,
 * the job's number. Every word typed must be found. Pure; the rest of the base is the search's (SearchResults).
 */

export interface FindJob {
  number: number;
  plate: Plate;
  make?: string;
  model?: string;
  name?: string;
  company?: string;
  phone?: string;
  driver?: string;
}

const digits = (s: string) => s.replace(/\D/g, '');

export function boardMatches(j: FindJob, query: string): boolean {
  const tokens = normalizeText(query).split(' ').filter(Boolean);
  if (!tokens.length) return true;
  const code = normalizeText(j.plate.code ?? '').replace(/ /g, '');
  const num = digits(j.plate.number ?? '');
  const words = normalizeText([j.make, j.model, j.name, j.company, j.driver].filter(Boolean).join(' ')).split(' ').filter(Boolean);
  const phone = digits(j.phone ?? '');
  // The plate's code and number typed as one word («a12345»), or the number cut at its start.
  const plate = `${code}${num}`;
  return tokens.every((tk) => {
    if (/^\d+$/.test(tk))
      return num.includes(tk) || String(j.number) === tk || (tk.length >= 3 && phone.includes(tk.replace(/^0+/, '') || tk));
    if (/\d/.test(tk) && plate.includes(tk)) return true;
    if (code && tk === code) return true;
    return words.some((w) => w.startsWith(tk));
  });
}
