import { ActionIcon, Switch, Text, TextInput } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconClock, IconRefresh, IconTrash, IconUsersGroup } from '@tabler/icons-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { dubaiTime } from '../../domain/dates';
import type { Lang } from '../../domain/types';
import { waAutoOf, type WaAuto, type WaTarget } from '../../domain/waAuto';
import { getSettings } from '../../services/settings';
import { saveWaAuto } from '../../services/waAuto';
import { dropOutbox, outboxStatus, retryOutbox } from '../../services/waOutbox';
import { useWa, waCan, type OutboxFace } from '../../services/whatsapp';
import { db } from '../../db/db';
import { FormRow, List, ListRow, PageHeader, PageSkeleton, RowGroup } from '../../ui/components';
import { useAction, useScreenLiveQuery } from '../../ui/hooks';
import { SheetFor } from '../../ui/lazy';
import { ChatPicker } from './ChatPicker';

/*
 * «WhatsApp → Автоматизация» (v0.79, the user: «все эти внедрения — с возможностями самостоятельных настроек»): where
 * each report goes and what it says, when it goes by itself; the suppliers' requests and what their answers do; what
 * waits to go and what did not. Kept with the garage's settings (every device the same).
 */

type Section = keyof WaAuto;

function On({ label, value, onChange, mark }: { label: ReactNode; value: boolean; onChange: (v: boolean) => void; mark: string }) {
  return (
    <FormRow label={label}>
      <Switch checked={value} onChange={(e) => onChange(e.currentTarget.checked)} aria-label={typeof label === 'string' ? label : undefined} data-wa-auto={mark} />
    </FormRow>
  );
}

/** A choice of a few, as chips. */
function Chips<T extends string | number>({ value, options, onChange, mark }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; mark: string }) {
  return (
    <div className="chip-row wrap" role="group">
      {options.map((o) => (
        <button key={String(o.v)} type="button" className="chip" data-active={value === o.v} aria-pressed={value === o.v} onClick={() => onChange(o.v)} data-wa-auto={`${mark}:${o.v}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A row whose choices are many: its label above them. */
function Stack({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ios-row wa-auto-stack">
      <span className="label">{label}</span>
      {children}
    </div>
  );
}

function Target({ label, to, onPick, mark }: { label: string; to?: WaTarget; onPick: () => void; mark: string }) {
  const { t } = useTranslation();
  return (
    <FormRow label={label} onClick={onPick} chevron>
      <Text c={to ? undefined : 'cobalt.6'} fw={to ? 500 : 600} lineClamp={1} data-wa-target={mark}>
        {to?.name || t('wa.auto.pick')}
      </Text>
    </FormRow>
  );
}

const STATE_ICON: Record<string, typeof IconCheck> = { sent: IconCheck, failed: IconAlertTriangle, queued: IconClock, sending: IconClock };

export function WaAutoPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { run } = useAction();
  const wa = useWa();
  const data = useScreenLiveQuery(async () => ({ s: waAutoOf((await getSettings()).waAuto), groups: (await db.customers.toArray()).filter((c) => c.waGroup && !c.archivedAt) }), []);
  const [picking, setPicking] = useState<{ section: 'work' | 'boss' | 'wash'; kind: 'group' | 'person' } | null>(null);
  const [queue, setQueue] = useState<OutboxFace[] | null>(null);
  const loadQueue = () => void outboxStatus().then((r) => setQueue(r.items), () => setQueue([]));
  useEffect(() => {
    if (waCan()) loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The stream says what changed: the list follows.
  const live = queue?.map((q) => wa.outbox[q.key] ?? q);
  if (!data) return <PageSkeleton />;
  const { s } = data;
  const save = <K extends Section>(section: K, patch: Partial<WaAuto[K]>) => void run(() => saveWaAuto(section, patch));
  const langChips = (section: 'work' | 'client' | 'boss', value: Lang) => (
    <FormRow label={t('wa.auto.lang')}>
      <Chips value={value} options={[{ v: 'en', label: 'English' }, { v: 'ru', label: 'Русский' }]} onChange={(v) => save(section, { lang: v })} mark={`${section}-lang`} />
    </FormRow>
  );
  return (
    <>
      <PageHeader title={t('wa.auto.title')} eyebrow="WhatsApp" back="/whatsapp/setup" />
      <div className="wa-auto">
        {/* The work group */}
        <RowGroup title={t('wa.auto.work')} note={t('wa.auto.workNote')}>
          <Target label={t('wa.auto.group')} to={s.work.to} onPick={() => setPicking({ section: 'work', kind: 'group' })} mark="work" />
          <On label={t('wa.auto.onCheckin')} value={s.work.checkin} onChange={(v) => save('work', { checkin: v })} mark="work-checkin" />
          <On label={t('wa.auto.onAgreed')} value={s.work.agreed} onChange={(v) => save('work', { agreed: v })} mark="work-agreed" />
          <On label={t('wa.auto.onDone')} value={s.work.done} onChange={(v) => save('work', { done: v })} mark="work-done" />
          <On label={t('wa.auto.complaint')} value={s.work.complaint} onChange={(v) => save('work', { complaint: v })} mark="work-complaint" />
          <On label={t('wa.auto.lines')} value={s.work.lines} onChange={(v) => save('work', { lines: v })} mark="work-lines" />
          <On label={t('wa.auto.mechanics')} value={s.work.mechanics} onChange={(v) => save('work', { mechanics: v })} mark="work-mechanics" />
          {langChips('work', s.work.lang)}
        </RowGroup>

        {/* A company's own group */}
        <RowGroup title={t('wa.auto.client')} note={t('wa.auto.clientNote')}>
          <On label={t('wa.auto.clientOn')} value={s.client.on} onChange={(v) => save('client', { on: v })} mark="client-on" />
          <On label={t('wa.auto.driver')} value={s.client.driver} onChange={(v) => save('client', { driver: v })} mark="client-driver" />
          <On label={t('wa.auto.mileage')} value={s.client.mileage} onChange={(v) => save('client', { mileage: v })} mark="client-mileage" />
          <On label={t('wa.auto.lines')} value={s.client.lines} onChange={(v) => save('client', { lines: v })} mark="client-lines" />
          <On label={t('wa.auto.complaint')} value={s.client.complaint} onChange={(v) => save('client', { complaint: v })} mark="client-complaint" />
          <Stack label={t('wa.auto.photos')}>
            <Chips value={s.client.photos} options={[0, 1, 2, 3, 4].map((n) => ({ v: n, label: String(n) }))} onChange={(v) => save('client', { photos: v })} mark="client-photos" />
          </Stack>
          <On label={t('wa.auto.clientDone')} value={s.client.done} onChange={(v) => save('client', { done: v })} mark="client-done" />
          {langChips('client', s.client.lang)}
        </RowGroup>
        {data.groups.length > 0 && (
          <List>
            {data.groups.map((c) => (
              <ListRow
                key={c.id}
                onClick={() => navigate(`/customers/${c.id}`)}
                chevron
                left={
                  <span className="row-icon" style={{ background: 'var(--mantine-color-green-6)' }} aria-hidden>
                    <IconUsersGroup size={18} stroke={2} />
                  </span>
                }
                title={(c.type === 'company' && c.companyName) || c.name}
                subtitle={c.waGroup?.name}
              />
            ))}
          </List>
        )}

        {/* The boss */}
        <RowGroup title={t('wa.auto.boss')} note={t('wa.auto.bossNote')}>
          <Target label={t('wa.auto.to')} to={s.boss.to} onPick={() => setPicking({ section: 'boss', kind: 'person' })} mark="boss" />
          <On label={t('wa.auto.estimate')} value={s.boss.estimate} onChange={(v) => save('boss', { estimate: v })} mark="boss-estimate" />
          <On label={t('wa.auto.invoice')} value={s.boss.invoice} onChange={(v) => save('boss', { invoice: v })} mark="boss-invoice" />
          <On label={t('wa.auto.payment')} value={s.boss.payment} onChange={(v) => save('boss', { payment: v })} mark="boss-payment" />
          <On label={t('wa.auto.income')} value={s.boss.income} onChange={(v) => save('boss', { income: v })} mark="boss-income" />
          <On label={t('wa.auto.expense')} value={s.boss.expense} onChange={(v) => save('boss', { expense: v })} mark="boss-expense" />
          <On label={t('wa.auto.pdf')} value={s.boss.pdf} onChange={(v) => save('boss', { pdf: v })} mark="boss-pdf" />
          <On label={t('wa.auto.receipt')} value={s.boss.photo} onChange={(v) => save('boss', { photo: v })} mark="boss-photo" />
          {langChips('boss', s.boss.lang)}
        </RowGroup>

        {/* The wash */}
        <RowGroup title={t('wa.auto.wash')} note={t('wa.auto.washNote')}>
          <Target label={t('wa.auto.group')} to={s.wash.to} onPick={() => setPicking({ section: 'wash', kind: 'group' })} mark="wash" />
          <FormRow label={t('wa.auto.words')}>
            <TextInput
              variant="unstyled"
              defaultValue={s.wash.words.join(', ')}
              onBlur={(e) => save('wash', { words: e.currentTarget.value.split(',').map((w) => w.trim()).filter(Boolean) })}
              aria-label={t('wa.auto.words')}
              styles={{ input: { textAlign: 'right' } }}
              data-wa-auto="wash-words"
            />
          </FormRow>
          <FormRow label={t('wa.auto.caption')}>
            <TextInput variant="unstyled" defaultValue={s.wash.caption} onBlur={(e) => save('wash', { caption: e.currentTarget.value.trim() || 'CAR WASH' })} aria-label={t('wa.auto.caption')} styles={{ input: { textAlign: 'right' } }} data-wa-auto="wash-caption" />
          </FormRow>
          <On label={t('wa.auto.plate')} value={s.wash.plate} onChange={(v) => save('wash', { plate: v })} mark="wash-plate" />
        </RowGroup>

        {/* Suppliers */}
        <RowGroup title={t('wa.auto.suppliers')} note={t('wa.auto.suppliersNote')}>
          <Stack label={t('wa.auto.gap')}>
            <Chips value={s.ask.gapSec} options={[5, 8, 15, 30].map((n) => ({ v: n, label: `${n} ${t('wa.auto.sec')}` }))} onChange={(v) => save('ask', { gapSec: v })} mark="ask-gap" />
          </Stack>
          <Stack label={t('wa.auto.max')}>
            <Chips value={s.ask.max} options={[5, 10, 15, 20].map((n) => ({ v: n, label: String(n) }))} onChange={(v) => save('ask', { max: v })} mark="ask-max" />
          </Stack>
          <On label={t('wa.auto.read')} value={s.ask.read} onChange={(v) => save('ask', { read: v })} mark="ask-read" />
          {s.ask.read && (
            <>
              <Stack label={t('wa.auto.prices')}>
                <Chips
                  value={s.ask.prices}
                  options={[
                    { v: 'offers', label: t('wa.auto.pricesOffers') },
                    { v: 'cost', label: t('wa.auto.pricesCost') },
                    { v: 'price', label: t('wa.auto.pricesPrice') },
                  ]}
                  onChange={(v) => save('ask', { prices: v })}
                  mark="ask-prices"
                />
              </Stack>
              <FormRow label={t('wa.auto.prefer')}>
                <Chips
                  value={s.ask.prefer}
                  options={[
                    { v: 'oem', label: t('offer.oem') },
                    { v: 'cheap', label: t('wa.auto.cheap') },
                  ]}
                  onChange={(v) => save('ask', { prefer: v })}
                  mark="ask-prefer"
                />
              </FormRow>
              <FormRow label={t('wa.auto.vat')}>
                <Chips
                  value={s.ask.vat}
                  options={[
                    { v: 'net', label: t('wa.auto.vatNet') },
                    { v: 'gross', label: t('wa.auto.vatGross') },
                  ]}
                  onChange={(v) => save('ask', { vat: v })}
                  mark="ask-vat"
                />
              </FormRow>
            </>
          )}
        </RowGroup>

        {/* What waits to go, what did not */}
        <div className="notify-group">
          <div className="group-title">
            <span>{t('wa.auto.queue')}</span>
            <ActionIcon variant="subtle" size={32} radius="xl" ml="auto" aria-label={t('wa.gate.retry')} onClick={loadQueue}>
              <IconRefresh size={18} />
            </ActionIcon>
          </div>
          {live === undefined ? null : live.length === 0 ? (
            <Text c="dimmed" px={4}>
              {t('wa.auto.queueEmpty')}
            </Text>
          ) : (
            <List>
              {live.slice(0, 40).map((q) => {
                const I = STATE_ICON[q.state] ?? IconClock;
                const color = q.state === 'failed' ? 'red' : q.state === 'sent' ? 'green' : 'orange';
                return (
                  <ListRow
                    key={q.key}
                    left={
                      <span className="row-icon" style={{ background: `var(--mantine-color-${color}-6)` }} aria-hidden>
                        <I size={17} stroke={2.2} />
                      </span>
                    }
                    title={<span data-wa-queue={q.state}>{q.title || t(`wa.auto.kind.${q.key.split(':')[0]}`, { defaultValue: q.key.split(':')[0] })}</span>}
                    subtitle={[t(`wa.auto.state.${q.state}`), q.at ? dubaiTime(new Date(q.at).toISOString()) : '', q.error ?? ''].filter(Boolean).join(' · ')}
                    right={
                      q.state === 'failed' || q.state === 'queued' ? (
                        <span className="wa-queue-actions">
                          {q.state === 'failed' && (
                            <ActionIcon variant="light" size={34} radius="xl" aria-label={t('wa.gate.retry')} onClick={() => void run(async () => (await retryOutbox(q.key), loadQueue()))}>
                              <IconRefresh size={17} />
                            </ActionIcon>
                          )}
                          <ActionIcon variant="light" color="red" size={34} radius="xl" aria-label={t('common.delete')} onClick={() => void run(async () => (await dropOutbox(q.key), loadQueue()))}>
                            <IconTrash size={17} />
                          </ActionIcon>
                        </span>
                      ) : undefined
                    }
                  />
                );
              })}
            </List>
          )}
        </div>
      </div>
      <SheetFor value={picking}>
        {(p, o) => (
          <ChatPicker
            opened={o}
            kind={p.kind}
            title={t(`wa.auto.${p.section}`)}
            onClose={() => setPicking(null)}
            onPick={(to) => save(p.section, { to } as Partial<WaAuto[typeof p.section]>)}
          />
        )}
      </SheetFor>
    </>
  );
}
