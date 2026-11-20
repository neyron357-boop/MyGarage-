// Domain types. Field names follow docs/04-data-model.md (camelCase in code).
// Money is always integer fils (1 AED = 100 fils). VAT rates are basis points (500 = 5%).

export type Lang = 'ru' | 'en';
export type Emirate = 'DXB' | 'AUH' | 'SHJ' | 'AJM' | 'RAK' | 'UAQ' | 'FUJ';
export type Channel = 'whatsapp' | 'telegram' | 'call';
/**
 * How money moved: cash (the cash box), card, bank transfer — or past the garage's cash box and card (`outside`, v0.27): an
 * expense paid with other money (the owner's own…) — not a debt; money in the owner took himself. It counts as income or an
 * expense all the same; no cash moves, no card total.
 */
export type PayMethod = 'cash' | 'card' | 'transfer' | 'outside';
/** How an expense is paid: at once (cash, card, transfer) — or on credit: owed by the garage, paid later in parts. */
export type ExpenseMethod = PayMethod | 'credit';
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
  /** Its body (v0.45): a fleet's reports group the cars by it. */
  type?: VehicleType;
  /**
   * The garage's AI read this VIN (v0.48, domain/ai.ts): asked once a VIN — what it filled (only empty fields), and what
   * they were, for «Отменить».
   */
  vinAi?: { vin: string; at: string; filled: ('make' | 'model' | 'year' | 'engine' | 'type')[] };
  customerId: string;
  notes?: string;
  /** "Time for a service" sent (or dismissed) after its last job: it leaves the Today list until the next one. */
  serviceRemindedAt?: string;
  createdAt: string;
  archivedAt?: string;
}

/** A car's body, as a fleet's report names it (v0.45): Pickup, Van / Minibus, Bus, Truck, SUV, MPV, Sedan. */
export type VehicleType = 'pickup' | 'van' | 'bus' | 'truck' | 'suv' | 'mpv' | 'sedan';

/**
 * An invoice the garage gave a customer before this app, read off its PDF (v0.45 — a corporate customer's history, May–October 2026):
 * the document as it is — its number, day, car, lines and sums as printed. Not this app's invoice: it is not revenue,
 * VAT, a debt or money here; it goes into the customer's reports. One record per document: the same document read again
 * is the same record (`id` — the template, the kind of number, the number and the day: numbers repeat between the two
 * templates).
 */
export interface HistoryInvoice {
  id: string;
  customerId: string;
  /** The car (the printed plate's; a plate that is surely a typo — the car it is, with a flag). */
  vehicleId: string;
  /** The job in MyGarage it is the invoice of — an Eaglecart job brought in as history (July–October). */
  orderId?: string;
  /** 'A' — the old template (May–June: "INVOICE # 224", Item · Quantity · Rate · Amount); 'B' — the Tax Invoice. */
  template: 'A' | 'B';
  /** The number printed: an invoice's ("INVOICE #", "Invoice Number") or a job's ("Job ID"). */
  numberKind: 'invoice' | 'job';
  number: string;
  /** YYYY-MM-DD, as printed; `time` — "4:50 PM" when printed. */
  date: string;
  time?: string;
  /** The plate as printed ("PLATE NO.EE-12345", "W - 12345") and as code-number ("EE-12345"). */
  plateRaw: string;
  plate: string;
  /** The car as printed ("NISSAN URVAN", "Nissan Urvan (White)"); the VIN when printed. */
  vehicleText: string;
  vin?: string;
  lines: HistoryLine[];
  /** Without VAT, the VAT, with VAT — the lines' sums (equal to what is printed: checked when read). */
  netFils: number;
  vatFils: number;
  totalFils: number;
  paymentMethod?: string;
  /** Where it was read: the file (its SHA-256), the page; `pages` — when it goes on (May's 224: its terms). */
  source: { file: string; sha256: string; page: number; pages?: number };
  /** What does not agree, marked — nothing is put right silently. */
  flags?: HistoryFlag[];
  importedAt: string;
}

/** A line of a history invoice: the work or part as printed, its quantity and sums; its standard service. */
export interface HistoryLine {
  description: string;
  qty: number;
  /** Price of one, without VAT, as printed. */
  unitNetFils: number;
  /** The line's discount without VAT, when printed (Tax Invoice's Discount column). */
  discountFils?: number;
  netFils: number;
  /** ROUND(net × rate) — the line's VAT. */
  vatFils: number;
  grossFils: number;
}

export interface HistoryFlag {
  /**
   * job-sum — the job here has another sum; job-car — the job here is on another car; job-twin — its job is the one
   * Eaglecart's double of it was taken into; no-job — no job here; plate — the printed plate is not a car of the customer,
   * the car it surely is is named; new-car — a car brought in with it.
   */
  code: 'job-sum' | 'job-car' | 'job-twin' | 'no-job' | 'plate' | 'new-car';
  text: string;
}

/**
 * A row of a month's summary page (v0.45): typed by hand there, so kept apart from the invoices and matched with them —
 * for the garage's own check, never for the customer. `kind: 'total'` — the summary's printed TOTAL.
 */
export interface HistorySummaryRow {
  id: string;
  customerId: string;
  /** YYYY-MM */
  month: string;
  kind: 'row' | 'total';
  /** Its place in the summary (1…); the total — 0. */
  no: number;
  date?: string;
  vehicleText?: string;
  plateRaw?: string;
  plate?: string;
  invoiceNo?: string;
  amountFils: number;
  /** The invoice it is (none — no document for it). */
  invoiceId?: string;
  /** ok · amount (another sum) · plate (another plate: a typo) · plate-amount · missing (no document). */
  status: 'ok' | 'amount' | 'plate' | 'plate-amount' | 'missing' | 'total';
  source: { file: string; sha256: string; page: number };
  importedAt: string;
}

/** A category of the standard services (v0.45): «Engine», «Brakes»… — edited in the app. */
export interface ServiceCategory {
  id: string;
  name: string;
  position: number;
  archivedAt?: string;
}

/**
 * A standard service (v0.45): what a line of an invoice is, whatever its words — «Oil change (engine oil + filter)».
 * `keywords` — the rules: a line whose words hold one of them is this service (the longest that fits wins); `kind: 'oil'`
 * — an oil change (a fleet's report counts them per car).
 */
export interface Service {
  id: string;
  name: string;
  categoryId: string;
  keywords: string[];
  /** oil — an oil change (counted on each car); labour — a line that starts with its words is labour, whatever it names after. */
  kind?: 'oil' | 'labour';
  position: number;
  archivedAt?: string;
}

/** A description as printed → its standard service (v0.45): the catalogue's own entries, a rule's find, or by hand. */
export interface ServiceMapEntry {
  /** The description's key: upper case, its spaces and marks evened (`descKey`). */
  id: string;
  description: string;
  serviceId: string;
  by: 'seed' | 'rule' | 'hand';
  at: string;
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
/** A scanner's report imported into a job (services/obd.ts). */
export interface ObdScan {
  id: string;
  importedAt: string;
  /** When the car was scanned, as the report says. */
  testedAt?: string;
  tool?: string;
  codes: { code: string; full: string; description: string; state: string; system: string }[];
  odometer?: { value: number; unit: 'km' | 'mi' };
  vin?: string;
  /** The report itself (PDF in media). */
  mediaId?: string;
  /** What the import put into the check-in act still open then (v0.22), so deleting the scan takes back just that. */
  intoAct?: ObdIntoAct;
}

/** A scan's share of a check-in act: codes it added, the mileage it filled, whether the act said "no codes" before. */
export interface ObdIntoAct {
  id: string;
  codes: string[];
  mileageKm?: number;
  noCodesBefore?: boolean;
}

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
  /**
   * Eaglecart's own double entries of this job (the same car, day and work under another number there), taken out of
   * MyGarage: an import of Eaglecart does not bring them in again.
   */
  twins?: { jobId: string; jobNo: string }[];
}

export interface Order {
  id: string;
  number: number;
  /**
   * A job made here that is an Eaglecart job (v0.42.3): its number is Eaglecart's (below 350, where the garage's own
   * start); the garage's server keeps it so (server/src/numbers.mjs).
   */
  eaglecartNo?: number;
  customerId: string;
  vehicleId: string;
  stage: Stage;
  outcome: Outcome;
  complaint: string;
  /** The first of `mechanicIds` (a job before v0.17.2 has only this one) — read through `mechanicsOf`. */
  mechanicId?: string;
  /** The mechanics on the job, in the order they were put on it (domain/crew.ts). */
  mechanicIds?: string[];
  docLanguage: Lang;
  bookedFor?: string;
  arrivedAt?: string;
  /**
   * Typed in after the fact (v0.53): the job is on the day it was — `arrivedAt` and `createdAt` on that day; its
   * invoice is offered on it, its steps are stamped with its own moments (`domain/jobDay.ts`).
   */
  backdated?: boolean;
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
  /** Scanner reports read into the job (oldest first): the fault codes and the car's data at that moment. */
  obdScans?: ObdScan[];
  /** Taken off the board by hand (a swipe): the job itself — stage, documents, money — stays as it is. */
  archivedAt?: string;
  /**
   * Closed without payment and without a debt (warranty, goodwill, the money will not come): what was
   * due then is let go — the job owes nothing. Reopening the job takes it back.
   */
  waived?: {
    at: string;
    fils: number;
    /**
     * 'owner' — the customer settled with the garage's owner directly (the manager does not know how):
     * the job is closed and owes nothing, and nothing goes into the manager's cash or money book. The
     * revenue stays the garage's (the profit is not cut). Without it — the money will not come at all.
     */
    via?: 'owner';
  };
  /** "How is the car?" asked a few days after the car left (or the reminder dismissed): it leaves the Today list. */
  followedUpAt?: string;
  /**
   * Who brought the car this time (v0.43) — a company's driver mostly: as he was then (his name and phone may change
   * in the list of drivers later; the job keeps them). Not the customer: the job, its invoices and debts stay theirs.
   */
  driver?: JobDriver;
  /** The car's mileage on this visit, km (v0.44): read off the odometer's photo when sure, or typed / looked at. */
  mileageKm?: number;
  /** What the odometer's photo was read as when not sure, best first ([] — nothing read): waits to be looked at. */
  mileageOffered?: number[];
  stageChangedAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A driver of the garage's customers (v0.43) — a company's mostly: who brings its cars. Never a customer, never owes:
 * the jobs he brings are the company's. One record however many cars (and companies) he brings.
 */
export interface Driver {
  id: string;
  name: string;
  /** E.164, or '' when not known. */
  phone: string;
  createdAt: string;
  updatedAt?: string;
  /** Taken off the list: not offered any more; the jobs he brought keep him as they had him. */
  archivedAt?: string;
}

/** The driver on a job (v0.43): his record in the list (`id`), with his name and phone as they were then. */
export interface JobDriver {
  id: string;
  name: string;
  phone: string;
}

/**
 * What happened on a job, in the manager's own words: what the mechanic found, what was checked, what
 * the customer was promised — typed, a photo, or a voice message recorded in the app. Not printed anywhere.
 */
export interface JobNote {
  id: string;
  /** The job; '' — the workshop's own note (`GARAGE_NOTES`, «Ещё» → «Заметки», v0.22). */
  orderId: string;
  kind: 'text' | 'photo' | 'video' | 'voice';
  text?: string;
  /** The photo, the video or the recording (media of the note). */
  mediaId?: string;
  /** Length of a voice note. */
  seconds?: number;
  /** A voice note's bars (0–1, domain/waveform.ts), kept from v0.17.2; older ones are read from the recording. */
  peaks?: number[];
  /** The note this one answers (a swipe to the right on it, v0.19). */
  replyTo?: string;
  createdAt: string;
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
  | 'return'
  /** A cash movement of the money book (parts bought for cash, cash handed over…): its proofs. */
  | 'movement'
  /** Money in outside a job's invoice (a sale, a small job): its photos (a slip, a transfer screenshot). */
  | 'income'
  /** Money paid towards an expense taken on credit: its photos (a slip, a transfer screenshot). */
  | 'credit'
  /** A supplier's business card (both sides). */
  | 'supplier'
  /** A job note's photo or voice message. */
  | 'note';

export interface Media {
  id: string;
  ownerType: MediaOwner;
  ownerId: string;
  slot: string;
  kind: 'photo' | 'video' | 'pdf' | 'signature' | 'audio';
  mime: string;
  size: number;
  sha256: string;
  name?: string;
  locked: boolean;
  createdAt: string;
}

export interface MediaBlob {
  id: string;
  /**
   * The file itself. Gone from the phone once the garage's server has it (v0.40: `up` = 1, the small previews stay):
   * read through `services/media.ts`, which brings it from the server.
   */
  blob?: Blob;
  thumb?: Blob;
  /** Sent to the server (1) or waiting (0); none — from before syncing (v0.40). */
  up?: number;
  /** Its preview and card are on the server (v0.41.3): the photo shows on the other devices while the original goes. */
  ready?: number;
  /**
   * The photo at a board card's size (1080 px, v0.37), made the first time a card shows it and kept: not made again at
   * every start. A photo's file never changes (a turned photo is a new one), so this copy never goes stale.
   */
  card?: Blob;
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
  /** The garage's AI looked at the part's name as typed (v0.48): what it was, so it is not asked again; «Отменить» puts it back. */
  aiName?: { from: string; to?: string; at: string };
  /** The part's numbers the AI found (v0.48, domain/ai.ts `AiFind`): candidates on the line, a proven one written itself. */
  aiFind?: {
    at: string;
    /** `web` — found by Google Search; `model` — the AI's own guess; `garage` — the garage's own jobs (v0.49, no AI). */
    search: 'web' | 'model' | 'garage';
    /** The name it was looked up by (a new name — looked up again). */
    part?: string;
    /**
     * `garage` — on how many of the garage's own lines for this car the number was (v0.49); `fits`, `name`, `model`,
     * `replaces` — the maker's catalogue's word on it (v0.55, domain/ai.ts `FoundNumber`).
     */
    numbers: { number: string; brand?: string; note?: string; seen: string[]; garage?: number; fits?: boolean; name?: string; model?: string; replaces?: string[] }[];
    filled?: string;
  };
  /** The part's diagram pictures taken off the catalogue pages (media, slot `diagram`) — the garage's, never sent with a quote. */
  diagramIds?: string[];
  /**
   * The part ringed on its diagram by the manager (v0.59, domain/diagramSheet.ts): the ring drawn on the sheet of
   * diagrams sent to a supplier — no AI; a diagram added by hand (a catalogue's screenshot) gets one the same way.
   */
  diagramMark?: { id: string; x: number; y: number; r: number };
  /** Photos of the part itself off the catalogue pages (v0.48.2, media, slot `sample`): what it looks like — not sent with a quote either. */
  sampleIds?: string[];
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
  /** Offers found for this part (original, aftermarket, used — who, how much, how soon); the chosen one is on the line. */
  offers?: PartOffer[];
  /** Ordered several, some came: how many are here (the line waits until all are). */
  receivedQty?: number;
  /** The seller takes the part back until this day (YYYY-MM-DD) — a reminder before it passes. */
  returnBy?: string;
  /** The seller said: no returns. */
  noReturn?: boolean;
  /** Work done outside (paint shop, machining, alignment, a mobile electrician): who, when it comes back, paid or not. */
  outsource?: Outsource;
  /** Who does this line (one of the mechanics); otherwise the job's mechanic. */
  employeeId?: string;
  /** Where the line stands among the job's lines once they were moved by hand (0 — first); the invoice keeps it. */
  position?: number;
  createdAt: string;
}

/** One offer for a part: what kind, from whom, at what cost (net, per unit), how soon. */
export interface PartOffer {
  id: string;
  kind: 'oem' | 'aftermarket' | 'used';
  costFils?: number;
  supplierId?: string;
  /** Days until it is here: 0 — today. */
  days?: number;
}

/** A line handed to someone outside the garage (a supplier marked as a contractor). The price to them is the line's cost. */
export interface Outsource {
  supplierId?: string;
  /** todo — still here · out — with them · back — done and returned. */
  state: 'todo' | 'out' | 'back';
  /** When they promised it back (YYYY-MM-DD). */
  dueAt?: string;
  sentAt?: string;
  backAt?: string;
  /** Paid to them: the money book's expense. */
  expenseId?: string;
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
  /** Car makes they work with ("Toyota", "Nissan"…); empty — any. */
  makes?: string[];
  /** New parts, used ones, or both. */
  condition?: 'new' | 'used' | 'both';
  /** What they sell or do, in a few words ("gearbox, electrics", "headlights"). */
  parts?: string;
  /** A contractor (paint, machining, alignment, mobile electrician) rather than a parts shop. */
  service?: boolean;
  /** Front and back of the business card (media). */
  cardMediaIds?: string[];
  /** Its row in the garage's supplier base workbook (UAE_Contacts.xlsx), when it came from there. */
  book?: SupplierBookRow;
  createdAt: string;
  archivedAt?: string;
}

/** A cell of the supplier base workbook: its text and its link. */
export interface BookCell {
  v: string;
  link?: string;
}

/**
 * A supplier as a row of the garage's supplier base workbook (UAE_Contacts.xlsx): its ID there and every column as
 * it came — an export gives back what the app has no field for (email, sites, all numbers, photos, area…).
 */
export interface SupplierBookRow {
  /** The base's own ID ("CT-0067"): a later import updates this supplier instead of adding another. */
  id: string;
  /** Its row on "Контакты", by column header. */
  contact?: Record<string, BookCell>;
  /** Its row on "Услуги для гаража" (a contractor). */
  service?: Record<string, BookCell>;
  /** Its row on the sheet of suppliers near the garage ("Рядом с …"). */
  nearby?: Record<string, BookCell>;
}

/** The supplier base workbook last brought in: its other sheets (photo log, questions) go back out as they were. */
export interface StoredBook {
  /** The supplier base workbook; the VIN characters learned off this garage's plates (v0.35, services/vinReader.ts). */
  id: 'suppliers' | 'vinGlyphs';
  name: string;
  savedAt: string;
  /** The .xlsx, in base64 (a backup carries it as text); the learned characters — JSON of their samples (domain/vinGlyphs.ts `KeptSample`). */
  data: string;
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
  /**
   * When it was typed in (v0.23.1). Typed for an earlier day, or moved to one, it is counted by that day's closing
   * (services/cashDays.ts); one from before — at the moment it was received.
   */
  typedAt?: string;
  /**
   * Received within an income (a "debt payment" taken at once and spread over the customer's jobs, v0.20): its
   * money is that income's — no cash movement of its own, not a line of the money book.
   */
  incomeId?: string;
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
  /** Money paid towards an expense taken on credit: its photos (a slip, a transfer screenshot). */
  | 'credit'
  | 'salary'
  | 'collection'
  | 'supplier_refund'
  | 'adjustment'
  | 'debt_payment'
  | 'credit_payment'
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
  /** Cash paid towards an expense taken on credit (`CreditPayment`). */
  creditPaymentId?: string;
  note?: string;
  closingId?: string;
}

/**
 * A category of money in (v0.26, table `incomeCategories` — made like `ExpenseCategory`): «Работа / ремонт»
 * (`service`), «Продажа» (`sales`), «Прочий приход» (`other`), «Emil» (`emil`) and the garage's own (`c_…`), each
 * renamed or taken out of the sheet (`active: false` — entries that have it still show its name). A customer's debt
 * paid (`debt`) is not one of them: it is a way of its own, always offered.
 */
export interface IncomeCategory {
  id: string;
  /** What an income keeps (`Income.category`). */
  code: string;
  nameRu: string;
  nameEn: string;
  active: boolean;
  /** Its place among the chips (new ones last). */
  position: number;
}

/**
 * Money received outside a job's invoice: a sold item ("Sales"), a small job done on the spot, other — or a
 * customer's debt paid ("debt": spread over their jobs as payments that carry this income's id; what is left over
 * stays an income of its own).
 */
export interface Income {
  id: string;
  date: string; // YYYY-MM-DD (Dubai)
  /** The code of its category (`IncomeCategory.code`), or 'debt'. */
  category: string;
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
  /**
   * v0.47 — a «debt payment» set, in part, against the customer's invoices from before the app (`historyInvoices`):
   * which got what. Its jobs' parts are their payments (`payment.incomeId`); what neither took is money in with no debt.
   */
  historyParts?: { invoiceId: string; amountFils: number }[];
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
  /** 'credit' — nothing paid yet: the garage owes it (no money moves; paid later with `CreditPayment`s). */
  method: ExpenseMethod;
  receiptMediaId?: string;
  /** The supplier it was bought from (v0.50.2: a receipt's seller) — «Мы должны» puts its credits under it. */
  supplierId?: string;
  /** What it was spent on: a job, or just a car / a customer (filled from the job when one is picked). */
  orderId?: string;
  vehicleId?: string;
  customerId?: string;
  note?: string;
  overLimitComment?: string;
  createdAt: string;
  /**
   * Paid in parts (v0.58): one purchase paid a part a way — each part an expense of its own (its way, its sum, its
   * share of the VAT); the parts share this id (domain/expenseParts.ts). Each is changed and deleted as any expense.
   */
  splitId?: string;
  /** Entered by mistake: cancelled (a cash entry is reversed in the cash book, nothing is deleted). */
  voidedAt?: string;
}

/**
 * Money paid towards an expense taken on credit (v0.20): the money moves now, by the way it is really paid; the
 * expense itself was counted once, when it was taken. Never changed or deleted — one made by mistake is cancelled.
 */
export interface CreditPayment {
  id: string;
  expenseId: string;
  method: PayMethod;
  amountFils: number;
  date: string; // YYYY-MM-DD (Dubai)
  paidAt: string;
  note?: string;
  /** Entered by mistake: cancelled (a cash one is reversed in the cash book, nothing is deleted). */
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
