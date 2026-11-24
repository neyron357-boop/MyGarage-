import { liveLines } from './flow';
import { itemAmounts, itemOff, itemTitle } from './items';
import { isLabourCharge } from './linePrices';
import { roundFils } from './money';
import type { Expense, Lang, OrderItem } from './types';
import { vatOf, type Amounts } from './vat';

/*
 * The job for the owner to check (v0.82, the owner's note 24/11: «отправку владельцу для подтверждения — PDF, качественнее и
 * понятнее; поставщика — в отдельную вкладку, с логотипом из WhatsApp; прозрачно все данные; распиши таксы понятно; чаще
 * это с просьбой спросить владельца, сколько ставить за оплату труда — чтобы готовое короткое сообщение было»). Pure: what
 * every line is bought and sold for, each without VAT, its VAT and with it; the job's VAT — taken from the customer, paid
 * to the sellers, what is left to pay; the profit with VAT (as the garage's books count it — `jobProfit`) and without;
 * the sellers each with their lines. The PDF — pdf/ownerCheck.tsx; the data — services/ownerCheck.ts.
 */

export interface OwnerLine {
  name: string;
  qty: number;
  kind: OrderItem['kind'];
  /** The customer pays — after the line's own discount (`off`, without VAT). */
  sale: Amounts;
  off: number;
  /** Bought or paid out (none — not entered yet; a customer's own part — nothing). */
  buy?: Amounts;
  supplierId?: string;
  own?: boolean;
  /** Work handed outside (what we pay them is its «buy»). */
  outside?: boolean;
}

export interface OwnerExtra {
  name: string;
  buy: Amounts;
}

export interface OwnerSeller {
  supplierId: string;
  lines: { name: string; qty: number; buy?: Amounts }[];
  /** What they are paid for this job, with VAT (lines whose cost is known). */
  total: number;
}

export interface OwnerCheck {
  parts: OwnerLine[];
  work: OwnerLine[];
  /** The job's other expenses (towing, consumables…) and what was paid for parts beyond their lines' costs. */
  extra: OwnerExtra[];
  /** The job's own discount (its discount lines), negative. */
  discount: Amounts;
  /** What the customer pays in all; what went out in all — each without VAT, its VAT, with it. */
  sale: Amounts;
  buy: Amounts;
  vat: { out: number; in: number; due: number };
  profit: { gross: number; net: number };
  /** Lines with no price for the customer; parts with no cost. */
  unpriced: number;
  noCost: number;
  sellers: OwnerSeller[];
  /** Ask the owner what to charge for the labour: the job has no labour charge, or one without a price. */
  askLabour: boolean;
}

const add = (a: Amounts, b: Amounts): Amounts => ({ net: a.net + b.net, vat: a.vat + b.vat, gross: a.gross + b.gross });
const ZERO: Amounts = { net: 0, vat: 0, gross: 0 };

/** A cost as paid: what was typed without VAT and the seller's VAT (written, else at the line's rate — as `itemCostPaid`). */
function buyOf(i: OrderItem): Amounts | undefined {
  if (i.costPriceFils === undefined) return undefined;
  const net = roundFils(i.costPriceFils * i.qty);
  const vat = i.purchaseVatFils ?? (i.kind === 'part' ? vatOf(net, i.vatRateBp) : 0);
  return { net, vat, gross: net + vat };
}

export function ownerCheckOf(input: {
  items: OrderItem[];
  expenses: Pick<Expense, 'id' | 'amountFils' | 'vatFils' | 'categoryId' | 'vendor' | 'note' | 'voidedAt'>[];
  partsCategoryId?: string;
  categoryName: (id: string) => string;
  /** The job's profit with VAT as the books count it (`jobProfit`). */
  profit: number;
  /** What was paid for parts beyond their lines' costs (as `jobProfit` counts it), with VAT. */
  partsBeyond: number;
  docLang: Lang;
  beyondName: string;
  /** The garage's VAT rate: the VAT in what was paid beyond the lines (an expense of the book, VAT in it). */
  vatRateBp: number;
}): OwnerCheck {
  const live = liveLines(input.items);
  const lines = live.filter((i) => i.kind !== 'discount');
  const expenseOf = (id?: string) => (id ? input.expenses.find((e) => e.id === id && !e.voidedAt) : undefined);
  const line = (i: OrderItem): OwnerLine => {
    const outside = i.kind !== 'part' && !!i.outsource;
    // Work outside already paid: what the expense that paid it says.
    const paid = outside ? expenseOf(i.outsource?.expenseId) : undefined;
    const buy = i.customerSupplied ? undefined : paid ? { net: paid.amountFils - paid.vatFils, vat: paid.vatFils, gross: paid.amountFils } : i.kind === 'part' || outside ? buyOf(i) : undefined;
    return {
      name: itemTitle(i, input.docLang) || '—',
      qty: i.qty,
      kind: i.kind,
      sale: itemAmounts(i),
      off: itemOff(i),
      ...(buy ? { buy } : {}),
      supplierId: (i.kind === 'part' ? i.supplierId : i.outsource?.supplierId) || undefined,
      ...(i.customerSupplied ? { own: true } : {}),
      ...(outside ? { outside: true } : {}),
    };
  };
  const parts = lines.filter((i) => i.kind === 'part').map(line);
  const work = lines.filter((i) => i.kind !== 'part').map(line);
  const paidOutside = new Set(lines.map((i) => (i.kind !== 'part' ? i.outsource?.expenseId : undefined)).filter(Boolean));
  const extra: OwnerExtra[] = input.expenses
    .filter((e) => !e.voidedAt && !paidOutside.has(e.id) && !(input.partsCategoryId && e.categoryId === input.partsCategoryId))
    .map((e) => ({ name: [input.categoryName(e.categoryId), e.vendor || e.note].filter(Boolean).join(' · ') || '—', buy: { net: e.amountFils - e.vatFils, vat: e.vatFils, gross: e.amountFils } }));
  if (input.partsBeyond > 0) {
    const net = roundFils((input.partsBeyond * 10000) / (10000 + input.vatRateBp));
    extra.unshift({ name: input.beyondName, buy: { net, vat: input.partsBeyond - net, gross: input.partsBeyond } });
  }
  const discount = live.filter((i) => i.kind === 'discount').map(itemAmounts).reduce(add, ZERO);
  const sale = add([...parts, ...work].map((l) => l.sale).reduce(add, ZERO), discount);
  const buy = [...[...parts, ...work].flatMap((l) => (l.buy ? [l.buy] : [])), ...extra.map((x) => x.buy)].reduce(add, ZERO);
  const sellers = new Map<string, OwnerSeller>();
  for (const l of [...parts, ...work]) {
    if (!l.supplierId || l.own) continue;
    const s = sellers.get(l.supplierId) ?? { supplierId: l.supplierId, lines: [], total: 0 };
    s.lines.push({ name: l.name, qty: l.qty, ...(l.buy ? { buy: l.buy } : {}) });
    s.total += l.buy?.gross ?? 0;
    sellers.set(l.supplierId, s);
  }
  const labour = work.filter((l) => !l.outside && isLabourCharge(l.name));
  return {
    parts,
    work,
    extra,
    discount,
    sale,
    buy,
    vat: { out: sale.vat, in: buy.vat, due: sale.vat - buy.vat },
    profit: { gross: input.profit, net: sale.net - buy.net },
    unpriced: [...parts, ...work].filter((l) => !l.own && l.sale.gross === 0).length,
    noCost: parts.filter((l) => !l.own && !l.buy).length,
    sellers: [...sellers.values()].sort((a, b) => b.total - a.total),
    askLabour: !labour.length || labour.some((l) => l.sale.gross === 0),
  };
}
