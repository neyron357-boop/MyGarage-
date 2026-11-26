import { dubaiAt, dubaiDate } from './dates';

/*
 * «Send later» (v0.91.7, task #76, the owner: «если нажать и удержать — окно с установкой таймера отправки, чтобы вставить
 * время, когда сообщение должно отправиться автоматически»): the moments offered, and a time typed — in Dubai.
 * The garage's server keeps the message until then (server/src/waOutbox.mjs `after`).
 */

export type LaterKey = 'in30' | 'in60' | 'in120' | 'evening' | 'morning';

export interface LaterChoice {
  key: LaterKey;
  at: number;
}

const MIN = 60_000;
const nextDay = (day: string) => new Date(Date.parse(`${day}T12:00:00+04:00`) + 24 * 60 * MIN).toISOString().slice(0, 10);

/** In 30 minutes, an hour, two; this evening at 18:00 (while it is ahead by half an hour); tomorrow at 09:00. */
export function laterChoices(now: number): LaterChoice[] {
  const today = dubaiDate(new Date(now));
  const evening = Date.parse(dubaiAt(today, 18));
  const out: LaterChoice[] = [
    { key: 'in30', at: now + 30 * MIN },
    { key: 'in60', at: now + 60 * MIN },
    { key: 'in120', at: now + 120 * MIN },
  ];
  if (evening - now > 30 * MIN) out.push({ key: 'evening', at: evening });
  out.push({ key: 'morning', at: Date.parse(dubaiAt(nextDay(today), 9)) });
  return out;
}

/**
 * A time typed («14:30») for today or tomorrow in Dubai → its moment. Today's time already past (or within a minute) —
 * none: the person is asked to pick tomorrow. Not a time — none.
 */
export function laterAt(day: 'today' | 'tomorrow', hhmm: string, now: number): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return undefined;
  const today = dubaiDate(new Date(now));
  const at = Date.parse(dubaiAt(day === 'today' ? today : nextDay(today), h, min));
  return at - now > MIN ? at : undefined;
}

/** The time a little ahead to start the field with: in an hour, on a quarter («14:30»), in Dubai. */
export function laterStart(now: number): string {
  const at = new Date(Math.ceil((now + 60 * MIN) / (15 * MIN)) * 15 * MIN + 4 * 60 * MIN);
  return `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`;
}
