import { Button, Card, Group, Stack, Text, TextInput } from '@mantine/core';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { formatPhone } from '../../domain/phone';
import { search, type SearchHit } from '../../services/customers';
import { EmptyState, PageHeader, PlateText, StageBadge } from '../../ui/components';

export function useSearch(q: string) {
  return useLiveQuery(async () => {
    const hits = await search(q);
    const active = await db.orders.filter((o) => o.stage !== 'closed' && o.stage !== 'cancelled').toArray();
    return hits.map((h) => ({ ...h, activeOrder: h.vehicle ? active.find((o) => o.vehicleId === h.vehicle!.id) : undefined }));
  }, [q]);
}

export function HitCard({ hit, onClick, right }: { hit: SearchHit & { activeOrder?: { id: string; number: number; stage: import('../../domain/types').Stage } }; onClick?: () => void; right?: React.ReactNode }) {
  return (
    <Card withBorder padding="sm" className={onClick ? 'tap-card' : undefined} onClick={onClick}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={2} style={{ minWidth: 0 }}>
          {hit.vehicle && (
            <Group gap="xs">
              <PlateText plate={hit.vehicle.plate} />
              <Text fw={600} size="sm">{hit.vehicle.make} {hit.vehicle.model} {hit.vehicle.year ?? ''}</Text>
            </Group>
          )}
          <Text size="sm">{hit.customer.name} · {formatPhone(hit.customer.phone)}</Text>
          {hit.activeOrder && (
            <Group gap={6}>
              <Text size="xs" c="dimmed">№{hit.activeOrder.number}</Text>
              <StageBadge stage={hit.activeOrder.stage} />
            </Group>
          )}
        </Stack>
        {right}
      </Group>
    </Card>
  );
}

export function SearchPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const hits = useSearch(q);
  return (
    <>
      <PageHeader title={t('search.title')} />
      <TextInput
        size="lg"
        autoFocus
        leftSection={<IconSearch />}
        placeholder={t('search.placeholder')}
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
        mb="md"
      />
      <Stack gap="xs">
        {q && hits?.length === 0 && (
          <EmptyState>
            <Text mb="sm">{t('search.noResults')}</Text>
            <Button leftSection={<IconPlus size={18} />} onClick={() => navigate('/orders/new')}>{t('nav.newOrder')}</Button>
          </EmptyState>
        )}
        {hits?.map((h) => (
          <HitCard
            key={(h.vehicle?.id ?? '') + h.customer.id}
            hit={h}
            onClick={() =>
              h.activeOrder ? navigate(`/orders/${h.activeOrder.id}`) : h.vehicle ? navigate(`/vehicles/${h.vehicle.id}`) : navigate(`/customers/${h.customer.id}`)
            }
            right={
              h.vehicle && !h.activeOrder ? (
                <Button
                  size="xs"
                  variant="light"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/orders/new?vehicleId=${h.vehicle!.id}`);
                  }}
                >
                  {t('nav.newOrder')}
                </Button>
              ) : undefined
            }
          />
        ))}
        {!q && <Text c="dimmed" size="sm">{t('search.hint')}</Text>}
      </Stack>
    </>
  );
}
