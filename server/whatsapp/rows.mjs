/*
 * What the bridge says of a chat and of a message: plain rows made from WhatsApp Web's own records, as whatsapp-web.js
 * hands them over (a message's `_data`, a chat read on the page). No dependency — the server's tests read it.
 *
 * A row carries only what the app shows. A message's file is not in it (asked for by the message's id, bridge.mjs);
 * its small preview is — the blurred picture WhatsApp itself sends with a photo.
 */

/** An id as WhatsApp Web keeps it (an object with `_serialized`, lately `$1`) or as text. */
export const ser = (x) => (x && typeof x === 'object' ? x._serialized || x.$1 || '' : typeof x === 'string' ? x : '');

/** The digits of a person's number in a chat's or a sender's id («971501234567@c.us»): none for a group, none where WhatsApp hides the number (@lid). */
export function phoneOf(id) {
  const m = /^(\d{6,15})@c\.us$/.exec(String(id || ''));
  return m ? m[1] : '';
}

/** A chat's address the bridge takes: a person, a group, a hidden-number person. */
export const CHAT_ID = /^[0-9A-Za-z._-]{3,80}@(c\.us|g\.us|lid)$/;
/** A message's id, as WhatsApp serializes it («true_9715…@c.us_3EB0…»). */
export const MESSAGE_ID = /^(true|false)_[0-9A-Za-z._@:-]{5,200}$/;

/** Notices of WhatsApp itself (encryption, a group's changes, a protocol's): not messages of the chat. */
const HIDDEN = new Set([
  'e2e_notification',
  'notification',
  'notification_template',
  'gp2',
  'group_notification',
  'broadcast_notification',
  'protocol',
  'ciphertext',
  'debug',
  'reaction',
  'oversized',
  'unknown',
  'payment',
  'album',
  'native_flow',
  'interactive',
]);
/** Types that come with a file. */
const FILES = new Set(['image', 'video', 'ptt', 'audio', 'document', 'sticker']);
/** Types whose `body` is their words (a file's `body` is its preview). */
const WORDS = new Set(['chat', 'list', 'list_response', 'buttons_response', 'template_button_reply', 'hsm', 'groups_v4_invite']);

const clip = (s, n) => {
  const t = typeof s === 'string' ? s : '';
  return t.length > n ? t.slice(0, n) : t;
};
/** A photo's small preview, as WhatsApp sends it: a JPEG in base64 — nothing else is passed on. */
const thumbOf = (s) => (typeof s === 'string' && s.length > 100 && s.length <= 40_000 && s.startsWith('/9j/') ? s : undefined);
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined);

/** A contact card's name and number (the first `waid`, else the first TEL). */
function cardOf(d) {
  const body = typeof d.body === 'string' ? d.body : '';
  const waid = /waid=(\d{6,15})/.exec(body)?.[1];
  const tel = /TEL[^:\n]*:([+\d\s()-]{6,24})/.exec(body)?.[1];
  const name = clip(d.vcardFormattedName || /FN:([^\n\r]+)/.exec(body)?.[1] || '', 120).trim();
  const phone = waid || (tel ? tel.replace(/\D/g, '') : '');
  return name || phone ? { name, phone } : undefined;
}

/** The words of a message of this type: its text, or a file's caption (not its name said twice). */
function wordsOf(d, type) {
  if (type === 'poll_creation') return clip(d.pollName || d.body, 4000);
  if (WORDS.has(type)) return clip(d.body, 20_000);
  if (FILES.has(type)) {
    const caption = typeof d.caption === 'string' ? d.caption : '';
    return clip(caption && caption !== d.filename ? caption : '', 20_000);
  }
  if (type === 'location') return clip(d.loc || '', 400);
  return '';
}

/**
 * A message as the app shows it — none for WhatsApp's own notices.
 * `me`: the account's own id (to say whose message a quoted one was).
 */
export function messageRow(d, { me = '' } = {}) {
  if (!d || !d.id) return null;
  const id = ser(d.id);
  const type = String(d.type || 'unknown');
  if (!id || HIDDEN.has(type) || d.isNotification) return null;
  const chat = typeof d.id.remote === 'string' ? d.id.remote : ser(d.id.remote);
  if (!chat || chat === 'status@broadcast') return null;
  const fromMe = !!d.id.fromMe;
  const row = {
    id,
    chat,
    t: (Number(d.t) || 0) * 1000,
    me: fromMe,
    type,
    text: wordsOf(d, type),
    ack: Number.isFinite(Number(d.ack)) ? Number(d.ack) : 0,
  };
  if (FILES.has(type)) {
    row.file = {
      mime: clip(d.mimetype, 100) || undefined,
      name: clip(d.filename, 200) || undefined,
      size: num(d.size),
      sec: num(d.duration),
      w: num(d.width),
      h: num(d.height),
      thumb: thumbOf(d.body),
      // Still on WhatsApp's servers (an old file is only on the phone).
      here: !!d.directPath,
    };
  }
  // In a group: who wrote it.
  const author = ser(d.author);
  if (author && !fromMe) row.from = { id: author, name: clip(d.notifyName, 80) || undefined, phone: phoneOf(author) || undefined };
  if (d.quotedMsg && typeof d.quotedMsg === 'object') {
    const q = d.quotedMsg;
    const qType = String(q.type || 'chat');
    const by = ser(d.quotedParticipant);
    row.quote = {
      id: clip(d.quotedStanzaID, 120) || undefined,
      type: qType,
      text: clip(wordsOf(q, qType), 300),
      me: !!me && !!by && by.split('@')[0] === me.split('@')[0],
      thumb: thumbOf(q.body),
    };
  }
  if (type === 'location') row.place = { lat: Number(d.lat), lng: Number(d.lng) };
  if (type === 'vcard' || type === 'multi_vcard') row.card = cardOf(d);
  if (d.isForwarded) row.fwd = true;
  if (d.star) row.star = true;
  return row;
}

/**
 * A message as the app studies a chat (v0.91, `/api/wa/messages?lite=1`): who, when, its kind and its words — no preview
 * picture, no quote, no file (the garage's requests and the supplier's answers are read off a chat's last messages in a
 * few kilobytes, through the tunnel too).
 */
export function liteRow(row) {
  if (!row) return null;
  return { id: row.id, t: row.t, me: !!row.me, type: row.type, text: clip(row.text ?? '', 600) };
}

/** A message in a line of the chats' list: no preview picture, a few words. */
export function lastRow(row) {
  if (!row) return null;
  return { id: row.id, t: row.t, me: row.me, type: row.type, text: clip(row.text, 160), ack: row.ack, name: row.file?.name, sec: row.file?.sec, from: row.from?.name };
}

/**
 * A chat of the list, from what the page read (bridge.mjs `PAGE_CHATS`): `{ id, name, group, unread, t, archived,
 * pinned, muted, phone, last }` with `last` a message's record.
 */
export function chatRow(c, { me = '' } = {}) {
  const id = ser(c?.id);
  if (!id || !CHAT_ID.test(id)) return null;
  const group = !!c.group || id.endsWith('@g.us');
  const phone = group ? '' : String(c.phone || phoneOf(id) || '').replace(/\D/g, '');
  return {
    id,
    name: clip(c.name, 120).trim(),
    group,
    phone,
    unread: Math.max(0, Number(c.unread) || 0),
    t: (Number(c.t) || 0) * 1000,
    archived: !!c.archived,
    pinned: !!c.pinned,
    muted: !!c.muted,
    // The account's own chat («Вы»).
    self: !!me && !group && (id.split('@')[0] === me.split('@')[0] || (!!phone && phone === me.split('@')[0])),
    last: lastRow(messageRow(c.last, { me })),
  };
}

/** The chats in the list's order: the newest first (the app puts the pinned on top itself). */
export function sortChats(rows) {
  return [...rows].sort((a, b) => b.t - a.t || (a.id < b.id ? -1 : 1));
}
