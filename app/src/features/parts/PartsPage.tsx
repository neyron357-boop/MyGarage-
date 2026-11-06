import { Alert, Box, Button, Checkbox, Group, Modal, Select, SimpleGrid, Stack, Text, Textarea, TextInput, ThemeIcon, UnstyledButton } from '@mantine/core';
import {
  IconArrowBackUp,
  IconCheck,
  IconMapPin,
  IconPackage,
  IconPhone,
  IconPlus,
  IconReceipt2,
  IconShoppingCart,
  IconTruck,
  IconTruckDelivery,
  type Icon,
} from '@tabler/icons-react';
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
import { EmptyState, List, ListRow, Money, MoneyInput, PageHeader, PageSkeleton, Photo, PlateText, ScrollTabs, SelectCard } from '../../ui/components';
import { DateField } from '../../ui/DateFields';
import { useAction, useLang } from '../../ui/hooks';

const STATUS_META: Record<string, { icon: Icon; color: string }> = {
  needed: { icon: IconShoppingCart, color: 'orange' },
  ordered: { icon: IconReceipt2, color: 'cobalt' },
  in_transit: { icon: IconTruckDelivery, color: 'violet' },
  received: { icon: IconCheck, color: 'green' },
  installed: { icon: IconCheck, color: 'teal' },
  returned: { icon: IconArrowBackUp, color: 'red' },
  cancelled: { icon: IconArrowBackUp, color: 'gray' },
};

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
  const [expected, setExpected] = useState<string | undefined>();
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
    setExpected(item.expectedAt);
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
  const steps: ProcurementStatus[] = ['needed', 'ordered', 'in_transit', 'received'];
  return (
    <Modal opened onClose={onClose} title={itemTitle(item, lang)} size="lg">
      <Stack gap="md">
        <SimpleGrid cols={4} spacing={6}>
          {steps.map((s) => {
            const m = STATUS_META[s];
            return (
              <UnstyledButton key={s} className="choice-card" data-active={status === s} onClick={() => setStatus(s)} p={8}>
                <Stack gap={4} align="center">
                  <m.icon size={20} color={`var(--mantine-color-${m.color}-6)`} />
                  <Text size="xs" fw={700} ta="center" lh={1.2}>
                    {t(`proc.${s}`)}
                  </Text>
                </Stack>
              </UnstyledButton>
            );
          })}
        </SimpleGrid>
        <Select label={t('parts.supplier')} placeholder={t('parts.pickSupplier')} searchable clearable value={supplierId} onChange={setSupplierId} data={(suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        {!supplierId && <TextInput label={t('parts.newSupplier')} value={newSupplier} onChange={(e) => setNewSupplier(e.currentTarget.value)} />}
        <SimpleGrid cols={2}>
          <MoneyInput label={t('parts.costPerUnit')} value={cost} onChange={setCost} />
          <MoneyInput label={t('parts.purchaseVat')} value={vat} onChange={setVat} description={cost ? <Text span size="xs" c="cobalt.6" style={{ cursor: 'pointer' }} onClick={() => setVat(roundFils(roundFils(cost * item.qty) * 0.05))}>{t('expense.vatFromGross')}</Text> : undefined} />
        </SimpleGrid>
        {(status === 'ordered' || status === 'in_transit') && <DateField label={t('parts.expected')} value={expected} onChange={setExpected} />}
        {status === 'received' && (
          <Box className="surface-soft" p="sm">
            <Group justify="space-between">
              <CaptureButton variant="light" camera={false} leftSection={<IconReceipt2 size={18} />} onFiles={(f) => setReceipt(f[0])}>
                {receipt ? t('parts.receiptAttached') : t('parts.receiptPhoto')}
              </CaptureButton>
              {item.receiptMediaId && <Photo id={item.receiptMediaId} h={48} />}
            </Group>
            <Checkbox mt="sm" label={t('parts.paidCash')} checked={paidCash} onChange={(e) => setPaidCash(e.currentTarget.checked)} />
          </Box>
        )}
        <Button onClick={save} loading={busy}>
          {t('common.save')}
        </Button>
        {['ordered', 'in_transit', 'received'].includes(item.procurementStatus ?? '') && !ret && (
          <Button variant="subtle" color="red" leftSection={<IconArrowBackUp size={16} />} onClick={() => setRet(true)}>
            {t('parts.return')}
          </Button>
        )}
        {ret && (
          <Box className="surface-soft" p="sm">
            <Stack gap="sm">
              <Textarea label={t('common.reason')} value={retReason} onChange={(e) => setRetReason(e.currentTarget.value)} placeholder={t('parts.returnReasonHint')} autosize />
              <MoneyInput label={t('parts.expectedRefund')} value={retAmount} onChange={setRetAmount} />
              <SimpleGrid cols={3} spacing={6}>
                {(['money', 'replacement', 'credit'] as const).map((x) => (
                  <SelectCard key={x} active={retType === x} onClick={() => setRetType(x)}>
                    <Text size="xs" fw={700} ta="center">
                      {t(`refund.${x}`)}
                    </Text>
                  </SelectCard>
                ))}
              </SimpleGrid>
              <Button color="red" disabled={!retReason.trim()} onClick={() => run(async () => { await createReturn(item.id, { reason: retReason, expectedRefundFils: retAmount ?? 0, refundType: retType }); onClose(); }, 'common.saved')}>
                {t('parts.createReturn')}
              </Button>
            </Stack>
          </Box>
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
        <TextInput label={t('customer.name')} required value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.currentTarget.value })} data-autofocus />
        <TextInput label={t('customer.phone')} type="tel" value={v.phone ?? ''} onChange={(e) => setV({ ...v, phone: e.currentTarget.value })} />
        <TextInput label={t('parts.location')} placeholder="https://maps.google.com/…" value={v.locationUrl ?? ''} onChange={(e) => setV({ ...v, locationUrl: e.currentTarget.value })} />
        <Textarea label={t('common.notes')} placeholder={t('parts.supplierNotesHint')} value={v.notes ?? ''} onChange={(e) => setV({ ...v, notes: e.currentTarget.value })} autosize />
        <Button loading={busy} onClick={() => run(async () => { await saveSupplier({ ...v, name: v.name ?? '' }); onClose(); }, 'common.saved')}>
          {t('common.save')}
        </Button>
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
  const explicitTab = params.get('tab');
  const [proc, setProc] = useState<OrderItem | null>(null);
  const [supplierEdit, setSupplierEdit] = useState<Partial<Supplier> | null>(null);
  const data = useLiveQuery(loadParts, []);
  if (!data) return <PageSkeleton />;
  const { items, byId, vById, suppliers, returns, returnItems } = data;
  const sName = (id?: string) => suppliers.find((s) => s.id === id)?.name ?? t('parts.noSupplier');
  const today = dubaiDate();
  const needed = items.filter((i) => (i.procurementStatus ?? 'needed') === 'needed');
  const ordered = items.filter((i) => i.procurementStatus === 'ordered' || i.procurementStatus === 'in_transit');
  const pickup = ordered.filter((i) => !i.expectedAt || i.expectedAt <= today);
  // Without an explicit tab, open the first list that has something to do.
  const tab = explicitTab ?? (needed.length ? 'needed' : pickup.length ? 'pickup' : ordered.length ? 'ordered' : returns.length ? 'returns' : 'needed');
  const groups = new Map<string, OrderItem[]>();
  for (const i of pickup) groups.set(i.supplierId ?? '', [...(groups.get(i.supplierId ?? '') ?? []), i]);

  const row = (i: OrderItem) => {
    const o = byId.get(i.orderId);
    const v = o ? vById.get(o.vehicleId) : undefined;
    const m = STATUS_META[i.procurementStatus ?? 'needed'];
    return (
      <ListRow
        key={i.id}
        onClick={() => setProc(i)}
        left={
          <ThemeIcon variant="light" color={m.color} size={40} radius="md">
            <m.icon size={20} />
          </ThemeIcon>
        }
        title={`${itemTitle(i, lang)} × ${i.qty}`}
        subtitle={
          <Group gap={6} wrap="wrap">
            {v && <PlateText plate={v.plate} size="xs" />}
            <span>
              №{o?.number} · {sName(i.supplierId)}
              {i.partNumber ? ` · ${i.partNumber}` : ''}
              {i.expectedAt ? ` · ${t('parts.expected')} ${formatDate(i.expectedAt)}` : ''}
            </span>
          </Group>
        }
        right={
          <Stack gap={4} align="flex-end" style={{ flexShrink: 0 }}>
            {i.costPriceFils !== undefined && <Money fils={roundFils(i.costPriceFils * i.qty)} size="sm" />}
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/orders/${i.orderId}?tab=work`);
              }}
            >
              №{o?.number}
            </Button>
          </Stack>
        }
      />
    );
  };

  return (
    <>
      <PageHeader title={t('nav.parts')} subtitle={t('parts.subtitle')} />
      <ScrollTabs
        value={tab}
        onChange={(v) => setParams({ tab: v })}
        items={[
          { value: 'needed', label: t('parts.tabNeeded'), count: needed.length },
          { value: 'ordered', label: t('parts.tabOrdered'), count: ordered.length },
          { value: 'pickup', label: t('parts.tabPickup'), count: pickup.length },
          { value: 'returns', label: t('parts.tabReturns'), count: returns.length },
          { value: 'suppliers', label: t('nav.suppliers'), count: suppliers.filter((s) => !s.archivedAt).length },
        ]}
      />
      {tab === 'needed' && (needed.length ? <List>{needed.map(row)}</List> : <EmptyState icon={IconPackage} title={t('parts.nothingNeeded')}>{t('parts.nothingNeededHint')}</EmptyState>)}
      {tab === 'ordered' && (ordered.length ? <List>{ordered.map(row)}</List> : <EmptyState icon={IconReceipt2} title={t('parts.nothingOrdered')} />)}
      {tab === 'pickup' && (
        <Stack gap="md">
          {pickup.length === 0 && <EmptyState icon={IconTruck} title={t('parts.nothingPickup')} />}
          {[...groups.entries()].map(([sid, list]) => {
            const s = suppliers.find((x) => x.id === sid);
            const money = list.reduce((sum, i) => sum + roundFils((i.costPriceFils ?? 0) * i.qty) + (i.purchaseVatFils ?? 0), 0);
            return (
              <Box key={sid} className="surface" p="md">
                <Group justify="space-between" mb="sm" wrap="nowrap" align="flex-start">
                  <div>
                    <Text fw={700}>{s?.name ?? t('parts.noSupplier')}</Text>
                    <Text size="xs" c="dimmed">
                      {t('parts.itemsN', { n: list.length })}
                      {s?.phone ? ` · ${formatPhone(s.phone)}` : ''}
                    </Text>
                  </div>
                  <Box ta="right">
                    <div className="eyebrow">{t('parts.takeMoney')}</div>
                    <Text fz={20}>
                      <Money fils={money} display />
                    </Text>
                  </Box>
                </Group>
                <List>{list.map(row)}</List>
                {(s?.locationUrl || s?.phone) && (
                  <Group mt="sm" gap="xs">
                    {s?.locationUrl && (
                      <Button component="a" href={s.locationUrl} target="_blank" size="compact-md" variant="light" leftSection={<IconMapPin size={16} />}>
                        {t('parts.map')}
                      </Button>
                    )}
                    {s?.phone && (
                      <Button component="a" href={`tel:${s.phone}`} size="compact-md" variant="default" leftSection={<IconPhone size={16} />}>
                        {t('customer.call')}
                      </Button>
                    )}
                  </Group>
                )}
              </Box>
            );
          })}
        </Stack>
      )}
      {tab === 'returns' &&
        (returns.length === 0 ? (
          <EmptyState icon={IconArrowBackUp} title={t('parts.noReturns')} />
        ) : (
          <List>
            {returns.map((r, idx) => (
              <ListRow
                key={r.id}
                left={
                  <ThemeIcon variant="light" color="red" size={40} radius="md">
                    <IconArrowBackUp size={20} />
                  </ThemeIcon>
                }
                title={returnItems[idx] ? itemTitle(returnItems[idx]!, lang) : ''}
                subtitle={`${sName(r.supplierId)} · ${r.reason} · ${formatDate(r.createdAt)} · ${t(`refund.${r.refundType}`)}`}
                right={
                  <Stack gap={4} align="flex-end" style={{ flexShrink: 0 }}>
                    <Money fils={r.expectedRefundFils} size="sm" />
                    <Group gap={4}>
                      <Button size="compact-xs" onClick={() => run(() => closeReturn(r.id, r.refundType === 'money'), 'common.saved')}>
                        {t('parts.refundReceived')}
                      </Button>
                      {r.refundType === 'money' && (
                        <Button size="compact-xs" variant="default" onClick={() => run(() => closeReturn(r.id, false), 'common.saved')}>
                          {t('parts.refundNonCash')}
                        </Button>
                      )}
                    </Group>
                  </Stack>
                }
              />
            ))}
          </List>
        ))}
      {tab === 'suppliers' && (
        <Stack gap="md">
          <Button leftSection={<IconPlus size={18} />} onClick={() => setSupplierEdit({})} w="fit-content">
            {t('parts.addSupplier')}
          </Button>
          {suppliers.length === 0 ? (
            <Alert>{t('parts.noSuppliers')}</Alert>
          ) : (
            <List>
              {suppliers
                .filter((s) => !s.archivedAt)
                .map((s) => (
                  <ListRow
                    key={s.id}
                    onClick={() => setSupplierEdit(s)}
                    chevron
                    left={
                      <ThemeIcon variant="light" color="gray" size={40} radius="md">
                        <IconTruck size={20} />
                      </ThemeIcon>
                    }
                    title={s.name}
                    subtitle={[s.phone && formatPhone(s.phone), s.notes].filter(Boolean).join(' · ') || undefined}
                  />
                ))}
            </List>
          )}
        </Stack>
      )}
      <ProcurementModal item={proc} onClose={() => setProc(null)} />
      <SupplierModal supplier={supplierEdit} onClose={() => setSupplierEdit(null)} />
    </>
  );
}
