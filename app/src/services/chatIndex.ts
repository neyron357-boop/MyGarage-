import { db } from '../db/db';
import { supplierUse } from '../domain/supplierRank';
import type { KnownMake } from '../domain/chatStudy';
import type { ChatRoles } from '../domain/whatsapp';
import { loadChatMakes } from './chatStudy';
import { boughtLines, loadTop, TOP_TABLES, type TopSuppliers } from './supplierRank';
import { loadChatRoles, loadPeople } from './whatsapp';

/**
 * What the WhatsApp list knows of its chats, read once (v0.91.7: three reads of every chat's knowledge — the statuses, the
 * makes, the main suppliers — on each record the study wrote kept a phone busy): one read of the tables, all three from it.
 */
export interface ChatIndex {
  roles: ChatRoles;
  makes: { byChat: Map<string, KnownMake[]>; byPhone: Map<string, KnownMake[]> };
  top: TopSuppliers;
}

/** The tables it is read from (`useCalmQuery`). */
export const CHAT_INDEX_TABLES = [...TOP_TABLES];

export async function loadChatIndex(): Promise<ChatIndex> {
  const [facts, suppliers, lines, returns, people] = await Promise.all([db.chatFacts.toArray(), db.suppliers.toArray(), boughtLines(), db.supplierReturns.toArray(), loadPeople()]);
  const roles = await loadChatRoles({ facts });
  const [makes, top] = await Promise.all([
    loadChatMakes({ facts, suppliers }),
    loadTop({ facts, suppliers: suppliers.filter((s) => !s.archivedAt), use: supplierUse(lines, returns), people, roles }),
  ]);
  return { roles, makes, top };
}
