import { db } from '../db/db';
import { invoiceBuyer, invoicePaidAt } from '../domain/invoice';
import { formatPlate } from '../domain/plates';
import type { Media, MediaOwner, Vehicle } from '../domain/types';
import { AppError } from './errors';
import { downloadBlob } from './backup';
import { addMedia, mediaBlob } from './media';

export interface PdfFile {
  blob: Blob;
  filename: string;
}

async function stored(ownerId: string, ok?: (m: Media) => boolean): Promise<Media | undefined> {
  return db.media
    .where('ownerId')
    .equals(ownerId)
    .filter((m) => m.kind === 'pdf' && m.slot === 'document_pdf' && (!ok || ok(m)))
    .first();
}

const inFlight = new Map<string, Promise<PdfFile>>();

/** Generate once and keep: the stored PDF is what the customer received. */
async function keep(ownerType: MediaOwner, ownerId: string, filename: string, make: () => Promise<Blob>, ok?: (m: Media) => boolean): Promise<PdfFile> {
  const existing = await stored(ownerId, ok);
  if (existing) {
    const blob = await mediaBlob(existing.id);
    if (blob) return { blob, filename };
    // Kept on the garage's server and out of reach now (v0.40): drawn again for this time, not kept twice.
    return { blob: await make(), filename };
  }
  // Two taps (or a tap during the background generation after signing) must not store two PDFs.
  const running = inFlight.get(ownerId);
  if (running) return running;
  const job = (async () => {
    const blob = await make();
    const m = await addMedia({ ownerType, ownerId, slot: 'document_pdf', file: blob, kind: 'pdf', compress: false, locked: true, name: filename });
    if (ownerType === 'inspection') await db.inspections.update(ownerId, { pdfMediaId: m.id, pdfSha256: m.sha256 });
    return { blob, filename };
  })();
  inFlight.set(ownerId, job);
  try {
    return await job;
  } finally {
    inFlight.delete(ownerId);
  }
}

const pdf = () => import('../pdf/documents');

/**
 * A document's file name: what it is, then the car and its plate — "Quotation - Honda Accord - Dubai R 7720.pdf",
 * "INV-2026-00005 - Honda Accord - Dubai R 7720.pdf" — so a file sent or saved says whose it is.
 */
export function documentFileName(what: string, car?: Pick<Vehicle, 'make' | 'model' | 'plate'>): string {
  const name = car ? [[car.make, car.model].filter(Boolean).join(' '), formatPlate(car.plate, 'en')].filter(Boolean).join(' - ') : '';
  return `${[what, name].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()}.pdf`;
}

/** The car of a job (for the file name of its documents). */
async function carOf(orderId: string | undefined): Promise<Vehicle | undefined> {
  const order = orderId ? await db.orders.get(orderId) : undefined;
  return order ? db.vehicles.get(order.vehicleId) : undefined;
}

export async function inspectionPdf(inspectionId: string): Promise<PdfFile> {
  const insp = await db.inspections.get(inspectionId);
  if (!insp) throw new AppError('err.notFound');
  const filename = documentFileName(insp.kind === 'intake' ? 'Check-in' : 'Hand-over', await carOf(insp.orderId));
  if (!insp.locked) return { blob: await (await pdf()).renderInspection(inspectionId), filename };
  return keep('inspection', inspectionId, filename, async () => (await pdf()).renderInspection(inspectionId));
}

export async function versionPdf(versionId: string): Promise<PdfFile> {
  const v = await db.versions.get(versionId);
  if (!v) throw new AppError('err.notFound');
  const order = await db.orders.get(v.orderId);
  return keep('version', versionId, documentFileName(v.number > 1 ? `Quotation v${v.number}` : 'Quotation', await carOf(order?.id)), async () => (await pdf()).renderVersion(versionId));
}

/** Quotation of the job's current lines (quick path). Not stored: it changes with the lines. */
export async function quotationPdf(orderId: string): Promise<PdfFile> {
  const order = await db.orders.get(orderId);
  if (!order) throw new AppError('err.notFound');
  return { blob: await (await pdf()).renderQuotation(orderId), filename: documentFileName('Quotation', await carOf(orderId)) };
}

/** The quote's options (v0.90, #72): a page each; `ids` — only those (one option — «Quotation 434-2»). */
export async function quoteOptionsPdf(orderId: string, ids?: string[]): Promise<PdfFile> {
  const order = await db.orders.get(orderId);
  if (!order) throw new AppError('err.notFound');
  const k = ids?.length === 1 ? (order.quoteOptions ?? []).findIndex((o) => o.id === ids[0]) : -1;
  return { blob: await (await pdf()).renderQuoteOptions(orderId, ids), filename: documentFileName(k >= 0 ? `Quotation ${order.number}-${k + 1}` : 'Quotation options', await carOf(orderId)) };
}

/** Paid invoices stamped this session (made when asked: a payment taken back takes the stamp off). */
const stampedNow = new Map<string, Promise<Blob>>();

export async function invoicePdf(invoiceId: string): Promise<PdfFile> {
  const inv = await db.invoices.get(invoiceId);
  if (!inv) throw new AppError('err.notFound');
  const order = await db.orders.get(inv.orderId);
  const filename = documentFileName(inv.number, order ? await db.vehicles.get(order.vehicleId) : undefined);
  const make = async () => (await pdf()).renderInvoice(invoiceId);
  // Issued with the buyer blank, it prints the job's customer as it is now (`invoiceBuyer`): made each time,
  // not kept — the PDF kept before the customer was added (with no name) is not the one given any more.
  const customer = order ? await db.customers.get(order.customerId) : undefined;
  // Paid in full (v0.38): printed, sent and opened with the PAID stamp — made from the invoice when asked (it is paid
  // after it is issued); the PDF kept at its issue stays as it was.
  if (order) {
    const [invoices, payments] = await Promise.all([db.invoices.where('orderId').equals(order.id).toArray(), db.payments.where('orderId').equals(order.id).toArray()]);
    const paidAt = invoicePaidAt(inv, invoices, payments, order);
    if (paidAt) {
      const key = [invoiceId, paidAt, customer ? JSON.stringify([customer.name, customer.companyName, customer.phone, customer.trn, customer.address]) : ''].join('|');
      if (!stampedNow.has(key)) stampedNow.set(key, (async () => (await pdf()).renderInvoice(invoiceId, paidAt))().catch((e) => (stampedNow.delete(key), Promise.reject(e))));
      return { blob: await stampedNow.get(key)!, filename };
    }
  }
  if (invoiceBuyer(inv.buyer, customer) !== inv.buyer) return { blob: await make(), filename };
  // Kept under its number: an invoice numbered again (v0.42.3 — as its job, as in Eaglecart) is drawn and kept anew.
  return keep('invoice', invoiceId, filename, make, (m) => !m.name || m.name.startsWith(`${inv.number} `) || m.name === `${inv.number}.pdf`);
}

export async function receiptPdf(paymentId: string): Promise<PdfFile> {
  const p = await db.payments.get(paymentId);
  if (!p) throw new AppError('err.notFound');
  return keep('payment', paymentId, documentFileName(p.receiptNumber ?? 'Receipt', await carOf(p.orderId)), async () => (await pdf()).renderReceipt(paymentId));
}

export async function debtPdf(debtId: string): Promise<PdfFile> {
  const debt = await db.debts.get(debtId);
  return keep('debt', debtId, documentFileName('Debt', await carOf(debt?.orderId)), async () => (await pdf()).renderDebt(debtId));
}

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent);
const isIosDevice = () => /iPad|iPhone|iPod/.test(ua()) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/i.test(ua());

type PdfShow = (file: PdfFile | Promise<PdfFile | undefined>, title?: string) => void;
let viewer: PdfShow | undefined;

/**
 * The app's own PDF viewer (v0.90, the owner: «удобный просмотр PDF файлов внутри приложения» — ui/PdfViewer.tsx): set
 * by the app when it starts; every «open the PDF» shows the file there. Without it (tests) — the device's own way below.
 */
export function setPdfViewer(show: PdfShow | undefined): void {
  viewer = show;
}

/** The PDF in the app's own viewer — a file still being made or fetched is shown the moment it is here. */
export function viewPdf(file: PdfFile | Promise<PdfFile | undefined>, title?: string): boolean {
  if (!viewer) return false;
  viewer(file, title);
  return true;
}

/**
 * Open a PDF: in the app's own viewer (v0.90); where there is none, the way each device handles it best:
 * - iPhone/iPad: the system share sheet with the file (preview, Print, Save to Files, WhatsApp) —
 *   a new tab with a blob link opens blank in an installed app;
 * - Android: download, then the notification opens it in the PDF viewer;
 * - PC: a new tab with the browser's PDF viewer (download if pop-ups are blocked or in the preview).
 */
export async function openPdf(file: PdfFile): Promise<void> {
  if (viewPdf(file)) return;
  const pdfFile = typeof File !== 'undefined' ? new File([file.blob], file.filename, { type: 'application/pdf' }) : undefined;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (isIosDevice() && pdfFile && nav.canShare?.({ files: [pdfFile] })) {
    try {
      await navigator.share({ files: [pdfFile], title: file.filename });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      // share not allowed (e.g. the tap was too long ago) — fall back to a download below
    }
  }
  if (isIosDevice() || isAndroid()) return downloadBlob(file.blob, file.filename);
  const url = URL.createObjectURL(file.blob);
  const w = window.open(url, '_blank');
  if (!w) {
    URL.revokeObjectURL(url);
    await downloadBlob(file.blob, file.filename);
  } else setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
}
