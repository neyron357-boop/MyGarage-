import { Box, Button, FileButton, Group, Stack, Switch, Text, Title } from '@mantine/core';
import { IconFileImport, IconHistory } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, formatDate } from '../../domain/dates';
import { formatAed } from '../../domain/money';
import type { ImportedFrom } from '../../domain/types';
import {
  eaglecartImported,
  importEaglecart,
  parseEaglecartFile,
  previewEaglecartImport,
  removeEaglecartImport,
  type EaglecartExport,
  type ImportPlan,
} from '../../services/eaglecart';
import { haptic } from '../../ui/haptics';
import { ConfirmModal, List, ListRow } from '../../ui/components';
import { useAction, useErrorText, useLang } from '../../ui/hooks';

/** Jobs started in the last two days before the export that were not delivered may still be in the garage. */
const recentSince = (d: EaglecartExport) => addDays(d.exportedAt, -2);

/**
 * Settings → Data: carry the customers, cars and job history over from Eaglecart (the previous
 * system). Shows what will come over before anything changes; importing again adds nothing twice.
 */
export function EaglecartImportCard() {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  const { run, busy } = useAction();
  const [file, setFile] = useState<{ name: string; data: EaglecartExport } | null>(null);
  const [error, setError] = useState<string>();
  const [continueRecent, setContinueRecent] = useState(true);
  const [preview, setPreview] = useState<ImportPlan['stats'] | null>(null);
  const [undo, setUndo] = useState(false);
  const inApp = useLiveQuery(eaglecartImported, []);

  useEffect(() => {
    setPreview(null);
    if (!file) return;
    let alive = true;
    void previewEaglecartImport(file.data, { activeSince: continueRecent ? recentSince(file.data) : undefined }).then((s) => alive && setPreview(s));
    return () => {
      alive = false;
    };
  }, [file, continueRecent]);

  const pick = async (f: File | null) => {
    setError(undefined);
    setFile(null);
    if (!f) return;
    try {
      setFile({ name: f.name, data: parseEaglecartFile(await f.text()) });
    } catch (e) {
      setError(errorText(e));
    }
  };
  const recent = file ? file.data.jobs.filter((j) => j.items.length && j.status !== 'Delivered' && j.status !== 'Quotation' && j.at && new Date(j.at).toISOString() >= recentSince(file.data)).length : 0;

  return (
    <Box className="surface" p="md">
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <IconHistory size={22} stroke={1.8} color="var(--mantine-color-cobalt-6)" style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <Title order={5}>{t('ec.title')}</Title>
          <Text size="xs" c="dimmed" mt={2}>
            {t('ec.hint')}
          </Text>
        </div>
      </Group>

      {!!inApp?.orders && (
        <Text size="sm" mt="md">
          {t('ec.inApp', { orders: inApp.orders, customers: inApp.customers, vehicles: inApp.vehicles })}
        </Text>
      )}

      {file && (
        <Stack gap="sm" mt="md" className="rise-enter">
          <Text size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
            {file.name}
            {file.data.store ? ` · ${file.data.store}` : ''}
          </Text>
          {preview ? (
            <>
              <List>
                {preview.from && <ListRow title={t('ec.period')} right={<Text size="sm" className="tnum">{`${formatDate(preview.from)} – ${formatDate(preview.to)}`}</Text>} />}
                <ListRow title={t('ec.customers')} subtitle={preview.customersMatched ? t('ec.matched', { n: preview.customersMatched }) : undefined} right={<Text fw={600} className="tnum">{preview.customers}</Text>} />
                <ListRow title={t('ec.vehicles')} subtitle={preview.vehiclesMatched ? t('ec.matched', { n: preview.vehiclesMatched }) : undefined} right={<Text fw={600} className="tnum">{preview.vehicles}</Text>} />
                <ListRow title={t('ec.history')} subtitle={formatAed(preview.totalFils, lang)} right={<Text fw={600} className="tnum">{preview.history}</Text>} />
                <ListRow title={t('ec.quotes')} subtitle={t('ec.quotesHint')} right={<Text fw={600} className="tnum">{preview.quotations}</Text>} />
                {preview.active > 0 && <ListRow title={t('ec.active')} subtitle={t('ec.activeHint')} right={<Text fw={600} className="tnum">{preview.active}</Text>} />}
              </List>
              {(preview.alreadyImported > 0 || preview.skippedEmpty > 0) && (
                <Text size="xs" c="dimmed">
                  {[preview.alreadyImported ? t('ec.already', { n: preview.alreadyImported }) : '', preview.skippedEmpty ? t('ec.skipped', { n: preview.skippedEmpty }) : ''].filter(Boolean).join(' · ')}
                </Text>
              )}
              {recent > 0 && (
                <Switch
                  checked={continueRecent}
                  onChange={(e) => setContinueRecent(e.currentTarget.checked)}
                  label={t('ec.continueRecent', { n: recent })}
                  description={t('ec.continueRecentHint')}
                />
              )}
              <Text size="xs" c="dimmed">
                {t('ec.moneyNote')}
              </Text>
              <Button
                size="md"
                leftSection={<IconFileImport size={18} />}
                loading={busy}
                disabled={preview.jobs + preview.customers + preview.vehicles === 0}
                onClick={() =>
                  run(async () => {
                    const s = await importEaglecart(file.data, { activeSince: continueRecent ? recentSince(file.data) : undefined });
                    haptic('success');
                    setFile(null);
                    return s;
                  }, 'ec.done')
                }
              >
                {preview.jobs ? t('ec.run', { n: preview.jobs }) : t('ec.nothing')}
              </Button>
            </>
          ) : (
            <Text size="sm" c="dimmed">
              …
            </Text>
          )}
        </Stack>
      )}
      {error && (
        <Text size="sm" c="red" mt="md">
          {error}
        </Text>
      )}

      <Group gap="xs" mt="md">
        <FileButton onChange={(f) => void pick(f)} accept=".json,application/json">
          {(props) => (
            <Button variant={file ? 'default' : 'light'} leftSection={<IconFileImport size={18} />} {...props}>
              {file ? t('ec.pickOther') : t('ec.pick')}
            </Button>
          )}
        </FileButton>
        {!!inApp?.orders && (
          <Button variant="subtle" color="red" onClick={() => setUndo(true)}>
            {t('ec.undo')}
          </Button>
        )}
      </Group>

      <ConfirmModal
        opened={undo}
        onClose={() => setUndo(false)}
        title={t('ec.undoTitle')}
        confirmLabel={t('ec.undo')}
        color="red"
        onConfirm={() =>
          run(async () => {
            await removeEaglecartImport();
            return true;
          }, 'ec.undone')
        }
      >
        <Text size="sm">{t('ec.undoText')}</Text>
      </ConfirmModal>
    </Box>
  );
}

/** One line on a job carried over from Eaglecart: its number there and what Eaglecart knew about payment. */
export function ImportedNote({ imp }: { imp: ImportedFrom }) {
  const { t } = useTranslation();
  const lang = useLang();
  const parts = [t('ec.fromJob', { no: imp.jobNo })];
  if (imp.status === 'Quotation') parts.push(t('ec.wasQuote'));
  else if (!imp.history) parts.push(t('ec.continued'));
  else {
    if (imp.orderNo) parts.push(t('ec.orderNo', { no: imp.orderNo }));
    const method = /cash/i.test(imp.payMethod ?? '') ? t('payment.method.cash') : /card/i.test(imp.payMethod ?? '') ? t('payment.method.card') : (imp.payMethod ?? '');
    parts.push(imp.paidFils ? t('ec.paidThere', { amount: formatAed(imp.paidFils, lang), method: method.toLowerCase() }).trim() : t('ec.noPayment'));
  }
  return (
    <Group gap={6} wrap="nowrap" mt="sm" align="flex-start">
      <IconHistory size={15} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0, marginTop: 2 }} />
      <Text size="xs" c="dimmed" lh={1.4}>
        {parts.join(' · ')}
      </Text>
    </Group>
  );
}
