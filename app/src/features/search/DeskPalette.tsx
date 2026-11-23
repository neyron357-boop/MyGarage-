import { Modal, TextInput, UnstyledButton } from '@mantine/core';
import {
  IconArrowDownLeft,
  IconArrowUpRight,
  IconCash,
  IconChartBar,
  IconChevronRight,
  IconNote,
  IconPackage,
  IconPlus,
  IconSearch,
  IconSettings,
  IconTruck,
  IconUsers,
  type Icon,
} from '@tabler/icons-react';
import { useDeferredValue, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { formatPhone } from '../../domain/phone';
import type { Order } from '../../domain/types';
import { search, type SearchHit } from '../../services/customers';
import { PersonAvatar, PlateText } from '../../ui/components';
import { CarThumb } from '../job/CarCover';
import { useQuickActions } from '../quick/QuickActions';

type Row = { key: string; left: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode; run: () => void };

/** The cars and customers found, and the job each car is in now (the one a manager means when he types a plate). */
async function findAll(q: string): Promise<{ hits: SearchHit[]; open: Map<string, Order> }> {
  const hits = await search(q, 8);
  const ids = hits.map((h) => h.vehicle?.id).filter((x): x is string => !!x);
  const open = new Map<string, Order>();
  if (ids.length) {
    const orders = await db.orders.where('vehicleId').anyOf(ids).toArray();
    for (const o of orders.filter((o) => o.stage !== 'closed' && o.stage !== 'cancelled').sort((a, b) => a.createdAt.localeCompare(b.createdAt))) open.set(o.vehicleId, o);
  }
  return { hits, open };
}

/**
 * Search from anywhere on a PC (v0.42): Ctrl+K or «/» (or a click on the sidebar's field). One field at the top of the
 * window — a plate, a name, a phone, a VIN; under it the cars and customers found (a car in the garage now opens its
 * job) and what can be done (a new job, money in, money out, the cash…). ↑ ↓ to pick, Enter to open, Esc to close;
 * Enter on the last row looks everywhere (the search screen: jobs by their work too).
 */
export function DeskPalette({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const quick = useQuickActions();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [found, setFound] = useState<{ q: string; hits: SearchHit[]; open: Map<string, Order> }>({ q: '', hits: [], open: new Map() });
  const deferred = useDeferredValue(q.trim());
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!opened) {
      setQ('');
      setSel(0);
    }
  }, [opened]);
  useEffect(() => {
    let alive = true;
    if (!deferred) setFound({ q: '', hits: [], open: new Map() });
    else void findAll(deferred).then((r) => alive && setFound({ q: deferred, ...r }));
    return () => {
      alive = false;
    };
  }, [deferred]);

  const go = (to: string) => () => navigate(to);
  const action = (key: string, icon: Icon, color: string, title: string, run: () => void): Row => ({
    key,
    left: (
      <span className="row-icon" style={{ background: `var(--mantine-color-${color}-6)` } as CSSProperties} aria-hidden>
        {(() => {
          const I = icon;
          return <I size={16} stroke={2.1} />;
        })()}
      </span>
    ),
    title,
    run,
  });
  const actions: Row[] = [
    action('new', IconPlus, 'cobalt', t('nav.newOrder'), go('/orders/new')),
    action('in', IconArrowDownLeft, 'green', t('quick.in'), () => quick.run('in')),
    action('out', IconArrowUpRight, 'red', t('quick.out'), () => quick.run('out')),
    action('cash', IconCash, 'teal', t('nav.cash'), go('/money?tab=cash')),
    action('money', IconCash, 'green', t('nav.money'), go('/money')),
    action('reports', IconChartBar, 'indigo', t('nav.reports'), go('/reports')),
    action('customers', IconUsers, 'cyan', t('nav.customers'), go('/customers')),
    action('parts', IconPackage, 'orange', t('nav.parts'), go('/parts')),
    action('suppliers', IconTruck, 'grape', t('nav.suppliers'), go('/parts?tab=suppliers')),
    action('note', IconNote, 'yellow', t('quick.note'), () => quick.run('note')),
    action('settings', IconSettings, 'gray', t('nav.settings'), go('/settings')),
  ];
  const typed = q.trim().toLowerCase();
  const shownActions = typed ? actions.filter((a) => String(a.title).toLowerCase().includes(typed)) : actions;
  const current = found.q === deferred ? found : { hits: [], open: new Map<string, Order>() };
  const people: Row[] = current.hits.map((h) => {
    const c = h.customer;
    const who = (c.type === 'company' && c.companyName ? c.companyName : c.name) || (c.phone ? formatPhone(c.phone) : t('customer.noName'));
    if (!h.vehicle)
      return {
        key: `c-${c.id}`,
        left: <PersonAvatar name={who} company={c.type === 'company'} size={32} />,
        title: who,
        sub: c.name && c.phone ? formatPhone(c.phone) : undefined,
        run: go(`/customers/${c.id}`),
      };
    const v = h.vehicle;
    const open = current.open.get(v.id);
    return {
      key: `v-${v.id}`,
      left: <CarThumb vehicleId={v.id} size={32} />,
      title: (
        <span className="desk-pal-car">
          <PlateText plate={v.plate} size="xs" />
          <span>{[v.make, v.model, v.year].filter(Boolean).join(' ') || t('newOrder.noMake')}</span>
        </span>
      ),
      sub: [who, c.name && c.phone ? formatPhone(c.phone) : ''].filter(Boolean).join(' · '),
      right: open ? <span className="desk-pal-job">№{open.number}</span> : undefined,
      run: go(open ? `/orders/${open.id}` : `/vehicles/${v.id}`),
    };
  });
  const everywhere: Row[] = typed
    ? [
        {
          key: 'everywhere',
          left: (
            <span className="row-icon" style={{ background: 'var(--app-label-2)' }} aria-hidden>
              <IconSearch size={16} stroke={2.1} />
            </span>
          ),
          title: t('desk.palette.everywhere', { q: q.trim() }),
          run: go(`/search?q=${encodeURIComponent(q.trim())}`),
        },
      ]
    : [];
  const groups: { key: string; title: string; rows: Row[] }[] = [
    { key: 'found', title: t('desk.palette.found'), rows: people },
    { key: 'actions', title: t('desk.palette.actions'), rows: shownActions },
    { key: 'more', title: '', rows: everywhere },
  ].filter((g) => g.rows.length);
  const rows = groups.flatMap((g) => g.rows);
  const at = Math.min(sel, Math.max(0, rows.length - 1));
  // The picked row stays in sight as the arrows move it.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[data-selected]')?.scrollIntoView({ block: 'nearest' });
  }, [at]);
  const pick = (r: Row | undefined) => {
    if (!r) return;
    onClose();
    r.run();
  };
  let n = -1;
  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        withCloseButton={false}
        centered={false}
        yOffset="10vh"
        size={640}
        padding={0}
        classNames={{ content: 'desk-pal' }}
        aria-label={t('nav.search')}
        // Opened by a key a hundred times a day: there at once, the field ready — no travel to wait for.
        transitionProps={{ duration: 0 }}
      >
        <TextInput
          data-autofocus
          className="desk-pal-field"
          variant="unstyled"
          leftSection={<IconSearch size={19} stroke={2} />}
          placeholder={t('desk.palette.placeholder')}
          aria-label={t('search.placeholder')}
          value={q}
          onChange={(e) => {
            setQ(e.currentTarget.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const d = e.key === 'ArrowDown' ? 1 : -1;
              setSel((s) => (rows.length ? (Math.min(s, rows.length - 1) + d + rows.length) % rows.length : 0));
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              pick(rows[at]);
            }
          }}
        />
        <div className="desk-pal-list" ref={list} role="listbox" aria-label={t('nav.search')}>
          {groups.map((g) => (
            <div key={g.key} className="desk-pal-group">
              {g.title && <div className="desk-pal-head">{g.title}</div>}
              {g.rows.map((r) => {
                n += 1;
                const i = n;
                return (
                  <UnstyledButton
                    key={r.key}
                    className="desk-pal-row"
                    role="option"
                    aria-selected={i === at}
                    data-selected={i === at || undefined}
                    onMouseMove={() => i !== at && setSel(i)}
                    onClick={() => pick(r)}
                  >
                    <span className="desk-pal-left">{r.left}</span>
                    <span className="desk-pal-body">
                      <span className="desk-pal-title">{r.title}</span>
                      {r.sub && <span className="desk-pal-sub">{r.sub}</span>}
                    </span>
                    {r.right}
                    {i === at && <IconChevronRight className="desk-pal-go" size={16} stroke={2.2} aria-hidden />}
                  </UnstyledButton>
                );
              })}
            </div>
          ))}
        </div>
      </Modal>
      {quick.nodes}
    </>
  );
}
