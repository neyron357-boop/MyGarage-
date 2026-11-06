import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Menu,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconBrandTelegram,
  IconBrandWhatsapp,
  IconChevronDown,
  IconClipboardCheck,
  IconFileTypePdf,
  IconPhone,
  IconScale,
  IconSend,
  IconTool,
} from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import { formatDateTime } from '../../domain/dates';
import { QC_CHECKS } from '../../domain/inspection';
import { isAwaitingClient, isAwaitingDisassembly, itemAmounts, summarize } from '../../domain/items';
import { formatAed } from '../../domain/money';
import { formatPhone } from '../../domain/phone';
import { checkTransition, isBackward, STAGES } from '../../domain/stages';
import type { EstimateVersion, OrderItem, Stage } from '../../domain/types';
import { addIncident, resolveIncident } from '../../services/claims';
import { debtPdf, inspectionPdf, invoicePdf, openPdf, receiptPdf, versionPdf } from '../../services/documents';
import { simpleMessage, telegramUrl, versionMessage, whatsappUrl } from '../../services/messages';
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
import { EmptyState, Flags, Money, MoneyInput, PageHeader, Photo, PlateText, StageBadge } from '../../ui/components';
import { useAction, useOrderBundle } from '../../ui/hooks';
import { SendDialog, type SendRequest } from '../../ui/SendDialog';
import { DecisionModal, DoneToggle, ItemRow, ResolveBModal, VersionCard } from '../estimate/components';
import { PaymentPanel } from '../money/PaymentPanel';
import { ProcurementModal } from '../parts/PartsPage';
import { orderFlags } from './flags';

function ReasonModal({ title, opened, onClose, onSubmit }: { title: string; opened: boolean; onClose: () => void; onSubmit: (r: string) => void }) {
  const { t } = useTranslation();
  const [r, setR] = useState('');
  return (
    <Modal opened={opened} onClose={onClose} title={title}>
      <TextInput label={t('common.reason')} value={r} onChange={(e) => setR(e.currentTarget.value)} required autoFocus />
      <Button mt="md" fullWidth disabled={!r.trim()} onClick={() => { onSubmit(r); setR(''); onClose(); }}>{t('common.confirm')}</Button>
    </Modal>
  );
}

function StageMenu({ b }: { b: OrderBundle }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const [back, setBack] = useState<Stage | null>(null);
  const ctx = stageContext(b);
  const from = b.order.stage;
  const options = [...STAGES, 'cancelled' as Stage].filter((s) => s !== from);
  return (
    <>
      <Menu shadow="md" withinPortal>
        <Menu.Target>
          <Button variant="default" rightSection={<IconChevronDown size={16} />} size="sm">
            {t(`stage.${from}`)}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>{t('order.changeStage')}</Menu.Label>
          {options.map((s) => {
            const backward = isBackward(from, s);
            const check = checkTransition(from, s, ctx);
            if (!check.ok && check.reason === 'stageErr.notAllowed') return null;
            return (
              <Menu.Item
                key={s}
                disabled={!check.ok}
                onClick={() => (backward || s === 'cancelled' ? setBack(s) : run(() => changeStage(b.order.id, s)))}
              >
                {backward ? '↩ ' : '→ '}
                {t(`stage.${s}`)}
                {!check.ok && <Text size="xs" c="dimmed">{t(check.reason)}</Text>}
              </Menu.Item>
            );
          })}
        </Menu.Dropdown>
      </Menu>
      <ReasonModal
        title={back ? t(`stage.${back}`) : ''}
        opened={!!back}
        onClose={() => setBack(null)}
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
  return (
    <Modal opened={opened} onClose={onClose} title={t('qc.title')} size="lg">
      <Stack>
        {QC_CHECKS.map((c) => (
          <Checkbox key={c} size="md" label={t(`qc.${c}`)} checked={!!checks[c]} onChange={(e) => setChecks({ ...checks, [c]: e.currentTarget.checked })} />
        ))}
        <Paper withBorder p="sm">
          <Text fw={500} size="sm" mb={4}>{t('qc.testDrive')}</Text>
          {allowed ? (
            <SimpleGrid cols={2}>
              <NumberInput label={t('qc.startKm')} value={b.order.testDriveStartKm ?? ''} onChange={(v) => run(() => setTestDrive(b.order.id, { testDriveStartKm: Number(v) || undefined }))} />
              <NumberInput label={t('qc.endKm')} value={b.order.testDriveEndKm ?? ''} onChange={(v) => run(() => setTestDrive(b.order.id, { testDriveEndKm: Number(v) || undefined }))} />
            </SimpleGrid>
          ) : (
            <Text size="sm" c="orange">{t('qc.testDriveForbidden')}</Text>
          )}
        </Paper>
        <Group grow>
          <Button variant="default" onClick={() => run(async () => { await saveQc(b.order.id, checks); onClose(); }, 'common.saved')}>{t('common.save')}</Button>
          <Button disabled={!all} loading={busy} onClick={() => run(async () => { await completeQc(b.order.id, checks); onClose(); }, 'qc.done')}>{t('qc.complete')}</Button>
        </Group>
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
        <Alert color="gray">{t('incident.internal')}</Alert>
        {b.incidents.map((i) => (
          <Paper key={i.id} withBorder p="sm">
            <Text size="sm">{formatDateTime(i.at)} · {i.description}</Text>
            <Text size="xs" c="dimmed">{t('incident.estimate')}: {formatAed(i.damageEstimateFils)} · {t(`incident.status.${i.status}`)} {i.resolution ? `· ${i.resolution}` : ''}</Text>
            {i.status === 'open' && (
              <Group mt="xs" align="flex-end">
                <TextInput style={{ flex: 1 }} placeholder={t('incident.resolution')} value={resolution} onChange={(e) => setResolution(e.currentTarget.value)} />
                <Button size="xs" disabled={!resolution.trim()} onClick={() => run(() => resolveIncident(i.id, resolution, i.damageEstimateFils), 'common.saved')}>{t('incident.resolve')}</Button>
              </Group>
            )}
          </Paper>
        ))}
        <Textarea label={t('incident.what')} value={desc} onChange={(e) => setDesc(e.currentTarget.value)} />
        <Select label={t('incident.who')} clearable value={emp} onChange={setEmp} data={(employees ?? []).map((e) => ({ value: e.id, label: e.name }))} />
        <MoneyInput label={t('incident.estimate')} value={cost} onChange={setCost} />
        <Button loading={busy} disabled={!desc.trim()} onClick={() => run(async () => { await addIncident(b.order.id, { description: desc, employeeId: emp ?? undefined, damageEstimateFils: cost ?? 0 }); setDesc(''); setCost(undefined); }, 'common.saved')}>
          {t('incident.add')}
        </Button>
      </Stack>
    </Modal>
  );
}

function Overview({ b }: { b: OrderBundle }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const employees = useLiveQuery(() => db.employees.filter((e) => e.active).toArray(), []);
  const sum = summarize(b.items);
  const i = b.intake;
  const [complaint, setComplaint] = useState(b.order.complaint);
  return (
    <Stack>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
        <Paper withBorder p="sm"><Text size="xs" c="dimmed">{t('order.approved')}</Text><Money fils={sum.approvedGross} fw={700} /></Paper>
        <Paper withBorder p="sm"><Text size="xs" c="dimmed">{t('order.pending')}</Text><Money fils={sum.pendingGross} fw={700} c={sum.pendingGross ? 'orange' : undefined} /></Paper>
        <Paper withBorder p="sm"><Text size="xs" c="dimmed">{t('order.declined')}</Text><Money fils={sum.declinedGross} fw={700} /></Paper>
        <Paper withBorder p="sm"><Text size="xs" c="dimmed">{t('payment.due')}</Text><Money fils={Math.max(0, stageContext(b).amountDueFils)} fw={700} /></Paper>
      </SimpleGrid>
      <Textarea label={t('order.complaint')} value={complaint} onChange={(e) => setComplaint(e.currentTarget.value)} onBlur={() => complaint !== b.order.complaint && run(() => updateOrder(b.order.id, { complaint }))} autosize />
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Select label={t('order.mechanic')} clearable value={b.order.mechanicId ?? null} onChange={(v) => run(() => assignMechanic(b.order.id, v ?? undefined))} data={(employees ?? []).map((e) => ({ value: e.id, label: `${e.name} (${t(`role.${e.role}`)})` }))} />
        <TextInput type="datetime-local" label={t('cond.promised')} value={b.order.promisedReadyAt?.slice(0, 16) ?? i?.conditions?.promisedReadyAt?.slice(0, 16) ?? ''} onChange={(e) => run(() => updateOrder(b.order.id, { promisedReadyAt: e.currentTarget.value || undefined }))} />
      </SimpleGrid>
      {i?.locked && (
        <Paper withBorder p="sm">
          <Text fw={600} size="sm" mb={4}>{t('order.atIntake')}</Text>
          <Text size="sm">
            {i.mileageKm} km · {t(`fuel.${i.fuelLevel ?? 0}`)} · {i.warningLights.length ? i.warningLights.map((l) => t(`light.${l}`)).join(', ') : t('pdf.none')}
            {i.obdCodes.length ? ` · OBD: ${i.obdCodes.join(', ')}` : ''}
          </Text>
          <Text size="sm">
            {t('cond.noCallLimit')}: {i.conditions?.noCallLimitFils ? formatAed(i.conditions.noCallLimitFils) : t('cond.alwaysCall')} · {t('cond.testDrive')}: {i.conditions?.testDriveAllowed ? t('common.yes') : t('common.no')} · {t('cond.oldParts')}: {t(`cond.${i.conditions?.oldParts ?? 'return'}`)}
          </Text>
          {i.accidentRepair && <Text size="sm">{t('intake.policeReport')}: {i.policeReportNo}</Text>}
        </Paper>
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
  const needPrepay = b.items.filter(
    (i) => i.kind === 'part' && i.approvalState === 'approved' && !i.customerSupplied && (i.procurementStatus ?? 'needed') === 'needed' && itemAmounts(i).gross >= b.settings.prepaymentThresholdFils,
  );
  const prepaid = b.payments.some((p) => p.kind === 'prepayment');
  const ctx = { customer: b.customer, vehicle: b.vehicle, order: b.order, garageName: b.settings.name };
  return (
    <Stack>
      <Group>
        <Button leftSection={<IconTool size={18} />} variant="light" onClick={() => navigate(`/orders/${b.order.id}/estimate`)}>{t('order.editEstimate')}</Button>
        {['awaiting_approval', 'awaiting_parts', 'in_progress', 'quality_check'].includes(b.order.stage) && (
          <Button color="orange" variant="light" leftSection={<IconAlertTriangle size={18} />} onClick={() => navigate(`/orders/${b.order.id}/problem`)}>{t('order.foundProblem')}</Button>
        )}
      </Group>
      {needPrepay.length > 0 && !prepaid && (
        <Alert color="orange" title={t('prepay.title')}>
          {t('prepay.text', { amount: formatAed(needPrepay.reduce((s, i) => s + itemAmounts(i).gross, 0)) })}
          <Button
            mt="xs"
            size="xs"
            variant="white"
            onClick={() =>
              setSend({
                text: simpleMessage('prepayment', ctx, b.order.docLanguage, { amount: formatAed(needPrepay.reduce((s, i) => s + itemAmounts(i).gross, 0), b.order.docLanguage) }),
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
      {visible.length === 0 && <EmptyState>{t('order.noItems')}</EmptyState>}
      {visible.map((i) => (
        <ItemRow
          key={i.id}
          item={i}
          b={b}
          right={
            <>
              {isAwaitingDisassembly(i) && <Button size="compact-xs" variant="light" color="violet" onClick={() => setResolve(i)}>{t('bresolve.button')}</Button>}
              {i.kind === 'part' && !i.customerSupplied && i.approvalState === 'approved' && !i.done && (
                <Button size="compact-xs" variant="light" onClick={() => setProc(i)}>{t('parts.procure')}</Button>
              )}
              <DoneToggle item={i} />
            </>
          }
        />
      ))}
      <ResolveBModal b={b} item={resolve} onClose={() => setResolve(null)} />
      <ProcurementModal item={proc} onClose={() => setProc(null)} />
      <SendDialog customer={b.customer} request={send} onClose={() => setSend(null)} />
    </Stack>
  );
}

function ApprovalsTab({ b }: { b: OrderBundle }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const [decide, setDecide] = useState<EstimateVersion | null>(null);
  const [send, setSend] = useState<SendRequest | null>(null);
  const ctx = { customer: b.customer, vehicle: b.vehicle, order: b.order, garageName: b.settings.name };
  if (b.versions.length === 0) return <EmptyState>{t('order.noVersions')}</EmptyState>;
  return (
    <Stack>
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
                {open && <Button size="xs" onClick={() => setDecide(v)}>{t('decision.record')}</Button>}
                <Button size="xs" variant="light" leftSection={<IconSend size={14} />} onClick={() => setSend({ text: versionMessage(ctx, v), template: 'estimate', lang: v.language, orderId: b.order.id, pdf: () => versionPdf(v.id) })}>{t('common.send')}</Button>
                <Button size="xs" variant="default" onClick={() => run(async () => openPdf(await versionPdf(v.id)))}>PDF</Button>
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
  ];
  return (
    <Stack>
      {groups.map((g) => (
        <div key={g.title}>
          <Title order={6} mb="xs">{g.title} ({g.list.length})</Title>
          <Group gap="xs">
            {g.list.map((m) =>
              m.kind === 'video' ? (
                <Badge key={m.id}>{t('photos.videoSaved')}</Badge>
              ) : (
                <Photo key={m.id} id={m.id} h={80} label={<>{t(`slot.${m.slot}`, { defaultValue: m.slot })}<br />{formatDateTime(m.createdAt)}</>} />
              ),
            )}
          </Group>
        </div>
      ))}
    </Stack>
  );
}

function DocsTab({ b }: { b: OrderBundle }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const [send, setSend] = useState<SendRequest | null>(null);
  const ctx = { customer: b.customer, vehicle: b.vehicle, order: b.order, garageName: b.settings.name };
  const docs: { label: ReactNode; open: () => Promise<{ blob: Blob; filename: string }> }[] = [];
  if (b.intake?.locked) docs.push({ label: `${t('intake.title')} · ${formatDateTime(b.intake.signedAt)}`, open: () => inspectionPdf(b.intake!.id) });
  for (const v of b.versions) docs.push({ label: `${t('estimate.title')} v${v.number} · ${formatDateTime(v.sentAt)}`, open: () => versionPdf(v.id) });
  for (const i of b.invoices) docs.push({ label: `${i.number} · ${t(`invoice.type.${i.type}`)}${i.status === 'credited' ? ` (${t('invoice.credited')})` : ''}`, open: () => invoicePdf(i.id) });
  for (const p of b.payments) docs.push({ label: `${p.receiptNumber} · ${t(`payment.kind.${p.kind}`)}`, open: () => receiptPdf(p.id) });
  for (const d of b.debts) docs.push({ label: `${t('debt.document')} · ${formatDateTime(d.signedAt)}`, open: () => debtPdf(d.id) });
  if (b.handover?.locked) docs.push({ label: `${t('handover.title')} · ${formatDateTime(b.handover.signedAt)}`, open: () => inspectionPdf(b.handover!.id) });
  if (!docs.length) return <EmptyState>{t('order.noDocs')}</EmptyState>;
  return (
    <Stack gap="xs">
      {docs.map((d, idx) => (
        <Paper key={idx} withBorder p="sm">
          <Group justify="space-between">
            <Group gap="xs"><IconFileTypePdf size={18} /><Text size="sm">{d.label}</Text></Group>
            <Group gap={4}>
              <Button size="xs" variant="default" onClick={() => run(async () => openPdf(await d.open()))}>{t('common.open')}</Button>
              <Button size="xs" variant="light" onClick={() => setSend({ text: simpleMessage('documents', ctx, b.order.docLanguage), template: 'documents', lang: b.order.docLanguage, orderId: b.order.id, pdf: d.open })}>{t('common.send')}</Button>
            </Group>
          </Group>
        </Paper>
      ))}
      <SendDialog customer={b.customer} request={send} onClose={() => setSend(null)} />
    </Stack>
  );
}

function JournalTab({ b }: { b: OrderBundle }) {
  const { t } = useTranslation();
  const describe = (type: string, p: Record<string, unknown> = {}) => {
    if (type === 'stage') return `${t(`stage.${p.from}`)} → ${t(`stage.${p.to}`)}${p.reason ? ` (${p.reason})` : ''}`;
    if (type === 'version_sent') return `v${p.number} · ${t(`sendVia.${p.via}`)}`;
    if (type === 'decision') return `v${p.version} · ${t(`via.${p.via}`)} · ✅ ${p.approved} ❌ ${p.declined}${p.note ? ` · ${p.note}` : ''}`;
    if (type === 'payment') return `${t(`payment.kind.${p.kind}`)} · ${t(`payment.method.${p.method}`)} · ${formatAed(Number(p.amount))} · ${p.receipt}`;
    if (type === 'message') return `${p.channel} · ${p.template}`;
    if (type === 'invoice' || type === 'credit_note') return String(p.number ?? '');
    if (type === 'item_added' || type === 'done' || type === 'undone') return String(p.title ?? '');
    return '';
  };
  return (
    <Stack gap={4}>
      {[...b.events].reverse().map((e) => (
        <Group key={e.id} gap="xs" wrap="nowrap" align="flex-start">
          <Text size="xs" c="dimmed" w={110} style={{ flexShrink: 0 }}>{formatDateTime(e.at)}</Text>
          <Text size="sm">
            <b>{t(`event.${e.type}`, { defaultValue: e.type })}</b> {describe(e.type, e.payload)}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}

function MainAction({ b }: { b: OrderBundle }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const [qc, setQc] = useState(false);
  const [decline, setDecline] = useState(false);
  const id = b.order.id;
  const ctx = stageContext(b);
  const go = (to: Stage) => run(() => changeStage(id, to));
  let main: ReactNode = null;
  switch (b.order.stage) {
    case 'booked':
    case 'intake':
      main = <Button size="md" onClick={() => navigate(`/orders/${id}/intake`)}>{t(b.intake ? 'order.continueIntake' : 'order.startIntake')}</Button>;
      break;
    case 'diagnostics':
      main = <Button size="md" onClick={() => navigate(`/orders/${id}/estimate`)}>{t('order.makeEstimate')}</Button>;
      break;
    case 'awaiting_approval': {
      const ok = checkTransition('awaiting_approval', 'in_progress', ctx).ok;
      main = ok ? (
        <Button size="md" onClick={() => go('in_progress')} loading={busy}>{t('order.startWork')}</Button>
      ) : summarize(b.items).approvedGross > 0 ? (
        <Button size="md" onClick={() => go('awaiting_parts')} loading={busy}>{t('order.waitParts')}</Button>
      ) : (
        <Button size="md" onClick={() => navigate(`/orders/${id}?tab=approvals`)}>{t('decision.record')}</Button>
      );
      break;
    }
    case 'awaiting_parts':
      main = <Button size="md" onClick={() => go('in_progress')} loading={busy}>{t('order.startWork')}</Button>;
      break;
    case 'in_progress':
      main = <Button size="md" onClick={() => go('quality_check')} loading={busy}>{t('order.workDone')}</Button>;
      break;
    case 'quality_check':
      main = <Button size="md" leftSection={<IconClipboardCheck />} onClick={() => setQc(true)}>{t('qc.title')}</Button>;
      break;
    case 'ready':
      main = <Button size="md" onClick={() => navigate(`/orders/${id}/handover`)}>{t('order.handover')}</Button>;
      break;
    case 'delivered':
      main = <Button size="md" onClick={() => navigate(`/orders/${id}?tab=payments`)}>{t('payment.accept')}</Button>;
      break;
    case 'closed':
      main = <Button size="md" variant="light" leftSection={<IconScale />} onClick={() => navigate(`/orders/${id}/claim`)}>{t('claim.open')}</Button>;
      break;
  }
  return (
    <Group gap="xs">
      {main}
      {['diagnostics', 'awaiting_approval'].includes(b.order.stage) && (
        <Button variant="subtle" color="red" size="xs" onClick={() => setDecline(true)}>{t('order.declineRepair')}</Button>
      )}
      <QcModal b={b} opened={qc} onClose={() => setQc(false)} />
      <Modal opened={decline} onClose={() => setDecline(false)} title={t('order.declineRepair')}>
        <Text size="sm" mb="md">{t('order.declineExplain', { fee: formatAed(b.intake?.conditions?.diagnosticsFeeFils ?? 0) })}</Text>
        <Button color="red" fullWidth onClick={() => run(async () => { await declineRepair(id); setDecline(false); })}>{t('common.confirm')}</Button>
      </Modal>
    </Group>
  );
}

export function OrderPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const b = useOrderBundle(id);
  const [incident, setIncident] = useState(false);
  const [send, setSend] = useState<SendRequest | null>(null);
  if (b === undefined) return null;
  if (!b) return <EmptyState>{t('err.notFound')}</EmptyState>;
  const { flags, waitingHours } = orderFlags(b);
  const ctx = { customer: b.customer, vehicle: b.vehicle, order: b.order, garageName: b.settings.name };
  const phone = b.customer.whatsapp || b.customer.phone;
  const readyMsg = () =>
    setSend({
      text: simpleMessage('carReady', ctx, b.order.docLanguage, { amount: formatAed(Math.max(0, stageContext(b).amountDueFils), b.order.docLanguage) }),
      template: 'carReady',
      lang: b.order.docLanguage,
      orderId: b.order.id,
    });
  return (
    <>
      <PageHeader
        title={`${t('order.title')} №${b.order.number}`}
        back="/"
        subtitle={
          <Group gap={6}>
            <PlateText plate={b.vehicle.plate} size="xs" />
            <Text span size="sm" c="dimmed" style={{ cursor: 'pointer' }} onClick={() => navigate(`/vehicles/${b.vehicle.id}`)}>{b.vehicle.make} {b.vehicle.model} {b.vehicle.year ?? ''}</Text>
          </Group>
        }
        right={<StageMenu b={b} />}
      />
      <Paper withBorder p="sm" mb="sm">
        <Group justify="space-between" wrap="wrap" gap="xs">
          <div style={{ cursor: 'pointer' }} onClick={() => navigate(`/customers/${b.customer.id}`)}>
            <Text fw={600}>{b.customer.name}</Text>
            <Text size="sm" c="dimmed">{formatPhone(b.customer.phone)} · {t(`lang.${b.order.docLanguage}`)}</Text>
          </div>
          <Group gap={4}>
            <Button component="a" href={whatsappUrl(phone, '')} target="_blank" size="xs" color="green" leftSection={<IconBrandWhatsapp size={16} />}>WA</Button>
            <Button component="a" href={telegramUrl('')} target="_blank" size="xs" variant="light" leftSection={<IconBrandTelegram size={16} />}>TG</Button>
            <Button component="a" href={`tel:${b.customer.phone}`} size="xs" variant="default" leftSection={<IconPhone size={16} />}>{t('customer.call')}</Button>
          </Group>
        </Group>
        <Group mt={6} gap="xs">
          <StageBadge stage={b.order.stage} />
          {b.order.outcome === 'repair_declined' && <Badge color="red" variant="outline">{t('order.repairDeclined')}</Badge>}
          <Flags flags={flags} hours={waitingHours} warnHours={b.settings.boardWarnHours} alertHours={b.settings.boardAlertHours} />
        </Group>
      </Paper>
      <Group mb="md" gap="xs" justify="space-between">
        <MainAction b={b} />
        <Group gap="xs">
          {b.order.stage === 'ready' && <Button variant="light" size="sm" onClick={readyMsg}>{t('order.notifyReady')}</Button>}
          <Button variant="subtle" size="sm" color="gray" leftSection={<IconAlertTriangle size={16} />} onClick={() => setIncident(true)}>{t('incident.title')}</Button>
          {['delivered', 'closed'].includes(b.order.stage) && <Button variant="subtle" size="sm" leftSection={<IconScale size={16} />} onClick={() => navigate(`/orders/${b.order.id}/claim`)}>{t('claim.open')}</Button>}
        </Group>
      </Group>
      <Tabs value={tab} onChange={(v) => setParams({ tab: v ?? 'overview' }, { replace: true })}>
        <ScrollArea type="never" mb="md">
          <Tabs.List style={{ flexWrap: 'nowrap' }}>
            <Tabs.Tab value="overview">{t('order.tab.overview')}</Tabs.Tab>
            <Tabs.Tab value="work">{t('order.tab.work')} ({b.items.filter((i) => i.approvalState !== 'cancelled').length})</Tabs.Tab>
            <Tabs.Tab value="approvals">{t('order.tab.approvals')} ({b.versions.length})</Tabs.Tab>
            <Tabs.Tab value="photos">{t('order.tab.photos')}</Tabs.Tab>
            <Tabs.Tab value="docs">{t('order.tab.docs')}</Tabs.Tab>
            <Tabs.Tab value="payments">{t('order.tab.payments')}</Tabs.Tab>
            <Tabs.Tab value="journal">{t('order.tab.journal')}</Tabs.Tab>
          </Tabs.List>
        </ScrollArea>
      </Tabs>
      {tab === 'overview' && <Overview b={b} />}
      {tab === 'work' && <WorkTab b={b} />}
      {tab === 'approvals' && <ApprovalsTab b={b} />}
      {tab === 'photos' && <PhotosTab b={b} />}
      {tab === 'docs' && <DocsTab b={b} />}
      {tab === 'payments' && <PaymentPanel b={b} allowDebt={b.order.stage === 'ready'} />}
      {tab === 'journal' && <JournalTab b={b} />}
      <IncidentModal b={b} opened={incident} onClose={() => setIncident(false)} />
      <SendDialog customer={b.customer} request={send} onClose={() => setSend(null)} />
      <Text size="xs" c="dimmed" mt="xl">{t('order.created')} {formatDateTime(b.order.createdAt)}</Text>
    </>
  );
}
