import { useTranslation } from 'react-i18next';
import { garageNotes, GARAGE_NOTES } from '../../services/notes';
import { PageHeader, PageSkeleton } from '../../ui/components';
import { useScreenLiveQuery } from '../../ui/hooks';
import { NotesChat } from '../job/Notes';

/**
 * The workshop's own notes («Ещё» → «Заметки»): the same chat with oneself as a job's «Заметки» tab —
 * what is not about any car (a bulb to change in the office, paper for the printer). Typed, photographed,
 * filmed or said; answered with a swipe, picked with a long press, deleted with Undo.
 */
export function GarageNotesPage() {
  const { t } = useTranslation();
  const notes = useScreenLiveQuery(garageNotes, []);
  if (!notes) return <PageSkeleton />;
  return (
    <>
      <PageHeader title={t('notes.title')} />
      <div className="notes-page">
        <NotesChat orderId={GARAGE_NOTES} notes={notes} editable />
      </div>
    </>
  );
}
