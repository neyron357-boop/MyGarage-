import { ActionIcon, Button, Group } from '@mantine/core';
import { IconBrandWhatsapp, IconPhone, IconSend, IconStarFilled, IconTruck } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { supplierChatLink } from '../../domain/supplierBook';
import { starsOf, type Ranked, type Why } from '../../domain/supplierRank';
import type { Supplier } from '../../domain/types';
import { partsRequestText, whatsappUrl } from '../../services/messages';
import { suppliersForJob } from '../../services/supplierRank';
import { copyText } from '../../ui/clipboard';
import { EmptyState, List, ListRow, PageHeader, PageSkeleton, PersonAvatar } from '../../ui/components';
import { haptic } from '../../ui/haptics';
import { useLang, useScreenLiveQuery } from '../../ui/hooks';
import { SheetFor } from '../../ui/lazy';
import { SupplierSheet } from '../parts/Suppliers';

/** The manager's stars of a supplier, small: "★ 4" (not rated — nothing). */
export function StarsPill({ s }: { s: Pick<Supplier, 'reliability'> }) {
  const n = starsOf(s);
  if (!n) return null;
  return (
    <span className="stars-pill tnum" aria-label={`★ ${n}`}>
      <IconStarFilled size={12} aria-hidden />
      {n}
    </span>
  );
}

/** Why it fits, in a few words: "На этом заказе · Toyota ×5 · Продавал: TIE ROD END · 12 заказов". */
function useWhy() {
  const { t } = useTranslation();
  return (r: Ranked) =>
    [
      ...r.why.map((w: Why) => {
        switch (w.kind) {
          case 'onJob':
            return t('suppliers.why.onJob');
          case 'boughtFor':
            return t('suppliers.why.boughtFor', { make: w.make, n: w.jobs });
          case 'sold':
            return w.times > 1 ? t('suppliers.why.soldN', { part: w.part, n: w.times }) : t('suppliers.why.sold', { part: w.part });
          case 'make':
            return w.make;
          case 'sells':
            return t('suppliers.why.sells', { part: w.part });
        }
      }),
      r.use.jobs ? t('suppliers.jobs', { count: r.use.jobs }) : '',
    ]
      .filter(Boolean)
      .join(' · ');
}

/**
 * The suppliers for a job (v0.38, the user's ask — its own screen, from the chip «Поставщики» under the job): the best
 * fit first — already on its lines, bought from for this make, sold such a part before, the make or the part declared,
 * the manager's stars, how often and how lately. WhatsApp asks one of them about all the job's parts at once (the car,
 * its VIN, the parts); a tap opens the supplier's card (its stars). Contractors — when the job has work done outside.
 */
export function JobSuppliersPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const lang = useLang();
  const navigate = useNavigate();
  const data = useScreenLiveQuery(() => suppliersForJob(id, lang), [id, lang]);
  const why = useWhy();
  const [card, setCard] = useState<Supplier | null>(null);
  if (data === undefined) return <PageSkeleton />;
  if (data === null) return <EmptyState title={t('err.notFound')} />;
  const v = data.vehicle;
  // What is still to buy (all the parts, once every one is ordered).
  const needed = data.partLines.filter((i) => !i.procurementStatus || i.procurementStatus === 'needed');
  const ask = v && data.partLines.length ? partsRequestText(v, needed.length ? needed : data.partLines) : '';
  const share = async () => {
    haptic('light');
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: ask });
        return;
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
      }
    }
    if (await copyText(ask)) haptic('selection');
  };
  const rows = (list: Ranked[]) => (
    <List>
      {list.map((r) => {
        const s = r.supplier;
        const chat = supplierChatLink(s) ?? (s.phone ? whatsappUrl(s.phone, ask) : undefined);
        return (
          <ListRow
            key={s.id}
            onClick={() => setCard(s)}
            left={<PersonAvatar name={s.name} company size={36} />}
            title={
              <span className="supplier-name">
                <span className="supplier-name-text">{s.name}</span>
                <StarsPill s={s} />
              </span>
            }
            subtitle={why(r) || undefined}
            right={
              <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                {chat && (
                  <ActionIcon component="a" href={chat} target="_blank" rel="noopener" variant="light" color="green" size={36} radius="xl" aria-label="WhatsApp" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                    <IconBrandWhatsapp size={19} />
                  </ActionIcon>
                )}
                {s.phone && (
                  <ActionIcon component="a" href={`tel:${s.phone}`} variant="light" color="green" size={36} radius="xl" aria-label={t('customer.call')} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                    <IconPhone size={18} />
                  </ActionIcon>
                )}
              </Group>
            }
          />
        );
      })}
    </List>
  );
  return (
    <>
      <PageHeader
        back
        eyebrow={v ? [v.make, v.model].filter(Boolean).join(' ') : undefined}
        title={t('suppliers.forJob')}
        right={
          ask ? (
            <Button variant="light" leftSection={<IconSend size={18} />} onClick={() => void share()}>
              {t('suppliers.askAll')}
            </Button>
          ) : undefined
        }
      />
      <div className="job-suppliers">
        {data.parts.length ? (
          <>
            {data.contractors.length > 0 && <div className="group-title">{t('suppliers.partsSellers')}</div>}
            {rows(data.parts)}
          </>
        ) : (
          <EmptyState icon={IconTruck} title={t('parts.noSuppliers')} action={<Button onClick={() => navigate('/parts?tab=suppliers')}>{t('suppliers.all')}</Button>} />
        )}
        {data.contractors.length > 0 && (
          <>
            <div className="group-title">{t('suppliers.contractors')}</div>
            {rows(data.contractors)}
          </>
        )}
      </div>
      <SheetFor value={card}>{(s, o) => <SupplierSheet opened={o} supplier={s} onClose={() => setCard(null)} onExisting={setCard} />}</SheetFor>
    </>
  );
}
