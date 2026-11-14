import { ActionIcon } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconFileImport } from '@tabler/icons-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { importGarageDoc } from '../../services/docImport';
import { pdfTextItems, warmPdfText } from '../../services/pdfText';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';

/**
 * A job from an invoice or a quotation (PDF — from Eaglecart or from this app) in one tap: the round
 * button opens the file picker, the document becomes the job (its car, customer and lines) and the job
 * opens; one toast says what came in.
 */
export function DocImportButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <ActionIcon variant="default" size={40} radius="md" aria-label={t('docImport.button')} loading={busy} onPointerDown={warmPdfText} onClick={() => ref.current?.click()}>
        <IconFileImport size={20} />
      </ActionIcon>
      <input
        ref={ref}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        data-doc-input
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!file) return;
          void run(async () => {
            const r = await importGarageDoc(await pdfTextItems(file));
            haptic('success');
            navigate(`/orders/${r.orderId}`, { replace: true });
            // Said once the job is open (a new screen clears the waiting banners), in place of any banner still up.
            window.setTimeout(() => {
              notifications.clean();
              notifications.show({
                color: 'green',
                title: t(r.kind === 'invoice' ? 'docImport.invoice' : 'docImport.quotation', { number: r.number ?? '' }).trim(),
                message: [t('docImport.lines', { n: r.added }), r.skipped ? t('docImport.skipped', { n: r.skipped }) : '', r.newJob ? '' : t('docImport.intoJob')].filter(Boolean).join(' · '),
              });
            }, 250);
          });
        }}
      />
    </>
  );
}
