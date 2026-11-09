import { db, uid } from '../db/db';
import { nowIso } from '../domain/dates';
import { discountBase, discountGross, discountLines, discountPrice, discountTitles, grossOf, splitDiscount, type DiscountSpec } from '../domain/discount';
import { activeInvoice } from '../domain/invoice';
import { itemAmounts } from '../domain/items';
import { AppError } from './errors';
import { logEvent } from './orders';

/**
 * Put a discount on the job's lines (`null` — no discount) before the invoice: its discount lines are
 * replaced (one per VAT rate of the lines). A percentage is kept on the lines, so it follows them while
 * they are drafts (`syncDiscount`). Returns the ids of the draft discount lines.
 * Once the invoice is out, see `discountIssuedInvoice` in `services/money.ts`.
 */
export async function setDiscount(orderId: string, spec: DiscountSpec | null, opts: { quiet?: boolean } = {}): Promise<string[]> {
  return db.transaction('rw', [db.items, db.invoices, db.events], async () => {
    const invoices = await db.invoices.where('orderId').equals(orderId).toArray();
    if (activeInvoice(invoices)) throw new AppError('err.invoiceExists');
    const items = await db.items.where('orderId').equals(orderId).toArray();
    const base = discountBase(items);
    const before = grossOf(base);
    const off = spec ? discountGross(spec, before) : 0;
    if (spec && !(off > 0)) throw new AppError('err.amountRequired');
    if (off > before) throw new AppError('err.discountTooBig');
    const current = discountLines(items);
    // A discount agreed on an invoice that was cancelled since gives way to the new one.
    for (const i of current) if (i.approvalState === 'approved') await db.items.update(i.id, { approvalState: 'cancelled' });
    const free = current.filter((i) => i.approvalState === 'draft');
    const pct = spec && 'pctBp' in spec ? spec.pctBp : undefined;
    const ids: string[] = [];
    for (const p of splitDiscount(base, off)) {
      const patch = { ...discountTitles(spec!), ...discountPrice(p), qty: 1, discountPctBp: pct };
      const k = free.findIndex((d) => d.vatRateBp === p.rateBp);
      const reuse = k >= 0 ? free.splice(k, 1)[0] : free.shift();
      if (reuse) {
        await db.items.update(reuse.id, patch);
        ids.push(reuse.id);
      } else {
        const id = uid();
        await db.items.add({ id, orderId, kind: 'discount', block: 'A', unit: 'pcs', approvalState: 'draft', done: false, createdAt: nowIso(), ...patch });
        ids.push(id);
      }
    }
    for (const d of free) await db.items.delete(d.id);
    if (!opts.quiet) await logEvent(orderId, 'discount', { amount: off, pct });
    return ids;
  });
}

/** A percentage discount follows the lines while it is a draft: lines added, changed or removed. */
export async function syncDiscount(orderId: string): Promise<void> {
  const [items, invoices] = await Promise.all([db.items.where('orderId').equals(orderId).toArray(), db.invoices.where('orderId').equals(orderId).toArray()]);
  if (activeInvoice(invoices)) return;
  const drafts = items.filter((i) => i.kind === 'discount' && i.approvalState === 'draft');
  const pctBp = drafts.find((d) => d.discountPctBp)?.discountPctBp;
  if (!pctBp) return;
  const base = discountBase(items);
  const want = splitDiscount(base, discountGross({ pctBp }, grossOf(base)));
  const same = want.length === drafts.length && want.every((p) => drafts.some((d) => d.vatRateBp === p.rateBp && itemAmounts(d).gross === -p.grossFils));
  if (same) return;
  await setDiscount(orderId, want.length ? { pctBp } : null, { quiet: true });
}
