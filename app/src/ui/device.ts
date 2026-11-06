import { useEffect, useState } from 'react';
import { BACKUP_EVERY_DAYS, lastBackupAt } from '../services/backup';
import { hoursBetween } from '../domain/dates';

export interface StorageInfo {
  /** Browser promised not to clear the data under storage pressure. */
  persisted?: boolean;
  usageBytes?: number;
  quotaBytes?: number;
}

/** How much the app stores on this device and whether the browser may evict it. */
export function useStorageInfo(): StorageInfo | undefined {
  const [info, setInfo] = useState<StorageInfo>();
  useEffect(() => {
    let alive = true;
    void (async () => {
      const out: StorageInfo = {};
      try {
        out.persisted = await navigator.storage?.persisted?.();
      } catch {
        // unsupported
      }
      try {
        const e = await navigator.storage?.estimate?.();
        out.usageBytes = e?.usage;
        out.quotaBytes = e?.quota;
      } catch {
        // unsupported
      }
      if (alive) setInfo(out);
    })();
    return () => {
      alive = false;
    };
  }, []);
  return info;
}

/** Ask the browser again to keep the data (granted automatically for installed apps in Chrome). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** Days since the last backup on this device (undefined = never), re-read when a backup is made. */
export function useBackupAge(): { at?: string; days?: number; due: boolean } {
  const [at, setAt] = useState(lastBackupAt);
  useEffect(() => {
    const on = () => setAt(lastBackupAt());
    window.addEventListener('mygarage:backup', on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener('mygarage:backup', on);
      window.removeEventListener('storage', on);
    };
  }, []);
  const days = at ? Math.floor(hoursBetween(at) / 24) : undefined;
  return { at, days, due: days === undefined || days >= BACKUP_EVERY_DAYS };
}

export function formatBytes(n: number | undefined, lang: 'ru' | 'en'): string {
  if (n === undefined) return '—';
  const units = lang === 'ru' ? ['Б', 'КБ', 'МБ', 'ГБ'] : ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1).replace('.', lang === 'ru' ? ',' : '.')} ${units[i]}`;
}

/** Opened over plain http (phone on the local network): no install, no offline mode. */
export function insecureContext(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === false;
}
