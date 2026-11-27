import { Button, Group, Modal, SegmentedControl, Stack, Switch, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlarm, IconBell, IconBellCheck, IconBellOff, IconCash, IconCheck, IconDeviceMobile, IconMessageCheck, IconPlus, IconServer, IconSparkles, IconTag, type Icon } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { dayShort, dubaiTime } from '../../domain/dates';
import { AFTER_CHOICES, BEFORE_CHOICES, clock, EVERY_CHOICES, KIND_TIME, minutesOf, NEWS_KINDS, NOTIFY_KINDS, notifyOf, type NewsKind, type NotifyRule, type NotifySettings } from '../../domain/notify';
import type { TaskKind } from '../../domain/today';
import type { Reminder } from '../../domain/types';
import { saveNotify } from '../../services/notify';
import { disablePush, enablePush, testPush, usePush } from '../../services/push';
import { openReminders } from '../../services/reminders';
import { getSettings } from '../../services/settings';
import { FormRow, List, ListRow, PageHeader, PageSkeleton, RowGroup } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useScreenLiveQuery } from '../../ui/hooks';
import { SheetFor } from '../../ui/lazy';
import { TASK_META } from '../board/TodayBell';
import { ReminderSheet } from './ReminderSheet';

/** v0.97: the news said at once, each its sign and colour. */
const NEWS_META: Record<NewsKind, { icon: Icon; color: string }> = {
  answer: { icon: IconMessageCheck, color: 'green' },
  prices: { icon: IconTag, color: 'orange' },
  payment: { icon: IconCash, color: 'teal' },
  request: { icon: IconSparkles, color: 'cobalt' },
};

/** Sunday is 0; the week is shown from Monday. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/** «15 мин», «1 ч», «1 д» — a rule's delay or repeat. */
function useSpan() {
  const { t } = useTranslation();
  return (min: number) => (min < 60 ? `${min} ${t('notify.unit.m')}` : min < 1440 ? `${min / 60} ${t('notify.unit.h')}` : `${min / 1440} ${t('notify.unit.d')}`);
}

/** A rule in a line: «через 1 ч · каждый 1 ч», «за 30 мин · каждый 1 ч», «утром · один раз». */
function useRuleLine() {
  const { t } = useTranslation();
  const span = useSpan();
  return (kind: TaskKind, r: NotifyRule) => {
    const time = KIND_TIME[kind];
    const first = time === 'day' ? t('notify.morning') : time === 'moment' ? (r.after < 0 ? t('notify.before', { t: span(-r.after) }) : t('notify.onTime')) : r.after > 0 ? t('notify.after', { t: span(r.after) }) : t('notify.atOnce');
    return `${first} · ${r.every ? t('notify.every', { t: span(r.every) }) : t('notify.once')}`;
  };
}

/**
 * This device and the phone's notifications: what stands in the way is said in a line and has its one button — the
 * server to connect, the app to put on the Home Screen, the permission to give; then «Включить», and once on —
 * «Проверить» sends one now.
 */
function DeviceCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { run } = useAction();
  const p = usePush();
  const enable = () =>
    void run(async () => {
      const s = await enablePush();
      if (s.subscribed) haptic('success');
    });
  const test = () =>
    void run(async () => {
      const r = await testPush('MyGarage', t('notify.testBody'));
      notifications.show(r.ok ? { color: 'green', message: t('notify.testSent'), icon: <IconCheck size={18} stroke={2.6} /> } : { color: 'orange', message: t('notify.testFailed') });
    });
  const row = (icon: React.ReactNode, color: string, title: string, sub?: string, action?: React.ReactNode) => (
    <div className="notify-device" data-push-state>
      <span className="row-icon" style={{ background: `var(--mantine-color-${color}-6)` }} aria-hidden>
        {icon}
      </span>
      <div className="notify-device-body">
        <Text fw={600} lh={1.3}>
          {title}
        </Text>
        {sub && (
          <Text size="sm" c="dimmed" lh={1.35}>
            {sub}
          </Text>
        )}
      </div>
      {action}
    </div>
  );
  if (!p.server)
    return row(
      <IconServer size={19} stroke={2} />,
      'gray',
      t('notify.needServer'),
      t('notify.needServerHint'),
      <Button size="compact-md" variant="light" data-route={'/settings?tab=data'} onClick={() => navigate('/settings?tab=data')}>
        {t('notify.connect')}
      </Button>,
    );
  if (p.serverReady === false) return row(<IconServer size={19} stroke={2} />, 'orange', t('notify.serverOld'), t('notify.serverOldHint'));
  if (p.needsInstall) return row(<IconDeviceMobile size={19} stroke={2} />, 'orange', t('notify.needInstall'), t('notify.needInstallHint'));
  if (!p.can || !p.worker) return row(<IconBellOff size={19} stroke={2} />, 'gray', t('notify.unsupported'));
  if (p.permission === 'denied') return row(<IconBellOff size={19} stroke={2} />, 'red', t('notify.denied'), t('notify.deniedHint'));
  if (!p.subscribed)
    return (
      <Stack gap="sm">
        {row(<IconBell size={19} stroke={2} />, 'cobalt', t('notify.device'), t('notify.deviceOff'))}
        <Button fullWidth size="md" loading={p.busy} leftSection={<IconBell size={18} />} onClick={enable} data-push-enable>
          {t('notify.enable')}
        </Button>
      </Stack>
    );
  return (
    <Stack gap="sm">
      {row(<IconBellCheck size={19} stroke={2} />, 'green', t('notify.device'), t('notify.deviceOn'))}
      <Group grow gap="sm">
        <Button variant="light" onClick={test} data-push-test>
          {t('notify.test')}
        </Button>
        <Button variant="default" loading={p.busy} onClick={() => void run(() => disablePush())}>
          {t('notify.disable')}
        </Button>
      </Group>
    </Stack>
  );
}

/** One kind's own timing: on or off, how long before the first, how often again. */
function RuleSheet({ kind, rule, opened, onClose, onChange }: { kind: TaskKind; rule: NotifyRule; opened: boolean; onClose: () => void; onChange: (r: NotifyRule) => void }) {
  const { t } = useTranslation();
  const span = useSpan();
  const time = KIND_TIME[kind];
  const firsts = time === 'moment' ? BEFORE_CHOICES.map((m) => -m) : time === 'since' ? AFTER_CHOICES : [];
  const firstLabel = (m: number) => (m === 0 ? t(time === 'moment' ? 'notify.onTime' : 'notify.atOnce') : span(Math.abs(m)));
  const inPlan = rule.when === 'plan';
  return (
    <Modal opened={opened} onClose={onClose} title={t(`notify.kind.${kind}`)}>
      <Stack gap="md" data-rule-sheet={kind}>
        {/* v0.97: a notification of its own, or a line of the plan of the day (a reminder — always its own). */}
        {kind !== 'reminder' && (
          <SegmentedControl
            fullWidth
            value={inPlan ? 'plan' : 'now'}
            onChange={(v) => onChange({ ...rule, when: v === 'plan' ? 'plan' : 'now' })}
            data={[
              { value: 'now', label: t('notify.whenNow') },
              { value: 'plan', label: t('notify.whenPlan') },
            ]}
            data-when={inPlan ? 'plan' : 'now'}
          />
        )}
        {firsts.length > 0 && (
          <div>
            <Text size="sm" fw={500} mb={6}>
              {t(time === 'moment' ? 'notify.beforeLabel' : 'notify.afterLabel')}
            </Text>
            <div className="chip-row wrap">
              {firsts.map((m) => (
                <button key={m} type="button" className="chip" data-active={rule.after === m} onClick={() => onChange({ ...rule, after: m })} data-first={m}>
                  {firstLabel(m)}
                </button>
              ))}
            </div>
          </div>
        )}
        {!inPlan && (
          <div>
            <Text size="sm" fw={500} mb={6}>
              {t('notify.repeatLabel')}
            </Text>
            <div className="chip-row wrap">
              {EVERY_CHOICES.map((m) => (
                <button key={m} type="button" className="chip" data-active={rule.every === m} onClick={() => onChange({ ...rule, every: m })} data-every={m}>
                  {m === 0 ? t('notify.once') : span(m)}
                </button>
              ))}
            </div>
          </div>
        )}
      </Stack>
    </Modal>
  );
}

/**
 * «Уведомления» (v0.74, the user: «возможность настраивать уведомления под себя, это очень важно»): this device — on,
 * a test; when — the hours and the days; the morning's summary; each thing «Сегодня» knows — said or not, after how
 * long, how often; and the manager's own reminders. Every change is kept at once and the plan on the server follows.
 */
export function NotifyPage() {
  const { t } = useTranslation();
  const { run } = useAction();
  const ruleLine = useRuleLine();
  const data = useScreenLiveQuery(async () => ({ notify: notifyOf((await getSettings()).notify), reminders: await openReminders() }), []);
  const [rule, setRule] = useState<TaskKind | null>(null);
  const [reminder, setReminder] = useState<{ r?: Reminder } | null>(null);
  if (!data) return <PageSkeleton />;
  const s = data.notify;
  const save = (patch: Partial<NotifySettings>) => void run(() => saveNotify(patch));
  const setTime = (key: 'from' | 'to', v: string) => {
    const m = minutesOf(v);
    if (m !== undefined) save({ [key]: key === 'to' && m === 0 ? 1440 : m });
  };
  const toggleDay = (d: number) => {
    const days = s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d];
    // (At least one day: with none, nothing would ever be said — that is the switch above.)
    if (days.length) save({ days });
  };
  const when = (r: Reminder) => {
    const d = dayShort(r.at);
    return `${d.word ? t(`common.${d.word}`) : d.text} · ${dubaiTime(r.at)}`;
  };
  return (
    <>
      <PageHeader title={t('notify.title')} back="/more" />
      <div className="surface notify-card">
        <DeviceCard />
      </div>

      <RowGroup title={t('notify.whenTitle')}>
        <FormRow label={t('notify.all')}>
          <Switch checked={s.on} onChange={(e) => save({ on: e.currentTarget.checked })} aria-label={t('notify.all')} data-notify-on />
        </FormRow>
        {s.on && (
          <>
            {/* A row each (a time field is as wide as the phone's own format makes it — «08:00 AM» does not fit two to a row). */}
            <FormRow label={t('notify.from')}>
              <input type="time" className="time-input" value={clock(s.from)} onChange={(e) => setTime('from', e.currentTarget.value)} aria-label={t('notify.from')} data-notify-from />
            </FormRow>
            <FormRow label={t('notify.to')}>
              <input type="time" className="time-input" value={clock(s.to % 1440)} onChange={(e) => setTime('to', e.currentTarget.value)} aria-label={t('notify.to')} data-notify-to />
            </FormRow>
            <div className="ios-row notify-days" role="group" aria-label={t('notify.days')}>
              {WEEK.map((d) => (
                <button key={d} type="button" className="chip" data-active={s.days.includes(d)} aria-pressed={s.days.includes(d)} onClick={() => toggleDay(d)} data-day={d}>
                  {t(`notify.day.${d}`)}
                </button>
              ))}
            </div>
            <FormRow label={t('notify.digest')}>
              <span className="notify-hours">
                {s.digest.on && <input type="time" className="time-input" value={clock(s.digest.at)} onChange={(e) => minutesOf(e.currentTarget.value) !== undefined && save({ digest: { ...s.digest, on: true, at: minutesOf(e.currentTarget.value)! } })} aria-label={t('notify.digest')} data-notify-digest-at />}
                <Switch checked={s.digest.on} onChange={(e) => save({ digest: { ...s.digest, on: e.currentTarget.checked } })} aria-label={t('notify.digest')} data-notify-digest />
              </span>
            </FormRow>
            {s.digest.on && (
              <FormRow label={t('notify.again')}>
                <span className="notify-hours">
                  {s.digest.again !== null && <input type="time" className="time-input" value={clock(s.digest.again)} onChange={(e) => minutesOf(e.currentTarget.value) !== undefined && save({ digest: { ...s.digest, again: minutesOf(e.currentTarget.value)! } })} aria-label={t('notify.again')} data-notify-again-at />}
                  <Switch checked={s.digest.again !== null} onChange={(e) => save({ digest: { ...s.digest, again: e.currentTarget.checked ? 15 * 60 : null } })} aria-label={t('notify.again')} data-notify-again />
                </span>
              </FormRow>
            )}
          </>
        )}
      </RowGroup>

      {s.on && (
        // v0.97: what happened — at once, with what happened in it.
        <div className="notify-group">
          <div className="group-title">{t('notify.news.title')}</div>
          <List>
            {NEWS_KINDS.map((k) => {
              const m = NEWS_META[k];
              const on = s.news[k];
              return (
                <ListRow
                  key={k}
                  dim={!on}
                  left={
                    <span className="row-icon" style={{ background: `var(--mantine-color-${on ? m.color : 'gray'}-6)` }} aria-hidden>
                      <m.icon size={18} stroke={2.2} />
                    </span>
                  }
                  title={<span data-news={k}>{t(`notify.news.kind.${k}`)}</span>}
                  right={<Switch checked={on} onChange={(e) => save({ news: { ...s.news, [k]: e.currentTarget.checked } })} aria-label={t(`notify.news.kind.${k}`)} data-news-on={k} />}
                />
              );
            })}
          </List>
        </div>
      )}

      {s.on &&
        (['now', 'plan'] as const).map((when) => (
          <div className="notify-group" key={when} data-notify-when={when}>
            <div className="group-title">{t(when === 'now' ? 'notify.nowTitle' : 'notify.planTitle')}</div>
            <List>
              {NOTIFY_KINDS.filter((k) => (s.rules[k].when === 'plan' ? 'plan' : 'now') === when).map((k) => {
                const r = s.rules[k];
                const m = TASK_META[k];
                return (
                  <ListRow
                    key={k}
                    onClick={() => setRule(k)}
                    dim={!r.on}
                    left={
                      <span className="row-icon" style={{ background: `var(--mantine-color-${r.on ? m.color : 'gray'}-6)` }} aria-hidden>
                        <m.icon size={18} stroke={2.2} />
                      </span>
                    }
                    title={<span data-rule={k}>{t(`notify.kind.${k}`)}</span>}
                    // (In the plan — the group's title says it; the plan of the day off — said, it is said nowhere then.)
                    subtitle={r.on ? (r.when === 'plan' ? (s.digest.on ? undefined : t('notify.planOff')) : ruleLine(k, r)) : undefined}
                    right={
                      <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <Switch checked={r.on} onChange={(e) => save({ rules: { ...s.rules, [k]: { ...r, on: e.currentTarget.checked } } })} aria-label={t(`notify.kind.${k}`)} data-rule-on={k} />
                      </span>
                    }
                  />
                );
              })}
            </List>
          </div>
        ))}

      <div className="notify-group">
        <div className="group-title">{t('reminder.list')}</div>
        <List animate>
          {data.reminders.map((r) => (
            <ListRow
              key={r.id}
              onClick={() => setReminder({ r })}
              chevron
              left={
                <span className="row-icon" style={{ background: `var(--mantine-color-${r.at <= new Date().toISOString() ? 'red' : 'cobalt'}-6)` }} aria-hidden>
                  <IconAlarm size={18} stroke={2.2} />
                </span>
              }
              title={r.text}
              subtitle={[when(r), r.repeat ? t(`reminder.repeat.${r.repeat}`) : ''].filter(Boolean).join(' · ')}
            />
          ))}
          <ListRow
            onClick={() => setReminder({})}
            left={
              <span className="row-icon" style={{ background: 'var(--mantine-color-green-6)' }} aria-hidden>
                <IconPlus size={18} stroke={2.4} />
              </span>
            }
            title={
              <Text span inherit c="cobalt.6" fw={600} data-reminder-new>
                {t('reminder.add')}
              </Text>
            }
          />
        </List>
      </div>

      <SheetFor value={rule}>{(k, o) => <RuleSheet kind={k} rule={s.rules[k]} opened={o} onClose={() => setRule(null)} onChange={(r) => save({ rules: { ...s.rules, [k]: r } })} />}</SheetFor>
      <SheetFor value={reminder}>{(v, o) => <ReminderSheet opened={o} onClose={() => setReminder(null)} reminder={v.r} />}</SheetFor>
    </>
  );
}
