/*
 * The camera inside the app (v0.31; the walk-around camera's, v0.4–v0.20, learned on the iPhone). It needs a secure
 * page (https or localhost); over plain http in the local network there is none — the phone's own camera then.
 */

export function liveCameraAvailable(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
}

/** The back camera, 4:3 (the whole sensor), up to 1920 px on the long side — as the walk-around camera took. */
export async function openBackCamera(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
    });
  } catch (e) {
    if ((e as Error).name !== 'OverconstrainedError') throw e;
    return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } });
  }
}

export type CameraError = 'denied' | 'none' | 'busy';

export function cameraErrorKind(e: unknown): CameraError {
  const name = (e as Error)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'none';
  return 'busy';
}

export function torchSupported(track?: MediaStreamTrack): boolean {
  const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
  return !!caps?.torch;
}

export async function setTorch(track: MediaStreamTrack, on: boolean): Promise<void> {
  await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
}

const MIN_FRAME = 240;

/** Resolves when the video shows real frames (not the placeholder size a video has before the first one). */
export function waitForFrames(video: HTMLVideoElement, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => video.videoWidth >= MIN_FRAME && video.videoHeight >= MIN_FRAME && video.readyState >= 2;
    if (ok()) return resolve();
    const events = ['loadeddata', 'resize', 'playing', 'canplay'] as const;
    const check = () => {
      if (!ok()) return;
      done();
      resolve();
    };
    const timer = window.setTimeout(() => {
      done();
      reject(new Error('camera_not_ready'));
    }, timeoutMs);
    const done = () => {
      window.clearTimeout(timer);
      for (const e of events) video.removeEventListener(e, check);
    };
    for (const e of events) video.addEventListener(e, check);
  });
}

/** The frame on screen now, whole (the finder shows all of it), as a JPEG photo. */
export function captureFrame(video: HTMLVideoElement): Promise<File> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (w < MIN_FRAME || h < MIN_FRAME) return Promise.reject(new Error('camera_not_ready'));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(video, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(new File([b], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' })) : reject(new Error('camera_not_ready'))), 'image/jpeg', 0.9),
  );
}
