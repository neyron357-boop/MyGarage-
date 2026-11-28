import { db } from '../db/db';
import { optionable } from '../domain/quoteOptions';
import { chatRole, kindOf, whoOf, type WaChat, type WaEvent, type WaMessage } from '../domain/whatsapp';
import { goesOn, namesCar, requestPlan, worthAsking, type AiRequest, type RequestPlan } from '../domain/waRequest';
import { lineName } from '../domain/items';
import type { QuoteOption } from '../domain/types';
import { aiVoiceText, askAi, notifyAi } from './ai';
import { claimOnce } from './claim';
import { mulkiyaOf, setMulkiya } from './cover';
import { readMulkiyaExpiry } from './mulkiya';
import { addNote } from './notes';
import { requestNews } from './newsWatch';
import { findVehicleByPlate } from './customers';
import { addItem, ensureLabourLine } from './estimate';
import { setBoardStatus } from './flow';
import { checkIn, deleteJob } from './orders';
import { putQuoteOptions } from './quoteOptions';
import { ensureChats, fetchChatMessages, loadChatRoles, loadPeople, onWaEvent, waFileBlob, waReady, waStore } from './whatsapp';
import { uid } from '../db/db';
import { nowIso } from '../domain/dates';

/*
 * A customer's request in WhatsApp made a job by itself (v0.90, the owner's note #69: «на такие запросы в ватсапе им должен
 * реагировать и автоматически создавать заявку/карточку заказа»). The messages a chat sends in a row are looked at a
 * minute after the last one (people write in pieces); the AI is asked only when the words name a car and ask something
 * (domain/waRequest.ts) — once for those messages, the last picture (a registration card) with them. A request with the
 * car's plate (said, or on the card) — a job of the board's «Заявки» (the car not here yet): the customer (the chat's
 * person; a forwarded request — its owner, if said), the car, the lines (original and copy — two lines and two options of
 * the quote, #72), the labour charge (#70); a card «Заявка из WhatsApp» with «Отменить». Suppliers, contractors, mechanics
 * and groups are not looked at; the boss and the garage's own people pass requests on (the owner's screenshot: forwarded to
 * the garage) — the car's owner is whom the messages name, not them.
 * v0.98 (the manager: «чат от владельца гаража… техпаспорта, пересылает сообщения клиентов с жалобами… список запчастей… мне
 * нужно, чтобы и мониторил, и все это за меня автоматически делал»; until then it had made no job at all — it ran on the
 * phone alone, only while open there, and a burst was 1,8 s long: the messages' time is in ms): any open device does it,
 * the first to claim it on the server (`claimOnce`); what came while none was open is caught up at the start and every ten
 * minutes; the boss's voice notes are heard and his pictures and forwards are enough to ask; the registration card goes onto
 * the car (its VIN and expiry read); the same car again — its open job takes the new lines. The job then goes on by itself
 * as far as it may (domain/autopilot.ts).
 * v1.03 (the owner: «ИИ быстро и моментально прочитал новые входящие сообщения и обрабатывал быстро»): looked at 20 s after the
 * last message (a minute before), the chats one after another as they come (a second one waited 15 s more); a piece that goes
 * on with a request just made («also the brakes» 30 s later, a voice note) is looked at with the messages before it
 * (`goesOn`) — its lines go onto that job.
 */

const WAIT_MS = 20_000;
/** The messages of one request: within this of the last one. */
const BURST_MS = 30 * 60_000;
const SEEN_KEY = 'mygarage.waRequest.seen';

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** The last message of each chat already looked at (on this device: only the main one looks). */
function seen(): Record<string, number> {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(SEEN_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}
function markSeen(chat: string, t: number) {
  const all = seen();
  all[chat] = Math.max(all[chat] ?? 0, t);
  // A few hundred chats at most: the oldest go.
  const keep = Object.entries(all)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 300);
  globalThis.localStorage?.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(keep)));
}

/** A picture as the AI takes it: at most 1280 px, JPEG. */
async function pictureOf(m: WaMessage): Promise<{ type: string; data: string } | undefined> {
  const file = await waFileBlob(m).catch(() => undefined);
  if (!file || !file.type.startsWith('image/') || typeof createImageBitmap === 'undefined') return undefined;
  const bmp = await createImageBitmap(file).catch(() => undefined);
  if (!bmp) return undefined;
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const url = c.toDataURL('image/jpeg', 0.85);
  c.width = c.height = 0;
  return { type: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) };
}

/** The job made of the request: in «Заявки», its lines, its labour charge and — original and copy — two options. */
export async function makeRequestJob(plan: RequestPlan, chat: Pick<WaChat, 'id' | 'name' | 'phone'>, forwarded: boolean, complaint: string, lastMsg: string, card?: Blob): Promise<{ orderId: string; number: number; merged?: boolean; added: number } | undefined> {
  if (!plan.plate) return undefined;
  // Made of these messages already (a device's second look, the same request again): not twice.
  const open = await db.orders.filter((o) => o.fromChat?.chat === chat.id && o.fromChat.msg === lastMsg).count();
  if (open) return undefined;
  const people = await loadPeople();
  const who = chatRole({ id: chat.id, phone: chat.phone, group: false }, people, await loadChatRoles());
  const known = await findVehicleByPlate(plan.plate);
  // v0.98: the car has a job open (more parts said later, another forward about it): the lines go onto it — not a second job.
  const current = known
    ? (await db.orders.where('vehicleId').equals(known.vehicle.id).toArray())
        .filter((o) => o.stage !== 'closed' && o.stage !== 'cancelled' && !o.archivedAt)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    : undefined;
  if (current) {
    const have = new Set((await db.items.where('orderId').equals(current.id).toArray()).flatMap((i) => [i.titleEn, i.titleRu].filter((x): x is string => !!x).map((x) => lineName(x).toUpperCase())));
    let added = 0;
    for (const l of plan.lines) {
      if (have.has(lineName(l.titleEn).toUpperCase())) continue;
      await addItem(current.id, { kind: l.kind, block: 'A', qty: 1, titleEn: l.titleEn });
      added++;
    }
    if (added) await ensureLabourLine(current.id);
    // The new words: the complaint when it had none, else a note of the job (the manager reads what was said).
    if (complaint) {
      if (!current.complaint?.trim()) await db.orders.update(current.id, { complaint });
      else await addNote(current.id, { text: `WhatsApp: ${complaint}` });
    }
    await db.orders.update(current.id, { fromChat: { chat: chat.id, msg: lastMsg } });
    if (card) await keepCard(current.vehicleId, card);
    return { orderId: current.id, number: current.number, merged: true, added };
  }
  const person = whoOf({ phone: chat.phone, group: false }, people);
  const customerId = !forwarded && person?.kind === 'customer' ? person.id : undefined;
  const order = await checkIn({
    ...(known ? { vehicleId: known.vehicle.id } : {}),
    ...(customerId ? { customerId } : {}),
    plate: plan.plate,
    make: plan.make,
    model: plan.model,
    year: plan.year,
    vin: plan.vin,
    // A forwarded request: the chat's person passed it on — the car's owner is whom it names (no number).
    name: forwarded ? plan.owner : who === 'customer' ? '' : chat.name.replace(/^\+?[\d\s-]+$/, ''),
    phone: forwarded ? '' : chat.phone ? `+${chat.phone}` : '',
    docLanguage: 'en',
    complaint,
    arrivedNow: false,
  });
  await db.orders.update(order.id, { fromChat: { chat: chat.id, msg: lastMsg } });
  await setBoardStatus([order.id], 'request');
  const ids: { id: string; side?: 'original' | 'copy' }[] = [];
  for (const l of plan.lines) ids.push({ id: (await addItem(order.id, { kind: l.kind, block: 'A', qty: 1, titleEn: l.titleEn })).id, side: l.side });
  await ensureLabourLine(order.id);
  if (plan.options) {
    const items = (await db.items.where('orderId').equals(order.id).toArray()).filter(optionable);
    const of = (drop: 'original' | 'copy') => items.filter((i) => ids.find((x) => x.id === i.id)?.side !== drop).map((i) => i.id);
    const at = nowIso();
    const options: QuoteOption[] = [
      { id: uid(), name: 'Original', itemIds: of('copy'), createdAt: at },
      { id: uid(), name: 'Aftermarket', itemIds: of('original'), createdAt: at },
    ];
    await putQuoteOptions(order.id, options);
  }
  if (card) await keepCard(order.vehicleId, card);
  return { orderId: order.id, number: order.number, added: plan.lines.length };
}

/**
 * The car's registration card sent with the request (v0.98): its Mulkiya when it has none — then read on this device for
 * its expiry (services/mulkiya.ts) and its VIN (services/vinReader.ts), in the background.
 */
async function keepCard(vehicleId: string, card: Blob): Promise<void> {
  if ((await mulkiyaOf(vehicleId)).mulkiya) return;
  await setMulkiya(vehicleId, 'mulkiya', card);
  void (async () => {
    await readMulkiyaExpiry(vehicleId).catch(() => undefined);
    const { readCarVin } = await import('./vinReader');
    await readCarVin(vehicleId);
  })().catch(() => undefined);
}

/** The chats to look at, one after another (v1.03: a queue — before, a second chat waited fifteen seconds and tried again). */
let line: Promise<void> = Promise.resolve();
const queued = new Map<string, Promise<void>>();

/** The chat's last messages in a row, looked at: a request — a job. */
export function considerChat(chatId: string): Promise<void> {
  // Waiting already: that look reads the newest messages too.
  const waiting = queued.get(chatId);
  if (waiting) return waiting;
  const p = line.then(async () => {
    queued.delete(chatId);
    await lookAtChat(chatId);
  });
  queued.set(chatId, p);
  line = p.catch(() => undefined);
  return p;
}

async function lookAtChat(chatId: string): Promise<void> {
  try {
    const chat = waStore().chats.find((c) => c.id === chatId);
    if (!chat || chat.group || chat.self) return;
    const [people, roles] = await Promise.all([loadPeople(), loadChatRoles()]);
    // The boss's chat is one of the garage's own (its reports go there) — and requests come through it.
    const role = chatRole(chat, people, roles);
    // Suppliers, contractors, mechanics: not customers' requests; nor a chat «Не относится к гаражу» by hand (v0.91.7).
    if (role === 'supplier' || role === 'service' || role === 'employee' || roles.off?.has(chatId)) return;
    const all = (await fetchChatMessages(chatId, 30)).sort((a, b) => a.t - b.t);
    const last = [...all].reverse().find((m) => !m.me);
    const was = seen()[chatId] ?? 0;
    if (!last || last.t <= was) return;
    // The messages in a row (not ours), within half an hour of the last one, not looked at yet.
    // (v0.98: the time is the message's own, in ms; and the voice notes are in it — the boss says what to do.)
    const voice = (m: WaMessage) => kindOf(m.type) === 'voice' || kindOf(m.type) === 'audio';
    const usable = (m: WaMessage) => !m.me && last.t - m.t <= BURST_MS && (m.text.trim() || m.type === 'image' || (voice(m) && (m.file?.sec ?? 0) <= 180));
    const burst = all.filter((m) => usable(m) && m.t > was);
    // v1.03: those looked at before — when they made a job (its last message is among them), the new ones may go on with it.
    const earlier = all.filter((m) => usable(m) && m.t <= was);
    markSeen(chatId, last.t);
    const job = earlier.length
      ? await db.orders.filter((o) => o.fromChat?.chat === chatId && o.stage !== 'closed' && o.stage !== 'cancelled' && !o.archivedAt && earlier.some((m) => m.id === o.fromChat?.msg)).first()
      : undefined;
    const work = role === 'work';
    const forwarded = burst.some((m) => m.fwd);
    const pictures = burst.filter((m) => m.type === 'image');
    const models = new Set((await db.vehicles.toArray()).flatMap((v) => (v.model ?? '').toLowerCase().split(/\s+/)).filter((w) => w.length >= 3));
    const plain = burst.filter((m) => !voice(m)).map((m) => m.text.trim());
    const hear = (work || !!job) && burst.some(voice);
    // Worth a look at all (the words alone, before a voice note is heard): a customer's chat — its words; the boss's — more.
    if (!worthAsking(plain, models, { work, forwarded, picture: pictures.length > 0 }) && !hear && !(job && goesOn(plain, models))) return;
    // v0.98: whichever device of the garage saw it first does it — once (the PC at the desk, the phone when it is open).
    if (!(await claimOnce(`request:${chatId}:${last.id}`))) return;
    const words = async (list: WaMessage[], heard: boolean): Promise<string[]> => {
      const out: string[] = [];
      for (const m of list) {
        const tag = m.fwd ? '[fwd] ' : '';
        if (m.type === 'image') out.push(`${tag}[photo]${m.text.trim() ? ` ${m.text.trim()}` : ''}`);
        else if (voice(m)) {
          // (the messages before: their voice notes were heard then — not again)
          const text = heard ? await aiVoiceText(m.id) : undefined;
          if (text?.text.trim()) out.push(`${tag}[voice] ${(text.english || text.text).trim()}`);
        } else out.push(`${tag}${m.text.trim()}`);
      }
      return out;
    };
    const fresh = await words(burst, true);
    // Goes on with the job just made (no car of its own): looked at with the messages before it.
    const carry = !!job && !namesCar(fresh.join('\n'), models) && goesOn(fresh, models);
    const texts = carry ? [...(await words(earlier, false)), ...fresh] : fresh;
    const pic = pictures.at(-1) ?? (carry ? earlier.filter((m) => m.type === 'image').at(-1) : undefined);
    const passed = forwarded || (carry && earlier.some((m) => m.fwd));
    if (!fresh.length || !worthAsking(texts, models, { work, forwarded: passed, picture: !!pic })) return;
    const image = pic ? await pictureOf(pic) : undefined;
    const said = await askAi<AiRequest>('request', { texts, ...(image ? { image } : {}) }, `request:${chatId}`, 60_000);
    const plan = requestPlan(said);
    if (!plan) return;
    // The registration card goes onto the car (its own file, not the AI's small copy).
    const card = plan.registration && pic ? await waFileBlob(pic).catch(() => undefined) : undefined;
    // The words of the new messages only (those before are on the job already).
    const complaint = fresh
      .filter((x) => !x.startsWith('[photo]') && !x.startsWith('[fwd] [photo]'))
      .map((x) => x.replace(/^\[fwd\] /, '').replace(/^\[voice\] /, '🎤 '))
      .join(' · ')
      .slice(0, 300);
    // Passed on (forwarded, or by the garage's own people — the boss): the chat's person is not the car's owner.
    const relay = passed || work;
    const made = await makeRequestJob(plan, chat, relay, complaint, last.id, card);
    if (!made || (made.merged && !made.added)) return;
    // v0.97: told at once to the other devices — the car, who, how many lines (v0.98: what is next — the prices to ask).
    void requestNews(made.orderId, chat?.name ?? '', [plan.make, plan.model, plan.year].filter(Boolean).join(' '), made.added).catch(() => false);
    notifyAi({
      kind: 'request',
      orderId: made.orderId,
      number: made.number,
      car: [plan.make, plan.model, plan.year].filter(Boolean).join(' '),
      undo: async () => void (await deleteJob(made.orderId, { withRecords: true })),
    });
  } catch {
    // The AI or the server out of reach: nothing made; the next message looks again.
  }
}

/**
 * What came while no device of the garage was open (v0.98): the chats whose last message — theirs, of the last day — was not
 * looked at here, looked at now, one after another (the server says which device does each — `claimOnce`).
 */
export async function catchUpRequests(now = Date.now()): Promise<number> {
  if (!waReady()) return 0;
  await ensureChats();
  const was = seen();
  const due = waStore()
    .chats.filter((c) => !c.group && !c.self && c.last && !c.last.me && c.last.t > (was[c.id] ?? 0) && now - c.last.t < 24 * 3600_000)
    .sort((a, b) => (b.last?.t ?? 0) - (a.last?.t ?? 0))
    .slice(0, 12);
  for (const c of due) await considerChat(c.id);
  return due.length;
}

let started = false;
/** Once, at the app's start: a customer's messages — looked at a minute after the last one; what came before — caught up. */
export function startWaRequests() {
  if (typeof window === 'undefined' || started) return;
  started = true;
  let caught = false;
  const catchUp = () => {
    if (caught || !waReady()) return;
    caught = true;
    void catchUpRequests().catch(() => 0);
  };
  catchUp();
  // And every ten minutes (a device left open all day: a message heard while it slept).
  setInterval(() => void catchUpRequests().catch(() => 0), 10 * 60_000);
  onWaEvent((ev) => {
    const e = ev as WaEvent;
    // WhatsApp ready (the app opened before it was): what came while nothing was open.
    if (e.t === 'state' && e.state.phase === 'ready') catchUp();
    if (e.t !== 'msg' || e.msg.me || !e.chat || e.chat.group || e.chat.self) return;
    const id = e.chat.id;
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        void considerChat(id);
      }, WAIT_MS),
    );
  });
}

