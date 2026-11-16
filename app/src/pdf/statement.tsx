import { Document, Page, Text, View } from '@react-pdf/renderer';
import { db } from '../db/db';
import { dubaiDate, formatDate } from '../domain/dates';
import { activeInvoice, buyerName } from '../domain/invoice';
import { liveLines } from '../domain/flow';
import { itemAmounts, itemTitle, lineName } from '../domain/items';
import { formatPhone } from '../domain/phone';
import { formatPlate } from '../domain/plates';
import { loadDebtors } from '../services/debts';
import { getSettings } from '../services/settings';
import { renderDoc } from './documents';
import { aed, Ar, AR_LABEL, BiLine, BlockLabel, COLOR, GarageFooter, GarageHeader, TitleBar } from './garage';

/*
 * One sheet for all a customer owes (v0.30 — «Деньги → Долги», the customer's card): a statement of account. Each
 * job still owed is a block — its date, invoice, car and plate, what was done (the invoice's lines), its total, what
 * was paid and what is due — and under them all the one sum the customer owes. A tax invoice is never issued twice
 * or merged: each block names its invoice (the files are the archive beside it). In English with Arabic labels, as
 * the garage's documents are.
 */

const AR = { count: 'عدد الفواتير', statement: 'كشف حساب', paid: 'المدفوع', due: 'المستحق', totalDue: 'إجمالي المستحق', vehicle: 'المركبة' };

interface Block {
  date: string;
  invoice: string;
  job: number;
  car: string;
  plate: string;
  lines: { name: string; qty: number; total: number }[];
  totalFils: number;
  paidFils: number;
  dueFils: number;
}

export async function renderStatement(customerId: string): Promise<Blob> {
  const debtor = (await loadDebtors()).find((d) => d.customer.id === customerId);
  if (!debtor) throw new Error('not found');
  const settings = await getSettings();
  const blocks: Block[] = [];
  for (const car of debtor.cars)
    for (const j of car.jobs) {
      const [invoices, items] = await Promise.all([db.invoices.where('orderId').equals(j.order.id).toArray(), db.items.where('orderId').equals(j.order.id).toArray()]);
      const inv = activeInvoice(invoices);
      const lines = inv
        ? inv.lines.filter((l) => l.kind !== 'discount').map((l) => ({ name: lineName(l.description, l.kind), qty: l.qty, total: l.gross }))
        : liveLines(items)
            .filter((i) => i.kind !== 'discount')
            .map((i) => ({ name: itemTitle(i, 'en'), qty: i.qty, total: itemAmounts(i).gross }));
      const totalFils = inv ? inv.totalFils : lines.reduce((s, l) => s + l.total, 0);
      blocks.push({
        date: inv ? inv.issuedAt : j.since,
        invoice: inv?.number ?? '—',
        job: j.order.number,
        car: [car.vehicle.make, car.vehicle.model].filter(Boolean).join(' '),
        plate: formatPlate(car.vehicle.plate, 'en'),
        lines,
        totalFils,
        paidFils: Math.max(0, totalFils - j.dueFils),
        dueFils: j.dueFils,
      });
    }
  blocks.sort((a, b) => a.date.localeCompare(b.date));
  const c = debtor.customer;
  const total = blocks.reduce((s, b) => s + b.totalFils, 0);
  const paid = blocks.reduce((s, b) => s + b.paidFils, 0);
  const cell = { fontSize: 8.6 } as const;
  return renderDoc((fam) => (
    <Document title={`Statement - ${buyerName(c)}`}>
      <Page size="A4" style={{ fontSize: 9, paddingTop: 36, paddingHorizontal: 34.5, paddingBottom: 40, color: '#000', fontFamily: fam }}>
        <GarageHeader s={settings} compact />
        <TitleBar en="STATEMENT OF ACCOUNT" ar={AR.statement} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, marginBottom: 8 }}>
          <View>
            <BiLine en="Date" ar={AR_LABEL.date} value={formatDate(dubaiDate())} />
            <BiLine en="Invoices" ar={AR.count} value={String(blocks.length)} />
            {settings.trn ? <BiLine en="TRN" ar={AR_LABEL.taxId} value={settings.trn} /> : null}
          </View>
          <View style={{ alignItems: 'flex-end', width: 240 }}>
            <BlockLabel en="BILL TO" ar={AR_LABEL.billTo} right />
            <Text style={{ fontSize: 12, textAlign: 'right', marginBottom: 3 }}>{buyerName(c) || '—'}</Text>
            {c.phone ? <Text style={{ fontSize: 9.5, marginBottom: 3 }}>{formatPhone(c.phone)}</Text> : null}
            {c.trn ? <BiLine right en="Tax ID" ar={AR_LABEL.taxId} value={`(TRN): ${c.trn}`} colon={false} /> : null}
          </View>
        </View>
        {/* The head of the table: one row per job, its work under it. */}
        <View style={{ flexDirection: 'row', backgroundColor: COLOR.bar, paddingVertical: 3.5, paddingHorizontal: 4 }} fixed>
          <Text style={[cell, { width: 58, fontWeight: 'bold' }]}>Date</Text>
          <Text style={[cell, { flex: 1, fontWeight: 'bold' }]}>Invoice · Vehicle · Work</Text>
          <Text style={[cell, { width: 70, textAlign: 'right', fontWeight: 'bold' }]}>Total</Text>
          <Text style={[cell, { width: 66, textAlign: 'right', fontWeight: 'bold' }]}>Paid</Text>
          <Text style={[cell, { width: 74, textAlign: 'right', fontWeight: 'bold' }]}>Due</Text>
        </View>
        {blocks.map((b) => (
          <View key={`${b.job}`} wrap={false} style={{ borderBottomWidth: 0.6, borderColor: COLOR.boxRule, paddingVertical: 4, paddingHorizontal: 4 }}>
            <View style={{ flexDirection: 'row' }}>
              <Text style={[cell, { width: 58 }]}>{formatDate(dubaiDate(b.date))}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[cell, { fontWeight: 'bold' }]}>
                  {b.invoice} · Job #{b.job}
                </Text>
                <Text style={[cell, { color: COLOR.label }]}>{[b.car, b.plate].filter(Boolean).join(' · ')}</Text>
              </View>
              <Text style={[cell, { width: 70, textAlign: 'right' }]}>{aed(b.totalFils)}</Text>
              <Text style={[cell, { width: 66, textAlign: 'right', color: COLOR.label }]}>{b.paidFils ? aed(b.paidFils) : '—'}</Text>
              <Text style={[cell, { width: 74, textAlign: 'right', fontWeight: 'bold' }]}>{aed(b.dueFils)}</Text>
            </View>
            {b.lines.map((l, i) => (
              <View key={i} style={{ flexDirection: 'row', marginTop: 1.2 }}>
                <View style={{ width: 58 }} />
                <Text style={{ flex: 1, fontSize: 7.6, color: COLOR.label }}>
                  {l.qty !== 1 ? `${l.qty} × ` : ''}
                  {l.name}
                </Text>
                <Text style={{ width: 70, fontSize: 7.6, textAlign: 'right', color: COLOR.label }}>{aed(l.total)}</Text>
                <View style={{ width: 140 }} />
              </View>
            ))}
          </View>
        ))}
        {/* The sum: what was invoiced, paid, and the one figure owed. */}
        <View wrap={false} style={{ alignSelf: 'flex-end', width: 250, marginTop: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
            <Text style={{ fontSize: 9 }}>Total invoiced</Text>
            <Text style={{ fontSize: 9 }}>{aed(total)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
            <View style={{ flexDirection: 'row' }}>
              <Text style={{ fontSize: 9 }}>Total paid  </Text>
              <Ar size={9}>{AR.paid}</Ar>
            </View>
            <Text style={{ fontSize: 9 }}>{aed(paid)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLOR.bar, paddingVertical: 6, paddingHorizontal: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={{ fontSize: 11, fontWeight: 'bold' }}>TOTAL DUE  </Text>
              <Ar size={11} bold>
                {AR.totalDue}
              </Ar>
            </View>
            <Text style={{ fontSize: 12.5, fontWeight: 'bold' }}>{aed(debtor.totalFils)}</Text>
          </View>
        </View>
        {settings.bankDetails ? <Text style={{ fontSize: 8, color: COLOR.head, marginTop: 10 }}>{settings.bankDetails}</Text> : null}
        <GarageFooter s={settings} />
      </Page>
    </Document>
  ));
}
