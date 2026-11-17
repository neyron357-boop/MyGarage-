import { useLiveQuery } from 'dexie-react-hooks';
import { Panel } from './panel';
import { PickLayer } from './pick';
import { fbDb } from './store';
import { useFbStrings } from './strings';

/** What the pencil opens (loaded on its first use): pick mode, or «Мои замечания». */
export default function FeedbackUI({ mode, onMode, onToast }: { mode: 'pick' | 'panel'; onMode: (m: 'pick' | 'panel' | null) => void; onToast: (t: string) => void }) {
  const s = useFbStrings();
  const newCount = useLiveQuery(() => fbDb().notes.where('status').equals('new').count(), []) ?? 0;
  if (mode === 'pick')
    return (
      <PickLayer
        s={s}
        newCount={newCount}
        onExit={() => onMode(null)}
        onPanel={() => onMode('panel')}
        onSaved={(n) => {
          onToast(s.saved(n));
          onMode(null);
        }}
      />
    );
  return <Panel s={s} onClose={() => onMode(null)} onPick={() => onMode('pick')} onToast={onToast} />;
}
