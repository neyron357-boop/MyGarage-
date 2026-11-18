import { db } from '../db/db';
import { dubaiDate } from '../domain/dates';
import { checkWorkbook, customerWorkbook, periodText } from '../domain/customerExcel';
import { carPlate } from '../domain/historyPlan';
import { buyerName } from '../domain/invoice';
import { serviceReport, type ReportInvoice } from '../domain/serviceReport';
import type { Customer } from '../domain/types';
import type { ReportItem } from '../pdf/customerReport';
import { loadCatalog } from './catalog';
import { getSettings } from './settings';

/*
 * A customer's period as Excel (v0.46): the customer's workbook — the same invoices as the period's PDF
 * (pdf/customerReport.tsx `reportItems`: this app's and those from before it), each line with its service by the
 * catalogue (services/catalog.ts) — and, where the period has invoices from before the app, the garage's own check of
 * them against the monthly summaries typed by hand (whole months: a summary is a month's). Both made before the button is
 * pressed: a phone shares a file only in the tap itself.
 */

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fileName = (s: string) => s.replace(/[\\/:*?"<>|]/g, ' ');

/** A report item as the figures read it: its lines are the rows of its page (the Tax Invoice as drawn). */
export function reportInvoice(it: ReportItem): ReportInvoice {
  return {
    number: it.number,
    date: it.date,
    plate: it.plate,
    vehicle: it.vehicle,
    ...(it.vehicleType ? { type: it.vehicleType } : {}),
    netFils: it.page.total - it.page.vat,
    vatFils: it.page.vat,
    totalFils: it.totalFils,
    lines: it.page.rows.map((r) => ({ description: r.description, qty: r.qty, unitNetFils: r.price ?? 0, netFils: r.total - (r.vat ?? 0), vatFils: r.vat ?? 0, grossFils: r.total })),
  };
}

export interface ReportExcels {
  /** The customer's workbook; none — no invoices in the period. */
  client?: File;
  /** The garage's own check; none — no invoices from before the app in the period's months. */
  check?: File;
  /** Lines of the period no service is known for (they are «Other» in the workbook). */
  unmapped: number;
}

const monthEnd = (m: string) => `${m}-${String(new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate()).padStart(2, '0')}`;

export async function reportExcels(customer: Customer, from: string, to: string, items: ReportItem[]): Promise<ReportExcels> {
  const [settings, catalog] = await Promise.all([getSettings(), loadCatalog()]);
  const name = buyerName(customer);
  const out: ReportExcels = { unmapped: 0 };
  if (items.length) {
    const report = serviceReport(items.map(reportInvoice), catalog);
    out.unmapped = report.unmapped.reduce((a, u) => a + u.lines, 0);
    const bytes = customerWorkbook(report, { customer: name, garage: settings.name, from, to, vatRateBp: settings.vatRateBp, made: dubaiDate() });
    out.client = new File([bytes as BlobPart], fileName(`${name} — Service report ${periodText(from, to)}.xlsx`), { type: XLSX });
  }
  // The check: whole months (each summary is a month's).
  const [m0, m1] = [from.slice(0, 7), to.slice(0, 7)];
  const inMonths = (m: string) => m >= m0 && m <= m1;
  const history = (await db.historyInvoices.where('customerId').equals(customer.id).toArray()).filter((h) => inMonths(h.date.slice(0, 7)));
  if (history.length) {
    const rows = (await db.historySummaryRows.where('customerId').equals(customer.id).toArray()).filter((r) => inMonths(r.month));
    const orderIds = [...new Set(history.map((h) => h.orderId).filter((id): id is string => !!id))];
    const orders = new Map((await db.orders.bulkGet(orderIds)).filter((o) => !!o).map((o) => [o!.id, o!]));
    const carIds = [...new Set(history.map((h) => h.vehicleId))];
    const cars = new Map((await db.vehicles.bulkGet(carIds)).filter((v) => !!v).map((v) => [v!.id, v!]));
    const [cFrom, cTo] = [`${m0}-01`, monthEnd(m1)];
    const bytes = checkWorkbook({
      customer: name,
      from: cFrom,
      to: cTo,
      invoices: history,
      rows,
      jobNumber: (id) => {
        const o = orders.get(id);
        return o ? String(o.number) : undefined;
      },
      carPlate: (id) => {
        const v = cars.get(id);
        return v ? carPlate(v.plate) : undefined;
      },
    });
    out.check = new File([bytes as BlobPart], fileName(`${name} — INTERNAL check ${periodText(cFrom, cTo)}.xlsx`), { type: XLSX });
  }
  return out;
}
