import { Document, Image, Page, Text, View } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import { formatAed } from '../domain/money';
import type { OwnerCheck, OwnerLine } from '../domain/ownerCheck';
import type { Amounts } from '../domain/vat';
import { renderDoc } from './documents';
import { COLOR } from './garage';

/*
 * The job for the owner to check, as a PDF (v0.82, the owner's note 24/11 — domain/ownerCheck.ts). Page one: the car and
 * whose it is; the parts, then the work and services — each line bought and sold for, without VAT and its VAT, the
 * customer's total and what is left; the job's other expenses; the totals; the VAT laid out — from the customer, to the
 * sellers, to pay; the profit with VAT and without. Page two: the sellers, each with its WhatsApp picture, its lines and
 * what it is paid. Words in the language they are made in (the owner's — the boss's of «WhatsApp → Автоматизация»).
 */

export interface OwnerCheckWords {
  title: string;
  parts: string;
  work: string;
  extra: string;
  item: string;
  qty: string;
  buyNet: string;
  buyVat: string;
  saleNet: string;
  saleVat: string;
  saleTotal: string;
  margin: string;
  noCost: string;
  noPrice: string;
  own: string;
  outside: string;
  noSupplier: string;
  off: string;
  discount: string;
  totals: string;
  net: string;
  vat: string;
  gross: string;
  toClient: string;
  spent: string;
  profit: string;
  profitGross: string;
  profitNet: string;
  taxes: string;
  vatOut: string;
  vatIn: string;
  vatDue: string;
  warnUnpriced: string;
  warnNoCost: string;
  sellers: string;
  sellerTotal: string;
  noSellers: string;
  customer: string;
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
const W = { name: 0, qty: 26, num: 56 };

function Cell({ w, right, bold, color, size = 8, children }: { w?: number; right?: boolean; bold?: boolean; color?: string; size?: number; children: ReactNode }) {
  return <Text style={{ ...(w ? { width: w } : { flex: 1 }), fontSize: size, textAlign: right ? 'right' : 'left', fontWeight: bold ? 'bold' : 'normal', color: color ?? COLOR.ink, paddingHorizontal: 2 }}>{children}</Text>;
}

function Head({ w }: { w: OwnerCheckWords }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: COLOR.bar, paddingVertical: 4, marginTop: 4 }} fixed>
      <Cell bold>{w.item}</Cell>
      <Cell w={W.qty} right bold>
        {w.qty}
      </Cell>
      <Cell w={W.num} right bold>
        {w.buyNet}
      </Cell>
      <Cell w={W.num - 10} right bold>
        {w.buyVat}
      </Cell>
      <Cell w={W.num} right bold>
        {w.saleNet}
      </Cell>
      <Cell w={W.num - 10} right bold>
        {w.saleVat}
      </Cell>
      <Cell w={W.num} right bold>
        {w.saleTotal}
      </Cell>
      <Cell w={W.num} right bold>
        {w.margin}
      </Cell>
    </View>
  );
}

function Row({ l, v }: { l: OwnerLine; v: OwnerCheckView }) {
  const w = v.words;
  const seller = l.supplierId ? v.sellers.get(l.supplierId)?.name : undefined;
  const note = l.own ? w.own : [l.outside ? w.outside : '', seller ?? (l.kind === 'part' || l.outside ? w.noSupplier : ''), l.off ? `${w.off} ${n(l.off)}` : ''].filter(Boolean).join(' · ');
  const margin = l.buy && l.sale.gross ? l.sale.gross - l.buy.gross : undefined;
  return (
    <View wrap={false} style={{ flexDirection: 'row', paddingVertical: 3.5, borderBottomWidth: 0.5, borderColor: COLOR.rowRule, alignItems: 'flex-start' }}>
      <View style={{ flex: 1, paddingHorizontal: 2 }}>
        <Text style={{ fontSize: 8.5, fontWeight: 'bold' }}>{l.name}</Text>
        {note ? <Text style={{ fontSize: 7, color: seller ? '#1d4ed8' : DIM, marginTop: 1 }}>{note}</Text> : null}
      </View>
      <Cell w={W.qty} right>
        {String(l.qty)}
      </Cell>
      {l.own ? (
        <Cell w={W.num * 5 - 20 + W.num} right color={DIM}>
          {w.own}
        </Cell>
      ) : (
        <>
          <Cell w={W.num} right color={l.buy ? undefined : ORANGE}>
            {l.buy ? n(l.buy.net) : w.noCost}
          </Cell>
          <Cell w={W.num - 10} right color={DIM}>
            {l.buy ? n(l.buy.vat) : ''}
          </Cell>
          <Cell w={W.num} right color={l.sale.gross ? undefined : ORANGE}>
            {l.sale.gross ? n(l.sale.net) : w.noPrice}
          </Cell>
          <Cell w={W.num - 10} right color={DIM}>
            {l.sale.gross ? n(l.sale.vat) : ''}
          </Cell>
          <Cell w={W.num} right bold>
            {l.sale.gross ? n(l.sale.gross) : ''}
          </Cell>
          <Cell w={W.num} right bold color={margin === undefined ? DIM : margin >= 0 ? GREEN : RED}>
            {margin === undefined ? '' : `${margin >= 0 ? '+' : '−'}${n(Math.abs(margin))}`}
          </Cell>
        </>
      )}
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={{ fontSize: 11, fontWeight: 'bold', color: COLOR.head }}>{title}</Text>
      {children}
    </View>
  );
}

/** A row of a totals box: the label, then without VAT · VAT · with VAT. */
function Sum({ label, a, bold, color }: { label: string; a: Amounts; bold?: boolean; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 3, borderBottomWidth: 0.5, borderColor: COLOR.boxRule }}>
      <Cell bold={bold} size={9} color={color}>
        {label}
      </Cell>
      <Cell w={70} right size={9} color={color}>
        {n(a.net)}
      </Cell>
      <Cell w={60} right size={9} color={DIM}>
        {n(a.vat)}
      </Cell>
      <Cell w={74} right bold size={9} color={color}>
        {n(a.gross)}
      </Cell>
    </View>
  );
}

function One({ label, value, bold, color, size = 9 }: { label: string; value: string; bold?: boolean; color?: string; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 0.5, borderColor: COLOR.boxRule }}>
      <Text style={{ fontSize: size, fontWeight: bold ? 'bold' : 'normal', color: color ?? COLOR.ink }}>{label}</Text>
      <Text style={{ fontSize: size, fontWeight: 'bold', color: color ?? COLOR.ink }}>{value}</Text>
    </View>
  );
}

const initials = (name: string) =>
  name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase())
    .join('');

export async function renderOwnerCheck(v: OwnerCheckView): Promise<Blob> {
  const w = v.words;
  const c = v.check;
  return renderDoc((fam) => (
    <Document title={`${v.number} ${v.car}`}>
      <Page size="A4" style={{ fontSize: 9, paddingTop: 30, paddingHorizontal: 30, paddingBottom: 36, color: '#000', fontFamily: fam }}>
        {/* The garage, the job, the car. */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {v.logo ? <Image src={v.logo} style={{ width: 60, height: 28, objectFit: 'contain', marginRight: 8 }} /> : null}
            <Text style={{ fontSize: 10, fontWeight: 'bold', color: COLOR.head }}>{v.garage}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 12, fontWeight: 'bold' }}>{v.number}</Text>
            <Text style={{ fontSize: 8, color: DIM }}>{v.date}</Text>
          </View>
        </View>
        <View style={{ backgroundColor: COLOR.bar, paddingVertical: 5, paddingHorizontal: 8, marginTop: 8 }}>
          <Text style={{ fontSize: 12, fontWeight: 'bold' }}>{w.title}</Text>
        </View>
        <View style={{ flexDirection: 'row', marginTop: 8, alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: 'bold' }}>{v.car}</Text>
            <Text style={{ fontSize: 10, marginTop: 3 }}>{v.plate}</Text>
            {v.customer ? <Text style={{ fontSize: 9, marginTop: 3, color: DIM }}>{`${w.customer}: ${v.customer}`}</Text> : null}
          </View>
          {v.photo ? <Image src={v.photo} style={{ width: 150, height: 92, objectFit: 'cover', borderRadius: 6 }} /> : null}
        </View>

        {c.parts.length > 0 && (
          <Section title={w.parts}>
            <Head w={w} />
            {c.parts.map((l, k) => (
              <Row key={k} l={l} v={v} />
            ))}
          </Section>
        )}
        {c.work.length > 0 && (
          <Section title={w.work}>
            <Head w={w} />
            {c.work.map((l, k) => (
              <Row key={k} l={l} v={v} />
            ))}
          </Section>
        )}
        {c.extra.length > 0 && (
          <Section title={w.extra}>
            {c.extra.map((x, k) => (
              <View key={k} wrap={false} style={{ flexDirection: 'row', paddingVertical: 3, borderBottomWidth: 0.5, borderColor: COLOR.rowRule }}>
                <Cell>{x.name}</Cell>
                <Cell w={W.num} right>
                  {n(x.buy.net)}
                </Cell>
                <Cell w={W.num - 10} right color={DIM}>
                  {n(x.buy.vat)}
                </Cell>
                <Cell w={W.num} right bold>
                  {n(x.buy.gross)}
                </Cell>
              </View>
            ))}
          </Section>
        )}

        {/* The totals, the taxes, the profit. */}
        <View wrap={false} style={{ flexDirection: 'row', marginTop: 14 }}>
          <View style={{ flex: 1, marginRight: 14 }}>
            <Text style={{ fontSize: 11, fontWeight: 'bold', color: COLOR.head, marginBottom: 2 }}>{w.totals}</Text>
            <View style={{ flexDirection: 'row', paddingBottom: 2 }}>
              <Cell> </Cell>
              <Cell w={70} right color={DIM}>
                {w.net}
              </Cell>
              <Cell w={60} right color={DIM}>
                {w.vat}
              </Cell>
              <Cell w={74} right color={DIM}>
                {w.gross}
              </Cell>
            </View>
            {c.discount.gross !== 0 && <Sum label={w.discount} a={c.discount} color={GREEN} />}
            <Sum label={w.toClient} a={c.sale} bold />
            <Sum label={w.spent} a={c.buy} />
            <View style={{ flexDirection: 'row', paddingVertical: 4, marginTop: 2, backgroundColor: COLOR.bar }}>
              <Cell bold size={10}>
                {w.profit}
              </Cell>
              <Cell w={70} right bold size={10} color={c.profit.net >= 0 ? GREEN : RED}>
                {n(c.profit.net)}
              </Cell>
              <Cell w={60}> </Cell>
              <Cell w={74} right bold size={10} color={c.profit.gross >= 0 ? GREEN : RED}>
                {n(c.profit.gross)}
              </Cell>
            </View>
            <Text style={{ fontSize: 7, color: DIM, marginTop: 2 }}>{`${w.profitNet} · ${w.profitGross}`}</Text>
          </View>
          <View style={{ width: 190 }}>
            <Text style={{ fontSize: 11, fontWeight: 'bold', color: COLOR.head, marginBottom: 2 }}>{w.taxes}</Text>
            <One label={w.vatOut} value={n(c.vat.out)} />
            <One label={w.vatIn} value={`− ${n(c.vat.in)}`} />
            <One label={w.vatDue} value={n(c.vat.due)} bold size={10} />
          </View>
        </View>
        {(c.unpriced > 0 || c.noCost > 0) && (
          <View style={{ marginTop: 10, padding: 6, borderWidth: 0.8, borderColor: ORANGE, borderRadius: 4 }}>
            {c.unpriced > 0 ? <Text style={{ fontSize: 8.5, color: ORANGE }}>{w.warnUnpriced.replace('{n}', String(c.unpriced))}</Text> : null}
            {c.noCost > 0 ? <Text style={{ fontSize: 8.5, color: ORANGE, marginTop: c.unpriced ? 2 : 0 }}>{w.warnNoCost.replace('{n}', String(c.noCost))}</Text> : null}
          </View>
        )}
      </Page>

      {/* The sellers, a page of their own. */}
      <Page size="A4" style={{ fontSize: 9, paddingTop: 30, paddingHorizontal: 30, paddingBottom: 36, color: '#000', fontFamily: fam }}>
        <View style={{ backgroundColor: COLOR.bar, paddingVertical: 5, paddingHorizontal: 8 }}>
          <Text style={{ fontSize: 12, fontWeight: 'bold' }}>{`${w.sellers} · ${v.number} · ${v.car}`}</Text>
        </View>
        {c.sellers.length === 0 ? <Text style={{ marginTop: 10, color: DIM }}>{w.noSellers}</Text> : null}
        {c.sellers.map((s) => {
          const who = v.sellers.get(s.supplierId);
          const name = who?.name ?? '—';
          return (
            <View key={s.supplierId} wrap={false} style={{ marginTop: 12, borderWidth: 0.6, borderColor: COLOR.boxBorder, borderRadius: 6, padding: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {who?.picture ? (
                  <Image src={who.picture} style={{ width: 34, height: 34, borderRadius: 17, objectFit: 'cover' }} />
                ) : (
                  <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#e0e7ff', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 11, fontWeight: 'bold', color: '#3730a3' }}>{initials(name) || '?'}</Text>
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={{ fontSize: 11, fontWeight: 'bold' }}>{name}</Text>
                  {who?.phone ? <Text style={{ fontSize: 8, color: DIM, marginTop: 1 }}>{who.phone}</Text> : null}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 7, color: DIM }}>{w.sellerTotal}</Text>
                  <Text style={{ fontSize: 11, fontWeight: 'bold' }}>{`AED ${n(s.total)}`}</Text>
                </View>
              </View>
              {s.lines.map((l, k) => (
                <View key={k} style={{ flexDirection: 'row', paddingVertical: 2.5, borderTopWidth: k ? 0.4 : 0.8, borderColor: COLOR.rowRule, marginTop: k ? 0 : 6 }}>
                  <Cell size={8.5}>{`${l.name}${l.qty !== 1 ? `  × ${l.qty}` : ''}`}</Cell>
                  <Cell w={70} right size={8.5} color={l.buy ? DIM : ORANGE}>
                    {l.buy ? `${n(l.buy.net)} + ${n(l.buy.vat)}` : w.noCost}
                  </Cell>
                  <Cell w={64} right bold size={8.5}>
                    {l.buy ? n(l.buy.gross) : ''}
                  </Cell>
                </View>
              ))}
            </View>
          );
        })}
      </Page>
    </Document>
  ));
}
