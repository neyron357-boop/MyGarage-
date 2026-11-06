import { Alert, Badge, Button, Card, Checkbox, Group, Modal, Paper, SegmentedControl, Select, SimpleGrid, Stack, Tabs, Text, TextInput, Textarea } from '@mantine/core';
import { IconMapPin, IconPlus } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import { dubaiDate, formatDate } from '../../domain/dates';
import { itemTitle } from '../../domain/items';
import { roundFils } from '../../domain/money';
import { formatPhone } from '../../domain/phone';
import type { OrderItem, ProcurementStatus, Supplier, SupplierReturn } from '../../domain/types';
import { closeReturn, createReturn, saveSupplier, setProcurement } from '../../services/parts';
import { CaptureButton } from '../../ui/CaptureButton';
import { EmptyState, Money, MoneyInput, PageHeader, Photo } from '../../ui/components';
import { useAction, useLang } from '../../ui/hooks';

export function ProcurementModal({ item, onClose }: { item: OrderItem | null; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { run, busy } = useAction();
  const suppliers = useLiveQuery(() => db.suppliers.filter((s) => !s.archivedAt).sortBy('name'), []);
  const [status, setStatus] = useState<ProcurementStatus>('needed');
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [newSupplier, setNewSupplier] = useState('');
  const [cost, setCost] = useState<number | undefined>();
  const [vat, setVat] = useState<number | undefined>();
  const [expected, setExpected] = useState('');
  const [receipt, setReceipt] = useState<File>();
  const [paidCash, setPaidCash] = useState(false);
  const [ret, setRet] = useState(false);
  const [retReason, setRetReason] = useState('');
  const [retAmount, setRetAmount] = useState<number | undefined>();
  const [retType, setRetType] = useState<SupplierReturn['refundType']>('money');
  useEffect(() => {
    if (!item) return;
    setStatus(item.procurementStatus === 'needed' ? 'ordered' : item.procurementStatus === 'ordered' || item.procurementStatus === 'in_transit' ? 'received' : item.procurementStatus ?? 'needed');
    setSupplierId(item.supplierId ?? null);
    setCost(item.costPriceFils);
    setVat(item.purchaseVatFils);
    setExpected(item.expectedAt ?? '');
    setReceipt(undefined);
    setPaidCash(false);
    setRet(false);
    setRetAmount(item.costPriceFils !== undefined ? roundFils(item.costPriceFils * item.qty) + (item.purchaseVatFils ?? 0) : undefined);
  }, [item]);
  if (!item) return null;
  const save = () =>
    run(async () => {
      let sid = supplierId ?? undefined;
      if (!sid && newSupplier.trim()) sid = (await saveSupplier({ name: newSupplier })).id;
      await setProcurement(item.id, { status, supplierId: sid, costPriceFils: cost, purchaseVatFils: vat, expectedAt: expected, receipt, paidCash });
      onClose();
    }, 'common.saved');
  return (
    <Modal opened onClose={onClose} title={itemTitle(item, lang)} size="lg">
      <Stack>
        <SegmentedControl fullWidth value={status} onChange={(v) => setStatus(v as ProcurementStatus)} data={(['needed', 'ordered', 'in_transit', 'received'] as const).map((s) => ({ value: s, label: t(`proc.${s}`) }))} />
        <Select label={t('parts.supplier')} searchable clearable value={supplierId} onChange={setSupplierId} data={(suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        {!supplierId && <TextInput label={t('parts.newSupplier')} value={newSupplier} onChange={(e) => setNewSupplier(e.currentTarget.value)} />}
        <SimpleGrid cols={2}>
          <MoneyInput label={t('parts.costPerUnit')} value={cost} onChange={setCost} />
          <MoneyInput label={t('parts.purchaseVat')} value={vat} onChange={setVat} description={cost ? `5%: ${((roundFils(cost * item.qty) * 0.05) / 100).toFixed(2)}` : undefined} />
        </SimpleGrid>
        {(status === 'ordered' || status === 'in_transit') && <TextInput type="date" label={t('parts.expected')} value={expected} onChange={(e) => setExpected(e.currentTarget.value)} />}
        {status === 'received' && (
          <>
            <Group>
              <CaptureButton variant="light" camera={false} onFiles={(f) => setReceipt(f[0])}>{receipt ? t('parts.receiptAttached') : t('parts.receiptPhoto')}</CaptureButton>
              {item.receiptMediaId && <Photo id={item.receiptMediaId} h={50} />}
            </Group>
            <Checkbox label={t('parts.paidCash')} checked={paidCash} onChange={(e) => setPaidCash(e.currentTarget.checked)} />
          </>
        )}
        <Button onClick={save} loading={busy}>{t('common.save')}</Button>
        {['ordered', 'in_transit', 'received'].includes(item.procurementStatus ?? '') && (
          <Button variant="subtle" color="red" onClick={() => setRet((x) => !x)}>{t('parts.return')}</Button>
        )}
        {ret && (
          <Paper withBorder p="sm">
            <Textarea label={t('common.reason')} value={retReason} onChange={(e) => setRetReason(e.currentTarget.value)} placeholder={t('parts.returnReasonHint')} />
            <MoneyInput label={t('parts.expectedRefund')} value={retAmount} onChange={setRetAmount} />
            <SegmentedControl mt="xs" fullWidth value={retType} onChange={(v) => setRetType(v as SupplierReturn['refundType'])} data={(['money', 'replacement', 'credit'] as const).map((x) => ({ value: x, label: t(`refund.${x}`) }))} />
            <Button mt="sm" color="red" disabled={!retReason.trim()} onClick={() => run(async () => { await createReturn(item.id, { reason: retReason, expectedRefundFils: retAmount ?? 0, refundType: retType }); onClose(); }, 'common.saved')}>
              {t('parts.createReturn')}
            </Button>
          </Paper>
        )}
      </Stack>
    </Modal>
  );
}

function SupplierModal({ supplier, onClose }: { supplier: Partial<Supplier> | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [v, setV] = useState<Partial<Supplier>>({});
  useEffect(() => setV(supplier ?? {}), [supplier]);
  if (!supplier) return null;
  return (
    <Modal opened onClose={onClose} title={supplier.id ? t('parts.editSupplier') : t('parts.addSupplier')}>
      <Stack>
        <TextInput label={t('customer.name')} required value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.currentTarget.value })} />
        <TextInput label={t('customer.phone')} value={v.phone ?? ''} onChange={(e) => setV({ ...v, phone: e.currentTarget.value })} />
        <TextInput label={t('parts.location')} placeholder="https://maps.google.com/..." value={v.locationUrl ?? ''} onChange={(e) => setV({ ...v, locationUrl: e.currentTarget.value })} />
        <Textarea label={t('common.notes')} value={v.notes ?? ''} onChange={(e) => setV({ ...v, notes: e.currentTarget.value })} />
        <Button loading={busy} onClick={() => run(async () => { await saveSupplier({ ...v, name: v.name ?? '' }); onClose(); }, 'common.saved')}>{t('common.save')}</Button>
      </Stack>
    </Modal>
  );
}

async function loadParts() {
  const orders = await db.orders.filter((o) => !['closed', 'cancelled'].includes(o.stage)).toArray();
  const byId = new Map(orders.map((o) => [o.id, o]));
  const items = (await db.items.where('orderId').anyOf(orders.map((o) => o.id)).toArray()).filter((i) => i.kind === 'part' && !i.customerSupplied && i.approvalState === 'approved');
  const vehicles = await db.vehicles.bulkGet(orders.map((o) => o.vehicleId));
  const vById = new Map(vehicles.filter(Boolean).map((v) => [v!.id, v!]));
  const suppliers = await db.suppliers.toArray();
  const returns = await db.supplierReturns.where('status').equals('open').toArray();
  const returnItems = await db.items.bulkGet(returns.map((r) => r.itemId));
  return { items, byId, vById, suppliers, returns, returnItems };
}

export function PartsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const { run } = useAction();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'needed';
  const [proc, setProc] = useState<OrderItem | null>(null);
  const [supplierEdit, setSupplierEdit] = useState<Partial<Supplier> | null>(null);
  const data = useLiveQuery(loadParts, []);
  if (!data) return null;
  const { items, byId, vById, suppliers, returns, returnItems } = data;
  const sName = (id?: string) => suppliers.find((s) => s.id === id)?.name ?? t('parts.noSupplier');
  const today = dubaiDate();
  const needed = items.filter((i) => (i.procurementStatus ?? 'needed') === 'needed');
  const ordered = items.filter((i) => i.procurementStatus === 'ordered' || i.procurementStatus === 'in_transit');
  const pickup = ordered.filter((i) => !i.expectedAt || i.expectedAt <= today);
  const groups = new Map<string, OrderItem[]>();
  for (const i of pickup) groups.set(i.supplierId ?? '', [...(groups.get(i.supplierId ?? '') ?? []), i]);

  const row = (i: OrderItem) => {
    const o = byId.get(i.orderId);
    const v = o ? vById.get(o.vehicleId) : undefined;
    return (
      <Card key={i.id} withBorder padding="sm" className="tap-card" onClick={() => setProc(i)}>
        <Group justify="space-between" wrap="nowrap">
          <div>
            <Text fw={500} size="sm">{itemTitle(i, lang)} × {i.qty}</Text>
            <Text size="xs" c="dimmed">
              №{o?.number} · {v?.make} {v?.model}
              {i.partNumber ? ` · ${i.partNumber}` : ''} · {sName(i.supplierId)}
              {i.expectedAt ? ` · ${t('parts.expected')} ${formatDate(i.expectedAt)}` : ''}
            </Text>
          </div>
          <Stack gap={2} align="flex-end">
            <Badge variant="light">{t(`proc.${i.procurementStatus ?? 'needed'}`)}</Badge>
            {i.costPriceFils !== undefined && <Money fils={roundFils(i.costPriceFils * i.qty)} size="xs" />}
          </Stack>
        </Group>
        <Button size="compact-xs" variant="subtle" mt={4} onClick={(e) => { e.stopPropagation(); navigate(`/orders/${i.orderId}?tab=work`); }}>{t('order.open')}</Button>
      </Card>
    );
  };

  return (
    <>
      <PageHeader title={t('nav.parts')} />
      <Tabs value={tab} onChange={(v) => setParams({ tab: v ?? 'needed' })} mb="md">
        <Tabs.List>
          <Tabs.Tab value="needed">{t('parts.tabNeeded')} ({needed.length})</Tabs.Tab>
          <Tabs.Tab value="ordered">{t('parts.tabOrdered')} ({ordered.length})</Tabs.Tab>
          <Tabs.Tab value="pickup">{t('parts.tabPickup')} ({pickup.length})</Tabs.Tab>
          <Tabs.Tab value="returns">{t('parts.tabReturns')} ({returns.length})</Tabs.Tab>
          <Tabs.Tab value="suppliers">{t('nav.suppliers')}</Tabs.Tab>
        </Tabs.List>
      </Tabs>
      {tab === 'needed' && <Stack gap="xs">{needed.length ? needed.map(row) : <EmptyState>{t('parts.nothingNeeded')}</EmptyState>}</Stack>}
      {tab === 'ordered' && <Stack gap="xs">{ordered.length ? ordered.map(row) : <EmptyState>{t('board.nothing')}</EmptyState>}</Stack>}
      {tab === 'pickup' && (
        <Stack>
          {pickup.length === 0 && <EmptyState>{t('board.nothing')}</EmptyState>}
          {[...groups.entries()].map(([sid, list]) => {
            const s = suppliers.find((x) => x.id === sid);
            const money = list.reduce((sum, i) => sum + roundFils((i.costPriceFils ?? 0) * i.qty) + (i.purchaseVatFils ?? 0), 0);
            return (
              <Paper key={sid} withBorder p="sm">
                <Group justify="space-between" mb="xs">
                  <div>
                    <Text fw={700}>{s?.name ?? t('parts.noSupplier')}</Text>
                    {s?.phone && <Text size="xs" c="dimmed">{formatPhone(s.phone)}</Text>}
                  </div>
                  <Group gap="xs">
                    {s?.locationUrl && <Button component="a" href={s.locationUrl} target="_blank" size="xs" variant="light" leftSection={<IconMapPin size={14} />}>{t('parts.map')}</Button>}
                    <Badge size="lg" variant="light">{t('parts.takeMoney')}: <Money fils={money} size="sm" /></Badge>
                  </Group>
                </Group>
                <Stack gap="xs">{list.map(row)}</Stack>
              </Paper>
            );
          })}
        </Stack>
      )}
      {tab === 'returns' && (
        <Stack gap="xs">
          {returns.length === 0 && <EmptyState>{t('board.nothing')}</EmptyState>}
          {returns.map((r, idx) => (
            <Card key={r.id} withBorder padding="sm">
              <Group justify="space-between">
                <div>
                  <Text fw={500}>{returnItems[idx] ? itemTitle(returnItems[idx]!, lang) : ''}</Text>
                  <Text size="xs" c="dimmed">{sName(r.supplierId)} · {r.reason} · {formatDate(r.createdAt)} · {t(`refund.${r.refundType}`)}</Text>
                </div>
                <Money fils={r.expectedRefundFils} fw={600} />
              </Group>
              <Group mt="xs">
                <Button size="xs" onClick={() => run(() => closeReturn(r.id, r.refundType === 'money'), 'common.saved')}>{t('parts.refundReceived')}</Button>
                {r.refundType === 'money' && <Button size="xs" variant="default" onClick={() => run(() => closeReturn(r.id, false), 'common.saved')}>{t('parts.refundNonCash')}</Button>}
              </Group>
            </Card>
          ))}
        </Stack>
      )}
      {tab === 'suppliers' && (
        <Stack gap="xs">
          <Button leftSection={<IconPlus size={18} />} onClick={() => setSupplierEdit({})} w="fit-content">{t('parts.addSupplier')}</Button>
          {suppliers.filter((s) => !s.archivedAt).map((s) => (
            <Card key={s.id} withBorder padding="sm" className="tap-card" onClick={() => setSupplierEdit(s)}>
              <Group justify="space-between">
                <div>
                  <Text fw={600}>{s.name}</Text>
                  <Text size="xs" c="dimmed">{s.phone ? formatPhone(s.phone) : ''} {s.notes ? `· ${s.notes}` : ''}</Text>
                </div>
                {s.locationUrl && <Button component="a" href={s.locationUrl} target="_blank" size="xs" variant="subtle" onClick={(e) => e.stopPropagation()} leftSection={<IconMapPin size={14} />}>{t('parts.map')}</Button>}
              </Group>
            </Card>
          ))}
          {suppliers.length === 0 && <Alert>{t('parts.noSuppliers')}</Alert>}
        </Stack>
      )}
      <ProcurementModal item={proc} onClose={() => setProc(null)} />
      <SupplierModal supplier={supplierEdit} onClose={() => setSupplierEdit(null)} />
    </>
  );
}
