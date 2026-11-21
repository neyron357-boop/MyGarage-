import { Document, Page, Text, View } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import { statementOf, type LineStatus, type OwedLine } from '../domain/account';
import { dubaiDate, formatDate } from '../domain/dates';
import { buyerName } from '../domain/invoice';
import { formatPhone } from '../domain/phone';
import type { ExpenseMethod } from '../domain/types';
import { customerAccount } from '../services/account';
import { getSettings } from '../services/settings';
import { renderDoc } from './documents';
import { aed, Ar, AR_LABEL, BiLine, BlockLabel, COLOR, GarageFooter, GarageHeader, PaidStamp, TitleBar } from './garage';

/*
 * The statement of account for the customer (v0.30; v0.62.2 — the user: «прозрачная картина / отчёт для клиента: за что
 * оплачено, что осталось и т. д. — подробная и очень грамотная»). For the invoices of a period as they stand today (v0.63,
 * «оплата была сегодня» — a month paid later is paid on its own statement):
 *   — three figures: invoiced, paid of it, balance due (invoiced − paid = due) — of the period only (v0.63.1, the user:
 *     «отображается остаток баланса за всё время — нужно, чтобы отображался баланс только за выбранный период»: what the
 *     account owes for other periods is not on it);
 *   — the months: what each month's invoices came to, what is paid of them, what is left, PAID / PART PAID / UNPAID;
 *   — every invoice of the period: its amount, paid, left, its status and the day it was paid off;
 *   — every payment for them, whenever made: its day, receipt, way, the invoices it paid (by month), its part for them,
 *     and what was left of them after it;
 *   — the one figure due, PAID when nothing is.
 * In English with Arabic labels, as the garage's documents are; the figures — domain/account.ts (services/account.ts).
 */

const AR = {
  statement: 'كشف حساب',
  period: 'الفترة',
  opening: 'الرصيد الافتتاحي',
  invoiced: 'إجمالي الفواتير',
  paid: 'المدفوع',
  closing: 'الرصيد الختامي',
  months: 'ملخص شهري',
  invoices: 'الفواتير',
  payments: 'المدفوعات',
  totalDue: 'إجمالي المستحق',
  balanceDue: 'الرصيد المستحق',
};

const METHOD: Record<ExpenseMethod, string> = { cash: 'Cash', card: 'Card', transfer: 'Bank transfer', outside: 'Paid to the owner', credit: 'Credit' };
const STATUS: Record<LineStatus, { text: string; color: string }> = {
  paid: { text: 'PAID', color: '#2e7d32' },
  part: { text: 'PART PAID', color: '#b26a00' },
  unpaid: { text: 'UNPAID', color: COLOR.paid },
};

const monthText = (month: string, short = false) => new Intl.DateTimeFormat('en-GB', { month: short ? 'short' : 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-15T00:00:00Z`));
const dayText = (date: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
/** A sum in a table: the figure alone (the column says AED); a credit in brackets. */
const num = (fils: number) => (fils < 0 ? `(${aed(-fils).replace(/^AED\s/, '')})` : aed(fils).replace(/^AED\s/, ''));

const cell = { fontSize: 8.2 } as const;
const small = { fontSize: 7.4, color: COLOR.label } as const;

/** A section's head: the English, the Arabic, a rule under. */
function Section({ en, ar }: { en: string; ar: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 14, marginBottom: 4 }} wrap={false} minPresenceAhead={40}>
      <Text style={{ fontSize: 10, fontWeight: 'bold' }}>{en}  </Text>
      <Ar size={10} bold>
        {ar}
      </Ar>
    </View>
  );
}

/** A table's head row (repeated on each page the table runs onto). */
function Head({ cols }: { cols: { label: string; w?: number; right?: boolean }[] }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: COLOR.head, color: '#fff', paddingVertical: 4, paddingHorizontal: 3 }}>
      {cols.map((c) => (
        <Text key={c.label} style={[cell, { fontWeight: 'bold', textAlign: c.right ? 'right' : 'left', ...(c.w ? { width: c.w } : { flex: 1 }), paddingHorizontal: 2 }]}>
          {c.label}
        </Text>
      ))}
    </View>
  );
}

const Cell = ({ w, right, bold, color, children, size }: { w?: number; right?: boolean; bold?: boolean; color?: string; size?: number; children: ReactNode }) => (
  <Text style={[cell, { textAlign: right ? 'right' : 'left', fontWeight: bold ? 'bold' : 'normal', ...(color ? { color } : {}), ...(size ? { fontSize: size } : {}), ...(w ? { width: w } : { flex: 1 }), paddingHorizontal: 2 }]}>{children}</Text>
);

/** One of the four figures of the account. */
function Figure({ en, ar, fils, strong }: { en: string; ar: string; fils: number; strong?: boolean }) {
  return (
    <View style={{ flex: 1, paddingVertical: 6, paddingHorizontal: 8, backgroundColor: strong ? COLOR.bar : '#fff', borderWidth: 0.6, borderColor: COLOR.boxRule }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Text style={{ fontSize: 7.8, color: COLOR.label }}>{en}  </Text>
        <Ar size={7.8} color={COLOR.label}>
          {ar}
        </Ar>
      </View>
      <Text style={{ fontSize: strong ? 12 : 11, fontWeight: 'bold', marginTop: 3 }}>{aed(fils)}</Text>
    </View>
  );
}

/**
 * The customer's statement of the invoices of a period, as a PDF (v0.63: as they stand today — what was paid of them up
 * to today, whenever it was paid; the rest of the account beside them).
 */
export async function renderStatement(customerId: string, from: string, to: string): Promise<Blob> {
  const [account, settings] = await Promise.all([customerAccount(customerId), getSettings()]);
  if (!account) throw new Error('not found');
  const today = dubaiDate();
  const s = statementOf(account.lines, account.payments, from, to, today);
  const c = account.customer;
  const line = new Map<string, OwedLine>(s.lines.map((l) => [l.key, l]));
  // What a payment paid of these invoices, by month: "Sept 2026: 230, 231".
  const appliedTo = (parts: { key: string; amountFils: number }[]) => {
    const by = new Map<string, string[]>();
    for (const p of parts) {
      const l = line.get(p.key);
      if (!l || p.amountFils <= 0) continue;
      const m = l.date.slice(0, 7);
      by.set(m, [...(by.get(m) ?? []), l.number ?? '—']);
    }
    return [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([m, n]) => `${monthText(m, true)}: ${n.join(', ')}`);
  };
  const settled = s.dueFils <= 0 && s.lines.length > 0;
  const lastPaid = s.lines.map((l) => l.paidOn ?? '').sort().at(-1) || today;
  const first = from === '2000-01-01' ? s.lines[0]?.date ?? from : from;
  const last = to > today ? today : to;
  const invoiceCols = [
    { label: 'Date', w: 54 },
    { label: 'Invoice No.', w: 72 },
    { label: 'Vehicle' },
    { label: 'Amount', w: 64, right: true },
    { label: 'Paid', w: 64, right: true },
    { label: 'Balance', w: 64, right: true },
    { label: 'Status', w: 60, right: true },
  ];
  let month = '';
  return renderDoc((fam) => (
    <Document title={`Statement of Account - ${buyerName(c)} - ${from} - ${to}`}>
      <Page size="A4" style={{ fontSize: 9, paddingTop: 36, paddingHorizontal: 34.5, paddingBottom: 46, color: '#000', fontFamily: fam }}>
        <GarageHeader s={settings} compact />
        <TitleBar en="STATEMENT OF ACCOUNT" ar={AR.statement} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, marginBottom: 4 }}>
          <View>
            <BiLine en="Date" ar={AR_LABEL.date} value={formatDate(today)} />
            <BiLine en="Invoices of" ar={AR.period} value={`${dayText(first)} – ${dayText(last)}`} />
            {settings.trn ? <BiLine en="TRN" ar={AR_LABEL.taxId} value={settings.trn} /> : null}
          </View>
          <View style={{ alignItems: 'flex-end', width: 250 }}>
            <BlockLabel en="BILL TO" ar={AR_LABEL.billTo} right />
            <Text style={{ fontSize: 12, textAlign: 'right', marginBottom: 3 }}>{buyerName(c) || '—'}</Text>
            {c.phone ? <Text style={{ fontSize: 9.5, marginBottom: 3 }}>{formatPhone(c.phone)}</Text> : null}
            {c.trn ? <BiLine right en="Tax ID" ar={AR_LABEL.taxId} value={`(TRN): ${c.trn}`} colon={false} /> : null}
          </View>
        </View>

        {/* The period's invoices in three figures — invoiced − paid = due; nothing of other periods (v0.63.1). */}
        <View style={{ flexDirection: 'row', marginTop: 8 }} wrap={false}>
          <Figure en="Invoiced" ar={AR.invoiced} fils={s.invoicedFils} />
          <Figure en="Paid" ar={AR.paid} fils={s.paidFils} />
          <Figure en="Balance due" ar={AR.balanceDue} fils={s.dueFils} strong />
        </View>
        <Text style={[small, { marginTop: 3 }]}>
          {`Invoiced ${aed(s.invoicedFils)} − paid ${aed(s.paidFils)} = balance due ${aed(s.dueFils)}: the invoices of this period, with every payment made for them up to ${formatDate(today)}.`}
        </Text>

        {/* The months: what each came to, what is paid, what is left. */}
        {s.months.length > 0 && (
          <>
            <Section en="SUMMARY BY MONTH" ar={AR.months} />
            <Head cols={[{ label: 'Month' }, { label: 'Invoices', w: 56, right: true }, { label: 'Invoiced', w: 78, right: true }, { label: 'Paid', w: 78, right: true }, { label: 'Balance', w: 78, right: true }, { label: 'Status', w: 74, right: true }]} />
            {s.months.map((m, i) => (
              <View key={m.month} wrap={false} style={{ flexDirection: 'row', paddingVertical: 3.5, paddingHorizontal: 3, backgroundColor: i % 2 ? '#f6f7f9' : '#fff' }}>
                <Cell bold>{monthText(m.month)}</Cell>
                <Cell w={56} right>
                  {String(m.count)}
                </Cell>
                <Cell w={78} right>
                  {num(m.totalFils)}
                </Cell>
                <Cell w={78} right>
                  {num(m.paidFils)}
                </Cell>
                <Cell w={78} right bold>
                  {num(m.balanceFils)}
                </Cell>
                <Cell w={74} right bold color={STATUS[m.status].color}>
                  {STATUS[m.status].text}
                </Cell>
              </View>
            ))}
            <View wrap={false} style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: COLOR.head, paddingVertical: 4, paddingHorizontal: 3 }}>
              <Cell bold>Total</Cell>
              <Cell w={56} right bold>
                {String(s.lines.length)}
              </Cell>
              <Cell w={78} right bold>
                {num(s.invoicedFils)}
              </Cell>
              <Cell w={78} right bold>
                {num(s.paidFils)}
              </Cell>
              <Cell w={78} right bold>
                {num(s.dueFils)}
              </Cell>
              <Cell w={74}> </Cell>
            </View>
          </>
        )}

        {/* Every invoice: amount, paid, left — and when it was paid off. */}
        {s.lines.length > 0 ? (
          <>
            <Section en="INVOICES" ar={AR.invoices} />
            <Head cols={invoiceCols} />
            {s.lines.map((l) => {
              const m = l.date.slice(0, 7);
              const head = m !== month;
              month = m;
              return (
                <View key={l.key} wrap={false}>
                  {head ? (
                    <View style={{ flexDirection: 'row', paddingTop: 5, paddingBottom: 2, paddingHorizontal: 3, borderBottomWidth: 0.6, borderColor: COLOR.boxRule }}>
                      <Text style={{ fontSize: 8.2, fontWeight: 'bold', color: COLOR.head }}>{monthText(m)}</Text>
                    </View>
                  ) : null}
                  <View style={{ flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 3, borderBottomWidth: 0.4, borderColor: COLOR.rowRule }}>
                    <Cell w={54}>{formatDate(l.date)}</Cell>
                    <Cell w={72} bold>
                      {l.number ?? '—'}
                    </Cell>
                    <Cell>{l.label ?? ''}</Cell>
                    <Cell w={64} right>
                      {num(l.totalFils)}
                    </Cell>
                    <Cell w={64} right>
                      {l.paidFils ? num(l.paidFils) : '—'}
                    </Cell>
                    <Cell w={64} right bold>
                      {num(l.balanceFils)}
                    </Cell>
                    <View style={{ width: 60, paddingHorizontal: 2, alignItems: 'flex-end' }}>
                      <Text style={[cell, { fontWeight: 'bold', color: STATUS[l.status].color }]}>{STATUS[l.status].text}</Text>
                      {l.paidOn ? <Text style={[small, { fontSize: 6.8 }]}>{formatDate(l.paidOn)}</Text> : null}
                    </View>
                  </View>
                </View>
              );
            })}
          </>
        ) : (
          <Text style={[small, { marginTop: 10 }]}>No invoices in this period.</Text>
        )}

        {/* Every payment for them, whenever it was made: what it paid of them, and what was left after it. */}
        <Section en="PAYMENTS RECEIVED" ar={AR.payments} />
        {s.payments.length ? (
          <>
            <Head cols={[{ label: 'Date', w: 54 }, { label: 'Receipt', w: 70 }, { label: 'Method', w: 62 }, { label: 'Applied to' }, { label: 'Amount', w: 72, right: true }, { label: 'Balance after', w: 78, right: true }]} />
            {s.payments.map((p) => (
              <View key={p.id} wrap={false} style={{ flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 3, borderBottomWidth: 0.4, borderColor: COLOR.rowRule }}>
                <Cell w={54}>{formatDate(p.date)}</Cell>
                <Cell w={70}>{p.ref ?? '—'}</Cell>
                <Cell w={62}>{METHOD[p.method]}</Cell>
                <View style={{ flex: 1, paddingHorizontal: 2 }}>
                  {appliedTo(p.parts).map((t) => (
                    <Text key={t} style={{ fontSize: 7.6 }}>
                      {t}
                    </Text>
                  ))}
                  {p.amountFils < 0 ? <Text style={small}>Refund</Text> : null}
                  {p.wholeFils !== undefined && p.wholeFils !== p.amountFils ? <Text style={small}>{`of a payment of ${aed(p.wholeFils)}`}</Text> : null}
                </View>
                <Cell w={72} right bold>
                  {num(p.amountFils)}
                </Cell>
                <Cell w={78} right>
                  {num(p.leftFils)}
                </Cell>
              </View>
            ))}
            <View wrap={false} style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: COLOR.head, paddingVertical: 4, paddingHorizontal: 3 }}>
              <Cell bold>{`Total paid (${s.payments.length})`}</Cell>
              <Cell w={72} right bold>
                {num(s.payments.reduce((a, p) => a + p.amountFils, 0))}
              </Cell>
              <Cell w={78}> </Cell>
            </View>
          </>
        ) : (
          <Text style={[small, { marginTop: 2 }]}>No payments for these invoices yet.</Text>
        )}

        {/* The one figure due — PAID when nothing is. */}
        <View wrap={false} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 14 }}>
          <View style={{ flex: 1 }}>{settled ? <PaidStamp on={formatDate(lastPaid)} /> : null}</View>
          <View style={{ width: 260 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLOR.bar, paddingVertical: 7, paddingHorizontal: 9 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <Text style={{ fontSize: 11, fontWeight: 'bold' }}>BALANCE DUE  </Text>
                <Ar size={11} bold>
                  {AR.totalDue}
                </Ar>
              </View>
              <Text style={{ fontSize: 13, fontWeight: 'bold' }}>{aed(Math.max(0, s.dueFils))}</Text>
            </View>
            <Text style={[small, { marginTop: 3, textAlign: 'right' }]}>{`for ${dayText(first)} – ${dayText(last)}, as of ${dayText(today)}`}</Text>
          </View>
        </View>
        <Text style={[small, { marginTop: 10 }]}>
          Each payment shows the part of it applied to the invoices above; "Balance after" is what was left of them right after that payment. Please quote the invoice numbers with your payment.
        </Text>
        {settings.bankDetails ? <Text style={{ fontSize: 8, color: COLOR.head, marginTop: 8 }}>{settings.bankDetails}</Text> : null}
        <GarageFooter s={settings} />
      </Page>
    </Document>
  ));
}
