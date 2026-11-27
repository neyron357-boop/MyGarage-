import type { Plate } from '../domain/types';

/**
 * What was typed into «Новый заказ» and left without «Принять» (v0.99, audit П5): «×», a call, the app put away — the
 * number, the complaint, the customer were gone without a word. Kept on this device for a few hours and offered back
 * once at the top of the next «Новый заказ». Not the garage's data: nothing of it is synced.
 */
export interface NewOrderDraft {
  plate: Plate;
  complaint: string;
  name: string;
  phone: string;
  make: string;
  model: string;
  km: string;
  at: number;
}

const KEY = 'mygarage.newOrderDraft';
const KEEP_MS = 6 * 3600_000;

export function draftWorth(d: Omit<NewOrderDraft, 'at'>): boolean {
  return !!(d.plate.number || d.complaint.trim() || d.name.trim() || d.phone.trim());
}

export function saveNewOrderDraft(d: Omit<NewOrderDraft, 'at'>): void {
  try {
    if (draftWorth(d)) localStorage.setItem(KEY, JSON.stringify({ ...d, at: Date.now() }));
    else localStorage.removeItem(KEY);
  } catch {
    // storage unavailable
  }
}

export function readNewOrderDraft(): NewOrderDraft | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const d = JSON.parse(raw) as NewOrderDraft;
    if (!d?.plate || Date.now() - d.at > KEEP_MS || !draftWorth(d)) {
      localStorage.removeItem(KEY);
      return undefined;
    }
    return d;
  } catch {
    return undefined;
  }
}

export function clearNewOrderDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // storage unavailable
  }
}
