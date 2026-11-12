import { useEffect, useRef, useState } from 'react';

/** The recording formats a phone can make: iPhone (Safari) records MP4/AAC, others WebM/Opus. */
function pickMime(): string | undefined {
  const MR = typeof MediaRecorder !== 'undefined' ? MediaRecorder : undefined;
  if (!MR?.isTypeSupported) return undefined;
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((m) => MR.isTypeSupported(m));
}

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
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.current = s;
    const mime = pickMime();
    const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
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
