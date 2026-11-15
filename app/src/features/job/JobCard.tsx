import { ActionIcon, Button, Modal, SegmentedControl, Stack, Text } from '@mantine/core';
import { IconCameraPlus, IconCarCrash, IconLock, IconTrash } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../../db/db';
import type { DamageMark, DamageType, DamageView, Inspection } from '../../domain/types';
import { addDamageMark, addInspectionPhoto, getOrCreateInspection, removeDamageMark, updateDamageMark } from '../../services/inspections';
import { deleteMedia } from '../../services/media';
import { MediaImage } from '../../ui/components';
import { Car3D, type Car3DHandle, type CarView } from '../../ui/Car3D';
import { DAMAGE_COLORS, DamageDiagram } from '../../ui/DamageDiagram';
import { useAction, useScreenLiveQuery } from '../../ui/hooks';
import { LazySheet } from '../../ui/lazy';
import { PhotoViewer } from '../../ui/PhotoViewer';
import { usePhotoPick } from '../../ui/photoPick';

/*
 * The job card, quickly (v0.17.3): the car — in 3D since v0.19, turned by the finger, or straight to a side — a tap
 * where it is damaged puts a numbered point (a scratch until told otherwise), its kind in one tap, its photo with the
 * camera (a hold: from the phone's photos). The points are the check-in act's damage marks, kept as a side and a
 * place on that side's drawing (the act is made on the first point): the full act, when it is signed, and its PDF
 * show them as they are; a signed act's card is only looked at.
 */

const VIEWS: CarView[] = ['3d', 'top', 'left', 'right', 'front', 'rear'];

const TYPES: DamageType[] = ['scratch', 'dent', 'chip', 'crack', 'rust', 'other'];

interface Card {
  insp?: Inspection;
  marks: DamageMark[];
}

/** The check-in act's points (none yet — no act: opening the card writes nothing). */
async function jobCardOf(orderId: string): Promise<Card> {
  const insp = await db.inspections.where('orderId').equals(orderId).filter((i) => i.kind === 'intake').first();
  return { insp, marks: insp ? await db.damageMarks.where('inspectionId').equals(insp.id).toArray() : [] };
}

/** One point: its kind, its photo, off the card. */
function MarkEditor({ mark, n, insp, onGone }: { mark: DamageMark; n: number; insp: Inspection; onGone: () => void }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const [viewing, setViewing] = useState(false);
  const pick = usePhotoPick(
    ([file]) =>
      void run(async () => {
        const m = await addInspectionPhoto(insp.id, 'damage', file);
        const before = mark.mediaId;
        await updateDamageMark(mark.id, { mediaId: m.id });
        // The photo it had is replaced, not kept beside it.
        if (before) await deleteMedia(before).catch(() => undefined);
      }),
  );
  return (
    <div className="jc-mark rise-enter">
      <div className="jc-mark-head">
        <span className="jc-dot" style={{ background: DAMAGE_COLORS[mark.type] }}>
          {n}
        </span>
        <div className="chip-row wrap" aria-label={t('damage.mark')}>
          {TYPES.map((d) => (
            <button key={d} type="button" className="chip" data-active={mark.type === d} onClick={() => void run(() => updateDamageMark(mark.id, { type: d }))}>
              {t(`damage.type.${d}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="jc-mark-foot">
        {mark.mediaId ? (
          <button type="button" className="action-tile strip-tile" aria-label={t('damage.closeup')} onClick={() => setViewing(true)}>
            <MediaImage id={mark.mediaId} h="100%" w="100%" radius="0" />
          </button>
        ) : null}
        <button type="button" className="action-tile strip-tile" data-empty="true" aria-label={t('damage.closeup')} {...pick.handlers} onClick={() => !pick.consumeClick() && pick.camera()}>
          <IconCameraPlus size={24} stroke={1.7} aria-hidden />
          <span>{t('jobCard.photo')}</span>
        </button>
        <ActionIcon
          size={44}
          radius="xl"
          variant="light"
          color="red"
          className="jc-remove"
          aria-label={t('common.delete')}
          onClick={() =>
            void run(async () => {
              await removeDamageMark(mark.id);
              if (mark.mediaId) await deleteMedia(mark.mediaId).catch(() => undefined);
              onGone();
            })
          }
        >
          <IconTrash size={20} />
        </ActionIcon>
      </div>
      {pick.inputs}
      {viewing && mark.mediaId && <PhotoViewer items={[{ id: mark.mediaId, title: `${n} · ${t(`damage.type.${mark.type}`)}` }]} index={0} onIndex={() => undefined} onClose={() => setViewing(false)} />}
    </div>
  );
}

function JobCardSheet({ orderId, card, opened, onClose }: { orderId: string; card: Card; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { run } = useAction();
  // The side picked above the car ('3d' — three-quarters, or turned by the finger).
  const [view, setView] = useState<CarView>('3d');
  const car = useRef<Car3DHandle>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const locked = !!card.insp?.locked;
  const marks = card.marks;
  const mark = marks.find((m) => m.id === picked);
  // A tap on the car: the point, then its kind and photo right under it.
  const add = (side: DamageView, x: number, y: number) =>
    void run(async () => {
      const insp = card.insp ?? (await getOrCreateInspection(orderId, 'intake'));
      const m = await addDamageMark(insp.id, { view: side, x, y, type: 'scratch' });
      setPicked(m.id);
    });
  // Without 3D (no WebGL): the drawings, a side at a time.
  const flat: DamageView = view === '3d' ? 'top' : view;
  return (
    <Modal opened={opened} onClose={onClose} title={t('jobCard.title')}>
      <Stack gap="md">
        <SegmentedControl
          fullWidth
          size="xs"
          value={view}
          onChange={(v) => {
            setView(v as CarView);
            car.current?.turnTo(v as CarView);
          }}
          data={VIEWS.map((v) => ({ value: v, label: v === '3d' ? t('jobCard.view3d') : t(`damage.view.${v}`) }))}
        />
        <Car3D
          ref={car}
          marks={marks}
          picked={picked}
          locked={locked}
          onAdd={(at) => add(at.view, at.x, at.y)}
          onPick={(id) => setPicked(id)}
          onTurn={() => setView('3d')}
          fallback={
            <div className="jc-diagram">
              <DamageDiagram view={flat} marks={marks} height={250} onAdd={locked ? undefined : (x, y) => add(flat, x, y)} onSelect={(m) => setPicked(m.id)} />
            </div>
          }
        />
        {locked ? (
          // The check-in act is signed: its points are only looked at (a photo — a tap on its chip below).
          <Text c="dimmed" ta="center" fz={15} className="jc-signed">
            <IconLock size={15} stroke={2} aria-hidden />
            {t('jobCard.signed')}
          </Text>
        ) : mark && card.insp ? (
          <MarkEditor key={mark.id} mark={mark} n={marks.indexOf(mark) + 1} insp={card.insp} onGone={() => setPicked(null)} />
        ) : (
          !marks.length && (
            <Text c="dimmed" ta="center" fz={15}>
              {t('jobCard.hint')}
            </Text>
          )
        )}
        {/* Every point at once (all sides): a tap picks it, its side comes up. */}
        {marks.length > 0 && (
          <div className="chip-row wrap" aria-label={t('jobCard.title')}>
            {marks.map((m, i) => (
              <button
                key={m.id}
                type="button"
                className="chip jc-chip"
                data-active={m.id === picked}
                onClick={() => {
                  setView(m.view);
                  car.current?.face(m);
                  setPicked(m.id);
                  // A signed act's point: its photo, to look at.
                  if (locked && m.mediaId) setPhoto(m.mediaId);
                }}
              >
                <span className="jc-dot sm" style={{ background: DAMAGE_COLORS[m.type] }}>
                  {i + 1}
                </span>
                {t(`damage.type.${m.type}`)}
                {m.mediaId && (
                  <span className="vin-thumb">
                    <MediaImage id={m.mediaId} h={26} w={26} radius="0" />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        <Button size="lg" onClick={onClose}>
          {t('common.done')}
        </Button>
      </Stack>
      {photo && <PhotoViewer items={[{ id: photo, title: t('jobCard.title') }]} index={0} onIndex={() => undefined} onClose={() => setPhoto(null)} />}
    </Modal>
  );
}

/**
 * The job card on the job's card, a chip beside the Mulkiya: "Job card" — with the number of points once there
 * are some. A closed job shows it only when it has points.
 */
export function JobCardChip({ orderId, open }: { orderId: string; open: boolean }) {
  const { t } = useTranslation();
  const card = useScreenLiveQuery(() => jobCardOf(orderId), [orderId]);
  const [shown, setShown] = useState(false);
  const n = card?.marks.length ?? 0;
  if (!card || (!open && !n)) return null;
  return (
    <>
      <button type="button" className="chip vin-chip" data-empty={!n || undefined} aria-label={t('jobCard.title')} onClick={() => setShown(true)}>
        <IconCarCrash size={17} stroke={1.9} aria-hidden />
        <span>{t('jobCard.title')}</span>
        {n > 0 && <span className="chip-note tnum">{n}</span>}
      </button>
      <LazySheet opened={shown}>{(o) => <JobCardSheet orderId={orderId} card={card} opened={o} onClose={() => setShown(false)} />}</LazySheet>
    </>
  );
}
