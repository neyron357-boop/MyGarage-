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

/** Generate once and keep: the stored PDF is what the customer received. */
async function keep(ownerType: MediaOwner, ownerId: string, filename: string, make: () => Promise<Blob>): Promise<PdfFile> {
  const existing = await stored(ownerId);
  if (existing) {
    const blob = await mediaBlob(existing.id);
    if (blob) return { blob, filename };
  }
  const blob = await make();
  const m = await addMedia({ ownerType, ownerId, slot: 'document_pdf', file: blob, kind: 'pdf', compress: false, locked: true, name: filename });
  if (ownerType === 'inspection') await db.inspections.update(ownerId, { pdfMediaId: m.id, pdfSha256: m.sha256 });
  return { blob, filename };
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

/** Open the PDF in a new tab; where tabs are blocked (claude.ai preview) offer it as a file instead. */
export async function openPdf(file: PdfFile): Promise<void> {
  const url = URL.createObjectURL(file.blob);
  const w = window.open(url, '_blank');
  if (!w) await downloadBlob(file.blob, file.filename);
}
