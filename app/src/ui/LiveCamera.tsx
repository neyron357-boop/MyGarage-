import { Button, Loader } from '@mantine/core';
import { IconBolt, IconBoltOff, IconCameraOff, IconPhoto, IconX } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cameraErrorKind, captureFrame, openBackCamera, setTorch, torchSupported, waitForFrames, type CameraError } from './camera';
import { haptic } from './haptics';
import { useHistoryLayer, useLockScroll } from './historyLayer';

/**
 * The camera inside the app (v0.31). «Фото номера» runs where a finger that slid onto it lets go — and the iPhone opens
 * its own camera (a file picker) only for a tap, never at the end of a slide; so the app shows a camera itself, at
 * once. One tap on the shutter and the photo goes on (no "Use photo" step after it). Beside the shutter — the phone's
 * photos; no access to the camera — the phone's own camera, a tap away. Back and × close it.
 */
export function LiveCamera({
  label,
  onShot,
  onClose,
}: {
  label: string;
  /** The photo (taken here, or picked from the phone): the camera has gone and its step in the history with it. */
  onShot: (file: File) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const photos = useRef<HTMLInputElement>(null);
  const system = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const closing = useRef(false);
  const [phase, setPhase] = useState<'starting' | 'live' | 'error'>('starting');
  const [error, setError] = useState<CameraError>('busy');
  const [torch, setTorchOn] = useState(false);
  const [canTorch, setCanTorch] = useState(false);
  const [flash, setFlash] = useState(0);
  const [busy, setBusy] = useState(false);

  /** Each opening counts: a camera that comes after it was let go (stopped, closed, opened again) is let go at once. */
  const opening = useRef(0);
  const stop = useCallback(() => {
    opening.current++;
    stream.current?.getTracks().forEach((tr) => tr.stop());
    stream.current = null;
    setTorchOn(false);
  }, []);

  const start = useCallback(async () => {
    const mine = ++opening.current;
    const stale = () => mine !== opening.current || closing.current;
    setPhase('starting');
    try {
      const s = await openBackCamera();
      if (stale()) {
        s.getTracks().forEach((tr) => tr.stop());
        return;
      }
      stream.current = s;
      setCanTorch(torchSupported(s.getVideoTracks()[0]));
      const v = video.current;
      if (v) {
        v.srcObject = s;
        // Not awaited: a browser may hold play() back; what matters is that real frames arrive.
        void v.play().catch(() => undefined);
        await waitForFrames(v);
      }
      if (!stale()) setPhase('live');
    } catch (e) {
      if (stale()) return;
      stream.current?.getTracks().forEach((tr) => tr.stop());
      stream.current = null;
      setError(cameraErrorKind(e));
      setPhase('error');
    }
  }, []);

  // The camera is let go while the app is away (the phone takes it anyway) and taken again when it is back.
  useEffect(() => {
    // Mounted again (React's double mount in development): open again.
    closing.current = false;
    void start();
    const onVis = () => {
      if (document.hidden) stop();
      else if (!stream.current && !closing.current) void start();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      closing.current = true;
      document.removeEventListener('visibilitychange', onVis);
      stop();
    };
  }, [start, stop]);

  useLockScroll();
  const finishRef = useRef<(popped?: boolean) => void>(() => undefined);
  const release = useHistoryLayer('mgCamera', () => finishRef.current(true));
  const finish = useCallback(
    (popped = false) => {
      if (closing.current) return;
      closing.current = true;
      stop();
      if (!popped) release();
      onClose();
    },
    [onClose, stop, release],
  );
  finishRef.current = finish;

  /**
   * Gone with a photo: the camera's step in the history first (Back from what comes next is the screen under it, not
   * this camera's leftover step), then the photo on — once the step is popped (a moment; at most 400 ms).
   */
  const leave = (file: File) => {
    closing.current = true;
    stop();
    if (!history.state?.mgCamera) return onShot(file);
    let timer = 0;
    const go = () => {
      window.removeEventListener('popstate', go);
      window.clearTimeout(timer);
      onShot(file);
    };
    window.addEventListener('popstate', go);
    timer = window.setTimeout(go, 400);
    release();
  };
  const picked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (file) leave(file);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && finishRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const shoot = async () => {
    const v = video.current;
    if (phase !== 'live' || busy || !v) return;
    setBusy(true);
    haptic('medium');
    setFlash((n) => n + 1);
    try {
      leave(await captureFrame(v));
    } catch {
      setBusy(false);
    }
  };

  const toggleTorch = async () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await setTorch(track, !torch);
      setTorchOn(!torch);
    } catch {
      setCanTorch(false);
    }
  };

  return createPortal(
    <div className="cam" role="dialog" aria-modal="true" aria-label={label} data-phase={phase}>
      <input ref={photos} type="file" accept="image/*" hidden data-cam-photos onChange={picked} />
      <input ref={system} type="file" accept="image/*" capture="environment" hidden data-cam-system onChange={picked} />
      <div className="cam-top">
        <button type="button" className="cam-icon" onClick={() => finish()} aria-label={t('camera.close')}>
          <IconX size={22} />
        </button>
        {canTorch ? (
          <button type="button" className="cam-icon" data-on={torch} onClick={() => void toggleTorch()} aria-label={t('camera.torch')} aria-pressed={torch}>
            {torch ? <IconBolt size={21} /> : <IconBoltOff size={21} />}
          </button>
        ) : (
          <span className="cam-icon-spacer" />
        )}
      </div>
      <div className="cam-finder">
        <video ref={video} playsInline muted autoPlay className="cam-video" />
        {flash > 0 && <div className="cam-flash" key={flash} aria-hidden />}
        {phase === 'starting' && (
          <div className="cam-center">
            <Loader color="white" size="sm" />
          </div>
        )}
        {phase === 'error' && (
          <div className="cam-center">
            <div className="cam-card rise-enter">
              <IconCameraOff size={30} />
              <div className="cam-card-title">{t(error === 'denied' ? 'camera.noAccess' : 'camera.noCamera')}</div>
              <Button mt="sm" radius="xl" size="md" fullWidth onClick={() => system.current?.click()}>
                {t('camera.system')}
              </Button>
              {error !== 'denied' && (
                <Button mt={6} variant="subtle" color="gray" radius="xl" fullWidth onClick={() => void start()}>
                  {t('camera.retry')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="cam-controls">
        <div className="cam-side">
          <button type="button" className="cam-icon cam-photos" onClick={() => photos.current?.click()} aria-label={t('camera.photos')}>
            <IconPhoto size={22} />
          </button>
        </div>
        <button type="button" className="cam-shutter" onClick={() => void shoot()} disabled={phase !== 'live' || busy} aria-label={t('camera.shoot')}>
          <span />
        </button>
        <div className="cam-side cam-side-end" />
      </div>
    </div>,
    document.body,
  );
}
