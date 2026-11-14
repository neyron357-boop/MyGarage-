import { Badge, Box, Group, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconCircleCheck, IconCircleX, IconHourglassHigh, IconWand } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../domain/dates';
import { lineName } from '../../domain/items';
import type { EstimateVersion } from '../../domain/types';
import type { OrderBundle } from '../../services/orders';
import { Money } from '../../ui/components';

const DECISION_ICON = { approve: { icon: IconCircleCheck, color: 'green' }, decline: { icon: IconCircleX, color: 'red' }, call_me: { icon: IconWand, color: 'violet' }, do_if_needed: { icon: IconWand, color: 'violet' } } as const;

/** A quote as it went to the customer, with what they answered on each line (a claim shows what was agreed). */
export function VersionCard({ v, b }: { v: EstimateVersion; b: OrderBundle }) {
  const { t } = useTranslation();
  const decisions = b.decisions.filter((d) => d.versionId === v.id);
  return (
    <Box className="surface" p="md">
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
          <ThemeIcon radius="xl" size={36} variant="light" color={v.number === 1 ? 'cobalt' : 'orange'} style={{ flexShrink: 0 }}>
            <Text fw={800} size="sm" className="display">
              v{v.number}
            </Text>
          </ThemeIcon>
          <div>
            <Text fw={700}>{t(`versionKind.${v.kind}`)}</Text>
            <Text size="xs" c="dimmed">
              {formatDateTime(v.sentAt)} · {t(`sendVia.${v.sentVia}`)}
            </Text>
          </div>
        </Group>
        <Badge color={v.status === 'answered' ? 'green' : v.status === 'withdrawn' ? 'gray' : 'yellow'}>{t(`versionStatus.${v.status}`)}</Badge>
      </Group>
      {v.reason && (
        <Text size="sm" mt="sm" fw={500}>
          {v.reason}
        </Text>
      )}
      <Stack gap={6} mt="sm">
        {v.items.map((s) => {
          const d = decisions.filter((x) => x.itemId === s.itemId).pop();
          const m = d ? DECISION_ICON[d.decision] : { icon: IconHourglassHigh, color: 'yellow' };
          return (
            <Group key={s.itemId} justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
              <Group gap={8} wrap="nowrap" align="flex-start" style={{ minWidth: 0 }}>
                <m.icon size={18} color={`var(--mantine-color-${m.color}-6)`} style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ minWidth: 0 }}>
                  <Text size="sm">{lineName(s.title, s.kind)}</Text>
                  {d && (
                    <Text size="xs" c="dimmed">
                      {t(`via.${d.via}`)} · {formatDateTime(d.decidedAt)}
                    </Text>
                  )}
                </div>
              </Group>
              <Text size="sm" fw={600} className="tnum" style={{ whiteSpace: 'nowrap' }}>
                {s.minGross !== undefined && s.maxGross !== undefined && s.minGross !== s.maxGross ? (
                  <>
                    <Money fils={s.minGross} /> – <Money fils={s.maxGross} />
                  </>
                ) : (
                  <Money fils={s.gross} />
                )}
              </Text>
            </Group>
          );
        })}
      </Stack>
      <Box mt="sm" pt="sm" style={{ borderTop: '1px solid var(--app-hairline)' }}>
        <Text size="sm" c="dimmed">
          {t('estimate.fixed')} <Money fils={v.fixedGross} />
          {v.maxGross !== v.fixedGross && (
            <>
              {' · '}
              {t('estimate.upTo')} <Money fils={v.maxGross} />
            </>
          )}
          {' · '}
          {t('version.validUntil')} {formatDateTime(v.validUntil).slice(0, 10)}
        </Text>
      </Box>
    </Box>
  );
}
