import { Button, Loader, Modal, Stack, Switch, Text, TextInput } from '@mantine/core';
import { IconCloud, IconCloudOff, IconPhoto, IconRefresh } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dayShort, formatDateTime } from '../../domain/dates';
import { parseAddress, SyncError } from '../../services/sync/api';
import { setOffload, useSync } from '../../services/sync/config';
import { changeServerAddress, forgetSync, pairDevice, sendLocalData, syncNow, takeServerData } from '../../services/sync/engine';
import { ConfirmModal, FormRow, RowGroup } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { formatBytes } from '../../ui/device';
import { useLang } from '../../ui/hooks';
import { LazySheet } from '../../ui/lazy';

/*
 * «Настройки → Данные → Сервер» (v0.40): this device paired with the garage's server on the computer — the address and
 * the code its page shows; then how syncing stands, the photos kept there and the space they freed here, «Освобождать
 * память» (originals leave the phone), «Отключить».
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

function useErrorText() {
  const { t } = useTranslation();
  return (e: unknown) => {
    const s = e instanceof SyncError ? e : null;
    if (s?.message === 'address') return t('sync.err.address');
    if (s?.message === 'code') return t('sync.err.code');
    if (s?.status === 403) return t('sync.err.wrongCode');
    if (s?.status === 429) return t('sync.err.tooMany');
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
  const [both, setBoth] = useState(false);
  const pair = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await pairDevice(address, code, deviceName());
      haptic('success');
      if (!r.server) {
        // The first device: everything here goes to the server.
        onClose();
        void sendLocalData();
      } else if (!r.local) {
        onClose();
        void takeServerData();
      } else setBoth(true);
    } catch (e) {
      haptic('error');
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Modal opened={opened && !both} onClose={onClose} title={t('sync.connect')}>
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
        opened={both}
        onClose={() => {
          // Not taken: not paired either (nothing was sent).
          if (both) forgetSync();
          setBoth(false);
          onClose();
        }}
        title={t('sync.takeTitle')}
        confirmLabel={t('sync.take')}
        color="red"
        onConfirm={async () => {
          setBoth(false);
          onClose();
          void takeServerData();
          return true;
        }}
      >
        <Text size="sm">{t('sync.takeText')}</Text>
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
  const errors: Record<string, string> = { offline: t('sync.err.offline'), revoked: t('sync.err.revoked') };
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
  const status = state.busy ? t('sync.syncing') : state.lastError ? (errors[state.lastError] ?? t('sync.err.other', { message: state.lastError })) : when;
  return (
    <>
      <RowGroup title={t('sync.title')} mt={0} note={state.pending ? t('sync.pending', { count: state.pending }) : undefined}>
        <FormRow label={t('sync.server')} onClick={() => setMoving(true)} chevron>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {state.lastError ? <IconCloudOff size={18} color="var(--mantine-color-orange-6)" /> : <IconCloud size={18} color="var(--mantine-color-green-6)" />}
            <Text truncate size="sm" c="dimmed" data-sync-host>
              {host}
            </Text>
          </span>
        </FormRow>
        <FormRow label={t('sync.status')}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Text size="sm" c={state.lastError ? 'orange' : 'dimmed'} data-sync-status>
              {status}
            </Text>
            <Button size="compact-sm" variant="light" leftSection={state.busy ? <Loader size={14} /> : <IconRefresh size={15} />} disabled={state.busy} onClick={() => void syncNow()}>
              {t('sync.now')}
            </Button>
          </span>
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
