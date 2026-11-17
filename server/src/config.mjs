import path from 'node:path';

/*
 * The server's settings, from the environment (Docker sets them in docker-compose.yml; on Windows the defaults hold).
 */

export const VERSION = '1.0.0';

export function loadConfig(env = process.env) {
  const win = process.platform === 'win32';
  const list = (s) =>
    s
      .split(',')
      .map((x) => x.trim().replace(/\/+$/, ''))
      .filter(Boolean);
  /** Where everything is kept: the database, photos, documents, backups. */
  const dataDir = env.DATA_DIR || (win ? 'C:\\MyGarage' : '/data');
  return {
    dataDir,
    /** The app's API (the phone reaches it through the tunnel). */
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT) || 8787,
    /** The page for this computer only: pairing codes, devices, the folder. */
    adminHost: env.ADMIN_HOST || '127.0.0.1',
    adminPort: Number(env.ADMIN_PORT) || 8788,
    /** Where the app is opened from (its pages may call the server). */
    origins: list(env.ALLOWED_ORIGINS || 'https://neyron357-boop.github.io,http://localhost:5173,http://localhost:5181,http://localhost:4173'),
    /** The server's address for the phone (when known in advance; else learnt from the first request). */
    publicUrl: (env.PUBLIC_URL || '').replace(/\/+$/, ''),
    maxFileBytes: (Number(env.MAX_FILE_MB) || 300) * 1024 * 1024,
    /**
     * Cloudflare's quick tunnel (cloudflared), turned on from this computer's page — on Windows (in Docker the address
     * comes from Tailscale). Empty: not offered.
     */
    tunnelExe: env.TUNNEL_EXE ?? (win ? path.join(dataDir, 'Служебное', 'cloudflared', 'cloudflared.exe') : ''),
    /** How many daily copies of the database to keep. */
    keepBackups: Number(env.KEEP_BACKUPS) || 30,
  };
}
