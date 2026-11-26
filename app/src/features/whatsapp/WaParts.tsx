import { IconAlertCircle, IconBan, IconChartBar, IconCheck, IconChecks, IconClock, IconFile, IconMapPin, IconMicrophone, IconMusic, IconPhone, IconPhoto, IconSticker, IconUser, IconVideo, type Icon } from '@tabler/icons-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { marks, previewOf, ticksOf, type WaKind, type WaLast, type WaMessage, type WaTag, type Who, type WhoKind } from '../../domain/whatsapp';
import { loadPeople, waNoPicture, waPicture, waPictureNow } from '../../services/whatsapp';
import { PersonAvatar } from '../../ui/components';
import { useScreenLiveQuery } from '../../ui/hooks';

/*
 * The small pieces every WhatsApp screen draws (v0.78): a chat's picture, a message's ticks, a kind's symbol, a
 * message's words with WhatsApp's marks, whose chat it is.
 */

/** The garage's people by their numbers, read while the screen is in front (a customer added — his chat is named at once). */
export function useWaPeople(): Map<string, Who> {
  return useScreenLiveQuery(loadPeople, []) ?? EMPTY_PEOPLE;
}
const EMPTY_PEOPLE = new Map<string, Who>();

/** Pictures that did not load (no picture set, hidden from strangers): not asked again while the app is open. */
const noPicture = new Set<string>();

/**
 * A chat's picture, as WhatsApp shows it — over the person's initials, which stay when there is none. A group is a
 * rounded square, as a company is. Kept on this device (v0.88, services/whatsapp.ts `waPicture`): one already here is
 * drawn at once, as it is — only one that has just come from the server fades in over the initials.
 */
export const WaAvatar = memo(function WaAvatar({ id, name, group, size = 48 }: { id: string; name: string; group?: boolean; size?: number }) {
  const [src, setSrc] = useState(() => (noPicture.has(id) ? undefined : waPictureNow(id)));
  // Here when drawn (or a moment after — taken out of this device's keeping): no fade.
  const [atOnce, setAtOnce] = useState(() => !!src);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let alive = true;
    const now = noPicture.has(id) ? undefined : waPictureNow(id);
    setSrc(now);
    setAtOnce(!!now);
    setShown(false);
    if (!now && !noPicture.has(id) && !waNoPicture(id)) {
      const asked = Date.now();
      void waPicture(id).then((url) => {
        if (!alive || !url) return;
        setAtOnce(Date.now() - asked < 120);
        setSrc(url);
      });
    }
    return () => {
      alive = false;
    };
  }, [id]);
  // A chat known only by its number has no initials: a figure (not «+9»). Brackets are not initials either.
  const letters = /\p{L}/u.test(name) ? name.replace(/[^\p{L}\p{N}\s]/gu, ' ') : '';
  return (
    <span className="wa-avatar" data-group={group || undefined} style={{ width: size, height: size }}>
      <PersonAvatar name={letters} company={group} size={size} />
      {src && (
        <img
          src={src}
          alt=""
          decoding="async"
          data-shown={shown || atOnce || undefined}
          data-at-once={atOnce || undefined}
          onLoad={() => setShown(true)}
          onError={(e) => {
            noPicture.add(id);
            e.currentTarget.remove();
          }}
        />
      )}
    </span>
  );
});

/**
 * A chat's head (v0.84, the brief: «в переписке главным ориентиром служит получатель»): its picture, its name and a line
 * under it — whose it is, the number — in WhatsApp's bar on a phone and over the chat on a PC; a tap opens its card.
 */
export function ChatHead({ id, name, group, line, onOpen, size = 36 }: { id: string; name: string; group?: boolean; line?: string; onOpen?: () => void; size?: number }) {
  return (
    <button type="button" className="wa-head tap" onClick={onOpen} aria-label={name} data-wa-head data-wa-info-btn>
      <WaAvatar id={id} name={name} group={group} size={size} />
      <span className="wa-head-text">
        <span className="wa-head-name">{name}</span>
        {line && <span className="wa-head-line tnum">{line}</span>}
      </span>
    </button>
  );
}

const TICK: Record<ReturnType<typeof ticksOf>, Icon> = { failed: IconAlertCircle, queued: IconClock, checking: IconClock, wait: IconClock, sent: IconCheck, got: IconChecks, read: IconChecks };

/** One's own message's ticks: a clock while it goes (or waits), one tick sent, two delivered, two blue read. */
export function Ticks({ m, size = 16 }: { m: Pick<WaMessage, 'ack' | 'pending' | 'failed' | 'queued' | 'checking'>; size?: number }) {
  const { t } = useTranslation();
  const state = ticksOf(m);
  const I = TICK[state];
  return (
    <span className="wa-ticks" data-state={state} role="img" aria-label={t(`wa.ticks.${state}`)}>
      <I size={size} stroke={2.2} aria-hidden />
    </span>
  );
}

export const KIND_ICON: Record<WaKind, Icon | undefined> = {
  text: undefined,
  photo: IconPhoto,
  video: IconVideo,
  voice: IconMicrophone,
  audio: IconMusic,
  file: IconFile,
  sticker: IconSticker,
  place: IconMapPin,
  card: IconUser,
  call: IconPhone,
  gone: IconBan,
  poll: IconChartBar,
  other: undefined,
};

/** A chat's last message in its line: whose (ticks, or who in a group), the kind's symbol, the words. */
export function LastLine({ last, group }: { last: WaLast; group: boolean }) {
  const { t } = useTranslation();
  const p = previewOf(last);
  const I = KIND_ICON[p.kind];
  const words = p.words || (p.kind === 'text' ? '' : t(`wa.kind.${p.kind}`));
  return (
    <span className="wa-last">
      {last.me && p.kind !== 'gone' && p.kind !== 'call' && <Ticks m={last} size={15} />}
      {!last.me && group && last.from && <span className="wa-last-from">{last.from}:</span>}
      {I && <I size={15} stroke={2} aria-hidden className="wa-last-icon" />}
      <span className="wa-last-words">{words}</span>
    </span>
  );
}

/** A message's words: bold, italic, struck and mono as WhatsApp marks them, links opening in a new window. */
export const Marked = memo(function Marked({ text }: { text: string }) {
  return (
    <>
      {marks(text).map((p, i) => {
        if (p.href)
          return (
            <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()}>
              {p.t}
            </a>
          );
        if (p.b) return <b key={i}>{p.t}</b>;
        if (p.i) return <i key={i}>{p.t}</i>;
        if (p.s) return <s key={i}>{p.t}</s>;
        if (p.m) return <code key={i}>{p.t}</code>;
        return p.t;
      })}
    </>
  );
});

const WHO_COLOR: Record<WhoKind | WaTag, string> = { customer: 'blue', supplier: 'cyan', employee: 'violet', driver: 'grape', service: 'teal', work: 'orange' };

/** Whose chat it is in the garage — a small tag in the kind's colour. */
export function WhoTag({ kind }: { kind: WhoKind | WaTag }) {
  const { t } = useTranslation();
  return (
    <span className="wa-who" style={{ '--c': `var(--mantine-color-${WHO_COLOR[kind]}-6)` } as React.CSSProperties}>
      {t(`wa.who.${kind}`)}
    </span>
  );
}

/** «12 мин», «3 ч», «2 д» — how long a supplier takes to answer. */
export function replyTime(t: (k: string, o?: Record<string, unknown>) => string, min: number): string {
  if (min < 60) return t('wa.know.min', { n: min });
  if (min < 48 * 60) return t('wa.know.hours', { n: Math.round(min / 60) });
  return t('wa.know.days', { n: Math.round(min / 1440) });
}
