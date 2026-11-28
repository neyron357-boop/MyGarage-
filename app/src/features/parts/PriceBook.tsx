import { Modal, Stack, Text } from '@mantine/core';
import { IconTags } from '@tabler/icons-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { dayShort } from '../../domain/dates';
import type { PriceGroup } from '../../domain/priceBook';
import type { PricePoint, Supplier } from '../../domain/types';
import { loadPriceBook } from '../../services/priceBook';
import { useCalmQuery } from '../../ui/calmQuery';
import { EmptyState, List, ListRow, Money, SearchField } from '../../ui/components';
import { useMoreRows } from '../../ui/moreRows';
import { AiMark } from '../ai/Ai';

/*
 * «Цены» (v0.91.7, the owner: «автосбор цен и автоформирование прайс-листов исходя из ответов поставщиков… записывать цены
 * каждой детали с маркой и моделью авто и с VIN»): every price the suppliers said (services/priceBook.ts), part by part — the
 * lowest, how many, for which makes; a part tapped — every price: who, how much, original / copy / used, its brand, the car
 * (and its VIN), when; one tapped — its job. A search by the part, a make, a model, a VIN, a brand; a make's chip.
 */

const KIND_WORD: Record<PricePoint['kind'], string> = { oem: 'priceBook.oem', aftermarket: 'priceBook.copy', used: 'priceBook.used' };

export function PriceBookTab() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [make, setMake] = useState<string | undefined>();
  const book = useCalmQuery(['priceBook', 'suppliers'], () => loadPriceBook({ query, make }), [query, make]);
  const [open, setOpen] = useState<PriceGroup | null>(null);
  const groups = book?.groups ?? [];
  const { limit, more } = useMoreRows(groups.length, `${query}|${make}`);
  if (book && !book.total)
    return (
      <EmptyState icon={IconTags} title={t('priceBook.empty')}>
        {t('priceBook.emptyHint')}
      </EmptyState>
    );
  return (
    <Stack gap="sm" data-price-book>
      <SearchField value={query} onChange={setQuery} placeholder={t('priceBook.search')} />
      {!!book?.makes.length && (
        <div className="chip-row">
          <button type="button" className="chip" data-active={!make} onClick={() => setMake(undefined)}>
            {t('priceBook.allMakes')}
          </button>
          {book.makes.slice(0, 20).map((m) => (
            <button key={m.make} type="button" className="chip" data-active={make === m.make} onClick={() => setMake(make === m.make ? undefined : m.make)} data-price-make={m.make}>
              {m.make}
              <span className="chip-note tnum">{m.n}</span>
            </button>
          ))}
        </div>
      )}
      {book && !groups.length ? (
        <Text c="dimmed" ta="center" py="md">
          {t('priceBook.none')}
        </Text>
      ) : (
        <List>
          {groups.slice(0, limit).map((g) => (
            <GroupRow key={g.part} g={g} suppliers={book!.suppliers} onOpen={setOpen} />
          ))}
          {more()}
        </List>
      )}
      <PricesSheet g={open} suppliers={book?.suppliers} onClose={() => setOpen(null)} />
    </Stack>
  );
}

const GroupRow = memo(function GroupRow({ g, suppliers, onOpen }: { g: PriceGroup; suppliers: Map<string, Supplier>; onOpen: (g: PriceGroup) => void }) {
  const { t } = useTranslation();
  const best = g.best;
  return (
    <ListRow
      onClick={() => onOpen(g)}
      title={<span data-price-part={g.part}>{g.part}</span>}
      subtitle={[g.makes.slice(0, 3).join(', '), t('priceBook.prices', { count: g.points.length }), best ? suppliers.get(best.supplierId ?? '')?.name : ''].filter(Boolean).join(' · ')}
      right={
        best ? (
          <span className="price-book-best">
            <span className="price-book-from">{t('priceBook.from')}</span>
            <Money fils={best.costFils!} />
          </span>
        ) : (
          <Text size="sm" c="dimmed">
            {t('priceBook.na')}
          </Text>
        )
      }
      chevron
    />
  );
});

/** One part's prices: the newest first — who, how much, the kind, its brand, the car, when; a tap — its job. */
function PricesSheet({ g, suppliers, onClose }: { g: PriceGroup | null; suppliers?: Map<string, Supplier>; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const last = useMemo(() => g, [g]);
  const dayWord = (iso: string) => {
    const d = dayShort(iso);
    return d.word ? t(`common.${d.word}`) : d.text;
  };
  return (
    <Modal opened={!!g} onClose={onClose} title={last?.part ?? ''} classNames={{ content: 'sheet-grouped' }}>
      {last && (
        <List>
          {last.points.map((p) => (
            <ListRow
              key={p.id}
              onClick={() => {
                onClose();
                // a paper invoice's price (v1.05) — its paper; a job's — its job
                navigate(p.paper ? `/money/papers?open=${p.paper}` : `/orders/${p.orderId}`);
              }}
              title={
                <span className="price-book-who">
                  {suppliers?.get(p.supplierId ?? '')?.name ?? t('priceBook.someone')}
                  {p.ai && <AiMark size={12} label={t('ai.offerByAi')} />}
                </span>
              }
              subtitle={[t(KIND_WORD[p.kind]) + (p.unsure ? '?' : ''), p.via === 'paper' ? [p.name, t('papers.paperWord'), p.invoiceNo ? `№${p.invoiceNo}` : ''].filter(Boolean).join(' ') : '', p.brand, [p.make, p.model, p.year].filter(Boolean).join(' '), p.vin ? `VIN …${p.vin.slice(-6)}` : '', dayWord(p.at)].filter(Boolean).join(' · ')}
              right={p.na || p.costFils === undefined ? <Text size="sm" c="dimmed">{t('priceBook.na')}</Text> : <Money fils={p.costFils} />}
            />
          ))}
        </List>
      )}
    </Modal>
  );
}
