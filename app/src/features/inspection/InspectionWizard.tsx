import { Alert, Badge, Box, Button, Group, SimpleGrid, Stack, Text, Textarea, TextInput, ThemeIcon, Title } from '@mantine/core';
import { IconArrowLeft, IconArrowRight, IconCheck, IconFileTypePdf, IconLock, IconSend, IconSignature, IconX } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../../db/db';
import { formatDateTime } from '../../domain/dates';
import { REQUIRED_SLOTS, validateInspection, type MissingKey } from '../../domain/inspection';
import { formatAed } from '../../domain/money';
import type { Inspection } from '../../domain/types';
import { inspectionPdf, openPdf } from '../../services/documents';
import { addAddendum, getOrCreateInspection, inspectionState, signInspection, updateInspection } from '../../services/inspections';
import { simpleMessage } from '../../services/messages';
import { bundleAmountDue } from '../../services/orders';
import { Field, PageHeader, PlateText, Section, StickyBar } from '../../ui/components';
import { useAction, useErrorText, useOrderBundle } from '../../ui/hooks';
import { SendDialog, type SendRequest } from '../../ui/SendDialog';
import { SignatureBox, type SignatureHandle } from '../../ui/SignatureBox';
import { PaymentPanel } from '../money/PaymentPanel';
import {
  BelongingsStep,
  ChecksStep,
  ComplaintStep,
  ConditionsStep,
  DamageStep,
  DashboardStep,
  ObdStep,
  PhotosStep,
  VehicleStep,
  WorkSummaryStep,
  type StepProps,
} from './steps';

type StepDef = { key: string; C: ComponentType<StepProps> };

function PaymentStep({ b }: StepProps) {
  const { t } = useTranslation();
  const due = bundleAmountDue(b);
  return (
    <Stack>
      {due <= 0 || b.debts.some((d) => d.status === 'open') ? (
        <Alert color="green" icon={<IconCheck />}>
          {t('handover.paidOk')}
        </Alert>
      ) : (
        <Alert color="orange">{t('handover.payFirst')}</Alert>
      )}
      <PaymentPanel b={b} allowDebt />
    </Stack>
  );
}

const Empty = () => null;

const INTAKE_STEPS: StepDef[] = [
  { key: 'vehicle', C: VehicleStep },
  { key: 'photos', C: PhotosStep },
  { key: 'damage', C: DamageStep },
  { key: 'dashboard', C: DashboardStep },
  { key: 'obd', C: ObdStep },
  { key: 'checks', C: ChecksStep },
  { key: 'belongings', C: BelongingsStep },
  { key: 'complaint', C: ComplaintStep },
  { key: 'conditions', C: ConditionsStep },
  { key: 'sign', C: Empty },
];

const HANDOVER_STEPS: StepDef[] = [
  { key: 'photos', C: PhotosStep },
  { key: 'dashboard', C: DashboardStep },
  { key: 'summary', C: WorkSummaryStep },
  { key: 'payment', C: PaymentStep },
  { key: 'sign', C: Empty },
];

const MISSING_STEP: Record<MissingKey, string> = {
  photos: 'photos',
  damage: 'damage',
  mileage: 'dashboard',
  fuel: 'dashboard',
  obd: 'obd',
  complaint: 'complaint',
  policeReport: 'complaint',
  conditions: 'conditions',
  signer: 'sign',
};

/** Whether a step already has what it needs (drives the check marks). */
function stepDone(key: string, p: StepProps): boolean {
  const { insp, media, marks, b } = p;
  const slots = new Set(media.map((m) => m.slot));
  switch (key) {
    case 'vehicle':
      return true;
    case 'photos':
      return REQUIRED_SLOTS.every((s) => slots.has(s) || insp.skippedPhotos[s]);
    case 'damage':
      return !!insp.noDamage || marks.length > 0;
    case 'dashboard':
      return insp.mileageKm !== undefined && insp.fuelLevel !== undefined;
    case 'obd':
      return !!insp.obdNoCodes || insp.obdCodes.length > 0 || !!insp.obdSkipReason?.trim();
    case 'checks':
      return Object.values(insp.functionChecks).some((v) => v !== 'unchecked');
    case 'belongings':
      return insp.keysCount !== undefined;
    case 'complaint':
      return !!insp.complaint?.trim() && (!insp.accidentRepair || (!!insp.policeReportNo?.trim() && slots.has('police_report')));
    case 'conditions':
      return !!insp.conditions;
    case 'summary':
      return true;
    case 'payment':
      return bundleAmountDue(b) <= 0 || b.debts.some((d) => d.status === 'open');
    case 'sign':
      return insp.locked;
    default:
      return false;
  }
}

function SignStep({ props, onSigned, goTo }: { props: StepProps; onSigned: (i: Inspection) => void; goTo: (key: string) => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const { insp, media, marks, b } = props;
  const sig = useRef<SignatureHandle>(null);
  const [name, setName] = useState(b.customer.name);
  const lang = insp.language;
  const tc = (k: string, o?: Record<string, unknown>) => t(k, { ...o, lng: lang });
  const slots = new Set(media.filter((m) => m.kind === 'photo' || m.kind === 'video').map((m) => m.slot));
  const missing = validateInspection(insp, slots, marks, { policePhoto: slots.has('police_report') });
  const unpaid = insp.kind === 'handover' && bundleAmountDue(b) > 0 && !b.debts.some((d) => d.status === 'open');
  const c = insp.conditions;
  const fails = Object.entries(insp.functionChecks)
    .filter(([, v]) => v === 'fail')
    .map(([k]) => tc(`check.${k}`));
  return (
    <Stack gap="md">
      {missing.length > 0 && (
        <Alert color="red" title={t('sign.missingTitle')}>
          <Group gap={6} mt={4}>
            {missing.map((m) => (
              <Button key={m} size="compact-sm" variant="white" color="red" h="auto" py={4} styles={{ label: { whiteSpace: 'normal', textAlign: 'left' } }} onClick={() => goTo(MISSING_STEP[m])}>
                {t(`missing.${m}`)}
              </Button>
            ))}
          </Group>
        </Alert>
      )}
      {unpaid && (
        <Alert color="red">
          {t('handover.payFirst')}{' '}
          <Button size="compact-sm" variant="white" color="red" onClick={() => goTo('payment')}>
            {t('step.payment')}
          </Button>
        </Alert>
      )}
      <Box className="surface" p="lg" style={{ borderTop: '4px solid var(--mantine-color-cobalt-6)' }}>
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <div>
            <div className="eyebrow">{b.settings.name}</div>
            <Title order={4} mt={2}>
              {tc(insp.kind === 'intake' ? 'pdf.intakeTitle' : 'pdf.handoverTitle')}
            </Title>
            <Text size="xs" c="dimmed">
              №{b.order.number} · {formatDateTime(new Date().toISOString())}
            </Text>
          </div>
          <PlateText plate={b.vehicle.plate} size="sm" />
        </Group>
        <SimpleGrid cols={{ base: 2, sm: 3 }} mt="md" spacing="md" verticalSpacing="sm">
          <Field label={tc('pdf.vehicle')}>
            {b.vehicle.make} {b.vehicle.model} {b.vehicle.year ?? ''}
          </Field>
          <Field label={tc('pdf.customer')}>{b.customer.name}</Field>
          <Field label={tc('pdf.photos')}>{media.filter((m) => m.kind === 'photo').length}</Field>
          <Field label={tc('intake.mileage')}>{insp.mileageKm !== undefined ? `${insp.mileageKm.toLocaleString('ru-RU')} km` : '—'}</Field>
          <Field label={tc('intake.fuel')}>{insp.fuelLevel !== undefined ? tc(`fuel.${insp.fuelLevel}`) : '—'}</Field>
          <Field label={tc('intake.lights')}>{insp.warningLights.length ? insp.warningLights.map((l) => tc(`light.${l}`)).join(', ') : tc('pdf.none')}</Field>
          {insp.kind === 'intake' && (
            <>
              <Field label={tc('pdf.damage')}>{insp.noDamage ? tc('damage.none') : marks.map((m, i) => `${i + 1}. ${tc(`damage.type.${m.type}`)}`).join(', ') || '—'}</Field>
              <Field label="OBD">{insp.obdNoCodes ? tc('intake.obdNone') : insp.obdCodes.join(', ') || insp.obdSkipReason || '—'}</Field>
              <Field label={tc('pdf.notWorking')}>{fails.join(', ') || tc('pdf.none')}</Field>
              <Field label={tc('intake.keys')}>{insp.keysCount ?? '—'}</Field>
              <Field label={tc('intake.belongings')}>{insp.belongings || tc('pdf.none')}</Field>
              {c && <Field label={tc('cond.noCallLimit')}>{c.noCallLimitFils ? formatAed(c.noCallLimitFils, lang) : tc('cond.alwaysCall')}</Field>}
            </>
          )}
        </SimpleGrid>
        {insp.kind === 'intake' && (
          <>
            <Field label={tc('order.complaint')}>{insp.complaint}</Field>
            <Text size="xs" c="dimmed" mt="md" lh={1.5}>
              {b.settings.intakeTerms[lang]}
            </Text>
          </>
        )}
        {insp.kind === 'handover' && (
          <Text size="sm" mt="md">
            {tc('pdf.handoverStatement')}
          </Text>
        )}
      </Box>
      <Box className="surface" p="md">
        <TextInput label={t('sign.name')} value={name} onChange={(e) => setName(e.currentTarget.value)} required mb="sm" />
        <SignatureBox ref={sig} height={190} />
      </Box>
      <Button
        size="lg"
        leftSection={<IconSignature />}
        loading={busy}
        disabled={missing.length > 0 || unpaid}
        onClick={() =>
          run(async () => {
            if (!sig.current || sig.current.isEmpty()) throw new Error(t('sign.required'));
            const signed = await signInspection(insp.id, name, sig.current.toBlob());
            onSigned(signed);
          }, 'sign.done')
        }
      >
        {t('sign.button')}
      </Button>
      <Text size="xs" c="dimmed" ta="center">
        {t('sign.freezeHint')}
      </Text>
    </Stack>
  );
}

export function InspectionWizard({ kind }: { kind: 'intake' | 'handover' }) {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const errorText = useErrorText();
  const { run, busy } = useAction();
  const b = useOrderBundle(id);
  const [inspId, setInspId] = useState<string>();
  const [error, setError] = useState<string>();
  const [send, setSend] = useState<SendRequest | null>(null);
  const [addendum, setAddendum] = useState('');
  useEffect(() => {
    if (!id) return;
    getOrCreateInspection(id, kind).then(
      (i) => setInspId(i.id),
      (e) => setError(errorText(e)),
    );
  }, [id, kind, errorText]);
  const st = useLiveQuery(() => (inspId ? inspectionState(inspId) : undefined), [inspId]);
  const addenda = useLiveQuery(() => (inspId ? db.addenda.where('inspectionId').equals(inspId).toArray() : []), [inspId]);
  const intakeMedia = useLiveQuery(async () => (kind === 'handover' && b?.intake ? db.media.where('ownerId').equals(b.intake.id).toArray() : undefined), [kind, b?.intake?.id]);
  const steps = kind === 'intake' ? INTAKE_STEPS : HANDOVER_STEPS;
  const [step, setStep] = useState<number | null>(null);
  useEffect(() => {
    if (st && step === null) setStep(Math.min(st.insp.step ?? 0, steps.length - 1));
  }, [st, step, steps.length]);

  if (error) return <Alert color="red">{error}</Alert>;
  if (!b || !st || step === null) return null;
  const { insp, media, marks } = st;
  const props: StepProps = { insp, media, marks, b, intakeMedia };
  const ctx = { customer: b.customer, vehicle: b.vehicle, order: b.order, garageName: b.settings.name };

  const goto = (n: number) => {
    setStep(n);
    if (!insp.locked) void updateInspection(insp.id, { step: n });
    window.scrollTo({ top: 0 });
  };
  const gotoKey = (key: string) => {
    const i = steps.findIndex((s) => s.key === key);
    if (i >= 0) goto(i);
  };

  const offerSend = (i: Inspection) =>
    setSend({
      text: simpleMessage(i.kind === 'intake' ? 'carReceived' : 'documents', ctx, i.language),
      template: i.kind === 'intake' ? 'carReceived' : 'documents',
      lang: i.language,
      orderId: b.order.id,
      pdf: () => inspectionPdf(i.id),
    });

  const title = t(kind === 'intake' ? 'intake.title' : 'handover.title');
  const subtitle = (
    <Group gap={8}>
      <PlateText plate={b.vehicle.plate} size="xs" />
      <span>
        {b.vehicle.make} {b.vehicle.model}
      </span>
      <Badge variant="light" size="sm">
        {t(`lang.${insp.language}`)}
      </Badge>
    </Group>
  );

  if (insp.locked) {
    return (
      <>
        <PageHeader back={`/orders/${b.order.id}`} eyebrow={`${t('order.title')} №${b.order.number}`} title={title} subtitle={subtitle} />
        <Stack gap="lg">
          <Box p="md" style={{ background: 'var(--mantine-color-green-light)', borderRadius: 'var(--mantine-radius-lg)' }}>
            <Group gap="sm" wrap="nowrap" align="flex-start">
              <ThemeIcon color="green" radius="xl" size={40}>
                <IconLock size={20} />
              </ThemeIcon>
              <div>
                <Text fw={700}>{t('sign.lockedTitle')}</Text>
                <Text size="sm">{t('sign.lockedText', { date: formatDateTime(insp.signedAt), name: insp.signerName })}</Text>
              </div>
            </Group>
            <Group mt="md" gap="xs">
              <Button leftSection={<IconFileTypePdf size={18} />} loading={busy} onClick={() => run(async () => openPdf(await inspectionPdf(insp.id)))}>
                {t('common.openPdf')}
              </Button>
              <Button variant="white" leftSection={<IconSend size={18} />} onClick={() => offerSend(insp)}>
                {t('common.sendClient')}
              </Button>
              <Button variant="subtle" color="dark" onClick={() => navigate(`/orders/${b.order.id}`)}>
                {t('order.open')}
              </Button>
            </Group>
          </Box>
          {steps.slice(0, -1).map((s) => (
            <Section key={s.key} title={t(`step.${s.key}`)} mt={0}>
              <s.C {...props} />
            </Section>
          ))}
          <Section title={t('sign.addenda')} description={t('sign.addendaHint')} mt={0}>
            <Box className="surface" p="md">
              {addenda?.map((a) => (
                <Text key={a.id} size="sm" mb={6}>
                  <Text span c="dimmed" size="xs">
                    {formatDateTime(a.createdAt)}
                  </Text>{' '}
                  {a.text}
                </Text>
              ))}
              <Textarea placeholder={t('sign.addendumHint')} value={addendum} onChange={(e) => setAddendum(e.currentTarget.value)} autosize minRows={2} />
              <Button mt="xs" variant="default" disabled={!addendum.trim()} onClick={() => run(async () => { await addAddendum(insp.id, addendum); setAddendum(''); }, 'common.saved')}>
                {t('sign.addAddendum')}
              </Button>
            </Box>
          </Section>
        </Stack>
        <SendDialog customer={b.customer} request={send} onClose={() => setSend(null)} />
      </>
    );
  }

  if (kind === 'handover' && b.order.stage !== 'ready') {
    return (
      <>
        <PageHeader back={`/orders/${b.order.id}`} title={title} subtitle={subtitle} />
        <Alert color="orange">{t('handover.notReady')}</Alert>
      </>
    );
  }

  const S = steps[step];
  const doneCount = steps.filter((s) => stepDone(s.key, props)).length;
  return (
    <>
      <PageHeader
        back={`/orders/${b.order.id}`}
        eyebrow={`${title} · ${t('common.step', { n: step + 1, total: steps.length })}`}
        title={t(`step.${S.key}`)}
        subtitle={subtitle}
        right={
          <Button variant="subtle" color="gray" size="compact-md" leftSection={<IconX size={16} />} onClick={() => navigate(`/orders/${b.order.id}`)}>
            {t('intake.later')}
          </Button>
        }
      />
      <div className="wizard-steps" role="tablist" aria-label={t('intake.stepsLabel', { done: doneCount, total: steps.length })}>
        {steps.map((s, i) => {
          const done = stepDone(s.key, props);
          return (
            <button key={s.key} type="button" data-active={i === step} data-done={done && i !== step} onClick={() => goto(i)} role="tab" aria-selected={i === step}>
              <span className="n">{done && i !== step ? <IconCheck size={13} stroke={3} /> : i + 1}</span>
              {t(`step.${s.key}`)}
            </button>
          );
        })}
      </div>
      <Box mt="lg">{S.key === 'sign' ? <SignStep props={props} goTo={gotoKey} onSigned={(i) => { offerSend(i); void inspectionPdf(i.id).catch(() => undefined); }} /> : <S.C {...props} />}</Box>
      {S.key !== 'sign' && (
        <StickyBar>
          <Group gap="xs" wrap="nowrap">
            <Button variant="default" disabled={step === 0} onClick={() => goto(step - 1)} leftSection={<IconArrowLeft size={18} />}>
              {t('common.back')}
            </Button>
            <Button style={{ flex: 1 }} onClick={() => goto(step + 1)} rightSection={<IconArrowRight size={18} />}>
              {step + 1 === steps.length - 1 ? t('intake.toSign') : t('common.next')}
            </Button>
          </Group>
        </StickyBar>
      )}
      <SendDialog
        customer={b.customer}
        request={send}
        onClose={() => {
          setSend(null);
          navigate(`/orders/${b.order.id}`);
        }}
      />
    </>
  );
}
