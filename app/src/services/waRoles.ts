import { unknownChats, type WaChat, type WaEvent } from '../domain/whatsapp';
import { aiChatRoles } from './ai';
import { getSettings, saveSettings } from './settings';
import { loadChatRoles, loadPeople, onWaEvent, waStore } from './whatsapp';

/*
 * Who a chat is, said by the AI (v0.86, the owner: «ИИ должен мониторить входящие сообщения ватсап и присваивать им
 * статусы»): a chat the garage does not know — no one of the base by its number, no status given by hand, not one of its
 * groups — is shown to the AI by its name and its last words, a few at once (a light model, the answer kept by those
 * words on the server): customer or supplier — its status in the list (with the AI's mark); «other» — kept, not asked
 * again. The person's own status (`waChatTags`) always wins. Watched as messages come, and when the list is read.
 */

const asked = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;

/** The chats the AI has not been asked about, a few at a time (the newest first). */
export async function tagUnknownChats(chats: WaChat[] = waStore().chats): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const [people, roles] = await Promise.all([loadPeople(), loadChatRoles()]);
    const todo = unknownChats(chats, people, roles)
      .filter((c) => !asked.has(c.id))
      .slice(0, 12);
    if (!todo.length) return 0;
    for (const c of todo) asked.add(c.id);
    const said = await aiChatRoles(todo.map((c) => ({ id: c.id, name: c.name, texts: c.last?.text && !c.last.me ? [c.last.text] : [] })));
    if (!said.length) return 0;
    const kept = { ...((await getSettings()).waChatAi ?? {}) };
    for (const r of said) kept[r.id] = r.confidence >= 0.6 ? r.role : 'other';
    await saveSettings({ waChatAi: kept });
    return said.filter((r) => r.role !== 'other' && r.confidence >= 0.6).length;
  } finally {
    running = false;
  }
}

/** Once, at the app's start: a message from a chat not known yet — looked at a little later (a few together). */
export function startWaRoles() {
  if (typeof window === 'undefined') return;
  onWaEvent((ev) => {
    const e = ev as WaEvent;
    if (e.t !== 'msg' || e.msg.me || !e.chat || e.chat.group) return;
    clearTimeout(timer);
    timer = setTimeout(() => void tagUnknownChats().catch(() => undefined), 15_000);
  });
}
