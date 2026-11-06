import { Avatar, Box, Button, Text, TextInput } from '@mantine/core';
import { IconPlus, IconSearch, IconUsers } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { formatPhone } from '../../domain/phone';
import { EmptyState, List, ListRow, PageHeader } from '../../ui/components';
import { CustomerModal } from './forms';

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

export function CustomersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const list = useLiveQuery(async () => {
    const [cs, vs, orders] = await Promise.all([db.customers.orderBy('name').toArray(), db.vehicles.toArray(), db.orders.toArray()]);
    const s = q.trim().toLowerCase();
    const digits = s.replace(/\D/g, '').replace(/^0+/, '');
    return cs
      .filter((c) => !c.archivedAt && (!s || c.name.toLowerCase().includes(s) || (c.companyName ?? '').toLowerCase().includes(s) || (digits.length >= 3 && c.phone.includes(digits))))
      .map((c) => ({ c, cars: vs.filter((v) => v.customerId === c.id), visits: orders.filter((o) => o.customerId === c.id).length }));
  }, [q]);
  return (
    <>
      <PageHeader
        title={t('nav.customers')}
        subtitle={list ? t('customer.count', { n: list.length }) : undefined}
        right={
          <Button leftSection={<IconPlus size={18} />} onClick={() => setOpen(true)}>
            {t('customer.newShort')}
          </Button>
        }
      />
      <TextInput leftSection={<IconSearch size={18} />} placeholder={t('customer.searchPlaceholder')} value={q} onChange={(e) => setQ(e.currentTarget.value)} mb="md" />
      {list && list.length === 0 ? (
        <EmptyState icon={IconUsers} title={q ? t('search.noResults') : t('customer.empty')} />
      ) : (
        <List>
          {list?.map(({ c, cars, visits }) => (
            <ListRow
              key={c.id}
              onClick={() => navigate(`/customers/${c.id}`)}
              chevron
              left={
                <Avatar color={c.type === 'company' ? 'grape' : 'cobalt'} radius="xl">
                  {initials(c.companyName || c.name)}
                </Avatar>
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
      <CustomerModal opened={open} onClose={() => setOpen(false)} onSaved={(c) => navigate(`/customers/${c.id}`)} />
    </>
  );
}
