import { useEffect, useRef, useState } from 'react';

/** The recording formats a phone can make: iPhone (Safari) records MP4/AAC, Chrome MP4 or WebM with Opus. */
function pickMime(): string | undefined {
  const MR = typeof MediaRecorder !== 'undefined' ? MediaRecorder : undefined;
  if (!MR?.isTypeSupported) return undefined;
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((m) => MR.isTypeSupported(m));
}

/**
 * A voice, cleanly (v0.17.3): one channel at 48 kHz; the phone's own noise reduction (a garage is loud) and level
 * (near or far from the phone, the same loudness); no echo cancelling — nothing plays while it records, and it
 * only colours the voice. The recording at 128 kbit/s (Opus or AAC): clear speech, ~1 MB a minute.
 */
const VOICE: MediaTrackConstraints = {
  channelCount: { ideal: 1 },
  sampleRate: { ideal: 48000 },
  echoCancellation: false,
  noiseSuppression: true,
  autoGainControl: true,
};
const VOICE_BITS = 128_000;

export function canRecord(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * A voice message, like in a messenger: start, the seconds run, stop — the recording comes back
 * (or nothing, when cancelled). The microphone is let go as soon as it stops.
 */
export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const timer = useRef<number>();
  const done = useRef<((r: { blob: Blob; seconds: number } | null) => void) | null>(null);
  const cancelled = useRef(false);

  const release = () => {
    window.clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    rec.current = null;
    setRecording(false);
  };
  useEffect(() => () => {
    cancelled.current = true;
    rec.current?.state === 'recording' && rec.current.stop();
    release();
  }, []);

  /** Starts recording; the promise ends with the recording when it is stopped. */
  const start = async (): Promise<{ blob: Blob; seconds: number } | null> => {
    // A browser that cannot give that voice gives its own (never no recording for a setting); a "no" to the
    // microphone stays a no — it is not asked twice.
    const s = await navigator.mediaDevices
      .getUserMedia({ audio: VOICE })
      .catch((e: unknown) => ((e as Error)?.name === 'OverconstrainedError' || (e as Error)?.name === 'TypeError' ? navigator.mediaDevices.getUserMedia({ audio: true }) : Promise.reject(e)));
    stream.current = s;
    const mime = pickMime();
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(s, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: VOICE_BITS });
    } catch {
      r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
    }
    rec.current = r;
    chunks.current = [];
    cancelled.current = false;
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    const result = new Promise<{ blob: Blob; seconds: number } | null>((resolve) => (done.current = resolve));
    r.onstop = () => {
      const secs = (Date.now() - started.current) / 1000;
      const blob = new Blob(chunks.current, { type: r.mimeType || mime || 'audio/webm' });
      release();
      done.current?.(cancelled.current || !blob.size ? null : { blob, seconds: secs });
      done.current = null;
    };
    started.current = Date.now();
    setSeconds(0);
    timer.current = window.setInterval(() => setSeconds(Math.floor((Date.now() - started.current) / 1000)), 250);
    r.start(250);
    setRecording(true);
    return result;
  };
  const stop = () => rec.current?.state === 'recording' && rec.current.stop();
  const cancel = () => {
    cancelled.current = true;
    stop();
  };
  return { recording, seconds, start, stop, cancel };
}

/** 0:07, 1:24. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
