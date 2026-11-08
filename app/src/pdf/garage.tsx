import { Image, Rect, Svg, Text, View } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import { formatAed } from '../domain/money';
import { formatPhone } from '../domain/phone';
import type { Settings } from '../domain/types';
import { barRuns, code128, qrModules } from './codes';

/*
 * The garage's own document design, measured from its Eaglecart tax invoice and quotation:
 * Times (Tinos, metrically the same) with Arabic (Markazi Text), company in English on the left,
 * logo in the middle, the same in Arabic on the right, a grey title bar, seller and customer
 * blocks, a ruled table, a rounded totals box, barcodes/QR (invoice) or signatures (quotation).
 */

/** Arabic glyphs of the Arabic face look smaller than Times at the same size. */
const AR = 1.17;
/** The Arabic face sits a little high on a shared baseline: nudged down by this share of its size. */
const AR_DROP = 0.11;
/** Spaces at the edge of a run are dropped by the PDF layout; a no-break space keeps them. */
const SP = ' ';

export const COLOR = {
  ink: '#000000',
  head: '#333333',
  rule: '#333333',
  bar: '#e5e5e5',
  rowRule: '#eeeeee',
  boxBorder: '#e5e7eb',
  boxRule: '#d1d5db',
  label: '#374151',
  strong: '#111827',
  sign: '#232629',
  footer: '#454545',
};

/** Arabic labels as on the garage's documents. */
export const AR_LABEL = {
  taxInvoice: 'فاتورة ضريبية',
  creditNote: 'إشعار دائن ضريبي',
  quotation: 'عرض سعر',
  seller: 'البائع',
  billTo: 'الفاتورة إلى',
  quotationTo: 'عرض سعر إلى',
  telephone: 'الهاتف',
  email: 'البريد الإلكتروني',
  taxId: 'الرقم الضريبي',
  invoiceNumber: 'رقم الفاتورة',
  creditNumber: 'رقم الإشعار',
  quotationNumber: 'رقم عرض السعر',
  order: 'رقم الطلب',
  date: 'التاريخ',
  validUntil: 'صالح حتى',
  plate: 'اللوحة',
  vin: 'رقم الشاصي',
  description: 'الوصف',
  price: 'السعر',
  discount: 'الخصم',
  qty: 'الكمية',
  total: 'الإجمالي',
  totalQty: 'إجمالي الكمية',
  paymentMethod: 'طريقة الدفع',
  subtotal: 'المجموع الفرعي',
  vatIncl: 'شامل',
  jobId: 'معرف المهمة',
  invoiceNo: 'رقم الفاتورة',
  authorizedBy: 'مفوض من قبل',
  customerApproval: 'موافقة العميل',
  signStamp: 'التوقيع والختم',
  signDate: 'التوقيع والتاريخ',
  reference: 'المرجع',
};

/** "AED 571.43", as the garage's documents write amounts. */
export const aed = (fils: number) => `${fils < 0 ? '-' : ''}AED ${formatAed(Math.abs(fils), 'en', false)}`;

/** Arabic text run (bigger, so it matches the Latin next to it). */
export function Ar({ children, size, bold, color, align, inline = true }: { children: ReactNode; size: number; bold?: boolean; color?: string; align?: 'left' | 'right' | 'center'; inline?: boolean }) {
  return (
    <Text style={{ fontSize: size * AR, fontWeight: bold ? 'bold' : 'normal', color, textAlign: align, ...(inline ? { position: 'relative', top: size * AR_DROP } : {}) }}>
      {children}
    </Text>
  );
}

/**
 * "Telephone  الهاتف: +971 54 788 8330". English, Arabic and the value are separate runs: in one run
 * the bidirectional algorithm would carry the number into the Arabic and print it reversed.
 */
export function BiLine({ en, ar, value, size = 9, color, right, bold, colon = true, mb = 3.3 }: { en: string; ar: string; value?: ReactNode; size?: number; color?: string; right?: boolean; bold?: boolean; colon?: boolean; mb?: number }) {
  const fw = bold ? 'bold' : 'normal';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: right ? 'flex-end' : 'flex-start', flexWrap: 'wrap', marginBottom: mb }}>
      <Text style={{ fontSize: size, color, fontWeight: fw }}>
        {en}
        {SP}
        {SP}
      </Text>
      <Ar size={size} color={color} bold={bold}>
        {ar}
      </Ar>
      {value !== undefined && value !== '' && (
        // A space at the start of a run is dropped, so without a colon the gap is a margin.
        <Text style={{ fontSize: size, color, fontWeight: fw, marginLeft: colon ? 0 : size * 0.3 }}>
          {colon ? `:${SP}` : ''}
          {value}
        </Text>
      )}
    </View>
  );
}

/** Company in English (left), logo (middle), company in Arabic (right). `compact`: half-page (A5) documents. */
export function GarageHeader({ s, compact }: { s: Settings; compact?: boolean }) {
  const phone = s.phone ? formatPhone(s.phone) : '';
  const k = compact ? 0.72 : 1;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: 66 * k }}>
      <View style={{ flex: 1, maxWidth: 168 * k + (compact ? 20 : 0) }}>
        <Text style={{ fontSize: 15 * k, fontWeight: 'bold', color: COLOR.head, lineHeight: 1.15 }}>{s.name}</Text>
        {s.address ? <Text style={{ fontSize: 9 * Math.max(k, 0.85), marginTop: 5 * k }}>{s.address}</Text> : null}
        {phone ? <Text style={{ fontSize: 9 * Math.max(k, 0.85), marginTop: 3 * k }}>{phone}</Text> : null}
      </View>
      <View style={{ width: 120 * k, alignItems: 'center' }}>
        {s.logoDataUrl ? <Image src={s.logoDataUrl} style={{ width: 82.5 * k, height: 38.2 * k, objectFit: 'contain' }} /> : null}
      </View>
      <View style={{ flex: 1, maxWidth: 176 * k + (compact ? 20 : 0), alignItems: 'flex-end' }}>
        {s.nameAr ? (
          <Ar size={15 * k} bold color={COLOR.head} align="right" inline={false}>
            {s.nameAr}
          </Ar>
        ) : null}
        {s.addressAr ? (
          <Ar size={9 * Math.max(k, 0.85)} align="right" inline={false}>
            {s.addressAr}
          </Ar>
        ) : null}
        {phone ? <Text style={{ fontSize: 9 * Math.max(k, 0.85), marginTop: 2 }}>{phone}</Text> : null}
      </View>
    </View>
  );
}

/** Grey bar across the page: "TAX INVOICE  فاتورة ضريبية". */
export function TitleBar({ en, ar, spaced = true }: { en: string; ar: string; spaced?: boolean }) {
  return (
    <View style={{ backgroundColor: COLOR.bar, height: 24, marginTop: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ fontSize: 9.8, fontWeight: 'bold', letterSpacing: spaced ? 1.1 : 0.4 }}>{en}{SP}{SP}</Text>
      <Ar size={9.8} bold>
        {ar}
      </Ar>
    </View>
  );
}

/** Underlined block label: "SELLER  البائع", "BILL TO  الفاتورة إلى". */
export function BlockLabel({ en, ar, right }: { en: string; ar: string; right?: boolean }) {
  return (
    <View style={{ alignSelf: right ? 'flex-end' : 'flex-start', flexDirection: 'row', alignItems: 'baseline', borderBottomWidth: 0.7, borderColor: COLOR.rule, paddingBottom: 1, marginBottom: 7 }}>
      <Text style={{ fontSize: 8.2, fontWeight: 'bold' }}>{en}{SP}{SP}</Text>
      <Ar size={8.2} bold>
        {ar}
      </Ar>
    </View>
  );
}

export interface DocRow {
  description: string;
  /** Unit price excl. VAT; undefined → shown empty (a price range). */
  price?: number;
  discount?: number;
  vat?: number;
  qty: number;
  total: number;
  /** Shown instead of the total (a price range "AED 300.00 – 500.00"). */
  totalText?: string;
}

const COLS = [21, 119.3, 80.2, 98.2, 73.6, 66.7, 84.7];

function HeadCell({ en, ar, flex, align = 'left' }: { en: string; ar?: string; flex: number; align?: 'left' | 'center' | 'right' }) {
  return (
    <View style={{ flex, flexDirection: 'row', alignItems: 'baseline', justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start', paddingHorizontal: 3.7 }}>
      <Text style={{ fontSize: 9.8, fontWeight: 'bold' }}>{en}</Text>
      {ar ? (
        <>
          <Text style={{ fontSize: 9.8 }}>
            {SP}
            {SP}
          </Text>
          <Ar size={9.8} bold>
            {ar}
          </Ar>
        </>
      ) : (
        // An invisible Arabic mark gives this cell the same line as its neighbours, so all headings share a baseline.
        <Text style={{ opacity: 0 }}>
          <Ar size={9.8} bold>
            ـ
          </Ar>
        </Text>
      )}
    </View>
  );
}

const cell = (flex: number, align: 'left' | 'center' | 'right' = 'left') => ({ flex, fontSize: 9.8, paddingHorizontal: 3.7, textAlign: align });

/** The ruled table of lines: # · Description · Price · Discount · VAT · Qty · Total. */
export function ItemsTable({ rows }: { rows: DocRow[] }) {
  return (
    <View style={{ marginTop: 14 }}>
      <View style={{ flexDirection: 'row', borderTopWidth: 0.7, borderBottomWidth: 0.7, borderColor: COLOR.rule, paddingVertical: 5 }} fixed>
        <HeadCell en="#" flex={COLS[0]} />
        <HeadCell en="Description" ar={AR_LABEL.description} flex={COLS[1]} />
        <HeadCell en="Price" ar={AR_LABEL.price} flex={COLS[2]} />
        <HeadCell en="Discount" ar={AR_LABEL.discount} flex={COLS[3]} />
        <HeadCell en="VAT" flex={COLS[4]} />
        <HeadCell en="Qty" ar={AR_LABEL.qty} flex={COLS[5]} align="center" />
        <HeadCell en="Total" ar={AR_LABEL.total} flex={COLS[6]} align="right" />
      </View>
      {rows.map((r, i) => (
        <View key={i} wrap={false} style={{ flexDirection: 'row', paddingVertical: 5, borderBottomWidth: i < rows.length - 1 ? 0.7 : 0, borderColor: COLOR.rowRule }}>
          <Text style={cell(COLS[0])}>{i + 1}.</Text>
          <Text style={cell(COLS[1])}>{r.description}</Text>
          <Text style={cell(COLS[2])}>{r.price !== undefined ? aed(r.price) : ''}</Text>
          <Text style={cell(COLS[3])}>{r.discount ? aed(r.discount) : ''}</Text>
          <Text style={cell(COLS[4])}>{r.vat !== undefined ? aed(r.vat) : ''}</Text>
          <Text style={cell(COLS[5], 'center')}>{String(r.qty)}</Text>
          <Text style={cell(COLS[6], 'right')}>{r.totalText ?? aed(r.total)}</Text>
        </View>
      ))}
      <View style={{ borderTopWidth: 0.7, borderColor: COLOR.rule, marginTop: 13 }} />
    </View>
  );
}

/** Left: total quantity and other notes; right: the rounded totals box. */
export function Totals({ qty, notes, subtotal, vat, total, totalText }: { qty: number; notes?: ReactNode; subtotal: number; vat: number; total: number; totalText?: string }) {
  const row = (en: string, ar: string, value: string, big?: boolean, after?: string) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: big ? 0 : 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text style={{ fontSize: big ? 12 : 9.8, fontWeight: big ? 'bold' : 'normal', color: big ? COLOR.strong : COLOR.label }}>{en}{SP}{SP}</Text>
        <Ar size={big ? 12 : 9.8} bold={big} color={big ? COLOR.strong : COLOR.label}>
          {ar}
        </Ar>
        {/* A closing bracket after Arabic would be mirrored inside the Arabic run: it is set as Latin. */}
        {after ? <Text style={{ fontSize: big ? 12 : 9.8, color: big ? COLOR.strong : COLOR.label }}>{after}</Text> : null}
      </View>
      <Text style={{ fontSize: big ? 12 : 9.8, fontWeight: 'bold', color: COLOR.strong }}>{value}</Text>
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 13 }} wrap={false}>
      <View style={{ flex: 1, paddingTop: 10, paddingLeft: 3.7, paddingRight: 12 }}>
        <BiLine en="Total Qty" ar={AR_LABEL.totalQty} value={String(qty)} colon={false} color={COLOR.head} />
        {notes}
      </View>
      <View style={{ width: 256, borderWidth: 0.75, borderColor: COLOR.boxBorder, borderRadius: 10, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 13 }}>
        {row('Subtotal', AR_LABEL.subtotal, aed(subtotal))}
        {row('VAT (Incl.', AR_LABEL.vatIncl, aed(vat), false, ')')}
        <View style={{ borderTopWidth: 0.7, borderColor: COLOR.boxRule, marginTop: 4, marginBottom: 10 }} />
        {row('Total', AR_LABEL.total, totalText ?? aed(total), true)}
      </View>
    </View>
  );
}

/** Code 128 barcode with its label above and the value below. */
function Barcode({ value, en, ar }: { value: string; en: string; ar: string }) {
  const bits = code128(value);
  const module = Math.min(0.71, 150 / bits.length);
  const w = bits.length * module;
  return (
    <View style={{ alignItems: 'center', width: 170 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 5 }}>
        <Text style={{ fontSize: 7.5 }}>{en}{SP}{SP}</Text>
        <Ar size={7.5}>{ar}</Ar>
      </View>
      <Svg width={w} height={37.5} viewBox={`0 0 ${bits.length} 37.5`}>
        {barRuns(bits).map((r) => (
          <Rect key={r.x} x={r.x} y={0} width={r.w} height={37.5} fill="#000" />
        ))}
      </Svg>
      <Text style={{ fontSize: 7.5, marginTop: 3 }}>{value}</Text>
    </View>
  );
}

/** QR code (dark modules as squares), 56 pt like on the garage's invoice. */
function QrCode({ text, size = 56.3 }: { text: string; size?: number }) {
  const q = qrModules(text);
  const rects: ReactNode[] = [];
  for (let r = 0; r < q.size; r++) {
    for (let c = 0; c < q.size; ) {
      if (!q.dark[r * q.size + c]) {
        c++;
        continue;
      }
      let e = c;
      while (e < q.size && q.dark[r * q.size + e]) e++;
      rects.push(<Rect key={`${r}-${c}`} x={c} y={r} width={e - c} height={1} fill="#000" />);
      c = e;
    }
  }
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${q.size} ${q.size}`}>
      {rects}
    </Svg>
  );
}

/** Invoice: job barcode, QR with the invoice summary, invoice barcode. */
export function Codes({ jobNo, invoiceNo, qrText }: { jobNo: string; invoiceNo: string; qrText: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, paddingHorizontal: 0 }} wrap={false}>
      <Barcode value={jobNo} en="JOB ID" ar={AR_LABEL.jobId} />
      <QrCode text={qrText} />
      <Barcode value={invoiceNo} en="INVOICE#" ar={AR_LABEL.invoiceNo} />
    </View>
  );
}

/** Quotation: "Authorized by — garage" and "Customer approval — customer" with signature lines. */
export function Signatures({ company, customer }: { company: string; customer: string }) {
  const col = (en: string, ar: string, who: string, capEn: string, capAr: string) => (
    <View style={{ flex: 1, paddingHorizontal: 2 }}>
      {/* Same height on both sides, so the two signature lines are level even if a name wraps. */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', height: 22 }}>
        <Text style={{ fontSize: 8.2, fontWeight: 'bold', color: COLOR.label }}>{en}{SP}{SP}</Text>
        <Ar size={8.2} bold color={COLOR.label}>
          {ar}
        </Ar>
        <Text style={{ fontSize: 8.2, fontWeight: 'bold', color: COLOR.label, marginLeft: 2.5 }}>
          —{SP}
          {who}
        </Text>
      </View>
      <View style={{ borderTopWidth: 0.75, borderColor: COLOR.rule, marginTop: 52 }} />
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', marginTop: 4 }}>
        <Text style={{ fontSize: 7.5, color: COLOR.sign }}>{capEn}{SP}{SP}</Text>
        <Ar size={7.5} color={COLOR.sign}>
          {capAr}
        </Ar>
      </View>
    </View>
  );
  return (
    <View style={{ borderTopWidth: 0.7, borderColor: COLOR.boxRule, marginTop: 20, paddingTop: 5, flexDirection: 'row', gap: 6 }} wrap={false}>
      {col('AUTHORIZED BY', AR_LABEL.authorizedBy, company.toUpperCase(), 'Signature & Stamp', AR_LABEL.signStamp)}
      {col('CUSTOMER APPROVAL', AR_LABEL.customerApproval, customer.toUpperCase(), 'Signature & Date', AR_LABEL.signDate)}
    </View>
  );
}

/** Thin rule and "GARAGE: Thank you for your business…  نشكركم…" under the document. */
export function GarageFooter({ s, en }: { s: Settings; en?: string }) {
  const text = en ?? s.docFooter.en ?? '';
  return (
    <View style={{ borderTopWidth: 0.75, borderColor: COLOR.rowRule, marginTop: 14, paddingTop: 3, flexDirection: 'row', justifyContent: 'center', alignItems: 'baseline', flexWrap: 'wrap' }} wrap={false}>
      <Text style={{ fontSize: 6.8, color: COLOR.footer }}>
        {s.name}
        {text ? `: ${text}` : ''}
        {'  '}
      </Text>
      {s.docFooterAr ? (
        <Ar size={6.8} color={COLOR.footer}>
          {s.docFooterAr}
        </Ar>
      ) : null}
    </View>
  );
}
