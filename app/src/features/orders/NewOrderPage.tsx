import { Autocomplete, Box, Button, Group, Stack, Switch, Text, Textarea, TextInput } from '@mantine/core';
import { IconCar, IconCheck, IconUser, IconX } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import { CAR_MAKES, canonicalMake, canonicalModel, modelsFor, POPULAR_MAKES } from '../../domain/carCatalog';
import { formatPhone } from '../../domain/phone';
import { EMIRATES } from '../../domain/plates';
import { quickList } from '../../domain/quickLists';
import type { Customer, Emirate, Lang, Order, Plate, Vehicle } from '../../domain/types';
import { findVehicleForCheckIn, findVehiclesByNumber, popularMakes, popularModels, suggestCustomers, type CheckInCar } from '../../services/customers';
import { checkIn } from '../../services/orders';
import { DocImportButton } from './DocImport';
import { FormRow, PageHeader, PlateText, RowGroup, StickyBar } from '../../ui/components';
import { CarThumb } from '../job/CarCover';
import { DateTimeField } from '../../ui/DateFields';
import { typedOnly, useAction, useLang, useSettings } from '../../ui/hooks';

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

/** Big UAE plate: emirate chips, code and number, live preview. The number is the one thing check-in needs. */
function PlateBlock({ plate, onChange }: { plate: Plate; onChange: (p: Plate) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  return (
    <Box className="surface" p="md">
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
          autoFocus
          data-autofocus
          style={{ flex: 1 }}
          styles={{ input: { fontFamily: 'var(--font-plate)', fontSize: 24, letterSpacing: '0.08em', fontWeight: 600 } }}
        />
      </Group>
    </Box>
  );
}

/** Make and model: one tap on a chip or a pick from the built-in list; free text still works. */
function MakeModelBlock({ make, model, onMake, onModel }: { make: string; model: string; onMake: (v: string) => void; onModel: (v: string) => void }) {
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
}

export function NewOrderPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // One job per "Accept", however fast the second tap comes.
  const { run, busy } = useAction({ exclusive: true });
  const settings = useSettings();
  const [plate, setPlate] = useState<Plate>(() => ({ emirate: lastEmirate(), code: '', number: '' }));
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [picked, setPicked] = useState<{ vehicle: Vehicle; owner?: Customer; activeOrder?: Order }>();
  const [pickedCustomer, setPickedCustomer] = useState<Customer>();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  // Documents are in English by default, whatever language the app itself is in.
  const docLanguage: Lang = 'en';
  const [complaint, setComplaint] = useState('');
  const [later, setLater] = useState(params.get('when') === 'later');
  const [bookedFor, setBookedFor] = useState<string>();

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

  // The plate is already in the base: offer that car (and its open job, if any). Not as typed — the code
  // left out, another emirate: the cars with that number are offered to pick (`findVehiclesByNumber`).
  const found = useLiveQuery(async () => {
    if (picked) return { match: undefined, byNumber: [] as CheckInCar[] };
    const m = await findVehicleForCheckIn(plate);
    return { match: m, byNumber: m ? [] : await findVehiclesByNumber(plate) };
  }, [picked, plate.emirate, plate.code, plate.number]);
  const match = found?.match;
  const byNumber = found?.byNumber ?? [];
  const suggestions = useLiveQuery(() => (picked || pickedCustomer ? [] : suggestCustomers(phone, name)), [picked, pickedCustomer, phone, name]) ?? [];
  // A plate already in the base (no job open on it) is that car: taken by itself, with its photo and owner.
  const auto = !picked && match && !match.activeOrder ? match : undefined;
  const known = picked ?? auto;
  const owner = known?.owner ?? pickedCustomer;

  // Complaint chips: the garage's list (Settings → Lists) — English by default, as it goes on the documents.
  const complaints = quickList(settings, 'complaints');
  const addQuick = (phrase: string) => {
    setComplaint((c) => (c.includes(phrase) ? c : c ? `${c}, ${phrase}` : phrase));
  };

  const submit = (target: 'job' | 'book') =>
    run(async () => {
      const o = await checkIn({
        vehicleId: known?.vehicle.id,
        plate,
        make: canonicalMake(make),
        model: canonicalModel(make, model),
        customerId: owner?.id,
        name,
        phone,
        docLanguage,
        complaint,
        arrivedNow: target !== 'book',
        bookedFor: target === 'book' ? bookedFor : undefined,
      });
      if (!picked) rememberEmirate(plate.emirate);
      // Straight to the job: findings, prices and the customer's answer all happen there.
      navigate(`/orders/${o.id}`, { replace: true });
    });

  const noName = t('customer.noName');
  return (
    <>
      <PageHeader back title={t('newOrder.title')} right={<DocImportButton />} />
      <Stack gap={0}>
        <div className="group-title">{t('newOrder.vehicle')}</div>
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
            <PlateBlock plate={plate} onChange={setPlate} />
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
                    onClick={() => (c.activeOrder ? navigate(`/orders/${c.activeOrder.id}`) : setPicked(c))}
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
                      {c.activeOrder ? t('newOrder.openOrder') : t('newOrder.useThis')}
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

        <div className="group-title" style={{ marginTop: 22 }}>
          {t('job.complaint')}
        </div>
        <Box className="surface" p="md">
          <div className="chip-row wrap">
            {complaints.map((p) => (
              <button key={p} type="button" className="chip" data-active={complaint.includes(p)} onClick={() => addQuick(p)}>
                {p}
              </button>
            ))}
          </div>
          <Textarea mt="sm" aria-label={t('order.complaint')} placeholder={t('order.complaintHint')} autosize minRows={2} value={complaint} onChange={(e) => setComplaint(e.currentTarget.value)} />
        </Box>

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


        <RowGroup>
          <FormRow label={t('newOrder.bookLater')}>
            <Switch checked={later} onChange={(e) => setLater(e.currentTarget.checked)} aria-label={t('newOrder.bookLater')} />
          </FormRow>
          {later && (
            <Box px="md" pb="md" pt={4} className="rise-enter">
              <DateTimeField label={t('newOrder.bookedFor')} value={bookedFor} onChange={setBookedFor} />
            </Box>
          )}
        </RowGroup>
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
