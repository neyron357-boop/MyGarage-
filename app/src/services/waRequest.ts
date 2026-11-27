import { db } from '../db/db';
import { optionable } from '../domain/quoteOptions';
import { chatRole, whoOf, type WaChat, type WaEvent, type WaMessage } from '../domain/whatsapp';
import { looksLikeRequest, requestPlan, type AiRequest, type RequestPlan } from '../domain/waRequest';
import type { QuoteOption } from '../domain/types';
import { askAi, notifyAi } from './ai';
import { requestNews } from './newsWatch';
import { findVehicleByPlate } from './customers';
import { addItem, ensureLabourLine } from './estimate';
import { setBoardStatus } from './flow';
import { checkIn, deleteJob } from './orders';
import { putQuoteOptions } from './quoteOptions';
import { syncConfig, syncState } from './sync/config';
import { fetchChatMessages, loadChatRoles, loadPeople, onWaEvent, waFileBlob, waStore } from './whatsapp';
import { uid } from '../db/db';
import { nowIso } from '../domain/dates';

/*
 * A customer's request in WhatsApp made a job by itself (v0.90, the owner's note #69: «на такие запросы в ватсапе им должен
 * реагировать и автоматически создавать заявку/карточку заказа»). The messages a chat sends in a row are looked at a
 * minute after the last one (people write in pieces); the AI is asked only when the words name a car and ask something
 * (domain/waRequest.ts) — once for those messages, the last picture (a registration card) with them. A request with the
 * car's plate (said, or on the card) — a job of the board's «Заявки» (the car not here yet): the customer (the chat's
 * person; a forwarded request — its owner, if said), the car, the lines (original and copy — two lines and two options of
 * the quote, #72), the labour charge (#70); a card «Заявка из WhatsApp» with «Отменить». One device does it — the main one
 * (the phone): two devices would make it twice. Suppliers, contractors, mechanics and groups are not looked at; the boss and
 * the garage's own people pass requests on (the owner's screenshot: forwarded to the garage) — the car's owner is whom the
 * messages name, not them.
 */

const WAIT_MS = 60_000;
/** The messages of one request: within this of the last one. */
const BURST_MS = 30 * 60_000;
const SEEN_KEY = 'mygarage.waRequest.seen';

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** The last message of each chat already looked at (on this device: only the main one looks). */
function seen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number>;
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
  localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(keep)));
}

/** This device is the garage's main one (the phone): it alone makes jobs of requests. */
const isMain = () => {
  const cfg = syncConfig();
  const main = syncState().main;
  return !!cfg && !!main && main.id === cfg.deviceId;
};

/** A picture as the AI takes it: at most 1280 px, JPEG. */
async function pictureOf(m: WaMessage): Promise<{ type: string; data: string } | undefined> {
  const file = await waFileBlob(m).catch(() => undefined);
  if (!file || !file.type.startsWith('image/')) return undefined;
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
export async function makeRequestJob(plan: RequestPlan, chat: Pick<WaChat, 'id' | 'name' | 'phone'>, forwarded: boolean, complaint: string, lastMsg: string): Promise<{ orderId: string; number: number } | undefined> {
  if (!plan.plate) return undefined;
  // Made of these messages already (a device's second look, the same request again): not twice.
  const open = await db.orders.filter((o) => o.fromChat?.chat === chat.id && o.fromChat.msg === lastMsg).count();
  if (open) return undefined;
  const people = await loadPeople();
  const who = chatRole({ id: chat.id, phone: chat.phone, group: false }, people, await loadChatRoles());
  const known = await findVehicleByPlate(plan.plate);
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
  return { orderId: order.id, number: order.number };
}

let running = false;

/** The chat's last messages in a row, looked at: a request — a job. */
export async function considerChat(chatId: string): Promise<void> {
  if (!isMain()) return;
  // One at a time: another chat's turn comes a little later.
  if (running) {
    setTimeout(() => void considerChat(chatId), 15_000);
    return;
  }
  running = true;
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
    const burst = all.filter((m) => !m.me && m.t > was && last.t - m.t <= BURST_MS / 1000 && (m.text.trim() || m.type === 'image'));
    markSeen(chatId, last.t);
    const texts = burst.map((m) => (m.type === 'image' ? `[photo]${m.text.trim() ? ` ${m.text.trim()}` : ''}` : m.text.trim()));
    const models = new Set((await db.vehicles.toArray()).flatMap((v) => (v.model ?? '').toLowerCase().split(/\s+/)).filter((w) => w.length >= 3));
    if (!looksLikeRequest(texts, models)) return;
    const pic = [...burst].reverse().find((m) => m.type === 'image');
    const image = pic ? await pictureOf(pic) : undefined;
    const said = await askAi<AiRequest>('request', { texts, ...(image ? { image } : {}) }, `request:${chatId}`, 60_000);
    const plan = requestPlan(said);
    if (!plan) return;
    const complaint = burst
      .filter((m) => m.type !== 'image' && m.text.trim())
      .map((m) => m.text.trim())
      .join(' · ')
      .slice(0, 300);
    // Passed on (forwarded, or by the garage's own people — the boss): the chat's person is not the car's owner.
    const relay = burst.some((m) => m.fwd) || role === 'work';
    const made = await makeRequestJob(plan, chat, relay, complaint, last.id);
    if (!made) return;
    // v0.97: told at once to the other devices — the car, who, how many lines.
    void requestNews(made.orderId, chat?.name ?? '', [plan.make, plan.model, plan.year].filter(Boolean).join(' '), plan.lines.length).catch(() => false);
    notifyAi({
      kind: 'request',
      orderId: made.orderId,
      number: made.number,
      car: [plan.make, plan.model, plan.year].filter(Boolean).join(' '),
      undo: async () => void (await deleteJob(made.orderId, { withRecords: true })),
    });
  } catch {
    // The AI or the server out of reach: nothing made; the next message looks again.
  } finally {
    running = false;
  }
}

/** Once, at the app's start: a customer's messages — looked at a minute after the last one. */
export function startWaRequests() {
  if (typeof window === 'undefined') return;
  onWaEvent((ev) => {
    const e = ev as WaEvent;
    if (e.t !== 'msg' || e.msg.me || !e.chat || e.chat.group || e.chat.self || !isMain()) return;
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

