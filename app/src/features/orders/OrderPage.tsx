import {
  ActionIcon,
  Alert,
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
  IconChevronRight,
  IconCircleCheck,
  IconDots,
  IconFileTypePdf,
  IconPhoto,
  IconScale,
  IconSend,
  IconStatusChange,
  IconTool,
  IconTrash,
  IconUser,
  IconUserPlus,
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
import { lightLabel } from '../../domain/quickLists';
import { activeInvoice } from '../../domain/invoice';
import { isAwaitingClient, isAwaitingDisassembly, itemAmounts, itemTitle, summarize } from '../../domain/items';
import { formatAed } from '../../domain/money';
import { formatPhone } from '../../domain/phone';
import { checkTransition, isBackward, STAGES } from '../../domain/stages';
import type { EstimateVersion, OrderItem, Stage } from '../../domain/types';
import { addIncident, resolveIncident } from '../../services/claims';
import { debtPdf, inspectionPdf, invoicePdf, openPdf, receiptPdf, versionPdf } from '../../services/documents';
import { simpleMessage, versionMessage } from '../../services/messages';
import {
  assignMechanic,
  bundleAmountDue,
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
  ContactTiles,
  EmptyState,
  Field,
  Flags,
  FormRow,
  Kpi,
  List,
  ListRow,
  Money,
  MoneyInput,
  PageHeader,
  MediaImage,
  PageSkeleton,
  PlateText,
  RowGroup,
  ScrollTabs,
  Section,
  STAGE_META,
  StageBadge,
  StageTrack,
  StickyBar,
  PersonAvatar,
} from '../../ui/components';
import { DateTimeField } from '../../ui/DateFields';
import { useAction, useLang, useOrderBundle } from '../../ui/hooks';
import { PhotoViewer } from '../../ui/PhotoViewer';
import { ImportedNote } from '../settings/EaglecartImport';
import { LinkedMoney } from '../money/MoneyEntry';
import { SendDialog, type SendRequest } from '../../ui/SendDialog';
import { CustomerModal } from '../customers/forms';
import { DecisionModal, DoneToggle, ItemRow, ResolveBModal, VersionCard } from '../estimate/components';
import { PaymentModal, PaymentPanel } from '../money/PaymentPanel';
import { ProcurementModal } from '../parts/Procurement';
import { orderFlags } from './flags';
import { nextStep, type StepAction } from './nextStep';
import { DeleteJobModal } from './DeleteJob';
import { useStackBack } from '../../ui/stack';

const ctxOf = (b: OrderBundle) => ({ customer: b.customer, vehicle: b.vehicle, order: b.order, garageName: b.settings.name, partsAdvanceFrom: b.settings.prepaymentThresholdFils });

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
      {/* iOS grouped form: the complaint as a text row, the mechanic and the promised time as label–value rows. */}
      <Box>
        <RowGroup title={t('order.complaint')} mt={0}>
          <div className="ios-row left">
            <Textarea
              aria-label={t('order.complaint')}
              placeholder={t('order.complaintHint')}
              value={complaint}
              onChange={(e) => setComplaint(e.currentTarget.value)}
              onBlur={() => complaint !== b.order.complaint && run(() => updateOrder(b.order.id, { complaint }), 'common.saved')}
              readOnly={finished}
              autosize
              minRows={1}
              w="100%"
            />
          </div>
        </RowGroup>
        <RowGroup mt="md">
          <FormRow label={t('order.mechanic')}>
            <Select
              aria-label={t('order.mechanic')}
              placeholder={t('order.mechanicPick')}
              clearable={!finished}
              disabled={finished}
              value={b.order.mechanicId ?? null}
              onChange={(v) => run(() => assignMechanic(b.order.id, v ?? undefined))}
              data={(employees ?? []).map((e) => ({ value: e.id, label: `${e.name} · ${t(`role.${e.role}`)}` }))}
              w="100%"
            />
          </FormRow>
          <FormRow label={t('cond.promised')}>
            <Box w="100%">
              <DateTimeField
                label={undefined}
                placeholder={t('common.notSet')}
                disabled={finished}
                value={b.order.promisedReadyAt ?? i?.conditions?.promisedReadyAt}
                onChange={(v) => run(() => updateOrder(b.order.id, { promisedReadyAt: v }))}
              />
            </Box>
          </FormRow>
        </RowGroup>
      </Box>
      {(i?.locked || i?.completedAt) && (
        <Section
          title={t('order.atIntake')}
          description={i.locked ? t('order.atIntakeHint', { date: formatDateTime(i.signedAt) }) : t('order.atIntakeUnsigned', { date: formatDateTime(i.completedAt) })}
          mt={0}
        >
          <Box className="surface" p="md">
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md" verticalSpacing="md">
              <Field label={t('intake.mileage')}>{i.mileageKm !== undefined ? `${i.mileageKm.toLocaleString('ru-RU')} ${t('unit.km')}` : '—'}</Field>
              <Field label={t('intake.fuel')}>{i.fuelLevel !== undefined ? t(`fuel.${i.fuelLevel}`) : '—'}</Field>
              <Field label={t('intake.lights')}>{i.warningLights.length ? i.warningLights.map((l) => lightLabel(t, l)).join(', ') : t('pdf.none')}</Field>
              <Field label={t('step.obd')}>{i.obdNoCodes ? t('intake.obdNone') : i.obdCodes.join(', ') || i.obdSkipReason || '—'}</Field>
              <Field label={t('cond.testDrive')}>{i.conditions?.testDriveAllowed ? t('common.yes') : t('common.no')}</Field>
              {/* Terms that only acts signed before the fast check-in have. */}
              {i.conditions?.noCallLimitFils !== undefined && (
                <Field label={t('cond.noCallLimit')}>{i.conditions.noCallLimitFils ? <Money fils={i.conditions.noCallLimitFils} /> : t('cond.alwaysCall')}</Field>
              )}
              {i.conditions?.oldParts && <Field label={t('cond.oldParts')}>{t(`cond.${i.conditions.oldParts}`)}</Field>}
              {i.keysCount !== undefined && <Field label={t('intake.keys')}>{i.keysCount}</Field>}
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
      <CarHistory b={b} />
    </Stack>
  );
}

/** What was done to this car before: its earlier jobs, newest first, with what they were about. */
function CarHistory({ b }: { b: OrderBundle }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const past = useLiveQuery(async () => {
    const orders = (await db.orders.where('vehicleId').equals(b.vehicle.id).toArray()).filter((o) => o.id !== b.order.id).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    const items = orders.length ? await db.items.where('orderId').anyOf(orders.map((o) => o.id)).toArray() : [];
    return orders.map((o) => {
      const mine = items.filter((i) => i.orderId === o.id && i.approvalState !== 'cancelled' && i.approvalState !== 'declined');
      return { o, works: mine.map((i) => itemTitle(i, lang)).filter(Boolean), total: summarize(mine).approvedGross };
    });
  }, [b.vehicle.id, b.order.id, lang]);
  if (!past?.length) return null;
  return (
    <Section title={t('order.carHistory')} description={t('order.carHistoryHint', { n: past.length })} mt={0}>
      <List>
        {past.slice(0, 6).map(({ o, works, total }) => (
          <ListRow
            key={o.id}
            onClick={() => navigate(`/orders/${o.id}`)}
            chevron
            title={[`№${o.number}`, formatDate(o.createdAt)].join(' · ')}
            subtitle={
              <Stack gap={4} align="flex-start">
                {(works.length > 0 || o.complaint) && (
                  <Text span inherit lineClamp={2}>
                    {works.length ? works.join(' · ') : o.complaint}
                  </Text>
                )}
                <StageBadge stage={o.stage} size="sm" />
              </Stack>
            }
            right={total > 0 ? <Money fils={total} size="sm" /> : undefined}
          />
        ))}
      </List>
    </Section>
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
  const canReportProblem = ['awaiting_approval', 'awaiting_parts', 'in_progress', 'quality_check'].includes(b.order.stage);
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
      {/* With nothing on the job yet, the empty state below offers the estimate: one button, not two. */}
      {(visible.length > 0 || canReportProblem) && (
        <Group gap="xs">
          {visible.length > 0 && (
            <Button leftSection={<IconTool size={18} />} variant="default" onClick={() => navigate(`/orders/${b.order.id}/estimate`)}>
              {t('order.editEstimate')}
            </Button>
          )}
          {canReportProblem && (
            <Button color="orange" variant="light" leftSection={<IconAlertTriangle size={18} />} onClick={() => navigate(`/orders/${b.order.id}/problem`)}>
              {t('order.foundProblem')}
            </Button>
          )}
        </Group>
      )}
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
  // Every photo of the job in one gallery: swipe from check-in through to handover.
  const [viewing, setViewing] = useState<number | null>(null);
  const all = groups.flatMap((g) => g.list.filter((m) => m.kind === 'photo').map((m) => ({ m, group: g.title })));
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
                  <Stack key={m.id} gap={4} align="center">
                    <button type="button" className="thumb-btn" style={{ width: '100%' }} onClick={() => setViewing(all.findIndex((x) => x.m.id === m.id))} aria-label={t(`slot.${m.slot}`, { defaultValue: m.slot })}>
                      <MediaImage id={m.id} h={88} w="100%" />
                    </button>
                    <Text size="xs" c="dimmed" ta="center" lh={1.3}>
                      {t(`slot.${m.slot}`, { defaultValue: m.slot })}
                      <br />
                      {formatDateTime(m.createdAt).slice(11)}
                    </Text>
                  </Stack>
                ),
              )}
            </SimpleGrid>
          </Box>
        </Section>
      ))}
      {viewing !== null && (
        <PhotoViewer
          items={all.map(({ m, group }) => ({
            id: m.id,
            title: t(`slot.${m.slot}`, { defaultValue: m.slot }),
            caption: `${group} · ${formatDateTime(m.createdAt)} · SHA-256 ${m.sha256.slice(0, 12)}`,
          }))}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
        />
      )}
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
    if (type === 'closed_unpaid' || type === 'closed_owner') return formatAed(Number(p.fils ?? 0));
    if (type === 'price_changed') return `${p.title ?? ''} · ${formatAed(Number(p.from ?? 0))} → ${formatAed(Number(p.to ?? 0))}`;
    if (type === 'invoice' || type === 'credit_note') return String(p.number ?? '');
    if (type === 'discount') return [formatAed(Number(p.amount ?? 0)), p.pct ? `${Number(p.pct) / 100} %` : '', p.invoice ? `${p.credit} → ${p.invoice}` : ''].filter(Boolean).join(' · ');
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
  // An old or mistyped link (or a board tip) opens the overview, not an empty tab.
  const asked = params.get('tab') ?? 'overview';
  const tab = ['overview', 'work', 'approvals', 'photos', 'payments', 'docs', 'journal'].includes(asked) ? asked : 'overview';
  const b = useOrderBundle(id);
  const [incident, setIncident] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);
  const [qc, setQc] = useState(false);
  const [decline, setDecline] = useState(false);
  const [noShow, setNoShow] = useState(false);
  const [remove, setRemove] = useState(false);
  const stackBack = useStackBack();
  const [decide, setDecide] = useState<EstimateVersion | null>(null);
  const [pay, setPay] = useState(false);
  const [send, setSend] = useState<SendRequest | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  if (b === undefined) return <PageSkeleton variant="detail" />;
  if (!b) return <EmptyState icon={IconX} title={t('err.notFound')} />;
  const { flags, waitingHours } = orderFlags(b);
  const step = nextStep(b);
  const setTab = (v: string) => setParams({ tab: v }, { replace: true });

  // Quick path (check-in → invoice → payment → close) leads the job unless the detailed
  // estimate/approval flow is already under way without an invoice.
  const inv = activeInvoice(b.invoices);
  const due = Math.max(0, bundleAmountDue(b));
  const stage = b.order.stage;
  const working = !['booked', 'closed', 'cancelled', 'delivered'].includes(stage);
  const quick = stage !== 'booked' && stage !== 'cancelled' && (!!inv || (working && b.versions.length === 0));
  const drafts = b.items.filter((x) => x.approvalState === 'draft').length;
  let quickHint = '';
  let quickPrimary: { label: string; color?: string; onClick: () => void } | undefined;
  const quickSecondary: { label: string; onClick: () => void }[] = [];
  if (quick && inv) {
    quickSecondary.push({ label: t('order.openInvoice'), onClick: () => navigate(`/orders/${b.order.id}`) });
    if (stage === 'closed' || (stage === 'delivered' && due <= 0)) quickHint = t('order.quickClosed');
    else if (due > 0) {
      quickHint = t('order.quickPay', { number: inv.number });
      quickPrimary = { label: t('qi.takePayment', { amount: formatAed(due) }), onClick: () => setPay(true) };
    } else {
      quickHint = t('order.quickClose');
      quickPrimary = { label: t('qi.closeOrder'), color: 'green', onClick: () => void run(() => changeStage(b.order.id, 'closed'), 'qi.closedToast') };
    }
  } else if (quick) {
    quickHint = drafts ? t('order.quickDrafts', { n: drafts }) : t('order.quickInvoice');
    quickPrimary = { label: drafts ? t('order.continueInvoice') : t('order.createInvoice'), onClick: () => navigate(`/orders/${b.order.id}`) };
    if (!b.intake?.locked && !b.intake?.completedAt) quickSecondary.push({ label: b.intake ? t('order.continueIntake') : t('order.startIntake'), onClick: () => navigate(`/orders/${b.order.id}/intake`) });
    quickSecondary.push({ label: t('order.detailedEstimate'), onClick: () => navigate(`/orders/${b.order.id}/estimate`) });
  }

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
        back={`/orders/${b.order.id}`}
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
              <Menu.Divider />
              <Menu.Item color="red" leftSection={<IconTrash size={18} />} onClick={() => setRemove(true)}>
                {t('order.delete')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        }
      />

      <Grid gutter="md">
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Box className="surface" p="md" h="100%">
            {/* The plate, then the stage once — the track and the badge say where the job is (no "step 2 of 8"). */}
            <Group justify="space-between" wrap="nowrap" align="center" mb="md" gap="sm">
              <PlateText plate={b.vehicle.plate} size="lg" />
            </Group>
            <StageTrack stage={b.order.stage} />
            <Group gap={8} mt={10} wrap="wrap">
              <UnstyledButton onClick={() => setStageOpen(true)} aria-label={t('order.changeStage')} className="stage-btn">
                <StageBadge stage={b.order.stage} size="lg" chevron={!['closed', 'cancelled'].includes(b.order.stage)} />
              </UnstyledButton>
              {b.order.outcome === 'repair_declined' && !b.order.imported && (
                <Badge color="gray" size="lg" variant="outline">
                  {t('order.repairDeclined')}
                </Badge>
              )}
            </Group>
            {b.order.imported && <ImportedNote imp={b.order.imported} />}
            <Box mt="md">
              {b.customer.name || b.customer.phone ? (
                // The customer: a row that opens the card, the ways to reach them as tiles under it.
                <UnstyledButton className="customer-line" onClick={() => navigate(`/customers/${b.customer.id}`)}>
                  <PersonAvatar name={b.customer.companyName || b.customer.name} company={b.customer.type === 'company'} size={44} />
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Text fw={600} fz={17} lineClamp={1} lh={1.3}>
                      {(b.customer.type === 'company' && b.customer.companyName ? b.customer.companyName : b.customer.name) || t('customer.noName')}
                    </Text>
                    <Text fz={15} c="dimmed" className="tnum" lineClamp={1}>
                      {[b.customer.phone ? formatPhone(b.customer.phone) : '', t(`lang.${b.order.docLanguage}`)].filter(Boolean).join(' · ')}
                    </Text>
                  </Box>
                  <IconChevronRight size={18} stroke={2.4} className="chevron" aria-hidden />
                </UnstyledButton>
              ) : (
                // Checked in with the plate only: the customer can be added any time.
                <Button variant="light" leftSection={<IconUserPlus size={18} />} onClick={() => setCustomerOpen(true)}>
                  {t('qi.addCustomer')}
                </Button>
              )}
              <ContactTiles phone={b.customer.phone} whatsapp={b.customer.whatsapp} telegram={b.customer.telegram} />
            </Box>
            {(flags.waitingClientSince || flags.waitingParts || flags.debt || flags.incident || flags.warranty || flags.storageDays) && (
              <Box mt="md">
                <Flags flags={flags} hours={waitingHours} warnHours={b.settings.boardWarnHours} alertHours={b.settings.boardAlertHours} />
              </Box>
            )}
          </Box>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          {quick ? (
            <Box p="md" h="100%" className="surface fade-enter" key={quickHint}>
              <div className="eyebrow">{t('next.label')}</div>
              <Title order={4} mt={4} style={{ textWrap: 'balance' }}>
                {quickHint}
              </Title>
              {quickPrimary && (
                <Box mt="md" visibleFrom="sm">
                  <Button fullWidth color={quickPrimary.color} loading={busy} onClick={quickPrimary.onClick}>
                    {quickPrimary.label}
                  </Button>
                </Box>
              )}
              {quickSecondary.length > 0 && (
                <Group gap={8} mt="sm">
                  {quickSecondary.map((s) => (
                    <Button key={s.label} size="sm" variant="default" onClick={s.onClick}>
                      {s.label}
                    </Button>
                  ))}
                </Group>
              )}
            </Box>
          ) : (
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
              // Secondary ways on: small capsules on the card, not loose text.
              <Group gap={8} mt="sm">
                {step.secondary.map((s) => (
                  <Button key={s.action} size="sm" variant="default" c={s.action === 'declineRepair' ? 'red' : undefined} onClick={() => act(s.action)}>
                    {t(s.label)}
                  </Button>
                ))}
              </Group>
            )}
          </Box>
          )}
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
        <div key={tab} className="fade-enter tab-panel">
          {tab === 'overview' && <Overview b={b} />}
          {tab === 'work' && <WorkTab b={b} />}
          {tab === 'approvals' && <ApprovalsTab b={b} />}
          {tab === 'photos' && <PhotosTab b={b} />}
          {tab === 'docs' && <DocsTab b={b} />}
          {tab === 'payments' && (
            <Stack gap="lg">
              <PaymentPanel b={b} allowDebt={b.order.stage === 'ready'} />
              {/* Parts bought for this job, other money for it — linked to the job, its car and customer. */}
              <LinkedMoney link={{ orderId: b.order.id, vehicleId: b.vehicle.id, customerId: b.customer.id }} by="orderId" />
            </Stack>
          )}
          {tab === 'journal' && <JournalTab b={b} />}
        </div>
      </Box>

      {quick
        ? quickPrimary && (
            <Box hiddenFrom="sm">
              <StickyBar>
                <Button fullWidth color={quickPrimary.color} loading={busy} onClick={quickPrimary.onClick}>
                  {quickPrimary.label}
                </Button>
              </StickyBar>
            </Box>
          )
        : step.primary &&
          // "To the work" while the Work tab is already open would lead where you are.
          !(tab === 'work' && (step.primary.action === 'toWork' || step.primary.action === 'toParts')) && (
            <Box hiddenFrom="sm">
              <StickyBar>{primaryBtn}</StickyBar>
            </Box>
          )}
      <CustomerModal opened={customerOpen} onClose={() => setCustomerOpen(false)} customer={b.customer} />

      <StageModal b={b} opened={stageOpen} onClose={() => setStageOpen(false)} />
      <QcModal b={b} opened={qc} onClose={() => setQc(false)} />
      <IncidentModal b={b} opened={incident} onClose={() => setIncident(false)} />
      <ReasonModal title={t('next.noShow')} opened={noShow} onClose={() => setNoShow(false)} onSubmit={(r) => run(() => markNoShow(b.order.id, r))} />
      <DeleteJobModal
        order={b.order}
        opened={remove}
        onClose={() => setRemove(false)}
        // The job's screen goes back first (it must not show an empty page), then the job is deleted.
        beforeDelete={async () => {
          if (stackBack) stackBack('/');
          else navigate('/');
          await new Promise((r) => setTimeout(r, 520));
        }}
      />
      <Modal opened={decline} onClose={() => setDecline(false)} title={t('order.declineRepair')}>
        <Text size="sm" mb="md">
          {b.intake?.conditions?.diagnosticsFeeFils
            ? t('order.declineExplain', { fee: formatAed(b.intake.conditions.diagnosticsFeeFils) })
            : t('order.declineExplainNoFee')}
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
