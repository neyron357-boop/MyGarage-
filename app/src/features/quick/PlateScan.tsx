import { IconCheck, IconScan } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tallyFrames, type FrameRead, type FrameTally } from '../../domain/plateScan';
import type { PlateFound } from '../../services/plateReader';
import { PlateText } from '../../ui/components';
import { haptic } from '../../ui/haptics';

/** What the camera reads, and where on the frame the plate was last seen. */
export type ScanTally = FrameTally & { box?: PlateFound['box'] };

/** How long a frame's reading counts (the camera moved off the plate: its readings fade). */
const FRESH_MS = 4000;

/**
 * The plate read while the camera is aimed (v0.33), over its picture: the frames are read one after another (quick, the
 * characters' way) and vote; the plate is ringed where it was last seen, and shown in a pill over the shutter — orange
 * while the frames do not agree yet, green with a tick when two of them do (a tap on it takes the photo, as the shutter).
 */
export function PlateScan({ video, live, onTally, onTap }: { video: HTMLVideoElement | null; live: boolean; onTally: (t: ScanTally | undefined) => void; onTap: () => void }) {
  const { t } = useTranslation();
  const [tally, setTally] = useState<ScanTally>();
  const [ring, setRing] = useState<{ left: number; top: number; width: number; height: number }>();
  const layer = useRef<HTMLDivElement>(null);
  const tell = useRef(onTally);
  tell.current = onTally;

  useEffect(() => {
    if (!video || !live) return;
    let stop = false;
    let timer = 0;
    let was = false;
    const seen: (FrameRead & { at: number; box?: PlateFound['box'] })[] = [];
    void import('../../services/plateReader').then(({ scanFrame, warmPlateReader }) => {
      warmPlateReader();
      const tick = async () => {
        if (stop) return;
        if (!document.hidden && video.readyState >= 2) {
          const r = await scanFrame(video).catch(() => undefined);
          if (stop) return;
          const now = performance.now();
          if (r) seen.push({ ...r, at: now });
          while (seen.length && now - seen[0].at > FRESH_MS) seen.shift();
          const tl = tallyFrames(seen);
          const box = tl ? [...seen].reverse().find((s) => s.number === tl.number)?.box : undefined;
          const next = tl && { ...tl, box };
          setTally(next);
          tell.current(next);
          // Where it is on the screen: the frame is shown whole (contain) in the finder.
          const el = layer.current;
          if (el && box && video.videoWidth) {
            const W = el.clientWidth;
            const H = el.clientHeight;
            const k = Math.min(W / video.videoWidth, H / video.videoHeight);
            const dw = video.videoWidth * k;
            const dh = video.videoHeight * k;
            setRing({ left: (W - dw) / 2 + box.x * dw, top: (H - dh) / 2 + box.y * dh, width: box.w * dw, height: box.h * dh });
          } else setRing(undefined);
          if (next?.stable && !was) haptic('success');
          was = !!next?.stable;
        }
        timer = window.setTimeout(() => void tick(), 60);
      };
      void tick();
    });
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [video, live]);

  const state = !tally ? 'looking' : tally.stable ? 'stable' : 'reading';
  return (
    <div ref={layer} className="plate-scan" data-state={state}>
      {ring && tally && <span className="plate-scan-ring" style={ring} aria-hidden />}
      {live && (
        <button
          type="button"
          className="plate-scan-pill glass"
          onClick={onTap}
          aria-label={tally ? `${t('quick.plateSeen')}: ${tally.code} ${tally.number}` : t('quick.plateLooking')}
          aria-live="polite"
        >
          {tally ? (
            <>
              <PlateText plate={{ emirate: tally.emirate ?? 'DXB', code: tally.code, number: tally.number }} size="sm" />
              {tally.stable && (
                <span className="plate-scan-tick" aria-hidden>
                  <IconCheck size={16} stroke={3} />
                </span>
              )}
            </>
          ) : (
            <span className="plate-scan-looking" aria-hidden>
              <IconScan size={20} stroke={2} />
              <span className="plate-scan-dots">
                <i />
                <i />
                <i />
              </span>
            </span>
          )}
        </button>
      )}
    </div>
  );
}
