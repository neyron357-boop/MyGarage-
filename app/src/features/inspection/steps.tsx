import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Checkbox,
  Chip,
  Group,
  Loader,
  Modal,
  NumberInput,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { IconAlertTriangle, IconCamera, IconCameraOff, IconCheck, IconCircleCheck, IconCircleX, IconFileDescription, IconMinus, IconRefresh, IconTrash, IconVideo } from '@tabler/icons-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate, formatDateTime } from '../../domain/dates';
import { EXTRA_SLOTS, FUEL_LEVELS, FUNCTION_CHECKS, REQUIRED_SLOTS, WARNING_LIGHTS } from '../../domain/inspection';
import { itemAmounts, itemTitle } from '../../domain/items';
import type { CheckState, DamageMark, DamageType, DamageView, FuelLevel, Inspection, Media } from '../../domain/types';
import { addDamageMark, addInspectionPhoto, removeDamageMark, updateDamageMark, updateInspection } from '../../services/inspections';
import { deleteMedia, mediaUrl } from '../../services/media';
import type { OrderBundle } from '../../services/orders';
import { AngleHint } from '../../ui/AngleHint';
import { CaptureButton } from '../../ui/CaptureButton';
import { List, ListRow, MediaImage, Money, MoneyInput, Photo, PlateText, SelectCard } from '../../ui/components';
import { DAMAGE_COLORS, DamageDiagram } from '../../ui/DamageDiagram';
import { DateTimeField } from '../../ui/DateFields';
import { useAction, useLang } from '../../ui/hooks';
import { LazyTextarea, LazyTextInput } from '../../ui/LazyText';

export interface StepProps {
  insp: Inspection;
  media: Media[];
  marks: DamageMark[];
  b: OrderBundle;
  intakeMedia?: Media[];
}

const save = (insp: Inspection, patch: Partial<Inspection>) => updateInspection(insp.id, patch);

function useMediaUrl(id?: string, thumb = true) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    if (id) void mediaUrl(id, thumb).then((u) => alive && setUrl(u));
    else setUrl(undefined);
    return () => {
      alive = false;
    };
  }, [id, thumb]);
  return url;
}

function Card({ children, p = 'md' }: { children: ReactNode; p?: string }) {
  return (
    <Box className="surface" p={p}>
      {children}
    </Box>
  );
}

/** One photo slot: camera-position hint when empty, the photo with time stamp when taken. */
export function PhotoSlot({ insp, slot, media, before, required }: { insp: Inspection; slot: string; media: Media[]; before?: Media; required?: boolean }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [reason, setReason] = useState('');
  const photo = media.find((m) => m.slot === slot && m.kind === 'photo');
  const skipped = insp.skippedPhotos[slot];
  const url = useMediaUrl(photo?.id);
  const beforeUrl = useMediaUrl(before?.id);
  const pick = () => input.current?.click();
  const onFiles = (files: File[]) =>
    run(async () => {
      if (photo && !insp.locked) await deleteMedia(photo.id);
      await addInspectionPhoto(insp.id, slot, files[0]);
      setPreview(false);
    });
  return (
    <Stack gap={6}>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          if (files.length) onFiles(files);
        }}
      />
      <button
        type="button"
        className={`photo-slot${photo ? ' filled' : ''}${skipped && !photo ? ' skipped' : ''}`}
        onClick={() => (photo ? setPreview(true) : !insp.locked && !skipped ? pick() : undefined)}
        aria-label={t(`slot.${slot}`)}
      >
        {photo && url ? (
          <>
            <img src={url} alt="" />
            <span className="stamp">{formatDateTime(photo.createdAt).slice(11)}</span>
            <span className="check">
              <IconCheck size={14} stroke={3} />
            </span>
            {beforeUrl && (
              <span className="inset">
                <img src={beforeUrl} alt="" />
              </span>
            )}
          </>
        ) : skipped ? (
          <Stack align="center" gap={4} p={8}>
            <IconCameraOff size={22} color="var(--mantine-color-yellow-8)" />
            <Text size="xs" ta="center" lineClamp={3} fw={500}>
              {skipped}
            </Text>
          </Stack>
        ) : beforeUrl ? (
          <>
            <img src={beforeUrl} alt="" className="ghost" />
            <span className="ghost-label">
              <IconCamera size={15} /> {t('photos.sameAngle')}
            </span>
          </>
        ) : (
          <Stack align="center" gap={2}>
            <AngleHint slot={slot} />
            <Group gap={4} c="cobalt.6">
              <IconCamera size={15} />
              <Text size="xs" fw={700} c="cobalt.6">
                {t('photos.take')}
              </Text>
            </Group>
          </Stack>
        )}
        {busy && (
          <span className="busy">
            <Loader size="sm" />
          </span>
        )}
      </button>
      <Group justify="space-between" wrap="nowrap" gap={4} align="flex-start">
        <Text size="xs" fw={600} lineClamp={2} lh={1.3}>
          {t(`slot.${slot}`)}
          {required && !photo && !skipped && (
            <Text span c="red" inherit>
              {' '}
              *
            </Text>
          )}
        </Text>
        {!insp.locked &&
          !photo &&
          (skipped ? (
            <Anchor component="button" size="xs" onClick={() => { const s = { ...insp.skippedPhotos }; delete s[slot]; void save(insp, { skippedPhotos: s }); }}>
              {t('photos.unskip')}
            </Anchor>
          ) : (
            <Anchor component="button" size="xs" c="dimmed" onClick={() => setSkipOpen(true)}>
              {t('photos.skip')}
            </Anchor>
          ))}
      </Group>
      <Modal opened={preview} onClose={() => setPreview(false)} title={t(`slot.${slot}`)} size="xl" padding="sm">
        {photo && <MediaImage id={photo.id} thumb={false} h="62vh" w="100%" />}
        <Group justify="space-between" mt="sm">
          <Text size="xs" c="dimmed">
            {photo && formatDateTime(photo.createdAt)} · SHA-256 {photo?.sha256.slice(0, 12)}
          </Text>
          {!insp.locked && (
            <Group gap="xs">
              <Button variant="default" color="red" leftSection={<IconTrash size={16} />} onClick={() => photo && run(async () => { await deleteMedia(photo.id); setPreview(false); })}>
                {t('common.delete')}
              </Button>
              <Button leftSection={<IconRefresh size={16} />} onClick={pick}>
                {t('photos.retake')}
              </Button>
            </Group>
          )}
        </Group>
      </Modal>
      <Modal opened={skipOpen} onClose={() => setSkipOpen(false)} title={t('photos.skipReason')}>
        <Group gap={6} mb="sm">
          {['dark', 'dirty', 'noSpace', 'customerRush'].map((r) => (
            <Chip key={r} checked={reason === t(`photos.reasons.${r}`)} onChange={() => setReason(t(`photos.reasons.${r}`))}>
              {t(`photos.reasons.${r}`)}
            </Chip>
          ))}
        </Group>
        <TextInput value={reason} onChange={(e) => setReason(e.currentTarget.value)} placeholder={t('common.reason')} />
        <Text size="xs" c="dimmed" mt={6}>
          {t('photos.skipHint')}
        </Text>
        <Button
          fullWidth
          mt="md"
          disabled={!reason.trim()}
          onClick={() => {
            void save(insp, { skippedPhotos: { ...insp.skippedPhotos, [slot]: reason.trim() } });
            setSkipOpen(false);
            setReason('');
          }}
        >
          {t('common.save')}
        </Button>
      </Modal>
    </Stack>
  );
}

export function VehicleStep({ insp, media, b }: StepProps) {
  const { t } = useTranslation();
  return (
    <Stack gap="md">
      <Card>
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <div>
            <PlateText plate={b.vehicle.plate} size="md" />
            <Title order={4} mt="sm">
              {b.vehicle.make} {b.vehicle.model} {b.vehicle.year ?? ''}
            </Title>
            {b.vehicle.vin && (
              <Text size="xs" c="dimmed" ff="monospace" mt={2}>
                VIN {b.vehicle.vin}
              </Text>
            )}
          </div>
          <Badge variant="light" size="lg">
            {t(`lang.${insp.language}`)}
          </Badge>
        </Group>
        <Text size="sm" mt="sm">
          {b.customer.name} · {b.customer.phone}
        </Text>
        <Text size="xs" c="dimmed" mt={4}>
          {t('intake.langHint', { lang: t(`lang.${insp.language}`) })}
        </Text>
      </Card>
      <Card>
        <Text fw={700}>{t('slot.mulkiya')}</Text>
        <Text size="sm" c="dimmed" mb="sm">
          {t('intake.mulkiyaHint')}
        </Text>
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <PhotoSlot insp={insp} slot="mulkiya" media={media} />
        </SimpleGrid>
      </Card>
    </Stack>
  );
}

export function PhotosStep({ insp, media, intakeMedia }: StepProps) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const done = REQUIRED_SLOTS.filter((s) => media.some((m) => m.slot === s) || insp.skippedPhotos[s]).length;
  const extras = media.filter((m) => m.slot === 'extra' && m.kind === 'photo');
  const video = media.find((m) => m.kind === 'video');
  return (
    <Stack gap="md">
      <Card>
        <Group justify="space-between" mb={6}>
          <Text size="sm" fw={600}>
            {insp.kind === 'handover' ? t('photos.hintHandover') : t('photos.hint')}
          </Text>
          <Text fw={800} className="display" fz={18} c={done === REQUIRED_SLOTS.length ? 'green' : undefined}>
            {done} / {REQUIRED_SLOTS.length}
          </Text>
        </Group>
        <Progress value={(done / REQUIRED_SLOTS.length) * 100} color={done === REQUIRED_SLOTS.length ? 'green' : 'cobalt'} size="sm" />
      </Card>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm" verticalSpacing="md">
        {REQUIRED_SLOTS.map((s) => (
          <PhotoSlot key={s} insp={insp} slot={s} media={media} required before={intakeMedia?.find((m) => m.slot === s)} />
        ))}
      </SimpleGrid>
      <Title order={5} mt="sm">
        {t('photos.extra')}
      </Title>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm" verticalSpacing="md">
        {EXTRA_SLOTS.filter((s) => s !== 'extra').map((s) => (
          <PhotoSlot key={s} insp={insp} slot={s} media={media} before={intakeMedia?.find((m) => m.slot === s)} />
        ))}
      </SimpleGrid>
      <Group gap="xs">
        {extras.map((m) => (
          <Photo key={m.id} id={m.id} h={72} />
        ))}
        {!insp.locked && (
          <CaptureButton variant="default" multiple loading={busy} onFiles={(files) => run(async () => { for (const f of files) await addInspectionPhoto(insp.id, 'extra', f); })}>
            {t('photos.addMore')}
          </CaptureButton>
        )}
        {!insp.locked && !video && (
          <CaptureButton variant="default" accept="video/*" leftSection={<IconVideo size={18} />} loading={busy} onFiles={(files) => run(() => addInspectionPhoto(insp.id, 'video', files[0]))}>
            {t('photos.video')}
          </CaptureButton>
        )}
        {video && (
          <Badge size="lg" leftSection={<IconVideo size={14} />} color="green">
            {t('photos.videoSaved')}
          </Badge>
        )}
      </Group>
    </Stack>
  );
}

const DAMAGE_TYPES: DamageType[] = ['scratch', 'dent', 'chip', 'crack', 'rust', 'other'];
const VIEWS: DamageView[] = ['top', 'left', 'right', 'front', 'rear'];

export function DamageStep({ insp, media, marks }: StepProps) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [view, setView] = useState<DamageView>('top');
  const [editing, setEditing] = useState<DamageMark | null>(null);
  const editPhoto = editing ? media.find((m) => m.id === editing.mediaId) : undefined;
  return (
    <Stack gap="md">
      <Card>
        <Text size="sm" c="dimmed" mb="sm">
          {t('damage.hint')}
        </Text>
        <SegmentedControl
          fullWidth
          value={view}
          onChange={(v) => setView(v as DamageView)}
          data={VIEWS.map((v) => {
            const n = marks.filter((m) => m.view === v).length;
            return { value: v, label: `${t(`damage.view.${v}`)}${n ? ` · ${n}` : ''}` };
          })}
        />
        <Box mt="md">
          <DamageDiagram
            view={view}
            marks={marks}
            height={280}
            onAdd={insp.locked ? undefined : (x, y) => run(async () => setEditing(await addDamageMark(insp.id, { view, x, y, type: 'scratch' })))}
            onSelect={setEditing}
          />
        </Box>
        <Group gap={10} mt="sm" justify="center">
          {DAMAGE_TYPES.map((d) => (
            <Group key={d} gap={5} wrap="nowrap">
              <span className="stage-dot" style={{ background: DAMAGE_COLORS[d] }} />
              <Text size="xs" c="dimmed">
                {t(`damage.type.${d}`)}
              </Text>
            </Group>
          ))}
        </Group>
      </Card>
      {marks.length === 0 ? (
        <SelectCard active={!!insp.noDamage} onClick={() => !insp.locked && void save(insp, { noDamage: !insp.noDamage })}>
          <Group gap="sm" wrap="nowrap">
            <Checkbox checked={!!insp.noDamage} onChange={() => undefined} tabIndex={-1} size="md" />
            <div>
              <Text fw={700} size="sm">
                {t('damage.none')}
              </Text>
              <Text size="xs" c="dimmed">
                {t('damage.noneHint')}
              </Text>
            </div>
          </Group>
        </SelectCard>
      ) : (
        <List>
          {marks.map((m, i) => (
            <ListRow
              key={m.id}
              onClick={() => setEditing(m)}
              chevron
              left={
                <Box w={28} h={28} style={{ borderRadius: '50%', background: DAMAGE_COLORS[m.type], color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
                  {i + 1}
                </Box>
              }
              title={t(`damage.type.${m.type}`)}
              subtitle={`${t(`damage.view.${m.view}`)}${m.note ? ` · ${m.note}` : ''}${m.mediaId ? ` · ${t('damage.hasPhoto')}` : ''}`}
            />
          ))}
        </List>
      )}
      <Modal opened={!!editing} onClose={() => setEditing(null)} title={t('damage.mark')}>
        {editing && (
          <Stack>
            <SimpleGrid cols={3} spacing="xs">
              {DAMAGE_TYPES.map((d) => (
                <SelectCard key={d} active={editing.type === d} onClick={() => !insp.locked && run(async () => { await updateDamageMark(editing.id, { type: d }); setEditing({ ...editing, type: d }); })}>
                  <Group gap={6} wrap="nowrap">
                    <span className="stage-dot" style={{ background: DAMAGE_COLORS[d] }} />
                    <Text size="sm" fw={600}>
                      {t(`damage.type.${d}`)}
                    </Text>
                  </Group>
                </SelectCard>
              ))}
            </SimpleGrid>
            <LazyTextInput label={t('common.notes')} placeholder={t('damage.notePlaceholder')} value={editing.note} disabled={insp.locked} onCommit={(note) => run(async () => { await updateDamageMark(editing.id, { note }); setEditing({ ...editing, note }); })} />
            {editPhoto ? (
              <Photo id={editPhoto.id} h={180} w="100%" />
            ) : (
              !insp.locked && (
                <CaptureButton
                  variant="light"
                  loading={busy}
                  onFiles={(files) =>
                    run(async () => {
                      const m = await addInspectionPhoto(insp.id, 'damage', files[0]);
                      await updateDamageMark(editing.id, { mediaId: m.id });
                      setEditing({ ...editing, mediaId: m.id });
                    })
                  }
                >
                  {t('damage.closeup')}
                </CaptureButton>
              )
            )}
            <Group justify="space-between">
              {!insp.locked ? (
                <Button color="red" variant="subtle" leftSection={<IconTrash size={16} />} onClick={() => run(async () => { await removeDamageMark(editing.id); setEditing(null); })}>
                  {t('common.delete')}
                </Button>
              ) : (
                <span />
              )}
              <Button onClick={() => setEditing(null)}>{t('common.done')}</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

export function DashboardStep({ insp, media, b, intakeMedia }: StepProps) {
  const { t } = useTranslation();
  const intake = insp.kind === 'handover' ? b.intake : undefined;
  const testKm = (b.order.testDriveEndKm ?? 0) - (b.order.testDriveStartKm ?? 0);
  const delta = intake?.mileageKm !== undefined && insp.mileageKm !== undefined ? insp.mileageKm - intake.mileageKm : undefined;
  return (
    <Stack gap="md">
      <Card>
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <PhotoSlot insp={insp} slot="dashboard" media={media} before={intakeMedia?.find((m) => m.slot === 'dashboard')} />
        </SimpleGrid>
        <Text size="xs" c="dimmed" mt="xs">
          {t('intake.dashboardHint')}
        </Text>
      </Card>
      <Card>
        <NumberInput
          label={t('intake.mileage')}
          size="lg"
          suffix={` ${t('unit.km')}`}
          thousandSeparator=" "
          min={0}
          allowDecimal={false}
          hideControls
          inputMode="numeric"
          value={insp.mileageKm ?? ''}
          disabled={insp.locked}
          onChange={(v) => void save(insp, { mileageKm: typeof v === 'number' ? v : undefined })}
          description={intake?.mileageKm !== undefined ? `${t('handover.atIntake')}: ${intake.mileageKm.toLocaleString('ru-RU')} ${t('unit.km')}` : undefined}
          styles={{ input: { fontFamily: 'var(--font-display)', fontSize: 24, letterSpacing: '0.04em' } }}
        />
        {delta !== undefined && delta > Math.max(0, testKm) + 10 && (
          <Alert mt="sm" color="orange" icon={<IconAlertTriangle size={18} />}>
            {t('handover.mileageWarning', { delta, test: Math.max(0, testKm) })}
          </Alert>
        )}
        <Text size="sm" fw={600} mt="lg" mb={6}>
          {t('intake.fuel')}
          {intake?.fuelLevel !== undefined && (
            <Text span size="xs" c="dimmed" fw={500}>
              {' '}
              · {t('handover.atIntake')}: {t(`fuel.${intake.fuelLevel}`)}
            </Text>
          )}
        </Text>
        <SegmentedControl
          fullWidth
          size="md"
          disabled={insp.locked}
          value={insp.fuelLevel !== undefined ? String(insp.fuelLevel) : ''}
          onChange={(v) => void save(insp, { fuelLevel: Number(v) as FuelLevel })}
          data={FUEL_LEVELS.map((f) => ({ value: String(f), label: t(`fuel.${f}`) }))}
        />
      </Card>
      <Card>
        <Text size="sm" fw={600} mb={8}>
          {t('intake.lights')}
        </Text>
        <Chip.Group multiple value={insp.warningLights} onChange={(v) => void save(insp, { warningLights: v })}>
          <Group gap={6}>
            {WARNING_LIGHTS.map((l) => (
              <Chip key={l} value={l} color="red" variant="light" disabled={insp.locked}>
                {t(`light.${l}`)}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
        <Text size="xs" c="dimmed" mt="sm">
          {insp.warningLights.length === 0 ? t('intake.noLights') : t('intake.lightsCount', { n: insp.warningLights.length })}
          {intake && intake.warningLights.length > 0 && ` · ${t('handover.atIntake')}: ${intake.warningLights.map((l) => t(`light.${l}`)).join(', ')}`}
        </Text>
      </Card>
    </Stack>
  );
}

export function ObdStep({ insp, media }: StepProps) {
  const { t } = useTranslation();
  return (
    <Stack gap="md">
      <Card>
        <Text size="sm" c="dimmed" mb="sm">
          {t('intake.obdHint')}
        </Text>
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <PhotoSlot insp={insp} slot="obd" media={media} />
        </SimpleGrid>
      </Card>
      <Card>
        <TagsInput
          label={t('intake.obdCodes')}
          description={t('intake.obdCodesHint')}
          placeholder="P0300"
          value={insp.obdCodes}
          disabled={insp.locked || insp.obdNoCodes}
          onChange={(v) => void save(insp, { obdCodes: v.map((c) => c.toUpperCase().trim()).filter(Boolean) })}
        />
      </Card>
      <SelectCard active={!!insp.obdNoCodes} onClick={() => !insp.locked && insp.obdCodes.length === 0 && void save(insp, { obdNoCodes: !insp.obdNoCodes })}>
        <Group gap="sm" wrap="nowrap">
          <Checkbox checked={!!insp.obdNoCodes} onChange={() => undefined} tabIndex={-1} size="md" disabled={insp.obdCodes.length > 0} />
          <Text fw={700} size="sm">
            {t('intake.obdNone')}
          </Text>
        </Group>
      </SelectCard>
      {!insp.obdNoCodes && insp.obdCodes.length === 0 && (
        <LazyTextInput label={t('intake.obdSkip')} placeholder={t('intake.obdSkipPlaceholder')} value={insp.obdSkipReason} disabled={insp.locked} onCommit={(v) => void save(insp, { obdSkipReason: v })} />
      )}
    </Stack>
  );
}

const CHECK_ICON = { ok: IconCircleCheck, fail: IconCircleX, unchecked: IconMinus } as const;

export function ChecksStep({ insp }: StepProps) {
  const { t } = useTranslation();
  const set = (c: string, v: CheckState) => void save(insp, { functionChecks: { ...insp.functionChecks, [c]: v } });
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {t('intake.checksHint')}
        </Text>
        {!insp.locked && (
          <Button size="compact-sm" variant="light" color="green" onClick={() => void save(insp, { functionChecks: Object.fromEntries(FUNCTION_CHECKS.map((c) => [c, insp.functionChecks[c] === 'fail' ? 'fail' : 'ok'])) })}>
            {t('intake.allWork')}
          </Button>
        )}
      </Group>
      <List>
        {FUNCTION_CHECKS.map((c) => {
          const v = insp.functionChecks[c] ?? 'unchecked';
          return (
            <ListRow
              key={c}
              title={t(`check.${c}`)}
              right={
                <Group gap={4} wrap="nowrap">
                  {(['ok', 'fail', 'unchecked'] as const).map((s) => {
                    const I = CHECK_ICON[s];
                    const color = s === 'ok' ? 'green' : s === 'fail' ? 'red' : 'gray';
                    return (
                      <Button key={s} size="compact-md" px={10} variant={v === s ? 'filled' : 'default'} color={color} disabled={insp.locked} onClick={() => set(c, s)} aria-label={t(`check.state.${s}`)}>
                        <I size={18} />
                      </Button>
                    );
                  })}
                </Group>
              }
            />
          );
        })}
      </List>
    </Stack>
  );
}

export function BelongingsStep({ insp }: StepProps) {
  const { t } = useTranslation();
  return (
    <Stack gap="md">
      <Card>
        <Text size="sm" fw={600} mb={6}>
          {t('intake.keys')}
        </Text>
        <SegmentedControl size="md" fullWidth disabled={insp.locked} value={String(insp.keysCount ?? '')} onChange={(v) => void save(insp, { keysCount: Number(v) })} data={['1', '2', '3']} />
      </Card>
      <List>
        <ListRow title={t('intake.spareWheel')} right={<Switch checked={!!insp.spareWheel} disabled={insp.locked} onChange={(e) => void save(insp, { spareWheel: e.currentTarget.checked })} />} />
        <ListRow title={t('intake.jack')} right={<Switch checked={!!insp.jack} disabled={insp.locked} onChange={(e) => void save(insp, { jack: e.currentTarget.checked })} />} />
        <ListRow title={t('intake.mulkiyaInCar')} right={<Switch checked={!!insp.mulkiyaInCar} disabled={insp.locked} onChange={(e) => void save(insp, { mulkiyaInCar: e.currentTarget.checked })} />} />
      </List>
      <Card>
        <LazyTextarea label={t('intake.belongings')} placeholder={t('intake.belongingsHint')} value={insp.belongings} disabled={insp.locked} onCommit={(v) => void save(insp, { belongings: v })} />
      </Card>
    </Stack>
  );
}

export function ComplaintStep({ insp, media }: StepProps) {
  const { t } = useTranslation();
  return (
    <Stack gap="md">
      <Card>
        <LazyTextarea label={t('order.complaint')} description={t('intake.complaintHint')} value={insp.complaint} disabled={insp.locked} onCommit={(v) => void save(insp, { complaint: v })} minRows={4} />
      </Card>
      <Card>
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <div>
            <Text fw={700} size="sm">
              {t('intake.accident')}
            </Text>
            <Text size="xs" c="dimmed" mt={2}>
              {t('intake.accidentHint')}
            </Text>
          </div>
          <Switch checked={!!insp.accidentRepair} disabled={insp.locked} onChange={(e) => void save(insp, { accidentRepair: e.currentTarget.checked })} />
        </Group>
        {insp.accidentRepair && (
          <Stack mt="md">
            <LazyTextInput label={t('intake.policeReport')} required value={insp.policeReportNo} disabled={insp.locked} onCommit={(v) => void save(insp, { policeReportNo: v })} leftSection={<IconFileDescription size={18} />} />
            <SimpleGrid cols={{ base: 2, sm: 4 }}>
              <PhotoSlot insp={insp} slot="police_report" media={media} required />
            </SimpleGrid>
          </Stack>
        )}
      </Card>
    </Stack>
  );
}

export function ConditionsStep({ insp }: StepProps) {
  const { t } = useTranslation();
  const c = insp.conditions!;
  const set = (patch: Partial<typeof c>) => void save(insp, { conditions: { ...c, ...patch } });
  const presets = [0, 10000, 20000, 50000];
  return (
    <Stack gap="md">
      <Card>
        <Text fw={700} size="sm">
          {t('cond.noCallLimit')}
        </Text>
        <Text size="xs" c="dimmed" mb="sm">
          {t('cond.noCallLimitHint')}
        </Text>
        <Group gap={6} mb="sm">
          {presets.map((p) => (
            <Chip key={p} checked={c.noCallLimitFils === p} onChange={() => !insp.locked && set({ noCallLimitFils: p })}>
              {p === 0 ? t('cond.alwaysCall') : `${p / 100} AED`}
            </Chip>
          ))}
        </Group>
        <MoneyInput label={t('cond.limitAmount')} value={c.noCallLimitFils} onChange={(f) => set({ noCallLimitFils: f ?? 0 })} />
      </Card>
      <Card>
        <Text fw={700} size="sm" mb="sm">
          {t('cond.oldParts')}
        </Text>
        <SimpleGrid cols={2} spacing="xs">
          {(['return', 'dispose'] as const).map((o) => (
            <SelectCard key={o} active={c.oldParts === o} onClick={() => !insp.locked && set({ oldParts: o })}>
              <Text size="sm" fw={600}>
                {t(`cond.${o}`)}
              </Text>
            </SelectCard>
          ))}
        </SimpleGrid>
        <Group justify="space-between" mt="md" wrap="nowrap">
          <div>
            <Text fw={700} size="sm">
              {t('cond.testDrive')}
            </Text>
            <Text size="xs" c="dimmed">
              {t('cond.testDriveHint')}
            </Text>
          </div>
          <Switch checked={c.testDriveAllowed} disabled={insp.locked} onChange={(e) => set({ testDriveAllowed: e.currentTarget.checked })} />
        </Group>
      </Card>
      <Card>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <NumberInput label={t('cond.freeStorage')} min={0} value={c.freeStorageDays} disabled={insp.locked} onChange={(v) => set({ freeStorageDays: Number(v) || 0 })} />
          <MoneyInput label={t('cond.storageFee')} value={c.storageFeePerDayFils} onChange={(f) => set({ storageFeePerDayFils: f ?? 0 })} />
          <MoneyInput label={t('cond.diagnosticsFee')} value={c.diagnosticsFeeFils} onChange={(f) => set({ diagnosticsFeeFils: f ?? 0 })} />
        </SimpleGrid>
        <Box mt="md">
          <DateTimeField label={t('cond.promised')} placeholder={t('common.notSet')} disabled={insp.locked} value={c.promisedReadyAt} onChange={(v) => set({ promisedReadyAt: v })} />
        </Box>
      </Card>
    </Stack>
  );
}

/** Handover summary: what was done, what the customer declined, warranty. */
export function WorkSummaryStep({ b }: StepProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const approved = b.items.filter((i) => i.approvalState === 'approved');
  const declined = b.items.filter((i) => i.approvalState === 'declined');
  const declinedAt = (id: string) => b.decisions.filter((d) => d.itemId === id && d.decision === 'decline').pop()?.decidedAt;
  return (
    <Stack gap="md">
      <List>
        {approved.map((i) => (
          <ListRow
            key={i.id}
            left={
              <ThemeIcon variant="light" color={i.done ? 'green' : 'gray'} radius="xl">
                {i.done ? <IconCheck size={16} /> : <IconMinus size={16} />}
              </ThemeIcon>
            }
            title={itemTitle(i, lang)}
            subtitle={[i.partNumber, i.customerSupplied ? t('item.customerSupplied') : ''].filter(Boolean).join(' · ') || undefined}
            right={<Money fils={itemAmounts(i).gross} size="sm" />}
          />
        ))}
      </List>
      {declined.length > 0 && (
        <Alert color="orange" title={t('handover.declined')}>
          <Stack gap={4}>
            {declined.map((i) => (
              <Text key={i.id} size="sm">
                {itemTitle(i, lang)} — {t('handover.declinedOn', { date: formatDate(declinedAt(i.id)) })}
              </Text>
            ))}
          </Stack>
        </Alert>
      )}
      <Card>
        <Text size="sm">
          <b>{t('cond.oldParts')}:</b> {t(`cond.${b.intake?.conditions?.oldParts ?? 'return'}`)}
        </Text>
        <Text size="sm" mt="sm" c="dimmed">
          {(b.settings.warrantyText[lang] ?? '').replace('{months}', String(b.settings.warrantyLaborMonths)).replace('{km}', String(b.settings.warrantyLaborKm))}
        </Text>
      </Card>
    </Stack>
  );
}
