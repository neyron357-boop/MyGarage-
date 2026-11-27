/*
 * The next oil service by the car's mileage (audit 27/11: «напоминание о ТО — по пробегу, а не только через полгода»): a
 * car that runs 250 km a day (a taxi, a delivery van) needs its service in six weeks, one that runs 20 km a day — after
 * the half year. The garage notes the mileage on its visits (services/mileage.ts); how fast the car runs is read from them,
 * and the day its next 10 000 km come up is when «Сегодня» says «Пора на ТО». Without two visits a month apart with a
 * mileage — nothing said here: the half-year rule of domain/today.ts stands alone.
 */

/** Between oil services (a garage's usual: synthetic oil, 10 000 km). */
export const SERVICE_KM = 10_000;
/** Not reminded sooner after a service, whatever the mileage says (a reading may be wrong). */
export const SERVICE_MIN_DAYS = 30;

export interface KmPoint {
  /** The visit's moment (ISO). */
  at: string;
  km: number;
}

const DAY = 86_400_000;

/**
 * How many km a day the car runs: the earliest and the latest of its visits in the two years up to the latest, at least a
 * month apart, the mileage grown. Less than 3 or more than 800 a day — a reading is wrong somewhere: nothing.
 */
export function kmPerDay(points: KmPoint[]): number | undefined {
  const list = points.filter((p) => Number.isFinite(p.km) && p.km > 0 && !Number.isNaN(Date.parse(p.at))).sort((a, b) => a.at.localeCompare(b.at));
  const last = list.at(-1);
  if (!last) return undefined;
  const from = Date.parse(last.at) - 730 * DAY;
  const first = list.find((p) => Date.parse(p.at) >= from && p.km < last.km);
  if (!first) return undefined;
  const days = (Date.parse(last.at) - Date.parse(first.at)) / DAY;
  if (days < 30) return undefined;
  const rate = (last.km - first.km) / days;
  return rate >= 3 && rate <= 800 ? rate : undefined;
}

export interface ServiceForecast {
  /** The day the next service comes up by the mileage (ISO). */
  dueAt: string;
  perDay: number;
  /** The mileage at the last service. */
  atKm: number;
  /** The mileage now, as the car's pace says (rounded to 500). */
  nowKm: number;
}

/** The next service of a car serviced at `service` (its mileage then), by its visits' mileage; nothing without a pace. */
export function serviceForecast(points: KmPoint[], service: { at: string; km?: number }, now: string): ServiceForecast | undefined {
  const perDay = kmPerDay(points);
  if (!perDay || service.km === undefined || !(service.km > 0)) return undefined;
  const days = Math.max(SERVICE_MIN_DAYS, SERVICE_KM / perDay);
  const since = Math.max(0, (Date.parse(now) - Date.parse(service.at)) / DAY);
  return {
    dueAt: new Date(Date.parse(service.at) + days * DAY).toISOString(),
    perDay,
    atKm: service.km,
    nowKm: Math.round((service.km + perDay * since) / 500) * 500,
  };
}
