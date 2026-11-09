import { Box, Group, Modal, Stack, Text } from '@mantine/core';
import { IconExternalLink, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { formatDateTime, hoursBetween, shortDuration } from '../../domain/dates';
import { summarize } from '../../domain/items';
import type { OrderBundle } from '../../services/orders';
import { Flags, List, ListRow, Money, PlateText, STAGE_META, StageTrack } from '../../ui/components';
import { useLang } from '../../ui/hooks';
import { useLongPress } from '../../ui/longPress';
import { DeleteJobModal } from './DeleteJob';
import { orderFlags } from './flags';

/**
 * Compact job card used on the board and in lists. A tap opens the job; a long press (right click on a
 * PC) brings its actions, as on iPhone: open, delete.
 */
export function JobCard({ b, showStage = true }: { b: OrderBundle; showStage?: boolean }) {
  const navigate = useNavigate();
  const lang = useLang();
  const { t } = useTranslation();
  const [menu, setMenu] = useState(false);
  const [remove, setRemove] = useState(false);
  const press = useLongPress(() => setMenu(true));
  const { flags, waitingHours } = orderFlags(b);
  const sum = summarize(b.items);
  const meta = STAGE_META[b.order.stage];
  const amount = sum.approvedGross || sum.fixedGross;
  const open = () => navigate(`/orders/${b.order.id}`);
  return (
    <>
    <Box
      className="surface tap"
      p="md"
      {...press.handlers}
      onClick={() => {
        if (!press.consumeClick()) open();
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(`/orders/${b.order.id}`);
        }
      }}
      aria-label={`№${b.order.number} ${b.vehicle.make} ${b.vehicle.model}`}
    >
      <Group justify="space-between" wrap="nowrap" gap="xs" mb={10}>
        <PlateText plate={b.vehicle.plate} size="sm" />
        <Text size="sm" c="dimmed" className="tnum" style={{ whiteSpace: 'nowrap' }}>
          №{b.order.number} · {shortDuration(hoursBetween(b.order.stageChangedAt), lang)}
        </Text>
      </Group>
      <Text fw={600} fz={17} lh={1.3} lineClamp={1} style={{ letterSpacing: '-0.01em' }}>
        {b.vehicle.make} {b.vehicle.model}
        {b.vehicle.year ? <Text span c="dimmed" fw={400}> {b.vehicle.year}</Text> : null}
      </Text>
      <Text fz={15} c="dimmed" lineClamp={1}>
        {b.customer.name || t('customer.noName')}
        {b.mechanic ? ` · ${b.mechanic.name}` : ''}
      </Text>
      {b.order.stage === 'booked' && b.order.bookedFor ? (
        <Text fz={15} mt={6} fw={600}>
          {formatDateTime(b.order.bookedFor)}
        </Text>
      ) : (
        b.order.complaint && (
          <Text fz={15} mt={6} lineClamp={2} lh={1.35}>
            {b.order.complaint}
          </Text>
        )
      )}
      <Stack gap={8} mt={12}>
        {b.order.stage !== 'booked' && <StageTrack stage={b.order.stage} />}
        <Group justify="space-between" wrap="nowrap" gap="xs">
          {showStage ? (
            <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
              <span className="stage-dot" style={{ background: `var(--mantine-color-${meta.color}-6)` }} />
              <Text fz={13} fw={600} lineClamp={1}>
                {t(`stage.${b.order.stage}`)}
              </Text>
            </Group>
          ) : (
            <span />
          )}
          {amount > 0 && <Money fils={amount} size="sm" />}
        </Group>
        <Flags flags={flags} hours={waitingHours} warnHours={b.settings.boardWarnHours} alertHours={b.settings.boardAlertHours} />
      </Stack>
    </Box>
    {/* The card's actions (long press), a sheet like the iPhone's context menu. */}
    <Modal opened={menu} onClose={() => setMenu(false)} title={`№${b.order.number} · ${b.vehicle.make} ${b.vehicle.model}`.trim()}>
      <List>
        <ListRow
          title={t('common.open')}
          left={<IconExternalLink size={20} stroke={1.8} />}
          chevron
          onClick={() => {
            setMenu(false);
            open();
          }}
        />
        <ListRow
          title={
            <Text span inherit c="red">
              {t('order.delete')}
            </Text>
          }
          left={<IconTrash size={20} stroke={1.8} color="var(--mantine-color-red-6)" />}
          onClick={() => {
            setMenu(false);
            setRemove(true);
          }}
        />
      </List>
    </Modal>
    <DeleteJobModal order={b.order} opened={remove} onClose={() => setRemove(false)} />
    </>
  );
}
