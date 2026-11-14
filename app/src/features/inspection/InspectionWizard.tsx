import { Alert, Badge, Box, Button, Group, Stack, Switch, Text, Textarea, TextInput, ThemeIcon } from '@mantine/core';
import { IconArrowLeft, IconArrowRight, IconCheck, IconFileTypePdf, IconLock, IconSend } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../../db/db';
import { formatDateTime } from '../../domain/dates';
import { REQUIRED_SLOTS } from '../../domain/inspection';
import type { Inspection } from '../../domain/types';
import { inspectionPdf, openPdf } from '../../services/documents';
import { addAddendum, completeInspection, getOrCreateInspection, inspectionState, signInspection, updateInspection } from '../../services/inspections';
import { simpleMessage } from '../../services/messages';
import { updateOrder } from '../../services/orders';
import { haptic } from '../../ui/haptics';
import { EmptyState, FormRow, PageHeader, PageSkeleton, PlateText, RowGroup, Section, StickyBar, SuccessMark } from '../../ui/components';
import { DateTimeField } from '../../ui/DateFields';
import { useAction, useErrorText, useOrderBundle } from '../../ui/hooks';
import { scrollToTop } from '../../ui/stack';
import { SendDialog, type SendRequest } from '../../ui/SendDialog';
import { SignatureBox, type SignatureHandle } from '../../ui/SignatureBox';
import {
  BelongingsStep,
  ChecksStep,
  ComplaintStep,
  ConditionsStep,
  DamageStep,
  DashboardStep,
  ObdStep,
  PhotosStep,
  type StepProps,
} from './steps';

type StepDef = { key: string; C: ComponentType<StepProps> };

const Empty = () => null;

/**
 * Fast check-in: six steps, none of them required. The car and customer were taken on the new-job
 * screen; belongings, a repeated complaint/accident question and the long terms are gone.
 */
const INTAKE_STEPS: StepDef[] = [
  { key: 'photos', C: PhotosStep },
  { key: 'damage', C: DamageStep },
  { key: 'dashboard', C: DashboardStep },
  { key: 'obd', C: ObdStep },
  { key: 'checks', C: ChecksStep },
  { key: 'finish', C: Empty },
];

/** Parts of acts signed before the fast check-in, still shown read-only on those acts. */
function legacySteps(insp: Inspection): StepDef[] {
  if (insp.kind !== 'intake') return [];
  return [
    ...(insp.keysCount !== undefined || insp.belongings ? [{ key: 'belongings', C: BelongingsStep }] : []),
    ...(insp.accidentRepair || insp.policeReportNo ? [{ key: 'complaint', C: ComplaintStep }] : []),
    ...(insp.conditions?.noCallLimitFils !== undefined ? [{ key: 'conditions', C: ConditionsStep }] : []),
  ];
}

/** Whether a step already has what it needs (drives the check marks). */
function stepDone(key: string, p: StepProps): boolean {
  const { insp, media, marks } = p;
  const slots = new Set(media.map((m) => m.slot));
  switch (key) {
    case 'vehicle':
      return true;
    case 'photos':
      return REQUIRED_SLOTS.some((s) => slots.has(s));
    case 'damage':
      return !!insp.noDamage || marks.length > 0;
    case 'dashboard':
      return insp.mileageKm !== undefined || insp.fuelLevel !== undefined;
    case 'finish':
      return insp.locked || !!insp.completedAt;
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
    default:
      return false;
  }
}

/**
 * Last intake step: promised ready time, test drive, and the customer's signature if they give it.
 * One "Save": with a signature the act is signed and frozen, without it the act stays editable.
 */
function FinishStep({ props, onDone }: { props: StepProps; onDone: (i: Inspection, signed: boolean) => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const { insp, b } = props;
  const sig = useRef<SignatureHandle>(null);
  const [name, setName] = useState(b.customer.name);
  const c = insp.conditions ?? { testDriveAllowed: true };
  return (
    <Stack gap={0}>
      <div className="group-title">{t('finish.readyTitle')}</div>
      <RowGroup mt={0}>
        <Box px="md" py="sm">
          <DateTimeField label={t('cond.promised')} placeholder={t('common.notSet')} value={b.order.promisedReadyAt} onChange={(v) => void updateOrder(b.order.id, { promisedReadyAt: v })} />
        </Box>
        <FormRow label={t('cond.testDrive')}>
          <Switch checked={c.testDriveAllowed} onChange={(e) => void updateInspection(insp.id, { conditions: { ...c, testDriveAllowed: e.currentTarget.checked } })} aria-label={t('cond.testDrive')} />
        </FormRow>
      </RowGroup>
      <div className="group-title" style={{ marginTop: 22 }}>
        {t('finish.signTitle')}
      </div>
      <Box className="surface" p="md">
        <TextInput label={t('sign.name')} value={name} onChange={(e) => setName(e.currentTarget.value)} mb="sm" />
        <SignatureBox ref={sig} height={170} />
      </Box>
      <div className="group-note">{t('finish.signNote')}</div>
      <Button
        mt="lg"
        size="lg"
        h={52}
        radius="md"
        loading={busy}
        onClick={() =>
          run(async () => {
            const signed = !!sig.current && !sig.current.isEmpty();
            const i = signed ? await signInspection(insp.id, name, sig.current!.toBlob()) : await completeInspection(insp.id);
            onDone(i, signed);
          }, 'finish.saved')
        }
      >
        {t('finish.save')}
      </Button>
    </Stack>
  );
}

/** The intake act: the car's photos, damage, dashboard, scanner, checks — none of it required ("…" → "Photos"). */
export function InspectionWizard() {
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
    getOrCreateInspection(id, 'intake').then(
      (i) => setInspId(i.id),
      (e) => setError(errorText(e)),
    );
  }, [id, errorText]);
  // null: the report is gone (its job was deleted while this screen waited in the stack).
  const st = useLiveQuery(() => (inspId ? inspectionState(inspId).catch(() => null) : undefined), [inspId]);
  const addenda = useLiveQuery(() => (inspId ? db.addenda.where('inspectionId').equals(inspId).toArray() : []), [inspId]);
  const steps = INTAKE_STEPS;
  const [step, setStep] = useState<number | null>(null);
  const [dir, setDir] = useState<'next' | 'prev'>('next');
  const [justSigned, setJustSigned] = useState(false);
  const chips = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (st && step === null) setStep(Math.min(st.insp.step ?? 0, steps.length - 1));
  }, [st, step, steps.length]);
  // Keep the current step chip visible in the scrolling row.
  useEffect(() => {
    const root = chips.current;
    const el = root?.querySelector<HTMLElement>('[data-active="true"]');
    if (!root || !el) return;
    root.scrollTo({ left: Math.max(0, el.offsetLeft - root.offsetLeft - root.clientWidth / 2 + el.offsetWidth / 2), behavior: 'smooth' });
  }, [step]);

  if (error) return <Alert color="red">{error}</Alert>;
  if (b === null || st === null) return <EmptyState title={t('err.notFound')} />;
  if (!b || !st || step === null) return <PageSkeleton variant="detail" />;
  const { insp, media, marks } = st;
  const props: StepProps = { insp, media, marks, b };
  const ctx = { customer: b.customer, vehicle: b.vehicle, order: b.order, garageName: b.settings.name };

  const goto = (n: number) => {
    if (n === step) return;
    setDir(n > step ? 'next' : 'prev');
    setStep(n);
    if (!insp.locked) void updateInspection(insp.id, { step: n });
    scrollToTop();
  };

  const offerSend = (i: Inspection) =>
    setSend({
      text: simpleMessage('carReceived', ctx, i.language),
      template: 'carReceived',
      lang: i.language,
      orderId: b.order.id,
      pdf: () => inspectionPdf(i.id),
    });

  const title = t('intake.title');
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
          <Box p="md" style={{ background: 'var(--mantine-color-green-light)', borderRadius: 'var(--mantine-radius-lg)' }} className={justSigned ? 'rise-enter' : undefined}>
            <Group gap="sm" wrap="nowrap" align={justSigned ? 'center' : 'flex-start'}>
              {justSigned ? (
                <SuccessMark size={48} />
              ) : (
                <ThemeIcon color="green" radius="xl" size={40}>
                  <IconLock size={20} />
                </ThemeIcon>
              )}
              <div>
                <Text fw={700}>{t('sign.lockedTitle')}</Text>
                <Text size="sm">{t('sign.lockedText', { date: formatDateTime(insp.signedAt), name: insp.signerName })}</Text>
              </div>
            </Group>
            <Group mt="md" gap="xs">
              <Button leftSection={<IconFileTypePdf size={18} />} loading={busy} onClick={() => run(async () => openPdf(await inspectionPdf(insp.id)))}>
                {t('common.openPdf')}
              </Button>
              <Button variant="default" leftSection={<IconSend size={18} />} onClick={() => offerSend(insp)}>
                {t('common.sendClient')}
              </Button>
              <Button variant="subtle" color="dark" onClick={() => navigate(`/orders/${b.order.id}`)}>
                {t('order.open')}
              </Button>
            </Group>
          </Box>
          {[...steps.slice(0, -1), ...legacySteps(insp)].map((s) => (
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
          // "Done" on any step: save what is filled in and go back to the job (the tinted confirm button).
          <Button
            size="compact-md"
            fz={17}
            fw={600}
            loading={busy}
            onClick={() =>
              run(async () => {
                await completeInspection(insp.id);
                navigate(`/orders/${b.order.id}`);
              }, 'finish.saved')
            }
          >
            {t('intake.done')}
          </Button>
        }
      />
      <div className="wizard-steps" role="tablist" ref={chips} aria-label={t('intake.stepsLabel', { done: doneCount, total: steps.length })}>
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
      <Box mt="lg" key={S.key} className={dir === 'next' ? 'step-next' : 'step-prev'}>
        {S.key === 'finish' ? (
          <FinishStep
            props={props}
            onDone={(i, signed) => {
              haptic('success');
              if (!signed) return navigate(`/orders/${b.order.id}`);
              setJustSigned(true);
              scrollToTop();
              offerSend(i);
              window.setTimeout(() => void inspectionPdf(i.id).catch(() => undefined), 1500);
            }}
          />
        ) : (
          <S.C {...props} />
        )}
      </Box>
      {S.key !== 'finish' && (
        <StickyBar>
          <Group gap="xs" wrap="nowrap">
            <Button variant="light" color="gray" disabled={step === 0} onClick={() => goto(step - 1)} leftSection={<IconArrowLeft size={18} />}>
              {t('common.back')}
            </Button>
            <Button style={{ flex: 1 }} onClick={() => goto(step + 1)} rightSection={<IconArrowRight size={18} />}>
              {t('common.next')}
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
