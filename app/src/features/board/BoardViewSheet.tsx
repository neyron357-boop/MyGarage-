import { Modal, SegmentedControl, Stack, Switch } from '@mantine/core';
import { IconArchive, IconLayoutKanban, IconMenu2, IconUserDollar, type Icon } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { Phase } from '../../domain/flow';
import { canHide, setBoardView, useBoardView, type BoardTab, type CardSize } from '../../ui/boardView';
import { List, ListRow } from '../../ui/components';
import { usePhone } from '../../ui/hooks';
import { useSortable } from '../../ui/sortable';
import { PHASE_META } from '../job/phase';

/** A tab of the board as the sheet lists it: its symbol on a squircle of its colour, its name. */
export function useBoardTabLook() {
  const { t } = useTranslation();
  return (k: BoardTab): { name: string; icon: Icon; color: string } => {
    if (k === 'all') return { name: t('board.all'), icon: IconLayoutKanban, color: 'gray' };
    if (k === 'debts') return { name: t('board.tabDebts'), icon: IconUserDollar, color: PHASE_META.debt.color };
    if (k === 'archive') return { name: t('board.archive'), icon: IconArchive, color: 'gray' };
    const m = PHASE_META[k as Phase];
    return { name: t(`job.phase.${k}`), icon: m.icon, color: m.color };
  };
}

/**
 * «Вид» of the board (v0.22), on this device: the cards large or compact, and the tabs — dragged by their grip
 * (≡) into the order the strip shows them; a step switched off leaves the strip (its cars stay under «Все»).
 * «Все» stays first; «Долги» and «Архив» move but stay. A PC has no strip — its columns follow the order, and a
 * step is never switched off there (a column holds its cars, and there is no «Все»).
 */
export function BoardViewSheet({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const phone = usePhone();
  const view = useBoardView();
  const look = useBoardTabLook();
  const movable = view.order.filter((k) => k !== 'all');
  const grip = useSortable(movable, (ids) => setBoardView({ order: ['all', ...(ids as BoardTab[])] }));
  const hidden = new Set(view.hidden);
  const icon = (k: BoardTab) => {
    const l = look(k);
    return (
      <span className="row-icon" style={{ background: `var(--mantine-color-${l.color}-6)` }}>
        <l.icon size={18} stroke={2} />
      </span>
    );
  };
  return (
    <Modal opened={opened} onClose={onClose} title={t('board.view')}>
      <Stack gap="lg">
        <SegmentedControl
          fullWidth
          value={view.size}
          onChange={(v) => setBoardView({ size: v as CardSize })}
          data={[
            { value: 'large', label: t('board.sizeLarge') },
            { value: 'compact', label: t('board.sizeCompact') },
          ]}
        />
        <div>
          <div className="group-title">{t('board.tabs')}</div>
          <List animate className="board-tabs-list">
            <ListRow left={icon('all')} title={look('all').name} />
            {movable.map((k) => (
              <ListRow
                key={k}
                left={icon(k)}
                title={look(k).name}
                dim={phone && hidden.has(k)}
                right={
                  phone && canHide(k) ? (
                    <Switch
                      checked={!hidden.has(k)}
                      onChange={(e) => setBoardView({ hidden: e.currentTarget.checked ? view.hidden.filter((x) => x !== k) : [...view.hidden, k] })}
                      aria-label={look(k).name}
                    />
                  ) : undefined
                }
                grip={
                  <span className="sort-grip" aria-label={t('job.move')} {...grip(k)}>
                    <IconMenu2 size={20} stroke={2} />
                  </span>
                }
              />
            ))}
          </List>
        </div>
      </Stack>
    </Modal>
  );
}
