import { ActionIcon, Badge, Box, Button, Group, Modal, SimpleGrid, Stack, Text, TextInput, Title, Tooltip, UnstyledButton } from '@mantine/core';
import {
  IconAlertTriangle,
  IconArchive,
  IconBrandTelegram,
  IconBrandWhatsapp,
  IconCalendarTime,
  IconCash,
  IconChecklist,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheck,
  IconClipboardList,
  IconHourglassHigh,
  IconKey,
  IconPackage,
  IconParking,
  IconPhone,
  IconRepeat,
  IconSearch,
  IconStethoscope,
  IconTool,
  IconUser,
  IconX,
  type Icon,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { formatAed, parseAed } from '../domain/money';
import { normalizePlate } from '../domain/plates';
import type { Emirate, Plate, Stage } from '../domain/types';
import { cachedCardUrl, cachedMediaUrl, cardUrl, mediaSrc, mediaUrl } from '../services/media';
import { LazySheet } from './lazy';
import { useLongPress } from './longPress';
import { actionStart, tapSettled } from './tapGuard';
import { telegramChatUrl, whatsappUrl } from '../services/messages';
import { useLang, usePhone } from './hooks';
import { useScreen, useScreenTitle, useStack } from './stack';
import { useSwipeRow, type SwipeSpec } from './swipe';
import { useDesk, useDeskPane } from './desk';
import { deskTabs, noteTab, useDeskTab } from './deskTabs';
import { onCelebrate, useAutoAnimate, useRolling } from './motion';
import { createPortal } from 'react-dom';

/* ---------------- Toasts ---------------- */

/** How long an «Отменить» stays (v0.99, audit О1: 5 s was gone before a tired thumb got there). */
export const UNDO_MS = 8000;

/** The undo of the last action while its toast is up — Ctrl+Z on a desk (`undoLast`). */
let lastUndo: { id: string; until: number; run: () => void } | null = null;

/** Ctrl+Z on a desk: the last action's «Отменить», while its toast is still up. */
export function undoLast(): boolean {
  const u = lastUndo;
  if (!u || Date.now() > u.until) return false;
  u.run();
  return true;
}

/** A toast with an "Undo" button (for deletions that can be reverted). */
export function undoToast(message: ReactNode, undoLabel: string, onUndo: () => void, { replace = true, undo = true }: { replace?: boolean; /** `false` — an action, not an undo (Ctrl+Z does not take it). */ undo?: boolean } = {}) {
  // Only the last action can be undone, at once (v0.23): one toast at a time otherwise queues it behind the one before
  // — whose «Отменить» would undo an older action over a newer one. A result that came by itself (`replace: false`)
  // waits its turn instead: it must not take away the undo of what the user just did.
  if (replace) notifications.clean();
  const id = `undo-${Date.now()}`;
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    if (lastUndo?.id === id) lastUndo = null;
    onUndo();
    notifications.hide(id);
  };
  if (undo && (replace || !lastUndo || Date.now() > lastUndo.until)) lastUndo = { id, until: Date.now() + UNDO_MS, run };
  notifications.show({
    id,
    color: 'dark',
    autoClose: UNDO_MS,
    className: 'undo-toast',
    message: (
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Text size="sm" style={{ minWidth: 0 }}>
          {message}
        </Text>
        <UnstyledButton className="undo-btn" onClick={run}>
          {undoLabel}
        </UnstyledButton>
      </Group>
    ),
  });
}

/* ---------------- Money ---------------- */

export function Money({ fils, size, fw, c, display, roll, signed }: { fils: number; size?: string; fw?: number; c?: string; display?: boolean; /** Runs to a new value instead of blinking to it (totals, balances). */ roll?: boolean; /** Money in: "+" before it (a book of ins and outs). */ signed?: boolean }) {
  const lang = useLang();
  const shown = useRolling(fils, !!roll);
  // Sized by the final figure, so the cell does not twitch while the digits run.
  const s = formatAed(fils, lang, false);
  // How long the figure is: in a tile or a figure cell it is sized to fit (styles.css, "fit to cell").
  return (
    <Text span size={size} fz={size ? undefined : 'inherit'} fw={fw ?? (display ? undefined : 600)} c={c} className={display ? 'money display' : 'money'} style={{ '--chars': s.length } as React.CSSProperties}>
      {signed && fils > 0 && '+'}
      <Figure text={roll ? formatAed(shown, lang, false) : s} />
      <span className="cur">AED</span>
    </Text>
  );
}

/**
 * A figure the way a bank app sets it: a real minus (−, not a hyphen), the dirhams in full and the fils
 * a step quieter — the eye reads the whole number first.
 */
function Figure({ text }: { text: string }) {
  const m = /^(-?)(.*?)([.,]\d+)?$/.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      {m[1] && '−'}
      {m[2]}
      {m[3] && <span className="frac">{m[3]}</span>}
    </>
  );
}

/* ---------------- Person ---------------- */

const AVATAR_HUES = ['blue', 'indigo', 'grape', 'pink', 'orange', 'green', 'teal', 'cyan', 'red'] as const;

/** Two letters of a name ("Ahmed Al Mansoori" → "AA"). */
export function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

/**
 * A person (or a company) as the phone's contacts show one: the initials, white on a gradient of a colour
 * of their own — the same name always gets the same colour, so a regular is known by it before the name
 * is read. A company is a rounded square; without a name, a figure.
 */
export function PersonAvatar({ name, company, size = 40, muted }: { name: string; company?: boolean; size?: number; /** Off the team (a past employee): grey. */ muted?: boolean }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = muted ? 'gray' : AVATAR_HUES[h % AVATAR_HUES.length];
  const text = initialsOf(name);
  return (
    <span
      className="person-avatar"
      data-company={company || undefined}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), '--c': `var(--mantine-color-${hue}-5)`, '--c2': `var(--mantine-color-${hue}-7)` } as React.CSSProperties}
      aria-hidden
    >
      {text || <IconUser size={Math.round(size * 0.5)} stroke={2} />}
    </span>
  );
}

/* ---------------- Plate ---------------- */

const EMIRATE_ON_PLATE: Record<Emirate, string> = {
  DXB: 'Dubai',
  AUH: 'Abu Dhabi',
  SHJ: 'Sharjah',
  AJM: 'Ajman',
  RAK: 'RAK',
  UAQ: 'UAQ',
  FUJ: 'Fujairah',
};

/** The emirate's name as each emirate's plate prints it, in Arabic and in Latin letters. */
const PLATE_NAME: Record<Emirate, { ar: string; lat: string }> = {
  DXB: { ar: 'دبي', lat: 'DUBAI' },
  AUH: { ar: 'أبوظبي', lat: 'A.D' },
  SHJ: { ar: 'الشارقة', lat: 'SHARJAH' },
  AJM: { ar: 'عجمان', lat: 'AJMAN' },
  RAK: { ar: 'رأس الخيمة', lat: 'RAK' },
  UAQ: { ar: 'أم القيوين', lat: 'UAQ' },
  FUJ: { ar: 'الفجيرة', lat: 'U.A.E' },
};

/**
 * A UAE number plate as it looks on the car, in the layout of its emirate (no emblems):
 * Dubai — "DUBAI" over the code letter; Abu Dhabi — the code in a red box, then the name;
 * Ras Al Khaimah — the name first; the others — code, the name in Arabic over Latin, number.
 */
/** Sizes: xs–lg in lists and headers, `card` — the job card (widest plate + step still fit a phone), xl — typing it. */
export function PlateText({ plate, size = 'sm' }: { plate: Plate; size?: 'xs' | 'sm' | 'md' | 'lg' | 'card' | 'xl' }) {
  const p = normalizePlate(plate);
  const e = PLATE_NAME[p.emirate] ? p.emirate : 'DXB';
  const code = p.code ? <span className="code">{p.code}</span> : null;
  const name = (
    <span className="pl-name" aria-hidden="true">
      <span className="ar" lang="ar" dir="rtl">
        {PLATE_NAME[e].ar}
      </span>
      <span className="lat">{PLATE_NAME[e].lat}</span>
    </span>
  );
  return (
    <span className={`plate ${size} pl-${e.toLowerCase()}`} aria-label={`${EMIRATE_ON_PLATE[e]} ${p.code} ${p.number}`}>
      {e === 'DXB' ? (
        <span className="pl-side">
          <span className="pl-word" aria-hidden="true">
            DUBAI
          </span>
          {code}
        </span>
      ) : e === 'RAK' ? (
        <>
          {name}
          {code}
        </>
      ) : (
        <>
          {code}
          {name}
        </>
      )}
      <span className="num">{p.number}</span>
    </span>
  );
}

/**
 * A small plate and a line of text after it, for the line under a row's title (the way the board
 * lists cars): the title keeps the whole width instead of sharing it with a plate column.
 */
export function PlateLine({ plate, children, c }: { plate?: Plate; children?: ReactNode; c?: string }) {
  return (
    <Group gap={6} wrap="nowrap" style={{ maxWidth: '100%' }}>
      {plate && <PlateText plate={plate} size="xs" />}
      {children && (
        <Text span inherit c={c} lineClamp={1} style={{ minWidth: 0 }}>
          {children}
        </Text>
      )}
    </Group>
  );
}

/* ---------------- Stage ---------------- */

export const STAGE_META: Record<Stage, { color: string; icon: Icon; step: number }> = {
  booked: { color: 'gray', icon: IconCalendarTime, step: 0 },
  intake: { color: 'indigo', icon: IconClipboardList, step: 1 },
  diagnostics: { color: 'violet', icon: IconStethoscope, step: 2 },
  awaiting_approval: { color: 'yellow', icon: IconHourglassHigh, step: 3 },
  awaiting_parts: { color: 'orange', icon: IconPackage, step: 4 },
  in_progress: { color: 'cobalt', icon: IconTool, step: 5 },
  quality_check: { color: 'cyan', icon: IconChecklist, step: 6 },
  ready: { color: 'green', icon: IconCircleCheck, step: 7 },
  delivered: { color: 'teal', icon: IconKey, step: 8 },
  closed: { color: 'gray', icon: IconArchive, step: 8 },
  cancelled: { color: 'red', icon: IconX, step: 0 },
};

export function StageBadge({ stage, size = 'md', chevron }: { stage: Stage; size?: 'sm' | 'md' | 'lg'; chevron?: boolean }) {
  const { t } = useTranslation();
  const m = STAGE_META[stage];
  return (
    <Badge color={m.color} size={size} leftSection={<m.icon size={size === 'lg' ? 15 : 13} stroke={2} />} rightSection={chevron ? <IconChevronDown size={14} stroke={2.2} /> : undefined}>
      {t(`stage.${stage}`)}
    </Badge>
  );
}

/** Eight-segment progress of a job from check-in to handover (all green once the car is handed over). */
export function StageTrack({ stage }: { stage: Stage }) {
  const step = STAGE_META[stage].step;
  const complete = stage === 'delivered' || stage === 'closed';
  return (
    <div className={`stage-track${complete ? ' complete' : stage === 'cancelled' ? ' cancelled' : ''}`} aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <span key={i} className={complete || i + 1 < step ? 'done' : i + 1 === step ? 'now' : ''} />
      ))}
    </div>
  );
}

/* ---------------- Flags ---------------- */

export interface FlagInfo {
  waitingClientSince?: string;
  waitingParts?: boolean;
  debt?: boolean;
  incident?: boolean;
  warranty?: boolean;
  storageDays?: number;
}

export function Flags({ flags, hours, warnHours = 2, alertHours = 24 }: { flags: FlagInfo; hours?: number; warnHours?: number; alertHours?: number }) {
  const { t } = useTranslation();
  const lang = useLang();
  const items: ReactNode[] = [];
  const color = hours === undefined ? 'yellow' : hours >= alertHours ? 'red' : hours >= warnHours ? 'orange' : 'yellow';
  const dur = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} ${lang === 'ru' ? 'мин' : 'min'}` : h < 48 ? `${Math.floor(h)} ${lang === 'ru' ? 'ч' : 'h'}` : `${Math.floor(h / 24)} ${lang === 'ru' ? 'д' : 'd'}`);
  if (flags.waitingClientSince)
    items.push(
      <Badge key="w" color={color} leftSection={<IconHourglassHigh size={13} />}>
        {t('flags.waitingClient')}
        {hours !== undefined ? ` · ${dur(hours)}` : ''}
      </Badge>,
    );
  if (flags.waitingParts)
    items.push(
      <Badge key="p" color="orange" leftSection={<IconPackage size={13} />}>
        {t('flags.waitingParts')}
      </Badge>,
    );
  if (flags.debt)
    items.push(
      <Badge key="d" color="red" leftSection={<IconCash size={13} />}>
        {t('flags.debt')}
      </Badge>,
    );
  if (flags.incident)
    items.push(
      <Badge key="i" color="red" variant="outline" leftSection={<IconAlertTriangle size={13} />}>
        {t('flags.incident')}
      </Badge>,
    );
  if (flags.warranty)
    items.push(
      <Badge key="r" color="grape" leftSection={<IconRepeat size={13} />}>
        {t('flags.warranty')}
      </Badge>,
    );
  if (flags.storageDays)
    items.push(
      <Badge key="s" color="red" leftSection={<IconParking size={13} />}>
        {t('flags.storage', { days: flags.storageDays })}
      </Badge>,
    );
  if (!items.length) return null;
  return <Group gap={6}>{items}</Group>;
}

/* ---------------- Page structure ---------------- */

/**
 * iOS back button. On a phone it is the round glass button of iOS 26 with the back chevron (the screen
 * it leads to is its accessible name); a screen presented from the bottom is closed with a round "×".
 * It goes back through the stack (the previous screen returns as it was); with nothing behind (a
 * screen opened from a link) it goes to `to`, or the board. On a PC: chevron + the screen's name.
 */
export function BackButton({ to, label }: { to?: string; label?: ReactNode }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const stack = useStack();
  const screen = useScreen();
  const title = useScreenTitle();
  const go = () => {
    if (stack) return stack.back(to);
    if ((window.history.state?.idx ?? 0) > 0) return navigate(-1);
    navigate(to ?? '/');
  };
  const name = label ?? (stack?.previous ? title(stack.previous.pathname) : to ? title(to) : t('common.back'));
  const aria = typeof name === 'string' ? name : t('common.back');
  if (screen?.modal)
    return (
      <button type="button" className="nav-glass nav-close" onClick={go} aria-label={typeof label === 'string' ? label : t('common.cancel')}>
        <IconX size={22} stroke={2.3} aria-hidden />
      </button>
    );
  if (screen)
    return (
      <button type="button" className="nav-glass nav-back" onClick={go} aria-label={aria}>
        <IconChevronLeft size={26} stroke={2.4} style={{ marginLeft: -2 }} aria-hidden />
      </button>
    );
  return (
    <button type="button" className="nav-back" onClick={go} aria-label={aria}>
      <IconChevronLeft size={28} stroke={2.4} style={{ marginLeft: -4, marginRight: -3, flexShrink: 0 }} />
      <span className="nav-back-label">{name}</span>
    </button>
  );
}

type HeaderProps = {
  title: ReactNode;
  back?: string | boolean;
  right?: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  /** A phone: the title in the bar only, no large title under it (v0.81: a job's chat — the room is the messages'). */
  inline?: boolean;
  /**
   * A phone, with `inline` (v0.84, a WhatsApp chat): the bar's own head right after «‹» — a picture, the name and a line
   * under it, as a messenger's bar — instead of the small title in the middle.
   */
  lead?: ReactNode;
};

/**
 * A screen's head. Phone: the iOS navigation bar and the large title under it. PC (v0.42): the window's toolbar — one
 * row at the top of the screen, back, the title with its small line under it, the screen's buttons at the end.
 */
export function PageHeader(props: HeaderProps) {
  const desk = useDesk();
  return desk ? <DeskBar {...props} /> : <PhoneHeader {...props} />;
}

/** The PC's toolbar (v0.42): sticky at the top of the window; a hairline under it once the screen scrolls under it. */
function DeskBar({ title, back, right, subtitle, eyebrow }: HeaderProps) {
  const ref = useRef<HTMLElement>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const tab = useDeskTab();
  const inPane = useDeskPane()?.id;
  // The window's own title follows the screen (v0.72): the task bar, Alt+Tab and a second window say which screen it
  // is — «Honda Accord 2017», not «MyGarage» five times. The installed app's window puts its name before it itself.
  // The PC's tabs (v0.89): the screen names its tab; the window says the tab in front's (the job beside — not its).
  useEffect(() => {
    if (inPane === 'side') return;
    const text = head.current?.textContent?.replace(/\s+/g, ' ').trim();
    if (text) noteTab(tab, { title: text });
    if (deskTabs().active !== tab) return;
    const alone = window.matchMedia('(display-mode: standalone)').matches;
    const next = text ? (alone ? text : `${text} — MyGarage`) : 'MyGarage';
    if (document.title !== next) document.title = next;
  });
  useEffect(() => {
    let shown = '';
    // Two jobs side by side (v0.80): each pane scrolls itself — the bar follows its own pane, not the window.
    const pane = ref.current?.closest<HTMLElement>('.desk-twin-pane') ?? null;
    const update = () => {
      const now = String((pane ? pane.scrollTop : window.scrollY) > 2);
      if (now !== shown && ref.current) ref.current.dataset.scrolled = shown = now;
    };
    update();
    const target: HTMLElement | Window = pane ?? window;
    target.addEventListener('scroll', update, { passive: true });
    return () => target.removeEventListener('scroll', update);
  }, []);
  const sub = [eyebrow, subtitle].filter((x) => x !== undefined && x !== null && x !== false && x !== '');
  return (
    <header className="desk-bar" ref={ref}>
      {back && <DeskBack to={typeof back === 'string' ? back : undefined} />}
      <div className="desk-bar-head">
        <h1 className="desk-title" ref={head}>
          {title}
        </h1>
        {sub.length > 0 && (
          <div className="desk-bar-sub">
            {sub.map((s, i) => (
              <span key={i}>{s}</span>
            ))}
          </div>
        )}
      </div>
      {right && <div className="desk-bar-right">{right}</div>}
    </header>
  );
}

/** Back on a PC: a round button; where it goes — its name, shown under the mouse (ui/deskTips.tsx). */
function DeskBack({ to }: { to?: string }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const title = useScreenTitle();
  // The job beside the main one (v0.80): «Назад» goes back in its own pane — and at its first screen closes it (×).
  const pane = useDeskPane();
  const back = pane?.back;
  if (back)
    return (
      <button type="button" className="desk-back" aria-label={t(pane.closes ? 'common.close' : 'common.back')} onClick={back} data-pane-back>
        {pane.closes ? <IconX size={20} stroke={2.2} aria-hidden /> : <IconChevronLeft size={20} stroke={2.2} aria-hidden />}
      </button>
    );
  const name = to ? title(to) : t('common.back');
  const label = typeof name === 'string' && name ? name : t('common.back');
  return (
    <button type="button" className="desk-back" aria-label={label} onClick={() => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate(to ?? '/'))}>
      <IconChevronLeft size={20} stroke={2.2} aria-hidden />
    </button>
  );
}

/**
 * Screen header like iOS: a translucent navigation bar (back, actions, and the title once the large
 * one has scrolled under it) above a large title that fades as it goes. On a phone the bar lives
 * outside the screen's scroll view, so it never moves when the content bounces.
 */
function PhoneHeader({ title, back, right, subtitle, eyebrow, inline, lead }: HeaderProps) {
  const screen = useScreen();
  const barRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const title = titleRef.current;
    const head = headRef.current;
    if (!title || !head) return;
    const target: HTMLElement | Window = screen?.scroller.current ?? window;
    let frame = 0;
    // Written only when they change: a scroll far below the title touches no style at all.
    let shownO = '';
    let shownScrolled = '';
    const update = () => {
      frame = 0;
      const bar = barRef.current;
      const barBottom = bar?.getBoundingClientRect().bottom ?? 44;
      // How much of the large title is still below the bar: it fades over its last 28 px.
      const left = title.getBoundingClientRect().bottom - barBottom;
      const o = Math.max(0, Math.min(1, left / 28)).toFixed(2);
      if (o !== shownO) {
        shownO = o;
        head.style.setProperty('--title-o', o);
      }
      setCompact(left <= 8);
      // Content under the bar: the scroll edge shows (iOS 26).
      const y = target instanceof Window ? target.scrollY : target.scrollTop;
      const scrolled = String(y > 2);
      if (bar && scrolled !== shownScrolled) {
        shownScrolled = scrolled;
        bar.dataset.scrolled = scrolled;
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    target.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      target.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [screen, inline]);
  const bar = (
    <div className="nav-bar" data-compact={inline || compact} data-inline={inline || undefined} data-lead={lead ? true : undefined} ref={barRef}>
      <div className="nav-left" style={{ minWidth: 0 }}>
        {back && <BackButton to={typeof back === 'string' ? back : undefined} />}
        {lead}
      </div>
      {!lead && (
        <div className="nav-title" aria-hidden>
          {title}
        </div>
      )}
      <div className="nav-right">{right}</div>
    </div>
  );
  return (
    <>
      {screen ? createPortal(bar, screen.nav) : bar}
      {!inline && (
      <header className="page-head" ref={headRef}>
        {eyebrow && (
          <div className="page-eyebrow">{eyebrow}</div>
        )}
        <h1 ref={titleRef} className="large-title">
          {title}
        </h1>
        {subtitle && (
          <Text size="sm" c="dimmed" component="div" mt={4}>
            {subtitle}
          </Text>
        )}
      </header>
      )}
    </>
  );
}

export function Section({ title, description, action, children, mt = 'xl' }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; mt?: string | number }) {
  return (
    <Box mt={mt}>
      <Group justify="space-between" align="flex-end" mb={8} wrap="nowrap" gap="sm" px={2}>
        <Box style={{ minWidth: 0 }}>
          <Title order={5} fz={20} lh={1.25} style={{ letterSpacing: '-0.015em' }}>
            {title}
          </Title>
          {description && (
            <Text size="sm" c="dimmed" mt={2} lh={1.35}>
              {description}
            </Text>
          )}
        </Box>
        {action && <Box style={{ flexShrink: 0 }}>{action}</Box>}
      </Group>
      {children}
    </Box>
  );
}

/** iOS inset group: an optional small caption above, white rounded block, optional note below. */
export function RowGroup({ title, note, children, mt = 'lg' }: { title?: ReactNode; note?: ReactNode; children: ReactNode; mt?: string | number }) {
  return (
    <Box mt={mt}>
      {title && <div className="group-title">{title}</div>}
      <div className="ios-group">{children}</div>
      {note && <div className="group-note">{note}</div>}
    </Box>
  );
}

/** A row of an iOS group: label on the left, value or field on the right. */
export function FormRow({ label, children, onClick, align = 'right', chevron }: { label?: ReactNode; children?: ReactNode; onClick?: () => void; align?: 'left' | 'right'; chevron?: boolean }) {
  return (
    <div
      className={`ios-row${align === 'left' ? ' left' : ''}${onClick ? ' clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick()) : undefined}
    >
      {label !== undefined && <span className="label">{label}</span>}
      <div className="value" style={align === 'right' ? { display: 'flex', justifyContent: 'flex-end', textAlign: 'right' } : undefined}>
        {children}
      </div>
      {chevron && <IconChevronRight size={18} color="var(--mantine-color-gray-4)" style={{ flexShrink: 0, marginRight: -4 }} />}
    </div>
  );
}

/** An inset group of rows. With `animate` the rows come, go and change places with motion (ui/motion). */
export function List({ children, animate, className }: { children: ReactNode; animate?: boolean; className?: string }) {
  const ref = useAutoAnimate<HTMLDivElement>(!!animate);
  return (
    <div className={className ? `list ${className}` : 'list'} ref={ref}>
      {children}
    </div>
  );
}

export function ListRow({
  left,
  title,
  subtitle,
  right,
  onClick,
  chevron,
  handlers,
  selected,
  trailing,
  leading,
  dim,
  grip,
  'data-route': route,
}: {
  left?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  /** More pointer handlers on the row (a long press). */
  handlers?: HTMLAttributes<HTMLDivElement>;
  /** Picked in a selection (the row is tinted). */
  selected?: boolean;
  /** What a swipe to the left uncovers (delete, take off), as in the iPhone's lists. */
  trailing?: SwipeSpec;
  /** What a swipe to the right uncovers (done, agreed). */
  leading?: SwipeSpec;
  /** Finished with (work done): the row steps back so what is left stands out. */
  dim?: boolean;
  /** The handle that moves the row in edit mode (≡, `ui/sortable.ts`), at its very end. */
  grip?: ReactNode;
  /** The screen the row opens (v0.89): on a PC a right click opens it in a new tab (App.tsx `DeskRouteMenu`). */
  'data-route'?: string;
}) {
  const sw = useSwipeRow({ trailing, leading });
  // On a PC (v0.41) there is no finger to swipe with: the same actions are buttons that show under the mouse.
  const desk = useDesk();
  const swipes = !!(trailing || leading);
  // A long press and a swipe on the same row: both see the finger.
  const h = handlers as Partial<Record<'onTouchStart' | 'onTouchMove' | 'onTouchEnd' | 'onTouchCancel', (e: React.TouchEvent<HTMLDivElement>) => void>> | undefined;
  const touch = swipes
    ? {
        onTouchStart: (e: React.TouchEvent<HTMLDivElement>) => (h?.onTouchStart?.(e), sw.handlers.onTouchStart(e)),
        onTouchMove: (e: React.TouchEvent<HTMLDivElement>) => (h?.onTouchMove?.(e), sw.handlers.onTouchMove(e)),
        onTouchEnd: (e: React.TouchEvent<HTMLDivElement>) => (h?.onTouchEnd?.(e), sw.handlers.onTouchEnd(e)),
        onTouchCancel: (e: React.TouchEvent<HTMLDivElement>) => (h?.onTouchCancel?.(e), sw.handlers.onTouchCancel()),
      }
    : undefined;
  const action = (s: SwipeSpec, lead: boolean) => (
    <span className={`swipe-action${lead ? ' lead' : ''}`} style={{ background: `var(--mantine-color-${s.color}-6)` }} aria-hidden={sw.open !== (lead ? 'leading' : 'trailing')}>
      <button
        type="button"
        className="swipe-btn"
        tabIndex={sw.open === (lead ? 'leading' : 'trailing') ? 0 : -1}
        onClick={(e) => {
          e.stopPropagation();
          sw.close();
          s.onCommit();
        }}
      >
        <s.icon size={22} stroke={1.9} aria-hidden />
        <span>{s.label}</span>
      </button>
    </span>
  );
  const click = onClick && (() => !(swipes && sw.consumeClick()) && onClick());
  // PC (v0.63.3, the owner: «часто случайно нажимаю и удаляется»): an action the phone does only by a tap on the button its
  // swipe uncovered (`full: false` — deleting a line, dropping it) takes a second click here — the first one turns the
  // button into «Удалить?»; the mouse leaving the row, or four seconds, let it go.
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(null), 4000);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return (
    <div
      {...handlers}
      {...touch}
      onMouseLeave={(e) => {
        handlers?.onMouseLeave?.(e);
        if (armed) setArmed(null);
      }}
      data-selected={selected || undefined}
      data-done={dim || undefined}
      data-route={route}
      aria-pressed={selected}
      className={`list-row${onClick ? ' clickable' : ''}${swipes ? ' swipe-row' : ''}`}
      style={swipes ? sw.style : undefined}
      data-swiping={(swipes && sw.dragging) || undefined}
      data-past={(swipes && sw.past) || undefined}
      onClick={click || (swipes ? () => void sw.consumeClick() : undefined)}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick()) : undefined}
    >
      {trailing && action(trailing, false)}
      {leading && action(leading, true)}
      {left}
      <div className="body">
        <Text className="title" lineClamp={3} component="div">
          {title}
        </Text>
        {subtitle && (
          <Text className="subtitle" component="div">
            {subtitle}
          </Text>
        )}
      </div>
      {right}
      {chevron && <IconChevronRight size={18} stroke={2.4} className="chevron" aria-hidden />}
      {grip}
      {desk && swipes && (
        <span className="row-hover">
          {[leading, trailing]
            .filter((s): s is SwipeSpec => !!s)
            .map((s) => (
              <button
                key={s.label}
                type="button"
                className="row-hover-btn"
                data-armed={armed === s.label || undefined}
                style={{ '--c': `var(--mantine-color-${s.color}-6)`, '--c-ink': `var(--mantine-color-${s.color}-light-color)` } as React.CSSProperties}
                onClick={(e) => {
                  e.stopPropagation();
                  if (s.full === false && armed !== s.label) return setArmed(s.label);
                  setArmed(null);
                  s.onCommit();
                }}
              >
                <s.icon size={16} stroke={2} aria-hidden />
                {armed === s.label ? `${s.label}?` : s.label}
              </button>
            ))}
        </span>
      )}
    </div>
  );
}

/**
 * The iOS search bar: a grey rounded field with a magnifier, a clear button once there is text and,
 * on a phone, "Cancel" while it is in use.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  autoFocus,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onSubmit?: () => void;
}) {
  const { t } = useTranslation();
  const phone = usePhone();
  const ref = useRef<HTMLInputElement>(null);
  const [focus, setFocus] = useState(false);
  return (
    <div className="search-bar">
      <label className="search-field">
        <IconSearch size={18} stroke={2.2} aria-hidden />
        <input
          ref={ref}
          type="search"
          enterKeyHint="search"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          autoComplete="off"
          placeholder={placeholder}
          aria-label={placeholder}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onSubmit?.();
              if (phone) ref.current?.blur();
            }
            if (e.key === 'Escape') {
              onChange('');
              ref.current?.blur();
            }
          }}
        />
        {value && (
          <button
            type="button"
            className="search-clear"
            aria-label={t('common.clear')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange('');
              ref.current?.focus();
            }}
          >
            <IconX size={13} stroke={3} />
          </button>
        )}
      </label>
      {phone && (focus || value) && (
        <button
          type="button"
          className="search-cancel"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange('');
            ref.current?.blur();
          }}
        >
          {t('common.cancel')}
        </button>
      )}
    </div>
  );
}

export function Kpi({ label, value, hint, color, onClick }: { label: ReactNode; value: ReactNode; hint?: ReactNode; color?: string; onClick?: () => void }) {
  return (
    <div
      className={`kpi${onClick ? ' tap' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick()) : undefined}
    >
      <span className="eyebrow">{label}</span>
      <span className="value" style={color ? { color: `var(--mantine-color-${color}-text, var(--mantine-color-${color}-6))` } : undefined}>
        {value}
      </span>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </div>
  );
}

export function EmptyState({ icon: I, title, children, action }: { icon?: Icon; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <Stack align="center" gap={8} py="xl" px="md" ta="center" className="surface">
      {I && (
        <span className="empty-icon" aria-hidden>
          <I size={30} stroke={1.8} />
        </span>
      )}
      {title && (
        <Text fw={700} fz={20} lh={1.25}>
          {title}
        </Text>
      )}
      {children && (
        <Text size="sm" c="dimmed" maw={360}>
          {children}
        </Text>
      )}
      {action && <Box mt={6}>{action}</Box>}
    </Stack>
  );
}

/**
 * An inline tip like iOS TipKit: a tinted symbol, a title and a message; its actions are tinted
 * words under a hairline (the message keeps the whole width instead of sharing it with a button).
 */
export function Tip({
  icon: I,
  color = 'cobalt',
  title,
  children,
  actions,
  onClose,
}: {
  icon: Icon;
  color?: string;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="tip surface rise-enter">
      <div className="tip-main">
        <span className="tip-icon" style={{ color: `var(--mantine-color-${color}-6)` }} aria-hidden>
          <I size={30} stroke={1.6} />
        </span>
        <div className="tip-text">
          <div className="tip-title">{title}</div>
          {children && <div className="tip-body">{children}</div>}
        </div>
        {onClose && (
          <ActionIcon variant="subtle" color="gray" size={30} className="tip-close" aria-label={t('common.close')} onClick={onClose}>
            <IconX size={16} stroke={2.4} />
          </ActionIcon>
        )}
      </div>
      {actions && <div className="tip-actions">{actions}</div>}
    </div>
  );
}

/** Animated green check for "signed" / "paid" moments. */
export function SuccessMark({ size = 64 }: { size?: number }) {
  return (
    <span className="success-mark" style={{ width: size, height: size, flexShrink: 0 }} aria-hidden>
      <svg width={size} height={size} viewBox="0 0 64 64">
        <circle className="circle" cx="32" cy="32" r="32" fill="var(--mantine-color-green-6)" />
        <path className="tick" d="M19 33.5l8.5 8.5L45.5 24" fill="none" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/**
 * The mark of a moment done — the car handed over, the job paid (ui/motion `celebrate`): a green tick
 * drawn on a glass disc in the middle of the screen, a word under it, gone in a second. It takes no
 * taps and blocks nothing.
 */
export function Celebration() {
  const [mark, setMark] = useState<{ label: string; n: number } | null>(null);
  useEffect(() => {
    let timer = 0;
    const off = onCelebrate((label) => {
      window.clearTimeout(timer);
      setMark((m) => ({ label, n: (m?.n ?? 0) + 1 }));
      timer = window.setTimeout(() => setMark(null), 1500);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, []);
  if (!mark) return null;
  return createPortal(
    <div className="celebration" key={mark.n} role="status" aria-live="polite">
      <div className="celebration-disc glass">
        <SuccessMark size={72} />
        <span>{mark.label}</span>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Primary actions pinned to the bottom of the screen (above the phone tab bar, or on the keyboard
 * while typing). On a phone the bar belongs to its screen but sits outside its scroll view, so it is
 * at the very bottom from the first frame and moves with the screen; on a PC it closes the content.
 */
/** `full` — a mode of its own (picking lines): the bar takes the whole width, the job's «＋» steps aside (v0.99). */
export function StickyBar({ children, full }: { children: ReactNode; full?: boolean }) {
  const screen = useScreen();
  const bar = (
    <div className="sticky-bar no-print" data-full={full || undefined}>
      {children}
    </div>
  );
  return screen ? createPortal(bar, screen.bottom) : bar;
}

export interface TabItem {
  value: string;
  label: ReactNode;
  count?: number;
  /** A colour of the theme (a job's step): its symbol is tinted, and the pill takes the colour once chosen. */
  color?: string;
  icon?: Icon;
}

/**
 * Horizontal pill tabs that scroll instead of wrapping. The dark pill slides from the old tab to the
 * new one (like the thumb of a segmented control), in the tab's own colour when it has one; the active
 * tab is always scrolled into view.
 */
export function ScrollTabs({
  value,
  onChange,
  items,
  mb = 'md',
  onHold,
  segmented,
}: {
  value: string;
  onChange: (v: string) => void;
  items: TabItem[];
  mb?: string;
  /** A long press on a tab (right click on a PC) — the board opens its «Вид» there; the tap after it is not a tap. */
  onHold?: () => void;
  /**
   * Two or three views of one thing (the job and its notes): the iPhone's segmented control — a grey track, the
   * chosen one white, the parts equal (v0.57). Without it, a row of capsules (the board's steps, the money's pages).
   */
  segmented?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const ready = useRef(false);
  const hold = useLongPress(() => onHold?.());
  // Tabs in another order (the board's «Вид»): the pill goes to where its tab is now.
  const order = items.map((it) => it.value).join('|');
  useEffect(() => {
    const root = ref.current;
    const el = root?.querySelector<HTMLElement>('[data-active="true"]');
    const p = pill.current;
    if (!root || !p) return;
    const place = () => {
      const active = root.querySelector<HTMLElement>('[data-active="true"]');
      if (!active) {
        p.style.opacity = '0';
        return;
      }
      p.style.opacity = '1';
      p.style.setProperty('--pill', active.dataset.tint ? `var(--mantine-color-${active.dataset.tint}-filled)` : 'var(--app-pill)');
      p.style.transform = `translateX(${active.offsetLeft}px)`;
      p.style.width = `${active.offsetWidth}px`;
      p.style.height = `${active.offsetHeight}px`;
    };
    place();
    // The first placement happens before paint and must not slide in from nowhere.
    if (!ready.current) {
      ready.current = true;
      requestAnimationFrame(() => root.setAttribute('data-ready', 'true'));
    }
    // The row, and each tab: a count that appears (or grows) widens its tab, the pill follows.
    const ro = new ResizeObserver(place);
    ro.observe(root);
    root.querySelectorAll(':scope > button').forEach((b) => ro.observe(b));
    if (!el) return () => ro.disconnect();
    const left = el.offsetLeft - root.offsetLeft;
    if (left < root.scrollLeft + 8 || left + el.offsetWidth > root.scrollLeft + root.clientWidth - 8) {
      root.scrollTo({ left: Math.max(0, left - 24), behavior: 'smooth' });
    }
    return () => ro.disconnect();
  }, [value, order]);
  return (
    <Box mb={mb} className="scroll-tabs" role="tablist" ref={ref} data-segmented={segmented || undefined} {...(onHold ? hold.handlers : {})}>
      <span className="scroll-tabs-pill" ref={pill} aria-hidden />
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="tab"
          data-active={it.value === value}
          data-tint={it.color}
          aria-selected={it.value === value}
          onClick={() => {
            if (onHold && hold.consumeClick()) return;
            onChange(it.value);
          }}
          style={it.color ? ({ '--c': `var(--mantine-color-${it.color}-light-color)`, '--cf': `var(--mantine-color-${it.color}-filled)` } as React.CSSProperties) : undefined}
        >
          {it.icon && <it.icon size={16} stroke={2.3} className="tab-icon" aria-hidden />}
          {it.label}
          {it.count !== undefined && <span className="count">{it.count}</span>}
        </button>
      ))}
    </Box>
  );
}

/** Placeholder while a screen loads from the device database (fades in only if loading is slow). */
export function PageSkeleton({ variant = 'list' }: { variant?: 'list' | 'detail' }) {
  return (
    <div className="skeleton-page" aria-busy="true">
      <Box className="skeleton" h={12} w={120} mb={10} />
      <Box className="skeleton" h={26} w="55%" mb={24} />
      {variant === 'detail' ? (
        <>
          <Box className="skeleton" h={150} mb={14} style={{ borderRadius: 'var(--mantine-radius-lg)' }} />
          <Box className="skeleton" h={90} mb={24} style={{ borderRadius: 'var(--mantine-radius-lg)' }} />
          <Group gap={8} mb={16}>
            {[90, 80, 110, 70].map((w, i) => (
              <Box key={i} className="skeleton" h={36} w={w} style={{ borderRadius: 999 }} />
            ))}
          </Group>
        </>
      ) : (
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm" mb={24}>
          {[0, 1, 2, 3].map((i) => (
            <Box key={i} className="skeleton" h={84} style={{ borderRadius: 'var(--mantine-radius-lg)' }} />
          ))}
        </SimpleGrid>
      )}
      <Stack gap="sm">
        {[0, 1, 2].map((i) => (
          <Box key={i} className="skeleton" h={96} style={{ borderRadius: 'var(--mantine-radius-lg)' }} />
        ))}
      </Stack>
    </div>
  );
}

/** Round contact buttons: WhatsApp, Telegram, call (nothing while the customer has no phone yet). */
/**
 * The action tiles of an iPhone contact card: WhatsApp, Telegram and a call, an icon over a word, in
 * equal tiles under the name. Only what the customer can be reached by (no `tel:` without a number).
 */
export function ContactTiles({ phone, whatsapp, telegram, whatsappHref }: { phone: string; whatsapp?: string; telegram?: string; /** A chat link of its own (a supplier's from the workbook). */ whatsappHref?: string }) {
  const { t } = useTranslation();
  const tiles: { href: string; icon: Icon; label: string; color: string; external: boolean }[] = [];
  if (whatsappHref || whatsapp || phone) tiles.push({ href: whatsappHref ?? whatsappUrl(whatsapp || phone, ''), icon: IconBrandWhatsapp, label: 'WhatsApp', color: 'green', external: true });
  // Telegram only when it is written down (v0.99, audit Ч22): in the UAE a number is WhatsApp, rarely Telegram.
  if (telegram) tiles.push({ href: telegramChatUrl(phone, telegram), icon: IconBrandTelegram, label: 'Telegram', color: 'cobalt', external: true });
  if (phone) tiles.push({ href: `tel:${phone}`, icon: IconPhone, label: t('customer.call'), color: 'green', external: false });
  if (!tiles.length) return null;
  return (
    <div className="contact-tiles">
      {tiles.map((x) => (
        <a key={x.label} className="contact-tile" href={x.href} target={x.external ? '_blank' : undefined} rel={x.external ? 'noopener' : undefined}>
          <x.icon size={24} stroke={1.8} style={{ color: `var(--mantine-color-${x.color}-6)` }} aria-hidden />
          <span>{x.label}</span>
        </a>
      ))}
    </div>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <Group gap={9} wrap="nowrap">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#007aff" />
        <path d="M6.5 19.5l2.2-5.6a3 3 0 012.8-1.9h9a3 3 0 012.8 1.9l2.2 5.6v4.2a1 1 0 01-1 1h-2a1 1 0 01-1-1v-1H10.5v1a1 1 0 01-1 1h-2a1 1 0 01-1-1z" fill="#fff" />
        <path d="M9.6 17.2l1.5-3.4a1 1 0 01.9-.6h8a1 1 0 01.9.6l1.5 3.4z" fill="#007aff" />
        <circle cx="11" cy="20.3" r="1.4" fill="#007aff" />
        <circle cx="21" cy="20.3" r="1.4" fill="#007aff" />
      </svg>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: size * 0.64, letterSpacing: '-0.01em' }}>MyGarage</span>
    </Group>
  );
}

/* ---------------- Inputs & media ---------------- */

/** Amount input in AED that stores fils. */
export function MoneyInput({
  label,
  value,
  onChange,
  required,
  description,
  error,
  autoFocus,
  size = 'md',
  ariaLabel,
  leftSection,
  big,
  readOnly,
}: {
  label: ReactNode;
  /** Shown, not typed in (the sum a sheet acts on as it is). */
  readOnly?: boolean;
  /** In a row whose label is beside it: the field's name for screen readers (and tests). */
  ariaLabel?: string;
  /** Before the amount (a quantity: "4 ×" — the price is per unit). */
  leftSection?: ReactNode;
  value: number | undefined;
  onChange: (fils: number | undefined) => void;
  required?: boolean;
  description?: ReactNode;
  error?: ReactNode;
  autoFocus?: boolean;
  size?: 'xs' | 'sm' | 'md';
  /** The sum is what the sheet is about (money in or out): large rounded figures, the name only for screen readers. */
  big?: boolean;
}) {
  // A filled-in amount reads as the app writes amounts: "31,5" in Russian, "31.5" in English.
  const lang = useLang();
  const asText = (fils: number | undefined) => (fils === undefined ? '' : lang === 'ru' ? String(fils / 100).replace('.', ',') : String(fils / 100));
  const [text, setText] = useState(() => asText(value));
  useEffect(() => {
    const parsed = parseAed(text);
    if ((parsed ?? undefined) !== value) setText(asText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <TextInput
      label={big ? undefined : label}
      aria-label={big && typeof label === 'string' ? label : ariaLabel}
      className={big ? 'money-big' : undefined}
      description={description}
      required={required}
      inputMode="decimal"
      enterKeyHint="done"
      size={size}
      leftSection={
        leftSection && (
          <Text size="sm" c="dimmed" fw={600} style={{ whiteSpace: 'nowrap' }}>
            {leftSection}
          </Text>
        )
      }
      leftSectionWidth={leftSection ? 52 : undefined}
      rightSection={
        <Text size="xs" c="dimmed" fw={600}>
          AED
        </Text>
      }
      rightSectionWidth={48}
      value={text}
      readOnly={readOnly}
      // In a form row (no label above) an empty amount still reads as a field: "0" in grey.
      placeholder={label === undefined || big ? '0' : undefined}
      error={error}
      autoFocus={autoFocus}
      // Tapping a filled amount selects it, so typing replaces the old price instead of appending.
      onFocus={(e) => e.currentTarget.select()}
      styles={{ input: { fontVariantNumeric: 'tabular-nums' } }}
      onChange={(e) => {
        setText(e.currentTarget.value);
        const f = parseAed(e.currentTarget.value);
        onChange(f ?? undefined);
      }}
    />
  );
}

/**
 * A picture that fades in once it is decoded (`.media-pic`); one known before (`at`) is there at once. `onIn` — once
 * it is fully in (its fade over): the preview under it may go.
 */
function RevealImg({ src, at, onIn }: { src: string; at: boolean; onIn?: () => void }) {
  const [shown, setShown] = useState(at);
  useEffect(() => {
    if (!shown || at || !onIn) return;
    // The fade is --dur-3 (300 ms); without motion (reduced) there is no fade to wait for — the same moment then.
    const t = setTimeout(onIn, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  return (
    <img
      src={src}
      alt=""
      decoding="async"
      draggable={false}
      className="media-pic"
      data-in={shown || undefined}
      onLoad={(e) => {
        if (shown) return;
        const img = e.currentTarget;
        // Decoded first, then faded in: no half-drawn frame.
        void (img.decode ? img.decode().catch(() => undefined) : Promise.resolve()).then(() => setShown(true));
      }}
    />
  );
}

/**
 * A stored photo: the thumbnail (400 px, lists), the card size (`card`, 1080 px — a card across the
 * phone) or the photo itself. One shown before is drawn at once (a list coming back, a row rendered
 * again). A new one (v0.41.3, the user: «сначала чёрный фон, потом резко появляется»): the small preview at once
 * (it is here, or 30 KB from the server), the sharp one fading in over it as it comes; no spinner per photo.
 */
export function MediaImage({ id, thumb = true, card, h = 90, w, radius = 'md', onClick }: { id: string; thumb?: boolean; card?: boolean; h?: number | string; w?: number | string; radius?: string; onClick?: () => void }) {
  const sharp = !!card || !thumb;
  const bigKey = `${id}:${card ? 'c' : 'f'}`;
  const knownBig = () => (card ? cachedCardUrl(id) : thumb ? undefined : cachedMediaUrl(id, false));
  // What was there when this photo first showed: drawn at once, not faded in.
  const [atMount] = useState(() => ({ small: cachedMediaUrl(id, true), big: knownBig() }));
  const [small, setSmall] = useState<{ id: string; url?: string }>();
  const [big, setBig] = useState<{ key: string; url?: string }>();
  // The sharp one faded in over the preview: the preview goes (one picture in the frame, not two).
  const [covered, setCovered] = useState<string>();
  const bigUrl = sharp ? (knownBig() ?? (big?.key === bigKey ? big.url : undefined)) : undefined;
  const smallUrl = cachedMediaUrl(id, true) ?? (small?.id === id ? small.url : undefined);
  useEffect(() => {
    let alive = true;
    // The sharp one known: nothing else is needed.
    if (sharp && knownBig()) return;
    if (!cachedMediaUrl(id, true)) void mediaUrl(id, true).then((u) => alive && setSmall({ id, url: u }));
    if (sharp) void (card ? cardUrl(id) : mediaSrc(id)).then((u) => alive && setBig({ key: bigKey, url: u }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bigKey, sharp]);
  return (
    <Box
      h={h}
      w={w ?? h}
      className="surface-soft media-reveal"
      onClick={onClick}
      style={{ borderRadius: radius === '0' ? 0 : `var(--mantine-radius-${radius})`, flexShrink: 0, cursor: onClick ? 'zoom-in' : undefined }}
    >
      {smallUrl && !(sharp && bigUrl && (bigUrl === atMount.big || bigUrl === covered)) && <RevealImg key={`s:${smallUrl}`} src={smallUrl} at={smallUrl === atMount.small} />}
      {bigUrl && <RevealImg key={`b:${bigUrl}`} src={bigUrl} at={bigUrl === atMount.big} onIn={() => setCovered(bigUrl)} />}
    </Box>
  );
}

export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip label={label} multiline w={240}>
      <span>{children}</span>
    </Tooltip>
  );
}

/** Label/value pair for detail panels. */
export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <Box style={{ minWidth: 0 }}>
      <div className="eyebrow">{label}</div>
      <Text size="sm" fw={500} mt={2} component="div">
        {children}
      </Text>
    </Box>
  );
}

/**
 * Confirmation for actions that cannot be undone (issuing an invoice, approving by the no-call limit).
 * The confirm button shows progress; the sheet closes only when `onConfirm` resolves to a truthy value
 * (use `run(async () => { ...; return true; })`, which resolves to undefined on error).
 */
type ConfirmProps = {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  confirmLabel: ReactNode;
  color?: string;
  icon?: ReactNode;
  onConfirm: () => Promise<unknown>;
  /** A second way to go (an action sheet of two): both full width, the sheet's × is the way back. */
  secondary?: { label: ReactNode; color?: string; onClick: () => Promise<unknown> };
  /** Not yet (a word to type first, v0.99): the action stays off. */
  waiting?: boolean;
};

/* Made only once it is first asked for (a job keeps several of these, mostly never opened). */
export function ConfirmModal(props: ConfirmProps) {
  return <LazySheet opened={props.opened}>{(o) => <ConfirmSheet {...props} opened={o} />}</LazySheet>;
}

function ConfirmSheet({
  opened,
  onClose,
  title,
  children,
  confirmLabel,
  color,
  icon,
  onConfirm,
  secondary,
  waiting,
}: ConfirmProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<false | 'main' | 'second'>(false);
  // Running now (set at once — a second tap in the same frame does nothing), whatever the sheet does meanwhile;
  // and done — after a success the button stays busy while the sheet slides out (an invoice issued twice →
  // a false error), until the sheet is opened anew.
  const running = useRef(false);
  const done = useRef(false);
  useEffect(() => {
    if (!opened) return;
    done.current = false;
    if (!running.current) setBusy(false);
  }, [opened]);
  const go = async (which: 'main' | 'second', fn: () => Promise<unknown>) => {
    if (running.current || done.current) return;
    running.current = true;
    setBusy(which);
    const started = actionStart();
    let ok = false;
    try {
      ok = !!(await fn());
      if (ok) {
        done.current = true;
        onClose();
      }
    } catch {
      // the action reports its own error
    } finally {
      running.current = false;
      if (!ok) setBusy(false);
      tapSettled(started);
    }
  };
  if (secondary)
    return (
      <Modal opened={opened} onClose={onClose} title={title}>
        <Stack gap="md">
          <Box>{children}</Box>
          <Stack gap="xs">
            <Button size="lg" color={color} leftSection={icon} loading={busy === 'main'} disabled={busy === 'second'} data-autofocus onClick={() => void go('main', onConfirm)}>
              {confirmLabel}
            </Button>
            <Button size="lg" variant="light" color={secondary.color} loading={busy === 'second'} disabled={busy === 'main'} onClick={() => void go('second', secondary.onClick)}>
              {secondary.label}
            </Button>
          </Stack>
        </Stack>
      </Modal>
    );
  return (
    <Modal opened={opened} onClose={onClose} title={title}>
      <Stack gap="md">
        <Box>{children}</Box>
        {/* As an iPhone asks: the action across the sheet, in reach of the thumb; cancel quietly under it. */}
        <Stack gap={6}>
          <Button size="lg" color={color} leftSection={icon} loading={busy === 'main'} disabled={waiting} data-autofocus onClick={() => void go('main', onConfirm)}>
            {confirmLabel}
          </Button>
          <Button size="lg" variant="subtle" color="gray" className="confirm-cancel" onClick={onClose} disabled={!!busy}>
            {t('common.cancel')}
          </Button>
        </Stack>
      </Stack>
    </Modal>
  );
}

export function SelectCard({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <UnstyledButton className="choice-card" data-active={active} onClick={onClick}>
      {children}
    </UnstyledButton>
  );
}
