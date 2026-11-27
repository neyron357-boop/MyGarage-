import { callJson } from './sync/api';
import { syncConfig } from './sync/config';

/*
 * One piece of work for one device (v0.98): what any open device of the garage may do by itself — a request in WhatsApp
 * made a job — is done by the first that asks the garage's server for it (`POST /api/claim`). No server — nobody: it is not
 * done twice when it comes back.
 */

type Transport = (key: string) => Promise<boolean>;
let transport: Transport | undefined;
/** The server played by a test. */
export function setClaimTransport(t: Transport | undefined) {
  transport = t;
}

export async function claimOnce(key: string): Promise<boolean> {
  try {
    if (transport) return await transport(key);
    const cfg = syncConfig();
    if (!cfg) return false;
    const r = await callJson<{ ok: boolean; mine: boolean }>(cfg, '/api/claim', { method: 'POST', body: { key }, timeout: 15_000 });
    return !!r.mine;
  } catch {
    return false;
  }
}
