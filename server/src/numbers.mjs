/*
 * Job and invoice numbers (v0.42.3, the user: «номера инвойсов должны идти по возрастанию, job номер и инвойс номер
 * одинаковые … формат простой: INV-2026-319 … чтобы на один номер не было двух разных заказов … новые заказы, которых
 * нет в Eaglecart, — от 350 и выше, другим — такие же номера, как в Eaglecart»).
 *
 * The garage's server keeps them right, whatever a device sends (store.mjs push):
 *  - a job's number never changes once the server has the job (a device behind cannot bring an old one back);
 *  - a new job whose number another job already has — or, made here (not from Eaglecart), below 350 — gets the next free
 *    one (the device that made it gets it back at once);
 *  - an invoice's number is its job's: the invoice in force — «INV-2026-319»; those a credit note cancelled —
 *    «INV-2026-319-1», «-2» in the order they were issued; credit notes «CN-2026-319», «-2» — the year each was issued
 *    in (Dubai).
 */

export const FIRST_OWN = 350;

/** The year in Dubai of a moment. */
export const dubaiYear = (iso) => new Date((Date.parse(iso) || Date.now()) + 4 * 3600_000).getUTCFullYear();

export const docNumber = (prefix, year, jobNo, nth = 1) => `${prefix}-${year}-${jobNo}${nth > 1 ? `-${nth}` : ''}`;

/** A job brought from Eaglecart: its number is Eaglecart's. */
export const fromEaglecart = (o) => o?.imported?.system === 'eaglecart';

/** A job made here that is an Eaglecart job: it carries Eaglecart's number (`eaglecartNo`), below 350 too. */
export const eaglecartNumbered = (o) => o?.eaglecartNo !== undefined && Number(o.eaglecartNo) === Number(o.number);

/**
 * The numbers a job's invoices should have: the invoice in force — the job's own number; those a credit note
 * cancelled — the same with «-1», «-2» in the order they were issued; credit notes in the order they were issued.
 */
export function invoiceNumbers(jobNo, invoices) {
  const out = new Map();
  const byTime = (a, b) => String(a.issuedAt).localeCompare(String(b.issuedAt)) || String(a.id).localeCompare(String(b.id));
  invoices
    .filter((i) => i.type === 'credit_note')
    .sort(byTime)
    .forEach((i, n) => out.set(i.id, docNumber('CN', dubaiYear(i.issuedAt), jobNo, n + 1)));
  const list = invoices.filter((i) => i.type !== 'credit_note').sort(byTime);
  const inForce = [...list].reverse().find((i) => i.status !== 'credited');
  let k = 0;
  for (const i of list) out.set(i.id, docNumber('INV', dubaiYear(i.issuedAt), jobNo) + (i === inForce ? '' : `-${++k}`));
  return out;
}

/**
 * Every job numbered once more: a job from Eaglecart keeps Eaglecart's number; a job made here takes the Eaglecart job
 * it is (`fixed`: id → number), else the next from `floor` in the order the jobs were made; every invoice its job's.
 * Returns the jobs and invoices whose numbers change and the job counter to keep.
 */
export function planRenumber(orders, invoices, { floor = FIRST_OWN, fixed = {} } = {}) {
  const number = new Map();
  const used = new Set();
  for (const o of orders) {
    if (fixed[o.id] !== undefined) number.set(o.id, Number(fixed[o.id]));
    // From Eaglecart, or made here as an Eaglecart job before: Eaglecart's number stays.
    else if (fromEaglecart(o) || eaglecartNumbered(o)) number.set(o.id, Number(o.number));
    else continue;
    if (used.has(number.get(o.id))) throw new Error(`number ${number.get(o.id)} twice`);
    used.add(number.get(o.id));
  }
  let next = floor;
  const own = orders.filter((o) => !number.has(o.id)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.number - b.number);
  for (const o of own) {
    while (used.has(next)) next++;
    number.set(o.id, next);
    used.add(next);
  }
  const orderChanges = orders
    .filter((o) => o.number !== number.get(o.id) || (fixed[o.id] !== undefined && Number(o.eaglecartNo) !== Number(fixed[o.id])))
    .map((o) => ({ id: o.id, from: o.number, to: number.get(o.id), ...(fixed[o.id] !== undefined ? { eaglecart: true } : {}) }));
  const byOrder = new Map();
  for (const i of invoices) byOrder.set(i.orderId, [...(byOrder.get(i.orderId) ?? []), i]);
  const invoiceChanges = [];
  for (const [orderId, list] of byOrder) {
    const jobNo = number.get(orderId);
    if (jobNo === undefined) continue;
    const want = invoiceNumbers(jobNo, list);
    for (const i of list) if (want.get(i.id) !== i.number) invoiceChanges.push({ id: i.id, orderId, from: i.number, to: want.get(i.id) });
  }
  const counter = Math.max(floor - 1, ...number.values());
  return { orders: orderChanges, invoices: invoiceChanges, counter, numbers: number };
}
