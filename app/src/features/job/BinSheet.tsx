import { Button, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowBackUp, IconBuildingStore, IconPackage, IconTool, IconTrash } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { binOf, type BinLine } from '../../domain/bin';
import { dayShort } from '../../domain/dates';
import { itemAmounts, itemTitle } from '../../domain/items';
import { isLabourCharge } from '../../domain/linePrices';
import { restoreFromBin } from '../../services/flow';
import type { OrderBundle } from '../../services/orders';
import { EmptyState, List, ListRow, Money } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';

/** A line's kind at a glance, as the tiles under the lines: work blue, a part orange, a service violet. */
function KindIcon({ line }: { line: BinLine }) {
  const i = line.item;
  const [I, c] = i.kind === 'part' ? [IconPackage, 'orange'] : i.outsource || !isLabourCharge(i.titleEn || i.titleRu || '') ? [IconBuildingStore, 'violet'] : [IconTool, 'blue'];
  return (
    <span className="row-icon" style={{ background: `var(--mantine-color-${c}-6)` }} aria-hidden>
      <I size={18} stroke={2} />
    </span>
  );
}

/**
 * The job's bin (v0.68, «…» → «Корзина»): the lines deleted and the ones taken off after the customer was told — the
 * name, the price it had, when; «Вернуть» brings one back as a draft (domain/bin.ts, `restoreFromBin`). Looked at any
 * time; brought back while lines can be added.
 */
export function BinSheet({ b, opened, onClose, canRestore }: { b: OrderBundle; opened: boolean; onClose: () => void; canRestore: boolean }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const lang = b.order.docLanguage;
  const lines = binOf(b.order, b.items);
  const restore = (ids: string[]) =>
    run(async () => {
      const n = await restoreFromBin(b.order.id, ids);
      haptic('success');
      if (n) notifications.show({ color: 'green', message: t('job.bin.restored', { count: n }) });
      if (n >= lines.length) onClose();
    });
  const when = (at: string) => {
    const d = dayShort(at);
    return d.word ? t(`common.${d.word}`) : d.text;
  };
  return (
    <Modal opened={opened} onClose={onClose} title={t('job.bin.title')}>
      {lines.length ? (
        <Stack gap="md">
          <List animate>
            {lines.map((l) => (
              <ListRow
                key={l.id}
                left={<KindIcon line={l} />}
                title={itemTitle(l.item, lang)}
                subtitle={
                  <>
                    <Text span inherit c={l.how === 'deleted' ? 'red.7' : 'orange.7'}>
                      {t(`job.bin.${l.how}`)}
                    </Text>
                    {' · '}
                    {when(l.at)}
                    {l.item.qty !== 1 ? ` · ×${l.item.qty}` : ''}
                  </>
                }
                right={
                  <span className="bin-right">
                    <Money fils={itemAmounts(l.item).gross} />
                    {canRestore && (
                      <Button size="compact-md" variant="light" leftSection={<IconArrowBackUp size={16} />} loading={busy} onClick={() => void restore([l.id])} aria-label={`${t('job.bin.restore')}: ${itemTitle(l.item, lang)}`}>
                        {t('job.bin.restore')}
                      </Button>
                    )}
                  </span>
                }
              />
            ))}
          </List>
          {canRestore && lines.length > 1 && (
            <Button variant="light" fullWidth leftSection={<IconArrowBackUp size={18} />} loading={busy} onClick={() => void restore(lines.map((l) => l.id))}>
              {t('job.bin.restoreAll', { n: lines.length })}
            </Button>
          )}
        </Stack>
      ) : (
        <EmptyState icon={IconTrash} title={t('job.bin.empty')} />
      )}
    </Modal>
  );
}
