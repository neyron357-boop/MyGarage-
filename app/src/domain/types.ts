// Domain types. Field names follow docs/04-data-model.md (camelCase in code).
// Money is always integer fils (1 AED = 100 fils). VAT rates are basis points (500 = 5%).

export type Lang = 'ru' | 'en';
export type Emirate = 'DXB' | 'AUH' | 'SHJ' | 'AJM' | 'RAK' | 'UAQ' | 'FUJ';
export type Channel = 'whatsapp' | 'telegram' | 'call';
export type PayMethod = 'cash' | 'card' | 'transfer';
export type Localized = { ru?: string; en?: string };

export interface Plate {
  emirate: Emirate;
  code: string;
  number: string;
}

export interface Settings {
  id: 'main';
  name: string;
  /** Name and address in Arabic: the right-hand side of the document header, as on the garage's invoices. */
  nameAr?: string;
  addressAr?: string;
  /** Arabic line of the document footer. */
  docFooterAr?: string;
  address: string;
  phone: string;
  email: string;
  trn: string;
  bankDetails: string;
  googleMapsUrl: string;
  logoDataUrl?: string;
  vatRateBp: number;
  pricesIncludeVat: boolean;
  defaultMarkupBp: number;
  laborRateFils: number;
  defaultNoCallLimitFils: number;
  prepaymentThresholdFils: number;
  estimateValidityDays: number;
  freeStorageDays: number;
  storageFeePerDayFils: number;
  diagnosticsFeeFils: number;
  warrantyLaborMonths: number;
  warrantyLaborKm: number;
  boardWarnHours: number;
  boardAlertHours: number;
  intakeTerms: Localized;
  warrantyText: Localized;
  docFooter: Localized;
  setupDone: boolean;
  /** The manager has gone through the starter price list (setup checklist). */
  pricesReviewed?: boolean;
  /** Opening balances of the money book ("Cash Start" / "Card Start" of the garage's money sheet). */
  cashStartFils?: number;
  cardStartFils?: number;
  /** The garage's own quick-pick lists (domain/quickLists.ts); missing → the standard English ones. */
  quickLists?: Partial<Record<'complaints' | 'warningLights' | 'functionChecks' | 'skipReasons', string[]>>;
}

export interface Customer {
  id: string;
  name: string;
  phone: string; // E.164
  whatsapp?: string;
  telegram?: string;
  preferredChannel: Channel;
  docLanguage: Lang;
  type: 'individual' | 'company';
  companyName?: string;
  trn?: string;
  address?: string;
  email?: string;
  source?: 'referral' | 'google_maps' | 'social' | 'signage' | 'repeat' | 'other';
  notes?: string;
  createdAt: string;
  archivedAt?: string;
}

export interface Vehicle {
  id: string;
  plate: Plate;
  plateSearch: string;
  vin?: string;
  make: string;
  model: string;
  year?: number;
  engine?: string;
  color?: string;
  customerId: string;
  notes?: string;
  createdAt: string;
  archivedAt?: string;
}

export interface Ownership {
  id: string;
  vehicleId: string;
  customerId: string;
  from: string;
  to?: string;
}

export type Stage =
  | 'booked'
  | 'intake'
  | 'diagnostics'
  | 'awaiting_approval'
  | 'awaiting_parts'
  | 'in_progress'
  | 'quality_check'
  | 'ready'
  | 'delivered'
  | 'closed'
  | 'cancelled';

export type Outcome = 'in_progress' | 'completed' | 'repair_declined' | 'no_show' | 'cancelled';

/**
 * A job carried over from the previous system (Eaglecart) with what was known there. History jobs
 * get no invoice or payment in MyGarage (money was not kept consistently there), so they are never
 * counted as owed and do not enter revenue or VAT reports.
 */
export interface ImportedFrom {
  system: 'eaglecart';
  jobId: string;
  /** Job number shown in Eaglecart. */
  jobNo: string;
  /** Status there: Pending, In Progress, Delivered, Quotation… */
  status: string;
  /** Eaglecart order the job was converted to (#1024), with the payment recorded there. */
  orderNo?: string;
  paidFils?: number;
  payMethod?: string;
  /** Job total there, gross. */
  totalFils: number;
  /** Closed history (true) or a job carried over to continue in MyGarage (false). */
  history: boolean;
  importedAt: string;
}

export interface Order {
  id: string;
  number: number;
  customerId: string;
  vehicleId: string;
  stage: Stage;
  outcome: Outcome;
  complaint: string;
  mechanicId?: string;
  docLanguage: Lang;
  bookedFor?: string;
  arrivedAt?: string;
  readyAt?: string;
  deliveredAt?: string;
  closedAt?: string;
  promisedReadyAt?: string;
  warrantyOfOrderId?: string;
  cancelReason?: string;
  qcChecks?: Record<string, boolean>;
  qcDoneAt?: string;
  testDriveStartKm?: number;
  testDriveEndKm?: number;
  storageWaived?: boolean;
  /** Carried over from Eaglecart. */
  imported?: ImportedFrom;
  stageChangedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderEvent {
  id: string;
  orderId: string;
  at: string;
  type: string;
  payload?: Record<string, unknown>;
}

export type FuelLevel = 0 | 25 | 50 | 75 | 100;
export type CheckState = 'ok' | 'fail' | 'unchecked';

/**
 * Terms of an intake act. Since the fast check-in only the test-drive permission (and the ready date,
 * kept on the order) is asked; the other fields remain for acts signed before.
 */
export interface IntakeConditions {
  testDriveAllowed: boolean;
  noCallLimitFils?: number;
  oldParts?: 'return' | 'dispose';
  freeStorageDays?: number;
  storageFeePerDayFils?: number;
  diagnosticsFeeFils?: number;
  promisedReadyAt?: string;
}

export interface Inspection {
  id: string;
  orderId: string;
  kind: 'intake' | 'handover';
  step: number;
  mileageKm?: number;
  fuelLevel?: FuelLevel;
  warningLights: string[];
  obdCodes: string[];
  obdSkipReason?: string;
  obdNoCodes?: boolean;
  functionChecks: Record<string, CheckState>;
  keysCount?: number;
  spareWheel?: boolean;
  jack?: boolean;
  mulkiyaInCar?: boolean;
  belongings?: string;
  complaint?: string;
  accidentRepair?: boolean;
  policeReportNo?: string;
  noDamage?: boolean;
  skippedPhotos: Record<string, string>;
  conditions?: IntakeConditions;
  testDriveKm?: number;
  language: Lang;
  signerName?: string;
  signatureMediaId?: string;
  signedAt?: string;
  /** Intake saved by the manager (with or without the customer's signature); the job moves on. */
  completedAt?: string;
  locked: boolean;
  pdfMediaId?: string;
  pdfSha256?: string;
  createdAt: string;
}

export type DamageView = 'top' | 'left' | 'right' | 'front' | 'rear';
export type DamageType = 'scratch' | 'dent' | 'chip' | 'crack' | 'rust' | 'other';

export interface DamageMark {
  id: string;
  inspectionId: string;
  view: DamageView;
  x: number;
  y: number;
  type: DamageType;
  note?: string;
  mediaId?: string;
}

export interface Addendum {
  id: string;
  inspectionId: string;
  text: string;
  createdAt: string;
}

export type MediaOwner =
  | 'inspection'
  | 'order'
  | 'item'
  | 'expense'
  | 'incident'
  | 'claim'
  | 'vehicle'
  | 'debt'
  | 'invoice'
  | 'version'
  | 'payment'
  | 'return';

export interface Media {
  id: string;
  ownerType: MediaOwner;
  ownerId: string;
  slot: string;
  kind: 'photo' | 'video' | 'pdf' | 'signature';
  mime: string;
  size: number;
  sha256: string;
  name?: string;
  locked: boolean;
  createdAt: string;
}

export interface MediaBlob {
  id: string;
  blob: Blob;
  thumb?: Blob;
}

export type ItemKind = 'labor' | 'part' | 'fee' | 'discount';
export type Block = 'A' | 'B' | 'C';
export type Urgency = 'red' | 'yellow' | 'green';
export type ApprovalState = 'draft' | 'pending' | 'approved' | 'declined' | 'cancelled';
export type ProcurementStatus =
  | 'needed'
  | 'ordered'
  | 'in_transit'
  | 'received'
  | 'installed'
  | 'returned'
  | 'cancelled';

export interface OrderItem {
  id: string;
  orderId: string;
  kind: ItemKind;
  block: Block;
  titleRu?: string;
  titleEn?: string;
  qty: number;
  unit: 'pcs' | 'h' | 'l' | 'set';
  unitPriceFils: number; // net, per unit
  /**
   * The VAT-inclusive unit price when the price was typed with VAT ("VAT in the price"): the line's
   * gross is exactly qty × this and its VAT is taken out of it; `unitPriceFils` holds the net equivalent.
   */
  unitGrossFils?: number;
  /** A discount line given as a percentage (basis points, 1000 = 10 %): it follows the lines while a draft. */
  discountPctBp?: number;
  priceMinFils?: number; // block B: net line total
  priceMaxFils?: number; // block B: net line total
  vatRateBp: number;
  urgency?: Urgency;
  ifNotDoneRu?: string;
  ifNotDoneEn?: string;
  approvalState: ApprovalState;
  bChoice?: 'call_me' | 'do_if_needed';
  bNeeded?: boolean;
  introducedInVersionId?: string;
  lastVersionId?: string;
  done: boolean;
  doneAt?: string;
  templateId?: string;
  mediaIds?: string[];
  // parts
  partNumber?: string;
  brand?: string;
  customerSupplied?: boolean;
  supplierId?: string;
  costPriceFils?: number;
  purchaseVatFils?: number;
  procurementStatus?: ProcurementStatus;
  orderedAt?: string;
  expectedAt?: string;
  receivedAt?: string;
  receiptMediaId?: string;
  warrantyMonths?: number;
  createdAt: string;
}

export type VersionKind = 'initial' | 'supplement' | 'price_change';
export type SendVia = 'whatsapp' | 'telegram' | 'in_person' | 'phone' | 'limit' | 'b_preapproved';

export interface SnapshotItem {
  itemId: string;
  kind: ItemKind;
  block: Block;
  title: string;
  qty: number;
  unit: OrderItem['unit'];
  net: number;
  vat: number;
  gross: number;
  /** VAT rate of the line (not kept on quotations sent before v0.5.1). */
  vatRateBp?: number;
  minGross?: number;
  maxGross?: number;
  urgency?: Urgency;
  ifNotDone?: string;
  customerSupplied?: boolean;
}

export interface EstimateVersion {
  id: string;
  orderId: string;
  number: number;
  kind: VersionKind;
  reason?: string;
  language: Lang;
  items: SnapshotItem[];
  fixedGross: number;
  maxGross: number;
  recommendedGross: number;
  mediaIds: string[];
  /** withdrawn: every item was taken back before the customer answered (it did not go out, or was changed). */
  status: 'sent' | 'answered' | 'expired' | 'withdrawn';
  validUntil: string;
  sentAt: string;
  sentVia: SendVia;
  answeredAt?: string;
}

export type DecisionKind = 'approve' | 'decline' | 'call_me' | 'do_if_needed';
export type DecisionVia = 'messenger' | 'phone' | 'in_person' | 'limit' | 'b_preapproved' | 'link';

export interface ItemDecision {
  id: string;
  versionId: string;
  itemId: string;
  orderId: string;
  decision: DecisionKind;
  via: DecisionVia;
  decidedAt: string;
  note?: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  locationUrl?: string;
  address?: string;
  notes?: string;
  reliability?: number;
  createdAt: string;
  archivedAt?: string;
}

export interface SupplierReturn {
  id: string;
  itemId: string;
  orderId: string;
  supplierId?: string;
  reason: string;
  expectedRefundFils: number;
  refundType: 'money' | 'replacement' | 'credit';
  status: 'open' | 'closed';
  createdAt: string;
  closedAt?: string;
}

export interface Payment {
  id: string;
  orderId: string;
  customerId: string;
  kind: 'prepayment' | 'payment' | 'refund';
  method: PayMethod;
  amountFils: number;
  reference?: string;
  receiptNumber: string;
  receivedAt: string;
}

export type InvoiceType = 'tax_invoice' | 'simplified_tax_invoice' | 'credit_note';

export interface InvoiceLine {
  description: string;
  kind: ItemKind;
  qty: number;
  unit: OrderItem['unit'];
  unitPriceFils: number;
  net: number;
  vatRateBp: number;
  vat: number;
  gross: number;
  customerSupplied?: boolean;
}

export interface PartySnapshot {
  name: string;
  nameAr?: string;
  addressAr?: string;
  address?: string;
  trn?: string;
  phone?: string;
  email?: string;
}

export interface Invoice {
  id: string;
  number: string;
  type: InvoiceType;
  orderId: string;
  originalInvoiceId?: string;
  issuedAt: string;
  seller: PartySnapshot;
  buyer: PartySnapshot;
  lines: InvoiceLine[];
  subtotalFils: number;
  vatFils: number;
  totalFils: number;
  currency: 'AED';
  reason?: string;
  status: 'issued' | 'credited';
}

export interface Debt {
  id: string;
  orderId: string;
  customerId: string;
  amountFils: number;
  dueDate: string;
  signatureMediaId: string;
  signedAt: string;
  status: 'open' | 'paid' | 'written_off';
}

export type CashReason =
  | 'order_payment'
  | 'prepayment'
  | 'refund'
  | 'parts_purchase'
  | 'expense'
  | 'income'
  | 'salary'
  | 'collection'
  | 'supplier_refund'
  | 'adjustment'
  | 'other';

export interface CashMovement {
  id: string;
  at: string;
  direction: 'in' | 'out';
  amountFils: number;
  reason: CashReason;
  orderId?: string;
  paymentId?: string;
  expenseId?: string;
  incomeId?: string;
  note?: string;
  closingId?: string;
}

/** Money received outside a job's invoice: a sold item ("Sales"), a small job done on the spot, other. */
export type IncomeCategory = 'service' | 'sales' | 'other';

export interface Income {
  id: string;
  date: string; // YYYY-MM-DD (Dubai)
  category: IncomeCategory;
  amountFils: number; // gross
  method: PayMethod;
  /** What it was for: a job, or just the car / the customer. */
  orderId?: string;
  vehicleId?: string;
  customerId?: string;
  note?: string;
  createdAt: string;
  /** Entered by mistake: cancelled (a cash entry is reversed in the cash book, nothing is deleted). */
  voidedAt?: string;
}

export interface CashClosing {
  id: string;
  date: string; // YYYY-MM-DD (Dubai)
  openingFils: number;
  cashInFils: number;
  cashOutFils: number;
  expectedFils: number;
  actualFils: number;
  diffFils: number;
  comment?: string;
  cardTotalFils: number;
  transferTotalFils: number;
  closedAt: string;
}

export interface ExpenseCategory {
  id: string;
  code: string;
  nameRu: string;
  nameEn: string;
  monthlyLimitFils: number;
  active: boolean;
}

export interface Expense {
  id: string;
  date: string; // YYYY-MM-DD
  categoryId: string;
  amountFils: number; // gross
  vatFils: number;
  vendor?: string;
  method: PayMethod;
  receiptMediaId?: string;
  /** What it was spent on: a job, or just a car / a customer (filled from the job when one is picked). */
  orderId?: string;
  vehicleId?: string;
  customerId?: string;
  note?: string;
  overLimitComment?: string;
  createdAt: string;
  /** Entered by mistake: cancelled (a cash entry is reversed in the cash book, nothing is deleted). */
  voidedAt?: string;
}

export interface Employee {
  id: string;
  name: string;
  role: 'mechanic' | 'electrician' | 'other';
  monthlySalaryFils: number;
  phone?: string;
  active: boolean;
}

export interface SalaryPayment {
  id: string;
  employeeId: string;
  month: string; // YYYY-MM
  kind: 'advance' | 'salary' | 'bonus';
  amountFils: number;
  method: PayMethod;
  paidAt: string;
  expenseId?: string;
}

export interface MessageLog {
  id: string;
  orderId?: string;
  customerId: string;
  channel: Channel | 'in_person';
  template: string;
  language: Lang;
  text: string;
  createdAt: string;
}

export interface TemplateItem {
  kind: ItemKind;
  block: Block;
  titleRu: string;
  titleEn: string;
  qty: number;
  unit: OrderItem['unit'];
  unitPriceFils: number;
}

export interface JobTemplate {
  id: string;
  code: string;
  titleRu: string;
  titleEn: string;
  items: TemplateItem[];
  active: boolean;
}

export interface RelatedRule {
  id: string;
  triggerTemplateCode: string;
  titleRu: string;
  titleEn: string;
  priceMinFils: number;
  priceMaxFils: number;
}

export interface Claim {
  id: string;
  orderId: string;
  vehicleId: string;
  customerId: string;
  description: string;
  outcome?: 'rejected' | 'warranty' | 'goodwill';
  warrantyOrderId?: string;
  notes?: string;
  openedAt: string;
  closedAt?: string;
}

export interface Incident {
  id: string;
  orderId: string;
  employeeId?: string;
  description: string;
  damageEstimateFils: number;
  resolution?: string;
  status: 'open' | 'resolved';
  at: string;
}

export interface Counter {
  name: string;
  value: number;
}
