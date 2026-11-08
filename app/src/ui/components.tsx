import { ActionIcon, Badge, Box, Button, Group, Image, Loader, Modal, SimpleGrid, Stack, Text, TextInput, ThemeIcon, Title, Tooltip, UnstyledButton } from '@mantine/core';
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
  IconStethoscope,
  IconTool,
  IconX,
  type Icon,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { formatAed, parseAed } from '../domain/money';
import { normalizePlate } from '../domain/plates';
import type { Emirate, Plate, Stage } from '../domain/types';
import { mediaUrl } from '../services/media';
import { telegramChatUrl, whatsappUrl } from '../services/messages';
import { haptic } from './clipboard';
import { useLang, usePhone } from './hooks';
import { createPortal } from 'react-dom';
import { PhotoViewer } from './PhotoViewer';

/* ---------------- Toasts ---------------- */

/** A toast with an "Undo" button (for deletions that can be reverted). */
export function undoToast(message: ReactNode, undoLabel: string, onUndo: () => void) {
  const id = `undo-${Date.now()}`;
  notifications.show({
    id,
    color: 'dark',
    autoClose: 5000,
    message: (
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Text size="sm" style={{ minWidth: 0 }}>
          {message}
        </Text>
        <UnstyledButton
          onClick={() => {
            onUndo();
            notifications.hide(id);
          }}
          style={{ color: 'var(--mantine-color-cobalt-5)', fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap' }}
        >
          {undoLabel}
        </UnstyledButton>
      </Group>
    ),
  });
}

/* ---------------- Money ---------------- */

export function Money({ fils, size, fw, c, display }: { fils: number; size?: string; fw?: number; c?: string; display?: boolean }) {
  const lang = useLang();
  const s = formatAed(fils, lang, false);
  return (
    <Text span size={size} fz={size ? undefined : 'inherit'} fw={fw ?? (display ? undefined : 600)} c={c} className={display ? 'money display' : 'money'}>
      {s}
      <span className="cur">AED</span>
    </Text>
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

/** A UAE number plate as it looks on the car: emirate, code, number. */
export function PlateText({ plate, size = 'sm' }: { plate: Plate; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' }) {
  const p = normalizePlate(plate);
  return (
    <span className={`plate ${size}`} aria-label={`${EMIRATE_ON_PLATE[p.emirate]} ${p.code} ${p.number}`}>
      <span className="em">{EMIRATE_ON_PLATE[p.emirate]}</span>
      {p.code && <span className="code">{p.code}</span>}
      <span className="num">{p.number}</span>
    </span>
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

/** iOS back button: chevron + "Back"; goes to `to` or one step back in history. */
export function BackButton({ to, label }: { to?: string; label?: ReactNode }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <button type="button" className="nav-back" onClick={() => (to ? navigate(to) : navigate(-1))}>
      <IconChevronLeft size={26} stroke={2.2} style={{ marginRight: -2 }} />
      {label ?? t('common.back')}
    </button>
  );
}

/**
 * Screen header like iOS: a translucent navigation bar (back, actions, and the title once it scrolls
 * away) above a large title.
 */
export function PageHeader({ title, back, right, subtitle, eyebrow }: { title: ReactNode; back?: string | boolean; right?: ReactNode; subtitle?: ReactNode; eyebrow?: ReactNode }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = titleRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting), { rootMargin: '-52px 0px 0px 0px', threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <>
      <div className="nav-bar" data-compact={compact}>
        <div style={{ minWidth: 0 }}>{back && <BackButton to={typeof back === 'string' ? back : undefined} />}</div>
        <div className="nav-title" aria-hidden>
          {title}
        </div>
        <div className="nav-right">{right}</div>
      </div>
      <header className="page-head">
        {eyebrow && (
          <div className="eyebrow" style={{ marginBottom: 2 }}>
            {eyebrow}
          </div>
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
    </>
  );
}

export function Section({ title, description, action, children, mt = 'xl' }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; mt?: string | number }) {
  return (
    <Box mt={mt}>
      <Group justify="space-between" align="flex-end" mb={8} wrap="nowrap" gap="sm" px={2}>
        <Box style={{ minWidth: 0 }}>
          <Title order={5} fz={19} lh={1.25}>
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

export function List({ children }: { children: ReactNode }) {
  return <div className="list">{children}</div>;
}

export function ListRow({
  left,
  title,
  subtitle,
  right,
  onClick,
  chevron,
}: {
  left?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
}) {
  return (
    <div
      className={`list-row${onClick ? ' clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick()) : undefined}
    >
      {left}
      <div className="body">
        <Text fw={500} fz={15} lh={1.35} lineClamp={3} component="div">
          {title}
        </Text>
        {subtitle && (
          <Text fz={13} c="dimmed" component="div" mt={2} lh={1.35}>
            {subtitle}
          </Text>
        )}
      </div>
      {right}
      {chevron && <IconChevronRight size={18} color="var(--mantine-color-gray-4)" style={{ flexShrink: 0, marginRight: -4 }} />}
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
        <ThemeIcon size={52} radius="xl" variant="light" color="gray">
          <I size={26} stroke={1.6} />
        </ThemeIcon>
      )}
      {title && <Text fw={700}>{title}</Text>}
      {children && (
        <Text size="sm" c="dimmed" maw={360}>
          {children}
        </Text>
      )}
      {action && <Box mt={6}>{action}</Box>}
    </Stack>
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
 * Primary actions pinned to the bottom of the screen (above the phone tab bar). On a phone the bar
 * lives outside the page (the page's entrance animation must not carry it), so it is at the very
 * bottom from the first frame, also on a short screen; on a PC it closes the content.
 */
export function StickyBar({ children }: { children: ReactNode }) {
  const phone = usePhone();
  const bar = <div className="sticky-bar no-print">{children}</div>;
  return phone ? createPortal(bar, document.body) : bar;
}

export interface TabItem {
  value: string;
  label: ReactNode;
  count?: number;
}

/** Horizontal pill tabs that scroll instead of wrapping; the active one is always scrolled into view. */
export function ScrollTabs({ value, onChange, items, mb = 'md' }: { value: string; onChange: (v: string) => void; items: TabItem[]; mb?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    const el = root?.querySelector<HTMLElement>('[data-active="true"]');
    if (!root || !el) return;
    const left = el.offsetLeft - root.offsetLeft;
    if (left < root.scrollLeft + 8 || left + el.offsetWidth > root.scrollLeft + root.clientWidth - 8) {
      root.scrollTo({ left: Math.max(0, left - 24), behavior: 'smooth' });
    }
  }, [value]);
  return (
    <Box mb={mb} className="scroll-tabs" role="tablist" ref={ref}>
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="tab"
          data-active={it.value === value}
          aria-selected={it.value === value}
          onClick={() => {
            if (it.value !== value) haptic(6);
            onChange(it.value);
          }}
        >
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
export function ContactButtons({ phone, whatsapp, telegram, size = 38 }: { phone: string; whatsapp?: string; telegram?: string; size?: number }) {
  const { t } = useTranslation();
  if (!phone && !whatsapp) return null;
  return (
    <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
      <Tooltip label="WhatsApp">
        <ActionIcon component="a" href={whatsappUrl(whatsapp || phone, '')} target="_blank" rel="noopener" size={size} radius="xl" color="green" variant="light" aria-label="WhatsApp">
          <IconBrandWhatsapp size={20} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Telegram">
        <ActionIcon component="a" href={telegramChatUrl(phone, telegram)} target="_blank" rel="noopener" size={size} radius="xl" color="cobalt" variant="light" aria-label="Telegram">
          <IconBrandTelegram size={20} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={t('customer.call')}>
        <ActionIcon component="a" href={`tel:${phone}`} size={size} radius="xl" color="gray" variant="light" aria-label={t('customer.call')}>
          <IconPhone size={20} />
        </ActionIcon>
      </Tooltip>
    </Group>
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
}: {
  label: ReactNode;
  value: number | undefined;
  onChange: (fils: number | undefined) => void;
  required?: boolean;
  description?: ReactNode;
  error?: ReactNode;
  autoFocus?: boolean;
  size?: 'xs' | 'sm' | 'md';
}) {
  const [text, setText] = useState(value !== undefined ? String(value / 100) : '');
  useEffect(() => {
    const parsed = parseAed(text);
    if ((parsed ?? undefined) !== value) setText(value !== undefined ? String(value / 100) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <TextInput
      label={label}
      description={description}
      required={required}
      inputMode="decimal"
      size={size}
      rightSection={
        <Text size="xs" c="dimmed" fw={600}>
          AED
        </Text>
      }
      rightSectionWidth={48}
      value={text}
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

export function MediaImage({ id, thumb = true, h = 90, w, radius = 'md', onClick }: { id: string; thumb?: boolean; h?: number | string; w?: number | string; radius?: string; onClick?: () => void }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    void mediaUrl(id, thumb).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [id, thumb]);
  if (!url)
    return (
      <Box h={h} w={w ?? h} className="surface-soft" style={{ display: 'grid', placeItems: 'center' }}>
        <Loader size="xs" />
      </Box>
    );
  return <Image src={url} h={h} w={w ?? h} radius={radius} fit="cover" onClick={onClick} style={onClick ? { cursor: 'zoom-in' } : undefined} alt="" />;
}

/** Thumbnail that opens the full photo. */
export function Photo({ id, h = 90, w, label }: { id: string; h?: number; w?: number | string; label?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Stack gap={4} align="center">
        <MediaImage id={id} h={h} w={w} onClick={() => setOpen(true)} />
        {label && (
          <Text size="xs" c="dimmed" ta="center" lh={1.3}>
            {label}
          </Text>
        )}
      </Stack>
      {open && <PhotoViewer items={[{ id, title: typeof label === 'string' ? label : undefined }]} index={0} onIndex={() => undefined} onClose={() => setOpen(false)} />}
    </>
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
export function ConfirmModal({
  opened,
  onClose,
  title,
  children,
  confirmLabel,
  color,
  icon,
  onConfirm,
}: {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  confirmLabel: ReactNode;
  color?: string;
  icon?: ReactNode;
  onConfirm: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <Modal opened={opened} onClose={onClose} title={title}>
      <Stack gap="md">
        <Box>{children}</Box>
        <Group grow gap="xs">
          <Button variant="default" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            color={color}
            leftSection={icon}
            loading={busy}
            data-autofocus
            onClick={async () => {
              setBusy(true);
              try {
                if (await onConfirm()) onClose();
              } catch {
                // the action reports its own error
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </Group>
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
