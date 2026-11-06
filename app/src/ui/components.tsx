import { ActionIcon, Badge, Box, Group, Image, Loader, Modal, Stack, Text, TextInput, ThemeIcon, Title, Tooltip, UnstyledButton } from '@mantine/core';
import {
  IconAlertTriangle,
  IconArchive,
  IconArrowLeft,
  IconBrandTelegram,
  IconBrandWhatsapp,
  IconCalendarTime,
  IconCash,
  IconChecklist,
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
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { formatAed, parseAed } from '../domain/money';
import { normalizePlate } from '../domain/plates';
import type { Emirate, Plate, Stage } from '../domain/types';
import { mediaUrl } from '../services/media';
import { telegramUrl, whatsappUrl } from '../services/messages';
import { useLang } from './hooks';

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
export function PlateText({ plate, size = 'sm' }: { plate: Plate; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
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

export function StageBadge({ stage, size = 'md' }: { stage: Stage; size?: 'sm' | 'md' | 'lg' }) {
  const { t } = useTranslation();
  const m = STAGE_META[stage];
  return (
    <Badge color={m.color} size={size} leftSection={<m.icon size={size === 'lg' ? 15 : 13} stroke={2} />}>
      {t(`stage.${stage}`)}
    </Badge>
  );
}

/** Eight-segment progress of a job from check-in to handover. */
export function StageTrack({ stage }: { stage: Stage }) {
  const step = STAGE_META[stage].step;
  return (
    <div className="stage-track" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <span key={i} className={i + 1 < step ? 'done' : i + 1 === step ? 'now' : ''} />
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

export function PageHeader({ title, back, right, subtitle, eyebrow }: { title: ReactNode; back?: string | boolean; right?: ReactNode; subtitle?: ReactNode; eyebrow?: ReactNode }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <Group justify="space-between" align="flex-start" mb="lg" wrap="nowrap" gap="sm">
      <Group gap={6} align="flex-start" wrap="nowrap" style={{ minWidth: 0 }}>
        {back && (
          <ActionIcon
            variant="subtle"
            color="gray"
            size={40}
            ml={-8}
            aria-label={t('common.back')}
            onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}
          >
            <IconArrowLeft size={22} />
          </ActionIcon>
        )}
        <Box style={{ minWidth: 0 }} pt={back ? 4 : 0}>
          {eyebrow && <div className="eyebrow" style={{ marginBottom: 2 }}>{eyebrow}</div>}
          <Title order={2} style={{ textWrap: 'balance' }}>
            {title}
          </Title>
          {subtitle && (
            <Text size="sm" c="dimmed" component="div" mt={4}>
              {subtitle}
            </Text>
          )}
        </Box>
      </Group>
      {right && <Box style={{ flexShrink: 0 }}>{right}</Box>}
    </Group>
  );
}

export function Section({ title, description, action, children, mt = 'xl' }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; mt?: string | number }) {
  return (
    <Box mt={mt}>
      <Group justify="space-between" align="flex-end" mb="xs" wrap="nowrap" gap="sm">
        <Box style={{ minWidth: 0 }}>
          <Title order={5}>{title}</Title>
          {description && (
            <Text size="xs" c="dimmed" mt={2}>
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
      onKeyDown={onClick ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick() : undefined}
    >
      {left}
      <div className="body">
        <Text fw={600} size="sm" lineClamp={3} component="div">
          {title}
        </Text>
        {subtitle && (
          <Text size="xs" c="dimmed" component="div" mt={2}>
            {subtitle}
          </Text>
        )}
      </div>
      {right}
      {chevron && <IconChevronRight size={18} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} />}
    </div>
  );
}

export function Kpi({ label, value, hint, color, onClick }: { label: ReactNode; value: ReactNode; hint?: ReactNode; color?: string; onClick?: () => void }) {
  return (
    <div className={`kpi${onClick ? ' tap' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined}>
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

/** Primary actions pinned to the bottom of the screen (above the phone tab bar). */
export function StickyBar({ children }: { children: ReactNode }) {
  return <div className="sticky-bar no-print">{children}</div>;
}

export interface TabItem {
  value: string;
  label: ReactNode;
  count?: number;
}

/** Horizontal pill tabs that scroll instead of wrapping. */
export function ScrollTabs({ value, onChange, items, mb = 'md' }: { value: string; onChange: (v: string) => void; items: TabItem[]; mb?: string }) {
  return (
    <Box mb={mb} className="scroll-tabs" role="tablist">
      {items.map((it) => (
        <button key={it.value} type="button" role="tab" data-active={it.value === value} aria-selected={it.value === value} onClick={() => onChange(it.value)}>
          {it.label}
          {it.count !== undefined && <span className="count">{it.count}</span>}
        </button>
      ))}
    </Box>
  );
}

/** Round contact buttons: WhatsApp, Telegram, call. */
export function ContactButtons({ phone, whatsapp, size = 38 }: { phone: string; whatsapp?: string; size?: number }) {
  const { t } = useTranslation();
  return (
    <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
      <Tooltip label="WhatsApp">
        <ActionIcon component="a" href={whatsappUrl(whatsapp || phone, '')} target="_blank" rel="noopener" size={size} radius="xl" color="green" variant="light" aria-label="WhatsApp">
          <IconBrandWhatsapp size={20} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Telegram">
        <ActionIcon component="a" href={telegramUrl('')} target="_blank" rel="noopener" size={size} radius="xl" color="cobalt" variant="light" aria-label="Telegram">
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

export function Logo({ size = 28, inverted = true }: { size?: number; inverted?: boolean }) {
  return (
    <Group gap={8} wrap="nowrap">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="9" fill="#3f5be9" />
        <path d="M6.5 19.5l2.2-5.6a3 3 0 012.8-1.9h9a3 3 0 012.8 1.9l2.2 5.6v4.2a1 1 0 01-1 1h-2a1 1 0 01-1-1v-1H10.5v1a1 1 0 01-1 1h-2a1 1 0 01-1-1z" fill="#fff" />
        <path d="M9.6 17.2l1.5-3.4a1 1 0 01.9-.6h8a1 1 0 01.9.6l1.5 3.4z" fill="#3f5be9" />
        <circle cx="11" cy="20.3" r="1.4" fill="#3f5be9" />
        <circle cx="21" cy="20.3" r="1.4" fill="#3f5be9" />
      </svg>
      <span className="display" style={{ fontSize: size * 0.68, letterSpacing: '0.06em', textTransform: 'uppercase', color: inverted ? '#fff' : 'inherit' }}>
        MyGarage
      </span>
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
      <Modal opened={open} onClose={() => setOpen(false)} size="xl" withCloseButton padding="xs">
        {open && <MediaImage id={id} thumb={false} h="75vh" w="100%" radius="md" />}
      </Modal>
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

export function SelectCard({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <UnstyledButton className="choice-card" data-active={active} onClick={onClick}>
      {children}
    </UnstyledButton>
  );
}
