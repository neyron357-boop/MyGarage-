import { useSyncExternalStore } from 'react';

/*
 * The connection to the garage's server (v0.40) and how syncing stands, kept on this device (localStorage — the key
 * of a paired device never goes into the data that is synced or backed up).
 */

export interface SyncConfig {
  /** https://… — the server's address. */
  url: string;
  /** This device's key, given at pairing. */
  token: string;
  deviceId: string;
  deviceName: string;
  pairedAt: string;
  /** This device's key for its pictures and videos only (v0.41.3): an element loads them by their address with it. */
  mediaKey?: string;
}

export interface SyncState {
  /** The server's number of the last change taken. */
  cursor: number;
  /** The stamp (db/syncHooks) of the last change sent. */
  pushedT: number;
  /** Everything that was here before pairing has been sent (or replaced by the server's). */
  initialDone: boolean;
  /** Photos from before v0.40 found and queued. */
  mediaScanned?: boolean;
  /** Files the server had before «Освобождать память» was on have left the phone too. */
  offloadSwept?: boolean;
  lastAt?: string;
  lastError?: string;
  busy?: boolean;
  /** Changes and photos still to send. */
  pending?: number;
  /** Photos and files sent, and the space they no longer take here. */
  uploaded?: number;
  freedBytes?: number;
  /** This device's data is becoming the garage's (v0.41.1): sent whole, then the server keeps only it. */
  replacing?: boolean;
  /** The device whose data is the garage's, as the server last said. */
  main?: { id: string; name: string } | null;
  /** Photos whose records wait for their own files to be on the server (v0.41.2). */
  held?: string[];
  /** The stream is open: other devices' changes come the moment they are made (not kept between visits). */
  live?: boolean;
}

const CONFIG_KEY = 'mygarage.sync';
const INSTALL_KEY = 'mygarage.install';
const STATE_KEY = 'mygarage.sync.state';
const OFFLOAD_KEY = 'mygarage.sync.offload';
const INITIAL: SyncState = { cursor: 0, pushedT: 0, initialDone: false };

/** localStorage, or memory where there is none (tests, a refused storage). */
const memory = new Map<string, string>();
const kv = {
  get(k: string): string | null {
    try {
      return globalThis.localStorage ? globalThis.localStorage.getItem(k) : (memory.get(k) ?? null);
    } catch {
      return memory.get(k) ?? null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (globalThis.localStorage) {
        if (v === null) globalThis.localStorage.removeItem(k);
        else globalThis.localStorage.setItem(k, v);
        return;
      }
    } catch {
      // fall through to memory
    }
    if (v === null) memory.delete(k);
    else memory.set(k, v);
  },
};

const subs = new Set<() => void>();
let version = 0;
const notify = () => {
  version++;
  subs.forEach((f) => f());
};

let configCache: SyncConfig | null | undefined;
export function syncConfig(): SyncConfig | null {
  if (configCache === undefined) {
    try {
      configCache = JSON.parse(kv.get(CONFIG_KEY) ?? 'null') as SyncConfig | null;
    } catch {
      configCache = null;
    }
  }
  return configCache;
}
export function setSyncConfig(c: SyncConfig | null) {
  configCache = c;
  kv.set(CONFIG_KEY, c ? JSON.stringify(c) : null);
  notify();
}

let stateCache: SyncState | undefined;
export function syncState(): SyncState {
  if (!stateCache) {
    try {
      stateCache = { ...INITIAL, ...(JSON.parse(kv.get(STATE_KEY) ?? '{}') as Partial<SyncState>) };
    } catch {
      stateCache = { ...INITIAL };
    }
  }
  return stateCache;
}
export function setSyncState(patch: Partial<SyncState>, keep = true) {
  stateCache = { ...syncState(), ...patch };
  // The moment-to-moment (busy, pending) is not worth a write each time.
  if (keep) {
    const { busy: _b, pending: _p, live: _l, ...lasting } = stateCache;
    kv.set(STATE_KEY, JSON.stringify(lasting));
  }
  notify();
}
export function resetSyncState(patch: Partial<SyncState> = {}) {
  // The stream open now stays open (v0.42.1: a computer connected just after its stream had opened showed no
  // «На связи» at all); only what is kept starts again.
  const { live, busy } = syncState();
  stateCache = { ...INITIAL, live, busy, ...patch };
  const { busy: _b, pending: _p, live: _l, ...lasting } = stateCache;
  kv.set(STATE_KEY, JSON.stringify(lasting));
  notify();
}

/** Photos and PDFs sent to the server leave this device (their small previews stay) — on by default. */
export function offloadOn(): boolean {
  return kv.get(OFFLOAD_KEY) !== '0';
}
export function setOffload(on: boolean) {
  kv.set(OFFLOAD_KEY, on ? '1' : '0');
  // Turned on: what the server already has leaves the phone at the next sync.
  if (on) setSyncState({ offloadSwept: false });
  else notify();
}

/** The connection and its state, for the screens. */
export function useSync(): { config: SyncConfig | null; state: SyncState; offload: boolean } {
  useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => version,
  );
  return { config: syncConfig(), state: syncState(), offload: offloadOn() };
}

/**
 * This app's own number on this device (v0.41.2): kept when it is disconnected, so the same app connected again is
 * the same device to the server (the main one stays the main one).
 */
export function installId(): string {
  let id = kv.get(INSTALL_KEY);
  if (!id) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    kv.set(INSTALL_KEY, id);
  }
  return id;
}

/** Testing: a test device's own install number put back (each keeps its own). */
export function restoreInstallId(id: string | undefined) {
  if (id) kv.set(INSTALL_KEY, id);
}

/** Testing: the storage forgotten (each test device starts clean). */
export function forgetSyncMemory() {
  memory.clear();
  configCache = undefined;
  stateCache = undefined;
}
