import { Button, Loader } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBolt, IconBoltOff, IconCameraOff, IconChevronRight, IconDeviceMobileRotated, IconId, IconPhotoScan, IconPlus, IconX } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { Inspection, Media } from '../domain/types';
import { addInspectionPhoto } from '../services/inspections';
import { mediaUrl } from '../services/media';
import { AngleHint, hasAngleHint, WalkMap } from './AngleHint';
import { CAMERA_NOT_READY, cameraErrorKind, captureFrame, openBackCamera, setTorch, torchSupported, waitForFrames, type CameraError } from './camera';
import { haptic } from './haptics';
import { useHistoryLayer, useLockScroll } from './historyLayer';
import { useErrorText } from './hooks';
import { SuccessMark } from './components';

/** Free extra photos: every shot is added, the camera stays on this slot. */
const FREE = 'extra';

export interface WalkaroundCameraProps {
  insp: Inspection;
  /** Photos of this act (live from the database). */
  media: Media[];
  /** The walk-around itself; when all of them are taken the camera says so. */
  slots: readonly string[];
  /** Optional photos offered after the walk-around (wheels, windshield…, `extra` = any number). */
  extraSlots?: readonly string[];
  /** Slot to start from (a tapped tile); by default the first one without a photo. */
  start?: string;
  /** Handover: the check-in photos, shown see-through to repeat the angle. */
  before?: Media[];
  onClose: () => void;
  /** No camera access: take this slot with the phone's own camera instead. */
  onSystemCamera?: (slot: string) => void;
  /** Slots that hold several photos (damage close-ups): a new photo never replaces the old one. */
  append?: boolean;
  /** Called with each stored photo (to link a close-up to its damage mark). */
  onSaved?: (m: Media) => void | Promise<void>;
}

function useThumbUrl(id?: string, thumb = true) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    if (id) void mediaUrl(id, thumb).then((u) => alive && setUrl(u));
    else setUrl(undefined);
    return () => {
      alive = false;
    };
  }, [id, thumb]);
  return url;
}

function StripItem({ slot, active, mediaId, localUrl, onClick, label }: { slot: string; active: boolean; mediaId?: string; localUrl?: string; onClick: () => void; label: string }) {
  const dbUrl = useThumbUrl(localUrl ? undefined : mediaId);
  const url = localUrl ?? dbUrl;
  return (
    <button type="button" className="cam-strip-item" data-active={active} data-done={!!url} onClick={onClick} aria-label={label} aria-current={active}>
      {url ? <img src={url} alt="" key={url} /> : slot === FREE ? <IconPlus size={18} /> : hasAngleHint(slot) ? <AngleHint slot={slot} size={34} /> : <IconId size={20} />}
    </button>
  );
}

/**
 * Full-screen camera for the photos of an act. One tap per angle: the photo is saved in the
 * background and the camera moves on to the next angle by itself, the map shows where to stand.
 */
export function WalkaroundCamera({ insp, media, slots, extraSlots = [], start, before, onClose, onSystemCamera, append, onSaved }: WalkaroundCameraProps) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const all = useMemo(() => [...slots, ...extraSlots], [slots, extraSlots]);
  const single = all.length === 1;

  const video = useRef<HTMLVideoElement>(null);
  const finder = useRef<HTMLDivElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const closing = useRef(false);
  const urls = useRef<string[]>([]);

  // Photos taken in this session, shown before the database has them (slot → object URL).
  const [local, setLocal] = useState<Record<string, string>>({});
  const stored = useMemo(() => {
    const m = new Map<string, Media>();
    for (const x of media) if (x.kind === 'photo' && !m.has(x.slot)) m.set(x.slot, x);
    return m;
  }, [media]);
  const has = useCallback((s: string) => !!local[s] || stored.has(s), [local, stored]);
  const firstEmpty = all.find((s) => s !== FREE && !has(s));

  const [current, setCurrent] = useState<string>(() => start ?? firstEmpty ?? slots[0] ?? all[0]);
  const [phase, setPhase] = useState<'starting' | 'live' | 'error' | 'done'>('starting');
  const [error, setError] = useState<CameraError>('busy');
  const [torch, setTorchOn] = useState(false);
  const [canTorch, setCanTorch] = useState(false);
  const [ghost, setGhost] = useState(true);
  const [flash, setFlash] = useState(0);
  const [pending, setPending] = useState(0);
  const [shooting, setShooting] = useState(false);
  const [shots, setShots] = useState(0);
  const [lastUrl, setLastUrl] = useState<string>();
  const [portrait, setPortrait] = useState(() => window.matchMedia('(orientation: portrait)').matches);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((tr) => tr.stop());
    stream.current = null;
    setTorchOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setPhase((p) => (p === 'done' ? p : 'starting'));
    try {
      const s = await openBackCamera();
      if (closing.current) {
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
      if (closing.current) return;
      setPhase((p) => (p === 'done' ? p : 'live'));
    } catch (e) {
      setError(cameraErrorKind(e));
      setPhase('error');
    }
  }, []);

  // Camera on while the screen is open and visible; off in the background (the phone's camera
  // light must not stay on when the app is switched away).
  useEffect(() => {
    void startCamera();
    const onVis = () => {
      if (document.hidden) stop();
      else if (!stream.current && !closing.current) void startCamera();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      stop();
    };
  }, [startCamera, stop]);

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)');
    const on = () => setPortrait(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  /** Close once every photo is stored. `popped`: Back already removed our history entry. */
  const finishRef = useRef<(popped?: boolean) => Promise<void>>(async () => undefined);
  // The page underneath must not scroll; the phone's Back button closes the camera.
  useLockScroll();
  const release = useHistoryLayer('mgCamera', () => void finishRef.current(true));
  const finish = useCallback(
    async (popped = false) => {
      if (closing.current) return;
      closing.current = true;
      stop();
      await queue.current.catch(() => undefined);
      if (!popped) release();
      onClose();
    },
    [onClose, stop, release],
  );
  finishRef.current = finish;

  useEffect(
    () => () => {
      for (const u of urls.current) URL.revokeObjectURL(u);
    },
    [],
  );

  const nextAfter = (slot: string, taken: Set<string>): string | undefined => {
    const empty = (s: string) => s !== FREE && !taken.has(s);
    const inMain = slots.includes(slot);
    const list = inMain ? slots : extraSlots;
    const i = list.indexOf(slot);
    const rotated = [...list.slice(i + 1), ...list.slice(0, i)];
    return rotated.find(empty) ?? (inMain ? undefined : extraSlots.includes(FREE) ? FREE : undefined);
  };

  const goTo = (slot: string) => {
    setCurrent(slot);
    if (phase === 'done') setPhase(stream.current ? 'live' : 'starting');
  };

  const shoot = async () => {
    const v = video.current;
    const box = finder.current?.getBoundingClientRect();
    if (phase !== 'live' || shooting || !v || !box) return;
    setShooting(true);
    haptic('medium');
    setFlash((n) => n + 1);
    const slot = current;
    try {
      const { blob, thumb } = await captureFrame(v, { w: box.width, h: box.height });
      const url = URL.createObjectURL(thumb);
      urls.current.push(url);
      setLastUrl(url);
      setShots((n) => n + 1);
      if (slot !== FREE && !append) setLocal((l) => ({ ...l, [slot]: url }));
      setPending((n) => n + 1);
      queue.current = queue.current
        .then(async () => {
          const m = await addInspectionPhoto(insp.id, slot, blob, { thumb, replace: slot !== FREE && !append });
          await onSaved?.(m);
        })
        .catch((e) => {
          console.error(e);
          notifications.show({ color: 'red', message: errorText(e) });
          setLocal((l) => {
            const n = { ...l };
            delete n[slot];
            return n;
          });
        })
        .finally(() => setPending((n) => n - 1));

      if (single) {
        void finish();
        return;
      }
      if (slot === FREE) return;
      const taken = new Set(all.filter((s) => s === slot || has(s)));
      const next = nextAfter(slot, taken);
      if (next) setCurrent(next);
      else if (slots.includes(slot)) {
        haptic('success');
        setPhase('done');
      }
    } catch (e) {
      // No frame yet (the camera is waking up): nothing is saved, the same angle stays.
      if ((e as Error)?.message !== CAMERA_NOT_READY) notifications.show({ color: 'red', message: errorText(e) });
    } finally {
      setShooting(false);
    }
  };

  const skip = () => {
    const taken = new Set(all.filter((s) => s === current || has(s)));
    const next = nextAfter(current, taken);
    if (next) setCurrent(next);
    else if (slots.includes(current)) setPhase('done');
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

  // Keep the current angle visible in the strip.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = strip.current;
    const el = root?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!root || !el) return;
    root.scrollTo({ left: Math.max(0, el.offsetLeft - root.clientWidth / 2 + el.offsetWidth / 2), behavior: 'smooth' });
  }, [current, phase]);

  const ghostMedia = before?.find((m) => m.slot === current && m.kind === 'photo');
  const ghostUrl = useThumbUrl(ghostMedia?.id, false);
  const mainDone = slots.filter(has).length;
  const inMain = slots.includes(current);
  const exterior = inMain && slots.length > 1;
  const title = phase === 'done' ? t('camera.walkDone') : t(`slot.${current}`);
  const counter = phase === 'done' ? t('camera.progress', { n: mainDone, total: slots.length }) : inMain && slots.length > 1 ? t('camera.of', { n: slots.indexOf(current) + 1, total: slots.length }) : t('camera.optional');
  const doneSet = useMemo(() => new Set(all.filter(has)), [all, has]);

  return createPortal(
    <div className="cam" role="dialog" aria-modal="true" aria-label={t('camera.title')} data-portrait={portrait}>
      <div className="cam-top">
        <button type="button" className="cam-icon" onClick={() => void finish()} aria-label={t('camera.close')}>
          <IconX size={22} />
        </button>
        <div className="cam-title" key={current}>
          <div className="cam-title-main">{title}</div>
          {!single && <div className="cam-title-sub">{counter}</div>}
        </div>
        {canTorch ? (
          <button type="button" className="cam-icon" data-on={torch} onClick={() => void toggleTorch()} aria-label={t('camera.torch')} aria-pressed={torch}>
            {torch ? <IconBolt size={21} /> : <IconBoltOff size={21} />}
          </button>
        ) : (
          <span className="cam-icon-spacer" />
        )}
      </div>

      <div className="cam-finder" ref={finder}>
        <video ref={video} playsInline muted autoPlay className="cam-video" />
        {ghostUrl && ghost && phase === 'live' && <img src={ghostUrl} alt="" className="cam-ghost" />}
        <div className="cam-grid" aria-hidden />
        {flash > 0 && <div className="cam-flash" key={flash} aria-hidden />}
        {exterior && phase === 'live' && (
          <div className="cam-map">
            <WalkMap slots={slots} current={current} done={doneSet} />
          </div>
        )}
        {ghostMedia && phase === 'live' && (
          <button type="button" className="cam-pill cam-ghost-toggle" data-on={ghost} onClick={() => setGhost((g) => !g)} aria-pressed={ghost}>
            <IconPhotoScan size={16} /> {t('camera.ghost')}
          </button>
        )}
        {exterior && portrait && shots === 0 && phase === 'live' && (
          <div className="cam-pill cam-rotate">
            <IconDeviceMobileRotated size={16} /> {t('camera.rotate')}
          </div>
        )}
        {phase === 'starting' && (
          <div className="cam-center">
            <Loader color="white" size="sm" />
            <span>{t('camera.starting')}</span>
          </div>
        )}
        {phase === 'error' && (
          <div className="cam-center cam-dim">
            <div className="cam-card rise-enter">
              <IconCameraOff size={30} />
              <div className="cam-card-title">{t(error === 'denied' ? 'camera.noAccess' : 'camera.noCamera')}</div>
              <div className="cam-card-text">{t(error === 'denied' ? 'camera.noAccessHint' : 'camera.noCameraHint')}</div>
              {onSystemCamera && (
                <Button
                  mt="sm"
                  radius="xl"
                  size="md"
                  fullWidth
                  onClick={() => {
                    // The phone camera opens only from the tap itself, so first open it, then close this screen.
                    onSystemCamera(current);
                    void finish();
                  }}
                >
                  {t('camera.systemCamera')}
                </Button>
              )}
              {error !== 'denied' && (
                <Button mt={6} variant="subtle" color="gray" radius="xl" fullWidth onClick={() => void startCamera()}>
                  {t('camera.retry')}
                </Button>
              )}
            </div>
          </div>
        )}
        {phase === 'done' && (
          <div className="cam-center cam-dim">
            <div className="cam-card rise-enter">
              <SuccessMark size={56} />
              <div className="cam-card-title">{t('camera.allDone', { n: slots.length })}</div>
              {extraSlots.length > 0 && <div className="cam-card-text">{t('camera.allDoneHint')}</div>}
              <Button mt="sm" radius="xl" size="md" fullWidth onClick={() => void finish()}>
                {t('camera.finish')}
              </Button>
              {extraSlots.length > 0 && (
                <Button mt={6} radius="xl" variant="subtle" color="gray" fullWidth onClick={() => goTo(extraSlots.find((s) => s !== FREE && !has(s)) ?? FREE)}>
                  {t('camera.more')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {!single && (
        <div className="cam-strip" role="tablist" ref={strip}>
          {all.map((s) => (
            <StripItem
              key={s}
              slot={s}
              active={s === current && phase !== 'done'}
              mediaId={stored.get(s)?.id}
              localUrl={local[s]}
              label={t(`slot.${s}`)}
              onClick={() => goTo(s)}
            />
          ))}
        </div>
      )}

      <div className="cam-controls">
        <div className="cam-side">
          {lastUrl ? (
            <span className="cam-last" key={lastUrl}>
              <img src={lastUrl} alt="" />
            </span>
          ) : (
            !single && <span className="cam-count">{t('camera.progress', { n: mainDone, total: slots.length })}</span>
          )}
        </div>
        <button type="button" className="cam-shutter" onClick={() => void shoot()} disabled={phase !== 'live' || shooting} aria-label={t('camera.shutter')}>
          <span />
        </button>
        <div className="cam-side cam-side-end">
          {pending > 0 ? (
            <span className="cam-saving">
              <Loader color="white" size={14} /> {t('camera.saving')}
            </span>
          ) : single ? null : mainDone === slots.length || current === FREE ? (
            <button type="button" className="cam-text" onClick={() => void finish()}>
              {t('camera.finish')}
            </button>
          ) : (
            <button type="button" className="cam-text" onClick={skip}>
              {t('camera.skip')} <IconChevronRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
