import { Button, Loader, Modal, Stack, Switch, Text, TextInput } from '@mantine/core';
import { IconCloud, IconCloudOff, IconPhoto, IconRefresh } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dayShort, formatDateTime } from '../../domain/dates';
import { aiStatus } from '../../services/ai';
import { parseAddress, SyncError } from '../../services/sync/api';
import { setOffload, useSync } from '../../services/sync/config';
import { cancelPairing, changeServerAddress, finishPairing, forgetSync, makeMain, pairDevice, syncNow, type Pairing } from '../../services/sync/engine';
import { ConfirmModal, FormRow, RowGroup } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { formatBytes } from '../../ui/device';
import { useLang } from '../../ui/hooks';
import { LazySheet } from '../../ui/lazy';
import { AiMark } from '../ai/Ai';

/*
 * «Настройки → Данные → Сервер» (v0.40): this device paired with the garage's server on the computer — the address and
 * the code its page shows; then how syncing stands, the photos kept there and the space they freed here, «Освобождать
 * память» (originals leave the phone), «Отключить».
 *
 * The phone is the main device (v0.41.1, the user's rule): a phone with data, connecting, makes its data the garage's
 * (the server's and the other devices' replaced); a computer with data, connecting to a garage that has data, takes it.
 * Nothing is synced before the choice; two sets of data are never mixed.
 */

/** What this device is called on the server's page. */
function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad|Macintosh.*Mobile/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Mac OS X/.test(ua)) return 'Mac';
  return 'Device';
}
/** A phone (or a tablet): its data may become the garage's. */
const mobile = (name: string) => /^(iPhone|iPad|Android)$/.test(name);

function useErrorText() {
  const { t } = useTranslation();
  return (e: unknown) => {
    const s = e instanceof SyncError ? e : null;
    if (s?.message === 'address') return t('sync.err.address');
    if (s?.message === 'code') return t('sync.err.code');
    if (s?.status === 403) return t('sync.err.wrongCode');
    if (s?.status === 429) return t('sync.err.tooMany');
    if (s?.status === 426) return t('sync.err.update');
    if (s?.status === 0) return t('sync.err.offline');
    return t('sync.err.other', { message: (e as Error)?.message ?? String(e) });
  };
}

function PairSheet({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** Both have data: this phone's may become the garage's, or this device takes the garage's. */
  const [ask, setAsk] = useState<{ canMain: boolean } | null>(null);
  // Paired, the choice not made: kept here, not in state — a sheet closing after the choice must not see it as cancelled.
  const pending = useRef<Pairing | null>(null);
  const finish = (how: 'send' | 'main' | 'take') => {
    const p = pending.current;
    pending.current = null;
    setAsk(null);
    onClose();
    if (p) void finishPairing(p, how);
  };
  const pair = async () => {
    setBusy(true);
    setError('');
    try {
      const name = deviceName();
      const r = await pairDevice(address, code, name);
      pending.current = r;
      haptic('success');
      // An empty server: this device's data goes there (a phone's becomes the garage's — the main one).
      if (!r.server) finish(mobile(name) && r.local ? 'main' : 'send');
      else if (!r.local) finish('take');
      // The same app connected again: it stays what it was; its data and the garage's are put together.
      else if (r.rejoined) finish('send');
      else setAsk({ canMain: mobile(name) && !r.main });
    } catch (e) {
      haptic('error');
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Modal opened={opened && !ask} onClose={onClose} title={t('sync.connect')}>
        <Stack gap="md">
          <TextInput
            label={t('sync.address')}
            placeholder="https://….ts.net"
            value={address}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setAddress(v);
              // The server page's link carries its code: both fields at once.
              const c = parseAddress(v).code;
              if (c) setCode(c);
            }}
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="url"
          />
          <TextInput label={t('sync.code')} placeholder="000000" value={code} onChange={(e) => setCode(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" />
          {error && (
            <Text c="red" size="sm">
              {error}
            </Text>
          )}
          <Button size="lg" loading={busy} disabled={!address.trim() || code.length !== 6} onClick={() => void pair()}>
            {t('sync.connect')}
          </Button>
        </Stack>
      </Modal>
      <ConfirmModal
        opened={!!ask}
        onClose={() => {
          // Closed without a choice: not connected (nothing was sent), the server forgets this device.
          if (pending.current) cancelPairing(pending.current);
          pending.current = null;
          setAsk(null);
          onClose();
        }}
        title={t('sync.takeTitle')}
        confirmLabel={ask?.canMain ? t('sync.mainAsk') : t('sync.take')}
        color={ask?.canMain ? undefined : 'red'}
        secondary={
          ask?.canMain
            ? {
                label: t('sync.take'),
                color: 'red',
                onClick: async () => {
                  finish('take');
                  return true;
                },
              }
            : undefined
        }
        onConfirm={async () => {
          finish(ask?.canMain ? 'main' : 'take');
          return true;
        }}
      >
        <Text size="sm">{ask?.canMain ? t('sync.mainText') : t('sync.takeText')}</Text>
      </ConfirmModal>
    </>
  );
}

/** The server's new address (the same server: this device keeps its key). */
function AddressSheet({ opened, onClose, current }: { opened: boolean; onClose: () => void; current: string }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [address, setAddress] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal opened={opened} onClose={onClose} title={t('sync.address')}>
      <Stack gap="md">
        <TextInput aria-label={t('sync.address')} placeholder="https://…" value={address} onChange={(e) => setAddress(e.currentTarget.value)} autoCapitalize="none" autoCorrect="off" inputMode="url" />
        {error && (
          <Text c="red" size="sm">
            {error}
          </Text>
        )}
        <Button
          size="lg"
          loading={busy}
          disabled={!address.trim()}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await changeServerAddress(address);
              haptic('success');
              onClose();
            } catch (e) {
              setError(e instanceof SyncError && e.status === 401 ? t('sync.err.revoked') : errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('common.save')}
        </Button>
      </Stack>
    </Modal>
  );
}

export function ServerCard() {
  const { t } = useTranslation();
  const lang = useLang();
  const { config, state, offload } = useSync();
  const [pairing, setPairing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [moving, setMoving] = useState(false);
  const [making, setMaking] = useState(false);
  const [mainWord, setMainWord] = useState('');
  // The garage's AI (v0.48): on the server or not.
  const [ai, setAi] = useState<Awaited<ReturnType<typeof aiStatus>>>();
  useEffect(() => {
    if (config?.url) void aiStatus().then(setAi);
  }, [config?.url]);
  // Only what the person must put right is said (v0.42.1): no network, the server starting again — tried again quietly.
  const errors: Record<string, string> = { revoked: t('sync.err.revoked'), main: t('sync.err.main'), update: t('sync.err.update') };
  if (!config)
    return (
      <>
        <RowGroup title={t('sync.title')} mt={0}>
          <FormRow label={t('sync.server')} onClick={() => setPairing(true)} chevron>
            <Text c="dimmed">{t('sync.notConnected')}</Text>
          </FormRow>
        </RowGroup>
        <LazySheet opened={pairing}>{(o) => <PairSheet opened={o} onClose={() => setPairing(false)} />}</LazySheet>
      </>
    );
  const host = config.url.replace(/^https?:\/\//, '');
  const last = state.lastAt ? dayShort(state.lastAt) : undefined;
  const when = state.lastAt ? (last?.word ? `${t(`common.${last.word}`)} ${formatDateTime(state.lastAt).slice(11)}` : formatDateTime(state.lastAt)) : t('sync.never');
  // The stream open (v0.41.2): other devices' changes come the moment they are made — «На связи».
  const problem = state.lastError ? errors[state.lastError] : undefined;
  const status = problem ?? (state.live ? t('sync.live') : state.busy ? t('sync.syncing') : when);
  const isMain = !!state.main && state.main.id === config.deviceId;
  // A phone may make its data the garage's while there is no main device (or it is the main one: sent again).
  const mayMain = mobile(config.deviceName) && (!state.main || isMain);
  return (
    <>
      <RowGroup title={t('sync.title')} mt={0} note={state.pending ? t('sync.pending', { count: state.pending }) : undefined}>
        <FormRow label={t('sync.server')} onClick={() => setMoving(true)} chevron>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {problem ? <IconCloudOff size={18} color="var(--mantine-color-orange-6)" /> : <IconCloud size={18} color={state.live ? 'var(--mantine-color-green-6)' : 'var(--mantine-color-dimmed)'} />}
            <Text truncate size="sm" c="dimmed" data-sync-host>
              {host}
            </Text>
          </span>
        </FormRow>
        <FormRow label={t('sync.status')}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Text size="sm" c={problem ? 'orange' : state.live ? 'green' : 'dimmed'} data-sync-status>
              {status}
            </Text>
            <Button size="compact-sm" variant="light" leftSection={state.busy ? <Loader size={14} /> : <IconRefresh size={15} />} disabled={state.busy} onClick={() => void syncNow()}>
              {t('sync.now')}
            </Button>
          </span>
        </FormRow>
        <FormRow label={t('sync.main')} onClick={mayMain ? () => setMaking(true) : undefined} chevron={mayMain}>
          <Text size="sm" c={isMain ? 'green' : 'dimmed'} data-sync-main>
            {isMain ? t('sync.thisDevice') : (state.main?.name ?? '—')}
          </Text>
        </FormRow>
        <FormRow
          label={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <AiMark size={20} />
              {t('ai.status')}
            </span>
          }
        >
          <Text size="sm" c={!ai?.on ? 'dimmed' : 'green'} data-ai-status>
            {!ai ? '…' : !ai.on ? t('ai.off') : 'Gemini'}
          </Text>
        </FormRow>
        <FormRow label={t('sync.photos')}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconPhoto size={17} color="var(--mantine-color-cobalt-6)" />
            <Text size="sm" c="dimmed">
              {(state.uploaded ?? 0).toLocaleString(lang)}
              {state.freedBytes ? ` · ${t('sync.freed', { size: formatBytes(state.freedBytes, lang) })}` : ''}
            </Text>
          </span>
        </FormRow>
        <FormRow label={t('sync.offload')}>
          <Switch checked={offload} onChange={(e) => setOffload(e.currentTarget.checked)} aria-label={t('sync.offload')} />
        </FormRow>
        <FormRow onClick={() => setLeaving(true)}>
          <Text c="red" size="md" style={{ width: '100%', textAlign: 'left' }}>
            {t('sync.disconnect')}
          </Text>
        </FormRow>
      </RowGroup>
      <LazySheet opened={moving}>{(o) => <AddressSheet opened={o} current={config.url} onClose={() => setMoving(false)} />}</LazySheet>
      <ConfirmModal
        opened={making}
        onClose={() => (setMaking(false), setMainWord(''))}
        title={t('sync.mainTitle')}
        confirmLabel={t('sync.mainMake')}
        color="red"
        waiting={mainWord.trim().toUpperCase() !== t('sync.mainWord')}
        onConfirm={async () => {
          void makeMain();
          setMainWord('');
          return true;
        }}
      >
        <Text size="sm">{t('sync.mainText')}</Text>
        <TextInput mt="md" aria-label={t('sync.mainWordAsk', { word: t('sync.mainWord') })} placeholder={t('sync.mainWord')} description={t('sync.mainWordAsk', { word: t('sync.mainWord') })} value={mainWord} onChange={(e) => setMainWord(e.currentTarget.value)} autoCapitalize="characters" autoComplete="off" data-main-word />
      </ConfirmModal>
      <ConfirmModal
        opened={leaving}
        onClose={() => setLeaving(false)}
        title={t('sync.disconnectTitle')}
        confirmLabel={t('sync.disconnect')}
        color="red"
        onConfirm={async () => {
          forgetSync();
          return true;
        }}
      >
        <Text size="sm">{t('sync.disconnectText')}</Text>
      </ConfirmModal>
    </>
  );
}
