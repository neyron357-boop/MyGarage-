import { Avatar, Box, Button, Group, Stack, Text, TextInput } from '@mantine/core';
import { IconPlus, IconSearch, IconUserSearch } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Fragment, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import { formatDate } from '../../domain/dates';
import { formatPhone } from '../../domain/phone';
import { matchJobs, splitWords, wordMatches, type JobMatch, type Term } from '../../domain/search';
import type { Customer, Stage } from '../../domain/types';
import { search, type SearchHit } from '../../services/customers';
import { loadJobIndex, type JobHitData } from '../../services/search';
import { EmptyState, List, ListRow, PageHeader, PlateText, Section, StageBadge } from '../../ui/components';
import { useLang } from '../../ui/hooks';

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

function useCustomerName() {
  const { t } = useTranslation();
  return (c: Customer | undefined) => (c ? (c.type === 'company' && c.companyName ? c.companyName : c.name) || t('customer.noName') : '');
}

/** A search result: the car (plate first) and its owner. */
export function HitRow({ hit, onClick, right }: { hit: Hit; onClick?: () => void; right?: React.ReactNode }) {
  const nameOf = useCustomerName();
  const name = nameOf(hit.customer);
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
      title={hit.vehicle ? `${hit.vehicle.make} ${hit.vehicle.model}${hit.vehicle.year ? ` ${hit.vehicle.year}` : ''}` : name}
      subtitle={
        <Group gap={6}>
          <span>
            {hit.vehicle ? name : ''}
            {hit.vehicle && hit.customer.phone ? ' · ' : ''}
            {hit.customer.phone && (
              <span className="tnum" style={{ whiteSpace: 'nowrap' }}>
                {formatPhone(hit.customer.phone)}
              </span>
            )}
          </span>
          {hit.activeOrder && <StageBadge stage={hit.activeOrder.stage} size="sm" />}
        </Group>
      }
      right={right}
    />
  );
}

/** The text with the words the query found highlighted. */
function Marked({ text, terms }: { text: string; terms: Term[] }) {
  return (
    <>
      {splitWords(text).map((part, i) =>
        i % 2 === 1 && wordMatches(part, terms) ? (
          <mark key={i} className="search-mark">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** A job found by what was done in it: the matching lines first, then the job, car and customer. */
function JobRow({ m, onClick }: { m: JobMatch<JobHitData>; onClick: () => void }) {
  const { t } = useTranslation();
  const nameOf = useCustomerName();
  const { order: o, vehicle: v, customer: c } = m.doc.data;
  const car = v ? [v.make, v.model].filter(Boolean).join(' ') : '';
  const shown = m.fields.slice(0, 3);
  const more = m.fields.length - shown.length;
  return (
    <ListRow
      onClick={onClick}
      chevron
      left={v ? <Box w={112} style={{ flexShrink: 0 }}><PlateText plate={v.plate} size="sm" /></Box> : undefined}
      title={
        m.byNumber ? (
          car || nameOf(c) || `№${o.number}`
        ) : (
          <>
            {shown.map((f, i) => (
              <Fragment key={i}>
                {i > 0 && ' · '}
                {f.kind !== 'item' && <Text span inherit c="dimmed">{`${t(`search.field.${f.kind}`)}: `}</Text>}
                <Marked text={f.text} terms={m.highlight} />
              </Fragment>
            ))}
            {more > 0 && <Text span inherit c="dimmed">{` +${more}`}</Text>}
          </>
        )
      }
      subtitle={
        <Group gap={6}>
          <span>{[`№${o.number}`, formatDate(o.createdAt), !m.byNumber && car, nameOf(c)].filter(Boolean).join(' · ')}</span>
          <StageBadge stage={o.stage} size="sm" />
        </Group>
      }
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
  const lang = useLang();
  const nameOf = useCustomerName();
  // Typing stays instant; the lists follow a moment later.
  const dq = useDeferredValue(q);
  const hits = useSearch(dq);
  // Read once (and again when the data changes); each letter only filters it.
  const jobIndex = useLiveQuery(() => loadJobIndex(lang), [lang]);
  const jobs = useMemo(() => (jobIndex && dq.trim() ? matchJobs(jobIndex, dq) : undefined), [jobIndex, dq]);
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
      {q && hits?.length === 0 && jobs?.total === 0 && (
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
        <Section title={t('search.cars')} mt={0}>
          <List key="hits">
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
        </Section>
      )}
      {q && !!jobs?.total && (
        <Section
          title={t('search.jobs')}
          description={jobs.total > jobs.matches.length ? t('search.jobsMore', { n: jobs.matches.length, total: jobs.total }) : undefined}
          mt={hits?.length ? 'xl' : 0}
        >
          <List key="jobs">
            {jobs.matches.map((m) => (
              <JobRow key={m.doc.orderId} m={m} onClick={() => navigate(`/orders/${m.doc.orderId}`)} />
            ))}
          </List>
        </Section>
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
                          {[`№${o.number}`, nameOf(c), formatDate(o.createdAt)].join(' · ')}
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
