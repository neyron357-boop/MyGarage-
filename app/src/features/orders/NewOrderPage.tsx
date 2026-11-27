import { ActionIcon, Autocomplete, Box, Button, Group, Loader, Stack, Switch, Text, Textarea, TextInput } from '@mantine/core';
import { IconAlertTriangle, IconCamera, IconCameraOff, IconCar, IconCheck, IconKeyboard, IconRestore, IconScan, IconUser, IconX } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import { CAR_MAKES, canonicalMake, canonicalModel, modelsFor, POPULAR_MAKES } from '../../domain/carCatalog';
import { dubaiDate, nowIso } from '../../domain/dates';
import { formatPhone } from '../../domain/phone';
import { EMIRATES } from '../../domain/plates';
import { checkDigitOk, isVin, vinChars } from '../../domain/vin';
import type { VinCar } from '../../domain/vinDecode';
import type { Customer, Emirate, Lang, Order, Plate, Vehicle } from '../../domain/types';
import { findVehicleForCheckIn, findVehiclesByNumber, plateHabits, popularMakes, popularModels, suggestCustomers, type CheckInCar } from '../../services/customers';
import { NUMERIC_CODES, type PlateHabits } from '../../domain/plateHabits';
import { parseKm } from '../../domain/odometer';
import { setJobMileage } from '../../services/mileage';
import { clearNewOrderDraft, readNewOrderDraft, saveNewOrderDraft, type NewOrderDraft } from '../../ui/newOrderDraft';
import { setCover, setVinPhoto } from '../../services/cover';
import { decodeVin } from '../../services/vinDecode';
import { checkIn } from '../../services/orders';
import { carDriver, type DriverDraft } from '../../services/drivers';
import { DriverFields, PickedDriver } from '../job/Driver';
import type { PlateFound } from '../../services/plateReader';
import { haptic } from '../../ui/haptics';
import { usePhotoPick } from '../../ui/photoPick';
import { dropCarShot, heldCarShot, heldPlate } from './carShot';
import { DocImportButton } from './DocImport';
import { FormRow, PageHeader, PlateText, RowGroup, StickyBar } from '../../ui/components';
import { CarThumb } from '../job/CarCover';
import { PrevVisit } from '../job/PrevVisit';
import { DateTimeField, DayPill } from '../../ui/DateFields';
import { typedOnly, useAction, useLang, usePhone, useSettings } from '../../ui/hooks';
import { DeskSplit } from '../../ui/desk';
import { useTypedValue } from '../../ui/typedValue';
import { carCheckOf, photoFill, sameMake, type PhotoCar, type VinSaid } from '../../domain/carPhoto';
import { askCarCheck, CAR_PHOTO_WORK, carPhotoLater, guessCar, takePhotoCar } from '../../services/carPhoto';
import { AiMark, useAiWorking } from '../ai/Ai';
import { CarChoice } from '../ai/CarCheck';

// v0.99 (audit П10): the emirate most of the garage's cars come from — kept here to be there at once; the last one typed
// was the default before, and one Sharjah car made the next Dubai car Sharjah, unseen.
const LAST_EMIRATE = 'mygarage.usualEmirate';

function lastEmirate(): Emirate {
  try {
    const e = localStorage.getItem(LAST_EMIRATE);
    if (e && EMIRATES.some((x) => x.code === e)) return e as Emirate;
  } catch {
    // storage unavailable
  }
  return 'DXB';
}


/** A customer with no name yet is shown by phone, or as "no name". */
function who(c: Customer | undefined, noName: string): string {
  if (!c) return '';
  return [c.name || noName, c.phone ? formatPhone(c.phone) : ''].filter(Boolean).join(' · ');
}

/**
 * Big UAE plate: emirate chips, code and number, live preview. The number is the one thing check-in needs. Read off a
 * photo (v0.28), what the reading was not sure of is ringed orange until it is typed over; the camera (a hold — the
 * phone's photos) reads it off a photo. Typed, it is drawn here at once and the page hears of it without hurry
 * (v0.89, `useTypedValue`): a key never waits for the whole page to be drawn again.
 */
function PlateBlock({
  plate: page,
  onChange,
  unsure,
  focus,
  camera,
  codes,
  usual,
  onEnter,
  children,
}: {
  plate: Plate;
  onChange: (p: Plate) => void;
  unsure?: { code: boolean; number: boolean };
  focus: boolean;
  camera?: ReactNode;
  /** The garage's frequent codes of this emirate (v0.99, audit П8): one tap, the keyboard stays. */
  codes?: string[];
  /** The garage's usual emirate: another one chosen is orange — seen, not slipped in. */
  usual?: Emirate;
  /** Enter in the number (a PC): «Принять». */
  onEnter?: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const [plate, setPlate] = useTypedValue(page, onChange);
  const numberRef = useRef<HTMLInputElement>(null);
  return (
    <Box className="surface" p="md" pos="relative">
      {camera}
      <Box ta="center" mb="md" mt={4}>
        {plate.number ? (
          <PlateText plate={plate} size="xl" />
        ) : (
          <span className="plate xl" style={{ opacity: 0.28 }} aria-hidden>
            <span className="em">{EMIRATES.find((e) => e.code === plate.emirate)?.en}</span>
            <span className="code">A</span>
            <span className="num">12345</span>
          </span>
        )}
      </Box>
      <div className="chip-row" role="radiogroup" aria-label={t('vehicle.emirate')}>
        {EMIRATES.map((e) => (
          <button
            key={e.code}
            type="button"
            className="chip"
            role="radio"
            aria-checked={plate.emirate === e.code}
            data-active={plate.emirate === e.code}
            data-odd={(plate.emirate === e.code && !!usual && e.code !== usual) || undefined}
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => setPlate({ ...plate, emirate: e.code })}
          >
            {e[lang]}
          </button>
        ))}
      </div>
      <Group gap="sm" mt="sm" wrap="nowrap" align="flex-start">
        <TextInput
          aria-label={t('vehicle.plateCode')}
          placeholder={t('vehicle.plateCode')}
          value={plate.code}
          onChange={(e) => setPlate({ ...plate, code: e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
          maxLength={3}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          // Abu Dhabi's and Sharjah's codes are numbers: the number pad (v0.99, audit П9). «Далее» — the number.
          inputMode={NUMERIC_CODES.includes(plate.emirate) ? 'numeric' : undefined}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            numberRef.current?.focus();
          }}
          autoComplete="off"
          size="lg"
          classNames={{ input: unsure?.code ? 'plate-unsure' : undefined }}
          style={{ flex: '0 0 96px' }}
          styles={{ input: { fontFamily: 'var(--font-plate)', fontSize: 24, textAlign: 'center', fontWeight: 600 } }}
        />
        <TextInput
          aria-label={t('vehicle.plateNumber')}
          placeholder={t('vehicle.plateNumber')}
          value={plate.number}
          onChange={(e) => setPlate({ ...plate, number: e.currentTarget.value.replace(/\D/g, '') })}
          ref={numberRef}
          inputMode="numeric"
          enterKeyHint="done"
          autoComplete="off"
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !onEnter) return;
            e.preventDefault();
            onEnter();
          }}
          maxLength={6}
          size="lg"
          autoFocus={focus}
          data-autofocus={focus || undefined}
          classNames={{ input: unsure?.number ? 'plate-unsure' : undefined }}
          style={{ flex: 1 }}
          styles={{ input: { fontFamily: 'var(--font-plate)', fontSize: 24, letterSpacing: '0.08em', fontWeight: 600 } }}
        />
      </Group>
      {!plate.code && codes && codes.length > 0 && (
        <div className="chip-row plate-codes" data-plate-codes aria-label={t('vehicle.plateCode')}>
          {codes.map((c) => (
            <button key={c} type="button" className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => setPlate({ ...plate, code: c })}>
              {c}
            </button>
          ))}
        </div>
      )}
      {children}
    </Box>
  );
}

type VinState = 'reading' | 'sure' | 'check' | 'none' | 'typed';

/**
 * The VIN of a car not in the base (v0.81, the user's brief: «если совпадения нет, предложить «Сканировать VIN» в той же
 * карточке… считать VIN, показать его для проверки»): in the plate's card — «Сканировать VIN» (a tap — the camera, a hold —
 * the phone's photos) or typed by hand. Read on the phone (services/vinReader.ts, no AI); a VIN that did not prove itself is
 * ringed orange until it is looked at — ✓ or typed over. The line it was read off is shown under it to check it by.
 */
function VinBlock({ vin, state, crop, open, pick, onOpen, onChange, onConfirm }: { vin: string; state?: VinState; crop?: string; open: boolean; pick: ReturnType<typeof usePhotoPick>; onOpen: () => void; onChange: (v: string) => void; onConfirm: () => void }) {
  const { t } = useTranslation();
  if (!open)
    return (
      <Group gap={8} mt="sm" wrap="nowrap" className="vin-scan">
        <Button variant="light" style={{ flex: 1 }} leftSection={<IconScan size={18} stroke={2} />} {...pick.handlers} onClick={() => !pick.consumeClick() && pick.camera()}>
          {t('newOrder.scanVin')}
        </Button>
        <ActionIcon size={36} radius="xl" variant="subtle" color="gray" aria-label={t('newOrder.typeVin')} onClick={onOpen}>
          <IconKeyboard size={20} stroke={1.8} />
        </ActionIcon>
      </Group>
    );
  const unsure = state === 'check';
  const proven = !!vin && isVin(vin) && (state === 'sure' || checkDigitOk(vin));
  return (
    <Box mt="sm" className="vin-block rise-enter" data-vin-state={state}>
      <Group gap={8} wrap="nowrap" align="center">
        <TextInput
          aria-label="VIN"
          placeholder={state === 'reading' ? t('newOrder.vinReading') : 'VIN'}
          value={vin}
          onChange={(e) => onChange(e.currentTarget.value)}
          maxLength={17}
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          style={{ flex: 1, minWidth: 0 }}
          classNames={{ input: unsure ? 'plate-unsure' : undefined }}
          styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', letterSpacing: '0.04em', fontWeight: 600 } }}
          rightSection={
            unsure ? (
              <ActionIcon size={30} radius="xl" variant="filled" color="orange" aria-label={t('newOrder.vinOk')} onClick={onConfirm}>
                <IconCheck size={16} stroke={2.6} />
              </ActionIcon>
            ) : proven ? (
              <IconCheck size={18} stroke={2.6} color="var(--mantine-color-green-6)" aria-label={t('newOrder.vinRead')} />
            ) : undefined
          }
          rightSectionPointerEvents="all"
        />
        <ActionIcon size={40} radius="xl" variant="light" aria-label={t('newOrder.scanVin')} loading={state === 'reading'} {...pick.handlers} onClick={() => !pick.consumeClick() && pick.camera()}>
          <IconScan size={20} stroke={2} />
        </ActionIcon>
      </Group>
      {crop && <img className="vin-crop" src={crop} alt="" aria-hidden />}
      {state === 'none' && (
        <Text size="sm" c="orange.7" mt={6}>
          {t('newOrder.vinNone')}
        </Text>
      )}
    </Box>
  );
}

/** Make and model: one tap on a chip or a pick from the built-in list; free text still works (not drawn again while the plate is typed). */
const MakeModelBlock = memo(function MakeModelBlock({ make, model, year, onMake, onModel, onYear }: { make: string; model: string; year?: number; onMake: (v: string) => void; onModel: (v: string) => void; onYear: (y: number | undefined) => void }) {
  const { t } = useTranslation();
  const makes = useLiveQuery(() => popularMakes(POPULAR_MAKES), []) ?? POPULAR_MAKES;
  const canon = canonicalMake(make);
  const catalogue = useMemo(() => modelsFor(make), [make]);
  const models = useLiveQuery(() => popularModels(canon, catalogue), [canon, catalogue]) ?? catalogue.slice(0, 10);
  // One model however it is typed ("HiAce" is the chip "Hiace"): the chip of the model picked is lit.
  const same = (a: string, b: string) => a.toLowerCase().replace(/[\s\-_.]/g, '') === b.toLowerCase().replace(/[\s\-_.]/g, '');
  const picked = canonicalModel(make, model);
  return (
    <Box className="surface" p="md">
      <div className="chip-row" aria-label={t('vehicle.make')}>
        {makes.map((m) => (
          <button
            key={m}
            type="button"
            className="chip"
            data-active={canon === m}
            onClick={() => {
              if (canon !== m) onModel('');
              onMake(m);
            }}
          >
            {m}
          </button>
        ))}
      </div>
      <Autocomplete
        mt="sm"
        aria-label={t('vehicle.make')}
        placeholder={t('newOrder.makePlaceholder')}
        data={CAR_MAKES}
        filter={typedOnly}
        limit={8}
        // A make picked from the chips is shown by its chip: the field is for any other make.
        value={makes.includes(canon) ? '' : make}
        onChange={(v) => {
          if (canonicalMake(v) !== canon) onModel('');
          onMake(v);
        }}
        autoComplete="off"
      />
      {canon && (
        <Box className="rise-enter">
          {models.length > 0 && (
            <div className="chip-row" style={{ marginTop: 12 }} aria-label={t('vehicle.model')}>
              {models.map((m) => (
                <button key={m} type="button" className="chip" data-active={!!picked && same(picked, m)} onClick={() => onModel(m)}>
                  {m}
                </button>
              ))}
            </div>
          )}
          <Autocomplete
            mt="sm"
            aria-label={t('vehicle.model')}
            placeholder={models.length ? t('newOrder.otherModel') : t('vehicle.model')}
            data={catalogue}
            filter={typedOnly}
            limit={8}
            // Likewise the model: a chip shows it, the field takes any other.
            value={picked && models.some((m) => same(m, picked)) ? '' : model}
            onChange={onModel}
            autoComplete="off"
          />
        </Box>
      )}
      {/* The year (v0.81): by hand, or from the VIN. */}
      <TextInput
        mt="sm"
        aria-label={t('vehicle.year')}
        placeholder={t('vehicle.year')}
        inputMode="numeric"
        maxLength={4}
        w={120}
        value={year ? String(year) : ''}
        onChange={(e) => onYear(Number(e.currentTarget.value.replace(/\D/g, '')) || undefined)}
        autoComplete="off"
      />
    </Box>
  );
});

/**
 * What the customer complains of, in their words (not drawn again while the plate is typed). No ready phrases here
 * (v0.89, the owner: «убрать готовые подсказки жалоб… я 99 % не использую»): the garage's list (Settings → Lists) stays
 * in the job's «Жалоба» sheet.
 */
const ComplaintBlock = memo(function ComplaintBlock({ complaint, onChange }: { complaint: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <Box className="surface" p="md">
      <Textarea aria-label={t('order.complaint')} placeholder={t('order.complaintHint')} autosize minRows={2} value={complaint} onChange={(e) => onChange(e.currentTarget.value)} />
    </Box>
  );
});

type ShotState = 'reading' | 'read' | 'check' | 'none';

/**
 * The car's photo (v0.28 — «＋» → «Фото номера», or the camera on the plate): the plate is read off it on the phone; while
 * it reads, a light runs over it; then the plate is ringed where it was read — green when the readings agreed, orange
 * when it is to be checked. A tap takes it again, a hold picks one from the phone's photos; × lets it go. It becomes the
 * car's main photo with the job.
 */
function CarShot({ file, state, box, pick, onRemove }: { file: File; state: ShotState; box?: PlateFound['box']; pick: ReturnType<typeof usePhotoPick>; onRemove: () => void }) {
  const { t } = useTranslation();
  // Made and let go by the same effect (an address made once and let go by a cleanup that runs twice would be dead).
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  const label = t(state === 'reading' ? 'newOrder.plateReading' : state === 'read' ? 'newOrder.plateRead' : state === 'check' ? 'newOrder.plateCheck' : 'newOrder.plateNone');
  return (
    <div className="car-shot rise-enter" data-state={state}>
      <button type="button" className="car-shot-img" aria-label={t('newOrder.retake')} {...pick.handlers} onClick={() => !pick.consumeClick() && pick.camera()}>
        <span className="car-shot-frame">
          <img src={url} alt="" draggable={false} />
          {box && state !== 'reading' && <span className="car-shot-box" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }} />}
          {state === 'reading' && <span className="car-shot-scan" aria-hidden />}
        </span>
      </button>
      <span className="car-shot-badge" data-state={state} role="status" aria-label={label} title={label}>
        {state === 'reading' ? <Loader size={14} color="white" /> : state === 'read' ? <IconCheck size={17} stroke={3} /> : state === 'check' ? <IconAlertTriangle size={16} stroke={2.4} /> : <IconCameraOff size={16} stroke={2.2} />}
      </span>
      <button type="button" className="car-shot-x glass" aria-label={t('newOrder.removePhoto')} onClick={onRemove}>
        <IconX size={18} stroke={2.2} />
      </button>
    </div>
  );
}

export function NewOrderPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // One job per "Accept", however fast the second tap comes.
  const { run, busy } = useAction({ exclusive: true });
  const settings = useSettings();
  const lang = useLang();
  // A known car's last visit is the one before now (v0.44: its mileage then, under the car).
  const [openedAt] = useState(nowIso);
  // On a PC (v0.42) the form is two columns: the car | what is wrong and whose it is.
  const onPhone = usePhone();
  const [plate, setPlateState] = useState<Plate>(() => ({ emirate: lastEmirate(), code: '', number: '' }));
  // The plate as typed this moment (v0.89): the field tells the page without hurry, so a tap on «Принять» right after the
  // last key reads it here, not from the page's last drawing.
  const plateNow = useRef(plate);
  const setPlate = useCallback((next: Plate | ((p: Plate) => Plate)) => {
    const p = typeof next === 'function' ? next(plateNow.current) : next;
    plateNow.current = p;
    setPlateState(p);
  }, []);
  // The garage's plate habits (v0.99, audit П8–П10): its usual emirate is the default while nothing is typed.
  const [habits, setHabits] = useState<PlateHabits>();
  useEffect(() => {
    let alive = true;
    void plateHabits().then((h) => {
      if (!alive) return;
      setHabits(h);
      try {
        localStorage.setItem(LAST_EMIRATE, h.emirate);
      } catch {
        // storage unavailable
      }
      setPlate((p) => (p.number || p.code ? p : { ...p, emirate: h.emirate }));
    });
    return () => {
      alive = false;
    };
  }, [setPlate]);
  // Today's mileage right at the counter (v0.99, audit П2): written to the job after «Принять».
  const [km, setKm] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState<number>();
  // The VIN of a car not in the base (v0.81): scanned or typed; what it filled is replaced by a newer VIN while untouched.
  const [vin, setVin] = useState('');
  const [vinState, setVinState] = useState<VinState>();
  const [vinOpen, setVinOpen] = useState(false);
  const [vinShot, setVinShot] = useState<{ file: File; crop?: string }>();
  const vinFilled = useRef<VinCar>({});
  // The car's make and model off its photo (v0.89, the owner: «распознавание марки и модели по фотографии, чтобы сразу
  // заполнить»): asked once the plate says the car is new, put only into what is empty. The VIN after it is held against
  // it — another car, the person chooses here (`clash`); chosen or not, the job keeps the question for the VIN.
  const [photoGuess, setPhotoGuess] = useState<PhotoCar>();
  const photoNow = useRef<PhotoCar>();
  const formCar = useRef({ make: '', model: '' });
  formCar.current = { make, model };
  const [clash, setClash] = useState<{ photo: PhotoCar; vin: VinSaid }>();
  const chosen = useRef<'photo' | 'vin'>();
  const fillFromVin = useCallback((v: string) => {
    void decodeVin(v).then((car) => {
      const was = vinFilled.current;
      // Only into what is empty, or still as a VIN filled it before.
      setMake((m) => (car.make && (!m.trim() || m === was.make) ? car.make : m));
      setModel((m) => (car.model && (!m.trim() || m === was.model) ? car.model : m));
      setYear((y) => (car.year && (!y || y === was.year) ? car.year : y));
      vinFilled.current = car;
      if (car.make || car.model || car.year) haptic('success');
      // What the photo said, still in the form: the VIN says another car — the person chooses.
      const g = photoNow.current;
      if (g && !chosen.current) {
        const off = carCheckOf({ ...formCar.current, photoAi: { ...g, at: '' } }, v, { make: car.make, model: car.model });
        setClash(off);
        if (off) haptic('warning');
      }
    });
  }, []);
  const vinPick = usePhotoPick((files) => {
    const file = files[0];
    if (!file) return;
    setVinOpen(true);
    setVinShot({ file });
    setVinState('reading');
    void import('../../services/vinReader')
      .then(({ readVinShot }) => readVinShot(file))
      .then((p) => {
        if (!p.vin) return setVinState('none');
        setVin(p.vin);
        setVinShot({ file, crop: p.crop });
        setVinState(p.sure ? 'sure' : 'check');
        haptic(p.sure ? 'success' : 'warning');
        if (p.sure) fillFromVin(p.vin);
      })
      .catch(() => setVinState('none'));
  });
  const typeVin = useCallback(
    (raw: string) => {
      const v = vinChars(raw).slice(0, 17);
      setVin(v);
      setVinState('typed');
      if (isVin(v)) fillFromVin(v);
    },
    [fillFromVin],
  );
  const [picked, setPicked] = useState<{ vehicle: Vehicle; owner?: Customer; activeOrder?: Order }>();
  const [pickedCustomer, setPickedCustomer] = useState<Customer>();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  // Who brought the car (v0.43): asked for a company's car — picked from its drivers in one tap, or typed.
  const [driver, setDriver] = useState<DriverDraft>({ name: '', phone: '' });
  // Documents are in English by default, whatever language the app itself is in.
  const docLanguage: Lang = 'en';
  const [complaint, setComplaint] = useState('');
  // What was typed and left without «Принять» (v0.99, audit П5): offered once at the top of a plain «Новый заказ».
  const [draft, setDraft] = useState<NewOrderDraft | undefined>(() =>
    ['photo', 'customerId', 'vehicleId', 'day', 'when'].some((k) => params.has(k)) ? undefined : readNewOrderDraft(),
  );
  const [later, setLater] = useState(params.get('when') === 'later');
  const [bookedFor, setBookedFor] = useState<string>();
  // The day the car came (v0.53): today — or an earlier day, for a job forgotten and typed in later (v0.69: from a month
  // of «По месяцам» — a day of that month comes with it, `?day=`).
  const [day, setDay] = useState(() => {
    const asked = params.get('day');
    const today = dubaiDate();
    return asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : today;
  });

  // The car's photo (v0.28): brought by «＋» → «Фото номера», or taken here. The plate is read off it; what was typed into
  // the plate meanwhile is not overwritten.
  const [shot, setShot] = useState<{ file: File; id?: string; plate?: PlateFound } | undefined>(() => {
    const id = params.get('photo');
    const file = heldCarShot(id);
    // The plate the camera read off its frames while it was aimed (v0.33): in the form at once, nothing to read.
    return file && id ? { file, id, plate: heldPlate(id) } : undefined;
  });
  const [read, setRead] = useState<{ state: ShotState; found?: PlateFound }>();
  const typed = useRef(false);
  const shoot = usePhotoPick((files) => files[0] && setShot({ file: files[0] }));
  useEffect(() => {
    if (!shot) return setRead(undefined);
    let alive = true;
    typed.current = false;
    if (shot.plate) {
      const found = shot.plate;
      setRead({ state: found.codeSure || !found.code ? 'read' : 'check', found });
      setPlate((p) => ({ emirate: found.emirate ?? p.emirate, code: found.code, number: found.number }));
      return;
    }
    setRead({ state: 'reading' });
    void import('../../services/plateReader')
      .then(({ readPlate }) => readPlate(shot.file))
      .then((found) => {
        if (!alive) return;
        setRead({ state: !found ? 'none' : found.sure && (found.codeSure || !found.code) ? 'read' : 'check', found });
        if (found && !typed.current) {
          setPlate((p) => ({ emirate: found.emirate ?? p.emirate, code: found.code, number: found.number }));
          haptic(found.sure && found.codeSure ? 'success' : 'warning');
        }
      })
      .catch(() => alive && setRead({ state: 'none' }));
    return () => {
      alive = false;
    };
  }, [shot, setPlate]);
  const typePlate = useCallback(
    (p: Plate) => {
      typed.current = true;
      setPlate(p);
    },
    [setPlate],
  );
  // What the reading was not sure of, while it is still as read.
  const fromPhoto = read?.found;
  const unsure = fromPhoto ? { code: !!fromPhoto.code && !fromPhoto.codeSure && plate.code === fromPhoto.code, number: !fromPhoto.sure && plate.number === fromPhoto.number } : undefined;

  // Opened from a car's page ("New job" for this car).
  const preVehicle = useLiveQuery(async () => {
    const id = params.get('vehicleId');
    if (!id) return undefined;
    const v = await db.vehicles.get(id);
    return v ? findVehicleForCheckIn(v.plate) : undefined;
  }, [params]);
  useEffect(() => {
    if (preVehicle) setPicked(preVehicle);
  }, [preVehicle]);

  // The plate is looked up once the typing pauses, not on every key: each key stays light (an iPhone loses
  // keys typed while the page is busy — the lookup, its re-render, the cars it brings up).
  const [lookup, setLookup] = useState(plate);
  useEffect(() => {
    const t = window.setTimeout(() => setLookup(plate), 250);
    return () => window.clearTimeout(t);
  }, [plate]);
  // The plate is already in the base: offer that car (and its open job, if any). Not as typed — the code
  // left out, another emirate: the cars with that number are offered to pick (`findVehiclesByNumber`).
  const found = useLiveQuery(async () => {
    if (picked) return { match: undefined, byNumber: [] as CheckInCar[] };
    const m = await findVehicleForCheckIn(lookup);
    return { match: m, byNumber: m ? [] : await findVehiclesByNumber(lookup) };
  }, [picked, lookup.emirate, lookup.code, lookup.number]);
  const match = found?.match;
  const byNumber = found?.byNumber ?? [];
  const suggestions = useLiveQuery(() => (picked || pickedCustomer ? [] : suggestCustomers(phone, name)), [picked, pickedCustomer, phone, name]) ?? [];
  // A plate already in the base is that car: taken by itself, with its photo and owner. A car with a job open on it too
  // (v0.53, the user: «разреши добавить одному и тому же авто и клиенту два разных заказа»): «Принять» makes a second
  // job; the open one is a tap away under it.
  const auto = !picked && match ? match : undefined;
  const known = picked ?? auto;
  const activeJob = picked?.activeOrder ?? match?.activeOrder;
  const owner = known?.owner ?? pickedCustomer;

  // The photo asked about the car only once the plate is looked up and the car is not in the base (a car the garage
  // knows has its make and model — no tokens), and only while its make or model is empty.
  const carIsNew = !!shot && !known && !byNumber.length && !!plate.number && lookup === plate && !!found;
  useEffect(() => {
    if (!shot || !carIsNew || (formCar.current.make.trim() && formCar.current.model.trim())) return;
    let alive = true;
    void guessCar(shot.file).then((g) => {
      if (!alive || !g) return;
      const fill = photoFill(formCar.current, g);
      photoNow.current = g;
      setPhotoGuess(g);
      if (fill.make) setMake(fill.make);
      if (fill.model) setModel(fill.model);
      if (fill.make || fill.model) haptic('success');
    });
    return () => {
      alive = false;
    };
  }, [shot, carIsNew]);
  const photoBusy = useAiWorking(CAR_PHOTO_WORK);
  const byPhoto = !!photoGuess && sameMake(make, photoGuess.make) && (!photoGuess.model || model.trim().toLowerCase() === photoGuess.model.toLowerCase());

  // A job forgotten, from «По месяцам» (v0.69): its customer comes with it (`?customerId=`), and its cars are offered a tap
  // each — a company's dozen cars without typing a plate.
  const askedCustomer = useLiveQuery(async () => {
    const id = params.get('customerId');
    return id ? db.customers.get(id) : undefined;
  }, [params]);
  useEffect(() => {
    if (askedCustomer) setPickedCustomer((c) => c ?? askedCustomer);
  }, [askedCustomer]);
  const ownCars =
    useLiveQuery(async () => (pickedCustomer && !picked ? (await db.vehicles.where('customerId').equals(pickedCustomer.id).toArray()).filter((v) => !v.archivedAt) : []), [pickedCustomer?.id, !!picked]) ?? [];

  // The driver who brought this car last time (v0.68, the user: «завтра этот же автомобиль приезжает — имя водителя
  // должно выставляться само»): in by itself, as if picked; × takes him off and another is typed. Only into an empty
  // driver (or over the one put in for another car).
  const autoDriver = useRef<string>();
  const driverOff = useRef(false);
  const carId = known?.vehicle.id;
  const ownerId = owner?.id;
  const ownerCompany = owner?.type === 'company';
  useEffect(() => {
    if (!carId || !ownerCompany) return;
    let alive = true;
    void carDriver(carId, ownerId).then((d) => {
      if (!alive) return;
      setDriver((cur) => {
        const untouched = !cur.id && !cur.name.trim() && !cur.phone.trim();
        const ours = !!autoDriver.current && cur.id === autoDriver.current;
        if (!untouched && !ours) return cur;
        autoDriver.current = d?.id;
        return d ?? (ours ? { name: '', phone: '' } : cur);
      });
    });
    return () => {
      alive = false;
    };
  }, [carId, ownerId, ownerCompany]);

  const submit = (target: 'job' | 'book') =>
    run(async () => {
      // Typed fast and tapped at once: the lookup may not have caught up with the plate — it is looked up here too.
      const plate = plateNow.current;
      const fresh = lookup === plate ? known : await findVehicleForCheckIn(plate);
      const car = picked ?? fresh;
      const company = (car?.owner ?? pickedCustomer)?.type === 'company';
      // Tapped before the driver came in by himself: the car's last one — unless he was taken off.
      const typedDriver = driver.id || driver.name.trim() || driver.phone.trim() || !company || !car || driverOff.current ? driver : ((await carDriver(car.vehicle.id, car.owner?.id)) ?? driver);
      const o = await checkIn({
        vehicleId: car?.vehicle.id,
        plate,
        make: canonicalMake(make),
        model: canonicalModel(make, model),
        // A VIN that proved itself, was looked at (✓) or typed — not one still to be checked.
        vin: isVin(vin) && vinState !== 'check' && vinState !== 'reading' ? vin : undefined,
        year,
        customerId: (car?.owner ?? pickedCustomer)?.id,
        name,
        phone,
        docLanguage,
        complaint,
        arrivedNow: target !== 'book',
        bookedFor: target === 'book' ? bookedFor : undefined,
        driver: company ? typedDriver : undefined,
        day: target === 'book' ? undefined : day,
      });
      // Today's mileage typed at the counter (v0.99, audit П2).
      const kmTyped = parseKm(km);
      if (target !== 'book' && kmTyped !== undefined) await setJobMileage(o.id, kmTyped).catch(() => undefined);
      clearNewOrderDraft();
      // The photo is the car's main photo now (a fresh one of a car in the base takes the place of the old).
      if (shot) {
        await setCover(o.vehicleId, shot.file).catch(() => undefined);
        if (shot.id) dropCarShot(shot.id);
        // A new car's make and model off this photo (v0.89), kept for its VIN: chosen here or still in question — as it
        // stands; else its answer (now or when it comes) goes to the car's card.
        if (!car) {
          const g = photoNow.current;
          if (g && (chosen.current || clash)) {
            await takePhotoCar(o.vehicleId, g, { checked: chosen.current === 'photo' });
            if (clash) await askCarCheck(o.vehicleId, clash);
          } else carPhotoLater(o.vehicleId, shot.file);
        }
      }
      // The VIN's photo is the car's VIN photo (its «VIN» chip on the job reads it there again, if it was not sure).
      if (vinShot && !car) await setVinPhoto(o.vehicleId, vinShot.file).catch(() => undefined);
      // Straight to the job: findings, prices and the customer's answer all happen there.
      navigate(`/orders/${o.id}`, { replace: true });
    });

  // The draft kept as it is typed; while the one offered waits, typing anything new puts the offer away.
  useEffect(() => {
    if (draft) {
      if (plate.number || complaint || name || phone) setDraft(undefined);
      return;
    }
    saveNewOrderDraft({ plate, complaint, name, phone, make, model, km });
  }, [draft, plate, complaint, name, phone, make, model, km]);
  const restore = (d: NewOrderDraft) => {
    setDraft(undefined);
    setPlate(d.plate);
    setComplaint(d.complaint);
    setName(d.name);
    setPhone(d.phone);
    setMake(d.make);
    setModel(d.model);
    setKm(d.km);
    haptic('selection');
  };
  // Enter in the number, Ctrl+Enter anywhere (a PC, v0.99, audit П37): what the main button would do.
  const enter = () => {
    if (later || busy) return;
    if (activeJob) navigate(`/orders/${activeJob.id}`);
    else if (plateNow.current.number || known) void submit('job');
  };
  const enterRef = useRef(enter);
  enterRef.current = enter;
  useEffect(() => {
    if (onPhone) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      enterRef.current();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onPhone]);

  const noName = t('customer.noName');
  return (
    <>
      <PageHeader back title={t('newOrder.title')} right={<DocImportButton />} />
      <Stack gap={0}>
        <DeskSplit
          desk={!onPhone}
          className="desk-form"
          side={
            <>
              {draft && (
                <button type="button" className="suggest rise-enter" style={{ marginBottom: 12 }} onClick={() => restore(draft)} data-draft>
                  <IconRestore size={22} color="var(--mantine-color-cobalt-6)" style={{ flexShrink: 0 }} />
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Text size="sm" fw={600} lh={1.3}>
                      {t('newOrder.draft')}
                    </Text>
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {[[draft.plate.code, draft.plate.number].filter(Boolean).join(' '), draft.complaint.trim(), draft.name.trim() || draft.phone.trim()].filter(Boolean).join(' · ')}
                    </Text>
                  </Box>
                  <Text size="sm" c="cobalt.6" fw={600} style={{ flexShrink: 0 }}>
                    {t('newOrder.draftGo')}
                  </Text>
                </button>
              )}
              <div className="group-title">{t('newOrder.vehicle')}</div>
              {shot && <CarShot file={shot.file} state={read?.state ?? 'reading'} box={fromPhoto?.box} pick={shoot} onRemove={() => setShot(undefined)} />}
              {picked ? (
                <Box className="surface rise-enter" p="md">
                  <Group justify="space-between" wrap="nowrap" gap="sm">
                    <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                      <CarThumb vehicleId={picked.vehicle.id} />
                      <PlateText plate={picked.vehicle.plate} size="md" />
                      <Box style={{ minWidth: 0 }}>
                        <Text fw={600} lineClamp={1}>
                          {[picked.vehicle.make, picked.vehicle.model].filter(Boolean).join(' ') || t('newOrder.noMake')}
                        </Text>
                        <Text size="sm" c="dimmed" lineClamp={1}>
                          {who(picked.owner, noName)}
                        </Text>
                      </Box>
                    </Group>
                    <Button variant="subtle" size="compact-md" onClick={() => setPicked(undefined)}>
                      {t('newOrder.otherCar')}
                    </Button>
                  </Group>
                  {!picked.activeOrder && settings && <PrevVisit order={{ id: '', vehicleId: picked.vehicle.id, createdAt: openedAt }} settings={settings} lang={lang} />}
                  {picked.activeOrder && (
                    <button type="button" className="suggest" style={{ marginTop: 12 }} data-route={`/orders/${picked.activeOrder!.id}`} onClick={() => navigate(`/orders/${picked.activeOrder!.id}`)}>
                      <Text size="sm" fw={600} style={{ flex: 1 }}>
                        {t('newOrder.inWork', { n: picked.activeOrder.number })}
                      </Text>
                      <Text size="sm" c="cobalt.6" fw={600}>
                        {t('newOrder.openOrder')}
                      </Text>
                    </button>
                  )}
                </Box>
              ) : (
                <>
                  <PlateBlock
                    plate={plate}
                    onChange={typePlate}
                    unsure={unsure}
                    focus={!shot}
                    codes={habits?.codes[plate.emirate]}
                    usual={habits?.emirate}
                    onEnter={onPhone ? undefined : () => enterRef.current()}
                    camera={
                      !shot && (
                        <ActionIcon className="plate-cam" size={40} radius="xl" variant="light" aria-label={t('newOrder.photo')} {...shoot.handlers} onClick={() => !shoot.consumeClick() && shoot.camera()}>
                          <IconCamera size={20} stroke={2} />
                        </ActionIcon>
                      )
                    }
                  >
                    {/* Not in the base (v0.81): its VIN, scanned or typed, in the same card. */}
                    {!auto && !byNumber.length && (
                      <VinBlock
                        vin={vin}
                        state={vinState}
                        crop={vinShot?.crop}
                        open={vinOpen}
                        pick={vinPick}
                        onOpen={() => setVinOpen(true)}
                        onChange={typeVin}
                        onConfirm={() => {
                          setVinState('sure');
                          haptic('selection');
                          if (isVin(vin)) fillFromVin(vin);
                        }}
                      />
                    )}
                  </PlateBlock>
                  {shoot.inputs}
                  {vinPick.inputs}
                  {auto && (
                    <Box className="surface rise-enter" p="sm" mt={10} aria-label={t('newOrder.inBase')}>
                      <Group gap="sm" wrap="nowrap">
                        <CarThumb vehicleId={auto.vehicle.id} />
                        <Box style={{ minWidth: 0, flex: 1 }}>
                          <Text fw={600} lineClamp={1}>
                            {[auto.vehicle.make, auto.vehicle.model].filter(Boolean).join(' ') || t('newOrder.noMake')}
                          </Text>
                          {/* Whose it is (v0.81): the plate typed over a misread one finds the right customer — seen at once. */}
                          <Text size="sm" c="dimmed" lineClamp={1}>
                            {/* Whose it is, not a service phrase (v0.99, audit П13): the name and the number. */}
                            {[who(auto.owner, noName), auto.owner?.phone].filter(Boolean).join(' · ')}
                          </Text>
                        </Box>
                      </Group>
                      {/* It comes again (v0.44): its last visit — when, its mileage then, what was done — as on the job's card. */}
                      {settings && !auto.activeOrder && <PrevVisit order={{ id: '', vehicleId: auto.vehicle.id, createdAt: openedAt }} settings={settings} lang={lang} />}
                    </Box>
                  )}
                  {match?.activeOrder && (
                    <button
                      type="button"
                      className="suggest rise-enter"
                      style={{ marginTop: 10 }}
                      data-route={`/orders/${match.activeOrder!.id}`} onClick={() => navigate(`/orders/${match.activeOrder!.id}`)}
                    >
                      <IconCar size={22} color="var(--mantine-color-cobalt-6)" style={{ flexShrink: 0 }} />
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Text size="sm" fw={600} lh={1.3}>
                          {t('newOrder.inWork', { n: match.activeOrder.number })}
                        </Text>
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {[[match.vehicle.make, match.vehicle.model].filter(Boolean).join(' '), who(match.owner, noName)].filter(Boolean).join(' · ')}
                        </Text>
                      </Box>
                      <Text size="sm" c="cobalt.6" fw={600} style={{ flexShrink: 0 }}>
                        {t('newOrder.openOrder')}
                      </Text>
                    </button>
                  )}
                  {byNumber.length > 0 && (
                    // The number is in the base with another code (or none): one tap — that car and its customer.
                    <Stack gap={8} mt={10}>
                      {byNumber.map((c) => (
                        <button
                          key={c.vehicle.id}
                          type="button"
                          className="suggest rise-enter"
                          onClick={() => setPicked(c)}
                        >
                          <CarThumb vehicleId={c.vehicle.id} size={44} />
                          <Box style={{ flex: 1, minWidth: 0 }}>
                            <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                              <PlateText plate={c.vehicle.plate} size="sm" />
                              <Text size="sm" fw={600} lineClamp={1}>
                                {[c.vehicle.make, c.vehicle.model].filter(Boolean).join(' ')}
                              </Text>
                            </Group>
                            <Text size="xs" c="dimmed" lineClamp={1} mt={2}>
                              {[who(c.owner, noName), c.activeOrder ? t('newOrder.inWork', { n: c.activeOrder.number }) : ''].filter(Boolean).join(' · ')}
                            </Text>
                          </Box>
                          <Text size="sm" c="cobalt.6" fw={600} style={{ flexShrink: 0 }}>
                            {t('newOrder.useThis')}
                          </Text>
                        </button>
                      ))}
                    </Stack>
                  )}
                  {!auto && ownCars.length > 0 && (
                    // The customer's cars (v0.69): one tap — that car.
                    <>
                      <div className="group-title" style={{ marginTop: 22 }}>
                        {t('newOrder.customerCars')}
                      </div>
                      <Stack gap={8} data-own-cars>
                        {ownCars.map((v) => (
                          <button key={v.id} type="button" className="suggest rise-enter" onClick={() => void findVehicleForCheckIn(v.plate).then((c) => c && setPicked(c))}>
                            <CarThumb vehicleId={v.id} size={44} />
                            <Group gap={8} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                              <PlateText plate={v.plate} size="sm" />
                              <Text size="sm" fw={600} lineClamp={1}>
                                {[v.make, v.model].filter(Boolean).join(' ')}
                              </Text>
                            </Group>
                            <Text size="sm" c="cobalt.6" fw={600} style={{ flexShrink: 0 }}>
                              {t('newOrder.useThis')}
                            </Text>
                          </button>
                        ))}
                      </Stack>
                    </>
                  )}
                  {!auto && (
                    <>
                      <div className="group-title" style={{ marginTop: 22 }}>
                        {t('newOrder.makeModel')}
                        {/* The AI looking at the photo, then what it filled (v0.89). */}
                        {photoBusy ? (
                          <span className="by-photo">
                            <AiMark size={18} busy label={t('ai.working')} />
                          </span>
                        ) : byPhoto ? (
                          <span className="by-photo" data-by-photo>
                            <AiMark size={18} />
                            {t('newOrder.byPhoto')}
                          </span>
                        ) : null}
                      </div>
                      <MakeModelBlock make={make} model={model} year={year} onMake={setMake} onModel={setModel} onYear={setYear} />
                      {clash && (
                        // The photo and the VIN say different cars (v0.89): one tap — which.
                        <Box className="surface rise-enter" p="md" mt={10} data-car-clash>
                          <Text fw={600} c="orange.7" mb={10}>
                            {t('ai.checkTitle')}
                          </Text>
                          <CarChoice
                            check={clash}
                            onPick={(p) => {
                              const photo = sameMake(p.make, clash.photo.make) && (p.model ?? '') === clash.photo.model;
                              chosen.current = photo ? 'photo' : 'vin';
                              if (p.make) setMake(p.make);
                              setModel(p.model ?? (sameMake(p.make, formCar.current.make) ? formCar.current.model : ''));
                              setClash(undefined);
                            }}
                          />
                        </Box>
                      )}
                    </>
                  )}
                </>
              )}
              {/* Today's mileage at the counter (v0.99, audit П2) — the last visit's is right above it. */}
              {!later && (
                <RowGroup>
                  <FormRow label={t('odo.title')}>
                    <TextInput
                      aria-label={t('odo.title')}
                      inputMode="numeric"
                      enterKeyHint="done"
                      placeholder={t('newOrder.kmHint')}
                      value={km}
                      onChange={(e) => setKm(e.currentTarget.value.replace(/[^\d\s]/g, ''))}
                      autoComplete="off"
                      rightSection={
                        <Text size="sm" c="dimmed">
                          {t('newOrder.km')}
                        </Text>
                      }
                      w="100%"
                      data-new-km
                    />
                  </FormRow>
                </RowGroup>
              )}
            </>
          }
          main={
            <>
              <div className="group-title" style={{ marginTop: 22 }}>
                {t('job.complaint')}
              </div>
              <ComplaintBlock complaint={complaint} onChange={setComplaint} />

              <div className="group-title" style={{ marginTop: 22 }}>
                {t('job.client')}
              </div>
              {owner && (owner.name || owner.phone) ? (
                <Box className="surface rise-enter" p="md">
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                      <IconUser size={20} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} />
                      <Text fw={500} lineClamp={1}>
                        {who(owner, noName)}
                      </Text>
                    </Group>
                    {!known && (
                      <Button variant="subtle" color="gray" size="compact-md" aria-label={t('common.change')} onClick={() => setPickedCustomer(undefined)}>
                        <IconX size={18} />
                      </Button>
                    )}
                  </Group>
                </Box>
              ) : (
                <>
                  <RowGroup mt={0}>
                    <FormRow label={t('customer.phone')}>
                      <TextInput aria-label={t('customer.phone')} type="tel" inputMode="tel" placeholder="050 123 4567" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} autoComplete="off" w="100%" />
                    </FormRow>
                    <FormRow label={t('customer.name')}>
                      <TextInput aria-label={t('customer.name')} placeholder={t('newOrder.namePlaceholder')} value={name} onChange={(e) => setName(e.currentTarget.value)} autoComplete="off" autoCapitalize="words" w="100%" />
                    </FormRow>
                  </RowGroup>
                  {suggestions.length > 0 && (
                    <Stack gap={8} mt={10}>
                      {suggestions.map((c) => (
                        <button key={c.id} type="button" className="suggest rise-enter" onClick={() => setPickedCustomer(c)}>
                          <IconUser size={20} color="var(--mantine-color-cobalt-6)" style={{ flexShrink: 0 }} />
                          <Text size="sm" fw={500} style={{ flex: 1, minWidth: 0 }} lineClamp={1}>
                            {who(c, noName)}
                          </Text>
                          <Text size="sm" c="cobalt.6" fw={600} style={{ flexShrink: 0 }}>
                            {t('newOrder.useThis')}
                          </Text>
                        </button>
                      ))}
                    </Stack>
                  )}

                </>
              )}


              {owner?.type === 'company' && (
                <>
                  <div className="group-title" style={{ marginTop: 22 }}>
                    {t('driver.title')}
                  </div>
                  {driver.id ? (
                    <PickedDriver
                      driver={driver}
                      onClear={() => {
                        driverOff.current = true;
                        setDriver({ name: '', phone: '' });
                      }}
                    />
                  ) : (
                    <DriverFields value={driver} onChange={setDriver} onPick={(d) => setDriver({ id: d.id, name: d.name, phone: d.phone })} customerId={owner.id} vehicleId={known?.vehicle.id} />
                  )}
                </>
              )}

              <RowGroup>
                {/* The day the car came (v0.53): an earlier one — the job is on that day (its invoice too). */}
                {!later && (
                  <FormRow label={t('newOrder.day')}>
                    <DayPill value={day} onChange={setDay} label={t('newOrder.day')} />
                  </FormRow>
                )}
                <FormRow label={t('newOrder.bookLater')}>
                  <Switch checked={later} onChange={(e) => setLater(e.currentTarget.checked)} aria-label={t('newOrder.bookLater')} />
                </FormRow>
                {later && (
                  <Box px="md" pb="md" pt={4} className="rise-enter">
                    <DateTimeField label={t('newOrder.bookedFor')} value={bookedFor} onChange={setBookedFor} />
                  </Box>
                )}
              </RowGroup>
            </>
          }
        />
      </Stack>

      <StickyBar>
        {later ? (
          // A booking needs the car's number (v0.99, audit П29: the button was lit, the save then failed).
          <Button fullWidth onClick={() => submit('book')} loading={busy} disabled={!bookedFor || (!plate.number && !known)}>
            {t('newOrder.book')}
          </Button>
        ) : activeJob ? (
          // The car is already in work (v0.99, audit П1): opening that job is the main button — the big «Принять» made a
          // second job by habit. A second job stays possible (v0.53), as the second button.
          <Group gap={10} wrap="nowrap">
            <Button variant="default" onClick={() => submit('job')} loading={busy} style={{ flex: '0 0 auto' }} data-second-job>
              {t('newOrder.secondJob')}
            </Button>
            <Button style={{ flex: 1 }} leftSection={<IconCar size={20} />} data-route={`/orders/${activeJob.id}`} onClick={() => navigate(`/orders/${activeJob.id}`)} data-open-active>
              {t('newOrder.openN', { n: activeJob.number })}
            </Button>
          </Group>
        ) : (
          // Lit once there is a number (or a known car): no tap that only says "type the number". Another day than today
          // says so on the button, in orange (v0.99, audit П30).
          <Button fullWidth onClick={() => submit('job')} loading={busy} disabled={!plate.number && !known} leftSection={<IconCheck size={20} />} color={day !== dubaiDate() ? 'orange' : undefined}>
            {day !== dubaiDate() ? t('newOrder.acceptOn', { day: `${day.slice(8, 10)}/${day.slice(5, 7)}` }) : t('job.accept')}
          </Button>
        )}
      </StickyBar>
    </>
  );
}
