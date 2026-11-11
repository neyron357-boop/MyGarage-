import { Badge, Button, Group, Modal, Stack, Text, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconEngine, IconFileTypePdf } from '@tabler/icons-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../domain/dates';
import type { ObdScan, Vehicle } from '../../domain/types';
import { openPdf } from '../../services/documents';
import { mediaBlob } from '../../services/media';
import { importObdReport } from '../../services/obd';
import { pdfTextItems } from '../../services/pdfText';
import { List, ListRow } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';

/** The colour of a code's state: on now — red, came and went — orange, stored only — grey. */
export const obdColor = (state: string) => (/current|active|confirmed|permanent/i.test(state) ? 'red' : /pending|passed and failed|intermittent/i.test(state) ? 'orange' : 'gray');

/**
 * Reading a scanner's report (PDF) into a job: `pick()` opens the file picker (call it right in a tap),
 * `input` is the hidden picker to render. The result is said in one toast: codes, what the car's card
 * got, a different VIN.
 */
export function useObdImport(orderId: string): { input: ReactNode; pick: () => void } {
  const { t } = useTranslation();
  const { run } = useAction();
  const ref = useRef<HTMLInputElement>(null);
  const field = (k: keyof Vehicle) => t(`obd.field.${k}`, { defaultValue: k });
  const input = (
    <input
      ref={ref}
      type="file"
      accept="application/pdf,.pdf"
      hidden
      data-obd-input
      onChange={(e) => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = '';
        if (!file) return;
        void run(async () => {
          const r = await importObdReport(orderId, file, await pdfTextItems(file));
          haptic('success');
          notifications.show({
            color: r.vinMismatch ? 'orange' : 'green',
            title: t('obd.done', { n: r.scan.codes.length }),
            message: [r.filled.length ? t('obd.filled', { fields: r.filled.map(field).join(', ') }) : '', r.vinMismatch ? t('obd.vinMismatch', { vin: r.vinMismatch }) : ''].filter(Boolean).join(' · ') || undefined,
            autoClose: r.vinMismatch ? 9000 : 5000,
          });
        });
      }}
    />
  );
  return { input, pick: () => ref.current?.click() };
}

/** The latest scan on the job card: its codes as small coloured pills; a tap shows them in full. */
export function ObdLine({ scans }: { scans: ObdScan[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const scan = scans[scans.length - 1];
  return (
    <>
      <UnstyledButton className="job-line job-obd" mt="sm" onClick={() => setOpen(true)} aria-label={t('obd.title')}>
        <IconEngine size={18} stroke={1.8} style={{ flexShrink: 0, marginTop: 3 }} aria-hidden />
        <Group gap={6}>
          {scan.codes.length ? (
            scan.codes.map((c) => (
              <Badge key={c.full} color={obdColor(c.state)} variant="light" radius="sm" size="md" style={{ textTransform: 'none' }}>
                {c.code}
              </Badge>
            ))
          ) : (
            <Text size="sm" c="green.7">
              {t('obd.noCodes')}
            </Text>
          )}
        </Group>
      </UnstyledButton>
      <ObdSheet scan={scan} opened={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** A scan in full: every code with what it means, its state and module; the odometer; the PDF. */
function ObdSheet({ scan, opened, onClose }: { scan: ObdScan; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [pdf, setPdf] = useState<Blob>();
  useEffect(() => {
    if (!opened || !scan.mediaId) return;
    let alive = true;
    void mediaBlob(scan.mediaId).then((b) => alive && setPdf(b));
    return () => {
      alive = false;
    };
  }, [opened, scan.mediaId]);
  const when = scan.testedAt ?? scan.importedAt;
  return (
    <Modal opened={opened} onClose={onClose} title={`${t('obd.title')} · ${formatDateTime(when)}`}>
      <Stack gap="md">
        <List>
          {scan.codes.map((c) => (
            <ListRow
              key={c.full}
              left={<span className="obd-dot" style={{ background: `var(--mantine-color-${obdColor(c.state)}-6)` }} aria-hidden />}
              title={
                <Text span inherit>
                  <Text span inherit fw={700}>
                    {c.code}
                  </Text>{' '}
                  {c.description}
                </Text>
              }
              subtitle={[c.state, c.system].filter(Boolean).join(' · ') || undefined}
            />
          ))}
        </List>
        {(scan.odometer || scan.vin) && (
          <Text size="sm" c="dimmed">
            {[scan.odometer ? `${scan.odometer.value.toLocaleString('en-US')} ${scan.odometer.unit === 'mi' ? 'mi' : 'km'}` : '', scan.vin ? `VIN ${scan.vin}` : '', scan.tool ?? ''].filter(Boolean).join(' · ')}
          </Text>
        )}
        {scan.mediaId && (
          <Button variant="light" leftSection={<IconFileTypePdf size={18} />} loading={busy || !pdf} onClick={() => pdf && void run(() => openPdf({ blob: pdf, filename: 'OBD report.pdf' }))}>
            PDF
          </Button>
        )}
      </Stack>
    </Modal>
  );
}
