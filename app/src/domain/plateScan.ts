import type { Emirate } from './types';

/*
 * A plate read off the camera's frames as they come (v0.33): each frame read on its own is a vote — one blurred by the
 * hand, one in glare, the next sharp; what the frames agree on is the plate. The last few frames count (a car may be
 * changed for another one by turning the phone).
 */

/** What one frame read. */
export interface FrameRead {
  number: string;
  code: string;
  emirate?: Emirate;
  /** The frame's own readings agreed. */
  sure: boolean;
}

export interface FrameTally {
  number: string;
  code: string;
  emirate?: Emirate;
  /** Frames that gave this number (a sure one counts one, an unsure one half). */
  frames: number;
  /** Frames that gave this code with it. */
  codeFrames: number;
  /** Two frames' worth agree on the number (three for a number of one or two digits), and on its code (or no frame read one). */
  stable: boolean;
}

/** How many of the last frames are counted. */
export const FRAMES = 8;

/** The plate the last frames agree on. */
export function tallyFrames(seen: FrameRead[], last = FRAMES): FrameTally | undefined {
  const frames = seen.slice(-last);
  const numbers = new Map<string, number>();
  for (const f of frames) numbers.set(f.number, (numbers.get(f.number) ?? 0) + (f.sure ? 1 : 0.5));
  let number = '';
  let weight = 0;
  for (const [n, w] of numbers) if (w > weight || (w === weight && n.length > number.length)) (number = n), (weight = w);
  if (!number) return undefined;
  const mine = frames.filter((f) => f.number === number);
  const codes = new Map<string, number>();
  for (const f of mine) if (f.code) codes.set(f.code, (codes.get(f.code) ?? 0) + (f.sure ? 1 : 0.5));
  let code = '';
  let codeWeight = 0;
  for (const [c, w] of codes) if (w > codeWeight) (code = c), (codeWeight = w);
  const emirates = new Map<Emirate, number>();
  for (const f of mine) if (f.emirate) emirates.set(f.emirate, (emirates.get(f.emirate) ?? 0) + 1);
  let emirate: Emirate | undefined;
  let named = 0;
  for (const [e, k] of emirates) if (k > named) (emirate = e), (named = k);
  // Another number as strong as this one: the frames do not agree yet.
  const rival = [...numbers.entries()].some(([n, w]) => n !== number && w >= weight);
  // A number of one or two digits (rare plates, and what a mark of anything may read as) wants a third frame; so does a
  // number no frame read a code with (the code read beside it is half the proof it is a plate's).
  const stable = !rival && weight >= (number.length >= 3 && codes.size ? 2 : 3) && (codeWeight >= 2 || codes.size === 0);
  return { number, code, emirate, frames: weight, codeFrames: codeWeight, stable };
}
