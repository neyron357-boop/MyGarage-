import { db } from '../db/db';
import type { Media, MediaOwner } from '../domain/types';
import { AppError } from './errors';
import { downloadBlob } from './backup';
import { addMedia, mediaBlob } from './media';

export interface PdfFile {
  blob: Blob;
  filename: string;
}

async function stored(ownerId: string): Promise<Media | undefined> {
  return db.media.where('ownerId').equals(ownerId).filter((m) => m.kind === 'pdf' && m.slot === 'document_pdf').first();
}

const inFlight = new Map<string, Promise<PdfFile>>();

/** Generate once and keep: the stored PDF is what the customer received. */
async function keep(ownerType: MediaOwner, ownerId: string, filename: string, make: () => Promise<Blob>): Promise<PdfFile> {
  const existing = await stored(ownerId);
  if (existing) {
    const blob = await mediaBlob(existing.id);
    if (blob) return { blob, filename };
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

export async function inspectionPdf(inspectionId: string): Promise<PdfFile> {
  const insp = await db.inspections.get(inspectionId);
  if (!insp) throw new AppError('err.notFound');
  const order = await db.orders.get(insp.orderId);
  const filename = `${insp.kind === 'intake' ? 'intake' : 'handover'}-${order?.number ?? ''}.pdf`;
  if (!insp.locked) return { blob: await (await pdf()).renderInspection(inspectionId), filename };
  return keep('inspection', inspectionId, filename, async () => (await pdf()).renderInspection(inspectionId));
}

export async function versionPdf(versionId: string): Promise<PdfFile> {
  const v = await db.versions.get(versionId);
  if (!v) throw new AppError('err.notFound');
  const order = await db.orders.get(v.orderId);
  return keep('version', versionId, `estimate-${order?.number ?? ''}-v${v.number}.pdf`, async () => (await pdf()).renderVersion(versionId));
}

export async function invoicePdf(invoiceId: string): Promise<PdfFile> {
  const inv = await db.invoices.get(invoiceId);
  if (!inv) throw new AppError('err.notFound');
  return keep('invoice', invoiceId, `${inv.number}.pdf`, async () => (await pdf()).renderInvoice(invoiceId));
}

export async function receiptPdf(paymentId: string): Promise<PdfFile> {
  const p = await db.payments.get(paymentId);
  if (!p) throw new AppError('err.notFound');
  return keep('payment', paymentId, `${p.receiptNumber}.pdf`, async () => (await pdf()).renderReceipt(paymentId));
}

export async function debtPdf(debtId: string): Promise<PdfFile> {
  return keep('debt', debtId, `debt-${debtId.slice(0, 8)}.pdf`, async () => (await pdf()).renderDebt(debtId));
}

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent);
const isIosDevice = () => /iPad|iPhone|iPod/.test(ua()) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/i.test(ua());

/**
 * Show a PDF the way each device handles it best:
 * - iPhone/iPad: the system share sheet with the file (preview, Print, Save to Files, WhatsApp) —
 *   a new tab with a blob link opens blank in an installed app;
 * - Android: download, then the notification opens it in the PDF viewer;
 * - PC: a new tab with the browser's PDF viewer (download if pop-ups are blocked or in the preview).
 */
export async function openPdf(file: PdfFile): Promise<void> {
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
