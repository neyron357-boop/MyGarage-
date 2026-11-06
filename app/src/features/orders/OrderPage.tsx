import {
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Checkbox,
  Grid,
  Group,
  Menu,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
  UnstyledButton,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconArrowRight,
  IconCar,
  IconCircleCheck,
  IconDots,
  IconFileTypePdf,
  IconPhoto,
  IconScale,
  IconSend,
  IconStatusChange,
  IconTool,
  IconUser,
  IconUserX,
  IconX,
} from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import { formatDate, formatDateTime } from '../../domain/dates';
import { QC_CHECKS } from '../../domain/inspection';
import { isAwaitingClient, isAwaitingDisassembly, itemAmounts, summarize } from '../../domain/items';
import { formatAed } from '../../domain/money';
import { formatPhone } from '../../domain/phone';
import { checkTransition, isBackward, STAGES } from '../../domain/stages';
import type { EstimateVersion, OrderItem, Stage } from '../../domain/types';
import { addIncident, resolveIncident } from '../../services/claims';
import { debtPdf, inspectionPdf, invoicePdf, openPdf, receiptPdf, versionPdf } from '../../services/documents';
import { simpleMessage, versionMessage } from '../../services/messages';
import {
  assignMechanic,
  changeStage,
  completeQc,
  declineRepair,
  markNoShow,
  saveQc,
  setTestDrive,
  stageContext,
  updateOrder,
  type OrderBundle,
} from '../../services/orders';
import {
  ContactButtons,
  EmptyState,
  Field,
  Flags,
  Kpi,
  List,
  ListRow,
  Money,
  MoneyInput,
  PageHeader,
  PageSkeleton,
  Photo,
  PlateText,
  ScrollTabs,
  Section,
  STAGE_META,
  StageBadge,
  StageTrack,
  StickyBar,
} from '../../ui/components';
import { DateTimeField } from '../../ui/DateFields';
import { useAction, useOrderBundle } from '../../ui/hooks';
import { SendDialog, type SendRequest } from '../../ui/SendDialog';
import { DecisionModal, DoneToggle, ItemRow, ResolveBModal, VersionCard } from '../estimate/components';
import { PaymentModal, PaymentPanel } from '../money/PaymentPanel';
import { ProcurementModal } from '../parts/PartsPage';
import { orderFlags } from './flags';
import { nextStep, type StepAction } from './nextStep';

const ctxOf = (b: OrderBundle) => ({ customer: b.customer, vehicle: b.vehicle, order: b.order, garageName: b.settings.name });

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

/* ---------------- Modals ---------------- */

function ReasonModal({ title, opened, onClose, onSubmit, hint }: { title: string; opened: boolean; onClose: () => void; onSubmit: (r: string) => void; hint?: string }) {
  const { t } = useTranslation();
  const [r, setR] = useState('');
  return (
    <Modal opened={opened} onClose={onClose} title={title}>
      {hint && (
        <Text size="sm" c="dimmed" mb="sm">
          {hint}
        </Text>
      )}
      <TextInput label={t('common.reason')} value={r} onChange={(e) => setR(e.currentTarget.value)} required data-autofocus />
      <Button
        mt="md"
        fullWidth
        disabled={!r.trim()}
        onClick={() => {
          onSubmit(r);
          setR('');
          onClose();
        }}
      >
        {t('common.confirm')}
      </Button>
    </Modal>
  );
}

/** All stages with what is allowed right now and why not. */
function StageModal({ b, opened, onClose }: { b: OrderBundle; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const [back, setBack] = useState<Stage | null>(null);
  const ctx = stageContext(b);
  const from = b.order.stage;
  const options = [...STAGES, 'cancelled' as Stage].filter((s) => s !== from);
  return (
    <>
      <Modal opened={opened && !back} onClose={onClose} title={t('order.changeStage')}>
        <Text size="sm" c="dimmed" mb="sm">
          {t('order.changeStageHint')}
        </Text>
        <Stack gap={6}>
          {options.map((s) => {
            const backward = isBackward(from, s);
            const check = checkTransition(from, s, ctx);
            if (!check.ok && check.reason === 'stageErr.notAllowed') return null;
            const m = STAGE_META[s];
            return (
              <UnstyledButton
                key={s}
                className="choice-card"
                disabled={!check.ok}
                style={{ opacity: check.ok ? 1 : 0.55 }}
                onClick={() => {
                  if (backward || s === 'cancelled') setBack(s);
                  else
                    void run(async () => {
                      await changeStage(b.order.id, s);
                      onClose();
                    });
                }}
              >
                <Group justify="space-between" wrap="nowrap">
                  <Group gap="sm" wrap="nowrap">
                    <ThemeIcon variant="light" color={m.color} radius="md">
                      {backward ? <IconArrowBackUp size={18} /> : <m.icon size={18} />}
                    </ThemeIcon>
                    <div>
                      <Text fw={600} size="sm">
                        {t(`stage.${s}`)}
                      </Text>
                      {!check.ok && (
                        <Text size="xs" c="dimmed">
                          {t(check.reason)}
                        </Text>
                      )}
                      {backward && (
                        <Text size="xs" c="dimmed">
                          {t('order.backHint')}
                        </Text>
                      )}
                    </div>
                  </Group>
                  {check.ok && <IconArrowRight size={18} />}
                </Group>
              </UnstyledButton>
            );
          })}
        </Stack>
      </Modal>
      <ReasonModal
        title={back ? t(`stage.${back}`) : ''}
        opened={!!back}
        onClose={() => {
          setBack(null);
          onClose();
        }}
        onSubmit={(r) => back && run(() => (back === 'cancelled' ? markNoShow(b.order.id, r) : changeStage(b.order.id, back, r)))}
      />
    </>
  );
}

function QcModal({ b, opened, onClose }: { b: OrderBundle; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [checks, setChecks] = useState<Record<string, boolean>>(b.order.qcChecks ?? {});
  const allowed = b.intake?.conditions?.testDriveAllowed;
  const all = QC_CHECKS.every((c) => checks[c]);
  const done = QC_CHECKS.filter((c) => checks[c]).length;
  return (
    <Modal opened={opened} onClose={onClose} title={t('qc.title')} size="lg">
      <Stack gap="xs">
        <Text size="sm" c="dimmed">
          {t('qc.hint', { done, total: QC_CHECKS.length })}
        </Text>
        {QC_CHECKS.map((c) => (
          <UnstyledButton key={c} className="choice-card" data-active={!!checks[c]} onClick={() => setChecks({ ...checks, [c]: !checks[c] })}>
            <Group gap="sm" wrap="nowrap">
              <Checkbox checked={!!checks[c]} onChange={() => undefined} tabIndex={-1} size="md" />
              <Text size="sm" fw={500}>
                {t(`qc.${c}`)}
              </Text>
            </Group>
          </UnstyledButton>
        ))}
        <Box className="surface-soft" p="sm" mt={4}>
          <Text fw={600} size="sm" mb={6}>
            {t('qc.testDrive')}
          </Text>
          {allowed ? (
            <SimpleGrid cols={2}>
              <NumberInput label={t('qc.startKm')} suffix={` ${t('unit.km')}`} thousandSeparator=" " value={b.order.testDriveStartKm ?? ''} onChange={(v) => run(() => setTestDrive(b.order.id, { testDriveStartKm: Number(v) || undefined }))} />
              <NumberInput label={t('qc.endKm')} suffix={` ${t('unit.km')}`} thousandSeparator=" " value={b.order.testDriveEndKm ?? ''} onChange={(v) => run(() => setTestDrive(b.order.id, { testDriveEndKm: Number(v) || undefined }))} />
            </SimpleGrid>
          ) : (
            <Text size="sm" c="orange">
              {t('qc.testDriveForbidden')}
            </Text>
          )}
        </Box>
        <Stack gap="xs" mt="sm">
          <Button fullWidth disabled={!all} loading={busy} leftSection={<IconCircleCheck size={18} />} onClick={() => run(async () => { await completeQc(b.order.id, checks); onClose(); }, 'qc.done')}>
            {t('qc.complete')}
          </Button>
          <Button fullWidth variant="default" onClick={() => run(async () => { await saveQc(b.order.id, checks); onClose(); }, 'common.saved')}>
            {t('qc.saveLater')}
          </Button>
        </Stack>
      </Stack>
    </Modal>
  );
}

function IncidentModal({ b, opened, onClose }: { b: OrderBundle; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const employees = useLiveQuery(() => db.employees.toArray(), []);
  const [desc, setDesc] = useState('');
  const [emp, setEmp] = useState<string | null>(null);
  const [cost, setCost] = useState<number | undefined>();
  const [resolution, setResolution] = useState('');
  return (
    <Modal opened={opened} onClose={onClose} title={t('incident.title')} size="lg">
      <Stack>
        <Alert color="gray" icon={<IconAlertTriangle size={18} />}>
          {t('incident.internal')}
        </Alert>
        {b.incidents.map((i) => (
          <Box key={i.id} className="surface-soft" p="sm">
            <Group justify="space-between" wrap="nowrap">
              <Text size="sm" fw={600}>
                {i.description}
              </Text>
              <Badge color={i.status === 'open' ? 'red' : 'green'}>{t(`incident.status.${i.status}`)}</Badge>
            </Group>
            <Text size="xs" c="dimmed">
              {formatDateTime(i.at)} · {t('incident.estimate')}: {formatAed(i.damageEstimateFils)} {i.resolution ? `· ${i.resolution}` : ''}
            </Text>
            {i.status === 'open' && (
              <Group mt="xs" align="flex-end" wrap="nowrap">
                <TextInput size="sm" style={{ flex: 1 }} placeholder={t('incident.resolution')} value={resolution} onChange={(e) => setResolution(e.currentTarget.value)} />
                <Button size="sm" disabled={!resolution.trim()} onClick={() => run(() => resolveIncident(i.id, resolution, i.damageEstimateFils), 'common.saved')}>
                  {t('incident.resolve')}
                </Button>
              </Group>
            )}
          </Box>
        ))}
        <Textarea label={t('incident.what')} value={desc} onChange={(e) => setDesc(e.currentTarget.value)} autosize minRows={2} />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select label={t('incident.who')} clearable value={emp} onChange={setEmp} data={(employees ?? []).map((e) => ({ value: e.id, label: e.name }))} />
          <MoneyInput label={t('incident.estimate')} value={cost} onChange={setCost} />
        </SimpleGrid>
        <Button loading={busy} disabled={!desc.trim()} onClick={() => run(async () => { await addIncident(b.order.id, { description: desc, employeeId: emp ?? undefined, damageEstimateFils: cost ?? 0 }); setDesc(''); setCost(undefined); }, 'common.saved')}>
          {t('incident.add')}
        </Button>
      </Stack>
    </Modal>
  );
}

/* ---------------- Tabs ---------------- */

function Overview({ b }: { b: OrderBundle }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const employees = useLiveQuery(() => db.employees.filter((e) => e.active).toArray(), []);
  const sum = summarize(b.items);
  const i = b.intake;
  const [complaint, setComplaint] = useState(b.order.complaint);
  const due = Math.max(0, stageContext(b).amountDueFils);
  const finished = b.order.stage === 'closed' || b.order.stage === 'cancelled';
  const hasMoney = b.items.some((x) => x.approvalState !== 'cancelled' && x.approvalState !== 'draft') || b.payments.length > 0;
  return (
    <Stack gap="lg">
      {hasMoney && (
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
          <Kpi label={t('order.approved')} value={<Money fils={sum.approvedGross} display />} />
          <Kpi label={t('order.pending')} value={<Money fils={sum.pendingGross} display />} color={sum.pendingGross ? 'orange' : undefined} />
          <Kpi label={t('order.declined')} value={<Money fils={sum.declinedGross} display />} />
          <Kpi label={t('payment.due')} value={<Money fils={due} display />} color={due && ['ready', 'delivered'].includes(b.order.stage) ? 'red' : !due && b.payments.length > 0 ? 'green' : undefined} />
        </SimpleGrid>
      )}
      <Box className="surface" p="md">
        <Stack gap="md">
          <Textarea
            label={t('order.complaint')}
            value={complaint}
            onChange={(e) => setComplaint(e.currentTarget.value)}
            onBlur={() => complaint !== b.order.complaint && run(() => updateOrder(b.order.id, { complaint }), 'common.saved')}
            readOnly={finished}
            autosize
            minRows={2}
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              label={t('order.mechanic')}
              placeholder={t('order.mechanicPick')}
              clearable={!finished}
              disabled={finished}
              value={b.order.mechanicId ?? null}
              onChange={(v) => run(() => assignMechanic(b.order.id, v ?? undefined))}
              data={(employees ?? []).map((e) => ({ value: e.id, label: `${e.name} · ${t(`role.${e.role}`)}` }))}
            />
            <DateTimeField
              label={t('cond.promised')}
              placeholder={t('common.notSet')}
              disabled={finished}
              value={b.order.promisedReadyAt ?? i?.conditions?.promisedReadyAt}
              onChange={(v) => run(() => updateOrder(b.order.id, { promisedReadyAt: v }))}
            />
          </SimpleGrid>
        </Stack>
      </Box>
      {i?.locked && (
        <Section title={t('order.atIntake')} description={t('order.atIntakeHint', { date: formatDateTime(i.signedAt) })} mt={0}>
          <Box className="surface" p="md">
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md" verticalSpacing="md">
              <Field label={t('intake.mileage')}>{i.mileageKm !== undefined ? `${i.mileageKm.toLocaleString('ru-RU')} ${t('unit.km')}` : '—'}</Field>
              <Field label={t('intake.fuel')}>{t(`fuel.${i.fuelLevel ?? 0}`)}</Field>
              <Field label={t('intake.lights')}>{i.warningLights.length ? i.warningLights.map((l) => t(`light.${l}`)).join(', ') : t('pdf.none')}</Field>
              <Field label={t('step.obd')}>{i.obdNoCodes ? t('intake.obdNone') : i.obdCodes.join(', ') || i.obdSkipReason || '—'}</Field>
              <Field label={t('cond.noCallLimit')}>{i.conditions?.noCallLimitFils ? <Money fils={i.conditions.noCallLimitFils} /> : t('cond.alwaysCall')}</Field>
              <Field label={t('cond.testDrive')}>{i.conditions?.testDriveAllowed ? t('common.yes') : t('common.no')}</Field>
              <Field label={t('cond.oldParts')}>{t(`cond.${i.conditions?.oldParts ?? 'return'}`)}</Field>
              <Field label={t('intake.keys')}>{i.keysCount ?? '—'}</Field>
            </SimpleGrid>
            {i.accidentRepair && (
              <Alert mt="md" color="orange" icon={<IconAlertTriangle size={18} />}>
                {t('intake.policeReport')}: {i.policeReportNo}
              </Alert>
            )}
          </Box>
        </Section>
      )}
      {b.order.warrantyOfOrderId && <Alert color="grape">{t('order.warrantyOf')}</Alert>}
    </Stack>
  );
}

function WorkTab({ b }: { b: OrderBundle }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [resolve, setResolve] = useState<OrderItem | null>(null);
  const [proc, setProc] = useState<OrderItem | null>(null);
  const [send, setSend] = useState<SendRequest | null>(null);
  const visible = b.items.filter((i) => i.approvalState !== 'cancelled');
  const approved = visible.filter((i) => i.approvalState === 'approved');
  const open = visible.filter((i) => i.approvalState === 'pending' || i.approvalState === 'draft');
  const declined = visible.filter((i) => i.approvalState === 'declined');
  const needPrepay = b.items.filter(
    (i) => i.kind === 'part' && i.approvalState === 'approved' && !i.customerSupplied && (i.procurementStatus ?? 'needed') === 'needed' && itemAmounts(i).gross >= b.settings.prepaymentThresholdFils,
  );
  const prepaid = b.payments.some((p) => p.kind === 'prepayment');
  const prepayAmount = needPrepay.reduce((s, i) => s + itemAmounts(i).gross, 0);
  const done = approved.filter((i) => i.done).length;
  const row = (i: OrderItem) => (
    <ItemRow
      key={i.id}
      item={i}
      b={b}
      right={
        <>
          {isAwaitingDisassembly(i) && (
            <Button size="compact-sm" variant="light" color="violet" onClick={() => setResolve(i)}>
              {t('bresolve.button')}
            </Button>
          )}
          {i.kind === 'part' && !i.customerSupplied && i.approvalState === 'approved' && !i.done && (
            <Button size="compact-sm" variant="light" onClick={() => setProc(i)}>
              {t('parts.procure')}
            </Button>
          )}
          <DoneToggle item={i} />
        </>
      }
    />
  );
  return (
    <Stack gap="lg">
      <Group gap="xs">
        <Button leftSection={<IconTool size={18} />} variant="default" onClick={() => navigate(`/orders/${b.order.id}/estimate`)}>
          {t('order.editEstimate')}
        </Button>
        {['awaiting_approval', 'awaiting_parts', 'in_progress', 'quality_check'].includes(b.order.stage) && (
          <Button color="orange" variant="light" leftSection={<IconAlertTriangle size={18} />} onClick={() => navigate(`/orders/${b.order.id}/problem`)}>
            {t('order.foundProblem')}
          </Button>
        )}
      </Group>
      {needPrepay.length > 0 && !prepaid && (
        <Alert color="orange" title={t('prepay.title')}>
          <Text size="sm">{t('prepay.text', { amount: formatAed(prepayAmount) })}</Text>
          <Button
            mt="xs"
            size="xs"
            variant="white"
            onClick={() =>
              setSend({
                text: simpleMessage('prepayment', ctxOf(b), b.order.docLanguage, { amount: formatAed(prepayAmount, b.order.docLanguage) }),
                template: 'prepayment',
                lang: b.order.docLanguage,
                orderId: b.order.id,
              })
            }
          >
            {t('prepay.ask')}
          </Button>
        </Alert>
      )}
      {visible.length === 0 && (
        <EmptyState icon={IconTool} title={t('order.noItems')} action={<Button onClick={() => navigate(`/orders/${b.order.id}/estimate`)}>{t('order.makeEstimate')}</Button>} />
      )}
      {approved.length > 0 && (
        <Section title={t('work.approved')} description={t('work.progress', { done, total: approved.length })} mt={0}>
          <Stack gap="xs">{approved.map(row)}</Stack>
        </Section>
      )}
      {open.length > 0 && (
        <Section title={t('work.open')} description={t('work.openHint')} mt={0}>
          <Stack gap="xs">{open.map(row)}</Stack>
        </Section>
      )}
      {declined.length > 0 && (
        <Section title={t('work.declined')} description={t('work.declinedHint')} mt={0}>
          <Stack gap="xs">{declined.map(row)}</Stack>
        </Section>
      )}
      <ResolveBModal b={b} item={resolve} onClose={() => setResolve(null)} />
      <ProcurementModal item={proc} onClose={() => setProc(null)} />
      <SendDialog customer={b.customer} request={send} onClose={() => setSend(null)} />
    </Stack>
  );
}

function openVersion(b: OrderBundle): EstimateVersion | undefined {
  return [...b.versions].reverse().find((v) => v.items.some((s) => {
    const it = b.items.find((i) => i.id === s.itemId);
    return it && isAwaitingClient(it);
  }));
}

function ApprovalsTab({ b }: { b: OrderBundle }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const [decide, setDecide] = useState<EstimateVersion | null>(null);
  const [send, setSend] = useState<SendRequest | null>(null);
  if (b.versions.length === 0) return <EmptyState icon={IconSend} title={t('order.noVersions')}>{t('order.noVersionsHint')}</EmptyState>;
  return (
    <Stack gap="sm">
      {[...b.versions].reverse().map((v) => {
        const open = v.items.some((s) => {
          const it = b.items.find((i) => i.id === s.itemId);
          return it && isAwaitingClient(it);
        });
        return (
          <VersionCard
            key={v.id}
            v={v}
            b={b}
            actions={
              <>
                {open && (
                  <Button size="xs" onClick={() => setDecide(v)}>
                    {t('decision.record')}
                  </Button>
                )}
                <Button size="xs" variant="light" leftSection={<IconSend size={14} />} onClick={() => setSend({ text: versionMessage(ctxOf(b), v), template: 'estimate', lang: v.language, orderId: b.order.id, pdf: () => versionPdf(v.id) })}>
                  {t('common.send')}
                </Button>
                <Button size="xs" variant="default" leftSection={<IconFileTypePdf size={14} />} onClick={() => run(async () => openPdf(await versionPdf(v.id)))}>
                  PDF
                </Button>
              </>
            }
          />
        );
      })}
      {decide && <DecisionModal b={b} version={decide} opened onClose={() => setDecide(null)} onVerbal={setSend} />}
      <SendDialog customer={b.customer} request={send} onClose={() => setSend(null)} />
    </Stack>
  );
}

function PhotosTab({ b }: { b: OrderBundle }) {
  const { t } = useTranslation();
  const groups: { title: string; list: typeof b.media }[] = [
    { title: t('intake.title'), list: b.media.filter((m) => m.ownerId === b.intake?.id && (m.kind === 'photo' || m.kind === 'video')) },
    { title: t('order.problemPhotos'), list: b.media.filter((m) => m.ownerId === b.order.id && m.kind !== 'pdf') },
    { title: t('parts.receipts'), list: b.media.filter((m) => m.slot === 'receipt') },
    { title: t('handover.title'), list: b.media.filter((m) => m.ownerId === b.handover?.id && (m.kind === 'photo' || m.kind === 'video')) },
  ].filter((g) => g.list.length);
  if (!groups.length) return <EmptyState icon={IconPhoto} title={t('order.noPhotos')} />;
  return (
    <Stack gap="lg">
      {groups.map((g) => (
        <Section key={g.title} title={`${g.title} · ${g.list.length}`} mt={0}>
          <Box className="surface" p="sm">
            <SimpleGrid cols={{ base: 3, sm: 5, lg: 7 }} spacing="xs">
              {g.list.map((m) =>
                m.kind === 'video' ? (
                  <Badge key={m.id}>{t('photos.videoSaved')}</Badge>
                ) : (
                  <Photo key={m.id} id={m.id} h={88} w="100%" label={<>{t(`slot.${m.slot}`, { defaultValue: m.slot })}<br />{formatDateTime(m.createdAt).slice(11)}</>} />
                ),
              )}
            </SimpleGrid>
          </Box>
        </Section>
      ))}
    </Stack>
  );
}

function DocsTab({ b }: { b: OrderBundle }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const [send, setSend] = useState<SendRequest | null>(null);
  const docs: { title: ReactNode; sub: ReactNode; open: () => Promise<{ blob: Blob; filename: string }> }[] = [];
  if (b.intake?.locked) docs.push({ title: t('intake.title'), sub: formatDateTime(b.intake.signedAt), open: () => inspectionPdf(b.intake!.id) });
  for (const v of b.versions) docs.push({ title: `${t('estimate.title')} v${v.number}`, sub: `${t(`versionKind.${v.kind}`)} · ${formatDateTime(v.sentAt)}`, open: () => versionPdf(v.id) });
  for (const i of b.invoices) docs.push({ title: i.number, sub: `${t(`invoice.type.${i.type}`)}${i.status === 'credited' ? ` · ${t('invoice.credited')}` : ''} · ${formatDate(i.issuedAt)}`, open: () => invoicePdf(i.id) });
  for (const p of b.payments) docs.push({ title: p.receiptNumber, sub: `${t(`payment.kind.${p.kind}`)} · ${formatAed(p.amountFils)}`, open: () => receiptPdf(p.id) });
  for (const d of b.debts) docs.push({ title: t('debt.document'), sub: formatDateTime(d.signedAt), open: () => debtPdf(d.id) });
  if (b.handover?.locked) docs.push({ title: t('handover.title'), sub: formatDateTime(b.handover.signedAt), open: () => inspectionPdf(b.handover!.id) });
  if (!docs.length) return <EmptyState icon={IconFileTypePdf} title={t('order.noDocs')}>{t('order.noDocsHint')}</EmptyState>;
  return (
    <>
      <List>
        {docs.map((d, idx) => (
          <ListRow
            key={idx}
            left={
              <ThemeIcon variant="light" color="red" size={40} radius="md">
                <IconFileTypePdf size={21} />
              </ThemeIcon>
            }
            title={d.title}
            subtitle={d.sub}
            right={
              <Group gap={4} wrap="nowrap">
                <Button size="compact-sm" variant="default" onClick={() => run(async () => openPdf(await d.open()))}>
                  {t('common.open')}
                </Button>
                <ActionIcon
                  variant="light"
                  size={30}
                  aria-label={t('common.send')}
                  onClick={() => setSend({ text: simpleMessage('documents', ctxOf(b), b.order.docLanguage), template: 'documents', lang: b.order.docLanguage, orderId: b.order.id, pdf: d.open })}
                >
                  <IconSend size={16} />
                </ActionIcon>
              </Group>
            }
          />
        ))}
      </List>
      <SendDialog customer={b.customer} request={send} onClose={() => setSend(null)} />
    </>
  );
}

function JournalTab({ b }: { b: OrderBundle }) {
  const { t } = useTranslation();
  const describe = (type: string, p: Record<string, unknown> = {}) => {
    if (type === 'stage') return `${t(`stage.${p.from}`)} → ${t(`stage.${p.to}`)}${p.reason ? ` · ${p.reason}` : ''}`;
    if (type === 'version_sent') return `v${p.number} · ${t(`sendVia.${p.via}`)}`;
    if (type === 'decision') return `v${p.version} · ${t(`via.${p.via}`)} · ✓ ${p.approved} · ✕ ${p.declined}${p.note ? ` · ${p.note}` : ''}`;
    if (type === 'payment') return `${t(`payment.kind.${p.kind}`)} · ${t(`payment.method.${p.method}`)} · ${formatAed(Number(p.amount))}`;
    if (type === 'message') return `${p.channel}`;
    if (type === 'invoice' || type === 'credit_note') return String(p.number ?? '');
    if (type === 'item_added' || type === 'done' || type === 'undone') return String(p.title ?? '');
    return '';
  };
  return (
    <Box className="surface" p="md">
      <Stack gap={0}>
        {[...b.events].reverse().map((e, idx, arr) => (
          <Group key={e.id} gap="sm" wrap="nowrap" align="stretch">
            <Stack gap={0} align="center" w={12}>
              <Box w={9} h={9} mt={6} style={{ borderRadius: '50%', background: idx === 0 ? 'var(--mantine-color-cobalt-6)' : 'var(--mantine-color-gray-4)' }} />
              {idx < arr.length - 1 && <Box w={1.5} style={{ flex: 1, background: 'var(--app-hairline)' }} />}
            </Stack>
            <Box pb="sm" style={{ minWidth: 0 }}>
              <Text size="sm" fw={600}>
                {t(`event.${e.type}`, { defaultValue: e.type })}
              </Text>
              <Text size="xs" c="dimmed">
                {formatDateTime(e.at)}
                {describe(e.type, e.payload) ? ` · ${describe(e.type, e.payload)}` : ''}
              </Text>
            </Box>
          </Group>
        ))}
      </Stack>
    </Box>
  );
}

/* ---------------- Page ---------------- */

const TONE_BG: Record<string, string> = {
  cobalt: 'var(--mantine-color-cobalt-light)',
  orange: 'var(--mantine-color-orange-light)',
  green: 'var(--mantine-color-green-light)',
  red: 'var(--mantine-color-red-light)',
  gray: 'var(--app-soft)',
};

export function OrderPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const b = useOrderBundle(id);
  const [incident, setIncident] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);
  const [qc, setQc] = useState(false);
  const [decline, setDecline] = useState(false);
  const [noShow, setNoShow] = useState(false);
  const [decide, setDecide] = useState<EstimateVersion | null>(null);
  const [pay, setPay] = useState(false);
  const [send, setSend] = useState<SendRequest | null>(null);
  if (b === undefined) return <PageSkeleton variant="detail" />;
  if (!b) return <EmptyState icon={IconX} title={t('err.notFound')} />;
  const { flags, waitingHours } = orderFlags(b);
  const step = nextStep(b);
  const setTab = (v: string) => setParams({ tab: v }, { replace: true });

  const act = (a: StepAction) => {
    const oid = b.order.id;
    switch (a) {
      case 'intake':
        return navigate(`/orders/${oid}/intake`);
      case 'estimate':
        return navigate(`/orders/${oid}/estimate`);
      case 'problem':
        return navigate(`/orders/${oid}/problem`);
      case 'handover':
        return navigate(`/orders/${oid}/handover`);
      case 'claim':
        return navigate(`/orders/${oid}/claim`);
      case 'toWork':
      case 'toParts':
        return setTab('work');
      case 'recordAnswer':
        return setDecide(openVersion(b) ?? null);
      case 'resend': {
        const v = openVersion(b);
        if (v) setSend({ text: versionMessage(ctxOf(b), v), template: 'estimate', lang: v.language, orderId: oid, pdf: () => versionPdf(v.id) });
        return;
      }
      case 'stageAwaitingParts':
        return void run(() => changeStage(oid, 'awaiting_parts'));
      case 'stageInProgress':
        return void run(() => changeStage(oid, 'in_progress'));
      case 'stageQc':
        return void run(() => changeStage(oid, 'quality_check'));
      case 'qc':
        return setQc(true);
      case 'notifyReady':
        return setSend({
          text: simpleMessage('carReady', ctxOf(b), b.order.docLanguage, { amount: formatAed(Math.max(0, stageContext(b).amountDueFils), b.order.docLanguage) }),
          template: 'carReady',
          lang: b.order.docLanguage,
          orderId: oid,
        });
      case 'payment':
        return setPay(true);
      case 'noShow':
        return setNoShow(true);
      case 'declineRepair':
        return setDecline(true);
    }
  };

  const stepTitle = t(`next.${step.title.replace('next.', '')}`, {
    ...step.params,
    amount: step.params?.amount !== undefined ? formatAed(Number(step.params.amount)) : undefined,
  });
  const primaryBtn = step.primary && (
    <Button fullWidth size="md" loading={busy} rightSection={<IconArrowRight size={18} />} onClick={() => act(step.primary!.action)}>
      {t(step.primary.label)}
    </Button>
  );

  const items = b.items.filter((i) => i.approvalState !== 'cancelled');
  return (
    <>
      <PageHeader
        back="/"
        eyebrow={`${t('order.title')} №${b.order.number} · ${formatDate(b.order.createdAt)}`}
        title={
          <>
            {b.vehicle.make} {b.vehicle.model}{' '}
            {b.vehicle.year && (
              <Text span inherit c="dimmed" fw={500}>
                {b.vehicle.year}
              </Text>
            )}
          </>
        }
        right={
          <Menu position="bottom-end" width={260}>
            <Menu.Target>
              <ActionIcon variant="default" size={40} radius="md" aria-label={t('common.more')}>
                <IconDots size={20} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconStatusChange size={18} />} onClick={() => setStageOpen(true)}>
                {t('order.changeStage')}
              </Menu.Item>
              <Menu.Item leftSection={<IconCar size={18} />} onClick={() => navigate(`/vehicles/${b.vehicle.id}`)}>
                {t('order.openVehicle')}
              </Menu.Item>
              <Menu.Item leftSection={<IconUser size={18} />} onClick={() => navigate(`/customers/${b.customer.id}`)}>
                {t('order.openCustomer')}
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item leftSection={<IconAlertTriangle size={18} />} onClick={() => setIncident(true)}>
                {t('incident.title')}
              </Menu.Item>
              {['delivered', 'closed'].includes(b.order.stage) && (
                <Menu.Item leftSection={<IconScale size={18} />} onClick={() => navigate(`/orders/${b.order.id}/claim`)}>
                  {t('claim.open')}
                </Menu.Item>
              )}
              {['diagnostics', 'awaiting_approval'].includes(b.order.stage) && (
                <Menu.Item color="red" leftSection={<IconUserX size={18} />} onClick={() => setDecline(true)}>
                  {t('order.declineRepair')}
                </Menu.Item>
              )}
            </Menu.Dropdown>
          </Menu>
        }
      />

      <Grid gutter="md">
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Box className="surface" p="md" h="100%">
            <Group justify="space-between" wrap="nowrap" align="center" mb="md" gap="sm">
              <PlateText plate={b.vehicle.plate} size="lg" />
              <Text size="xs" c="dimmed" className="tnum" ta="right" style={{ whiteSpace: 'nowrap' }}>
                {t('order.stepOf', { n: Math.max(1, STAGE_META[b.order.stage].step), total: 8 })}
              </Text>
            </Group>
            <StageTrack stage={b.order.stage} />
            <Group gap={8} mt={10} wrap="wrap">
              <UnstyledButton onClick={() => setStageOpen(true)} aria-label={t('order.changeStage')} className="stage-btn">
                <StageBadge stage={b.order.stage} size="lg" chevron={!['closed', 'cancelled'].includes(b.order.stage)} />
              </UnstyledButton>
              {b.order.outcome === 'repair_declined' && (
                <Badge color="gray" size="lg" variant="outline">
                  {t('order.repairDeclined')}
                </Badge>
              )}
            </Group>
            <Group justify="space-between" wrap="nowrap" mt="md" gap="sm">
              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, cursor: 'pointer' }} onClick={() => navigate(`/customers/${b.customer.id}`)}>
                <Avatar color="cobalt" radius="xl" size={42}>
                  {initials(b.customer.name)}
                </Avatar>
                <Box style={{ minWidth: 0 }}>
                  <Text fw={700} lineClamp={2} lh={1.25}>
                    {b.customer.type === 'company' && b.customer.companyName ? b.customer.companyName : b.customer.name}
                  </Text>
                  <Text size="xs" c="dimmed" className="tnum">
                    {formatPhone(b.customer.phone)} · {t(`lang.${b.order.docLanguage}`)}
                  </Text>
                </Box>
              </Group>
              <ContactButtons phone={b.customer.phone} whatsapp={b.customer.whatsapp} />
            </Group>
            {(flags.waitingClientSince || flags.waitingParts || flags.debt || flags.incident || flags.warranty || flags.storageDays) && (
              <Box mt="md">
                <Flags flags={flags} hours={waitingHours} warnHours={b.settings.boardWarnHours} alertHours={b.settings.boardAlertHours} />
              </Box>
            )}
          </Box>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Box p="md" h="100%" style={{ background: TONE_BG[step.tone], borderRadius: 'var(--mantine-radius-lg)' }} key={step.title} className="fade-enter">
            <Group gap={8} wrap="nowrap">
              <ThemeIcon size={22} radius="xl" color={step.tone === 'gray' ? 'gray' : step.tone} variant="filled">
                <IconArrowRight size={13} stroke={2.6} />
              </ThemeIcon>
              <div className="eyebrow">{t('next.label')}</div>
            </Group>
            <Title order={4} mt={8} style={{ textWrap: 'balance' }}>
              {stepTitle}
            </Title>
            {step.primary && (
              <Box mt="md" visibleFrom="sm">
                {primaryBtn}
              </Box>
            )}
            {step.secondary && (
              <Group gap={6} mt="sm">
                {step.secondary.map((s) => (
                  <Button key={s.action} size="compact-md" variant="subtle" color={s.action === 'declineRepair' ? 'red' : 'gray'} onClick={() => act(s.action)}>
                    {t(s.label)}
                  </Button>
                ))}
              </Group>
            )}
          </Box>
        </Grid.Col>
      </Grid>

      <Box mt="xl">
        <ScrollTabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'overview', label: t('order.tab.overview') },
            { value: 'work', label: t('order.tab.work'), count: items.length },
            { value: 'approvals', label: t('order.tab.approvals'), count: b.versions.length },
            { value: 'photos', label: t('order.tab.photos'), count: b.media.filter((m) => m.kind === 'photo').length },
            { value: 'payments', label: t('order.tab.payments') },
            { value: 'docs', label: t('order.tab.docs') },
            { value: 'journal', label: t('order.tab.journal') },
          ]}
        />
        <div key={tab} className="fade-enter">
          {tab === 'overview' && <Overview b={b} />}
          {tab === 'work' && <WorkTab b={b} />}
          {tab === 'approvals' && <ApprovalsTab b={b} />}
          {tab === 'photos' && <PhotosTab b={b} />}
          {tab === 'docs' && <DocsTab b={b} />}
          {tab === 'payments' && <PaymentPanel b={b} allowDebt={b.order.stage === 'ready'} />}
          {tab === 'journal' && <JournalTab b={b} />}
        </div>
      </Box>

      {step.primary && (
        <Box hiddenFrom="sm">
          <StickyBar>{primaryBtn}</StickyBar>
        </Box>
      )}

      <StageModal b={b} opened={stageOpen} onClose={() => setStageOpen(false)} />
      <QcModal b={b} opened={qc} onClose={() => setQc(false)} />
      <IncidentModal b={b} opened={incident} onClose={() => setIncident(false)} />
      <ReasonModal title={t('next.noShow')} opened={noShow} onClose={() => setNoShow(false)} onSubmit={(r) => run(() => markNoShow(b.order.id, r))} />
      <Modal opened={decline} onClose={() => setDecline(false)} title={t('order.declineRepair')}>
        <Text size="sm" mb="md">
          {t('order.declineExplain', { fee: formatAed(b.intake?.conditions?.diagnosticsFeeFils ?? 0) })}
        </Text>
        <Button color="red" fullWidth onClick={() => run(async () => { await declineRepair(b.order.id); setDecline(false); })}>
          {t('common.confirm')}
        </Button>
      </Modal>
      {decide && <DecisionModal b={b} version={decide} opened onClose={() => setDecide(null)} onVerbal={setSend} />}
      {pay && <PaymentModal b={b} opened onClose={() => setPay(false)} />}
      <SendDialog customer={b.customer} request={send} onClose={() => setSend(null)} />
    </>
  );
}
