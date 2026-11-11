import { Button } from '@mantine/core';
import { IconCameraPlus, IconTrash } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LedgerEntry } from '../../domain/ledger';
import { addProofs, proofsOf, removeProof, takesProofs } from '../../services/proofs';
import { MediaImage } from '../../ui/components';
import { useAction } from '../../ui/hooks';
import { PhotoViewer } from '../../ui/PhotoViewer';

/**
 * Photos kept with a money out — the receipt, the supplier's invoice, a transfer screenshot:
 * a row of thumbnails and a tile to add more (camera or gallery). A wrong one goes from the viewer.
 */
export function Proofs({ entry }: { entry: Pick<LedgerEntry, 'id' | 'source' | 'kind'> }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const list = useLiveQuery(() => proofsOf(entry.id), [entry.id]);
  const [viewing, setViewing] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const canAdd = takesProofs(entry);
  if (!list || (!canAdd && !list.length)) return null;
  return (
    <>
      <div className="proof-row">
        {list.map((m, i) => (
          <button key={m.id} type="button" className="action-tile proof-tile" aria-label={t('ledger.proof')} onClick={() => setViewing(i)}>
            <MediaImage id={m.id} h="100%" w="100%" radius="0" />
          </button>
        ))}
        {canAdd && (
          <button type="button" className="action-tile proof-tile" aria-label={t('ledger.addProof')} onClick={() => input.current?.click()}>
            <IconCameraPlus size={24} stroke={1.7} aria-hidden />
            <span>{t('ledger.proof')}</span>
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        data-proof-input
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          if (files.length) void run(() => addProofs(entry, files));
        }}
      />
      {viewing !== null && (
        <PhotoViewer
          items={list.map((m) => ({ id: m.id }))}
          index={Math.min(viewing, Math.max(0, list.length - 1))}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          actions={(it) =>
            list.find((m) => m.id === it.id)?.slot === 'proof' ? (
              <Button radius="xl" size="md" variant="light" color="red" leftSection={<IconTrash size={18} />} onClick={() => void run(() => removeProof(it.id))}>
                {t('common.delete')}
              </Button>
            ) : null
          }
        />
      )}
    </>
  );
}
