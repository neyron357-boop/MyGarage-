import { Button, Modal, Stack, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { itemTitle } from '../../domain/items';
import { qtyShort } from '../../domain/sides';
import type { Lang, OrderItem } from '../../domain/types';
import { noteLineQty, setLineQty } from '../../services/flow';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';

/*
 * A part whose name asks for more than its quantity (v0.70, «деталь на обе стороны закупаю, а в инвойсе одна сторона и
 * цена за одну сторону… предупреждать, без ИИ»; the rule — domain/sides.ts): asked where the line is typed (its sheet),
 * marked on the job's line («×2?»), and asked again before the customer sees it (sent, invoiced). Two answers: as many as
 * the name says (the price ×2), or the price is already for all of them (asked no more).
 */

/** The question on one line: what its name says, «×2», «Цена за 2». */
export function QtyAsk({ n, onFix, onNote, title }: { n: number; onFix: () => void; onNote: () => void; title?: string }) {
  const { t } = useTranslation();
  return (
    <div className="qty-warn" data-qty-short={n}>
      <IconAlertTriangle size={18} stroke={2} className="qty-warn-icon" aria-hidden />
      <span className="qty-warn-text">
        {title && <b>{title}</b>}
        <span>{t('qty.says', { n })}</span>
      </span>
      <span className="qty-warn-buttons">
        <Button size="compact-md" color="orange" onClick={onFix} data-qty-fix>
          ×{n}
        </Button>
        <Button size="compact-md" variant="light" color="gray" onClick={onNote} data-qty-note>
          {t('qty.priceFor', { n })}
        </Button>
      </span>
    </div>
  );
}

/** Every part of these short of its name, each with its question (an answered one leaves the list). */
export function QtyCheckList({ items, lang }: { items: OrderItem[]; lang: Lang }) {
  const { run } = useAction();
  const short = items.map((i) => ({ i, n: qtyShort(i) })).filter((x): x is { i: OrderItem; n: number } => !!x.n);
  if (!short.length) return null;
  return (
    <Stack gap={8}>
      {short.map(({ i, n }) => (
        <QtyAsk
          key={i.id}
          n={n}
          title={itemTitle(i, lang)}
          onFix={() => void run(async () => (await setLineQty(i.id, n), haptic('success')))}
          onNote={() => void run(async () => (await noteLineQty(i.id, n), haptic('light')))}
        />
      ))}
    </Stack>
  );
}

/** Before the customer sees them: the parts short of their names — then on, once looked at (or at once, none). */
export function QtyCheckSheet({ items, lang, opened, onClose, onGo, goLabel }: { items: OrderItem[]; lang: Lang; opened: boolean; onClose: () => void; onGo: () => void; goLabel: string }) {
  const { t } = useTranslation();
  const left = items.filter((i) => qtyShort(i)).length;
  return (
    <Modal opened={opened} onClose={onClose} title={t('qty.title')}>
      <Stack gap="md">
        <QtyCheckList items={items} lang={lang} />
        {!left && (
          <Text size="sm" c="teal.7">
            {t('qty.allSet')}
          </Text>
        )}
        <Button
          fullWidth
          size="lg"
          variant={left ? 'light' : 'filled'}
          onClick={() => {
            onClose();
            onGo();
          }}
          data-qty-go
        >
          {goLabel}
        </Button>
      </Stack>
    </Modal>
  );
}
