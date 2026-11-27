import { db } from '../db/db';
import { dubaiTime, formatDate, nowIso } from '../domain/dates';
import { formatAed } from '../domain/money';
import { buildPlan, notifyOf, type NotifySettings, type PlanWords, type PushPlan } from '../domain/notify';
import { CUSTOMER_KINDS, type Task, type TaskKind } from '../domain/today';
import type { Customer, Lang, Vehicle } from '../domain/types';
import i18n, { tFor } from '../i18n';
import { loadRowBundles, type OrderBundle } from './orders';
import { openReminders } from './reminders';
import { getSettings, saveSettings } from './settings';
import { callJson, SyncError } from './sync/api';
import { syncConfig } from './sync/config';
import { onDataChanged } from './sync/engine';
import { loadPast, tasksFor } from './today';

/*
 * The notifications' plan, made from the garage's data and left on its server (v0.74; the rules — domain/notify.ts,
 * the sending — server/src/push.mjs). Every device connected to the server makes it — the PC at the desk as well as the
 * phone — after each change of the data, written here or brought from another device: whoever changed something last
 * leaves the plan that is true now, and the phone is notified by it though its own app is closed.
 */

/** The car as a notification's line says it: «Toyota Camry · A 12345». */
const car = (v?: Pick<Vehicle, 'make' | 'model' | 'plate'>) => (v ? [[v.make, v.model].filter(Boolean).join(' '), [v.plate?.code, v.plate?.number].filter(Boolean).join(' ')].filter(Boolean).join(' · ') : '');
/** Whose it is, short (v0.82: a line is read at a glance — the car, its plate, its customer). */
const who = (c?: Pick<Customer, 'name' | 'companyName' | 'type'>) => ((c?.type === 'company' && c.companyName) || c?.name || '').trim().split(/\s+/).slice(0, 2).join(' ');

/** The plan as it is now, in this device's language. */
export async function makePlan(now = nowIso(), lang: Lang = i18n.language === 'en' ? 'en' : 'ru'): Promise<PushPlan> {
  const settings = await getSettings();
  const s = notifyOf(settings.notify);
  if (!s.on) return buildPlan({ settings: s, now, tasksAt: () => [], words: wordsFor(lang, new Map(), new Map()) });
  const orders = await db.orders.where('stage').noneOf(['closed', 'cancelled']).toArray();
  const [rows, past, reminders] = await Promise.all([loadRowBundles(orders), loadPast(now), openReminders()]);
  const bundles = rows.filter((b): b is OrderBundle => !!b);
  // A job told to keep quiet («…» → «Не напоминать»): none of its own things are said; a reminder set on it still is.
  const loud = bundles.filter((b) => !b.order.notifyOff);
  const byOrder = new Map(bundles.map((b) => [b.order.id, b]));
  return buildPlan({ settings: s, now, tasksAt: (at) => tasksFor(loud, past, at, reminders, 0), words: wordsFor(lang, byOrder, past.vehicles) });
}

function wordsFor(lang: Lang, byOrder: Map<string, OrderBundle>, vehicles: Map<string, Vehicle>): PlanWords {
  const t = tFor(lang);
  const vehicleOf = (task: Task) => byOrder.get(task.orderId ?? '')?.vehicle ?? vehicles.get(task.vehicleId);
  return {
    // v0.82: bright — the kind's sign first, then what to do («📞 Клиент не ответил»).
    title: (kind: TaskKind) => t(`notify.push.${kind}`),
    soloTitle: (task) => (task.text?.trim() ? `🔔 ${task.text.trim()}` : ''),
    label: (task) => {
      const name = [car(vehicleOf(task)), who(byOrder.get(task.orderId ?? '')?.customer)].filter(Boolean).join(' · ');
      switch (task.kind) {
        case 'reminder':
          // (Its words are the title.)
          return name;
        case 'promised':
        case 'booked':
          return [name, dubaiTime(task.at)].filter(Boolean).join(' · ');
        case 'debt':
          return [name, task.amountFils ? formatAed(task.amountFils, lang) : ''].filter(Boolean).join(' · ');
        case 'returnBy':
          return [name, formatDate(task.at.slice(0, 10)).slice(0, 5)].filter(Boolean).join(' · ');
        case 'order':
        case 'pickup':
          return [name, task.count && task.count > 1 ? `×${task.count}` : ''].filter(Boolean).join(' · ');
        default:
          return name;
      }
    },
    url: (task) => (task.kind === 'pickup' ? '#/parts?tab=pickup' : CUSTOMER_KINDS.includes(task.kind) || !task.orderId ? TODAY_URL : `#/orders/${task.orderId}`),
    listUrl: TODAY_URL,
    digest: t('notify.pushDigest'),
    units: { m: t('notify.unit.m'), h: t('notify.unit.h'), d: t('notify.unit.d') },
  };
}

/** The board with «Сегодня» open (features/board/TodayBell.tsx reads it). */
export const TODAY_URL = '#/?today=1';

/* ---------- Left on the server ---------- */

let last = '';
let unsupported = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | null = null;
let again = false;

/** The plan made and sent now (when it differs from the one sent last). Quiet: no server, no network — later. */
export function sendPlan(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        const cfg = syncConfig();
        if (!cfg || unsupported) return;
        const plan = await makePlan();
        const json = JSON.stringify(plan);
        if (json === last) continue;
        await callJson(cfg, '/api/push/plan', { method: 'POST', body: { plan }, timeout: 20_000 });
        last = json;
      } while (again);
    } catch (e) {
      // A server from before v0.74 has no such address: not asked again until the app is opened anew.
      if (e instanceof SyncError && e.status === 404) unsupported = true;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** The plan made again a few seconds after the data changed (one action's several writes — one plan). */
export function schedulePlan(ms = 5000) {
  if (!syncConfig() || unsupported) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void sendPlan(), ms);
}

let started = false;
/**
 * Once, at the app's start: the plan follows the data — after every change, when the app comes back to the screen,
 * and every half an hour while it is open (the plan looks a week ahead from the moment it is made).
 */
export function startNotifyPlan() {
  if (started || typeof document === 'undefined') return;
  started = true;
  onDataChanged(() => schedulePlan());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && schedulePlan(3000));
  setInterval(() => schedulePlan(1000), 30 * 60_000);
  schedulePlan(6000);
}

/** The manager's settings of notifications changed: kept with the garage's settings (the plan follows by itself). */
export async function saveNotify(patch: Partial<NotifySettings>): Promise<void> {
  const cur = notifyOf((await getSettings()).notify);
  await saveSettings({ notify: { ...cur, ...patch, digest: { ...cur.digest, ...(patch.digest ?? {}) }, rules: { ...cur.rules, ...(patch.rules ?? {}) } } });
}

/** A job kept quiet, or heard again («…» → «Не напоминать»). */
export async function setJobQuiet(orderId: string, quiet: boolean): Promise<void> {
  await db.orders.update(orderId, { notifyOff: quiet || undefined });
}
