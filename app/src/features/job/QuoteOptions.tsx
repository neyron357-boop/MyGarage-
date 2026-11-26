import { Badge, Button, Group, Modal, Stack, TextInput } from '@mantine/core';
import { IconCheck, IconCircleCheck, IconFileTypePdf, IconPlus, IconSend, IconStack2, IconTrash } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, nowIso } from '../../domain/dates';
import { byPosition, itemAmounts, itemTitle } from '../../domain/items';
import { liveOptions, optionable, optionGross, optionItems, optionName } from '../../domain/quoteOptions';
import type { OrderItem, QuoteOption } from '../../domain/types';
import { quoteOptionsPdf, viewPdf } from '../../services/documents';
import { optionsMessage } from '../../services/messages';
import type { OrderBundle } from '../../services/orders';
import { addQuoteOption, chooseQuoteOption, markOptionsSent, putQuoteOptions, removeQuoteOption, renameQuoteOption, toggleOptionLine } from '../../services/quoteOptions';
import { EmptyState, Money, undoToast } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';
import type { SendRequest } from '../../ui/SendDialog';

/*
 * «Варианты» of a job's quote (v0.90, the owner's note #72: «подготовить разные версии сметы и отправлять клиенту и
 * сохранять эти версии… максимально удобно»). Every line stays on the job as typed — the original part and the copy side
 * by side; an option is which of them it has: a tap on a line puts it in or takes it out. Each option — its total, its
 * PDF (the app's own viewer); all of them to the customer in one message with one PDF (a page each); the customer chose
 * one — «Выбрать»: its lines are the job's, the others «не подтверждена» (domain/quoteOptions.ts).
 */

/** The option's name, typed in place (kept when the field is left). */
function OptionName({ orderId, option, n, lang }: { orderId: string; option: QuoteOption; n: number; lang: 'ru' | 'en' }) {
  const { t } = useTranslation();
  const [name, setName] = useState(option.name);
  useEffect(() => setName(option.name), [option.name]);
  const save = () => name.trim() !== option.name && void renameQuoteOption(orderId, option.id, name);
  return (
    <TextInput
      className="qo-name"
      variant="unstyled"
      value={name}
      placeholder={optionName({ name: '' }, n, lang)}
      aria-label={t('qo.name')}
      onChange={(e) => setName(e.currentTarget.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur(), e.preventDefault())}
      maxLength={40}
    />
  );
}

function OptionCard({ b, option, n, lines, onPdf }: { b: OrderBundle; option: QuoteOption; n: number; lines: OrderItem[]; onPdf: () => void }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const lang = b.order.docLanguage;
  const has = new Set(option.itemIds);
  const total = optionGross(b.items, option);
  const off = optionItems(b.items, option).filter((i) => i.kind === 'discount');
  return (
    <div className="qo-card" data-qo={n} data-chosen={!!option.chosenAt || undefined}>
      <div className="qo-head">
        <span className="qo-n" aria-hidden>
          {n}
        </span>
        <OptionName orderId={b.order.id} option={option} n={n} lang={lang} />
        <Money fils={total} roll />
      </div>
      <div className="qo-lines" role="group" aria-label={optionName(option, n, lang)}>
        {lines.map((i) => {
          const on = has.has(i.id);
          return (
            <button
              key={i.id}
              type="button"
              className="qo-line"
              aria-pressed={on}
              data-qo-line={i.id}
              onClick={() =>
                run(async () => {
                  haptic('selection');
                  await toggleOptionLine(b.order.id, option.id, i.id);
                })
              }
            >
              <span className="qo-check" aria-hidden>
                {on && <IconCheck size={14} stroke={3} />}
              </span>
              <span className="qo-title">{itemTitle(i, lang)}</span>
              <Money fils={itemAmounts(i).gross} />
            </button>
          );
        })}
        {off.length > 0 && (
          <div className="qo-off">
            <span>{itemTitle(off[0], lang)}</span>
            <Money fils={off.reduce((a, i) => a + itemAmounts(i).gross, 0)} />
          </div>
        )}
      </div>
      <Group gap={8} mt={10} wrap="nowrap">
        <Button size="compact-md" variant="light" leftSection={<IconFileTypePdf size={16} />} onClick={onPdf} disabled={!option.itemIds.length} data-qo-pdf>
          PDF
        </Button>
        {option.chosenAt ? (
          <Badge color="green" variant="light" leftSection={<IconCircleCheck size={14} />} size="lg" radius="xl" data-qo-chosen>
            {t('qo.chosen')}
          </Badge>
        ) : (
          <Button
            size="compact-md"
            variant="light"
            color="green"
            leftSection={<IconCheck size={16} />}
            disabled={!option.itemIds.length}
            data-qo-choose
            onClick={() =>
              run(async () => {
                await chooseQuoteOption(b.order.id, option.id);
                haptic('success');
              })
            }
          >
            {t('qo.choose')}
          </Button>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="qo-drop"
          aria-label={t('qo.remove')}
          onClick={() =>
            run(async () => {
              const before = b.order.quoteOptions ?? [];
              await removeQuoteOption(b.order.id, option.id);
              undoToast(t('qo.removed'), t('common.undo'), () => void run(() => putQuoteOptions(b.order.id, before)));
            })
          }
        >
          <IconTrash size={18} />
        </button>
      </Group>
    </div>
  );
}

export function QuoteOptionsSheet({ b, opened, onClose, onSend }: { b: OrderBundle; opened: boolean; onClose: () => void; onSend: (r: SendRequest) => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const lang = b.order.docLanguage;
  const options = liveOptions(b.items, b.order.quoteOptions);
  // The job's lines an option can have, in their order — the unconfirmed ones too (an alternative waits as one).
  const lines = b.items.filter(optionable).sort(byPosition);
  const add = () =>
    run(async () => {
      // The first time two at once: one option alone is no choice.
      if (!options.length) await addQuoteOption(b.order.id);
      await addQuoteOption(b.order.id);
      haptic('light');
    });
  const shown = options.map((o, k) => ({ o, k })).filter(({ o }) => o.itemIds.length);
  // A line without its price (a request's part still to find): the options wait for it — never «0.00» to the customer.
  const unpriced = shown.some(({ o }) => optionItems(b.items, o).some((i) => i.kind !== 'discount' && !i.customerSupplied && !(i.unitPriceFils > 0)));
  const send = () => {
    const ctx = { customer: b.customer, vehicle: b.vehicle, order: b.order, garageName: b.settings.name };
    const ids = shown.map(({ o }) => o.id);
    onSend({
      text: optionsMessage(
        ctx,
        lang,
        shown.map(({ o, k }) => ({ name: optionName(o, k + 1, lang), items: optionItems(b.items, o) })),
        addDays(nowIso(), b.settings.estimateValidityDays),
      ),
      template: 'quoteOptions',
      lang,
      orderId: b.order.id,
      pdf: () => quoteOptionsPdf(b.order.id, ids),
      onConfirm: () => markOptionsSent(b.order.id, ids),
    });
  };
  return (
    <Modal opened={opened} onClose={onClose} title={t('qo.title')} classNames={{ content: 'sheet-grouped' }} data-qo-sheet>
      {options.length ? (
        <Stack gap="md">
          {options.map((o, k) => (
            <OptionCard key={o.id} b={b} option={o} n={k + 1} lines={lines} onPdf={() => viewPdf(quoteOptionsPdf(b.order.id, [o.id]), `${b.order.number}-${k + 1} · ${optionName(o, k + 1, lang)}`)} />
          ))}
          <Button variant="default" leftSection={<IconPlus size={18} />} onClick={add} loading={busy} data-qo-add>
            {t('qo.add')}
          </Button>
          <Button size="md" leftSection={<IconSend size={18} />} onClick={send} disabled={shown.length < 2 || unpriced} data-qo-send>
            {t('qo.send', { n: shown.length })}
          </Button>
        </Stack>
      ) : (
        <EmptyState
          icon={IconStack2}
          title={t('qo.title')}
          action={
            <Button leftSection={<IconPlus size={18} />} onClick={add} loading={busy} data-qo-add>
              {t('qo.make')}
            </Button>
          }
        />
      )}
    </Modal>
  );
}
