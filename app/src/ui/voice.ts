import { peaksOf } from '../domain/waveform';
import { mediaBlob } from '../services/media';

/*
 * Voice messages: their bars (read from the recording itself, by the browser's audio decoder) and the speed
 * they are played at (1×, 1.5×, 2× — as in a messenger; kept on this device for the next ones).
 */

let decoder: BaseAudioContext | undefined;

/** The bars of a recording, or nothing where the browser cannot read it. */
export async function peaksOfBlob(blob: Blob): Promise<number[] | undefined> {
  try {
    const W = window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext };
    const Ctx = window.OfflineAudioContext ?? W.webkitOfflineAudioContext;
    if (!Ctx) return undefined;
    decoder ??= new Ctx(1, 1, 44100);
    const buffer = await decoder.decodeAudioData(await blob.arrayBuffer());
    return peaksOf(buffer.getChannelData(0));
  } catch {
    return undefined;
  }
}

const read = new Map<string, Promise<number[] | undefined>>();
let queue: Promise<unknown> = Promise.resolve();

/**
 * The bars of a stored voice note made before the bars were kept with it: read once a session, one recording at a
 * time (a chat of many old voice notes does not decode them all at once).
 */
export function voicePeaks(mediaId: string): Promise<number[] | undefined> {
  let p = read.get(mediaId);
  if (!p) {
    p = queue.then(async () => {
      const b = await mediaBlob(mediaId);
      return b ? peaksOfBlob(b) : undefined;
    });
    queue = p.catch(() => undefined);
    read.set(mediaId, p);
  }
  return p;
}

export type VoiceRate = 1 | 1.5 | 2;
export const VOICE_RATES: VoiceRate[] = [1, 1.5, 2];
const RATE_KEY = 'mygarage.voiceRate';

export function savedVoiceRate(): VoiceRate {
  try {
    const r = Number(localStorage.getItem(RATE_KEY));
    return (VOICE_RATES as number[]).includes(r) ? (r as VoiceRate) : 1;
  } catch {
    return 1;
  }
}

export function saveVoiceRate(r: VoiceRate) {
  try {
    localStorage.setItem(RATE_KEY, String(r));
  } catch {
    // a private window: the speed is only for now
  }
}

/** "1×", "1,5×" (or "1.5×"), "2×". */
export const rateLabel = (r: VoiceRate, lang: 'ru' | 'en') => `${r.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')}×`;
