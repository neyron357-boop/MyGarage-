import { db } from '../../db/db';
import { callJson, SyncError } from './api';
import { setSyncState, syncConfig, syncState, type SyncConfig } from './config';

/*
 * Job numbers without the server (v0.84.2, audit 25/11). A job's number is the device's guess — the next after the
 * last it knows — until the garage's server has the job (it renumbers one whose number is taken). The phone and the
 * computer cut off from the server (the tunnel down for hours) each gave a job 360, and both customers had
 * INV-2026-360 before the server could say. So: the server keeps a few numbers for each device (`/api/sync/numbers`,
 * server/src/store.mjs `reserveNumbers`) that no other device ever takes; a job whose number the server has not
 * confirmed takes one of them before its invoice is issued (services/money.ts `sureJobNumber`). In touch with the
 * server, nothing changes: the numbers go one after another as before.
 */

const KEEP = 3;
/** An older server without kept numbers: asked again after a while, not at every sync. */
let refusedAt = 0;

/** A job made here while connected: its number is this device's guess until the server has the job. */
export function jobMadeHere(orderId: string) {
  if (!syncConfig()) return;
  const unsure = syncState().unsure ?? [];
  if (!unsure.includes(orderId)) setSyncState({ unsure: [...unsure, orderId].slice(-200) });
}

/** The server has these jobs (sent, or numbered from this device's own): their numbers are no longer a guess. */
export function jobsSure(ids: string[]) {
  const unsure = syncState().unsure ?? [];
  if (!ids.length || !unsure.length) return;
  const gone = new Set(ids);
  const left = unsure.filter((id) => !gone.has(id));
  if (left.length !== unsure.length) setSyncState({ unsure: left });
}

/** Its number is still this device's guess (made here, the server has not had it yet). */
export function jobUnsure(orderId: string): boolean {
  return !!syncConfig() && (syncState().unsure ?? []).includes(orderId);
}

/** The lowest number kept for this device that no job here has, now taken (none — undefined). */
export async function takeKeptNumber(): Promise<number | undefined> {
  for (;;) {
    const [n, ...rest] = syncState().numbers ?? [];
    if (n === undefined) return undefined;
    setSyncState({ numbers: rest });
    // A job has it already (the server numbered all jobs again since): the next one.
    if (!(await db.orders.where('number').equals(n).count())) return n;
  }
}

/** Topped up after a sync while few are left (an older server has none: quietly nothing). */
export async function topUpNumbers(cfg: SyncConfig): Promise<void> {
  if ((syncState().numbers?.length ?? 0) >= KEEP - 1 || Date.now() - refusedAt < 10 * 60_000) return;
  try {
    const res = await callJson<{ numbers?: number[] }>(cfg, '/api/sync/numbers', { method: 'POST', timeout: 15_000 });
    const given = (res.numbers ?? []).filter((n) => Number.isFinite(n));
    // Any a job here has already (taken, the server not told yet) stays taken.
    const used = new Set((await db.orders.where('number').anyOf(given).toArray()).map((o) => o.number));
    setSyncState({ numbers: given.filter((n) => !used.has(n)).sort((a, b) => a - b) });
  } catch (e) {
    // An older server (it has no such address): asked again in a while; none just now — at the next sync.
    if (e instanceof SyncError && e.status === 404) refusedAt = Date.now();
  }
}
