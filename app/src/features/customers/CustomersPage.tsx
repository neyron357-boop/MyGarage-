import { useScreenLiveQuery, usePhone } from '../../ui/hooks';
import { ActionIcon, Box, Text } from '@mantine/core';
import { IconPlus, IconUsers } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { dayShort } from '../../domain/dates';
import { formatPhone } from '../../domain/phone';
import type { Customer, Vehicle } from '../../domain/types';
import { EmptyState, List, ListRow, PageHeader, PersonAvatar, SearchField } from '../../ui/components';
import { DataTable, type Column } from '../../ui/DataTable';
import { CustomerModal } from './forms';

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

type Row = { c: Customer; cars: Vehicle[]; visits: number; last: string };

export function CustomersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const phone = usePhone();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const list = useScreenLiveQuery(async () => {
    const [cs, vs, orders] = await Promise.all([db.customers.orderBy('name').toArray(), db.vehicles.toArray(), db.orders.toArray()]);
    const s = q.trim().toLowerCase();
    const digits = s.replace(/\D/g, '').replace(/^0+/, '');
    return cs
      .filter((c) => !c.archivedAt && (!s || c.name.toLowerCase().includes(s) || (c.companyName ?? '').toLowerCase().includes(s) || (digits.length >= 3 && c.phone.includes(digits))))
      .map((c): Row => {
        const mine = orders.filter((o) => o.customerId === c.id);
        // The last visit (v0.41, a PC's column): the newest job of the customer.
        const last = mine.reduce((m, o) => (o.createdAt > m ? o.createdAt : m), '');
        return { c, cars: vs.filter((v) => v.customerId === c.id), visits: mine.length, last };
      });
  }, [q]);
  const nameOf = (c: Customer) => (c.type === 'company' && c.companyName ? c.companyName : c.name);
  const open1 = (c: Customer) => navigate(`/customers/${c.id}`);
  // On a PC (v0.41): one table — a customer a line, sorted by a click on a head.
  const cols: Column<Row>[] = [
    {
      key: 'customer',
      label: t('desk.col.customer'),
      sort: (r) => nameOf(r.c).toLowerCase(),
      cell: (r) => (
        <span className="dt-who">
          <PersonAvatar name={r.c.companyName || r.c.name} company={r.c.type === 'company'} size={34} />
          <span className="dt-main dt-clip">{nameOf(r.c) || t('customer.noName')}</span>
        </span>
      ),
    },
    { key: 'phone', label: t('desk.col.phone'), cell: (r) => (r.c.phone ? formatPhone(r.c.phone) : ''), sort: (r) => r.c.phone, muted: true, nowrap: true, width: 190 },
    { key: 'cars', label: t('desk.col.cars'), cell: (r) => <span className="dt-clip">{r.cars.map((v) => [v.make, v.model].filter(Boolean).join(' ')).filter(Boolean).join(', ')}</span>, sort: (r) => r.cars.length, desc: true },
    { key: 'visits', label: t('desk.col.visits'), cell: (r) => r.visits, sort: (r) => r.visits, desc: true, align: 'right', width: 110 },
    {
      key: 'last',
      label: t('desk.col.last'),
      cell: (r) => {
        if (!r.last) return '';
        const d = dayShort(r.last);
        return d.word ? t(`common.${d.word}`) : d.text;
      },
      sort: (r) => r.last,
      desc: true,
      align: 'right',
      muted: true,
      nowrap: true,
      width: 140,
    },
  ];
  return (
    <>
      <PageHeader
        title={t('nav.customers')}
        subtitle={list ? t('customer.count', { n: list.length }) : undefined}
        right={
          <ActionIcon variant="default" size={40} radius="xl" aria-label={t('customer.newShort')} onClick={() => setOpen(true)}>
            <IconPlus size={22} stroke={2.2} />
          </ActionIcon>
        }
      />
      <Box mb="md" maw={phone ? undefined : 560}>
        <SearchField placeholder={t('customer.searchPlaceholder')} value={q} onChange={setQ} />
      </Box>
      {list && list.length === 0 ? (
        <EmptyState icon={IconUsers} title={q ? t('search.noResults') : t('customer.empty')} />
      ) : !phone ? (
        list && <DataTable rows={list} columns={cols} rowKey={(r) => r.c.id} onRow={(r) => open1(r.c)} rowRoute={(r) => `/customers/${r.c.id}`} initialSort={{ key: 'customer', dir: 1 }} sortId="customers" label={t('nav.customers')} />
      ) : (
        <List>
          {list?.map(({ c, cars, visits }) => (
            <ListRow
              key={c.id}
              onClick={() => open1(c)}
              chevron
              left={
                <PersonAvatar name={c.companyName || c.name} company={c.type === 'company'} size={44} />
              }
              title={c.type === 'company' && c.companyName ? c.companyName : c.name}
              subtitle={
                <>
                  {formatPhone(c.phone)}
                  {cars.length ? ` · ${cars.map((v) => `${v.make} ${v.model}`).join(', ')}` : ''}
                </>
              }
              right={
                <Box ta="right" visibleFrom="xs" style={{ flexShrink: 0 }}>
                  <Text size="sm" fw={700} className="tnum">
                    {visits}
                  </Text>
                  <Text size="10px" c="dimmed">
                    {t('customer.visits')}
                  </Text>
                </Box>
              }
            />
          ))}
        </List>
      )}
      <CustomerModal opened={open} onClose={() => setOpen(false)} onSaved={(c) => navigate(`/customers/${c.id}`)} onPick={(c) => navigate(`/customers/${c.id}`)} />
    </>
  );
}
