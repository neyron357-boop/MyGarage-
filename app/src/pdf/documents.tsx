import { Document, Font, Image, Page, pdf, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import { db } from '../db/db';
import { addDays, formatDate, formatDateTime, formatDocDate, nowIso } from '../domain/dates';
import { discountPctLabel, spreadDiscount } from '../domain/discount';
import { REQUIRED_SLOTS } from '../domain/inspection';
import { checkLabel, lightLabel } from '../domain/quickLists';
import { itemAmounts, itemTitle } from '../domain/items';
import { formatAed } from '../domain/money';
import { formatPhone } from '../domain/phone';
import { formatPlate, normalizePlate } from '../domain/plates';
import type { Report } from '../domain/reports';
import type { Customer, ExpenseCategory, Lang, Order, PayMethod, Settings, Vehicle } from '../domain/types';
import { tFor } from '../i18n';
import { mediaDataUrl } from '../services/media';
import { loadOrderBundle } from '../services/orders';
import { getSettings } from '../services/settings';
import tinosBold from './fonts/Tinos-Bold.ttf?url';
import tinosRegular from './fonts/Tinos-Regular.ttf?url';
import arabicBold from './fonts/MarkaziText-Bold.ttf?url';
import arabicRegular from './fonts/MarkaziText-Regular.ttf?url';
import { aed, AR_LABEL, BiLine, BlockLabel, Codes, COLOR, GarageFooter, GarageHeader, ItemsTable, Signatures, TitleBar, Totals, type DocRow } from './garage';

Font.registerHyphenationCallback((w) => [w]);

const s = StyleSheet.create({
  page: { fontSize: 9, paddingTop: 42, paddingHorizontal: 34.5, paddingBottom: 48, color: '#000' },
  row: { flexDirection: 'row' },
  between: { flexDirection: 'row', justifyContent: 'space-between' },
  h1: { fontSize: 15, fontWeight: 'bold', marginBottom: 2 },
  h2: { fontSize: 11, fontWeight: 'bold', marginTop: 10, marginBottom: 4 },
  muted: { color: '#666' },
  box: { borderWidth: 1, borderColor: '#ccc', borderRadius: 3, padding: 6, marginTop: 6 },
  th: { fontWeight: 'bold', backgroundColor: '#eef0f4', paddingVertical: 3, paddingHorizontal: 3 },
  td: { paddingVertical: 2, paddingHorizontal: 3, borderBottomWidth: 0.5, borderColor: '#ddd' },
  footer: { position: 'absolute', bottom: 18, left: 28, right: 28, fontSize: 7, color: '#777', flexDirection: 'row', justifyContent: 'space-between' },
  photo: { width: 120, height: 90, objectFit: 'cover', marginRight: 6, marginBottom: 2 },
  bold: { fontWeight: 'bold' },
});

/** Arabic titles of the documents that are not invoices or quotations. */
const AR_TITLE = {
  intake: 'تقرير استلام المركبة',
  handover: 'تقرير تسليم المركبة',
  receipt: 'إيصال استلام دفعة',
  debt: 'إقرار بالمديونية',
  report: 'تقرير',
};

/** The garage's header (English · logo · Arabic) and grey title bar, then the document's own line. */
function Header({ settings, title, ar, sub, right, compact }: { settings: Settings; title: string; ar: string; sub?: string; right?: ReactNode; compact?: boolean }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <GarageHeader s={settings} compact={compact} />
      <TitleBar en={title.toUpperCase()} ar={ar} />
      {(sub || right) && (
        <View style={[s.between, { marginTop: 6 }]}>
          <Text style={{ fontSize: 9 }}>{settings.trn ? `TRN: ${settings.trn}` : ''}</Text>
          <View style={{ alignItems: 'flex-end' }}>
            {sub ? <Text style={{ fontSize: 9 }}>{sub}</Text> : null}
            {right}
          </View>
        </View>
      )}
    </View>
  );
}

/** Page footer of the multi-page documents: the garage's thank-you line and page numbers. */
function Footer({ settings, lang }: { settings: Settings; lang: Lang }) {
  return (
    <View style={[s.footer, { borderTopWidth: 0.75, borderColor: COLOR.rowRule, paddingTop: 3, color: COLOR.footer, fontSize: 6.8 }]} fixed>
      <Text>
        {settings.name}: {settings.docFooter[lang] ?? ''}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

function Parties({ customer, vehicle, order, lang }: { customer: Customer; vehicle: Vehicle; order: Order; lang: Lang }) {
  const t = tFor(lang);
  return (
    <View style={[s.row, { gap: 8 }]}>
      <View style={[s.box, { flex: 1 }]}>
        <Text style={s.muted}>{t('pdf.customer')}</Text>
        <Text style={s.bold}>{customer.type === 'company' && customer.companyName ? `${customer.companyName} (${customer.name})` : customer.name}</Text>
        <Text>{formatPhone(customer.phone)}</Text>
        {customer.trn ? <Text>TRN: {customer.trn}</Text> : null}
      </View>
      <View style={[s.box, { flex: 1 }]}>
        <Text style={s.muted}>{t('pdf.vehicle')} · №{order.number}</Text>
        <Text style={s.bold}>{vehicle.make} {vehicle.model} {vehicle.year ?? ''}</Text>
        <Text>{formatPlate(vehicle.plate, lang)}</Text>
        {vehicle.vin ? <Text>VIN: {vehicle.vin}</Text> : null}
      </View>
    </View>
  );
}

let queue: Promise<unknown> = Promise.resolve();
let fontSeq = 0;

/**
 * Each document gets its own freshly registered font family: reusing one font object between
 * documents makes react-pdf drop glyphs that an earlier document already used ("AED" became "ED").
 * Rendering is serialized so documents never share a font object.
 */
function render(build: (fontFamily: string) => ReactNode): Promise<Blob> {
  const run = queue.then(() => {
    fontSeq += 1;
    // Times-like text (Tinos) with Arabic (Markazi Text) as the fallback for Arabic letters.
    const latin = `Tinos${fontSeq}`;
    const arabic = `Arabic${fontSeq}`;
    Font.register({ family: latin, fonts: [{ src: tinosRegular }, { src: tinosBold, fontWeight: 'bold' }] });
    Font.register({ family: arabic, fonts: [{ src: arabicRegular }, { src: arabicBold, fontWeight: 'bold' }] });
    return pdf(build([latin, arabic] as unknown as string) as React.ReactElement).toBlob();
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function renderInspection(inspectionId: string): Promise<Blob> {
  const insp = await db.inspections.get(inspectionId);
  if (!insp) throw new Error('not found');
  const b = (await loadOrderBundle(insp.orderId))!;
  const lang = insp.language;
  const t = tFor(lang);
  const media = await db.media.where('ownerId').equals(insp.id).toArray();
  const marks = b.marks.filter((m) => m.inspectionId === insp.id);
  const photos = media.filter((m) => m.kind === 'photo');
  const ordered = [...photos].sort((a, c) => {
    const ia = (REQUIRED_SLOTS as readonly string[]).indexOf(a.slot);
    const ic = (REQUIRED_SLOTS as readonly string[]).indexOf(c.slot);
    return (ia < 0 ? 99 : ia) - (ic < 0 ? 99 : ic);
  });
  const thumbs = await Promise.all(ordered.map(async (m) => ({ m, url: await mediaDataUrl(m.id, true) })));
  const sig = insp.signatureMediaId ? await mediaDataUrl(insp.signatureMediaId, false) : undefined;
  const intake = insp.kind === 'intake';
  const c = insp.conditions;
  // Checks and lights are the words of the garage's lists (older reports: built-in codes, translated).
  const tl = (k: string, o?: { defaultValue?: string }) => String(t(k, o));
  const fails = Object.entries(insp.functionChecks).filter(([, v]) => v === 'fail').map(([k]) => checkLabel(tl, k));
  const oks = Object.entries(insp.functionChecks).filter(([, v]) => v === 'ok').map(([k]) => checkLabel(tl, k));
  const approved = b.items.filter((i) => i.approvalState === 'approved');
  const declined = b.items.filter((i) => i.approvalState === 'declined');
  const declinedAt = (id: string) => b.decisions.filter((d) => d.itemId === id && d.decision === 'decline').pop()?.decidedAt;
  const warranty = (b.settings.warrantyText[lang] ?? '').replace('{months}', String(b.settings.warrantyLaborMonths)).replace('{km}', String(b.settings.warrantyLaborKm));
  return render((fam) => (
    <Document title={`${t(intake ? 'pdf.intakeTitle' : 'pdf.handoverTitle')} ${b.order.number}`}>
      <Page size="A4" style={[s.page, { fontFamily: fam }]}>
        <Header settings={b.settings} title={t(intake ? 'pdf.intakeTitle' : 'pdf.handoverTitle')} ar={intake ? AR_TITLE.intake : AR_TITLE.handover} sub={`№${b.order.number} · ${formatDateTime(insp.signedAt ?? insp.createdAt)}`} />
        <Parties customer={b.customer} vehicle={b.vehicle} order={b.order} lang={lang} />
        <View style={s.box}>
          <Text>{t('intake.mileage')}: <Text style={s.bold}>{insp.mileageKm !== undefined ? `${insp.mileageKm.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US').replace(/\u00a0/g, ' ')} ${t('unit.km')}` : '—'}</Text> · {t('intake.fuel')}: <Text style={s.bold}>{insp.fuelLevel !== undefined ? t(`fuel.${insp.fuelLevel}`) : '—'}</Text></Text>
          <Text>{t('intake.lights')}: {insp.warningLights.length ? insp.warningLights.map((l) => lightLabel(tl, l)).join(', ') : t('pdf.none')}</Text>
          {intake && <Text>OBD: {insp.obdNoCodes ? t('intake.obdNone') : insp.obdCodes.join(', ') || `${t('pdf.skipped')}: ${insp.obdSkipReason ?? ''}`}</Text>}
          {intake && <Text>{t('pdf.working')}: {oks.join(', ') || '—'}</Text>}
          {intake && <Text>{t('pdf.notWorking')}: {fails.join(', ') || t('pdf.none')}</Text>}
          {intake && <Text>{t('intake.keys')}: {insp.keysCount ?? '—'} · {t('intake.spareWheel')}: {insp.spareWheel ? t('common.yes') : t('common.no')} · {t('intake.jack')}: {insp.jack ? t('common.yes') : t('common.no')} · Mulkiya: {insp.mulkiyaInCar ? t('common.yes') : t('common.no')}</Text>}
          {intake && <Text>{t('intake.belongings')}: {insp.belongings || t('pdf.none')}</Text>}
          {intake && <Text>{t('order.complaint')}: {insp.complaint}</Text>}
          {intake && insp.accidentRepair && <Text>{t('intake.policeReport')}: {insp.policeReportNo}</Text>}
          {!intake && b.order.testDriveStartKm !== undefined && <Text>{t('qc.testDrive')}: {b.order.testDriveStartKm} → {b.order.testDriveEndKm ?? '—'} {t('unit.km')}</Text>}
        </View>
        {intake && (
          <>
            <Text style={s.h2}>{t('pdf.damage')}</Text>
            {insp.noDamage ? <Text>{t('damage.none')}</Text> : marks.map((m, i) => <Text key={m.id}>{i + 1}. {t(`damage.type.${m.type}`)} — {t(`damage.view.${m.view}`)}{m.note ? ` — ${m.note}` : ''}</Text>)}
          </>
        )}
        {!intake && (
          <>
            <Text style={s.h2}>{t('handover.done')}</Text>
            {approved.map((i) => (
              <View key={i.id} style={s.between}>
                <Text>• {itemTitle(i, lang)}{i.partNumber ? ` (${i.partNumber})` : ''}{i.customerSupplied ? ` — ${t('item.customerSupplied')}` : ''}</Text>
                <Text>{formatAed(itemAmounts(i).gross, lang)}</Text>
              </View>
            ))}
            {declined.length > 0 && (
              <>
                <Text style={s.h2}>{t('handover.declined')}</Text>
                {declined.map((i) => <Text key={i.id}>• {itemTitle(i, lang)} — {t('handover.declinedOn', { date: formatDate(declinedAt(i.id)) })}</Text>)}
              </>
            )}
            {b.intake?.conditions?.oldParts && <Text style={{ marginTop: 6 }}>{t('cond.oldParts')}: {t(`cond.${b.intake.conditions.oldParts}`)}</Text>}
            <Text style={[s.box, { fontSize: 8 }]}>{warranty}</Text>
          </>
        )}
        <Text style={s.h2}>{t('pdf.photos')} ({photos.length})</Text>
        <View style={[s.row, { flexWrap: 'wrap' }]}>
          {thumbs.map(({ m, url }) =>
            url ? (
              <View key={m.id} wrap={false} style={{ marginBottom: 4 }}>
                <Image src={url} style={s.photo} />
                <Text style={{ fontSize: 6.5, color: '#555' }}>{t(`slot.${m.slot}`, { defaultValue: m.slot })} · {formatDateTime(m.createdAt)}</Text>
              </View>
            ) : null,
          )}
        </View>
        {Object.keys(insp.skippedPhotos).length > 0 && (
          <Text style={s.muted}>{t('pdf.skippedPhotos')}: {Object.entries(insp.skippedPhotos).map(([k, v]) => `${t(`slot.${k}`)} — ${v}`).join('; ')}</Text>
        )}
        {intake && c && (
          <View style={s.box} wrap={false}>
            <Text style={s.bold}>{t('pdf.conditions')}</Text>
            {/* No-call limit, old parts and parking/diagnostics fees exist only on acts signed before the fast check-in. */}
            {c.noCallLimitFils !== undefined && <Text>{t('cond.noCallLimit')}: {c.noCallLimitFils ? formatAed(c.noCallLimitFils, lang) : t('cond.alwaysCall')}</Text>}
            <Text>
              {c.oldParts ? `${t('cond.oldParts')}: ${t(`cond.${c.oldParts}`)} · ` : ''}
              {t('cond.testDrive')}: {c.testDriveAllowed ? t('common.yes') : t('common.no')}
            </Text>
            {c.freeStorageDays !== undefined && (
              <Text>
                {t('cond.freeStorage')}: {c.freeStorageDays} · {t('cond.storageFee')}: {formatAed(c.storageFeePerDayFils ?? 0, lang)} · {t('cond.diagnosticsFee')}: {formatAed(c.diagnosticsFeeFils ?? 0, lang)}
              </Text>
            )}
            {(b.order.promisedReadyAt ?? c.promisedReadyAt) && <Text>{t('cond.promised')}: {formatDateTime(new Date((b.order.promisedReadyAt ?? c.promisedReadyAt)!).toISOString())}</Text>}
            <Text style={{ marginTop: 4, fontSize: 7.5, color: '#444' }}>{b.settings.intakeTerms[lang]}</Text>
          </View>
        )}
        {!intake && <Text style={[s.box, { fontSize: 8 }]}>{t('pdf.handoverStatement')}</Text>}
        <View style={[s.between, { marginTop: 10 }]} wrap={false}>
          <View>
            <Text>{t('sign.signedBy')}: <Text style={s.bold}>{insp.signerName ?? '—'}</Text></Text>
            <Text style={s.muted}>{formatDateTime(insp.signedAt)}</Text>
          </View>
          {sig && <Image src={sig} style={{ width: 160, height: 60, objectFit: 'contain' }} />}
        </View>
        <Text style={{ marginTop: 8, fontSize: 6, color: '#999' }}>{t('pdf.hashes')}: {media.filter((m) => m.kind !== 'pdf').map((m) => `${m.slot}:${m.sha256.slice(0, 12)}`).join(' ')}</Text>
        <Footer settings={b.settings} lang={lang} />
      </Page>
    </Document>
  ));
}

/* ---------------- Quotation and tax invoice, as the garage's own documents ---------------- */

const METHOD_EN: Record<PayMethod, string> = { cash: 'Cash', card: 'Card', transfer: 'Bank transfer' };

/** "CC 78728", "5 / 87920" (a number code, as Abu Dhabi plates were written there). */
const plateText = (v: Vehicle) => {
  const p = normalizePlate(v.plate);
  return [p.code, p.number].filter(Boolean).join(/^\d+$/.test(p.code) ? ' / ' : ' ');
};

function SellerBlock({ s, lines }: { s: { name: string; phone?: string; email?: string; trn?: string }; lines: ReactNode }) {
  return (
    <View style={{ width: 290, paddingLeft: 3.7 }}>
      <BlockLabel en="SELLER" ar={AR_LABEL.seller} />
      <Text style={{ fontSize: 12, marginBottom: 5 }}>{s.name}</Text>
      {s.phone ? <BiLine en="Telephone" ar={AR_LABEL.telephone} value={formatPhone(s.phone)} /> : null}
      {s.email ? <BiLine en="Email" ar={AR_LABEL.email} value={s.email} /> : null}
      <BiLine en="Tax ID" ar={AR_LABEL.taxId} value={`(TRN): ${s.trn || '—'}`} colon={false} />
      {lines}
    </View>
  );
}

/** "BILL TO" / "QUOTATION TO": the customer and the car, right-aligned. */
function CustomerBlock({ en, ar, party, vehicle }: { en: string; ar: string; party: { name: string; phone?: string; email?: string; trn?: string; address?: string }; vehicle: Vehicle }) {
  const car = [vehicle.make, vehicle.model].filter(Boolean).join(' ');
  const plate = plateText(vehicle);
  return (
    <View style={{ width: 236, alignItems: 'flex-end', paddingRight: 3.7 }}>
      <BlockLabel en={en} ar={ar} right />
      <Text style={{ fontSize: 12, textAlign: 'right', marginBottom: 3 }}>{party.name || '—'}</Text>
      {party.phone ? <Text style={{ fontSize: 9.8, marginBottom: 3 }}>{formatPhone(party.phone)}</Text> : null}
      {party.email ? <Text style={{ fontSize: 9.8, marginBottom: 3 }}>{party.email}</Text> : null}
      {party.trn ? <BiLine right en="Tax ID" ar={AR_LABEL.taxId} value={`(TRN): ${party.trn}`} colon={false} /> : null}
      {party.address ? <Text style={{ fontSize: 9, textAlign: 'right', marginBottom: 3 }}>{party.address}</Text> : null}
      {car ? <Text style={{ fontSize: 9, marginTop: 3, marginBottom: 3 }}>{car}</Text> : null}
      {plate ? <BiLine right en="PLATE" ar={AR_LABEL.plate} value={plate} /> : null}
      {vehicle.vin ? <BiLine right en="VIN / Chassis Num  (VIN)" ar={AR_LABEL.vin} value={vehicle.vin} /> : null}
    </View>
  );
}

/** Customer of a quotation (the invoice keeps its own snapshot of the buyer). */
const partyOf = (c: Customer) => ({ name: c.type === 'company' && c.companyName ? c.companyName : c.name, phone: c.phone, email: c.email, trn: c.trn, address: c.address });

function QuotationDocument({ fam, settings, customer, vehicle, number, date, validUntil, rows, totals, note }: {
  fam: string;
  settings: Settings;
  customer: Customer;
  vehicle: Vehicle;
  number: string;
  date: string;
  validUntil?: string;
  rows: DocRow[];
  /** gross: the total; subtotal and discount: before the discount and the discount (negative), if any. */
  totals: { gross: number; vat: number; text?: string; subtotal?: number; discount?: number; discountLabel?: string };
  note?: string;
}) {
  const party = partyOf(customer);
  return (
    <Page size="A4" style={[s.page, { fontFamily: fam }]}>
      <GarageHeader s={settings} />
      <TitleBar en="Quotation" ar={AR_LABEL.quotation} spaced={false} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
        <SellerBlock
          s={settings}
          lines={
            <>
              <BiLine en="Quotation Number" ar={AR_LABEL.quotationNumber} value={number} />
              <BiLine en="Date" ar={AR_LABEL.date} value={formatDocDate(date)} />
              {validUntil ? <BiLine en="Valid until" ar={AR_LABEL.validUntil} value={formatDate(validUntil)} /> : null}
            </>
          }
        />
        <CustomerBlock en="QUOTATION TO" ar={AR_LABEL.quotationTo} party={party} vehicle={vehicle} />
      </View>
      <ItemsTable rows={rows} />
      <Totals
        qty={rows.reduce((a, r) => a + (r.total < 0 ? 0 : r.qty), 0)}
        subtotal={totals.subtotal ?? totals.gross}
        discount={totals.discount}
        discountLabel={totals.discountLabel}
        vat={totals.vat}
        total={totals.gross}
        totalText={totals.text}
        notes={note ? <Text style={{ fontSize: 8, color: COLOR.head, marginTop: 2 }}>{note}</Text> : undefined}
      />
      <Signatures company={settings.name} customer={party.name || '—'} />
      <GarageFooter s={settings} />
    </Page>
  );
}

/** Quotation of a sent estimate version (detailed path): its frozen lines and prices. */
export async function renderVersion(versionId: string): Promise<Blob> {
  const v = await db.versions.get(versionId);
  if (!v) throw new Error('not found');
  const b = (await loadOrderBundle(v.orderId))!;
  const t = tFor(v.language);
  const ranged = (i: (typeof v.items)[number]) => i.minGross !== undefined && i.maxGross !== undefined && i.minGross !== i.maxGross;
  // The discount sits on the lines (Discount column) and once in the totals, as on the garage's invoices.
  const spread = spreadDiscount(v.items, (i) => !ranged(i));
  const rows: DocRow[] = [
    ...spread.lines.map(({ line: i, discount, vat, gross }) =>
      ranged(i)
        ? { description: i.title, qty: i.qty, total: i.maxGross!, totalText: `${aed(i.minGross!)} – ${formatAed(i.maxGross!, 'en', false)}` }
        : { description: i.title + (i.customerSupplied ? ' (customer supplied part)' : ''), price: Math.round(i.net / (i.qty || 1)), discount, vat, qty: i.qty, total: gross },
    ),
    ...spread.rest.map((i) => ({ description: i.title, price: Math.round(i.net / (i.qty || 1)), vat: i.vat, qty: i.qty, total: i.gross })),
  ];
  const vat = rows.reduce((a, r) => a + (r.vat ?? 0), 0);
  const discountLabel = discountPctLabel(v.items.filter((i) => i.kind === 'discount').map((i) => i.title));
  const upTo = v.maxGross !== v.fixedGross;
  const note = [v.reason, v.items.some((i) => i.block === 'B') ? t('msg.bExplain') : ''].filter(Boolean).join(' ');
  return render((fam) => (
    <Document title={`Quotation ${b.order.number}${v.number > 1 ? `-v${v.number}` : ''}`}>
      <QuotationDocument
        fam={fam}
        settings={b.settings}
        customer={b.customer}
        vehicle={b.vehicle}
        number={`${b.order.number}${v.number > 1 ? `-v${v.number}` : ''}`}
        date={v.sentAt}
        validUntil={v.validUntil}
        rows={rows}
        totals={{ gross: v.fixedGross, vat, subtotal: v.fixedGross - spread.discount, discount: spread.discount, discountLabel, text: upTo ? `${aed(v.fixedGross)} – ${formatAed(v.maxGross, 'en', false)}` : undefined }}
        note={note || undefined}
      />
    </Document>
  ));
}

/** Quotation of the job's current lines (quick path), before the invoice is issued. */
export async function renderQuotation(orderId: string): Promise<Blob> {
  const b = (await loadOrderBundle(orderId))!;
  const items = b.items.filter((i) => ['draft', 'pending', 'approved'].includes(i.approvalState));
  const spread = spreadDiscount(items.map((i) => ({ ...itemAmounts(i), kind: i.kind, vatRateBp: i.vatRateBp, item: i })));
  const rows: DocRow[] = [
    ...spread.lines.map(({ line: { item: i }, discount, vat, gross }) => ({ description: itemTitle(i, 'en') + (i.customerSupplied ? ' (customer supplied part)' : ''), price: i.customerSupplied ? 0 : i.unitPriceFils, discount, vat, qty: i.qty, total: gross })),
    ...spread.rest.map(({ item: i, vat, gross }) => ({ description: itemTitle(i, 'en'), price: -Math.abs(i.unitPriceFils), vat, qty: i.qty, total: gross })),
  ];
  const gross = rows.reduce((x, r) => x + r.total, 0);
  const vat = rows.reduce((x, r) => x + (r.vat ?? 0), 0);
  const discountLabel = discountPctLabel(items.filter((i) => i.kind === 'discount').map((i) => itemTitle(i, 'en')));
  const now = nowIso();
  return render((fam) => (
    <Document title={`Quotation ${b.order.number}`}>
      <QuotationDocument
        fam={fam}
        settings={b.settings}
        customer={b.customer}
        vehicle={b.vehicle}
        number={String(b.order.number)}
        date={now}
        validUntil={addDays(now, b.settings.estimateValidityDays)}
        rows={rows}
        totals={{ gross, vat, subtotal: spread.subtotal, discount: spread.discount, discountLabel }}
      />
    </Document>
  ));
}

/**
 * Tax invoice (and credit note) as the garage's own: seller with TRN, invoice and job numbers,
 * the customer with the car, lines with price excl. VAT, their part of the discount and VAT, totals incl.
 * VAT (Subtotal − Discount = Total), barcodes and a QR code with the invoice summary. Always in English
 * with Arabic labels (UAE tax invoice).
 */
export async function renderInvoice(invoiceId: string): Promise<Blob> {
  const inv = await db.invoices.get(invoiceId);
  if (!inv) throw new Error('not found');
  const b = (await loadOrderBundle(inv.orderId))!;
  const credit = inv.type === 'credit_note';
  const original = inv.originalInvoiceId ? await db.invoices.get(inv.originalInvoiceId) : undefined;
  // The seller as it was when the invoice was issued; Arabic name/address from settings for older invoices.
  const seller = { ...inv.seller, nameAr: inv.seller.nameAr ?? b.settings.nameAr, addressAr: inv.seller.addressAr ?? b.settings.addressAr };
  const head: Settings = { ...b.settings, name: seller.name, address: seller.address ?? '', phone: seller.phone ?? '', nameAr: seller.nameAr, addressAr: seller.addressAr };
  const spread = spreadDiscount(inv.lines);
  const rows: DocRow[] = [
    ...spread.lines.map(({ line: l, discount, vat, gross }) => ({
      description: l.description + (l.customerSupplied ? ' (customer supplied part)' : ''),
      price: l.unitPriceFils,
      discount,
      vat,
      qty: l.qty,
      total: gross,
    })),
    ...spread.rest.map((l) => ({ description: l.description, price: l.unitPriceFils, vat: l.vat, qty: l.qty, total: l.gross })),
  ];
  const discountLabel = discountPctLabel(inv.lines.filter((l) => l.kind === 'discount').map((l) => l.description));
  const qty = inv.lines.filter((l) => l.kind !== 'discount').reduce((a, l) => a + l.qty, 0);
  const methods = [...new Set(b.payments.filter((p) => p.kind !== 'refund').map((p) => METHOD_EN[p.method]))].join(', ');
  const qrText = [seller.name, `TRN ${seller.trn || '-'}`, `${credit ? 'Tax Credit Note' : 'Tax Invoice'} ${inv.number}`, formatDocDate(inv.issuedAt), `Total ${aed(inv.totalFils)}`, `VAT ${aed(inv.vatFils)}`].join('\n');
  return render((fam) => (
    <Document title={inv.number}>
      <Page size="A4" style={[s.page, { fontFamily: fam }]}>
        <GarageHeader s={head} />
        <TitleBar en={credit ? 'TAX CREDIT NOTE' : 'TAX INVOICE'} ar={credit ? AR_LABEL.creditNote : AR_LABEL.taxInvoice} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
          <SellerBlock
            s={seller}
            lines={
              <>
                <BiLine en={credit ? 'Credit Note Number' : 'Invoice Number'} ar={credit ? AR_LABEL.creditNumber : AR_LABEL.invoiceNumber} value={inv.number} />
                {original ? <BiLine en="Reference" ar={AR_LABEL.reference} value={`${original.number}${inv.reason ? ` — ${inv.reason}` : ''}`} /> : null}
                <BiLine en="Order#" ar={AR_LABEL.order} value={String(b.order.number)} />
                <BiLine en="Date" ar={AR_LABEL.date} value={formatDocDate(inv.issuedAt)} />
              </>
            }
          />
          <CustomerBlock en="BILL TO" ar={AR_LABEL.billTo} party={inv.buyer} vehicle={b.vehicle} />
        </View>
        <ItemsTable rows={rows} />
        <Totals
          qty={qty}
          subtotal={spread.subtotal}
          discount={spread.discount}
          discountLabel={discountLabel}
          vat={inv.vatFils}
          total={inv.totalFils}
          notes={
            <>
              {methods ? <BiLine en="Payment method" ar={AR_LABEL.paymentMethod} value={methods} color={COLOR.head} /> : null}
              {b.settings.bankDetails ? <Text style={{ fontSize: 8, color: COLOR.head, marginTop: 2 }}>{b.settings.bankDetails}</Text> : null}
            </>
          }
        />
        <Codes jobNo={String(b.order.number)} invoiceNo={inv.number} qrText={qrText} />
        <GarageFooter s={head} />
      </Page>
    </Document>
  ));
}

export async function renderReceipt(paymentId: string): Promise<Blob> {
  const p = await db.payments.get(paymentId);
  if (!p) throw new Error('not found');
  const b = (await loadOrderBundle(p.orderId))!;
  const lang = b.order.docLanguage;
  const t = tFor(lang);
  return render((fam) => (
    <Document title={p.receiptNumber}>
      <Page size="A5" style={[s.page, { fontFamily: fam }]}>
        <Header settings={b.settings} compact title={t('pdf.receiptTitle')} ar={AR_TITLE.receipt} sub={`${p.receiptNumber} · ${formatDateTime(p.receivedAt)}`} />
        <Parties customer={b.customer} vehicle={b.vehicle} order={b.order} lang={lang} />
        <View style={[s.box, { marginTop: 10 }]}>
          <View style={s.between}><Text>{t(`payment.kind.${p.kind}`)} · {t(`payment.method.${p.method}`)}</Text><Text style={[s.bold, { fontSize: 13 }]}>{formatAed(p.amountFils, lang)}</Text></View>
          {p.reference ? <Text>{t('payment.reference')}: {p.reference}</Text> : null}
        </View>
        <Footer settings={b.settings} lang={lang} />
      </Page>
    </Document>
  ));
}

export async function renderDebt(debtId: string): Promise<Blob> {
  const d = await db.debts.get(debtId);
  if (!d) throw new Error('not found');
  const b = (await loadOrderBundle(d.orderId))!;
  const lang = b.order.docLanguage;
  const t = tFor(lang);
  const sig = await mediaDataUrl(d.signatureMediaId, false);
  return render((fam) => (
    <Document title="debt">
      <Page size="A5" style={[s.page, { fontFamily: fam }]}>
        <Header settings={b.settings} compact title={t('pdf.debtTitle')} ar={AR_TITLE.debt} sub={formatDateTime(d.signedAt)} />
        <Parties customer={b.customer} vehicle={b.vehicle} order={b.order} lang={lang} />
        <Text style={[s.box, { marginTop: 10 }]}>{t('pdf.debtText', { name: b.customer.name, amount: formatAed(d.amountFils, lang), date: formatDate(d.dueDate), number: b.order.number })}</Text>
        {sig && <Image src={sig} style={{ width: 160, height: 60, objectFit: 'contain', marginTop: 10 }} />}
        <Text>{b.customer.name}</Text>
        <Footer settings={b.settings} lang={lang} />
      </Page>
    </Document>
  ));
}

export async function renderReport(r: Report, from: string, to: string, lang: Lang, cats: ExpenseCategory[]): Promise<Blob> {
  const settings = await getSettings();
  const t = tFor(lang);
  const row = (label: string, value: string, strong = false) => (
    <View style={[s.between, s.td]}>
      <Text style={strong ? s.bold : undefined}>{label}</Text>
      <Text style={strong ? s.bold : undefined}>{value}</Text>
    </View>
  );
  const a = (f: number) => formatAed(f, lang);
  return render((fam) => (
    <Document title="report">
      <Page size="A4" style={[s.page, { fontFamily: fam }]}>
        <Header settings={settings} title={t('report.title')} ar={AR_TITLE.report} sub={`${formatDate(from)} – ${formatDate(to)}`} />
        {row(t('report.received'), String(r.ordersReceived))}
        {row(t('report.delivered'), String(r.ordersDelivered))}
        {row(t('report.revenueGross'), a(r.revenueGross), true)}
        {row(t('report.revenueNet'), a(r.revenueNet))}
        {row(`  ${t('item.kind.labor')}`, a(r.laborNet))}
        {row(`  ${t('item.kind.part')}`, a(r.partsNet))}
        {row(`  ${t('report.other')}`, a(r.otherNet))}
        {row(t('report.partsCost'), a(r.partsCostNet))}
        {r.otherIncome > 0 && row(t('report.otherIncome'), a(r.otherIncome))}
        {row(t('report.expensesNet'), a(r.expensesNet))}
        {row(t('report.grossProfit'), a(r.grossProfit), true)}
        {row(t('report.avgTicket'), a(r.averageTicketGross))}
        {row(t('report.vatOutput'), a(r.vatOutput))}
        {row(t('report.vatInput'), a(r.vatInput))}
        {row(t('report.vatPayable'), a(r.vatOutput - r.vatInput), true)}
        {row(t('payment.method.cash'), a(r.payments.cash))}
        {row(t('payment.method.card'), a(r.payments.card))}
        {row(t('payment.method.transfer'), a(r.payments.transfer))}
        {row(t('report.cashDiff'), a(r.cashDiffFils))}
        <Text style={s.h2}>{t('expense.byCategory')}</Text>
        {r.expensesByCategory.map((c) => {
          const cat = cats.find((x) => x.id === c.categoryId);
          return <View key={c.categoryId}>{row(cat ? (lang === 'ru' ? cat.nameRu : cat.nameEn) : c.categoryId, a(c.gross))}</View>;
        })}
        <Text style={[s.muted, { marginTop: 8 }]}>{t('report.note')}</Text>
        <Footer settings={settings} lang={lang} />
      </Page>
    </Document>
  ));
}
