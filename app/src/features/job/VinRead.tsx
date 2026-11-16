import { Button, Modal, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconScan } from '@tabler/icons-react';
import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { checkDigitOk, isVin, vinChars, vinYear } from '../../domain/vin';
import type { CarVinRead } from '../../services/vinReader';
import { undoToast } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction } from '../../ui/hooks';
import { LazySheet } from '../../ui/lazy';

/*
 * The VIN read off the car's photos, as the job's card shows it (services/vinReader.ts): it runs by itself after
 * a VIN or Mulkiya photo is taken (or on "Read VIN" in the photo's full view), the photo chips scanning while it
 * reads. A VIN that proved itself goes into the car's card at once ("Undo" beside it). One that did not — or one
 * other than the card's — waits on the VIN chip (an orange dot): a tap shows the line it was read off and the VIN
 * in its 17 places, the doubtful ones marked, to keep or put right.
 */

const reading = new Set<string>();
/** A photo came while the car was being read: read again when this one is done. */
const again = new Set<string>();
const toCheck = new Map<string, CarVinRead>();
const opened = new Set<string>();
const subs = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};
const useStore = () => useSyncExternalStore(subscribe, () => version);

/** The car's VIN reading as its chips show it: being read now; a read waiting to be looked at. */
export function useVinState(vehicleId: string): { reading: boolean; check: boolean } {
  useStore();
  return { reading: reading.has(vehicleId), check: toCheck.has(vehicleId) };
}

/** The sheet with the read waiting to be looked at. */
export function openVinCheck(vehicleId: string) {
  if (!toCheck.has(vehicleId)) return;
  opened.add(vehicleId);
  emit();
}

type T = (key: string, opts?: Record<string, unknown>) => string;

/** Read the car's VIN off its photos (one read at a time per car). `manual` — asked for: it says so when nothing new was read. */
export function readVin(vehicleId: string, t: T, opts: { manual?: boolean } = {}) {
  if (reading.has(vehicleId)) {
    again.add(vehicleId);
    return;
  }
  reading.add(vehicleId);
  emit();
  void (async () => {
    try {
      const { readCarVin, setCarVin } = await import('../../services/vinReader');
      const r = await readCarVin(vehicleId);
      // Still to be looked at: a VIN not proven, or not the card's; a year not proven, or not the card's.
      const vinLook = !!r.vin && !r.filled.includes('vin') && r.vin !== r.before.vin?.toUpperCase();
      const yearLook = !!r.year && !r.filled.includes('year') && r.year !== r.before.year;
      const look = vinLook || yearLook;
      // The newest read stands: one that left nothing to look at takes away what an earlier one left.
      if (look) toCheck.set(vehicleId, r);
      else toCheck.delete(vehicleId);
      emit();
      const open = () => openVinCheck(vehicleId);
      const said = `${t('vinRead.filled')}: ${r.filled.map((k) => (k === 'vin' ? r.vin : r.year)).join(' · ')}`;
      if (r.filled.length) haptic('success');
      // What went in, with "Undo" — or, when something else waits to be looked at, "Open" (the sheet changes both).
      // Read in the background (seconds): it waits its turn behind an undo the user may still want (v0.23.1).
      const later = { replace: false };
      if (r.filled.length && look) undoToast(`${said} · ${t('vinRead.check')}`, t('vinRead.look'), open, later);
      else if (r.filled.length) undoToast(said, t('common.undo'), () => void setCarVin(vehicleId, r.before), later);
      else if (look) undoToast(t(r.differs.vin || r.differs.year ? 'vinRead.differs' : 'vinRead.check'), t('vinRead.look'), open, later);
      else if (opts.manual) notifications.show({ color: r.vin ? 'green' : 'orange', message: t(r.vin ? 'vinRead.same' : 'vinRead.none') });
    } catch (e) {
      console.error(e);
      if (opts.manual) notifications.show({ color: 'red', message: t('vinRead.none') });
    } finally {
      reading.delete(vehicleId);
      emit();
      if (again.delete(vehicleId)) readVin(vehicleId, t);
    }
  })();
}

/** In a VIN or Mulkiya photo's full view: "Read VIN" — or "Check VIN" while a read waits to be looked at. */
export function VinButton({ vehicleId, onLook }: { vehicleId: string; onLook: () => void }) {
  const { t } = useTranslation();
  const s = useVinState(vehicleId);
  if (s.check && !s.reading)
    return (
      <Button
        radius="xl"
        size="compact-md"
        color="orange"
        leftSection={<IconScan size={16} />}
        onClick={() => {
          onLook();
          openVinCheck(vehicleId);
        }}
      >
        {t('vinRead.checkBtn')}
      </Button>
    );
  return (
    <Button radius="xl" size="compact-md" variant="white" color="dark" loading={s.reading} leftSection={<IconScan size={16} />} onClick={() => readVin(vehicleId, t, { manual: true })}>
      {t('vinRead.read')}
    </Button>
  );
}

/** The VIN in its 17 places, the doubtful ones marked — to compare with the photo at a glance. */
function VinBoxes({ vin, doubt }: { vin: string; doubt: number[] }) {
  return (
    <div className="vin-boxes" aria-hidden>
      {[...vin.padEnd(17, ' ')].slice(0, 17).map((c, i) => (
        <span key={i} data-doubt={doubt.includes(i) || undefined} data-gap={i === 3 || i === 9 ? true : undefined}>
          {c.trim()}
        </span>
      ))}
    </div>
  );
}

/**
 * The sheet a read VIN is looked at on: the line of the photo it was read off, the VIN under it — right: "Save";
 * a character wrong: typed over, then "Save". Closed without saving, the read is let go (read again in a moment:
 * each photo is read once).
 */
export function VinCheckSheet({ vehicleId, current }: { vehicleId: string; current: { vin?: string; year?: number } }) {
  useStore();
  const open = opened.has(vehicleId) && toCheck.has(vehicleId);
  return <LazySheet opened={open}>{(o) => <CheckSheet vehicleId={vehicleId} current={current} opened={o} />}</LazySheet>;
}

function CheckSheet({ vehicleId, current, opened: open }: { vehicleId: string; current: { vin?: string; year?: number }; opened: boolean }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  // The read as it was when the sheet opened: it stays on the sheet while the sheet slides away.
  const [r, setR] = useState<CarVinRead>();
  const [vin, setVin] = useState('');
  const [year, setYear] = useState('');
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    const now = toCheck.get(vehicleId);
    if (open && now) {
      setR(now);
      const v = now.vin ?? current.vin ?? '';
      setVin(v);
      // The year read, else the card's, else the one a VIN that adds up tells.
      setYear(String(now.year ?? current.year ?? (checkDigitOk(v) ? (vinYear(v) ?? '') : '')));
    }
  }
  const close = () => {
    opened.delete(vehicleId);
    toCheck.delete(vehicleId);
    emit();
  };
  const typed = vinChars(vin).slice(0, 17);
  const ok = isVin(typed);
  const y = Number(year);
  const yearOk = !year || (y >= 1970 && y <= new Date().getFullYear() + 1);
  const canSave = (ok || !typed) && yearOk && (ok || !!year);
  return (
    <Modal opened={open} onClose={close} title={t('vinRead.title')}>
      {r && (
        <Stack gap="md">
          {r.crop && <img className="vin-crop" src={r.crop} alt="" />}
          <VinBoxes vin={typed} doubt={typed === r.vin ? r.doubt : []} />
          <TextInput
            aria-label="VIN"
            value={vin}
            onChange={(e) => setVin(e.currentTarget.value.toUpperCase())}
            maxLength={20}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            rightSection={ok && checkDigitOk(typed) ? <IconCheck size={18} color="var(--mantine-color-green-6)" aria-label={t('vinRead.adds')} /> : undefined}
            classNames={{ input: 'vin-input' }}
          />
          <TextInput label={t('vehicle.year')} value={year} onChange={(e) => setYear(e.currentTarget.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" error={!yearOk} />
          {current.vin && current.vin.toUpperCase() !== typed && (
            <Text c="dimmed" fz={15}>
              {t('vinRead.inCard')}: <span className="vin-text">{current.vin}</span>
            </Text>
          )}
          <Button
            fullWidth
            size="md"
            loading={busy}
            disabled={!canSave}
            onClick={() =>
              run(async () => {
                const { setCarVin } = await import('../../services/vinReader');
                await setCarVin(vehicleId, { vin: ok ? typed : current.vin, year: year ? y : current.year });
                close();
                haptic('success');
              }, 'common.saved')
            }
          >
            {t('common.save')}
          </Button>
        </Stack>
      )}
    </Modal>
  );
}
