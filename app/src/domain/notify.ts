import { addDays, dubaiAt, dubaiDate, shiftDay } from './dates';
import type { Task, TaskKind } from './today';
import type { Reminder } from './types';

/*
 * What the phone is notified of while the app is closed (v0.74, the user: «уведомлять каждый 1 час, если заказ — список
 * деталей без цен… возможность настраивать уведомления под себя, это очень важно… добавить также напоминалки»).
 *
 * Nothing new is decided here about WHAT needs the manager: it is «Сегодня» (domain/today.ts) — the same facts of the
 * jobs, plus the reminders he set himself. This file adds WHEN to say it: each kind of «Сегодня» has its rule — on or
 * off, how long after the thing began (or how long before its time), how often to say it again — inside the hours and
 * days the manager set; and a summary once a morning.
 *
 * The app cannot wake itself on an iPhone, so it leaves a PLAN on the garage's server (server/src/push.mjs), which
 * keeps the time and sends: groups (a kind — «Ждём ответа»), each with its members (a car, from when) and its
 * repeat. The plan looks a week ahead — «Сегодня» as it will be at each coming hour and morning — so a time promised
 * for tomorrow, a part to collect on Thursday, a reminder for Monday come by themselves, though nobody opens the app.
 */

/** Every kind of «Сегодня» can be notified of. In the order the settings and the summary show them. */
export const NOTIFY_KINDS: TaskKind[] = ['answer', 'order', 'pickup', 'promised', 'booked', 'collect', 'outsource', 'returnBy', 'debt', 'reminder', 'followUp', 'service'];

export interface NotifyRule {
  on: boolean;
  /**
   * Minutes from the moment the thing is about to the first notification: after it began (a price not told for an
   * hour — 60), or, negative, before its time (a car promised for 15:00 — −30). Kinds that are about a day, not a
   * moment (parts to collect today), are said when the day's hours begin — this is not theirs.
   */
  after: number;
  /** Said again every so many minutes while it lasts; 0 — once (and again the next morning, if it still lasts). */
  every: number;
}

export interface NotifySettings {
  /** All of it: off — the phone is told nothing. */
  on: boolean;
  /** The hours notifications may come, minutes of the day in Dubai (from 08:00 to 21:00: 480, 1260). */
  from: number;
  to: number;
  /** The days they may come: 0 — Sunday … 6 — Saturday. */
  days: number[];
  /** A summary once a day: a line a kind. */
  digest: { on: boolean; at: number };
  rules: Record<TaskKind, NotifyRule>;
}

/** How each kind stands with time, for its rule and its settings. */
export type KindTime =
  /** Waits since a moment: «через» how long, then every… (a price not told, an answer not given, a customer to write to). */
  | 'since'
  /** Has its own time: how long «заранее», then every… while late (a time promised, a booking, a reminder). */
  | 'moment'
  /** About a day: said when the day's hours begin — every morning while it lasts — then every… (parts to collect, a debt). */
  | 'day';

export const KIND_TIME: Record<TaskKind, KindTime> = {
  answer: 'since',
  order: 'since',
  collect: 'since',
  promised: 'moment',
  booked: 'moment',
  reminder: 'moment',
  pickup: 'day',
  outsource: 'day',
  returnBy: 'day',
  debt: 'day',
  // (Said once, when their day comes — not every morning of the weeks they stay in «Сегодня».)
  followUp: 'since',
  service: 'since',
};

export const DEFAULT_RULES: Record<TaskKind, NotifyRule> = {
  answer: { on: true, after: 120, every: 120 },
  order: { on: true, after: 60, every: 120 },
  pickup: { on: true, after: 0, every: 180 },
  promised: { on: true, after: -30, every: 60 },
  booked: { on: true, after: -30, every: 30 },
  collect: { on: true, after: 0, every: 240 },
  outsource: { on: true, after: 0, every: 240 },
  returnBy: { on: true, after: 0, every: 0 },
  debt: { on: true, after: 0, every: 0 },
  reminder: { on: true, after: 0, every: 60 },
  followUp: { on: true, after: 0, every: 0 },
  service: { on: true, after: 0, every: 0 },
};

export const DEFAULT_NOTIFY: NotifySettings = { on: true, from: 8 * 60, to: 21 * 60, days: [0, 1, 2, 3, 4, 5, 6], digest: { on: true, at: 9 * 60 }, rules: DEFAULT_RULES };

/** The choices the settings offer (minutes). */
export const AFTER_CHOICES = [0, 15, 30, 60, 120, 240];
export const BEFORE_CHOICES = [0, 15, 30, 60, 120];
export const EVERY_CHOICES = [0, 15, 30, 60, 120, 240, 1440];

const int = (v: unknown, lo: number, hi: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : def);

/** The settings made whole: what is stored (maybe by an older app, maybe partly) over the defaults, every number sane. */
export function notifyOf(raw?: Partial<NotifySettings> | null): NotifySettings {
  const r = raw ?? {};
  const d = DEFAULT_NOTIFY;
  const days = Array.isArray(r.days) ? [...new Set(r.days.filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort() : d.days;
  const rules = {} as Record<TaskKind, NotifyRule>;
  for (const k of NOTIFY_KINDS) {
    const x = (r.rules as Partial<Record<TaskKind, Partial<NotifyRule>>> | undefined)?.[k];
    const def = DEFAULT_RULES[k];
    rules[k] = { on: typeof x?.on === 'boolean' ? x.on : def.on, after: int(x?.after, -1440, 7 * 1440, def.after), every: int(x?.every, 0, 7 * 1440, def.every) };
  }
  return {
    on: typeof r.on === 'boolean' ? r.on : d.on,
    from: int(r.from, 0, 1439, d.from),
    to: int(r.to, 1, 1440, d.to),
    days: days.length ? days : d.days,
    digest: { on: typeof r.digest?.on === 'boolean' ? r.digest.on : d.digest.on, at: int(r.digest?.at, 0, 1439, d.digest.at) },
    rules,
  };
}

/* ---------- The plan ---------- */

export interface PlanMember {
  id: string;
  /** The car, as a line of a notification («Renault Kwid · 67445»), or a reminder's words. */
  label: string;
  /** Where a tap on the notification leads when it is about this one alone. */
  url: string;
  /**
   * From when it is said (ISO). The same however often the plan is made (the server tells a member it has said from
   * one it has not by this) — so it is the thing's own time, not the moment the plan was made.
   */
  start: string;
  /** Not said before this, though `start` has come: «Сегодня» lists it only from then (a car ready «for a day»). */
  notBefore?: string;
  /** Since when it waits — the server says how long («· 3 ч»); none — nothing is said about how long. */
  since?: string;
}
export interface PlanGroup {
  key: string;
  /** One member: the notification's title; several: `many` with {n} their number. */
  title: string;
  many: string;
  every: number;
  url: string;
  /** Its own notification always, never a line of the summary (a reminder). */
  solo?: boolean;
  members: PlanMember[];
}
export interface PushPlan {
  tz: 'Asia/Dubai';
  from: number;
  to: number;
  days: number[];
  units: { m: string; h: string; d: string };
  digest?: { at: number; title: string };
  groups: PlanGroup[];
}

export interface PlanWords {
  /** A kind's title («Назвать цену»). */
  title: (kind: TaskKind) => string;
  /** A task as a line: the car and what of it. */
  label: (task: Task) => string;
  /** Where a task opens. */
  url: (task: Task) => string;
  /** Where a notification about several opens («Сегодня»). */
  listUrl: string;
  digest: string;
  units: { m: string; h: string; d: string };
}

/** A task about a day, not a moment (`todayTasks` writes such a day as its UTC midnight). */
const dayOnly = (at: string) => at.endsWith('T00:00:00.000Z');
const addMinutes = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60_000).toISOString();
/** When a day's notifications begin (the hours' start, in Dubai). */
const morning = (day: string, from: number) => dubaiAt(day, Math.floor(from / 60), from % 60);

/** How far ahead the plan looks. */
const DAYS_AHEAD = 7;

/**
 * The moments «Сегодня» is looked at: now, each coming hour for a day (a time promised appears on its day, a car
 * ready «for a day» after its day), then each morning of the week — what is not there now but will be.
 */
export function planInstants(now: string, from: number): string[] {
  const out = [now];
  const hour = Math.floor(Date.parse(now) / 3_600_000) * 3_600_000;
  for (let h = 1; h <= 24; h++) out.push(new Date(hour + h * 3_600_000).toISOString());
  const today = dubaiDate(now);
  for (let d = 1; d <= DAYS_AHEAD; d++) out.push(morning(shiftDay(today, d), from));
  return [...new Set(out)].filter((t) => t >= now).sort();
}

/**
 * The plan the server keeps time by.
 *
 * `tasksAt(moment)` — «Сегодня» as it is (or will be, if nothing changes) at that moment, with no waiting threshold of
 * its own (a price not told is listed at once: how long to wait is the rule's `after`). Each task becomes a member of
 * its kind's group the first moment it is listed:
 *   since   — from `task.at` + after, and not before the moment it is first listed;
 *   moment  — from `task.at` + after (negative: before its time);
 *   day     — from the morning of the day it is first listed (so it is said every morning while it lasts).
 * A reminder is a group of its own (its words are the notification); the rest are said together, a kind a notification.
 */
export function buildPlan(input: { settings: NotifySettings; now: string; tasksAt: (at: string) => Task[]; words: PlanWords }): PushPlan {
  const { settings: s, now, words } = input;
  const plan: PushPlan = { tz: 'Asia/Dubai', from: s.from, to: s.to, days: s.days, units: words.units, groups: [] };
  if (!s.on) return plan;
  if (s.digest.on) plan.digest = { at: s.digest.at, title: words.digest };
  type Found = { task: Task; start: string; notBefore?: string };
  const members = new Map<string, Found>();
  for (const moment of planInstants(now, s.from)) {
    for (const task of input.tasksAt(moment)) {
      const rule = s.rules[task.kind];
      if (!rule?.on || members.has(task.key)) continue;
      const kind = KIND_TIME[task.kind];
      if (kind === 'day' || dayOnly(task.at)) members.set(task.key, { task, start: morning(dubaiDate(moment), s.from) });
      // Listed only later (a car ready «for a day»): its own time all the same — and not said before it is listed.
      else members.set(task.key, { task, start: addMinutes(task.at, rule.after), ...(moment > now ? { notBefore: moment } : {}) });
    }
  }
  const byKind = new Map<TaskKind, Found[]>();
  for (const m of members.values()) byKind.set(m.task.kind, [...(byKind.get(m.task.kind) ?? []), m]);
  for (const kind of NOTIFY_KINDS) {
    const list = (byKind.get(kind) ?? []).sort((a, b) => a.start.localeCompare(b.start) || a.task.key.localeCompare(b.task.key));
    if (!list.length) continue;
    const rule = s.rules[kind];
    const title = words.title(kind);
    const member = ({ task, start, notBefore }: Found): PlanMember => ({
      id: task.key,
      label: words.label(task),
      url: words.url(task),
      start,
      ...(notBefore && notBefore > start ? { notBefore } : {}),
      ...(KIND_TIME[kind] === 'since' ? { since: task.at } : {}),
    });
    if (kind === 'reminder') for (const m of list) plan.groups.push({ key: m.task.key, title, many: title, every: rule.every, url: words.url(m.task), solo: true, members: [member(m)] });
    else plan.groups.push({ key: kind, title, many: `${title} · {n}`, every: rule.every, url: words.listUrl, members: list.map(member) });
  }
  return plan;
}

/* ---------- Reminders ---------- */

/** A repeating reminder's next time after `now`: the same time of day, a day, a week or a month on. */
export function nextTime(r: Pick<Reminder, 'at' | 'repeat'>, now: string): string | undefined {
  if (!r.repeat) return undefined;
  let at = r.at;
  for (let i = 0; i < 4000 && at <= now; i++) {
    if (r.repeat === 'month') {
      // The same day of the month, in Dubai (the 31st in a short month — its last day).
      const local = new Date(Date.parse(at) + 4 * 3_600_000);
      const day = local.getUTCDate();
      const next = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1, local.getUTCHours(), local.getUTCMinutes()));
      const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
      next.setUTCDate(Math.min(day, last));
      at = new Date(next.getTime() - 4 * 3_600_000).toISOString();
    } else at = addDays(at, r.repeat === 'week' ? 7 : 1);
  }
  return at > now ? at : undefined;
}

/** The times a new reminder is offered at, from now: in an hour, this evening (while it is day), tomorrow morning, in a week. */
export function quickTimes(now: string): { key: 'hour' | 'evening' | 'tomorrow' | 'week'; at: string }[] {
  const today = dubaiDate(now);
  const round = (iso: string) => new Date(Math.ceil(Date.parse(iso) / 300_000) * 300_000).toISOString();
  const out: { key: 'hour' | 'evening' | 'tomorrow' | 'week'; at: string }[] = [{ key: 'hour', at: round(addMinutes(now, 60)) }];
  const evening = dubaiAt(today, 18);
  if (addMinutes(now, 90) < evening) out.push({ key: 'evening', at: evening });
  out.push({ key: 'tomorrow', at: dubaiAt(shiftDay(today, 1), 9) }, { key: 'week', at: dubaiAt(shiftDay(today, 7), 9) });
  return out;
}

/** «08:00» ↔ 480. */
export const clock = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export function minutesOf(hhmm: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return undefined;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[1]) < 24 && Number(m[2]) < 60 ? v : undefined;
}
