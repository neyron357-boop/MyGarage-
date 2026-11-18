import { IconDownload, IconPlayerPauseFilled, IconPlayerPlayFilled, IconShare2, IconVolume, IconVolumeOff, IconX } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useHistoryLayer, useLockScroll } from './historyLayer';
import { clock } from './recorder';
import { canShareFile, shareOrDownload } from './share';

/**
 * A video started right in the tap that opens it (v0.32): the iPhone plays one with its sound only in a tap — the
 * player takes this same element, already playing, onto its screen.
 */
export function startVideo(url: string): HTMLVideoElement {
  const v = document.createElement('video');
  v.src = url;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.preload = 'auto';
  v.className = 'vp-video';
  void v.play().catch(() => undefined);
  return v;
}

/** How long the bars stay up while it plays, after the last touch. */
const CHROME_MS = 2600;

/**
 * A video as the messengers play one (v0.32): on the whole screen, black around it. A tap shows or hides the bars; ▶ / ❚❚
 * large in the middle; at the bottom where it is and how long, a line to drag through it, the sound on or off; at the
 * top × and the share sheet (on an iPhone — "Save Video" to Photos, WhatsApp…). Back, Esc and a pull down close it.
 */
export function VideoPlayer({ video, file, title, onClose }: { video: HTMLVideoElement; file?: () => Promise<File | undefined>; title?: string; onClose: () => void }) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const now = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(!video.paused);
  const [chrome, setChrome] = useState(true);
  const [dur, setDur] = useState(Number.isFinite(video.duration) ? video.duration : 0);
  const [muted, setMuted] = useState(video.muted);
  const [shared, setShared] = useState<File>();
  const hide = useRef(0);
  const scrub = useRef<{ was: boolean } | null>(null);
  const pull = useRef<{ y: number; x: number; dy: number; moved: boolean } | null>(null);

  useLockScroll();
  const release = useHistoryLayer('mgVideo', onClose);
  const close = useCallback(() => {
    video.pause();
    release();
    onClose();
  }, [video, release, onClose]);
  const closeRef = useRef(close);
  closeRef.current = close;

  // The element onto the screen; taken off when the player goes (off the page it stops by itself — not when it is put
  // straight back, as React does once more in development).
  useEffect(() => {
    stage.current?.appendChild(video);
    return () => video.remove();
  }, [video]);

  // Where it is: written straight into the line and the clock, a frame at a time while it plays (no render per frame).
  useEffect(() => {
    let raf = 0;
    const paint = () => {
      const d = Number.isFinite(video.duration) ? video.duration : 0;
      const p = d ? Math.min(1, video.currentTime / d) : 0;
      root.current?.style.setProperty('--p', String(p));
      if (now.current) now.current.textContent = clock(video.currentTime);
    };
    const loop = () => {
      paint();
      raf = requestAnimationFrame(loop);
    };
    const onPlay = () => {
      setPlaying(true);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(raf);
      paint();
      setChrome(true);
    };
    const onMeta = () => setDur(Number.isFinite(video.duration) ? video.duration : 0);
    const onVolume = () => setMuted(video.muted);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onPause);
    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('durationchange', onMeta);
    video.addEventListener('seeked', paint);
    video.addEventListener('volumechange', onVolume);
    if (!video.paused) onPlay();
    else paint();
    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onPause);
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('durationchange', onMeta);
      video.removeEventListener('seeked', paint);
      video.removeEventListener('volumechange', onVolume);
    };
  }, [video]);

  // The bars go a while after the last touch while it plays; they stay while it is paused.
  const wake = useCallback(() => {
    setChrome(true);
    window.clearTimeout(hide.current);
    hide.current = window.setTimeout(() => !video.paused && !scrub.current && setChrome(false), CHROME_MS);
  }, [video]);
  useEffect(() => {
    if (playing) wake();
    return () => window.clearTimeout(hide.current);
  }, [playing, wake]);

  // The file to share, read once — after the video has enough to play (v0.42.3): it does not take the video's own
  // bandwidth (through the garage's tunnel the two went at once, and the video waited).
  useEffect(() => {
    let alive = true;
    let asked = false;
    const read = () => {
      if (asked) return;
      asked = true;
      void file?.().then((f) => alive && setShared(f));
    };
    video.addEventListener('canplaythrough', read, { once: true });
    const late = window.setTimeout(read, 8000);
    return () => {
      alive = false;
      window.clearTimeout(late);
      video.removeEventListener('canplaythrough', read);
    };
  }, [file, video]);

  const toggle = () => {
    if (video.paused) {
      if (video.ended || (dur && video.currentTime >= dur - 0.05)) video.currentTime = 0;
      void video.play().catch(() => undefined);
    } else video.pause();
    wake();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      else if (e.key === ' ') {
        e.preventDefault();
        if (video.paused) void video.play().catch(() => undefined);
        else video.pause();
      } else if (e.key === 'ArrowRight') video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
      else if (e.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - 5);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [video]);

  /** The line dragged: the place follows the finger (the video waits meanwhile), and plays on from there if it played. */
  const seekTo = (clientX: number) => {
    const r = bar.current?.getBoundingClientRect();
    const d = Number.isFinite(video.duration) ? video.duration : dur;
    if (!r || !d) return;
    const p = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    root.current?.style.setProperty('--p', String(p));
    if (now.current) now.current.textContent = clock(p * d);
    video.currentTime = p * d;
  };

  const p0 = Number.isFinite(video.duration) && video.duration ? video.currentTime / video.duration : 0;
  return createPortal(
    <div
      ref={root}
      className="vp"
      role="dialog"
      aria-modal="true"
      aria-label={title || t('notes.video')}
      data-chrome={chrome}
      data-playing={playing || undefined}
      style={{ '--p': p0 } as React.CSSProperties}
    >
      <div className="vp-top">
        <button type="button" className="cam-icon" onClick={() => close()} aria-label={t('camera.close')}>
          <IconX size={22} />
        </button>
        <div className="vp-title">{title}</div>
        {file ? (
          <button type="button" className="cam-icon" disabled={!shared} aria-label={canShareFile(shared) ? t('photos.share') : t('photos.save')} onClick={() => shared && shareOrDownload(shared)}>
            {canShareFile(shared) || !shared ? <IconShare2 size={21} /> : <IconDownload size={21} />}
          </button>
        ) : (
          <span className="cam-icon-spacer" />
        )}
      </div>
      <div
        ref={stage}
        className="vp-stage"
        onPointerDown={(e) => {
          if ((e.target as Element).closest('button')) return;
          pull.current = { x: e.clientX, y: e.clientY, dy: 0, moved: false };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const s = pull.current;
          if (!s) return;
          const dy = e.clientY - s.y;
          if (!s.moved && Math.hypot(e.clientX - s.x, dy) > 10) s.moved = true;
          if (!s.moved) return;
          s.dy = Math.max(0, dy);
          root.current?.style.setProperty('--pull', `${s.dy}px`);
          root.current?.setAttribute('data-pulling', '');
        }}
        onPointerUp={() => {
          const s = pull.current;
          pull.current = null;
          root.current?.removeAttribute('data-pulling');
          if (!s) return;
          if (!s.moved) {
            // A tap: the bars on or off (paused, they stay).
            if (video.paused) setChrome(true);
            else if (chrome) {
              window.clearTimeout(hide.current);
              setChrome(false);
            } else wake();
            return;
          }
          if (s.dy > 120) close();
          else root.current?.style.setProperty('--pull', '0px');
        }}
        onPointerCancel={() => {
          pull.current = null;
          root.current?.removeAttribute('data-pulling');
          root.current?.style.setProperty('--pull', '0px');
        }}
      >
        <button type="button" className="vp-big" onClick={toggle} aria-label={playing ? t('notes.pause') : t('notes.play')}>
          {playing ? <IconPlayerPauseFilled size={30} /> : <IconPlayerPlayFilled size={30} />}
        </button>
      </div>
      <div className="vp-bottom">
        <button type="button" className="cam-icon vp-play" onClick={toggle} aria-label={playing ? t('notes.pause') : t('notes.play')}>
          {playing ? <IconPlayerPauseFilled size={20} /> : <IconPlayerPlayFilled size={20} />}
        </button>
        <span ref={now} className="vp-time">
          {clock(video.currentTime)}
        </span>
        <div
          ref={bar}
          className="vp-bar"
          role="slider"
          aria-label={t('notes.position')}
          aria-valuemin={0}
          aria-valuemax={Math.round(dur)}
          tabIndex={0}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            scrub.current = { was: !video.paused };
            video.pause();
            root.current?.setAttribute('data-scrubbing', '');
            seekTo(e.clientX);
          }}
          onPointerMove={(e) => scrub.current && seekTo(e.clientX)}
          onPointerUp={() => {
            const s = scrub.current;
            scrub.current = null;
            root.current?.removeAttribute('data-scrubbing');
            if (s?.was) void video.play().catch(() => undefined);
            wake();
          }}
          onPointerCancel={() => {
            scrub.current = null;
            root.current?.removeAttribute('data-scrubbing');
          }}
        >
          <span className="vp-track" />
          <span className="vp-fill" />
          <span className="vp-thumb" />
        </div>
        <span className="vp-time">{clock(dur)}</span>
        <button
          type="button"
          className="cam-icon"
          onClick={() => {
            video.muted = !video.muted;
            wake();
          }}
          aria-label={muted ? t('notes.soundOn') : t('notes.soundOff')}
          aria-pressed={muted}
        >
          {muted ? <IconVolumeOff size={20} /> : <IconVolume size={20} />}
        </button>
      </div>
    </div>,
    document.body,
  );
}
