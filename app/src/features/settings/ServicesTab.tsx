import { ActionIcon, Button, Group, Modal, Select, Stack, TagsInput, Text, TextInput } from '@mantine/core';
import { IconAlertTriangle, IconPencil, IconPlus, IconSearch } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { descKey, lineServices, type Catalog } from '../../domain/serviceCatalog';
import type { Service, ServiceCategory } from '../../domain/types';
import {
  addCategory,
  addService,
  assignDescription,
  descriptionUses,
  loadCatalog,
  removeCategory,
  removeService,
  restoreCategory,
  restoreService,
  saveCategory,
  saveService,
  type DescriptionUse,
} from '../../services/catalog';
import { List, ListRow, PageSkeleton, Section, undoToast } from '../../ui/components';
import { useAction, useScreenLiveQuery } from '../../ui/hooks';
import { SheetFor } from '../../ui/lazy';

/*
 * Settings → Services (v0.46): the catalogue of standard services that a customer's report sorts the lines into — by
 * category, each service with its keywords (a line holding one is that service) and how many lines are it. Lines no
 * service fits wait on top in «Проверить»: a tap gives one its service (by hand — over every rule). Services and
 * categories are added, renamed, moved and taken out (with «Отменить»); the invoices never change.
 */

interface Data {
  catalog: Catalog;
  uses: DescriptionUse[];
}

export function ServicesTab() {
  const { t } = useTranslation();
  const data = useScreenLiveQuery<Data>(async () => ({ catalog: await loadCatalog(), uses: await descriptionUses() }), []);
  const [editing, setEditing] = useState<Service | null>(null);
  const [picking, setPicking] = useState<DescriptionUse | null>(null);
  const [category, setCategory] = useState<ServiceCategory | null>(null);
  const [adding, setAdding] = useState<{ categoryId?: string } | null>(null);
  if (!data) return <PageSkeleton />;
  const { catalog, uses } = data;
  const of = lineServices(catalog);
  const queue: DescriptionUse[] = [];
  const byService = new Map<string, DescriptionUse[]>();
  for (const u of uses) {
    const s = of(u.description).service;
    if (!s) queue.push(u);
    else byService.set(s.id, [...(byService.get(s.id) ?? []), u]);
  }
  const lines = (id: string) => (byService.get(id) ?? []).reduce((a, u) => a + u.lines, 0);
  const categories = catalog.categories.filter((c) => !c.archivedAt);
  return (
    <Stack gap={0}>
      {queue.length > 0 && (
        <Section
          mt={0}
          title={
            <Group gap={8} wrap="nowrap">
              <IconAlertTriangle size={20} color="var(--mantine-color-orange-6)" />
              {t('services.check')}
              <span className="count">{queue.length}</span>
            </Group>
          }
        >
          <List>
            {queue.map((u) => (
              <ListRow key={u.key} title={u.description} right={<Text c="dimmed">{u.lines}</Text>} chevron onClick={() => setPicking(u)} />
            ))}
          </List>
        </Section>
      )}
      {categories.map((c, i) => {
        const list = catalog.services.filter((s) => s.categoryId === c.id && !s.archivedAt);
        return (
          <Section
            key={c.id}
            mt={i === 0 && !queue.length ? 0 : 'xl'}
            title={c.name}
            action={
              <ActionIcon variant="subtle" color="gray" size={34} aria-label={t('common.edit')} onClick={() => setCategory(c)}>
                <IconPencil size={18} />
              </ActionIcon>
            }
          >
            <List>
              {list.map((s) => (
                <ListRow key={s.id} title={s.name} subtitle={s.keywords.join(' · ')} right={<Text c="dimmed">{lines(s.id) || ''}</Text>} chevron onClick={() => setEditing(s)} />
              ))}
              <ListRow left={<IconPlus size={20} />} title={t('services.add')} onClick={() => setAdding({ categoryId: c.id })} />
            </List>
          </Section>
        );
      })}
      <Group mt="xl">
        <Button variant="light" leftSection={<IconPlus size={18} />} onClick={() => setAdding({})}>
          {t('services.addCategory')}
        </Button>
      </Group>
      <SheetFor value={picking}>
        {(u, o) => <PickSheet use={u} catalog={catalog} opened={o} onClose={() => setPicking(null)} />}
      </SheetFor>
      <SheetFor value={editing}>
        {(s, o) => (
          <ServiceSheet
            service={s}
            catalog={catalog}
            uses={byService.get(s.id) ?? []}
            opened={o}
            onClose={() => setEditing(null)}
            onPick={(u) => {
              setEditing(null);
              setPicking(u);
            }}
          />
        )}
      </SheetFor>
      <SheetFor value={category}>{(c, o) => <CategorySheet category={c} empty={!catalog.services.some((s) => s.categoryId === c.id && !s.archivedAt)} opened={o} onClose={() => setCategory(null)} />}</SheetFor>
      <SheetFor value={adding}>{(a, o) => <AddSheet categoryId={a.categoryId} opened={o} onClose={() => setAdding(null)} onAdded={(s) => s && setEditing(s)} />}</SheetFor>
    </Stack>
  );
}

/** A description given its service: the catalogue's, found by name; or a new one of that name. */
function PickSheet({ use, catalog, opened, onClose }: { use: DescriptionUse; catalog: Catalog; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const [q, setQ] = useState('');
  const hand = catalog.map.find((e) => e.id === use.key);
  const now = lineServices(catalog)(use.description).service;
  const cats = new Map(catalog.categories.map((c) => [c.id, c.name]));
  const key = descKey(q);
  const found = catalog.services.filter((s) => !s.archivedAt && (!key || descKey(`${s.name} ${cats.get(s.categoryId) ?? ''}`).includes(key)));
  const pick = (serviceId: string | null) =>
    run(async () => {
      await assignDescription(use.description, serviceId);
      onClose();
    });
  const fresh = q.trim() && !catalog.services.some((s) => !s.archivedAt && s.name.toLowerCase() === q.trim().toLowerCase());
  return (
    <Modal opened={opened} onClose={onClose} title={use.description}>
      <Stack gap="sm">
        <TextInput leftSection={<IconSearch size={18} />} placeholder={t('services.find')} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        <List>
          {fresh && (
            <ListRow
              left={<IconPlus size={20} />}
              title={t('services.addNamed', { name: q.trim() })}
              onClick={() =>
                run(async () => {
                  const s = await addService(q, catalog.categories.find((c) => c.id === 'cat-other' && !c.archivedAt)?.id ?? catalog.categories.find((c) => !c.archivedAt)?.id ?? 'cat-other');
                  await assignDescription(use.description, s.id);
                  onClose();
                })
              }
            />
          )}
          {hand && <ListRow title={t('services.byRules')} onClick={() => void pick(null)} />}
          {found.map((s) => (
            <ListRow key={s.id} title={s.name} subtitle={cats.get(s.categoryId)} selected={now?.id === s.id} onClick={() => void pick(s.id)} />
          ))}
        </List>
      </Stack>
    </Modal>
  );
}

function ServiceSheet({ service, catalog, uses, opened, onClose, onPick }: { service: Service; catalog: Catalog; uses: DescriptionUse[]; opened: boolean; onClose: () => void; onPick: (u: DescriptionUse) => void }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const [v, setV] = useState(service);
  const hand = new Set(catalog.map.filter((e) => e.serviceId === service.id).map((e) => e.id));
  return (
    <Modal opened={opened} onClose={onClose} title={service.name}>
      <Stack gap="sm">
        <TextInput label={t('services.name')} value={v.name} onChange={(e) => setV({ ...v, name: e.currentTarget.value })} />
        <Select
          label={t('services.category')}
          value={v.categoryId}
          allowDeselect={false}
          data={catalog.categories.filter((c) => !c.archivedAt || c.id === v.categoryId).map((c) => ({ value: c.id, label: c.name }))}
          onChange={(id) => id && setV({ ...v, categoryId: id })}
        />
        <TagsInput label={t('services.keywords')} value={v.keywords} splitChars={[',', ';']} onChange={(k) => setV({ ...v, keywords: k.map((x) => x.toUpperCase()) })} />
        {uses.length > 0 && (
          <List>
            {uses.map((u) => (
              <ListRow key={u.key} title={u.description} subtitle={hand.has(u.key) ? t('services.byHand') : undefined} right={<Text c="dimmed">{u.lines}</Text>} chevron onClick={() => onPick(u)} />
            ))}
          </List>
        )}
        <Button
          size="md"
          onClick={() =>
            run(async () => {
              await saveService(v);
              onClose();
            }, 'common.saved')
          }
        >
          {t('common.save')}
        </Button>
        <Button
          variant="subtle"
          color="red"
          onClick={() =>
            run(async () => {
              const was = await removeService(service.id);
              onClose();
              undoToast(t('services.removed', { name: was.name }), t('common.undo'), () => void restoreService(was));
            })
          }
        >
          {t('common.delete')}
        </Button>
      </Stack>
    </Modal>
  );
}

function CategorySheet({ category, empty, opened, onClose }: { category: ServiceCategory; empty: boolean; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const [name, setName] = useState(category.name);
  return (
    <Modal opened={opened} onClose={onClose} title={category.name}>
      <Stack gap="sm">
        <TextInput label={t('services.name')} value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <Button
          size="md"
          onClick={() =>
            run(async () => {
              await saveCategory({ ...category, name });
              onClose();
            }, 'common.saved')
          }
        >
          {t('common.save')}
        </Button>
        {empty && (
          <Button
            variant="subtle"
            color="red"
            onClick={() =>
              run(async () => {
                const was = await removeCategory(category.id);
                onClose();
                undoToast(t('services.removed', { name: was.name }), t('common.undo'), () => void restoreCategory(was));
              })
            }
          >
            {t('common.delete')}
          </Button>
        )}
      </Stack>
    </Modal>
  );
}

/** A new service in its category, or a new category (no `categoryId`). */
function AddSheet({ categoryId, opened, onClose, onAdded }: { categoryId?: string; opened: boolean; onClose: () => void; onAdded: (s?: Service) => void }) {
  const { t } = useTranslation();
  const { run } = useAction();
  const [name, setName] = useState('');
  const add = () =>
    run(async () => {
      if (categoryId) {
        const s = await addService(name, categoryId);
        onClose();
        onAdded(s);
      } else {
        await addCategory(name);
        onClose();
        onAdded();
      }
    });
  return (
    <Modal opened={opened} onClose={onClose} title={t(categoryId ? 'services.add' : 'services.addCategory')}>
      <Stack gap="sm">
        <TextInput
          label={t('services.name')}
          value={name}
          data-autofocus
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
        <Button size="md" disabled={!name.trim()} onClick={() => void add()}>
          {t('common.add')}
        </Button>
      </Stack>
    </Modal>
  );
}
