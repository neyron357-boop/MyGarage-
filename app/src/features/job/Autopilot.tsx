import { Button, Text } from '@mantine/core';
import { IconSparkles } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAed } from '../../domain/money';
import { itemTitle } from '../../domain/items';
import { autopilotOf, askForPrices, type AutopilotView } from '../../services/autopilot';
import type { OrderBundle } from '../../services/orders';
import { ListRow } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useLang } from '../../ui/hooks';

/**
 * A request's autopilot on its job (v0.98, services/autopilot.ts): its one next step, with what it does in sight —
 * «Спросить цены · 3» (whom: the suppliers ranked for the job) → the usual «Проверить и отправить»; «Ждём цены · ответили 1 из 3»;
 * «Осталось назвать цену» (which lines); «Смета готова · 1 250 AED → Отправить» (the job's own «Клиенту»). Read again as the
 * job changes (a reply priced it, a line added).
 */
export function AutopilotRow({ b, onSend }: { b: OrderBundle; onSend: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run, busy } = useAction({ exclusive: true });
  const [v, setV] = useState<AutopilotView>();
  useEffect(() => {
    let alive = true;
    void autopilotOf(b.order.id).then((x) => alive && setV(x));
    return () => {
      alive = false;
    };
  }, [b]);
  if (!v || v.step === 'none') return null;
  const docLang = b.order.docLanguage ?? 'en';
  const names = (list: { titleEn?: string; titleRu?: string }[]) =>
    list
      .slice(0, 3)
      .map((i) => itemTitle(i, docLang))
      .join(', ') + (list.length > 3 ? ` +${list.length - 3}` : '');
  const row = (title: string, subtitle: string | undefined, right?: React.ReactNode) => (
    <ListRow
      left={<IconSparkles size={20} stroke={1.9} color="var(--mantine-color-cobalt-6)" aria-hidden />}
      title={
        <Text span inherit fw={600} data-autopilot={v.step}>
          {title}
        </Text>
      }
      subtitle={subtitle}
      right={right}
    />
  );
  if (v.step === 'ask')
    return row(
      t('autopilot.ask', { n: v.parts.length }),
      v.suppliers.length ? v.suppliers.map((s) => s.name).join(', ') : t('autopilot.noSuppliers'),
      v.suppliers.length ? (
        <Button
          size="compact-md"
          variant="light"
          disabled={busy}
          data-autopilot-ask
          onClick={() =>
            run(async () => {
              await askForPrices(b.order.id);
              haptic('light');
            })
          }
        >
          {t('autopilot.askGo')}
        </Button>
      ) : undefined,
    );
  if (v.step === 'wait') return row(t('autopilot.wait'), t('autopilot.answered', { n: v.answered, of: v.asked }));
  if (v.step === 'left') return row(t('autopilot.left'), names(v.left));
  return row(
    t('autopilot.quote', { sum: formatAed(v.totalFils, lang) }),
    t('autopilot.quoteHint'),
    <Button size="compact-md" variant="filled" disabled={busy} onClick={onSend} data-autopilot-send>
      {t('autopilot.send')}
    </Button>,
  );
}
