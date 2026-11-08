/**
 * In-app camera helpers. The live camera needs a secure page (https or localhost) and is used on
 * touch screens only: on a PC the file picker is the better tool (photos from the phone, a scanner).
 */
export function inAppCameraAvailable(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return false;
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

/** The back camera, 4:3 (the whole sensor, the widest view of the car), up to 1920 px on the long side. */
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

export const CAMERA_NOT_READY = 'camera_not_ready';
const MIN_FRAME = 240;

/** Resolves when the video shows real camera frames (not the placeholder size before the first one). */
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
      reject(new Error(CAMERA_NOT_READY));
    }, timeoutMs);
    const done = () => {
      window.clearTimeout(timer);
      for (const e of events) video.removeEventListener(e, check);
    };
    for (const e of events) video.addEventListener(e, check);
  });
}

const toJpeg = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality));

/**
 * Take exactly what the viewfinder shows: the video is drawn with `object-fit: cover` into a box of
 * `box` CSS pixels, so the photo is the centre crop of the frame with the box's proportions. The stored
 * photo is at most `maxSide` px (the same size the app keeps for picked photos) plus a 400 px thumbnail.
 */
export async function captureFrame(video: HTMLVideoElement, box: { w: number; h: number }, maxSide = 1920): Promise<{ blob: Blob; thumb: Blob }> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  // Until the first real frame arrives a video reports a tiny placeholder size: never save that.
  if (vw < MIN_FRAME || vh < MIN_FRAME) throw new Error(CAMERA_NOT_READY);
  const scale = Math.max(box.w / vw, box.h / vh);
  const sw = Math.min(vw, box.w / scale);
  const sh = Math.min(vh, box.h / scale);
  const sx = (vw - sw) / 2;
  const sy = (vh - sh) / 2;
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const full = document.createElement('canvas');
  full.width = Math.round(sw * k);
  full.height = Math.round(sh * k);
  full.getContext('2d')!.drawImage(video, sx, sy, sw, sh, 0, 0, full.width, full.height);
  // The thumbnail comes from the same still, not from a later video frame.
  const t = Math.min(1, 400 / Math.max(full.width, full.height));
  const small = document.createElement('canvas');
  small.width = Math.round(full.width * t);
  small.height = Math.round(full.height * t);
  small.getContext('2d')!.drawImage(full, 0, 0, small.width, small.height);
  const [blob, thumb] = await Promise.all([toJpeg(full, 0.86), toJpeg(small, 0.72)]);
  return { blob, thumb };
}
