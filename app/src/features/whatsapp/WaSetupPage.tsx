import { Button, Loader, Stack, Switch, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBrandWhatsapp, IconCheck, IconCopy, IconHistory, IconLinkOff, IconRefresh, IconRobot } from '@tabler/icons-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { formatPhone } from '../../domain/phone';
import { waDigits, type WaStatus } from '../../domain/whatsapp';
import { olderFromPhone, onStudyProgress, phoneHistoryChats, studyProgress } from '../../services/chatStudy';
import { getSettings } from '../../services/settings';
import { linkWa, linkWaCode, restartWa, setWaPrefs, unlinkWa, useWaPrefs, waCan } from '../../services/whatsapp';
import { useWaStatus } from '../../ui/waSel';
import { copyText } from '../../ui/clipboard';
import { ConfirmModal, FormRow, List, ListRow, PageHeader, RowGroup, ScrollTabs } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, usePhone, useScreenLiveQuery } from '../../ui/hooks';
import { WaGate } from './WhatsAppPage';

/*
 * «WhatsApp → Настройка» (v0.78, the user: «профессиональная панель настройки WhatsApp»): the garage's server as a
 * linked device of the garage's WhatsApp. Where it stands, in a line and a colour; linking — by the QR (from another
 * screen: the computer's) or by a code typed on the phone (the phone that has WhatsApp cannot scan its own screen);
 * how it behaves on this device; starting it again; unlinking. Nothing here talks to WhatsApp: the server does.
 */

const PHASE_COLOR: Record<WaStatus['phase'], string> = { off: 'gray', starting: 'orange', qr: 'orange', loading: 'orange', ready: 'green', offline: 'red' };
/** The phone the account lives on, as WhatsApp names it. */
const PLATFORM: Record<string, string> = { iphone: 'iPhone', smbi: 'iPhone · Business', android: 'Android', smba: 'Android · Business' };

/**
 * «История с телефона» (v0.91.1, the owner: «много чатов, более ранние истории которых не загружаются — что сделать, чтобы
 * ИИ посмотрел абсолютно все истории»): this computer's WhatsApp Web has a chat's messages since it was linked; the older
 * ones are on the phone, which gives them when asked — with WhatsApp open on it, and only as far as it lets this linked
 * device (Linked devices → this device → Chat history → «All chat history»). How many chats have them there, the two steps on
 * the phone, the button; what came, or that the phone did not answer.
 */
function PhoneHistory() {
  const { t } = useTranslation();
  const left = useScreenLiveQuery(phoneHistoryChats, []);
  const going = useSyncExternalStore(onStudyProgress, studyProgress);
  const [busy, setBusy] = useState(false);
  const running = busy || (going.running && going.kind === 'phone');
  const ask = () => {
    setBusy(true);
    haptic('light');
    void olderFromPhone()
      .then((r) => {
        if (r.stopped === 'silent' && !r.ok) notifications.show({ color: 'orange', autoClose: 9000, message: t('wa.history.silent') });
        else if (r.stopped === 'paused') notifications.show({ color: 'orange', message: t('wa.history.paused') });
        else notifications.show({ color: r.ok ? 'green' : 'gray', message: t('wa.history.done', { chats: r.ok, turns: r.turns }) });
      })
      .catch(() => notifications.show({ color: 'red', message: t('wa.history.error') }))
      .finally(() => setBusy(false));
  };
  return (
    <RowGroup title={t('wa.history.title')} note={t('wa.history.note')}>
      <FormRow label={t('wa.history.left')}>
        <Text className="tnum" data-wa-history-left>
          {left ?? '…'}
        </Text>
      </FormRow>
      <Steps lines={[t('wa.history.step1'), t('wa.history.step2')]} />
      <div style={{ padding: '4px 16px 14px' }}>
        <Button fullWidth leftSection={<IconHistory size={18} />} loading={running} disabled={!left} onClick={ask} data-wa-history-ask>
          {running && going.kind === 'phone' && going.total ? t('wa.study.phone', { done: going.done, total: going.total }) : t('wa.history.ask')}
        </Button>
      </div>
    </RowGroup>
  );
}

function Steps({ lines }: { lines: string[] }) {
  return (
    <ol className="wa-steps">
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ol>
  );
}

/** Waiting to be linked: the QR to scan, or the code to type — and how, in three lines. */
function Linking({ st }: { st: WaStatus }) {
  const { t } = useTranslation();
  const phone = usePhone();
  const { run, busy } = useAction({ exclusive: true });
  // A phone cannot scan its own screen: the code first there; a computer shows the QR.
  const [way, setWay] = useState<'qr' | 'code'>(phone ? 'code' : 'qr');
  const garage = useScreenLiveQuery(() => getSettings(), []);
  const [number, setNumber] = useState('');
  useEffect(() => {
    if (garage?.phone && !number) setNumber(garage.phone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [garage?.phone]);
  const digits = waDigits(number);
  const code = st.code ? `${st.code.slice(0, 4)}-${st.code.slice(4)}`.replace(/-$/, '').replace(/--/, '-') : '';
  return (
    <div className="surface wa-link" data-wa-linking>
      <ScrollTabs segmented value={way} onChange={(v) => setWay(v as 'qr' | 'code')} items={[{ value: 'qr', label: t('wa.byQr') }, { value: 'code', label: t('wa.byCode') }]} mb="md" />
      {way === 'qr' ? (
        <Stack align="center" gap="md">
          {st.qr ? <img className="wa-qr" src={st.qr} alt="QR" data-wa-qr /> : <Loader />}
          <Steps lines={[t('wa.qrStep1'), t('wa.qrStep2'), t('wa.qrStep3')]} />
        </Stack>
      ) : (
        <Stack gap="md">
          {code ? (
            <>
              <button
                type="button"
                className="wa-code tap"
                aria-label={t('common.copy')}
                onClick={() => void copyText(st.code).then((ok) => ok && (haptic('selection'), notifications.show({ color: 'green', message: t('common.copied'), icon: <IconCheck size={18} stroke={2.6} /> })))}
                data-wa-code
              >
                <span className="tnum">{code}</span>
                <IconCopy size={20} stroke={2} aria-hidden />
              </button>
              <Steps lines={[t('wa.codeStep1'), t('wa.codeStep2'), t('wa.codeStep3')]} />
            </>
          ) : (
            <>
              <TextInput label={t('wa.codePhone')} value={number} onChange={(e) => setNumber(e.currentTarget.value)} inputMode="tel" autoComplete="tel" placeholder="+971 50 123 4567" data-wa-code-phone />
              <Button fullWidth size="md" color="green" disabled={!digits} loading={busy} onClick={() => void run(() => linkWaCode(digits))} data-wa-code-get>
                {t('wa.getCode')}
              </Button>
            </>
          )}
        </Stack>
      )}
    </div>
  );
}

export function WaSetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const s = useWaStatus();
  const prefs = useWaPrefs();
  const { run, busy } = useAction({ exclusive: true });
  const [unlinking, setUnlinking] = useState(false);
  const st = s.status;
  const usable = waCan() && !s.old && !!st && st.installed && st.browser;

  if (!usable)
    return (
      <>
        <PageHeader title={t('wa.setup')} eyebrow="WhatsApp" back="/whatsapp" />
        <WaGate s={s} />
      </>
    );

  const phase = st.phase;
  const waiting = phase === 'starting' || phase === 'loading';
  return (
    <>
      <PageHeader title={t('wa.setup')} eyebrow="WhatsApp" back="/whatsapp" />
      <div className="surface wa-state" data-wa-state={phase}>
        <span className="row-icon wa-state-icon" style={{ background: `var(--mantine-color-${PHASE_COLOR[phase]}-6)` }} aria-hidden>
          <IconBrandWhatsapp size={22} stroke={2} />
        </span>
        <div className="wa-state-body">
          <Text fw={600} lh={1.3}>
            {t(`wa.state.${phase}`)}
            {phase === 'loading' && st.loading ? ` ${st.loading} %` : ''}
          </Text>
          <Text size="sm" c="dimmed" lh={1.35} className="tnum">
            {st.linked && st.me ? [formatPhone(`+${st.me.phone}`), st.me.name].filter(Boolean).join(' · ') : t('wa.deviceHint')}
          </Text>
        </div>
        {waiting && <Loader size="sm" />}
      </div>

      {phase === 'off' && (
        <Button fullWidth size="md" color="green" mt="md" loading={busy || s.busy} leftSection={<IconBrandWhatsapp size={20} />} onClick={() => void run(() => linkWa())} data-wa-link>
          {t('wa.gate.link')}
        </Button>
      )}
      {phase === 'qr' && <Linking st={st} />}
      {phase === 'qr' && (
        <Button fullWidth variant="subtle" color="gray" mt="sm" loading={busy} onClick={() => void run(() => unlinkWa())}>
          {t('common.cancel')}
        </Button>
      )}

      {phase === 'ready' && (
        <RowGroup title={t('wa.device')}>
          <FormRow label={t('wa.chats')}>
            <Text className="tnum">{st.chats}</Text>
          </FormRow>
          {st.platform && (
            <FormRow label={t('wa.phone')}>
              <Text>{PLATFORM[st.platform] ?? st.platform}</Text>
            </FormRow>
          )}
          {st.web && (
            <FormRow label="WhatsApp Web">
              <Text className="tnum" c="dimmed">
                {st.web}
              </Text>
            </FormRow>
          )}
        </RowGroup>
      )}

      <RowGroup title={t('wa.options')} note={t('wa.optionsNote')}>
        <FormRow label={t('wa.optDirect')}>
          <Switch checked={prefs.direct} onChange={(e) => setWaPrefs({ direct: e.currentTarget.checked })} aria-label={t('wa.optDirect')} data-wa-opt="direct" />
        </FormRow>
        <FormRow label={t('wa.optSeen')}>
          <Switch checked={prefs.seen} onChange={(e) => setWaPrefs({ seen: e.currentTarget.checked })} aria-label={t('wa.optSeen')} data-wa-opt="seen" />
        </FormRow>
      </RowGroup>

      {phase === 'ready' && <PhoneHistory />}

      {/* What WhatsApp says by itself (v0.79): reports, the boss, the wash, suppliers. */}
      <div className="notify-group">
        <List>
          <ListRow
            data-route={'/whatsapp/auto'} onClick={() => navigate('/whatsapp/auto')}
            chevron
            left={
              <span className="row-icon" style={{ background: 'var(--mantine-color-green-6)' }} aria-hidden>
                <IconRobot size={19} stroke={2} />
              </span>
            }
            title={<span data-wa-auto-link>{t('wa.auto.title')}</span>}
            subtitle={t('wa.auto.hint')}
          />
        </List>
      </div>

      {st.on && phase !== 'qr' && (
        <div className="notify-group">
          <List>
            {st.linked && (
              <ListRow
                onClick={() => void run(() => restartWa(), 'wa.restarted')}
                left={
                  <span className="row-icon" style={{ background: 'var(--mantine-color-cobalt-6)' }} aria-hidden>
                    <IconRefresh size={19} stroke={2} />
                  </span>
                }
                title={<span data-wa-restart>{t('wa.restart')}</span>}
              />
            )}
            <ListRow
              onClick={() => setUnlinking(true)}
              left={
                <span className="row-icon" style={{ background: 'var(--mantine-color-red-6)' }} aria-hidden>
                  <IconLinkOff size={19} stroke={2} />
                </span>
              }
              title={
                <Text span inherit c="red.6" data-wa-unlink>
                  {t('wa.unlink')}
                </Text>
              }
            />
          </List>
        </div>
      )}
      <Text size="sm" c="dimmed" mt="lg" px={4}>
        {t('wa.where')}
      </Text>

      <ConfirmModal
        opened={unlinking}
        onClose={() => setUnlinking(false)}
        title={t('wa.unlinkTitle')}
        confirmLabel={t('wa.unlink')}
        color="red"
        onConfirm={async () => {
          await run(() => unlinkWa());
          setUnlinking(false);
        }}
      >
        {t('wa.unlinkText')}
      </ConfirmModal>
    </>
  );
}
