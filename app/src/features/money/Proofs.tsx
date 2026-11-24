import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import type { LedgerEntry } from '../../domain/ledger';
import { addProofs, proofsOf, removeProof, takesProofs } from '../../services/proofs';
import { useAction } from '../../ui/hooks';
import { PhotoStrip } from '../../ui/PhotoStrip';

/**
 * Photos kept with money in or out — the receipt, the supplier's invoice, a card slip, a transfer screenshot:
 * a row of thumbnails and a tile to add more. A wrong one goes from the full-screen view.
 */
export function Proofs({ entry }: { entry: Pick<LedgerEntry, 'id' | 'source'> }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const list = useLiveQuery(() => proofsOf(entry.id), [entry.id]);
  // On top of the sheet (v0.77): its place is kept while the photos are read — the sheet does not jump under them.
  if (!list)
    return takesProofs(entry) ? (
      <div className="strip-row" aria-hidden>
        <span className="strip-tile" style={{ visibility: 'hidden' }} />
      </div>
    ) : null;
  return (
    <PhotoStrip
      name="proof"
      photos={list.map((m) => ({ id: m.id, removable: m.slot === 'proof' }))}
      onAdd={takesProofs(entry) ? (files) => void run(() => addProofs(entry, files)) : undefined}
      onRemove={(p) => void run(() => removeProof(p.id))}
      addLabel={t('ledger.proof')}
      addAria={t('ledger.addProof')}
    />
  );
}
