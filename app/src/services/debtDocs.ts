import { db } from '../db/db';
import { dubaiDate } from '../domain/dates';
import { activeInvoice, buyerName } from '../domain/invoice';
import { zipStore, type ZipFile } from '../domain/zip';
import { loadDebtors } from './debts';
import { invoicePdf, type PdfFile } from './documents';
import { AppError } from './errors';

/*
 * The papers of what a customer owes (v0.30 — «Деньги → Долги», the customer's card): one sheet for all of it (a
 * statement of account: every job owed, its work, what was paid, the one sum due — pdf/statement.tsx), and every
 * invoice of those jobs on its own, in one folder (a .zip) — the invoices as they were issued, each its own file.
 */

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

async function debtorName(customerId: string): Promise<string> {
  const c = await db.customers.get(customerId);
  if (!c) throw new AppError('err.notFound');
  return safe(buyerName(c) || c.phone || 'Customer');
}

/**
 * The statement of account of a period (v0.62.2, pdf/statement.tsx): the account in four figures, the months, every
 * invoice and every payment. No period — from the first day of the oldest month still owed (else this month) to today.
 */
export async function statementPdf(customerId: string, period?: { from: string; to: string }): Promise<PdfFile> {
  const name = await debtorName(customerId);
  const today = dubaiDate();
  const oldest = (await loadDebtors()).find((d) => d.customer.id === customerId)?.months[0]?.month ?? today.slice(0, 7);
  const { from, to } = period ?? { from: `${oldest}-01`, to: today };
  const { renderStatement } = await import('../pdf/statement');
  return { blob: await renderStatement(customerId, from, to), filename: `Statement - ${name} - ${from} - ${to}.pdf` };
}

/** Every invoice of the jobs the customer owes for, each its own PDF, in one folder of a .zip. */
export async function debtInvoicesZip(customerId: string): Promise<File> {
  const name = await debtorName(customerId);
  const debtor = (await loadDebtors()).find((d) => d.customer.id === customerId);
  if (!debtor) throw new AppError('err.notFound');
  const folder = `Invoices - ${name}`;
  const files: ZipFile[] = [];
  const taken = new Set<string>();
  for (const car of debtor.cars)
    for (const j of car.jobs) {
      const inv = activeInvoice(await db.invoices.where('orderId').equals(j.order.id).toArray());
      if (!inv) continue;
      const pdf = await invoicePdf(inv.id);
      let file = pdf.filename;
      for (let k = 2; taken.has(file); k++) file = pdf.filename.replace(/\.pdf$/, ` (${k}).pdf`);
      taken.add(file);
      files.push({ name: `${folder}/${file}`, data: new Uint8Array(await pdf.blob.arrayBuffer()) });
    }
  if (!files.length) throw new AppError('debt.noInvoices');
  const bytes = zipStore(files);
  return new File([bytes.slice()], `${folder} - ${dubaiDate()}.zip`, { type: 'application/zip' });
}
