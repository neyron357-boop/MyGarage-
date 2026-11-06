import { Document, Font, Image, Page, pdf, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import { db } from '../db/db';
import { formatDate, formatDateTime } from '../domain/dates';
import { REQUIRED_SLOTS } from '../domain/inspection';
import { paidNet } from '../domain/invoice';
import { itemAmounts, itemTitle } from '../domain/items';
import { formatAed } from '../domain/money';
import { formatPhone } from '../domain/phone';
import { formatPlate } from '../domain/plates';
import type { Report } from '../domain/reports';
import type { Customer, ExpenseCategory, Lang, Order, Settings, Vehicle } from '../domain/types';
import { tFor } from '../i18n';
import { mediaDataUrl } from '../services/media';
import { loadOrderBundle } from '../services/orders';
import { getSettings } from '../services/settings';
import bold from './fonts/NotoSans-Bold.ttf?url';
import regular from './fonts/NotoSans-Regular.ttf?url';

Font.registerHyphenationCallback((w) => [w]);

const s = StyleSheet.create({
  page: { fontSize: 9, padding: 28, paddingBottom: 48, color: '#111' },
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

function Header({ settings, title, sub, right }: { settings: Settings; title: string; sub?: string; right?: ReactNode }) {
  return (
    <View style={[s.between, { marginBottom: 8, borderBottomWidth: 1.5, borderColor: '#3f5be9', paddingBottom: 6 }]}>
      <View style={s.row}>
        {settings.logoDataUrl && <Image src={settings.logoDataUrl} style={{ width: 48, height: 48, objectFit: 'contain', marginRight: 8 }} />}
        <View>
          <Text style={[s.bold, { fontSize: 12 }]}>{settings.name}</Text>
          {settings.address ? <Text style={s.muted}>{settings.address}</Text> : null}
          <Text style={s.muted}>{[settings.phone && formatPhone(settings.phone), settings.email].filter(Boolean).join(' · ')}</Text>
          {settings.trn ? <Text style={s.muted}>TRN: {settings.trn}</Text> : null}
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', maxWidth: 240 }}>
        <Text style={s.h1}>{title}</Text>
        {sub ? <Text>{sub}</Text> : null}
        {right}
      </View>
    </View>
  );
}

function Footer({ settings, lang }: { settings: Settings; lang: Lang }) {
  return (
    <View style={s.footer} fixed>
      <Text>{settings.docFooter[lang] ?? ''}</Text>
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
    const family = `Noto${fontSeq}`;
    Font.register({ family, fonts: [{ src: regular }, { src: bold, fontWeight: 'bold' }] });
    return pdf(build(family) as React.ReactElement).toBlob();
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
  const fails = Object.entries(insp.functionChecks).filter(([, v]) => v === 'fail').map(([k]) => t(`check.${k}`));
  const oks = Object.entries(insp.functionChecks).filter(([, v]) => v === 'ok').map(([k]) => t(`check.${k}`));
  const approved = b.items.filter((i) => i.approvalState === 'approved');
  const declined = b.items.filter((i) => i.approvalState === 'declined');
  const declinedAt = (id: string) => b.decisions.filter((d) => d.itemId === id && d.decision === 'decline').pop()?.decidedAt;
  const warranty = (b.settings.warrantyText[lang] ?? '').replace('{months}', String(b.settings.warrantyLaborMonths)).replace('{km}', String(b.settings.warrantyLaborKm));
  return render((fam) => (
    <Document title={`${t(intake ? 'pdf.intakeTitle' : 'pdf.handoverTitle')} ${b.order.number}`}>
      <Page size="A4" style={[s.page, { fontFamily: fam }]}>
        <Header settings={b.settings} title={t(intake ? 'pdf.intakeTitle' : 'pdf.handoverTitle')} sub={`№${b.order.number} · ${formatDateTime(insp.signedAt ?? insp.createdAt)}`} />
        <Parties customer={b.customer} vehicle={b.vehicle} order={b.order} lang={lang} />
        <View style={s.box}>
          <Text>{t('intake.mileage')}: <Text style={s.bold}>{insp.mileageKm !== undefined ? `${insp.mileageKm.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US').replace(/\u00a0/g, ' ')} ${t('unit.km')}` : '—'}</Text> · {t('intake.fuel')}: <Text style={s.bold}>{insp.fuelLevel !== undefined ? t(`fuel.${insp.fuelLevel}`) : '—'}</Text></Text>
          <Text>{t('intake.lights')}: {insp.warningLights.length ? insp.warningLights.map((l) => t(`light.${l}`)).join(', ') : t('pdf.none')}</Text>
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
            <Text style={{ marginTop: 6 }}>{t('cond.oldParts')}: {t(`cond.${b.intake?.conditions?.oldParts ?? 'return'}`)}</Text>
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
            <Text>{t('cond.noCallLimit')}: {c.noCallLimitFils ? formatAed(c.noCallLimitFils, lang) : t('cond.alwaysCall')}</Text>
            <Text>{t('cond.oldParts')}: {t(`cond.${c.oldParts}`)} · {t('cond.testDrive')}: {c.testDriveAllowed ? t('common.yes') : t('common.no')}</Text>
            <Text>{t('cond.freeStorage')}: {c.freeStorageDays} · {t('cond.storageFee')}: {formatAed(c.storageFeePerDayFils, lang)} · {t('cond.diagnosticsFee')}: {formatAed(c.diagnosticsFeeFils, lang)}</Text>
            {c.promisedReadyAt && <Text>{t('cond.promised')}: {formatDateTime(new Date(c.promisedReadyAt).toISOString())}</Text>}
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

export async function renderVersion(versionId: string): Promise<Blob> {
  const v = await db.versions.get(versionId);
  if (!v) throw new Error('not found');
  const b = (await loadOrderBundle(v.orderId))!;
  const lang = v.language;
  const t = tFor(lang);
  const thumbs = (await Promise.all(v.mediaIds.map((id) => mediaDataUrl(id, true)))).filter(Boolean) as string[];
  const price = (i: (typeof v.items)[number]) =>
    i.minGross !== undefined && i.maxGross !== undefined && i.minGross !== i.maxGross ? `${formatAed(i.minGross, lang)} – ${formatAed(i.maxGross, lang)}` : formatAed(i.gross, lang);
  return render((fam) => (
    <Document title={`${t('estimate.title')} ${b.order.number} v${v.number}`}>
      <Page size="A4" style={[s.page, { fontFamily: fam }]}>
        <Header settings={b.settings} title={v.number === 1 ? t('pdf.estimateTitle') : t('pdf.supplementTitle')} sub={`№${b.order.number} · v${v.number} · ${formatDateTime(v.sentAt)}`} />
        <Parties customer={b.customer} vehicle={b.vehicle} order={b.order} lang={lang} />
        {v.reason && <Text style={[s.box, s.bold]}>{v.reason}</Text>}
        {(['A', 'B', 'C'] as const).map((blk) => {
          const list = v.items.filter((i) => i.block === blk);
          if (!list.length) return null;
          return (
            <View key={blk}>
              <Text style={s.h2}>{t(`block.${blk}.title`)}</Text>
              <Text style={[s.muted, { marginBottom: 3 }]}>{t(`block.${blk}.hint`)}</Text>
              {list.map((i) => (
                <View key={i.itemId} style={[s.between, s.td]} wrap={false}>
                  <View style={{ flex: 1 }}>
                    <Text>{i.urgency ? `[${t(`urgency.${i.urgency}`)}] ` : ''}{i.title} × {i.qty}{i.customerSupplied ? ` — ${t('item.customerSupplied')}` : ''}</Text>
                    {i.ifNotDone ? <Text style={s.muted}>{t('item.ifNotDone')}: {i.ifNotDone}</Text> : null}
                  </View>
                  <Text style={s.bold}>{price(i)}</Text>
                </View>
              ))}
            </View>
          );
        })}
        <View style={[s.box, { marginTop: 10 }]} wrap={false}>
          <View style={s.between}><Text>{t('estimate.fixed')}</Text><Text style={s.bold}>{formatAed(v.fixedGross, lang)}</Text></View>
          {v.maxGross !== v.fixedGross && <View style={s.between}><Text>{t('estimate.upTo')}</Text><Text style={s.bold}>{formatAed(v.maxGross, lang)}</Text></View>}
          {v.recommendedGross > 0 && <View style={s.between}><Text>{t('estimate.recommended')}</Text><Text>{formatAed(v.recommendedGross, lang)}</Text></View>}
          <Text style={s.muted}>{t('estimate.inclVat')} · {t('version.validUntil')} {formatDate(v.validUntil)}</Text>
        </View>
        {v.items.some((i) => i.block === 'B') && <Text style={{ marginTop: 6 }}>{t('msg.bExplain')}</Text>}
        {thumbs.length > 0 && (
          <>
            <Text style={s.h2}>{t('pdf.photos')}</Text>
            <View style={[s.row, { flexWrap: 'wrap' }]}>{thumbs.map((u, i) => <Image key={i} src={u} style={s.photo} />)}</View>
          </>
        )}
        <Text style={{ marginTop: 10 }}>{t('pdf.estimateNote')}</Text>
        <Footer settings={b.settings} lang={lang} />
      </Page>
    </Document>
  ));
}

export async function renderInvoice(invoiceId: string): Promise<Blob> {
  const inv = await db.invoices.get(invoiceId);
  if (!inv) throw new Error('not found');
  const b = (await loadOrderBundle(inv.orderId))!;
  const ru = b.order.docLanguage === 'ru';
  const L = (en: string, rus: string) => (ru ? `${en} / ${rus}` : en);
  const title =
    inv.type === 'tax_invoice' ? L('TAX INVOICE', 'Налоговый инвойс') : inv.type === 'simplified_tax_invoice' ? L('SIMPLIFIED TAX INVOICE', 'Упрощённый налоговый инвойс') : L('TAX CREDIT NOTE', 'Кредит-нота');
  const original = inv.originalInvoiceId ? await db.invoices.get(inv.originalInvoiceId) : undefined;
  const paid = paidNet(b.payments);
  const cols = [3.4, 0.6, 1.1, 1.1, 0.6, 0.9, 1.2];
  const head = ['Description', 'Qty', 'Unit price', 'Taxable amount', 'VAT %', 'VAT', 'Total incl. VAT'];
  const aed = (f: number) => formatAed(f, 'en', false);
  return render((fam) => (
    <Document title={inv.number}>
      <Page size="A4" style={[s.page, { fontFamily: fam }]}>
        <Header settings={b.settings} title={title} sub={`No. ${inv.number}`} right={<Text>{L('Date', 'Дата')}: {formatDate(inv.issuedAt)}</Text>} />
        <View style={[s.row, { gap: 8 }]}>
          <View style={[s.box, { flex: 1 }]}>
            <Text style={s.muted}>{L('Supplier', 'Поставщик')}</Text>
            <Text style={s.bold}>{inv.seller.name}</Text>
            {inv.seller.address ? <Text>{inv.seller.address}</Text> : null}
            <Text>TRN: {inv.seller.trn || '—'}</Text>
          </View>
          <View style={[s.box, { flex: 1 }]}>
            <Text style={s.muted}>{L('Customer', 'Клиент')}</Text>
            <Text style={s.bold}>{inv.buyer.name}</Text>
            {inv.buyer.address ? <Text>{inv.buyer.address}</Text> : null}
            {inv.buyer.trn ? <Text>TRN: {inv.buyer.trn}</Text> : null}
            {inv.buyer.phone ? <Text>{formatPhone(inv.buyer.phone)}</Text> : null}
          </View>
        </View>
        <Text style={{ marginTop: 6 }}>
          {L('Vehicle', 'Автомобиль')}: {b.vehicle.make} {b.vehicle.model} · {formatPlate(b.vehicle.plate, 'en')}{b.vehicle.vin ? ` · VIN ${b.vehicle.vin}` : ''} · {L('Job card', 'Заказ')} {b.order.number}
        </Text>
        {original && <Text style={[s.box, s.bold]}>{L('Credit note for invoice', 'Кредит-нота к инвойсу')} {original.number} ({formatDate(original.issuedAt)}). {L('Reason', 'Причина')}: {inv.reason}</Text>}
        <View style={{ marginTop: 8 }}>
          <View style={s.row}>
            {head.map((h, i) => <Text key={h} style={[s.th, { flex: cols[i], textAlign: i === 0 ? 'left' : 'right' }]}>{h}</Text>)}
          </View>
          {inv.lines.map((l, idx) => (
            <View key={idx} style={s.row} wrap={false}>
              <Text style={[s.td, { flex: cols[0] }]}>{l.description}{l.customerSupplied ? ' (customer supplied part)' : ''}</Text>
              <Text style={[s.td, { flex: cols[1], textAlign: 'right' }]}>{l.qty}</Text>
              <Text style={[s.td, { flex: cols[2], textAlign: 'right' }]}>{aed(l.unitPriceFils)}</Text>
              <Text style={[s.td, { flex: cols[3], textAlign: 'right' }]}>{aed(l.net)}</Text>
              <Text style={[s.td, { flex: cols[4], textAlign: 'right' }]}>{(l.vatRateBp / 100).toFixed(0)}%</Text>
              <Text style={[s.td, { flex: cols[5], textAlign: 'right' }]}>{aed(l.vat)}</Text>
              <Text style={[s.td, { flex: cols[6], textAlign: 'right' }]}>{aed(l.gross)}</Text>
            </View>
          ))}
        </View>
        <View style={{ alignSelf: 'flex-end', width: 240, marginTop: 8 }} wrap={false}>
          <View style={s.between}><Text>{L('Total excl. VAT', 'Итого без VAT')}</Text><Text>{aed(inv.subtotalFils)} AED</Text></View>
          <View style={s.between}><Text>{L('VAT', 'VAT')} 5%</Text><Text>{aed(inv.vatFils)} AED</Text></View>
          <View style={[s.between, { borderTopWidth: 1, borderColor: '#333', marginTop: 2, paddingTop: 2 }]}>
            <Text style={s.bold}>{L('Total amount payable', 'К оплате')}</Text>
            <Text style={s.bold}>{aed(inv.totalFils)} AED</Text>
          </View>
          {inv.type !== 'credit_note' && (
            <>
              <View style={s.between}><Text>{L('Paid', 'Оплачено')}</Text><Text>{aed(paid)} AED</Text></View>
              <View style={s.between}><Text>{L('Balance', 'Остаток')}</Text><Text>{aed(Math.max(0, inv.totalFils - paid))} AED</Text></View>
            </>
          )}
        </View>
        {b.settings.bankDetails ? <Text style={[s.box, { fontSize: 8 }]}>{L('Bank details', 'Реквизиты')}: {b.settings.bankDetails}</Text> : null}
        <Text style={{ marginTop: 8, fontSize: 7.5, color: '#555' }}>
          {(b.settings.warrantyText.en ?? '').replace('{months}', String(b.settings.warrantyLaborMonths)).replace('{km}', String(b.settings.warrantyLaborKm))}
        </Text>
        <Footer settings={b.settings} lang={ru ? 'ru' : 'en'} />
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
        <Header settings={b.settings} title={t('pdf.receiptTitle')} sub={`${p.receiptNumber} · ${formatDateTime(p.receivedAt)}`} />
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
        <Header settings={b.settings} title={t('pdf.debtTitle')} sub={formatDateTime(d.signedAt)} />
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
        <Header settings={settings} title={t('report.title')} sub={`${formatDate(from)} – ${formatDate(to)}`} />
        {row(t('report.received'), String(r.ordersReceived))}
        {row(t('report.delivered'), String(r.ordersDelivered))}
        {row(t('report.revenueGross'), a(r.revenueGross), true)}
        {row(t('report.revenueNet'), a(r.revenueNet))}
        {row(`  ${t('item.kind.labor')}`, a(r.laborNet))}
        {row(`  ${t('item.kind.part')}`, a(r.partsNet))}
        {row(`  ${t('report.other')}`, a(r.otherNet))}
        {row(t('report.partsCost'), a(r.partsCostNet))}
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
