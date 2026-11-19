import { ActionIcon, Autocomplete, Box, Button, Group, Loader, Stack, Switch, Text, Textarea, TextInput } from '@mantine/core';
import { IconAlertTriangle, IconCamera, IconCameraOff, IconCar, IconCheck, IconUser, IconX } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import { CAR_MAKES, canonicalMake, canonicalModel, modelsFor, POPULAR_MAKES } from '../../domain/carCatalog';
import { dubaiDate, nowIso } from '../../domain/dates';
import { formatPhone } from '../../domain/phone';
import { EMIRATES } from '../../domain/plates';
import { quickList } from '../../domain/quickLists';
import type { Customer, Emirate, Lang, Order, Plate, Vehicle } from '../../domain/types';
import { findVehicleForCheckIn, findVehiclesByNumber, popularMakes, popularModels, suggestCustomers, type CheckInCar } from '../../services/customers';
import { setCover } from '../../services/cover';
import { checkIn } from '../../services/orders';
import type { DriverDraft } from '../../services/drivers';
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

const LAST_EMIRATE = 'mygarage.lastEmirate';

function lastEmirate(): Emirate {
  try {
    const e = localStorage.getItem(LAST_EMIRATE);
    if (e && EMIRATES.some((x) => x.code === e)) return e as Emirate;
  } catch {
    // storage unavailable
  }
  return 'DXB';
}

function rememberEmirate(e: Emirate) {
  try {
    localStorage.setItem(LAST_EMIRATE, e);
  } catch {
    // storage unavailable
  }
}

/** A customer with no name yet is shown by phone, or as "no name". */
function who(c: Customer | undefined, noName: string): string {
  if (!c) return '';
  return [c.name || noName, c.phone ? formatPhone(c.phone) : ''].filter(Boolean).join(' · ');
}

/**
 * Big UAE plate: emirate chips, code and number, live preview. The number is the one thing check-in needs. Read off a
 * photo (v0.28), what the reading was not sure of is ringed orange until it is typed over; the camera (a hold — the
 * phone's photos) reads it off a photo.
 */
function PlateBlock({ plate, onChange, unsure, focus, camera }: { plate: Plate; onChange: (p: Plate) => void; unsure?: { code: boolean; number: boolean }; focus: boolean; camera?: ReactNode }) {
  const { t } = useTranslation();
  const lang = useLang();
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
          <button key={e.code} type="button" className="chip" role="radio" aria-checked={plate.emirate === e.code} data-active={plate.emirate === e.code} onClick={() => onChange({ ...plate, emirate: e.code })}>
            {e[lang]}
          </button>
        ))}
      </div>
      <Group gap="sm" mt="sm" wrap="nowrap" align="flex-start">
        <TextInput
          aria-label={t('vehicle.plateCode')}
          placeholder={t('vehicle.plateCode')}
          value={plate.code}
          onChange={(e) => onChange({ ...plate, code: e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
          maxLength={3}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
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
          onChange={(e) => onChange({ ...plate, number: e.currentTarget.value.replace(/\D/g, '') })}
          inputMode="numeric"
          enterKeyHint="done"
          autoComplete="off"
          maxLength={6}
          size="lg"
          autoFocus={focus}
          data-autofocus={focus || undefined}
          classNames={{ input: unsure?.number ? 'plate-unsure' : undefined }}
          style={{ flex: 1 }}
          styles={{ input: { fontFamily: 'var(--font-plate)', fontSize: 24, letterSpacing: '0.08em', fontWeight: 600 } }}
        />
      </Group>
    </Box>
  );
}

/** Make and model: one tap on a chip or a pick from the built-in list; free text still works (not drawn again while the plate is typed). */
const MakeModelBlock = memo(function MakeModelBlock({ make, model, onMake, onModel }: { make: string; model: string; onMake: (v: string) => void; onModel: (v: string) => void }) {
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
    </Box>
  );
});

/** What the customer complains of: the garage's phrases as chips, and free text (not drawn again while the plate is typed). */
const ComplaintBlock = memo(function ComplaintBlock({ complaint, complaints, onAdd, onChange }: { complaint: string; complaints: string[]; onAdd: (p: string) => void; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <Box className="surface" p="md">
      <div className="chip-row wrap">
        {complaints.map((p) => (
          <button key={p} type="button" className="chip" data-active={complaint.includes(p)} onClick={() => onAdd(p)}>
            {p}
          </button>
        ))}
      </div>
      <Textarea mt="sm" aria-label={t('order.complaint')} placeholder={t('order.complaintHint')} autosize minRows={2} value={complaint} onChange={(e) => onChange(e.currentTarget.value)} />
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
  const [plate, setPlate] = useState<Plate>(() => ({ emirate: lastEmirate(), code: '', number: '' }));
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [picked, setPicked] = useState<{ vehicle: Vehicle; owner?: Customer; activeOrder?: Order }>();
  const [pickedCustomer, setPickedCustomer] = useState<Customer>();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  // Who brought the car (v0.43): asked for a company's car — picked from its drivers in one tap, or typed.
  const [driver, setDriver] = useState<DriverDraft>({ name: '', phone: '' });
  // Documents are in English by default, whatever language the app itself is in.
  const docLanguage: Lang = 'en';
  const [complaint, setComplaint] = useState('');
  const [later, setLater] = useState(params.get('when') === 'later');
  const [bookedFor, setBookedFor] = useState<string>();
  // The day the car came (v0.53): today — or an earlier day, for a job forgotten and typed in later.
  const [day, setDay] = useState(() => dubaiDate());

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
  }, [shot]);
  const typePlate = useCallback((p: Plate) => {
    typed.current = true;
    setPlate(p);
  }, []);
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
  const owner = known?.owner ?? pickedCustomer;

  // Complaint chips: the garage's list (Settings → Lists) — English by default, as it goes on the documents.
  const complaints = useMemo(() => quickList(settings, 'complaints'), [settings]);
  const addQuick = useCallback((phrase: string) => {
    setComplaint((c) => (c.includes(phrase) ? c : c ? `${c}, ${phrase}` : phrase));
  }, []);

  const submit = (target: 'job' | 'book') =>
    run(async () => {
      // Typed fast and tapped at once: the lookup may not have caught up with the plate — it is looked up here too.
      const fresh = lookup === plate ? known : await findVehicleForCheckIn(plate);
      const car = picked ?? fresh;
      const company = (car?.owner ?? pickedCustomer)?.type === 'company';
      const o = await checkIn({
        vehicleId: car?.vehicle.id,
        plate,
        make: canonicalMake(make),
        model: canonicalModel(make, model),
        customerId: (car?.owner ?? pickedCustomer)?.id,
        name,
        phone,
        docLanguage,
        complaint,
        arrivedNow: target !== 'book',
        bookedFor: target === 'book' ? bookedFor : undefined,
        driver: company ? driver : undefined,
        day: target === 'book' ? undefined : day,
      });
      if (!picked) rememberEmirate(plate.emirate);
      // The photo is the car's main photo now (a fresh one of a car in the base takes the place of the old).
      if (shot) {
        await setCover(o.vehicleId, shot.file).catch(() => undefined);
        if (shot.id) dropCarShot(shot.id);
      }
      // Straight to the job: findings, prices and the customer's answer all happen there.
      navigate(`/orders/${o.id}`, { replace: true });
    });

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
                    <button type="button" className="suggest" style={{ marginTop: 12 }} onClick={() => navigate(`/orders/${picked.activeOrder!.id}`)}>
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
                    camera={
                      !shot && (
                        <ActionIcon className="plate-cam" size={40} radius="xl" variant="light" aria-label={t('newOrder.photo')} {...shoot.handlers} onClick={() => !shoot.consumeClick() && shoot.camera()}>
                          <IconCamera size={20} stroke={2} />
                        </ActionIcon>
                      )
                    }
                  />
                  {shoot.inputs}
                  {auto && (
                    <Box className="surface rise-enter" p="sm" mt={10} aria-label={t('newOrder.inBase')}>
                      <Group gap="sm" wrap="nowrap">
                        <CarThumb vehicleId={auto.vehicle.id} />
                        <Box style={{ minWidth: 0, flex: 1 }}>
                          <Text fw={600} lineClamp={1}>
                            {[auto.vehicle.make, auto.vehicle.model].filter(Boolean).join(' ') || t('newOrder.noMake')}
                          </Text>
                          <Text size="sm" c="dimmed" lineClamp={1}>
                            {t('newOrder.inBase')}
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
                      onClick={() => navigate(`/orders/${match.activeOrder!.id}`)}
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
                  {!auto && (
                    <>
                      <div className="group-title" style={{ marginTop: 22 }}>
                        {t('newOrder.makeModel')}
                      </div>
                      <MakeModelBlock make={make} model={model} onMake={setMake} onModel={setModel} />
                    </>
                  )}
                </>
              )}
            </>
          }
          main={
            <>
              <div className="group-title" style={{ marginTop: 22 }}>
                {t('job.complaint')}
              </div>
              <ComplaintBlock complaint={complaint} complaints={complaints} onAdd={addQuick} onChange={setComplaint} />

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
                    <PickedDriver driver={driver} onClear={() => setDriver({ name: '', phone: '' })} />
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
          <Button fullWidth onClick={() => submit('book')} loading={busy} disabled={!bookedFor}>
            {t('newOrder.book')}
          </Button>
        ) : (
          // Lit once there is a number (or a known car): no tap that only says "type the number".
          <Button fullWidth onClick={() => submit('job')} loading={busy} disabled={!plate.number && !known} leftSection={<IconCheck size={20} />}>
            {t('job.accept')}
          </Button>
        )}
      </StickyBar>
    </>
  );
}
