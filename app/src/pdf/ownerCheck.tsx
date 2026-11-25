import { Document, Image, Page, Text, View } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import { formatAed } from '../domain/money';
import type { OwnerCheck, OwnerLine } from '../domain/ownerCheck';
import { renderDoc } from './documents';
import { COLOR } from './garage';

/*
 * The job for the owner to check, as a PDF (v0.82, domain/ownerCheck.ts). v0.88 (the owner: «PDF очень сильно загружен
 * информацией; важно, какой поставщик, какие цены он дал и за сколько гараж продаёт; сохранить лого поставщиков и
 * помещать всё в одной странице»): one page, one table — each line, its supplier with the supplier's WhatsApp picture,
 * the supplier's price, what the garage sells it for and the difference, all with VAT (as the garage's books count);
 * then what the customer pays, what went out and the profit, and the VAT in one line. Words in the owner's language.
 */

export interface OwnerCheckWords {
  title: string;
  parts: string;
  work: string;
  extra: string;
  item: string;
  supplier: string;
  buy: string;
  sell: string;
  margin: string;
  noCost: string;
  noPrice: string;
  own: string;
  outside: string;
  noSupplier: string;
  garageWork: string;
  off: string;
  discount: string;
  toClient: string;
  spent: string;
  profit: string;
  vatLine: string;
  warnUnpriced: string;
  warnNoCost: string;
  customer: string;
  footer: string;
}

export interface OwnerCheckView {
  garage: string;
  logo?: string;
  photo?: string;
  number: string;
  date: string;
  car: string;
  plate: string;
  customer: string;
  check: OwnerCheck;
  sellers: Map<string, { name: string; phone?: string; picture?: string }>;
  words: OwnerCheckWords;
}

const n = (f: number) => formatAed(f, 'en', false);
const GREEN = '#1a7f37';
const RED = '#c62828';
const ORANGE = '#b45309';
const DIM = '#6b7280';
// Read on a phone (sent in WhatsApp): a size larger than the invoices' — one page has room for a job's lines.
const W = { supplier: 158, buy: 74, sell: 74, margin: 68 };

function Cell({ w, right, bold, color, size = 10, children }: { w?: number; right?: boolean; bold?: boolean; color?: string; size?: number; children: ReactNode }) {
  return <Text style={{ ...(w ? { width: w } : { flex: 1 }), fontSize: size, textAlign: right ? 'right' : 'left', fontWeight: bold ? 'bold' : 'normal', color: color ?? COLOR.ink, paddingHorizontal: 3 }}>{children}</Text>;
}

const initials = (name: string) =>
  name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase())
    .join('');

/** A supplier's picture (its WhatsApp one), else its initials — a small circle beside its name. */
function Face({ name, picture, size = 17 }: { name: string; picture?: string; size?: number }) {
  return picture ? (
    <Image src={picture} style={{ width: size, height: size, borderRadius: size / 2, objectFit: 'cover', marginRight: 4 }} />
  ) : (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#e0e7ff', alignItems: 'center', justifyContent: 'center', marginRight: 4 }}>
      <Text style={{ fontSize: size * 0.42, fontWeight: 'bold', color: '#3730a3' }}>{initials(name) || '?'}</Text>
    </View>
  );
}

function Head({ w }: { w: OwnerCheckWords }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: COLOR.bar, paddingVertical: 5, marginTop: 12 }} fixed>
      <Cell bold size={9}>
        {w.item}
      </Cell>
      <Cell w={W.supplier} bold size={9}>
        {w.supplier}
      </Cell>
      <Cell w={W.buy} right bold size={9}>
        {w.buy}
      </Cell>
      <Cell w={W.sell} right bold size={9}>
        {w.sell}
      </Cell>
      <Cell w={W.margin} right bold size={9}>
        {w.margin}
      </Cell>
    </View>
  );
}

/** A group's name, a thin row in the table (parts; work and services; other costs). */
function Group({ title }: { title: string }) {
  return (
    <View style={{ paddingTop: 7, paddingBottom: 2, borderBottomWidth: 0.6, borderColor: COLOR.boxRule }}>
      <Text style={{ fontSize: 8.5, fontWeight: 'bold', color: COLOR.head }}>{title.toUpperCase()}</Text>
    </View>
  );
}

function Row({ l, v }: { l: OwnerLine; v: OwnerCheckView }) {
  const w = v.words;
  const seller = l.supplierId ? v.sellers.get(l.supplierId) : undefined;
  const margin = l.buy && l.sale.gross ? l.sale.gross - l.buy.gross : undefined;
  const note = [l.qty !== 1 ? `× ${l.qty}` : '', l.off ? `${w.off} ${n(l.off)}` : ''].filter(Boolean).join(' · ');
  // Whose it is: the supplier (or the one who does it outside), the customer's own part, the garage's own work.
  const who = l.own ? (
    <Cell w={W.supplier} color={DIM}>
      {w.own}
    </Cell>
  ) : seller ? (
    <View style={{ width: W.supplier, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 3 }}>
      <Face name={seller.name} picture={seller.picture} />
      <Text style={{ fontSize: 9.5, flex: 1 }}>{`${seller.name}${l.outside ? ` · ${w.outside}` : ''}`}</Text>
    </View>
  ) : (
    <Cell w={W.supplier} color={l.kind === 'part' || l.outside ? ORANGE : DIM} size={9.5}>
      {l.kind === 'part' || l.outside ? w.noSupplier : w.garageWork}
    </Cell>
  );
  return (
    <View wrap={false} style={{ flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 0.4, borderColor: COLOR.rowRule, alignItems: 'center' }}>
      <View style={{ flex: 1, paddingHorizontal: 3 }}>
        <Text style={{ fontSize: 10, fontWeight: 'bold' }}>{l.name}</Text>
        {note ? <Text style={{ fontSize: 8.5, color: DIM, marginTop: 1 }}>{note}</Text> : null}
      </View>
      {who}
      <Cell w={W.buy} right color={l.own ? DIM : l.buy ? undefined : l.kind === 'part' || l.outside ? ORANGE : DIM}>
        {l.own ? '—' : l.buy ? n(l.buy.gross) : l.kind === 'part' || l.outside ? w.noCost : '—'}
      </Cell>
      <Cell w={W.sell} right bold color={l.sale.gross || l.own ? undefined : ORANGE}>
        {l.sale.gross ? n(l.sale.gross) : l.own ? '0.00' : w.noPrice}
      </Cell>
      <Cell w={W.margin} right bold color={margin === undefined ? DIM : margin >= 0 ? GREEN : RED}>
        {margin === undefined ? '' : `${margin >= 0 ? '+' : '−'}${n(Math.abs(margin))}`}
      </Cell>
    </View>
  );
}

function Total({ label, value, color, big }: { label: string; value: string; color?: string; big?: boolean }) {
  return (
    <View style={{ flex: 1, borderWidth: 0.6, borderColor: COLOR.boxBorder, borderRadius: 6, paddingVertical: 8, paddingHorizontal: 10, marginRight: 8 }}>
      <Text style={{ fontSize: 9, color: DIM }}>{label}</Text>
      <Text style={{ fontSize: big ? 17 : 14, fontWeight: 'bold', color: color ?? COLOR.ink, marginTop: 2 }}>{`AED ${value}`}</Text>
    </View>
  );
}

export async function renderOwnerCheck(v: OwnerCheckView): Promise<Blob> {
  const w = v.words;
  const c = v.check;
  const say = (s: string, values: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');
  return renderDoc((fam) => (
    <Document title={`${v.number} ${v.car}`}>
      <Page size="A4" style={{ fontSize: 9, paddingTop: 26, paddingHorizontal: 28, paddingBottom: 30, color: '#000', fontFamily: fam }}>
        {/* The garage, the job, the car — one band. */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {v.logo ? <Image src={v.logo} style={{ width: 52, height: 24, objectFit: 'contain', marginRight: 8 }} /> : null}
            <View>
              <Text style={{ fontSize: 10, fontWeight: 'bold', color: COLOR.head }}>{v.garage}</Text>
              <Text style={{ fontSize: 13, fontWeight: 'bold', marginTop: 1 }}>{w.title}</Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 14, fontWeight: 'bold' }}>{v.number}</Text>
            <Text style={{ fontSize: 9, color: DIM }}>{v.date}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', marginTop: 8, alignItems: 'center', backgroundColor: COLOR.bar, borderRadius: 6, padding: 6 }}>
          {v.photo ? <Image src={v.photo} style={{ width: 96, height: 60, objectFit: 'cover', borderRadius: 4, marginRight: 8 }} /> : null}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: 'bold' }}>{v.car}</Text>
            <Text style={{ fontSize: 10, marginTop: 2 }}>{[v.plate, v.customer ? `${w.customer}: ${v.customer}` : ''].filter(Boolean).join('  ·  ')}</Text>
          </View>
        </View>

        {/* One table: each line, whose it is, the supplier's price, what the garage sells it for, the difference. */}
        <Head w={w} />
        {c.parts.length > 0 && <Group title={w.parts} />}
        {c.parts.map((l, k) => (
          <Row key={`p${k}`} l={l} v={v} />
        ))}
        {c.work.length > 0 && <Group title={w.work} />}
        {c.work.map((l, k) => (
          <Row key={`w${k}`} l={l} v={v} />
        ))}
        {c.extra.length > 0 && <Group title={w.extra} />}
        {c.extra.map((x, k) => (
          <View key={`x${k}`} wrap={false} style={{ flexDirection: 'row', paddingVertical: 3, borderBottomWidth: 0.4, borderColor: COLOR.rowRule }}>
            <Cell>{x.name}</Cell>
            <Cell w={W.supplier}> </Cell>
            <Cell w={W.buy} right>
              {n(x.buy.gross)}
            </Cell>
            <Cell w={W.sell}> </Cell>
            <Cell w={W.margin} right bold color={RED}>
              {`−${n(x.buy.gross)}`}
            </Cell>
          </View>
        ))}
        {c.discount.gross !== 0 && (
          <View wrap={false} style={{ flexDirection: 'row', paddingVertical: 3, borderBottomWidth: 0.4, borderColor: COLOR.rowRule }}>
            <Cell bold color={GREEN}>
              {w.discount}
            </Cell>
            <Cell w={W.supplier}> </Cell>
            <Cell w={W.buy}> </Cell>
            <Cell w={W.sell} right bold color={GREEN}>
              {`−${n(Math.abs(c.discount.gross))}`}
            </Cell>
            <Cell w={W.margin}> </Cell>
          </View>
        )}

        {/* What it comes to. */}
        <View wrap={false} style={{ flexDirection: 'row', marginTop: 14, marginRight: -8 }}>
          <Total label={w.toClient} value={n(c.sale.gross)} big />
          <Total label={w.spent} value={n(c.buy.gross)} />
          <Total label={w.profit} value={n(c.profit.gross)} color={c.profit.gross >= 0 ? GREEN : RED} big />
        </View>
        <Text style={{ fontSize: 9.5, color: DIM, marginTop: 8 }}>{say(w.vatLine, { out: n(c.vat.out), in: n(c.vat.in), due: n(c.vat.due) })}</Text>
        {(c.unpriced > 0 || c.noCost > 0) && (
          <Text style={{ fontSize: 10, color: ORANGE, marginTop: 5, fontWeight: 'bold' }}>
            {[c.unpriced > 0 ? w.warnUnpriced.replace('{n}', String(c.unpriced)) : '', c.noCost > 0 ? w.warnNoCost.replace('{n}', String(c.noCost)) : ''].filter(Boolean).join('  ·  ')}
          </Text>
        )}
        <Text style={{ fontSize: 8, color: DIM, marginTop: 10 }} fixed>
          {w.footer}
        </Text>
      </Page>
    </Document>
  ));
}
