import { ActionIcon, Alert, Button, Card, FileButton, Group, Image, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Switch, Table, Tabs, Text, TextInput, Textarea, Title } from '@mantine/core';
import { IconDownload, IconPlus, IconTrash, IconUpload } from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { db, uid } from '../../db/db';
import { dubaiDate } from '../../domain/dates';
import type { Employee, ExpenseCategory, JobTemplate, Settings, TemplateItem } from '../../domain/types';
import { downloadBlob, exportBackup, importBackup, wipeAll } from '../../services/backup';
import { loadDemoData } from '../../services/demo';
import { blobToDataUrl } from '../../services/media';
import { saveSettings } from '../../services/settings';
import { MoneyInput, PageHeader } from '../../ui/components';
import { useAction, useLang, useSettings } from '../../ui/hooks';

function BusinessTab({ s }: { s: Settings }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [v, setV] = useState(s);
  useEffect(() => setV(s), [s]);
  const set = (p: Partial<Settings>) => setV((x) => ({ ...x, ...p }));
  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <TextInput label={t('settings.name')} value={v.name} onChange={(e) => set({ name: e.currentTarget.value })} />
        <TextInput label="TRN" value={v.trn} onChange={(e) => set({ trn: e.currentTarget.value })} />
        <TextInput label={t('customer.address')} value={v.address} onChange={(e) => set({ address: e.currentTarget.value })} />
        <TextInput label={t('customer.phone')} value={v.phone} onChange={(e) => set({ phone: e.currentTarget.value })} />
        <TextInput label="Email" value={v.email} onChange={(e) => set({ email: e.currentTarget.value })} />
        <TextInput label={t('settings.maps')} value={v.googleMapsUrl} onChange={(e) => set({ googleMapsUrl: e.currentTarget.value })} />
      </SimpleGrid>
      <Textarea label={t('settings.bank')} value={v.bankDetails} onChange={(e) => set({ bankDetails: e.currentTarget.value })} autosize />
      <Group>
        {v.logoDataUrl && <Image src={v.logoDataUrl} h={60} w="auto" fit="contain" />}
        <FileButton accept="image/png,image/jpeg" onChange={(f) => f && run(async () => set({ logoDataUrl: await blobToDataUrl(f) }))}>
          {(props) => <Button variant="default" {...props}>{t('settings.logo')}</Button>}
        </FileButton>
        {v.logoDataUrl && <Button variant="subtle" color="red" onClick={() => set({ logoDataUrl: undefined })}>{t('common.delete')}</Button>}
      </Group>
      <Button loading={busy} onClick={() => run(() => saveSettings({ ...v, setupDone: true }), 'common.saved')}>{t('common.save')}</Button>
    </Stack>
  );
}

function RulesTab({ s }: { s: Settings }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [v, setV] = useState(s);
  useEffect(() => setV(s), [s]);
  const set = (p: Partial<Settings>) => setV((x) => ({ ...x, ...p }));
  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <NumberInput label={t('settings.vatRate')} suffix=" %" decimalScale={2} value={v.vatRateBp / 100} onChange={(x) => set({ vatRateBp: Math.round(Number(x) * 100) })} />
        <Switch mt="xl" label={t('settings.pricesIncludeVat')} checked={v.pricesIncludeVat} onChange={(e) => set({ pricesIncludeVat: e.currentTarget.checked })} />
        <NumberInput label={t('settings.markup')} suffix=" %" value={v.defaultMarkupBp / 100} onChange={(x) => set({ defaultMarkupBp: Math.round(Number(x) * 100) })} />
        <MoneyInput label={t('settings.laborRate')} value={v.laborRateFils} onChange={(x) => set({ laborRateFils: x ?? 0 })} />
        <MoneyInput label={t('settings.noCallLimit')} value={v.defaultNoCallLimitFils} onChange={(x) => set({ defaultNoCallLimitFils: x ?? 0 })} />
        <MoneyInput label={t('settings.prepayThreshold')} value={v.prepaymentThresholdFils} onChange={(x) => set({ prepaymentThresholdFils: x ?? 0 })} />
        <NumberInput label={t('settings.validity')} value={v.estimateValidityDays} min={1} onChange={(x) => set({ estimateValidityDays: Number(x) || 7 })} />
        <NumberInput label={t('cond.freeStorage')} value={v.freeStorageDays} min={0} onChange={(x) => set({ freeStorageDays: Number(x) || 0 })} />
        <MoneyInput label={t('cond.storageFee')} value={v.storageFeePerDayFils} onChange={(x) => set({ storageFeePerDayFils: x ?? 0 })} />
        <MoneyInput label={t('cond.diagnosticsFee')} value={v.diagnosticsFeeFils} onChange={(x) => set({ diagnosticsFeeFils: x ?? 0 })} />
        <NumberInput label={t('settings.warrantyMonths')} value={v.warrantyLaborMonths} min={0} onChange={(x) => set({ warrantyLaborMonths: Number(x) || 0 })} />
        <NumberInput label={t('settings.warrantyKm')} value={v.warrantyLaborKm} min={0} onChange={(x) => set({ warrantyLaborKm: Number(x) || 0 })} />
        <NumberInput label={t('settings.warnHours')} value={v.boardWarnHours} min={0} onChange={(x) => set({ boardWarnHours: Number(x) || 0 })} />
        <NumberInput label={t('settings.alertHours')} value={v.boardAlertHours} min={0} onChange={(x) => set({ boardAlertHours: Number(x) || 0 })} />
      </SimpleGrid>
      <Button loading={busy} onClick={() => run(() => saveSettings(v), 'common.saved')}>{t('common.save')}</Button>
    </Stack>
  );
}

function TextsTab({ s }: { s: Settings }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [v, setV] = useState(s);
  useEffect(() => setV(s), [s]);
  const field = (key: 'intakeTerms' | 'warrantyText' | 'docFooter', lang: 'ru' | 'en') => (
    <Textarea label={`${t(`settings.${key}`)} (${lang.toUpperCase()})`} autosize minRows={2} value={v[key][lang] ?? ''} onChange={(e) => setV({ ...v, [key]: { ...v[key], [lang]: e.currentTarget.value } })} />
  );
  return (
    <Stack>
      <Alert>{t('settings.textsHint')}</Alert>
      {field('intakeTerms', 'ru')}
      {field('intakeTerms', 'en')}
      {field('warrantyText', 'ru')}
      {field('warrantyText', 'en')}
      {field('docFooter', 'ru')}
      {field('docFooter', 'en')}
      <Button loading={busy} onClick={() => run(() => saveSettings(v), 'common.saved')}>{t('common.save')}</Button>
    </Stack>
  );
}

function StaffTab() {
  const { t } = useTranslation();
  const { run } = useAction();
  const list = useLiveQuery(() => db.employees.toArray(), []);
  const upd = (id: string, p: Partial<Employee>) => run(() => db.employees.update(id, p));
  return (
    <Stack>
      {list?.map((e) => (
        <Paper key={e.id} withBorder p="sm">
          <SimpleGrid cols={{ base: 1, sm: 4 }}>
            <TextInput label={t('customer.name')} defaultValue={e.name} onBlur={(ev) => upd(e.id, { name: ev.currentTarget.value })} />
            <Select label={t('settings.role')} value={e.role} onChange={(r) => r && upd(e.id, { role: r as Employee['role'] })} data={(['mechanic', 'electrician', 'other'] as const).map((r) => ({ value: r, label: t(`role.${r}`) }))} allowDeselect={false} />
            <MoneyInput label={t('salary.salary')} value={e.monthlySalaryFils} onChange={(x) => upd(e.id, { monthlySalaryFils: x ?? 0 })} />
            <Switch mt="xl" label={t('settings.active')} checked={e.active} onChange={(ev) => upd(e.id, { active: ev.currentTarget.checked })} />
          </SimpleGrid>
        </Paper>
      ))}
      <Button variant="light" leftSection={<IconPlus size={18} />} onClick={() => run(() => db.employees.add({ id: uid(), name: t('role.mechanic'), role: 'mechanic', monthlySalaryFils: 0, active: true }))} w="fit-content">
        {t('settings.addEmployee')}
      </Button>
    </Stack>
  );
}

function TemplateEditor({ tpl, onClose }: { tpl: JobTemplate | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const [v, setV] = useState<JobTemplate | null>(tpl);
  useEffect(() => setV(tpl), [tpl]);
  if (!v) return null;
  const setItem = (i: number, p: Partial<TemplateItem>) => setV({ ...v, items: v.items.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  return (
    <Modal opened onClose={onClose} title={t('settings.template')} size="xl">
      <Stack>
        <SimpleGrid cols={2}>
          <TextInput label={`${t('item.title')} RU`} value={v.titleRu} onChange={(e) => setV({ ...v, titleRu: e.currentTarget.value })} />
          <TextInput label={`${t('item.title')} EN`} value={v.titleEn} onChange={(e) => setV({ ...v, titleEn: e.currentTarget.value })} />
        </SimpleGrid>
        {v.items.map((it, i) => (
          <Paper key={i} withBorder p="xs">
            <SimpleGrid cols={{ base: 2, sm: 6 }} spacing="xs">
              <Select label={t('item.kind.label')} value={it.kind} onChange={(k) => k && setItem(i, { kind: k as TemplateItem['kind'] })} data={(['labor', 'part', 'fee'] as const).map((k) => ({ value: k, label: t(`item.kind.${k}`) }))} allowDeselect={false} />
              <TextInput label="RU" value={it.titleRu} onChange={(e) => setItem(i, { titleRu: e.currentTarget.value })} />
              <TextInput label="EN" value={it.titleEn} onChange={(e) => setItem(i, { titleEn: e.currentTarget.value })} />
              <NumberInput label={t('common.qty')} value={it.qty} decimalScale={2} onChange={(x) => setItem(i, { qty: Number(x) || 0 })} />
              <MoneyInput label={t('item.unitPrice')} value={it.unitPriceFils} onChange={(x) => setItem(i, { unitPriceFils: x ?? 0 })} />
              <ActionIcon mt="xl" color="red" variant="subtle" onClick={() => setV({ ...v, items: v.items.filter((_, j) => j !== i) })}><IconTrash size={16} /></ActionIcon>
            </SimpleGrid>
          </Paper>
        ))}
        <Button variant="light" onClick={() => setV({ ...v, items: [...v.items, { kind: 'labor', block: 'A', titleRu: '', titleEn: '', qty: 1, unit: 'pcs', unitPriceFils: 0 }] })}>{t('common.add')}</Button>
        <Text size="xs" c="dimmed">{t('settings.pricesNet')}</Text>
        <Group justify="space-between">
          <Switch label={t('settings.active')} checked={v.active} onChange={(e) => setV({ ...v, active: e.currentTarget.checked })} />
          <Button loading={busy} onClick={() => run(async () => { await db.jobTemplates.put(v); onClose(); }, 'common.saved')}>{t('common.save')}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function PricesTab() {
  const { t } = useTranslation();
  const lang = useLang();
  const list = useLiveQuery(() => db.jobTemplates.toArray(), []);
  const [edit, setEdit] = useState<JobTemplate | null>(null);
  return (
    <Stack gap="xs">
      <Alert>{t('settings.pricesHint')}</Alert>
      <Button w="fit-content" leftSection={<IconPlus size={18} />} onClick={() => setEdit({ id: uid(), code: `custom_${Date.now()}`, titleRu: '', titleEn: '', items: [], active: true })}>{t('settings.newTemplate')}</Button>
      {list?.map((tpl) => (
        <Card key={tpl.id} withBorder padding="xs" className="tap-card" onClick={() => setEdit(tpl)} opacity={tpl.active ? 1 : 0.5}>
          <Group justify="space-between">
            <Text size="sm" fw={500}>{lang === 'ru' ? tpl.titleRu : tpl.titleEn}</Text>
            <Text size="sm" c="dimmed">{(tpl.items.reduce((s, i) => s + i.qty * i.unitPriceFils, 0) / 100).toFixed(2)} AED</Text>
          </Group>
        </Card>
      ))}
      <TemplateEditor tpl={edit} onClose={() => setEdit(null)} />
    </Stack>
  );
}

function CategoriesTab() {
  const { t } = useTranslation();
  const { run } = useAction();
  const list = useLiveQuery(() => db.expenseCategories.toArray(), []);
  const upd = (id: string, p: Partial<ExpenseCategory>) => run(() => db.expenseCategories.update(id, p));
  return (
    <Stack>
      <Table>
        <Table.Thead><Table.Tr><Table.Th>RU</Table.Th><Table.Th>EN</Table.Th><Table.Th>{t('settings.monthlyLimit')}</Table.Th><Table.Th>{t('settings.active')}</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {list?.map((c) => (
            <Table.Tr key={c.id}>
              <Table.Td><TextInput size="xs" defaultValue={c.nameRu} onBlur={(e) => upd(c.id, { nameRu: e.currentTarget.value })} /></Table.Td>
              <Table.Td><TextInput size="xs" defaultValue={c.nameEn} onBlur={(e) => upd(c.id, { nameEn: e.currentTarget.value })} /></Table.Td>
              <Table.Td><MoneyInput label="" value={c.monthlyLimitFils} onChange={(x) => upd(c.id, { monthlyLimitFils: x ?? 0 })} /></Table.Td>
              <Table.Td><Switch checked={c.active} disabled={c.code === 'salaries' || c.code === 'incidents'} onChange={(e) => upd(c.id, { active: e.currentTarget.checked })} /></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Button w="fit-content" variant="light" leftSection={<IconPlus size={18} />} onClick={() => run(() => db.expenseCategories.add({ id: uid(), code: `c_${Date.now()}`, nameRu: 'Новая категория', nameEn: 'New category', monthlyLimitFils: 0, active: true }))}>{t('common.add')}</Button>
      <Text size="xs" c="dimmed">{t('settings.limitHint')}</Text>
    </Stack>
  );
}

function DataTab() {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const orders = useLiveQuery(() => db.orders.count(), []);
  const [wipe, setWipe] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  return (
    <Stack>
      <Alert color="blue" title={t('more.localTitle')}>{t('settings.dataHint')}</Alert>
      <Paper withBorder p="md">
        <Title order={6} mb="xs">{t('settings.backup')}</Title>
        <Group>
          <Button leftSection={<IconDownload size={18} />} loading={busy} onClick={() => run(async () => downloadBlob(await exportBackup(), `mygarage-backup-${dubaiDate()}.json`), 'settings.backupDone')}>{t('settings.export')}</Button>
          <FileButton accept="application/json" onChange={(f) => f && run(async () => { await importBackup(f); window.location.reload(); })}>
            {(props) => <Button variant="default" leftSection={<IconUpload size={18} />} {...props}>{t('settings.import')}</Button>}
          </FileButton>
        </Group>
        <Text size="xs" c="dimmed" mt="xs">{t('settings.importWarning')}</Text>
      </Paper>
      {orders === 0 && (
        <Paper withBorder p="md">
          <Title order={6} mb="xs">{t('settings.demo')}</Title>
          <Text size="sm" mb="xs">{t('settings.demoHint')}</Text>
          <Button variant="light" loading={busy} onClick={() => run(loadDemoData, 'common.saved')}>{t('settings.loadDemo')}</Button>
        </Paper>
      )}
      <Paper withBorder p="md">
        <Title order={6} mb="xs" c="red">{t('settings.wipe')}</Title>
        <Button color="red" variant="outline" onClick={() => setWipe(true)}>{t('settings.wipe')}</Button>
      </Paper>
      <Modal opened={wipe} onClose={() => setWipe(false)} title={t('settings.wipe')}>
        <Text size="sm" mb="sm">{t('settings.wipeConfirm')}</Text>
        <TextInput value={confirmText} onChange={(e) => setConfirmText(e.currentTarget.value)} placeholder="DELETE" />
        <Button mt="md" color="red" fullWidth disabled={confirmText !== 'DELETE'} onClick={() => run(async () => { await wipeAll(); window.location.reload(); })}>{t('common.delete')}</Button>
      </Modal>
    </Stack>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const s = useSettings();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'business';
  if (!s) return null;
  return (
    <>
      <PageHeader title={t('nav.settings')} />
      <Tabs value={tab} onChange={(v) => setParams({ tab: v ?? 'business' })} mb="md">
        <Tabs.List>
          {['business', 'rules', 'texts', 'staff', 'prices', 'categories', 'data'].map((k) => (
            <Tabs.Tab key={k} value={k}>{t(`settings.tab.${k}`)}</Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
      {tab === 'business' && <BusinessTab s={s} />}
      {tab === 'rules' && <RulesTab s={s} />}
      {tab === 'texts' && <TextsTab s={s} />}
      {tab === 'staff' && <StaffTab />}
      {tab === 'prices' && <PricesTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'data' && <DataTab />}
    </>
  );
}
