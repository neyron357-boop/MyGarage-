import { Button, Modal } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconFileSpreadsheet, IconLanguage, IconTableExport, IconTableImport } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { importSuppliers } from '../../services/parts';
import { exportSupplierBook } from '../../services/supplierBook';
import { tidySuppliers } from '../../services/supplierTidy';
import { undoToast } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';
import { shareOrDownload } from '../../ui/share';

/**
 * The supplier base in and out of Excel: a button beside "New", a sheet with "Export" and "Import". The export is
 * the garage's own workbook (UAE_Contacts.xlsx) and is made as the sheet opens, so the tap shares it at once (an
 * iPhone allows sharing only right in the tap); the import takes that workbook — or any list of one's own.
 */
export function SupplierBookActions() {
  const { t } = useTranslation();
  const { run } = useAction();
  const [opened, setOpened] = useState(false);
  const [file, setFile] = useState<File>();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!opened) return;
    let alive = true;
    setFile(undefined);
    void exportSupplierBook().then((f) => alive && setFile(f));
    return () => {
      alive = false;
    };
  }, [opened]);
  const importFile = (f: File) =>
    run(async () => {
      const r = await importSuppliers(f);
      haptic('success');
      notifications.show({
        color: 'green',
        message: r.updated !== undefined ? t('suppliers.importedBook', { added: r.added, updated: r.updated }) : t('suppliers.imported', { added: r.added, skipped: r.skipped }),
      });
    });
  // v0.60: names in English, what each sells and its makes guessed from its name — «Отменить» puts them back.
  const tidy = () =>
    run(async () => {
      setOpened(false);
      const r = await tidySuppliers();
      if (!r.named && !r.parts && !r.makes) {
        notifications.show({ color: 'gray', message: t('suppliers.tidyNone') });
        return;
      }
      haptic('success');
      undoToast(t('suppliers.tidied', { named: r.named, parts: r.parts, makes: r.makes }), t('common.undo'), () => void r.undo());
    });
  return (
    <>
      <Button variant="default" leftSection={<IconFileSpreadsheet size={18} />} onClick={() => setOpened(true)} style={{ flex: 1 }}>
        {t('moneySheet.title')}
      </Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title={t('suppliers.book')}>
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
          <button type="button" className="action-tile" data-tidy onClick={() => void tidy()}>
            <IconLanguage size={26} stroke={1.7} style={{ color: 'var(--mantine-color-orange-6)' }} aria-hidden />
            <span>{t('suppliers.tidy')}</span>
          </button>
        </div>
      </Modal>
      <input
        ref={input}
        type="file"
        accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        data-suppliers-input
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!f) return;
          setOpened(false);
          void importFile(f);
        }}
      />
    </>
  );
}
