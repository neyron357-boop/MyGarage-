import {
  ActionIcon,
  Alert,
  Avatar,
  Box,
  Button,
  FileButton,
  Grid,
  Group,
  Image,
  Modal,
  NavLink,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconBuildingStore,
  IconCategory,
  IconCheck,
  IconDeviceMobile,
  IconDatabase,
  IconDownload,
  IconFileText,
  IconList,
  IconPlus,
  IconSettings,
  IconTemplate,
  IconTrash,
  IconUpload,
  IconUsers,
  type Icon,
} from '@tabler/icons-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { db, uid } from '../../db/db';
import { dubaiDate, formatDateTime } from '../../domain/dates';
import { formatAed } from '../../domain/money';
import type { Employee, ExpenseCategory, JobTemplate, Settings, TemplateItem } from '../../domain/types';
import { importBackup, saveBackupFile, wipeAll } from '../../services/backup';
import { loadDemoData } from '../../services/demo';
import { blobToDataUrl } from '../../services/media';
import { saveCategory, saveEmployee, saveSettings, saveTemplate } from '../../services/settings';
import { ConfirmModal, List, ListRow, MoneyInput, PageHeader, PageSkeleton, ScrollTabs, StickyBar } from '../../ui/components';
import { formatBytes, insecureContext, requestPersistence, useBackupAge, useStorageInfo } from '../../ui/device';
import { useAction, useLang, useSettings } from '../../ui/hooks';
import { useInstall } from '../../ui/pwa';
import { hasUnsaved, useMarkUnsaved } from '../../ui/unsaved';
import { initials } from '../customers/CustomersPage';
import { EaglecartImportCard } from './EaglecartImport';

function Card({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <Box className="surface" p="md">
      <Title order={5}>{title}</Title>
      {description && (
        <Text size="xs" c="dimmed" mt={2}>
          {description}
        </Text>
      )}
      <Box mt="md">{children}</Box>
    </Box>
  );
}

function useDraft(s: Settings) {
  const [v, setV] = useState(s);
  useEffect(() => setV(s), [s]);
  const set = (p: Partial<Settings>) => setV((x) => ({ ...x, ...p }));
  const dirty = JSON.stringify(v) !== JSON.stringify(s);
  return { v, set, setV, dirty };
}

function SaveBar({ dirty, onSave, busy }: { dirty: boolean; onSave: () => void; busy: boolean }) {
  const { t } = useTranslation();
  useMarkUnsaved(dirty);
  if (!dirty) return null;
  return (
    <StickyBar>
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm" fw={600}>
          {t('settings.unsaved')}
        </Text>
        <Button onClick={onSave} loading={busy}>
          {t('common.save')}
        </Button>
      </Group>
    </StickyBar>
  );
}

function BusinessTab({ s }: { s: Settings }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const { v, set, dirty } = useDraft(s);
  return (
    <Stack gap="md">
      <Card title={t('settings.identity')} description={t('settings.identityHint')}>
        <Group gap="md" mb="md" wrap="nowrap">
          {v.logoDataUrl ? (
            <Image src={v.logoDataUrl} h={64} w={64} fit="contain" radius="md" bg="var(--app-soft)" />
          ) : (
            <ThemeIcon size={64} radius="md" variant="light" color="gray">
              <IconBuildingStore size={30} />
            </ThemeIcon>
          )}
          <Group gap="xs">
            <FileButton accept="image/png,image/jpeg" onChange={(f) => f && run(async () => set({ logoDataUrl: await blobToDataUrl(f) }))}>
              {(props) => (
                <Button variant="default" size="sm" {...props}>
                  {t('settings.logo')}
                </Button>
              )}
            </FileButton>
            {v.logoDataUrl && (
              <Button variant="subtle" color="red" size="sm" onClick={() => set({ logoDataUrl: undefined })}>
                {t('common.delete')}
              </Button>
            )}
          </Group>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label={t('settings.name')} value={v.name} onChange={(e) => set({ name: e.currentTarget.value })} />
          <TextInput label="TRN" description={t('settings.trnHint')} value={v.trn} onChange={(e) => set({ trn: e.currentTarget.value })} />
          {/* The right-hand side of the document header, as on the garage's invoices. */}
          <TextInput label={t('settings.nameAr')} dir="rtl" value={v.nameAr ?? ''} onChange={(e) => set({ nameAr: e.currentTarget.value })} />
          <TextInput label={t('settings.addressAr')} dir="rtl" value={v.addressAr ?? ''} onChange={(e) => set({ addressAr: e.currentTarget.value })} />
        </SimpleGrid>
      </Card>
      <Card title={t('settings.contacts')}>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label={t('customer.address')} value={v.address} onChange={(e) => set({ address: e.currentTarget.value })} />
          <TextInput label={t('customer.phone')} type="tel" value={v.phone} onChange={(e) => set({ phone: e.currentTarget.value })} />
          <TextInput label="Email" type="email" value={v.email} onChange={(e) => set({ email: e.currentTarget.value })} />
          <TextInput label={t('settings.maps')} value={v.googleMapsUrl} onChange={(e) => set({ googleMapsUrl: e.currentTarget.value })} />
        </SimpleGrid>
        <Textarea mt="sm" label={t('settings.bank')} value={v.bankDetails} onChange={(e) => set({ bankDetails: e.currentTarget.value })} autosize minRows={2} />
      </Card>
      <SaveBar dirty={dirty} busy={busy} onSave={() => run(() => saveSettings({ ...v, setupDone: true }), 'common.saved')} />
    </Stack>
  );
}

function RulesTab({ s }: { s: Settings }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const { v, set, dirty } = useDraft(s);
  return (
    <Stack gap="md">
      <Card title={t('settings.pricing')} description={t('settings.pricingHint')}>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <NumberInput label={t('settings.vatRate')} suffix=" %" decimalScale={2} value={v.vatRateBp / 100} onChange={(x) => set({ vatRateBp: Math.round(Number(x) * 100) })} />
          <NumberInput label={t('settings.markup')} suffix=" %" value={v.defaultMarkupBp / 100} onChange={(x) => set({ defaultMarkupBp: Math.round(Number(x) * 100) })} />
          <MoneyInput label={t('settings.laborRate')} value={v.laborRateFils} onChange={(x) => set({ laborRateFils: x ?? 0 })} />
          <Switch mt={{ sm: 'xl' }} label={t('settings.pricesIncludeVat')} checked={v.pricesIncludeVat} onChange={(e) => set({ pricesIncludeVat: e.currentTarget.checked })} />
        </SimpleGrid>
      </Card>
      <Card title={t('settings.protection')} description={t('settings.protectionHint')}>
        {/* No-call limit, parking and diagnostics fees were dropped with the fast check-in. */}
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <MoneyInput label={t('settings.prepayThreshold')} value={v.prepaymentThresholdFils} onChange={(x) => set({ prepaymentThresholdFils: x ?? 0 })} />
          <NumberInput label={t('settings.validity')} value={v.estimateValidityDays} min={1} onChange={(x) => set({ estimateValidityDays: Number(x) || 7 })} />
        </SimpleGrid>
      </Card>
      <Card title={t('settings.warranty')}>
        <SimpleGrid cols={2}>
          <NumberInput label={t('settings.warrantyMonths')} value={v.warrantyLaborMonths} min={0} onChange={(x) => set({ warrantyLaborMonths: Number(x) || 0 })} />
          <NumberInput label={t('settings.warrantyKm')} value={v.warrantyLaborKm} min={0} thousandSeparator=" " onChange={(x) => set({ warrantyLaborKm: Number(x) || 0 })} />
        </SimpleGrid>
      </Card>
      <Card title={t('settings.board')} description={t('settings.boardHint')}>
        <SimpleGrid cols={2}>
          <NumberInput label={t('settings.warnHours')} value={v.boardWarnHours} min={0} onChange={(x) => set({ boardWarnHours: Number(x) || 0 })} />
          <NumberInput label={t('settings.alertHours')} value={v.boardAlertHours} min={0} onChange={(x) => set({ boardAlertHours: Number(x) || 0 })} />
        </SimpleGrid>
      </Card>
      <SaveBar dirty={dirty} busy={busy} onSave={() => run(() => saveSettings(v), 'common.saved')} />
    </Stack>
  );
}

function TextsTab({ s }: { s: Settings }) {
  const { t } = useTranslation();
  const { run, busy } = useAction();
  const { v, setV, dirty } = useDraft(s);
  const pair = (key: 'intakeTerms' | 'warrantyText' | 'docFooter') => (
    <Card title={t(`settings.${key}`)}>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        {(['ru', 'en'] as const).map((lang) => (
          <Textarea key={lang} label={lang === 'ru' ? 'Русский' : 'English'} autosize minRows={3} value={v[key][lang] ?? ''} onChange={(e) => setV({ ...v, [key]: { ...v[key], [lang]: e.currentTarget.value } })} />
        ))}
      </SimpleGrid>
    </Card>
  );
  return (
    <Stack gap="md">
      <Alert>{t('settings.textsHint')}</Alert>
      {pair('intakeTerms')}
      {pair('warrantyText')}
      {pair('docFooter')}
      <Card title={t('settings.docFooterAr')}>
        <Textarea dir="rtl" autosize minRows={2} value={v.docFooterAr ?? ''} onChange={(e) => setV({ ...v, docFooterAr: e.currentTarget.value })} />
      </Card>
      <SaveBar dirty={dirty} busy={busy} onSave={() => run(() => saveSettings(v), 'common.saved')} />
    </Stack>
  );
}

function StaffTab() {
  const { t } = useTranslation();
  const { run } = useAction();
  const list = useLiveQuery(() => db.employees.toArray(), []);
  const [edit, setEdit] = useState<Employee | null>(null);
  return (
    <Stack gap="md">
      <List>
        {list?.map((e) => (
          <ListRow
            key={e.id}
            onClick={() => setEdit(e)}
            chevron
            left={
              <Avatar color={e.active ? 'cobalt' : 'gray'} radius="xl">
                {initials(e.name)}
              </Avatar>
            }
            title={e.name}
            subtitle={`${t(`role.${e.role}`)} · ${t('salary.salary')} ${formatAed(e.monthlySalaryFils)}${e.active ? '' : ` · ${t('settings.inactive')}`}`}
          />
        ))}
      </List>
      <Button
        variant="light"
        leftSection={<IconPlus size={18} />}
        w="fit-content"
        onClick={() =>
          run(async () => {
            const e: Employee = { id: uid(), name: '', role: 'mechanic', monthlySalaryFils: 0, active: true };
            setEdit(e);
          })
        }
      >
        {t('settings.addEmployee')}
      </Button>
      <Modal opened={!!edit} onClose={() => setEdit(null)} title={t('settings.employee')}>
        {edit && (
          <Stack>
            <TextInput label={t('customer.name')} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.currentTarget.value })} data-autofocus />
            <Select label={t('settings.role')} value={edit.role} onChange={(r) => r && setEdit({ ...edit, role: r as Employee['role'] })} data={(['mechanic', 'electrician', 'other'] as const).map((r) => ({ value: r, label: t(`role.${r}`) }))} allowDeselect={false} />
            <MoneyInput label={t('salary.salary')} value={edit.monthlySalaryFils} onChange={(x) => setEdit({ ...edit, monthlySalaryFils: x ?? 0 })} />
            <Switch label={t('settings.active')} checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.currentTarget.checked })} />
            <Button disabled={!edit.name.trim()} onClick={() => run(async () => { await saveEmployee(edit); setEdit(null); }, 'common.saved')}>
              {t('common.save')}
            </Button>
          </Stack>
        )}
      </Modal>
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
  const total = v.items.reduce((s, i) => s + Math.round(i.qty * i.unitPriceFils), 0);
  return (
    <Modal opened onClose={onClose} title={t('settings.template')} size="xl">
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label={`${t('item.title')} · RU`} value={v.titleRu} onChange={(e) => setV({ ...v, titleRu: e.currentTarget.value })} />
          <TextInput label={`${t('item.title')} · EN`} value={v.titleEn} onChange={(e) => setV({ ...v, titleEn: e.currentTarget.value })} />
        </SimpleGrid>
        {v.items.map((it, i) => (
          <Box key={i} className="surface-soft" p="sm">
            <Group justify="space-between" mb="xs">
              <Text size="xs" fw={700} c="dimmed">
                #{i + 1}
              </Text>
              <ActionIcon color="red" variant="subtle" onClick={() => setV({ ...v, items: v.items.filter((_, j) => j !== i) })} aria-label={t('common.delete')}>
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
            <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="xs">
              <Select label={t('item.kind.label')} value={it.kind} onChange={(k) => k && setItem(i, { kind: k as TemplateItem['kind'] })} data={(['labor', 'part', 'fee'] as const).map((k) => ({ value: k, label: t(`item.kind.${k}`) }))} allowDeselect={false} />
              <TextInput label="RU" value={it.titleRu} onChange={(e) => setItem(i, { titleRu: e.currentTarget.value })} />
              <TextInput label="EN" value={it.titleEn} onChange={(e) => setItem(i, { titleEn: e.currentTarget.value })} />
              <NumberInput label={t('common.qty')} value={it.qty} decimalScale={2} onChange={(x) => setItem(i, { qty: Number(x) || 0 })} />
              <MoneyInput label={t('item.unitPrice')} value={it.unitPriceFils} onChange={(x) => setItem(i, { unitPriceFils: x ?? 0 })} />
            </SimpleGrid>
          </Box>
        ))}
        <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => setV({ ...v, items: [...v.items, { kind: 'labor', block: 'A', titleRu: '', titleEn: '', qty: 1, unit: 'pcs', unitPriceFils: 0 }] })}>
          {t('settings.addLine')}
        </Button>
        <Group justify="space-between">
          <Switch label={t('settings.active')} checked={v.active} onChange={(e) => setV({ ...v, active: e.currentTarget.checked })} />
          <Text size="sm" c="dimmed">
            {t('common.total')}: {formatAed(total)} · {t('common.withoutVat')}
          </Text>
        </Group>
        <Button loading={busy} onClick={() => run(async () => { await saveTemplate(v); onClose(); }, 'common.saved')}>
          {t('common.save')}
        </Button>
      </Stack>
    </Modal>
  );
}

function PricesTab() {
  const { t } = useTranslation();
  const lang = useLang();
  const { run } = useAction();
  const s = useSettings();
  const list = useLiveQuery(() => db.jobTemplates.toArray(), []);
  const [edit, setEdit] = useState<JobTemplate | null>(null);
  return (
    <Stack gap="md">
      <Box className="surface" p="md" style={{ borderLeft: `4px solid var(--mantine-color-${s?.pricesReviewed ? 'green' : 'yellow'}-5)` }}>
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <ThemeIcon variant="light" color={s?.pricesReviewed ? 'green' : 'yellow'} radius="xl" size={32} style={{ flexShrink: 0 }}>
            {s?.pricesReviewed ? <IconCheck size={17} stroke={2.6} /> : <IconAlertTriangle size={16} />}
          </ThemeIcon>
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Text size="sm" fw={600}>
              {s?.pricesReviewed ? t('settings.pricesDone') : t('settings.pricesHint')}
            </Text>
            <Text size="xs" c="dimmed" mt={2}>
              {t('settings.pricesNet')} {s?.pricesReviewed ? '' : t('settings.pricesDoneHint')}
            </Text>
            {!s?.pricesReviewed && (
              <Button mt="sm" size="compact-md" variant="light" color="green" leftSection={<IconCheck size={16} />} onClick={() => run(() => saveSettings({ pricesReviewed: true }), 'common.saved')}>
                {t('settings.pricesDone')}
              </Button>
            )}
          </Box>
        </Group>
      </Box>
      <Button w="fit-content" leftSection={<IconPlus size={18} />} onClick={() => setEdit({ id: uid(), code: `custom_${Date.now()}`, titleRu: '', titleEn: '', items: [], active: true })}>
        {t('settings.newTemplate')}
      </Button>
      <List>
        {list?.map((tpl) => (
          <ListRow
            key={tpl.id}
            onClick={() => setEdit(tpl)}
            chevron
            left={
              <ThemeIcon variant="light" color={tpl.active ? 'cobalt' : 'gray'} size={38} radius="md">
                <IconTemplate size={19} />
              </ThemeIcon>
            }
            title={lang === 'ru' ? tpl.titleRu : tpl.titleEn}
            subtitle={`${t('settings.lines', { n: tpl.items.length })}${tpl.active ? '' : ` · ${t('settings.inactive')}`}`}
            right={
              <Text size="sm" fw={600} className="tnum" style={{ whiteSpace: 'nowrap' }}>
                {formatAed(tpl.items.reduce((s, i) => s + Math.round(i.qty * i.unitPriceFils), 0))}
              </Text>
            }
          />
        ))}
      </List>
      <TemplateEditor tpl={edit} onClose={() => setEdit(null)} />
    </Stack>
  );
}

function CategoriesTab() {
  const { t } = useTranslation();
  const lang = useLang();
  const { run } = useAction();
  const list = useLiveQuery(() => db.expenseCategories.toArray(), []);
  const [edit, setEdit] = useState<ExpenseCategory | null>(null);
  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        {t('settings.limitHint')}
      </Text>
      <List>
        {list?.map((c) => (
          <ListRow
            key={c.id}
            onClick={() => setEdit(c)}
            chevron
            left={
              <ThemeIcon variant="light" color={c.active ? 'cobalt' : 'gray'} size={38} radius="md">
                <IconCategory size={19} />
              </ThemeIcon>
            }
            title={lang === 'ru' ? c.nameRu : c.nameEn}
            subtitle={c.monthlyLimitFils ? `${t('settings.monthlyLimit')}: ${formatAed(c.monthlyLimitFils)}` : t('settings.noLimit')}
          />
        ))}
      </List>
      <Button w="fit-content" variant="light" leftSection={<IconPlus size={18} />} onClick={() => setEdit({ id: uid(), code: `c_${Date.now()}`, nameRu: '', nameEn: '', monthlyLimitFils: 0, active: true })}>
        {t('common.add')}
      </Button>
      <Modal opened={!!edit} onClose={() => setEdit(null)} title={t('expense.category')}>
        {edit && (
          <Stack>
            <TextInput label="Русский" value={edit.nameRu} onChange={(e) => setEdit({ ...edit, nameRu: e.currentTarget.value })} />
            <TextInput label="English" value={edit.nameEn} onChange={(e) => setEdit({ ...edit, nameEn: e.currentTarget.value })} />
            <MoneyInput label={t('settings.monthlyLimit')} description={t('settings.zeroNoLimit')} value={edit.monthlyLimitFils} onChange={(x) => setEdit({ ...edit, monthlyLimitFils: x ?? 0 })} />
            <Switch label={t('settings.active')} checked={edit.active} disabled={edit.code === 'salaries' || edit.code === 'incidents'} onChange={(e) => setEdit({ ...edit, active: e.currentTarget.checked })} />
            <Button disabled={!edit.nameRu.trim() && !edit.nameEn.trim()} onClick={() => run(async () => { await saveCategory(edit); setEdit(null); }, 'common.saved')}>
              {t('common.save')}
            </Button>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

function DeviceCard() {
  const { t } = useTranslation();
  const lang = useLang();
  const info = useStorageInfo();
  const install = useInstall();
  const [persisted, setPersisted] = useState<boolean>();
  const isPersisted = persisted ?? info?.persisted;
  const rows: { ok: boolean | undefined; title: string; text: string; action?: ReactNode }[] = [
    {
      ok: install.standalone,
      title: install.standalone ? t('device.installed') : t('device.notInstalled'),
      text: install.standalone ? t('device.installedText') : install.iosManual ? t('device.iosHow') : t('device.installText'),
      action: install.canPrompt ? (
        <Button size="compact-md" leftSection={<IconDeviceMobile size={16} />} onClick={() => void install.install()}>
          {t('device.install')}
        </Button>
      ) : undefined,
    },
    {
      ok: isPersisted,
      title: isPersisted ? t('device.persisted') : t('device.notPersisted'),
      text: isPersisted ? t('device.persistedText') : t('device.notPersistedText'),
      action:
        isPersisted === false ? (
          <Button size="compact-md" variant="light" onClick={async () => setPersisted(await requestPersistence())}>
            {t('device.askPersist')}
          </Button>
        ) : undefined,
    },
    {
      ok: !insecureContext(),
      title: insecureContext() ? t('insecure.title') : t('device.offline'),
      text: insecureContext() ? t('insecure.text') : t('device.offlineText'),
    },
  ];
  return (
    <Card title={t('device.title')} description={info?.usageBytes !== undefined ? t('device.usage', { used: formatBytes(info.usageBytes, lang), free: formatBytes(info.quotaBytes !== undefined ? info.quotaBytes - info.usageBytes : undefined, lang) }) : undefined}>
      <Stack gap="sm">
        {rows.map((r) => (
          <Group key={r.title} gap="sm" wrap="nowrap" align="flex-start">
            <ThemeIcon size={28} radius="xl" variant="light" color={r.ok === undefined ? 'gray' : r.ok ? 'green' : 'orange'} mt={2}>
              {r.ok ? <IconCheck size={16} stroke={2.6} /> : <IconAlertTriangle size={15} />}
            </ThemeIcon>
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text size="sm" fw={600}>
                {r.title}
              </Text>
              <Text size="xs" c="dimmed" lh={1.4}>
                {r.text}
              </Text>
              {r.action && <Box mt={6}>{r.action}</Box>}
            </Box>
          </Group>
        ))}
      </Stack>
    </Card>
  );
}

function DataTab() {
  const { t } = useTranslation();
  const lang = useLang();
  const { run, busy } = useAction();
  const counts = useLiveQuery(async () => ({ orders: await db.orders.count(), customers: await db.customers.count(), media: await db.media.count() }), []);
  const backup = useBackupAge();
  const [wipe, setWipe] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  return (
    <Stack gap="md">
      {counts && (
        <SimpleGrid cols={3} spacing="sm">
          <Box className="kpi">
            <span className="eyebrow">{t('nav.customers')}</span>
            <span className="value">{counts.customers}</span>
          </Box>
          <Box className="kpi">
            <span className="eyebrow">{t('board.jobs')}</span>
            <span className="value">{counts.orders}</span>
          </Box>
          <Box className="kpi">
            <span className="eyebrow">{t('settings.files')}</span>
            <span className="value">{counts.media}</span>
          </Box>
        </SimpleGrid>
      )}
      <Card title={t('settings.backup')} description={t('settings.backupHint')}>
        <Group gap="sm" mb="md" wrap="nowrap" className="surface-soft" p="sm">
          <ThemeIcon size={36} radius="xl" variant="light" color={backup.due ? 'orange' : 'green'}>
            {backup.due ? <IconAlertTriangle size={18} /> : <IconCheck size={18} stroke={2.6} />}
          </ThemeIcon>
          <div>
            <Text size="sm" fw={600}>
              {backup.at ? t('settings.lastBackup', { date: formatDateTime(backup.at) }) : t('backupReminder.never')}
            </Text>
            <Text size="xs" c="dimmed">
              {t('settings.backupWhere')}
            </Text>
          </div>
        </Group>
        <Group gap="xs">
          <Button leftSection={<IconDownload size={18} />} loading={busy} onClick={() => run(() => saveBackupFile(`mygarage-backup-${dubaiDate()}.mygarage`), 'settings.backupDone')}>
            {t('settings.export')}
          </Button>
          <FileButton onChange={(f) => f && setRestoreFile(f)}>
            {(props) => (
              <Button variant="default" leftSection={<IconUpload size={18} />} {...props}>
                {t('settings.import')}
              </Button>
            )}
          </FileButton>
        </Group>
        <Text size="xs" c="dimmed" mt="xs">
          {t('settings.importWarning')}
        </Text>
      </Card>
      <EaglecartImportCard />
      <DeviceCard />
      {counts?.orders === 0 && (
        <Card title={t('settings.demo')} description={t('settings.demoHint')}>
          <Button variant="light" loading={busy} onClick={() => run(loadDemoData, 'settings.demoLoaded')}>
            {t('settings.loadDemo')}
          </Button>
        </Card>
      )}
      <Card title={t('settings.wipe')} description={t('settings.wipeHint')}>
        <Button color="red" variant="light" leftSection={<IconTrash size={18} />} onClick={() => setWipe(true)}>
          {t('settings.wipe')}
        </Button>
      </Card>
      <ConfirmModal
        opened={!!restoreFile}
        onClose={() => setRestoreFile(null)}
        title={t('settings.restoreTitle')}
        confirmLabel={t('settings.restore')}
        color="red"
        icon={<IconUpload size={18} />}
        onConfirm={() =>
          run(async () => {
            if (!restoreFile) return false;
            await importBackup(restoreFile);
            window.location.reload();
            return true;
          })
        }
      >
        <Box className="surface-soft" p="sm" mb="sm">
          <Text size="sm" fw={600} style={{ wordBreak: 'break-all' }}>
            {restoreFile?.name}
          </Text>
          <Text size="xs" c="dimmed">
            {restoreFile ? formatBytes(restoreFile.size, lang) : ''}
          </Text>
        </Box>
        <Text size="sm">{t('settings.restoreText')}</Text>
      </ConfirmModal>
      <Modal opened={wipe} onClose={() => setWipe(false)} title={t('settings.wipe')}>
        <Text size="sm" mb="sm">
          {t('settings.wipeConfirm')}
        </Text>
        <TextInput value={confirmText} onChange={(e) => setConfirmText(e.currentTarget.value)} placeholder="DELETE" autoCapitalize="characters" />
        <Button mt="md" color="red" fullWidth disabled={confirmText.trim().toUpperCase() !== 'DELETE'} onClick={() => run(async () => { await wipeAll(); window.location.reload(); })}>
          {t('common.delete')}
        </Button>
      </Modal>
    </Stack>
  );
}

const TABS: { key: string; icon: Icon }[] = [
  { key: 'business', icon: IconBuildingStore },
  { key: 'rules', icon: IconSettings },
  { key: 'texts', icon: IconFileText },
  { key: 'staff', icon: IconUsers },
  { key: 'prices', icon: IconList },
  { key: 'categories', icon: IconCategory },
  { key: 'data', icon: IconDatabase },
];

export function SettingsPage() {
  const { t } = useTranslation();
  const s = useSettings();
  const mobile = useMediaQuery('(max-width: 62em)', true, { getInitialValueInEffect: false });
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'business';
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const openTab = (v: string) => {
    if (v === tab) return;
    if (hasUnsaved()) setPendingTab(v);
    else setParams({ tab: v });
  };
  if (!s) return <PageSkeleton />;
  const content = (
    <div key={tab} className="fade-enter">
      {tab === 'business' && <BusinessTab s={s} />}
      {tab === 'rules' && <RulesTab s={s} />}
      {tab === 'texts' && <TextsTab s={s} />}
      {tab === 'staff' && <StaffTab />}
      {tab === 'prices' && <PricesTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'data' && <DataTab />}
      <ConfirmModal
        opened={!!pendingTab}
        onClose={() => setPendingTab(null)}
        title={t('settings.leaveTitle')}
        confirmLabel={t('settings.leave')}
        color="red"
        onConfirm={async () => {
          if (pendingTab) setParams({ tab: pendingTab });
          return true;
        }}
      >
        <Text size="sm">{t('settings.leaveText')}</Text>
      </ConfirmModal>
    </div>
  );
  return (
    <>
      <PageHeader title={t('nav.settings')} subtitle={t(`settings.tabHint.${tab}`)} />
      {mobile ? (
        <>
          <ScrollTabs value={tab} onChange={openTab} items={TABS.map((x) => ({ value: x.key, label: t(`settings.tab.${x.key}`) }))} />
          {content}
        </>
      ) : (
        <Grid gutter="xl">
          <Grid.Col span={3}>
            <Box className="surface" p={6} style={{ position: 'sticky', top: 'calc(var(--app-nav-h) + env(safe-area-inset-top, 0px) + 16px)' }}>
              {TABS.map((x) => (
                <NavLink key={x.key} component="button" active={tab === x.key} label={t(`settings.tab.${x.key}`)} leftSection={<x.icon size={18} />} onClick={() => openTab(x.key)} style={{ borderRadius: 10 }} />
              ))}
            </Box>
          </Grid.Col>
          <Grid.Col span={9}>{content}</Grid.Col>
        </Grid>
      )}
    </>
  );
}
