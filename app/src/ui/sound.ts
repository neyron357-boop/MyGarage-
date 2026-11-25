/*
 * A short sound when the garage's AI has finished with a result (v0.52, the user: «добавь звуковые оповещения, когда ИИ
 * заканчивает работу с результатом»): two or three soft notes made on the device itself (Web Audio — no file to load,
 * nothing from the network). A phone lets a page sound only after a touch: the first touches unlock it. On by default;
 * «Ещё → Оформление → Звук ИИ» turns it off on this device. The iPhone's silent switch silences it, as it should.
 */

const KEY = 'mygarage.sound';
let ctx: AudioContext | undefined;
let enabled = read();
const subs = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function soundEnabled(): boolean {
  return enabled;
}
export function subscribeSound(f: () => void): () => void {
  subs.add(f);
  return () => void subs.delete(f);
}
export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // ignore
  }
  subs.forEach((f) => f());
  // Turned on in a tap: heard at once (and the sound unlocked by that very tap).
  if (on) {
    unlock();
    chime('found');
  }
}

function audio(): AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return undefined;
  try {
    ctx ??= new C();
  } catch {
    return undefined;
  }
  return ctx;
}

function unlock(): void {
  const a = audio();
  if (a && a.state === 'suspended') void a.resume().catch(() => undefined);
}

/** The first touches unlock the page's sound (a phone keeps it shut until then); called once at the start. */
export function armSound(): void {
  if (typeof window === 'undefined') return;
  const events = ['pointerdown', 'touchend', 'keydown'] as const;
  const on = () => {
    unlock();
    if (ctx?.state === 'running') for (const e of events) window.removeEventListener(e, on, true);
  };
  for (const e of events) window.addEventListener(e, on, { capture: true, passive: true });
}

/**
 * The AI's sound: `found` — a result for one thing (a car filled, a name, a receipt), two rising notes; `done` — a long
 * work finished, three. Quiet, short, not a ring.
 */
export function chime(kind: 'found' | 'done' = 'found'): void {
  if (!enabled) return;
  const a = audio();
  if (!a || a.state !== 'running') return;
  const notes = kind === 'done' ? [659.25, 880, 1318.51] : [880, 1318.51];
  const t0 = a.currentTime + 0.02;
  notes.forEach((f, i) => {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    const s = t0 + i * 0.1;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.16, s + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.38);
    o.connect(g).connect(a.destination);
    o.start(s);
    o.stop(s + 0.42);
  });
}
