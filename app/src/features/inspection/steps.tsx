import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Chip,
  Group,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconAlertTriangle, IconCamera, IconTrash, IconVideo } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../domain/dates';
import { EXTRA_SLOTS, FUEL_LEVELS, FUNCTION_CHECKS, REQUIRED_SLOTS, WARNING_LIGHTS } from '../../domain/inspection';
import { itemAmounts, itemTitle } from '../../domain/items';
import type { CheckState, DamageMark, DamageType, DamageView, FuelLevel, Inspection, Media } from '../../domain/types';
import { addDamageMark, addInspectionPhoto, removeDamageMark, updateDamageMark, updateInspection } from '../../services/inspections';
import { deleteMedia } from '../../services/media';
import type { OrderBundle } from '../../services/orders';
import { CaptureButton } from '../../ui/CaptureButton';
import { MediaImage, Money, MoneyInput, Photo } from '../../ui/components';
import { DAMAGE_COLORS, DamageDiagram, ViewPicker } from '../../ui/DamageDiagram';
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

/** One photo slot: shows the photo or a camera button, with "skip with reason". */
export function PhotoSlot({ insp, slot, media, before, required }: { insp: Inspection; slot: string; media: Media[]; before?: Media; required?: boolean }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [skipOpen, setSkipOpen] = useState(false);
  const [reason, setReason] = useState('');
  const photo = media.find((m) => m.slot === slot && m.kind === 'photo');
  const skipped = insp.skippedPhotos[slot];
  return (
    <Paper withBorder p={6} radius="md">
      <Group justify="space-between" mb={4} wrap="nowrap">
        <Text size="sm" fw={600} lineClamp={1}>
          {t(`slot.${slot}`)}
          {required && !photo && !skipped ? ' *' : ''}
        </Text>
        {photo && !insp.locked && (
          <ActionIcon size="sm" variant="subtle" color="red" onClick={() => run(() => deleteMedia(photo.id))} aria-label={t('common.delete')}>
            <IconTrash size={14} />
          </ActionIcon>
        )}
      </Group>
      <Group gap={4} wrap="nowrap" grow>
        {before && (
          <Box>
            <MediaImage id={before.id} h={90} w="100%" />
            <Text size="10px" c="dimmed" ta="center">{t('handover.before')}</Text>
          </Box>
        )}
        <Box>
          {photo ? (
            <Photo id={photo.id} h={90} w="100%" />
          ) : skipped ? (
            <Paper h={90} withBorder bg="var(--mantine-color-yellow-light)" p={4} style={{ overflow: 'hidden' }}>
              <Text size="xs">{t('photos.skipped')}: {skipped}</Text>
            </Paper>
          ) : (
            <CaptureButton
              h={90}
              fullWidth
              variant="light"
              loading={busy}
              disabled={insp.locked}
              onFiles={(files) => run(async () => { for (const f of files) await addInspectionPhoto(insp.id, slot, f); })}
            >
              {t('photos.take')}
            </CaptureButton>
          )}
          {before && <Text size="10px" c="dimmed" ta="center">{t('handover.after')}</Text>}
        </Box>
      </Group>
      {!photo && !insp.locked && (
        <Group justify="space-between" mt={4}>
          {skipped ? (
            <Button size="compact-xs" variant="subtle" onClick={() => { const s = { ...insp.skippedPhotos }; delete s[slot]; void save(insp, { skippedPhotos: s }); }}>
              {t('photos.unskip')}
            </Button>
          ) : (
            <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setSkipOpen(true)}>
              {t('photos.skip')}
            </Button>
          )}
        </Group>
      )}
      <Modal opened={skipOpen} onClose={() => setSkipOpen(false)} title={t('photos.skipReason')}>
        <Group gap={6} mb="sm">
          {['dark', 'dirty', 'noSpace', 'customerRush'].map((r) => (
            <Chip key={r} checked={reason === t(`photos.reasons.${r}`)} onChange={() => setReason(t(`photos.reasons.${r}`))}>
              {t(`photos.reasons.${r}`)}
            </Chip>
          ))}
        </Group>
        <TextInput value={reason} onChange={(e) => setReason(e.currentTarget.value)} placeholder={t('common.reason')} />
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
    </Paper>
  );
}

export function VehicleStep({ insp, media, b }: StepProps) {
  const { t } = useTranslation();
  return (
    <Stack>
      <Paper withBorder p="md">
        <Text fw={700}>{b.vehicle.make} {b.vehicle.model} {b.vehicle.year ?? ''}</Text>
        <Text size="sm">{b.customer.name} · {b.customer.phone}</Text>
        {b.vehicle.vin && <Text size="sm" c="dimmed">VIN {b.vehicle.vin}</Text>}
        <Text size="sm" c="dimmed">{t('customer.docLanguage')}: {t(`lang.${insp.language}`)}</Text>
      </Paper>
      <Text size="sm" c="dimmed">{t('intake.mulkiyaHint')}</Text>
      <SimpleGrid cols={2}>
        <PhotoSlot insp={insp} slot="mulkiya" media={media} />
      </SimpleGrid>
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
    <Stack>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">{t('photos.hint')}</Text>
        <Badge color={done === REQUIRED_SLOTS.length ? 'green' : 'orange'} size="lg">{done} / {REQUIRED_SLOTS.length}</Badge>
      </Group>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
        {REQUIRED_SLOTS.map((s) => (
          <PhotoSlot key={s} insp={insp} slot={s} media={media} required before={intakeMedia?.find((m) => m.slot === s)} />
        ))}
      </SimpleGrid>
      <Title order={6}>{t('photos.extra')}</Title>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
        {EXTRA_SLOTS.filter((s) => s !== 'extra').map((s) => (
          <PhotoSlot key={s} insp={insp} slot={s} media={media} before={intakeMedia?.find((m) => m.slot === s)} />
        ))}
      </SimpleGrid>
      <Group gap="xs">
        {extras.map((m) => <Photo key={m.id} id={m.id} h={70} />)}
        {!insp.locked && (
          <CaptureButton variant="default" size="sm" multiple loading={busy} onFiles={(files) => run(async () => { for (const f of files) await addInspectionPhoto(insp.id, 'extra', f); })}>
            {t('photos.addMore')}
          </CaptureButton>
        )}
        {!insp.locked && !video && (
          <CaptureButton variant="default" size="sm" accept="video/*" leftSection={<IconVideo size={18} />} loading={busy} onFiles={(files) => run(() => addInspectionPhoto(insp.id, 'video', files[0]))}>
            {t('photos.video')}
          </CaptureButton>
        )}
        {video && <Badge leftSection={<IconVideo size={12} />}>{t('photos.videoSaved')}</Badge>}
      </Group>
    </Stack>
  );
}

const DAMAGE_TYPES: DamageType[] = ['scratch', 'dent', 'chip', 'crack', 'rust', 'other'];

export function DamageStep({ insp, media, marks }: StepProps) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [view, setView] = useState<DamageView>('top');
  const [editing, setEditing] = useState<DamageMark | null>(null);
  const editPhoto = editing ? media.find((m) => m.id === editing.mediaId) : undefined;
  return (
    <Stack>
      <Text size="sm" c="dimmed">{t('damage.hint')}</Text>
      <ViewPicker value={view} onChange={setView} marks={marks} />
      <Paper withBorder p="xs">
        <DamageDiagram
          view={view}
          marks={marks}
          onAdd={insp.locked ? undefined : (x, y) => run(async () => setEditing(await addDamageMark(insp.id, { view, x, y, type: 'scratch' })))}
          onSelect={setEditing}
        />
      </Paper>
      <Group gap={6}>
        {DAMAGE_TYPES.map((d) => (
          <Badge key={d} color={DAMAGE_COLORS[d]} variant="dot">{t(`damage.type.${d}`)}</Badge>
        ))}
      </Group>
      {marks.length === 0 && (
        <Checkbox
          size="md"
          label={t('damage.none')}
          checked={!!insp.noDamage}
          disabled={insp.locked}
          onChange={(e) => void save(insp, { noDamage: e.currentTarget.checked })}
        />
      )}
      <Stack gap={4}>
        {marks.map((m, i) => (
          <Paper key={m.id} withBorder p="xs" className="tap-card" onClick={() => setEditing(m)}>
            <Group justify="space-between">
              <Text size="sm">
                <b>{i + 1}.</b> {t(`damage.type.${m.type}`)} · {t(`damage.view.${m.view}`)}
                {m.note ? ` · ${m.note}` : ''}
              </Text>
              {m.mediaId && <IconCamera size={16} />}
            </Group>
          </Paper>
        ))}
      </Stack>
      <Modal opened={!!editing} onClose={() => setEditing(null)} title={t('damage.mark')}>
        {editing && (
          <Stack>
            <Group gap={6}>
              {DAMAGE_TYPES.map((d) => (
                <Chip key={d} checked={editing.type === d} disabled={insp.locked} onChange={() => run(async () => { await updateDamageMark(editing.id, { type: d }); setEditing({ ...editing, type: d }); })}>
                  {t(`damage.type.${d}`)}
                </Chip>
              ))}
            </Group>
            <LazyTextInput label={t('common.notes')} value={editing.note} disabled={insp.locked} onCommit={(note) => run(async () => { await updateDamageMark(editing.id, { note }); setEditing({ ...editing, note }); })} />
            {editPhoto ? (
              <Photo id={editPhoto.id} h={160} w="100%" />
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
              {!insp.locked && (
                <Button color="red" variant="subtle" leftSection={<IconTrash size={16} />} onClick={() => run(async () => { await removeDamageMark(editing.id); setEditing(null); })}>
                  {t('common.delete')}
                </Button>
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
    <Stack>
      <SimpleGrid cols={{ base: 2, sm: 3 }}>
        <PhotoSlot insp={insp} slot="dashboard" media={media} before={intakeMedia?.find((m) => m.slot === 'dashboard')} />
      </SimpleGrid>
      <NumberInput
        label={t('intake.mileage')}
        size="lg"
        suffix=" km"
        thousandSeparator=" "
        min={0}
        allowDecimal={false}
        value={insp.mileageKm ?? ''}
        disabled={insp.locked}
        onChange={(v) => void save(insp, { mileageKm: typeof v === 'number' ? v : undefined })}
        description={intake?.mileageKm !== undefined ? `${t('handover.atIntake')}: ${intake.mileageKm} km` : undefined}
      />
      {delta !== undefined && delta > Math.max(0, testKm) + 10 && (
        <Alert color="orange" icon={<IconAlertTriangle />}>
          {t('handover.mileageWarning', { delta, test: Math.max(0, testKm) })}
        </Alert>
      )}
      <div>
        <Text size="sm" fw={500} mb={4}>{t('intake.fuel')}{intake?.fuelLevel !== undefined ? ` (${t('handover.atIntake')}: ${t(`fuel.${intake.fuelLevel}`)})` : ''}</Text>
        <SegmentedControl
          fullWidth
          disabled={insp.locked}
          value={insp.fuelLevel !== undefined ? String(insp.fuelLevel) : ''}
          onChange={(v) => void save(insp, { fuelLevel: Number(v) as FuelLevel })}
          data={FUEL_LEVELS.map((f) => ({ value: String(f), label: t(`fuel.${f}`) }))}
        />
      </div>
      <div>
        <Text size="sm" fw={500} mb={4}>{t('intake.lights')}</Text>
        <Chip.Group multiple value={insp.warningLights} onChange={(v) => void save(insp, { warningLights: v })}>
          <Group gap={6}>
            {WARNING_LIGHTS.map((l) => (
              <Chip key={l} value={l} color="red" disabled={insp.locked}>
                {t(`light.${l}`)}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
        {intake && intake.warningLights.length > 0 && (
          <Text size="xs" c="dimmed" mt={4}>{t('handover.atIntake')}: {intake.warningLights.map((l) => t(`light.${l}`)).join(', ')}</Text>
        )}
      </div>
    </Stack>
  );
}

export function ObdStep({ insp, media }: StepProps) {
  const { t } = useTranslation();
  return (
    <Stack>
      <Text size="sm" c="dimmed">{t('intake.obdHint')}</Text>
      <SimpleGrid cols={{ base: 2, sm: 3 }}>
        <PhotoSlot insp={insp} slot="obd" media={media} />
      </SimpleGrid>
      <TagsInput
        label={t('intake.obdCodes')}
        placeholder="P0300"
        value={insp.obdCodes}
        disabled={insp.locked || insp.obdNoCodes}
        onChange={(v) => void save(insp, { obdCodes: v.map((c) => c.toUpperCase().trim()).filter(Boolean) })}
      />
      <Checkbox size="md" label={t('intake.obdNone')} checked={!!insp.obdNoCodes} disabled={insp.locked || insp.obdCodes.length > 0} onChange={(e) => void save(insp, { obdNoCodes: e.currentTarget.checked })} />
      {!insp.obdNoCodes && insp.obdCodes.length === 0 && (
        <LazyTextInput label={t('intake.obdSkip')} value={insp.obdSkipReason} disabled={insp.locked} onCommit={(v) => void save(insp, { obdSkipReason: v })} />
      )}
    </Stack>
  );
}

export function ChecksStep({ insp }: StepProps) {
  const { t } = useTranslation();
  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">{t('intake.checksHint')}</Text>
      {FUNCTION_CHECKS.map((c) => (
        <Group key={c} justify="space-between" wrap="nowrap">
          <Text size="sm">{t(`check.${c}`)}</Text>
          <SegmentedControl
            size="xs"
            disabled={insp.locked}
            value={insp.functionChecks[c] ?? 'unchecked'}
            onChange={(v) => void save(insp, { functionChecks: { ...insp.functionChecks, [c]: v as CheckState } })}
            data={[
              { value: 'ok', label: '✓' },
              { value: 'fail', label: '✗' },
              { value: 'unchecked', label: '—' },
            ]}
            color={insp.functionChecks[c] === 'fail' ? 'red' : insp.functionChecks[c] === 'ok' ? 'green' : undefined}
          />
        </Group>
      ))}
      <Text size="xs" c="dimmed">✓ {t('check.state.ok')} · ✗ {t('check.state.fail')} · — {t('check.state.unchecked')}</Text>
    </Stack>
  );
}

export function BelongingsStep({ insp }: StepProps) {
  const { t } = useTranslation();
  return (
    <Stack>
      <div>
        <Text size="sm" fw={500} mb={4}>{t('intake.keys')}</Text>
        <SegmentedControl fullWidth disabled={insp.locked} value={String(insp.keysCount ?? '')} onChange={(v) => void save(insp, { keysCount: Number(v) })} data={['1', '2', '3']} />
      </div>
      <Switch size="md" label={t('intake.spareWheel')} checked={!!insp.spareWheel} disabled={insp.locked} onChange={(e) => void save(insp, { spareWheel: e.currentTarget.checked })} />
      <Switch size="md" label={t('intake.jack')} checked={!!insp.jack} disabled={insp.locked} onChange={(e) => void save(insp, { jack: e.currentTarget.checked })} />
      <Switch size="md" label={t('intake.mulkiyaInCar')} checked={!!insp.mulkiyaInCar} disabled={insp.locked} onChange={(e) => void save(insp, { mulkiyaInCar: e.currentTarget.checked })} />
      <LazyTextarea label={t('intake.belongings')} placeholder={t('intake.belongingsHint')} value={insp.belongings} disabled={insp.locked} onCommit={(v) => void save(insp, { belongings: v })} />
    </Stack>
  );
}

export function ComplaintStep({ insp, media }: StepProps) {
  const { t } = useTranslation();
  return (
    <Stack>
      <LazyTextarea label={t('order.complaint')} description={t('intake.complaintHint')} value={insp.complaint} disabled={insp.locked} onCommit={(v) => void save(insp, { complaint: v })} minRows={4} />
      <Paper withBorder p="md">
        <Switch size="md" label={t('intake.accident')} description={t('intake.accidentHint')} checked={!!insp.accidentRepair} disabled={insp.locked} onChange={(e) => void save(insp, { accidentRepair: e.currentTarget.checked })} />
        {insp.accidentRepair && (
          <Stack mt="sm">
            <LazyTextInput label={t('intake.policeReport')} required value={insp.policeReportNo} disabled={insp.locked} onCommit={(v) => void save(insp, { policeReportNo: v })} />
            <SimpleGrid cols={2}>
              <PhotoSlot insp={insp} slot="police_report" media={media} required />
            </SimpleGrid>
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}

export function ConditionsStep({ insp }: StepProps) {
  const { t } = useTranslation();
  const c = insp.conditions!;
  const set = (patch: Partial<typeof c>) => void save(insp, { conditions: { ...c, ...patch } });
  const presets = [0, 10000, 20000, 50000];
  return (
    <Stack>
      <div>
        <Text size="sm" fw={500}>{t('cond.noCallLimit')}</Text>
        <Text size="xs" c="dimmed" mb={4}>{t('cond.noCallLimitHint')}</Text>
        <SegmentedControl
          fullWidth
          disabled={insp.locked}
          value={presets.includes(c.noCallLimitFils) ? String(c.noCallLimitFils) : 'custom'}
          onChange={(v) => v !== 'custom' && set({ noCallLimitFils: Number(v) })}
          data={[...presets.map((p) => ({ value: String(p), label: p === 0 ? t('cond.alwaysCall') : `${p / 100}` })), { value: 'custom', label: '…' }]}
        />
        <Box mt={6}>
          <MoneyInput label={t('cond.limitAmount')} value={c.noCallLimitFils} onChange={(f) => set({ noCallLimitFils: f ?? 0 })} />
        </Box>
      </div>
      <div>
        <Text size="sm" fw={500} mb={4}>{t('cond.oldParts')}</Text>
        <SegmentedControl fullWidth disabled={insp.locked} value={c.oldParts} onChange={(v) => set({ oldParts: v as 'return' | 'dispose' })} data={[{ value: 'return', label: t('cond.return') }, { value: 'dispose', label: t('cond.dispose') }]} />
      </div>
      <Switch size="md" label={t('cond.testDrive')} checked={c.testDriveAllowed} disabled={insp.locked} onChange={(e) => set({ testDriveAllowed: e.currentTarget.checked })} />
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <NumberInput label={t('cond.freeStorage')} min={0} value={c.freeStorageDays} disabled={insp.locked} onChange={(v) => set({ freeStorageDays: Number(v) || 0 })} />
        <MoneyInput label={t('cond.storageFee')} value={c.storageFeePerDayFils} onChange={(f) => set({ storageFeePerDayFils: f ?? 0 })} />
        <MoneyInput label={t('cond.diagnosticsFee')} value={c.diagnosticsFeeFils} onChange={(f) => set({ diagnosticsFeeFils: f ?? 0 })} />
      </SimpleGrid>
      <TextInput type="datetime-local" label={t('cond.promised')} disabled={insp.locked} value={c.promisedReadyAt ? c.promisedReadyAt.slice(0, 16) : ''} onChange={(e) => set({ promisedReadyAt: e.currentTarget.value || undefined })} />
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
    <Stack>
      <Title order={6}>{t('handover.done')}</Title>
      {approved.map((i) => (
        <Group key={i.id} justify="space-between" wrap="nowrap">
          <Text size="sm">
            {i.done ? '✅' : '⬜'} {itemTitle(i, lang)}
            {i.partNumber ? ` (${i.partNumber})` : ''}
            {i.customerSupplied ? ` · ${t('item.customerSupplied')}` : ''}
          </Text>
          <Money fils={itemAmounts(i).gross} size="sm" />
        </Group>
      ))}
      {declined.length > 0 && (
        <>
          <Title order={6} mt="sm">{t('handover.declined')}</Title>
          {declined.map((i) => (
            <Text key={i.id} size="sm" c="orange">
              ✗ {itemTitle(i, lang)} — {t('handover.declinedOn', { date: formatDate(declinedAt(i.id)) })}
            </Text>
          ))}
        </>
      )}
      <Text size="sm">{t('cond.oldParts')}: {t(`cond.${b.intake?.conditions?.oldParts ?? 'return'}`)}</Text>
      <Paper withBorder p="sm">
        <Text size="sm">
          {(b.settings.warrantyText[lang] ?? '')
            .replace('{months}', String(b.settings.warrantyLaborMonths))
            .replace('{km}', String(b.settings.warrantyLaborKm))}
        </Text>
      </Paper>
    </Stack>
  );
}
