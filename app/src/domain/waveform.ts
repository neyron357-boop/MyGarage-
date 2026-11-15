/*
 * The picture of a voice message, as a messenger draws it: a row of bars, each as loud as its slice of the
 * recording. Quiet speech still shows (the loudness is lifted by a square root), silence is a dot.
 */

export const WAVE_BARS = 36;
/** The lowest bar: silence is a dot, not a gap. */
const FLOOR = 0.12;

/** The bars (0–1, two decimals) of a recording's samples (−1…1). */
export function peaksOf(samples: ArrayLike<number>, bars = WAVE_BARS): number[] {
  const n = samples.length;
  if (!n) return Array.from({ length: bars }, () => FLOOR);
  const step = n / bars;
  const loud: number[] = [];
  for (let b = 0; b < bars; b++) {
    const from = Math.floor(b * step);
    const to = Math.max(from + 1, Math.min(n, Math.floor((b + 1) * step)));
    // Up to ~512 samples a bar: enough to hear a slice, quick for minutes of recording.
    const stride = Math.max(1, Math.floor((to - from) / 512));
    let sum = 0;
    let count = 0;
    for (let i = from; i < to; i += stride) {
      sum += samples[i] * samples[i];
      count++;
    }
    loud.push(Math.sqrt(sum / Math.max(1, count)));
  }
  const top = Math.max(...loud);
  return loud.map((v) => Math.round(Math.max(FLOOR, top > 0 ? Math.sqrt(v / top) : 0) * 100) / 100);
}

/** Bars for a recording not read yet (or unreadable): low and even. */
export const flatPeaks = (bars = WAVE_BARS): number[] => Array.from({ length: bars }, () => FLOOR);
