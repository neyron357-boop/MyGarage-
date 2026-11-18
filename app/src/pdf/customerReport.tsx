import { Document, Page, Text, View } from '@react-pdf/renderer';
import { db } from '../db/db';
import { dubaiDate, formatDocDate } from '../domain/dates';
import { carPlate } from '../domain/historyPlan';
import { buyerName } from '../domain/invoice';
import type { Customer, HistoryInvoice, Settings, Vehicle, VehicleType } from '../domain/types';
import { vehicleTypeOf } from '../domain/vehicleType';
import { getSettings } from '../services/settings';
import { invoicePageView, InvoicePage, renderDoc, type InvoicePageView } from './documents';
import { aed, AR_LABEL, COLOR, GarageFooter, GarageHeader, TitleBar, type DocRow } from './garage';

/*
 * A customer's invoices of a month (or of any period) as one PDF (v0.45 — a corporate customer's monthly pack, until now put together
 * by hand): the summary — MONTHLY INVOICE SUMMARY – <MONTH YEAR>, a row an invoice (No. · INV NO. · INVOICE DATE ·
 * VEHICLE / MODEL · PLATE NO. · AMOUNT (AED)), its head row again on every page, TOTAL AMOUNT counted from those very
 * invoices (typed by hand, the summaries had typos and invoices left out) — then every invoice on a page of its own, as the
 * Tax Invoice of this app draws it: the garage's own invoices and those from before this app (read off their PDFs).
 */

export interface ReportItem {
  key: string;
  /** INV NO.: this app's "INV-2026-351"; one from before — its number as printed ("224", "107"). */
  number: string;
  /** YYYY-MM-DD */
  date: string;
  vehicle: string;
  plate: string;
  /** The car's body (Pickup, Van…) — as set on the car, else as its make and model tell. */
  vehicleType?: VehicleType;
  totalFils: number;
  page: InvoicePageView;
}

const typeOf = (car?: Vehicle): { vehicleType?: VehicleType } => {
  const t = car && (car.type ?? vehicleTypeOf(car.make, car.model));
  return t ? { vehicleType: t } : {};
};

/** "2 May 2026" — a day of a document without its time. */
const dayText = (date: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

/** "4:50 PM" on a day → the moment in Dubai. */
function dubaiMoment(date: string, time: string): string | undefined {
  const m = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(time.trim());
  if (!m) return undefined;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return new Date(`${date}T${String(h).padStart(2, '0')}:${m[2]}:00+04:00`).toISOString();
}

/** An invoice from before this app drawn as the Tax Invoice: its number (a job's "Job ID" or "Invoice Number"), day, car as printed. */
export function historyPageView(h: HistoryInvoice, settings: Settings, customer: Customer): InvoicePageView {
  const rows: DocRow[] = h.lines.map((l) => ({ description: l.description, price: l.unitNetFils, ...(l.discountFils ? { discount: l.discountFils } : {}), vat: l.vatFils, qty: l.qty, total: l.grossFils }));
  const at = h.time ? dubaiMoment(h.date, h.time) : undefined;
  return {
    head: settings,
    seller: { name: settings.name, phone: settings.phone, email: settings.email, trn: settings.trn },
    numberLabel: h.numberKind === 'job' ? { en: 'Job ID', ar: AR_LABEL.jobId } : { en: 'Invoice Number', ar: AR_LABEL.invoiceNumber },
    number: h.number,
    dateText: at ? formatDocDate(at) : dayText(h.date),
    buyer: { name: buyerName(customer), phone: customer.phone, email: customer.email, trn: customer.trn, address: customer.address },
    car: { name: h.vehicleText, plate: h.plate, ...(h.vin ? { vin: h.vin } : {}) },
    rows,
    qty: h.lines.reduce((a, l) => a + l.qty, 0),
    discount: 0,
    vat: h.vatFils,
    vatRateBp: settings.vatRateBp,
    total: h.totalFils,
    ...(h.paymentMethod ? { paymentMethod: h.paymentMethod } : {}),
    ...(settings.bankDetails ? { bankDetails: settings.bankDetails } : {}),
  };
}

/**
 * The customer's invoices of a period, oldest first: this app's (issued and standing — not one a credit note took back,
 * not the credit note) and those from before it.
 */
export async function reportItems(customerId: string, from: string, to: string): Promise<ReportItem[]> {
  const [customer, settings] = await Promise.all([db.customers.get(customerId), getSettings()]);
  if (!customer) return [];
  const [history, orders] = await Promise.all([db.historyInvoices.where('customerId').equals(customerId).toArray(), db.orders.where('customerId').equals(customerId).toArray()]);
  const cars = new Map((await db.vehicles.where('customerId').equals(customerId).toArray()).map((v) => [v.id, v]));
  const items: ReportItem[] = [];
  for (const h of history) {
    if (h.date < from || h.date > to) continue;
    const car = cars.get(h.vehicleId);
    items.push({ key: h.id, number: h.number, date: h.date, vehicle: car ? [car.make, car.model].filter(Boolean).join(' ') : h.vehicleText, plate: h.plate, ...typeOf(car), totalFils: h.totalFils, page: historyPageView(h, settings, customer) });
  }
  const invoices = orders.length ? await db.invoices.where('orderId').anyOf(orders.map((o) => o.id)).toArray() : [];
  for (const inv of invoices) {
    const day = dubaiDate(inv.issuedAt);
    if (inv.type === 'credit_note' || inv.status !== 'issued' || day < from || day > to) continue;
    const order = orders.find((o) => o.id === inv.orderId);
    const car = order && (cars.get(order.vehicleId) ?? (await db.vehicles.get(order.vehicleId)));
    items.push({ key: inv.id, number: inv.number, date: day, vehicle: car ? [car.make, car.model].filter(Boolean).join(' ') : '', plate: car ? carPlate(car.plate) : '', ...typeOf(car), totalFils: inv.totalFils, page: await invoicePageView(inv.id) });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number, 'en', { numeric: true }));
}

/** "OCTOBER 2026" for a whole month; else "01 MAY 2026 – 31 OCT 2026". */
export function periodTitle(from: string, to: string): { title: string; monthly: boolean } {
  const lastDay = new Date(Date.UTC(+to.slice(0, 4), +to.slice(5, 7), 0)).getUTCDate();
  const monthly = from.slice(0, 7) === to.slice(0, 7) && from.endsWith('-01') && Number(to.slice(8, 10)) === lastDay;
  if (monthly) return { title: new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${from}T00:00:00Z`)).toUpperCase(), monthly };
  const day = (d: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`)).toUpperCase();
  return { title: `${day(from)} – ${day(to)}`, monthly };
}

const COLS = [
  { key: 'no', en: 'No.', w: 30, right: false },
  { key: 'inv', en: 'INV NO.', w: 78, right: false },
  { key: 'date', en: 'INVOICE DATE', w: 82, right: false },
  { key: 'car', en: 'VEHICLE / MODEL', w: 160, right: false },
  { key: 'plate', en: 'PLATE NO.', w: 86, right: false },
  { key: 'amount', en: 'AMOUNT (AED)', w: 90, right: true },
] as const;

/** Rows on the summary's first page (under the letterhead) and on each page after it. */
const FIRST = 28;
const NEXT = 40;

function SummaryPage({ fam, settings, customer, title, rows, from, last, total, pageNo }: { fam: string; settings: Settings; customer: Customer; title: string; rows: { item: ReportItem; n: number }[]; from: number; last: boolean; total: number; pageNo: number }) {
  const cell = (c: (typeof COLS)[number], text: string, bold = false) => (
    <Text key={c.key} style={{ width: c.w, textAlign: c.right ? 'right' : 'left', paddingHorizontal: 4, fontWeight: bold ? 'bold' : 'normal' }} wrap={false}>
      {text}
    </Text>
  );
  return (
    <Page size="A4" style={{ fontFamily: fam, fontSize: 9, paddingTop: 36, paddingHorizontal: 34.5, paddingBottom: 46, color: '#000' }}>
      {pageNo === 1 ? (
        <>
          <GarageHeader s={settings} />
          <TitleBar en={title} ar="ملخص الفواتير" spaced={false} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, marginBottom: 10 }}>
            <Text style={{ fontSize: 11, fontWeight: 'bold' }}>{buyerName(customer)}</Text>
            {customer.trn ? <Text style={{ fontSize: 9.8 }}>{`TRN: ${customer.trn}`}</Text> : null}
          </View>
        </>
      ) : (
        <Text style={{ fontSize: 10, fontWeight: 'bold', marginBottom: 8 }}>{`${buyerName(customer)} · ${title}`}</Text>
      )}
      {/* The head row, on every page of the summary. */}
      <View style={{ flexDirection: 'row', backgroundColor: COLOR.head, color: '#fff', paddingVertical: 5, fontWeight: 'bold', fontSize: 8.5 }}>{COLS.map((c) => cell(c, c.en, true))}</View>
      {rows.map(({ item, n }, i) => (
        <View key={item.key} style={{ flexDirection: 'row', paddingVertical: 4, backgroundColor: (from + i) % 2 ? '#f3f5f8' : '#fff' }} wrap={false}>
          {cell(COLS[0], String(n))}
          {cell(COLS[1], item.number)}
          {cell(COLS[2], dayText(item.date))}
          {cell(COLS[3], item.vehicle.length > 34 ? `${item.vehicle.slice(0, 33)}…` : item.vehicle)}
          {cell(COLS[4], item.plate)}
          {cell(COLS[5], aed(item.totalFils).replace(/^-?AED\s/, (m) => (m.startsWith('-') ? '-' : '')))}
        </View>
      ))}
      {last ? (
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: COLOR.head, marginTop: 2, paddingVertical: 6 }} wrap={false}>
          <Text style={{ width: COLS.slice(0, 5).reduce((a, c) => a + c.w, 0), paddingHorizontal: 4, fontWeight: 'bold', fontSize: 10 }}>TOTAL AMOUNT</Text>
          <Text style={{ width: COLS[5].w, paddingHorizontal: 4, textAlign: 'right', fontWeight: 'bold', fontSize: 10 }}>{aed(total).replace(/^AED\s/, '')}</Text>
        </View>
      ) : null}
      <GarageFooter s={settings} />
    </Page>
  );
}

/** The report of a customer's period as a PDF: its summary, then each invoice (`items` — read already, for the Excel too). */
export async function renderCustomerReport(customerId: string, from: string, to: string, read?: ReportItem[]): Promise<{ blob: Blob; items: ReportItem[]; title: string }> {
  const [customer, settings, items] = await Promise.all([db.customers.get(customerId), getSettings(), read ?? reportItems(customerId, from, to)]);
  if (!customer) throw new Error('not found');
  const { title: period, monthly } = periodTitle(from, to);
  const title = `${monthly ? 'MONTHLY INVOICE SUMMARY' : 'INVOICE SUMMARY'} – ${period}`;
  const numbered = items.map((item, i) => ({ item, n: i + 1 }));
  const pages: (typeof numbered)[] = [numbered.slice(0, FIRST)];
  for (let i = FIRST; i < numbered.length; i += NEXT) pages.push(numbered.slice(i, i + NEXT));
  // The TOTAL row needs its place: a full last page sends it to one of its own.
  const lastCap = pages.length === 1 ? FIRST : NEXT;
  if (pages[pages.length - 1].length >= lastCap) pages.push([]);
  const total = items.reduce((a, i) => a + i.totalFils, 0);
  const blob = await renderDoc((fam) => (
    <Document title={`${buyerName(customer)} — ${title}`}>
      {pages.map((rows, p) => (
        <SummaryPage key={`s${p}`} fam={fam} settings={settings} customer={customer} title={title} rows={rows} from={p === 0 ? 0 : FIRST + (p - 1) * NEXT} last={p === pages.length - 1} total={total} pageNo={p + 1} />
      ))}
      {items.map((it) => (
        <InvoicePage key={it.key} fam={fam} v={it.page} />
      ))}
    </Document>
  ));
  return { blob, items, title };
}
