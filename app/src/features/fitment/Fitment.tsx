import { ActionIcon, Button, Group, Menu, Modal, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangleFilled, IconCircleCheckFilled, IconCircleXFilled, IconExternalLink, IconHelpCircleFilled, IconPhotoScan, IconProgressCheck, IconScan, IconWorld, IconX } from '@tabler/icons-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { hostOf, readBeltMarking, type Evidence, type Fitment, type FitStatus, type Why } from '../../domain/fitment';
import { formatDate } from '../../domain/dates';
import { sameNumber } from '../../domain/partNumbers';
import { isVin } from '../../domain/vin';
import { vinCatalogs } from '../../domain/vinCatalogs';
import { copyText } from '../../ui/clipboard';
import { ackOrderRisks, loadFitment, orderRisks, readMarking, setMarking, setVinCheck, type LineFitment, type OrderRisk } from '../../services/fitment';
import { readCardLines } from '../../services/vinReader';
import { haptic } from '../../ui/haptics';
import { useAction, useScreenLiveQuery } from '../../ui/hooks';
import { LazySheet } from '../../ui/lazy';

/*
 * A number's fitment on screen (v0.65, domain/fitment.ts): its status as a word and a colour — green for verified only;
 * how many independent sources have it, apart (that is its existence, not its fitting); a tap — why: what it rests on,
 * what contradicts it, what is missing, every piece of evidence with where it came from and when. The marking of the part
 * on the car (a belt's), typed or read off its photo. Ordering with a number not verified asks for the manager's reason.
 */

const ICON: Record<FitStatus, typeof IconCircleCheckFilled> = {
  verified: IconCircleCheckFilled,
  partial: IconProgressCheck,
  unverified: IconHelpCircleFilled,
  conflict: IconAlertTriangleFilled,
  rejected: IconCircleXFilled,
};

/** A line's fitment, read live (its numbers, its car, the part on the car, the garage's jobs). */
export function useLineFitment(itemId: string | undefined): LineFitment | undefined {
  return useScreenLiveQuery(() => (itemId ? loadFitment(itemId) : undefined), [itemId]);
}

/** A number's status: an icon and a word in its colour; a tap — why. */
export function FitBadge({ fit, onClick, compact }: { fit: Fitment; onClick?: () => void; compact?: boolean }) {
  const { t } = useTranslation();
  const Icon = ICON[fit.status];
  const label = t(`fit.${fit.status}`);
  return (
    <button type="button" className="fit-badge" data-status={fit.status} data-fit={fit.status} aria-label={`${label} — ${t('fit.why')}`} onClick={(e) => (e.stopPropagation(), onClick?.())}>
      <Icon size={16} aria-hidden />
      {!compact && <span>{label}</span>}
    </button>
  );
}

/** How many independent sources a number was found in — its existence, shown apart from its status. */
export function FitSources({ count }: { count: number }) {
  const { t } = useTranslation();
  if (!count) return null;
  return (
    <span className="fit-sources tnum" aria-label={t('fit.sources', { count })} title={t('fit.sources', { count })}>
      <IconWorld size={13} stroke={2} aria-hidden />
      {count}
    </span>
  );
}

/** A reason or a conflict in words. */
function whyText(t: (k: string, o?: Record<string, unknown>) => string, w: Why, kind: 'reasons' | 'conflicts'): string {
  const p = { ...w.params } as Record<string, unknown>;
  if (p.by) p.by = t(`fit.by.${p.by}`);
  if ('job' in p) p.job = p.job ? ` · №${p.job}` : '';
  return t(`fit.${kind}.${w.code}`, p);
}

function EvidenceRow({ e }: { e: Evidence }) {
  const { t } = useTranslation();
  const where = e.source === 'garage' || e.source === 'ai' || e.source === 'typed' || e.source === 'photo' ? t(`fit.src.${e.source}`) : e.source || (e.url ? hostOf(e.url) : '');
  const detail = e.kind === 'web' && (e.detail === 'page' || e.detail === 'search') ? t(`fit.how.${e.detail}`) : e.detail;
  return (
    <div className="fit-ev" data-weight={e.weight}>
      <div className="fit-ev-head">
        <span className="fit-ev-kind">{t(`fit.ev.${e.kind}`)}</span>
        <span className="fit-ev-weight">{t(`fit.weight.${e.weight}`)}</span>
      </div>
      <div className="fit-ev-body">
        {e.url ? (
          <a href={e.url} target="_blank" rel="noopener noreferrer">
            {where}
          </a>
        ) : (
          <span>{where}</span>
        )}
        {detail && <span className="fit-ev-detail"> · {detail}</span>}
        {e.at && <span className="fit-ev-detail"> · {formatDate(e.at)}</span>}
      </div>
    </div>
  );
}

/** «Почему этот номер?» — the status, what it rests on, what contradicts it, what is missing, the evidence itself. */
export function FitSheet({ number, fit, opened, onClose }: { number: string; fit?: Fitment; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <LazySheet opened={opened}>
      {(o) => (
        <Modal opened={o && opened && !!fit} onClose={onClose} title={number}>
          {fit && (
            <Stack gap="md" data-fit-sheet>
              <div className="fit-head" data-status={fit.status}>
                <FitBadge fit={fit} />
                <Text size="sm" c="dimmed">
                  {t(`fit.text.${fit.status}`)}
                </Text>
              </div>
              {fit.conflicts.length > 0 && (
                <Section title={t('fit.conflictsTitle')}>
                  {fit.conflicts.map((w, i) => (
                    <div key={i} className="fit-line" data-tone="bad">
                      {whyText(t, w, 'conflicts')}
                    </div>
                  ))}
                </Section>
              )}
              {fit.reasons.length > 0 && (
                <Section title={t('fit.reasonsTitle')}>
                  {fit.reasons.map((w, i) => (
                    <div key={i} className="fit-line" data-tone={fit.status === 'verified' ? 'good' : undefined}>
                      {whyText(t, w, 'reasons')}
                    </div>
                  ))}
                </Section>
              )}
              {fit.missing.length > 0 && (
                <Section title={t('fit.missingTitle')}>
                  {fit.missing.map((m) => (
                    <div key={m} className="fit-line" data-tone="warn" data-missing={m}>
                      {t(`fit.missing.${m}`)}
                    </div>
                  ))}
                </Section>
              )}
              <Section title={t('fit.evidenceTitle')}>
                {fit.evidence.length ? fit.evidence.map((e, i) => <EvidenceRow key={i} e={e} />) : <Text size="sm" c="dimmed">{t('fit.noEvidence')}</Text>}
                <Text size="xs" c="dimmed" mt={6}>
                  {t('fit.sourcesNote', { count: fit.sources })}
                </Text>
              </Section>
            </Stack>
          )}
        </Modal>
      )}
    </LazySheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="fit-section">
      <div className="fit-section-title">{title}</div>
      {children}
    </div>
  );
}

/** A belt line's photo read for its marking: its lines of text, as the card reader reads them. */
const readText = async (blob: Blob) => (await readCardLines(blob)).map((l) => l.text).join('\n');

/**
 * The marking of the part on the car (a belt's «7PK2164»): typed — the manager's word; read off the line's own photo —
 * offered, taken by a tap. What it says is compared with every number's size.
 */
export function MarkingRow({ itemId, fitment, hasPhotos }: { itemId: string; fitment: LineFitment; hasPhotos: boolean }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const m = fitment.marking;
  const [text, setText] = useState(m?.from === 'typed' ? m.text : '');
  const was = useRef(text);
  useEffect(() => {
    const v = m?.from === 'typed' ? m.text : '';
    setText(v);
    was.current = v;
  }, [m?.from, m?.text]);
  const save = (v: string) => {
    if (v.trim().toUpperCase() === was.current.trim().toUpperCase()) return;
    was.current = v;
    void run(async () => void (await setMarking(itemId, v)));
  };
  const read = readBeltMarking(text);
  const bad = !!text.trim() && !read.spec;
  const [none, setNone] = useState(false);
  return (
    <div className="ios-row fit-marking" data-marking>
      <span className="label">{t('fit.marking')}</span>
      <div className="value">
        <Group gap={6} wrap="nowrap" justify="flex-end">
          <TextInput
            aria-label={t('fit.marking')}
            placeholder={t('fit.markingPlaceholder')}
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            onBlur={() => save(text)}
            onKeyDown={(e) => e.key === 'Enter' && save(text)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            error={bad ? true : undefined}
            style={{ flex: 1 }}
          />
          {hasPhotos && (
            <ActionIcon
              variant="light"
              color="gray"
              radius="xl"
              size={36}
              loading={busy}
              aria-label={t('fit.readPhoto')}
              onClick={() =>
                void run(async () => {
                  const got = await readMarking(itemId, readText);
                  setNone(!got);
                })
              }
            >
              <IconPhotoScan size={18} />
            </ActionIcon>
          )}
        </Group>
        {m?.from === 'photo' && (
          <button
            type="button"
            className="chip fit-photo-read"
            data-unsure={m.confidence < 0.85 || undefined}
            onClick={() => {
              haptic('selection');
              setText(m.text);
              save(m.text);
            }}
          >
            {t('fit.markingFromPhoto', { text: [m.text, ...(m.alternatives ?? [])].join(' / ') })} · {t('fit.markingTake')}
          </button>
        )}
        {none && m?.from !== 'photo' && (
          <Text size="xs" c="dimmed" ta="right">
            {t('fit.markingNone')}
          </Text>
        )}
      </div>
    </div>
  );
}

/**
 * Ordering with a number not verified: the parts listed with their status, the manager's reason asked — then ordered as
 * asked, the reason kept with each part (the number stays as judged). `guard(ids)` — true when ordering may go on.
 */
export function useOrderGuard(): { guard: (itemIds: string[], typed?: Record<string, string>) => Promise<boolean>; node: ReactNode } {
  const [asking, setAsking] = useState<{ risks: OrderRisk[]; done: (ok: boolean) => void } | null>(null);
  // Asked before the action starts (not in the middle of it — its button would spin behind the question).
  const guard = async (itemIds: string[], typed?: Record<string, string>) => {
    const risks = await orderRisks(itemIds, typed).catch(() => []);
    if (!risks.length) return true;
    return new Promise<boolean>((done) => setAsking({ risks, done }));
  };
  const close = (ok: boolean) => {
    asking?.done(ok);
    setAsking(null);
  };
  return { guard, node: <OrderRiskSheet risks={asking?.risks} onDone={close} /> };
}

function OrderRiskSheet({ risks, onDone }: { risks?: OrderRisk[]; onDone: (ok: boolean) => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [reason, setReason] = useState('');
  const [why, setWhy] = useState<OrderRisk | null>(null);
  useEffect(() => {
    if (risks) setReason('');
  }, [risks]);
  return (
    <>
      <LazySheet opened={!!risks}>
        {(o) => (
          <Modal opened={o && !!risks} onClose={() => onDone(false)} title={t('fit.orderTitle')}>
            <Stack gap="md" data-order-risk>
              <Text size="sm" c="dimmed">
                {t('fit.orderText')}
              </Text>
              {(risks ?? []).map((r) => (
                <div key={r.itemId} className="fit-risk">
                  <div className="fit-risk-main">
                    <span className="fit-risk-name">{r.name}</span>
                    <span className="ai-num-no">{r.number}</span>
                  </div>
                  <FitBadge fit={r.fit} onClick={() => setWhy(r)} />
                </div>
              ))}
              <Textarea label={t('fit.orderReason')} value={reason} onChange={(e) => setReason(e.currentTarget.value)} autosize minRows={2} data-order-reason />
              <Button
                size="lg"
                color="orange"
                fullWidth
                loading={busy}
                disabled={!reason.trim()}
                onClick={() =>
                  void run(async () => {
                    await ackOrderRisks(risks ?? [], reason);
                    haptic('light');
                    onDone(true);
                  })
                }
              >
                {t('fit.orderAnyway')}
              </Button>
              <Button size="lg" variant="subtle" color="gray" fullWidth onClick={() => onDone(false)}>
                {t('common.cancel')}
              </Button>
            </Stack>
          </Modal>
        )}
      </LazySheet>
      <FitSheet number={why?.number ?? ''} fit={why?.fit} opened={!!why} onClose={() => setWhy(null)} />
    </>
  );
}

/** A belt line's new photos read for its marking, after the line is saved — not waited for. */
export function readMarkingLater(itemId: string) {
  void readMarking(itemId, readText).catch(() => undefined);
}

/**
 * The line's own number under «Номер» (one the search found): its status, and in a few words why it is not green — the
 * first contradiction, else what is missing; a tap — the whole why.
 */
export function FitCurrent({ number, fit }: { number: string; fit: Fitment }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const hint = fit.status === 'verified' ? '' : fit.conflicts[0] ? whyText(t, fit.conflicts[0], 'conflicts') : fit.missing.length ? t('fit.lacks', { what: fit.missing.slice(0, 4).map((m) => t(`fit.short.${m}`)).join(', ') }) : '';
  return (
    <div className="ios-row fit-current" data-fit-current={fit.status}>
      <FitBadge fit={fit} onClick={() => setOpen(true)} />
      {hint && (
        <button type="button" className="fit-hint" onClick={() => setOpen(true)}>
          {hint}
        </button>
      )}
      <FitSheet number={number} fit={fit} opened={open} onClose={() => setOpen(false)} />
    </div>
  );
}

type CarForCatalogs = LineFitment['vehicle'];
const vinOf = (car: CarForCatalogs) => {
  const v = (car.vin ?? '').toUpperCase().replace(/s/g, '');
  return isVin(v) ? v : '';
};

/**
 * The parts catalogues by this car's VIN (v0.66, domain/vinCatalogs.ts), the likeliest for where it was built first: a tap
 * opens one on this car — the VIN in the address (EMEX, EXIST), else copied for pasting into its search.
 */
export function VinCatalogsRow({ car }: { car: CarForCatalogs }) {
  const { t } = useTranslation();
  const vin = vinOf(car);
  const list = vinCatalogs(car);
  return (
    <div className="ios-row vin-cats" data-vin-catalogs>
      <div className="vin-cats-head">
        <span className="label">{t('fit.catalogs')}</span>
        {!vin && <span className="vin-cats-novin">{t('fit.noVinShort')}</span>}
      </div>
      <div className="chip-row wrap vin-cat-row">
        {list.map((c) => (
          <a
            key={c.id}
            className="chip vin-cat"
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            data-catalog={c.id}
            data-vin={c.vinInUrl || undefined}
            onClick={() => {
              haptic('selection');
              // A site that does not take the VIN in its address: the VIN copied, to paste into its search.
              if (!c.vinInUrl && vin) void copyText(vin).then((ok) => ok && notifications.show({ message: t('fit.vinCopied', { vin }), autoClose: 2500 }));
            }}
          >
            {c.name}
            <IconExternalLink size={13} stroke={2} aria-hidden />
          </a>
        ))}
      </div>
    </div>
  );
}

/**
 * «Найден по VIN»: the manager found the number typed under «Номер» by this car's VIN in a catalogue — says where (a
 * menu of them); the number is then verified for this car (domain/fitment.ts). Found so — said, with × to take it back.
 */
export function VinFound({ itemId, number, fitment }: { itemId: string; number: string; fitment: LineFitment }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const vin = vinOf(fitment.vehicle);
  const check = fitment.vinCheck;
  if (!vin || !number.trim()) return null;
  if (check && sameNumber(check.number, number) && check.vin === vin)
    return (
      <div className="ios-row vin-found" data-vin-found={check.source}>
        <span className="vin-found-text">
          <IconScan size={16} stroke={2} aria-hidden />
          {t('fit.foundIn', { site: check.source })}
        </span>
        <ActionIcon variant="subtle" color="gray" radius="xl" size={32} aria-label={t('common.delete')} onClick={() => void run(async () => void (await setVinCheck(itemId, undefined)))}>
          <IconX size={16} />
        </ActionIcon>
      </div>
    );
  return (
    <div className="ios-row vin-found">
      <Menu position="bottom-start" withinPortal>
        <Menu.Target>
          <Button variant="light" color="green" radius="xl" size="compact-md" leftSection={<IconScan size={16} />} data-vin-found-open>
            {t('fit.foundByVin')}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>{t('fit.foundWhere')}</Menu.Label>
          {vinCatalogs(fitment.vehicle).map((c) => (
            <Menu.Item key={c.id} data-found-in={c.id} onClick={() => void run(async () => (await setVinCheck(itemId, number, c.host), haptic('success')))}>
              {c.name}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}
