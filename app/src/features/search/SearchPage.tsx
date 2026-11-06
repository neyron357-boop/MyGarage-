import { Avatar, Box, Button, Group, Stack, Text, TextInput } from '@mantine/core';
import { IconPlus, IconSearch, IconUserSearch } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import { formatDate } from '../../domain/dates';
import { formatPhone } from '../../domain/phone';
import type { Stage } from '../../domain/types';
import { search, type SearchHit } from '../../services/customers';
import { EmptyState, List, ListRow, PageHeader, PlateText, Section, StageBadge } from '../../ui/components';

export type Hit = SearchHit & { activeOrder?: { id: string; number: number; stage: Stage } };

export function useSearch(q: string) {
  return useLiveQuery(async () => {
    const hits = await search(q);
    const active = await db.orders.filter((o) => o.stage !== 'closed' && o.stage !== 'cancelled').toArray();
    return hits.map((h) => ({ ...h, activeOrder: h.vehicle ? active.find((o) => o.vehicleId === h.vehicle!.id) : undefined })) as Hit[];
  }, [q]);
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

/** A search result: the car (plate first) and its owner. */
export function HitRow({ hit, onClick, right }: { hit: Hit; onClick?: () => void; right?: React.ReactNode }) {
  return (
    <ListRow
      onClick={onClick}
      chevron={!right}
      left={
        hit.vehicle ? (
          <Box w={112} style={{ flexShrink: 0 }}>
            <PlateText plate={hit.vehicle.plate} size="sm" />
          </Box>
        ) : (
          <Avatar color="cobalt" radius="xl">
            {initials(hit.customer.name)}
          </Avatar>
        )
      }
      title={hit.vehicle ? `${hit.vehicle.make} ${hit.vehicle.model}${hit.vehicle.year ? ` ${hit.vehicle.year}` : ''}` : hit.customer.name}
      subtitle={
        <Group gap={6}>
          <span>
            {hit.vehicle ? `${hit.customer.name} · ` : ''}
            {formatPhone(hit.customer.phone)}
          </span>
          {hit.activeOrder && <StageBadge stage={hit.activeOrder.stage} size="sm" />}
        </Group>
      }
      right={right}
    />
  );
}

export function SearchPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  useEffect(() => {
    const p = params.get('q');
    if (p !== null) setQ(p);
  }, [params]);
  const hits = useSearch(q);
  const recent = useLiveQuery(async () => {
    const orders = await db.orders.orderBy('createdAt').reverse().limit(8).toArray();
    const [vs, cs] = await Promise.all([db.vehicles.bulkGet(orders.map((o) => o.vehicleId)), db.customers.bulkGet(orders.map((o) => o.customerId))]);
    return orders.map((o, i) => ({ o, v: vs[i], c: cs[i] }));
  }, []);
  return (
    <>
      <PageHeader title={t('search.title')} />
      <TextInput
        size="lg"
        autoFocus
        leftSection={<IconSearch size={20} />}
        placeholder={t('search.placeholder')}
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
        mb="lg"
        radius="lg"
      />
      {q && hits?.length === 0 && (
        <EmptyState
          icon={IconUserSearch}
          title={t('search.noResults')}
          action={
            <Button leftSection={<IconPlus size={18} />} onClick={() => navigate('/orders/new')}>
              {t('nav.newOrder')}
            </Button>
          }
        >
          {t('search.noResultsHint')}
        </EmptyState>
      )}
      {q && !!hits?.length && (
        <List>
          {hits.map((h) => (
            <HitRow
              key={(h.vehicle?.id ?? '') + h.customer.id}
              hit={h}
              onClick={() => (h.activeOrder ? navigate(`/orders/${h.activeOrder.id}`) : h.vehicle ? navigate(`/vehicles/${h.vehicle.id}`) : navigate(`/customers/${h.customer.id}`))}
              right={
                h.vehicle && !h.activeOrder ? (
                  <Button
                    size="compact-sm"
                    variant="light"
                    style={{ flexShrink: 0 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/orders/new?vehicleId=${h.vehicle!.id}`);
                    }}
                  >
                    {t('search.newJob')}
                  </Button>
                ) : undefined
              }
            />
          ))}
        </List>
      )}
      {!q && (
        <Stack gap={0}>
          <Text size="sm" c="dimmed">
            {t('search.hint')}
          </Text>
          {!!recent?.length && (
            <Section title={t('search.recent')}>
              <List>
                {recent.map(({ o, v, c }) => (
                  <ListRow
                    key={o.id}
                    onClick={() => navigate(`/orders/${o.id}`)}
                    chevron
                    left={v ? <Box w={112} style={{ flexShrink: 0 }}><PlateText plate={v.plate} size="sm" /></Box> : undefined}
                    title={v ? `${v.make} ${v.model}` : `№${o.number}`}
                    subtitle={
                      <Group gap={6}>
                        <span>
                          №{o.number} · {c?.name} · {formatDate(o.createdAt)}
                        </span>
                        <StageBadge stage={o.stage} size="sm" />
                      </Group>
                    }
                  />
                ))}
              </List>
            </Section>
          )}
        </Stack>
      )}
    </>
  );
}
