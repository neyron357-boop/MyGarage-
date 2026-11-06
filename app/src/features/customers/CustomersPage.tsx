import { Button, Card, Group, Stack, Text, TextInput } from '@mantine/core';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { formatPhone } from '../../domain/phone';
import { PageHeader } from '../../ui/components';
import { CustomerModal } from './forms';

export function CustomersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const list = useLiveQuery(async () => {
    const [cs, vs] = await Promise.all([db.customers.orderBy('name').toArray(), db.vehicles.toArray()]);
    const s = q.trim().toLowerCase();
    return cs
      .filter((c) => !c.archivedAt && (!s || c.name.toLowerCase().includes(s) || c.phone.includes(s.replace(/\D/g, '') || '¤')))
      .map((c) => ({ c, cars: vs.filter((v) => v.customerId === c.id) }));
  }, [q]);
  return (
    <>
      <PageHeader title={t('nav.customers')} right={<Button leftSection={<IconPlus size={18} />} onClick={() => setOpen(true)}>{t('customer.new')}</Button>} />
      <TextInput leftSection={<IconSearch />} placeholder={t('customer.searchPlaceholder')} value={q} onChange={(e) => setQ(e.currentTarget.value)} mb="md" />
      <Stack gap="xs">
        {list?.map(({ c, cars }) => (
          <Card key={c.id} withBorder padding="sm" className="tap-card" onClick={() => navigate(`/customers/${c.id}`)}>
            <Group justify="space-between">
              <div>
                <Text fw={600}>{c.type === 'company' && c.companyName ? `${c.companyName} (${c.name})` : c.name}</Text>
                <Text size="sm" c="dimmed">{formatPhone(c.phone)}</Text>
              </div>
              <Text size="sm" c="dimmed">{cars.map((v) => `${v.make} ${v.model}`).join(', ')}</Text>
            </Group>
          </Card>
        ))}
      </Stack>
      <CustomerModal opened={open} onClose={() => setOpen(false)} onSaved={(c) => navigate(`/customers/${c.id}`)} />
    </>
  );
}
