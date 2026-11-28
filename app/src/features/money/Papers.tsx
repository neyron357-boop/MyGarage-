import { Button, Loader, Modal, Progress, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconCamera, IconCheck, IconFileText, IconPhoto, IconPlus, IconRefresh, IconTrash } from '@tabler/icons-react';
import { memo, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import { dayShort, dubaiDate, formatDate } from '../../domain/dates';
import { paperDoubts, partOfLine } from '../../domain/papers';
import { supplierMatches } from '../../domain/suppliers';
import type { Supplier, SupplierPaper } from '../../domain/types';
import { viewPdf } from '../../services/documents';
import { mediaBlob } from '../../services/media';
import { addPapers, loadPapers, notTwin, paperToExpense, removePaper, rereadFailed, rereadPaper, setPaperDate, setPaperSupplier, settlePaper } from '../../services/papers';
import { useCalmQuery } from '../../ui/calmQuery';
import { liveCameraAvailable } from '../../ui/camera';
import { EmptyState, List, ListRow, MediaImage, Money, PageHeader, PageSkeleton, PersonAvatar, SearchField, undoToast } from '../../ui/components';
import { DateField } from '../../ui/DateFields';
import { haptic } from '../../ui/haptics';
import { useAction, useScreenLiveQuery } from '../../ui/hooks';
import { LiveCamera } from '../../ui/LiveCamera';
import { useMoreRows } from '../../ui/moreRows';
import { PhotoViewer } from '../../ui/PhotoViewer';
import { SupplierSheet } from '../parts/Suppliers';

/*
 * «Инвойсы поставщиков» — the multi-scanner (v1.05, the owner: «сотни инвойсов от разных поставщиков… мультисканер, который
 * прошёлся по всем инвойсам… ИИ анализировал… присваивал поставщику… сохранял все цены»). The papers in by the handful — the
 * app's camera one after another, or the phone's photos and PDFs many at once; they are read on by themselves
 * (services/papers.ts), the counts move as they are: read, to look at, twins, not read; what they taught — suppliers (new
 * ones), lines, prices. A paper tapped — its photo, its seller (another one picked, or a new one made), its day, its lines;
 * «Всё верно», «Прочитать снова», «Записать расходом» (one never recorded), «Удалить» with «Отменить».
 */

type Filter = 'all' | 'look' | 'twin' | 'failed';

export function PapersPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const supplierId = params.get('supplier') || undefined;
  const view = useCalmQuery(['papers', 'suppliers', 'priceBook'], () => loadPapers(supplierId), [supplierId], 1500);
  const [filter, setFilter] = useState<Filter>('all');
  const [cam, setCam] = useState(false);
  const [shot, setShot] = useState(0);
  const pick = useRef<HTMLInputElement>(null);
  const system = useRef<HTMLInputElement>(null);
  const chain = useRef(Promise.resolve());
  const open = params.get('open');
  const setOpen = (id: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (id) n.set('open', id);
        else n.delete('open');
        return n;
      },
      { replace: true },
    );

  /** Taken in one after another (the camera's shots come faster than they are kept). */
  const take = (files: File[], say = true) => {
    if (!files.length) return;
    chain.current = chain.current.then(async () => {
      const r = await addPapers(files);
      if (say && (r.added || r.twins)) undoToast(t('papers.added', { count: r.added }) + (r.twins ? ` · ${t('papers.sameTaken', { count: r.twins })}` : ''), '', () => undefined, { undo: false, replace: false });
    });
  };
  const picked = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.currentTarget.files ?? [])];
    e.currentTarget.value = '';
    take(files);
  };
  const papers = view?.papers ?? [];
  const shown = useMemo(() => {
    const busy = (p: SupplierPaper) => p.state === 'waiting' || p.state === 'reading';
    const list = filter === 'all' ? papers.filter((p) => p.state !== 'twin' && p.state !== 'failed') : papers.filter((p) => p.state === filter);
    // What is being read first, then the newest paper's day.
    return [...list.filter(busy), ...list.filter((p) => !busy(p))];
  }, [papers, filter]);
  const { limit, more } = useMoreRows(shown.length, `${filter}|${supplierId}`);
  const sup = supplierId ? view?.suppliers.get(supplierId) : undefined;
  if (!view) return <PageSkeleton />;
  const c = view.counts;
  const read = c.all - c.waiting;
  return (
    <>
      <PageHeader title={sup ? sup.name : t('papers.title')} subtitle={sup ? t('papers.title') : undefined} />
      <input ref={pick} type="file" accept="image/*,application/pdf" multiple hidden onChange={picked} data-papers-pick />
      <input ref={system} type="file" accept="image/*" capture="environment" hidden onChange={picked} />
      <Stack gap="lg" data-papers>
        <div className="surface papers-card" data-papers-card>
          <div className="papers-big">
            <span className="tnum">{read}</span>
            <span className="papers-big-of">{t('papers.read')}</span>
          </div>
          {c.waiting > 0 && (
            <div className="papers-reading" data-papers-reading={c.waiting}>
              <Loader size={14} />
              <span>{t('papers.reading', { n: c.waiting })}</span>
              <Progress value={c.all ? (read / c.all) * 100 : 0} size="sm" style={{ flex: 1 }} />
            </div>
          )}
          {read > 0 && (
            <div className="supplier-stats" data-papers-learnt>
              <span>
                <b className="tnum">{view.learnt.suppliers}</b> {t('papers.suppliers', { count: view.learnt.suppliers })}
                {view.learnt.added > 0 && <span className="papers-new"> · {t('papers.newOnes', { count: view.learnt.added })}</span>}
              </span>
              <span>
                <b className="tnum">{view.learnt.lines}</b> {t('papers.linesWord', { count: view.learnt.lines })}
              </span>
              <span>
                <b className="tnum">{view.learnt.prices}</b> {t('papers.prices', { count: view.learnt.prices })}
              </span>
            </div>
          )}
        </div>
        <SimpleGrid cols={2} spacing="sm">
          <Button size="lg" leftSection={<IconCamera size={20} />} onClick={() => (liveCameraAvailable() ? (setShot(0), setCam(true)) : system.current?.click())} data-papers-camera>
            {t('papers.shoot')}
          </Button>
          <Button size="lg" variant="light" leftSection={<IconPhoto size={20} />} onClick={() => pick.current?.click()} data-papers-photos>
            {t('papers.photos')}
          </Button>
        </SimpleGrid>
        {c.all > 0 && (
          <div className="chip-row" role="radiogroup" aria-label={t('papers.title')}>
            {(['all', 'look', 'twin', 'failed'] as const)
              .filter((f) => f === 'all' || c[f] > 0)
              .map((f) => (
                <button key={f} type="button" className="chip" role="radio" aria-checked={filter === f} data-active={filter === f} onClick={() => setFilter(f)} data-papers-filter={f}>
                  {t(`papers.filter.${f}`)}
                  {f !== 'all' && <span className="chip-note tnum">{c[f]}</span>}
                </button>
              ))}
          </div>
        )}
        {filter === 'failed' && c.failed > 0 && (
          <Button variant="light" leftSection={<IconRefresh size={18} />} onClick={() => void rereadFailed()} data-papers-reread>
            {t('papers.readAgainAll', { n: c.failed })}
          </Button>
        )}
        {!c.all ? (
          <EmptyState icon={IconFileText} title={t('papers.empty')} />
        ) : (
          <List>
            {shown.slice(0, limit).map((p) => (
              <PaperRow key={p.id} p={p} supplier={p.supplierId ? view.suppliers.get(p.supplierId) : undefined} onOpen={setOpen} />
            ))}
            {more()}
          </List>
        )}
      </Stack>
      {cam && (
        <LiveCamera
          label={t('papers.shoot')}
          burst={{ count: shot }}
          onShot={(file) => {
            setShot((n) => n + 1);
            take([file], false);
          }}
          onClose={() => {
            setCam(false);
            if (shot) undoToast(t('papers.added', { count: shot }), '', () => undefined, { undo: false });
          }}
        />
      )}
      <PaperSheet id={open} onClose={() => setOpen(null)} />
    </>
  );
}

const dayWord = (t: (k: string) => string, day?: string) => {
  if (!day) return '';
  const d = dayShort(`${day}T08:00:00.000Z`);
  return d.word ? t(`common.${d.word}`) : formatDate(day);
};

const PaperRow = memo(function PaperRow({ p, supplier, onOpen }: { p: SupplierPaper; supplier?: Supplier; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const busy = p.state === 'waiting' || p.state === 'reading';
  const name = supplier?.name ?? p.vendor ?? (busy ? t(p.state === 'reading' ? 'papers.state.reading' : 'papers.state.waiting') : t('papers.noSeller'));
  return (
    <ListRow
      onClick={() => onOpen(p.id)}
      left={<PaperThumb p={p} />}
      title={
        <span className="papers-row-title" data-paper={p.id} data-paper-state={p.state}>
          {name}
          {p.added && <span className="papers-tag" data-tone="new">{t('papers.tag.new')}</span>}
          {p.state === 'look' && <span className="papers-tag" data-tone="look">{t('papers.tag.look')}</span>}
          {p.state === 'twin' && <span className="papers-tag">{t('papers.tag.twin')}</span>}
          {p.state === 'failed' && <span className="papers-tag" data-tone="bad">{t(`papers.why.${p.why ?? 'unread'}`)}</span>}
          {p.expenseId && <span className="papers-tag">{t('papers.tag.expense')}</span>}
        </span>
      }
      subtitle={busy ? undefined : [dayWord(t, p.date), p.invoiceNo ? `№${p.invoiceNo}` : '', p.lines?.length ? t('papers.lines', { count: p.lines.length }) : ''].filter(Boolean).join(' · ')}
      right={busy ? <Loader size={16} /> : p.totalFils ? <Money fils={p.totalFils} /> : undefined}
      chevron={!busy}
    />
  );
});

function PaperThumb({ p }: { p: SupplierPaper }) {
  return <span className="papers-thumb">{p.mediaId ? <MediaImage id={p.mediaId} h={44} w={44} radius="sm" /> : <IconFileText size={22} />}</span>;
}

/** One paper: its photo, its seller, its day, its lines; what to do with it. */
function PaperSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const data = useScreenLiveQuery(async () => {
    if (!id) return null;
    const p = await db.papers.get(id);
    if (!p) return null;
    const [supplier, media, expense] = await Promise.all([p.supplierId ? db.suppliers.get(p.supplierId) : undefined, db.media.get(p.mediaId), p.expenseId ? db.expenses.get(p.expenseId) : undefined]);
    return { p, supplier, media, expense };
  }, [id]);
  const [view, setView] = useState(false);
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState<Partial<Supplier> | null>(null);
  const last = useRef(data);
  if (data) last.current = data;
  const d = data ?? last.current;
  const p = d?.p;
  const doubts = p ? paperDoubts(p) : [];
  const pdf = d?.media?.kind === 'pdf';
  const showPhoto = async () => {
    if (!p) return;
    if (!pdf) return setView(true);
    const blob = await mediaBlob(p.mediaId);
    if (blob) viewPdf({ blob, filename: `${p.vendor ?? 'invoice'}.pdf` });
  };
  const remove = () =>
    run(async () => {
      if (!p) return;
      const undo = await removePaper(p.id);
      onClose();
      undoToast(t('papers.removed'), t('common.undo'), () => void undo());
    });
  const toExpense = () =>
    run(async () => {
      if (!p) return;
      const r = await paperToExpense(p.id);
      if (r) undoToast(t('papers.recorded'), t('common.undo'), () => void r.undo());
    });
  return (
    <Modal opened={!!id && d !== null} onClose={onClose} title={d?.supplier?.name ?? p?.vendor ?? t('papers.paper')} classNames={{ content: 'sheet-grouped' }}>
      {p && (
        <Stack gap="lg" data-paper-sheet={p.id}>
          <button type="button" className="papers-photo" onClick={() => void showPhoto()} aria-label={t('papers.photo')}>
            {pdf ? (
              <span className="papers-pdf">
                <IconFileText size={34} />
                PDF
              </span>
            ) : (
              <MediaImage id={p.mediaId} card h={220} radius="md" />
            )}
          </button>
          {doubts.length > 0 && p.state === 'look' && (
            <div className="chip-row wrap" data-paper-doubts>
              {doubts.map((x) => (
                <span key={x} className="papers-tag" data-tone="look">
                  {t(`papers.doubt.${x}`)}
                </span>
              ))}
            </div>
          )}
          <div className="ios-group">
            <button type="button" className="ios-row papers-seller" onClick={() => setPicking(true)} data-paper-seller>
              <PersonAvatar name={d?.supplier?.name ?? p.vendor ?? '?'} size={36} />
              <span className="papers-seller-name">
                <span>{d?.supplier?.name ?? p.vendor ?? t('papers.noSeller')}</span>
                {p.added && <span className="papers-tag" data-tone="new">{t('papers.tag.newSupplier')}</span>}
                {d?.supplier?.phone && <span className="papers-seller-sub">{d.supplier.phone}</span>}
              </span>
              <span className="papers-seller-change">{t('papers.change')}</span>
            </button>
            <div className="ios-row">
              <DateField label={t('common.date')} value={p.date} maxDate={dubaiDate()} onChange={(day) => void run(() => setPaperDate(p.id, day))} />
            </div>
            {(p.invoiceNo || p.car) && (
              <div className="ios-row papers-facts">
                {p.invoiceNo && <span>№ {p.invoiceNo}</span>}
                {p.car && <span>{p.car}</span>}
              </div>
            )}
            {!!p.totalFils && (
              <div className="ios-row papers-total">
                <span>{t('papers.total')}</span>
                <span>
                  {!!p.vatFils && (
                    <Text span c="dimmed" size="sm" mr={8}>
                      {t('papers.vat')} <Money fils={p.vatFils} />
                    </Text>
                  )}
                  <Money fils={p.totalFils} />
                </span>
              </div>
            )}
          </div>
          {!!p.lines?.length && (
            <div>
              <div className="group-title">
                {t('papers.linesTitle')} <span className="count">{p.lines.length}</span>
              </div>
              <List>
                {p.lines.map((l, k) => (
                  <ListRow
                    key={k}
                    title={<span data-paper-line={k}>{l.name}</span>}
                    subtitle={[partOfLine(l) !== l.name ? partOfLine(l) : '', l.partNumber, [l.make, l.model].filter(Boolean).join(' '), p.kind === 'service' ? '' : [t(l.kind === 'oem' ? 'priceBook.oem' : l.kind === 'used' ? 'priceBook.used' : 'priceBook.copy') + (l.unsure ? '?' : ''), l.brand].filter(Boolean).join(' '), l.qty !== 1 ? `× ${l.qty}` : '']
                      .filter(Boolean)
                      .join(' · ')}
                    right={l.unitFils !== undefined ? <Money fils={l.unitFils} /> : undefined}
                  />
                ))}
              </List>
            </div>
          )}
          <Stack gap="xs">
            {p.state === 'look' && (
              <Button size="md" leftSection={<IconCheck size={18} />} loading={busy} onClick={() => void run(() => settlePaper(p.id))} data-paper-settle>
                {t('papers.fine')}
              </Button>
            )}
            {p.state === 'twin' && (
              <Button size="md" variant="light" loading={busy} onClick={() => void run(() => notTwin(p.id))} data-paper-not-twin>
                {t('papers.notTwin')}
              </Button>
            )}
            {!p.expenseId && !!p.date && !!p.totalFils && (p.state === 'done' || p.state === 'look') && (
              <Button size="md" variant="light" leftSection={<IconPlus size={18} />} loading={busy} onClick={toExpense} data-paper-expense>
                {t('papers.toExpense')}
              </Button>
            )}
            {p.expenseId && d?.expense && (
              <Text size="sm" c="dimmed" ta="center" data-paper-has-expense>
                {t('papers.isExpense', { day: formatDate(d.expense.date) })}
              </Text>
            )}
            <Button size="md" variant="subtle" leftSection={<IconRefresh size={18} />} disabled={p.state === 'waiting' || p.state === 'reading'} onClick={() => void run(() => rereadPaper(p.id))} data-paper-reread>
              {t('papers.readAgain')}
            </Button>
            <Button size="md" variant="subtle" color="red" leftSection={<IconTrash size={18} />} onClick={remove} data-paper-remove>
              {t('common.delete')}
            </Button>
          </Stack>
        </Stack>
      )}
      {view && p && <PhotoViewer items={[{ id: p.mediaId, title: d?.supplier?.name ?? p.vendor }]} index={0} onIndex={() => undefined} onClose={() => setView(false)} />}
      <SupplierPick
        opened={picking}
        vendor={p?.vendor}
        onClose={() => setPicking(false)}
        onPick={(s) => {
          setPicking(false);
          haptic('selection');
          if (p) void run(() => setPaperSupplier(p.id, s.id));
        }}
        onNew={() => {
          setPicking(false);
          setAdding({ name: p?.vendor ?? '' });
        }}
      />
      {adding && (
        <SupplierSheet
          supplier={adding}
          onClose={() => setAdding(null)}
          onSaved={(s) => p && void run(() => setPaperSupplier(p.id, s.id))}
          onExisting={(s) => {
            setAdding(null);
            if (p) void run(() => setPaperSupplier(p.id, s.id));
          }}
        />
      )}
    </Modal>
  );
}

/** Another seller for a paper: the base's suppliers, searched; «＋ Новый поставщик» first. */
function SupplierPick({ opened, vendor, onClose, onPick, onNew }: { opened: boolean; vendor?: string; onClose: () => void; onPick: (s: Supplier) => void; onNew: () => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState(vendor ?? '');
  const all = useScreenLiveQuery(() => (opened ? db.suppliers.filter((s) => !s.archivedAt).toArray() : Promise.resolve([] as Supplier[])), [opened]);
  const list = (all ?? []).filter((s) => !q.trim() || supplierMatches(s, q)).sort((a, b) => a.name.localeCompare(b.name));
  const { limit, more } = useMoreRows(list.length, q);
  return (
    <Modal opened={opened} onClose={onClose} title={t('papers.pickSeller')} classNames={{ content: 'sheet-grouped' }}>
      <Stack gap="sm">
        <SearchField value={q} onChange={setQ} placeholder={t('common.search')} />
        <List>
          <ListRow left={<IconPlus size={20} />} title={t('papers.newSeller')} onClick={onNew} />
          {list.slice(0, limit).map((s) => (
            <ListRow key={s.id} left={<PersonAvatar name={s.name} size={32} />} title={s.name} subtitle={s.phone} onClick={() => onPick(s)} />
          ))}
          {more()}
        </List>
      </Stack>
    </Modal>
  );
}
