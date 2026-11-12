import { Box, Button, Group, Stack, Text, ThemeIcon } from '@mantine/core';
import {
  IconArrowBackUp,
  IconCheck,
  IconMapPin,
  IconPackage,
  IconPhone,
  IconReceipt2,
  IconShoppingCart,
  IconTruck,
  IconTruckDelivery,
  type Icon,
} from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import { dubaiDate, formatDate } from '../../domain/dates';
import { itemTitle } from '../../domain/items';
import { roundFils } from '../../domain/money';
import { formatPhone } from '../../domain/phone';
import type { OrderItem } from '../../domain/types';
import { syncStage } from '../../services/flow';
import { closeReturn, setProcurement } from '../../services/parts';
import { EmptyState, List, ListRow, Money, PageHeader, PageSkeleton, PlateText, ScrollTabs } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useAction, useLang } from '../../ui/hooks';
import { ProcurementModal } from './Procurement';
import { SuppliersTab } from './Suppliers';

const STATUS_META: Record<string, { icon: Icon; color: string }> = {
  needed: { icon: IconShoppingCart, color: 'orange' },
  ordered: { icon: IconReceipt2, color: 'cobalt' },
  in_transit: { icon: IconTruckDelivery, color: 'violet' },
  received: { icon: IconCheck, color: 'green' },
  installed: { icon: IconCheck, color: 'teal' },
  returned: { icon: IconArrowBackUp, color: 'red' },
  cancelled: { icon: IconArrowBackUp, color: 'gray' },
};

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

  const step = (i: OrderItem, status: 'ordered' | 'received') =>
    run(async () => {
      await setProcurement(i.id, { status });
      await syncStage(i.orderId);
      haptic(status === 'received' ? 'success' : 'light');
    });
  const row = (i: OrderItem) => {
    const o = byId.get(i.orderId);
    const v = o ? vById.get(o.vehicleId) : undefined;
    const m = STATUS_META[i.procurementStatus ?? 'needed'];
    return (
      <ListRow
        key={i.id}
        onClick={() => setProc(i)}
        // A swipe to the right is the part's next step: to find → ordered → here.
        leading={
          (i.procurementStatus ?? 'needed') === 'needed'
            ? { label: t('job.part.ordered'), icon: IconReceipt2, color: 'cobalt', onCommit: () => void step(i, 'ordered') }
            : i.procurementStatus === 'ordered' || i.procurementStatus === 'in_transit'
              ? { label: t('job.part.received'), icon: IconCheck, color: 'green', onCommit: () => void step(i, 'received') }
              : undefined
        }
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
      <PageHeader title={t('nav.parts')} />
      <ScrollTabs
        value={tab}
        onChange={(v) => setParams({ tab: v }, { replace: true })}
        items={[
          { value: 'needed', label: t('parts.tabNeeded'), count: needed.length },
          { value: 'ordered', label: t('parts.tabOrdered'), count: ordered.length },
          { value: 'pickup', label: t('parts.tabPickup'), count: pickup.length },
          { value: 'returns', label: t('parts.tabReturns'), count: returns.length },
          { value: 'suppliers', label: t('nav.suppliers'), count: suppliers.filter((s) => !s.archivedAt).length },
        ]}
      />
      <div className="tab-panel">
      {tab === 'needed' && (needed.length ? <List animate>{needed.map(row)}</List> : <EmptyState icon={IconPackage} title={t('parts.nothingNeeded')}>{t('parts.nothingNeededHint')}</EmptyState>)}
      {tab === 'ordered' && (ordered.length ? <List animate>{ordered.map(row)}</List> : <EmptyState icon={IconReceipt2} title={t('parts.nothingOrdered')} />)}
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
      {tab === 'suppliers' && <SuppliersTab />}
      </div>
      <ProcurementModal item={proc} onClose={() => setProc(null)} />
    </>
  );
}
