import { ActionIcon, Modal, Stack, Text } from '@mantine/core';
import { IconFileSpreadsheet, IconTableExport, IconTableImport } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAed } from '../../domain/money';
import { exportMoneySheet, importMoneyPlan, planMoneyImport, type MoneyImportPlan } from '../../services/moneySheet';
import { ConfirmModal } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';
import { shareOrDownload } from '../../ui/share';

/**
 * The money book in and out of the garage's own Excel sheet ("Money Tracker — Income & Expenses"):
 * a button in the money screen's header, a sheet with "Export" and "Import". The export is made as the
 * sheet opens, so the tap shares it at once (an iPhone allows sharing only right in the tap).
 */
export function MoneySheetActions() {
  const { t } = useTranslation();
  const { run } = useAction();
  const [opened, setOpened] = useState(false);
  const [file, setFile] = useState<File>();
  const [plan, setPlan] = useState<MoneyImportPlan | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!opened) return;
    let alive = true;
    setFile(undefined);
    void exportMoneySheet().then((f) => alive && setFile(f));
    return () => {
      alive = false;
    };
  }, [opened]);
  return (
    <>
      <ActionIcon variant="default" size={40} radius="md" aria-label={t('moneySheet.title')} onClick={() => setOpened(true)}>
        <IconFileSpreadsheet size={20} />
      </ActionIcon>
      <Modal opened={opened} onClose={() => setOpened(false)} title={t('moneySheet.title')}>
        <div className="action-tiles">
          <button
            type="button"
            className="action-tile"
            disabled={!file}
            onClick={() => {
              if (!file) return;
              shareOrDownload(file);
              setOpened(false);
            }}
          >
            <IconTableExport size={26} stroke={1.7} style={{ color: 'var(--mantine-color-green-6)' }} aria-hidden />
            <span>{t('moneySheet.export')}</span>
          </button>
          <button type="button" className="action-tile" onClick={() => input.current?.click()}>
            <IconTableImport size={26} stroke={1.7} style={{ color: 'var(--mantine-color-cobalt-6)' }} aria-hidden />
            <span>{t('moneySheet.import')}</span>
          </button>
        </div>
      </Modal>
      <input
        ref={input}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        data-money-sheet-input
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!f) return;
          setOpened(false);
          void run(async () => setPlan(await planMoneyImport(new Uint8Array(await f.arrayBuffer()))));
        }}
      />
      <ConfirmModal
        opened={!!plan}
        onClose={() => setPlan(null)}
        title={t('moneySheet.planTitle')}
        confirmLabel={t('moneySheet.import')}
        onConfirm={() =>
          run(async () => {
            if (!plan) return true;
            const n = await importMoneyPlan(plan);
            setPlan(null);
            haptic('success');
            return n >= 0;
          }, 'moneySheet.done')
        }
      >
        {plan && (
          <Stack gap={6}>
            <Text size="sm" fw={600}>
              {plan.rows.length ? t('moneySheet.plan', { n: plan.rows.length, inc: plan.incomes, exp: plan.expenses }) : t('moneySheet.nothing')}
            </Text>
            {plan.existing > 0 && (
              <Text size="sm" c="dimmed">
                {t('moneySheet.existing', { n: plan.existing })}
              </Text>
            )}
            {plan.skipped > 0 && (
              <Text size="sm" c="dimmed">
                {t('moneySheet.skipped', { n: plan.skipped })}
              </Text>
            )}
            {plan.opening && (
              <Text size="sm" c="dimmed">
                {t('moneySheet.opening', { cash: formatAed(plan.sheet.cashStartFils), card: formatAed(plan.sheet.cardStartFils) })}
              </Text>
            )}
          </Stack>
        )}
      </ConfirmModal>
    </>
  );
}
