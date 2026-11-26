import Dexie from 'dexie';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useScreen } from './stack';

/*
 * A heavy read kept calm (v0.91.7, the owner: «оптимизируй работу ватсапа, сделай его плавнее»). The WhatsApp list read
 * every chat's knowledge — three times — on each record the chats' study wrote: during a pass the phone's main thread was
 * busy 93 % of the time (e2e/wastudy.cjs: 33 s of 36 s at CPU ×4, 122 long tasks). A live query runs again on every write
 * to what it read; this one runs at once the first time and on a change after a quiet while, then at most once in `calmMs`
 * (the last change is always read), and only while its screen is in front (behind another — once it comes back).
 *
 * What changed is told by Dexie itself (`storagemutated` — the page's own writes and the sync's), by table name only.
 */

type Listener = (tables: Set<string>) => void;
const listeners = new Set<Listener>();
let hooked = false;

function hook() {
  if (hooked) return;
  hooked = true;
  Dexie.on('storagemutated', (parts: Record<string, unknown>) => {
    const tables = new Set<string>();
    for (const key of Object.keys(parts)) {
      const m = /^idb:\/\/[^/]+\/([^/]+)\//.exec(key);
      if (m) tables.add(m[1]);
    }
    if (tables.size) listeners.forEach((f) => f(tables));
  });
}

/** Told when any of these tables changed (outside React too). Returns the way to stop. */
export function onTables(tables: string[], f: () => void): () => void {
  hook();
  const want = new Set(tables);
  const l: Listener = (changed) => {
    for (const t of changed) if (want.has(t)) return f();
  };
  listeners.add(l);
  return () => listeners.delete(l);
}

const ALWAYS_FRONT = { front: () => true, wakes: () => 0, watch: () => () => {} };

/**
 * `query` read now and again when `tables` change — at most once in `calmMs`, the last change always read — while the
 * screen is in front. `deps` changed — read again at once.
 */
export function useCalmQuery<T>(tables: string[], query: () => Promise<T>, deps: unknown[], calmMs = 3000): T | undefined {
  const screen = useScreen() ?? ALWAYS_FRONT;
  const wakes = useSyncExternalStore(screen.watch, screen.wakes);
  const [value, setValue] = useState<T>();
  const q = useRef(query);
  q.current = query;
  const st = useRef({ lastRun: 0, timer: 0, dirty: false, run: 0, alive: true });
  const key = JSON.stringify(deps);

  useEffect(() => {
    const s = st.current;
    s.alive = true;
    const run = () => {
      window.clearTimeout(s.timer);
      s.timer = 0;
      s.dirty = false;
      s.lastRun = Date.now();
      const n = ++s.run;
      void q
        .current()
        .then((v) => {
          if (s.alive && n === s.run) setValue(v);
        })
        .catch(() => undefined);
    };
    const soon = () => {
      if (!screen.front()) {
        s.dirty = true;
        return;
      }
      if (s.timer) return;
      const wait = s.lastRun + calmMs - Date.now();
      if (wait <= 0) run();
      else s.timer = window.setTimeout(run, wait);
    };
    // The first read (and after `deps` changed) — at once.
    run();
    const stop = onTables(tables, soon);
    return () => {
      s.alive = false;
      stop();
      window.clearTimeout(s.timer);
      s.timer = 0;
    };
    // `tables` are the same for a caller; `key` stands for `deps`.
  }, [key, calmMs]);

  // Back in front with something changed while behind — read it.
  useEffect(() => {
    const s = st.current;
    if (!s.dirty || !screen.front()) return;
    s.dirty = false;
    s.lastRun = Date.now();
    const n = ++s.run;
    void q
      .current()
      .then((v) => {
        if (s.alive && n === s.run) setValue(v);
      })
      .catch(() => undefined);
  }, [wakes]);

  return value;
}
