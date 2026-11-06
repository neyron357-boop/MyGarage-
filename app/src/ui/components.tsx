import { ActionIcon, Badge, Box, Group, Image, Loader, Modal, Paper, Stack, Text, TextInput, Title, Tooltip } from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCash,
  IconHourglass,
  IconPackage,
  IconParking,
  IconRepeat,
} from '@tabler/icons-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { formatAed, parseAed } from '../domain/money';
import { formatPlate } from '../domain/plates';
import type { Plate, Stage } from '../domain/types';
import { mediaUrl } from '../services/media';
import { useLang } from './hooks';

export function Money({ fils, size, fw, c }: { fils: number; size?: string; fw?: number; c?: string }) {
  const lang = useLang();
  return (
    <Text span size={size} fw={fw} c={c} style={{ whiteSpace: 'nowrap' }}>
      {formatAed(fils, lang)}
    </Text>
  );
}

export function PlateText({ plate, size = 'sm' }: { plate: Plate; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const lang = useLang();
  return (
    <Badge variant="outline" color="dark" radius="sm" size={size} style={{ textTransform: 'none', fontFamily: 'monospace', letterSpacing: 0.5 }}>
      {formatPlate(plate, lang)}
    </Badge>
  );
}

const STAGE_COLOR: Record<Stage, string> = {
  booked: 'gray',
  intake: 'indigo',
  diagnostics: 'violet',
  awaiting_approval: 'yellow',
  awaiting_parts: 'orange',
  in_progress: 'blue',
  quality_check: 'cyan',
  ready: 'green',
  delivered: 'teal',
  closed: 'dark',
  cancelled: 'red',
};

export function StageBadge({ stage }: { stage: Stage }) {
  const { t } = useTranslation();
  return (
    <Badge color={STAGE_COLOR[stage]} variant="light">
      {t(`stage.${stage}`)}
    </Badge>
  );
}

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
  if (flags.waitingClientSince)
    items.push(
      <Badge key="w" color={color} leftSection={<IconHourglass size={12} />} variant="light">
        {t('flags.waitingClient')}
        {hours !== undefined ? ` · ${hours < 1 ? Math.max(1, Math.round(hours * 60)) + (lang === 'ru' ? ' мин' : ' min') : Math.floor(hours) + (lang === 'ru' ? ' ч' : ' h')}` : ''}
      </Badge>,
    );
  if (flags.waitingParts)
    items.push(
      <Badge key="p" color="orange" leftSection={<IconPackage size={12} />} variant="light">
        {t('flags.waitingParts')}
      </Badge>,
    );
  if (flags.debt)
    items.push(
      <Badge key="d" color="red" leftSection={<IconCash size={12} />} variant="light">
        {t('flags.debt')}
      </Badge>,
    );
  if (flags.incident)
    items.push(
      <Badge key="i" color="red" leftSection={<IconAlertTriangle size={12} />} variant="light">
        {t('flags.incident')}
      </Badge>,
    );
  if (flags.warranty)
    items.push(
      <Badge key="r" color="grape" leftSection={<IconRepeat size={12} />} variant="light">
        {t('flags.warranty')}
      </Badge>,
    );
  if (flags.storageDays)
    items.push(
      <Badge key="s" color="red" leftSection={<IconParking size={12} />} variant="light">
        {t('flags.storage', { days: flags.storageDays })}
      </Badge>,
    );
  if (!items.length) return null;
  return <Group gap={4}>{items}</Group>;
}

export function PageHeader({ title, back, right, subtitle }: { title: ReactNode; back?: string | boolean; right?: ReactNode; subtitle?: ReactNode }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <Group justify="space-between" align="flex-start" mb="md" wrap="nowrap">
      <Group gap="xs" align="flex-start" wrap="nowrap" style={{ minWidth: 0 }}>
        {back && (
          <ActionIcon
            variant="subtle"
            size="lg"
            aria-label={t('common.back')}
            onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}
          >
            <IconArrowLeft />
          </ActionIcon>
        )}
        <Box style={{ minWidth: 0 }}>
          <Title order={3} style={{ lineHeight: 1.2 }}>
            {title}
          </Title>
          {subtitle && (
            <Text size="sm" c="dimmed" component="div">
              {subtitle}
            </Text>
          )}
        </Box>
      </Group>
      {right}
    </Group>
  );
}

/** Amount input in AED that stores fils. */
export function MoneyInput({
  label,
  value,
  onChange,
  required,
  description,
  error,
  autoFocus,
}: {
  label: ReactNode;
  value: number | undefined;
  onChange: (fils: number | undefined) => void;
  required?: boolean;
  description?: ReactNode;
  error?: ReactNode;
  autoFocus?: boolean;
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
      rightSection={<Text size="xs" c="dimmed">AED</Text>}
      rightSectionWidth={44}
      value={text}
      error={error}
      autoFocus={autoFocus}
      onChange={(e) => {
        setText(e.currentTarget.value);
        const f = parseAed(e.currentTarget.value);
        onChange(f ?? undefined);
      }}
    />
  );
}

export function MediaImage({ id, thumb = true, h = 90, w, radius = 'sm', onClick }: { id: string; thumb?: boolean; h?: number; w?: number | string; radius?: string; onClick?: () => void }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    void mediaUrl(id, thumb).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [id, thumb]);
  if (!url) return <Paper h={h} w={w ?? h} radius={radius} withBorder style={{ display: 'grid', placeItems: 'center' }}><Loader size="xs" /></Paper>;
  return <Image src={url} h={h} w={w ?? h} radius={radius} fit="cover" onClick={onClick} style={onClick ? { cursor: 'zoom-in' } : undefined} alt="" />;
}

/** Thumbnail that opens the full photo. */
export function Photo({ id, h = 90, w, label }: { id: string; h?: number; w?: number | string; label?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Stack gap={2} align="center">
        <MediaImage id={id} h={h} w={w} onClick={() => setOpen(true)} />
        {label && (
          <Text size="xs" c="dimmed" ta="center">
            {label}
          </Text>
        )}
      </Stack>
      <Modal opened={open} onClose={() => setOpen(false)} size="xl" centered withCloseButton>
        {open && <MediaImage id={id} thumb={false} h={600} w="100%" radius="md" />}
      </Modal>
    </>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <Paper p="lg" withBorder radius="md" ta="center" c="dimmed">
      {children}
    </Paper>
  );
}

export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip label={label} multiline w={240} withArrow>
      <span>{children}</span>
    </Tooltip>
  );
}
