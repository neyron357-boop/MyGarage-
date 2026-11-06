import { Alert, Badge, Button, Group, Paper, Progress, Stack, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconCheck, IconFileTypePdf, IconLock, IconSend, IconSignature } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../../db/db';
import { formatDateTime } from '../../domain/dates';
import { validateInspection } from '../../domain/inspection';
import { formatAed } from '../../domain/money';
import type { Inspection } from '../../domain/types';
import { inspectionPdf, openPdf } from '../../services/documents';
import { addAddendum, getOrCreateInspection, inspectionState, signInspection, updateInspection } from '../../services/inspections';
import { simpleMessage } from '../../services/messages';
import { bundleAmountDue } from '../../services/orders';
import { PageHeader, PlateText } from '../../ui/components';
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
  { key: 'sign', C: () => null },
];

function PaymentStep({ b }: StepProps) {
  const { t } = useTranslation();
  const due = bundleAmountDue(b);
  return (
    <Stack>
      {due <= 0 || b.debts.some((d) => d.status === 'open') ? (
        <Alert color="green" icon={<IconCheck />}>{t('handover.paidOk')}</Alert>
      ) : (
        <Alert color="orange">{t('handover.payFirst')}</Alert>
      )}
      <PaymentPanel b={b} allowDebt />
    </Stack>
  );
}

const HANDOVER_STEPS: StepDef[] = [
  { key: 'photos', C: PhotosStep },
  { key: 'dashboard', C: DashboardStep },
  { key: 'summary', C: WorkSummaryStep },
  { key: 'payment', C: PaymentStep },
  { key: 'sign', C: () => null },
];

function SignStep({ props, onSigned }: { props: StepProps; onSigned: (i: Inspection) => void }) {
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
  const fails = Object.entries(insp.functionChecks).filter(([, v]) => v === 'fail').map(([k]) => tc(`check.${k}`));
  return (
    <Stack>
      {missing.length > 0 && (
        <Alert color="red" title={t('sign.missingTitle')}>
          {missing.map((m) => t(`missing.${m}`)).join(', ')}
        </Alert>
      )}
      {unpaid && <Alert color="red">{t('handover.payFirst')}</Alert>}
      <Paper withBorder p="md">
        <Title order={5} mb="xs">{tc(insp.kind === 'intake' ? 'pdf.intakeTitle' : 'pdf.handoverTitle')}</Title>
        <Group gap={6}><Text size="sm">{b.vehicle.make} {b.vehicle.model}</Text><PlateText plate={b.vehicle.plate} size="xs" /></Group>
        <Text size="sm">{tc('pdf.photos')}: {media.filter((m) => m.kind === 'photo').length}</Text>
        <Text size="sm">{tc('intake.mileage')}: {insp.mileageKm ?? '—'} km · {tc('intake.fuel')}: {insp.fuelLevel !== undefined ? tc(`fuel.${insp.fuelLevel}`) : '—'}</Text>
        <Text size="sm">{tc('intake.lights')}: {insp.warningLights.length ? insp.warningLights.map((l) => tc(`light.${l}`)).join(', ') : tc('pdf.none')}</Text>
        {insp.kind === 'intake' && (
          <>
            <Text size="sm">{tc('pdf.damage')}: {insp.noDamage ? tc('damage.none') : marks.map((m, i) => `${i + 1}. ${tc(`damage.type.${m.type}`)} (${tc(`damage.view.${m.view}`)})`).join('; ')}</Text>
            <Text size="sm">OBD: {insp.obdNoCodes ? tc('intake.obdNone') : insp.obdCodes.join(', ') || insp.obdSkipReason || '—'}</Text>
            {fails.length > 0 && <Text size="sm">{tc('pdf.notWorking')}: {fails.join(', ')}</Text>}
            <Text size="sm">{tc('intake.keys')}: {insp.keysCount ?? '—'} · {tc('intake.belongings')}: {insp.belongings || tc('pdf.none')}</Text>
            <Text size="sm">{tc('order.complaint')}: {insp.complaint}</Text>
            {c && (
              <Text size="sm" mt="xs">
                {tc('cond.noCallLimit')}: {c.noCallLimitFils ? formatAed(c.noCallLimitFils, lang) : tc('cond.alwaysCall')} · {tc('cond.oldParts')}: {tc(`cond.${c.oldParts}`)} · {tc('cond.testDrive')}: {c.testDriveAllowed ? tc('common.yes') : tc('common.no')} · {tc('cond.freeStorage')}: {c.freeStorageDays}
              </Text>
            )}
            <Text size="xs" c="dimmed" mt="xs">{b.settings.intakeTerms[lang]}</Text>
          </>
        )}
        {insp.kind === 'handover' && <Text size="xs" c="dimmed" mt="xs">{tc('pdf.handoverStatement')}</Text>}
      </Paper>
      <TextInput label={t('sign.name')} value={name} onChange={(e) => setName(e.currentTarget.value)} required />
      <SignatureBox ref={sig} />
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
    getOrCreateInspection(id, kind).then((i) => setInspId(i.id), (e) => setError(errorText(e)));
  }, [id, kind, errorText]);
  const st = useLiveQuery(() => (inspId ? inspectionState(inspId) : undefined), [inspId]);
  const addenda = useLiveQuery(() => (inspId ? db.addenda.where('inspectionId').equals(inspId).toArray() : []), [inspId]);
  const intakeMedia = useLiveQuery(
    async () => (kind === 'handover' && b?.intake ? db.media.where('ownerId').equals(b.intake.id).toArray() : undefined),
    [kind, b?.intake?.id],
  );
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

  const offerSend = (i: Inspection) =>
    setSend({
      text: simpleMessage(i.kind === 'intake' ? 'carReceived' : 'documents', ctx, i.language),
      template: i.kind === 'intake' ? 'carReceived' : 'documents',
      lang: i.language,
      orderId: b.order.id,
      pdf: () => inspectionPdf(i.id),
    });

  const title = t(kind === 'intake' ? 'intake.title' : 'handover.title');
  const header = (
    <PageHeader
      title={title}
      back={`/orders/${b.order.id}`}
      subtitle={
        <Group gap={6}>
          <PlateText plate={b.vehicle.plate} size="xs" />
          {b.vehicle.make} {b.vehicle.model} · №{b.order.number}
        </Group>
      }
    />
  );

  if (insp.locked) {
    return (
      <>
        {header}
        <Stack>
          <Alert color="green" icon={<IconLock />} title={t('sign.lockedTitle')}>
            {t('sign.lockedText', { date: formatDateTime(insp.signedAt), name: insp.signerName })}
          </Alert>
          <Group>
            <Button leftSection={<IconFileTypePdf />} loading={busy} onClick={() => run(async () => openPdf(await inspectionPdf(insp.id)))}>{t('common.openPdf')}</Button>
            <Button variant="light" leftSection={<IconSend />} onClick={() => offerSend(insp)}>{t('common.sendClient')}</Button>
            <Button variant="default" onClick={() => navigate(`/orders/${b.order.id}`)}>{t('order.open')}</Button>
          </Group>
          {steps.slice(0, -1).map((s) => (
            <Paper key={s.key} withBorder p="md">
              <Title order={6} mb="xs">{t(`step.${s.key}`)}</Title>
              <s.C {...props} />
            </Paper>
          ))}
          <Paper withBorder p="md">
            <Title order={6} mb="xs">{t('sign.addenda')}</Title>
            {addenda?.map((a) => <Text key={a.id} size="sm">{formatDateTime(a.createdAt)} — {a.text}</Text>)}
            <Textarea mt="xs" placeholder={t('sign.addendumHint')} value={addendum} onChange={(e) => setAddendum(e.currentTarget.value)} />
            <Button mt="xs" variant="default" disabled={!addendum.trim()} onClick={() => run(async () => { await addAddendum(insp.id, addendum); setAddendum(''); }, 'common.saved')}>{t('sign.addAddendum')}</Button>
          </Paper>
        </Stack>
        <SendDialog customer={b.customer} request={send} onClose={() => setSend(null)} />
      </>
    );
  }

  if (kind === 'handover' && b.order.stage !== 'ready') {
    return (
      <>
        {header}
        <Alert color="orange">{t('handover.notReady')}</Alert>
      </>
    );
  }

  const S = steps[step];
  return (
    <>
      {header}
      <Group justify="space-between" mb={4}>
        <Text fw={700}>{t('common.step', { n: step + 1, total: steps.length })}: {t(`step.${S.key}`)}</Text>
        <Badge variant="light">{t(`lang.${insp.language}`)}</Badge>
      </Group>
      <Progress value={((step + 1) / steps.length) * 100} mb="md" />
      <Group gap={4} mb="md" wrap="wrap">
        {steps.map((s, i) => (
          <Button key={s.key} size="compact-xs" variant={i === step ? 'filled' : 'default'} onClick={() => goto(i)}>
            {i + 1}
          </Button>
        ))}
      </Group>
      {S.key === 'sign' ? (
        <SignStep
          props={props}
          onSigned={(i) => {
            offerSend(i);
            void inspectionPdf(i.id).catch(() => undefined);
          }}
        />
      ) : (
        <S.C {...props} />
      )}
      <Group justify="space-between" mt="xl" className="no-print">
        <Button variant="default" disabled={step === 0} onClick={() => goto(step - 1)}>{t('common.back')}</Button>
        {step < steps.length - 1 && <Button onClick={() => goto(step + 1)}>{t('common.next')}</Button>}
      </Group>
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
