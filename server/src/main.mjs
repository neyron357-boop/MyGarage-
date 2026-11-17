import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { createAdmin } from './admin.mjs';
import { createApi, createPairing } from './api.mjs';
import { loadConfig, VERSION } from './config.mjs';
import { DIRS, openStore } from './store.mjs';
import { createTunnel } from './tunnel.mjs';

/*
 * MyGarage's server: the app's data and files in one folder on this computer, synced to every paired device.
 * Runs in Docker (docker-compose.yml, with Tailscale for the address from any network) or straight on Windows with
 * Node (windows/…). Two ports: the app's API (reached through the tunnel) and this computer's own page.
 */

const config = loadConfig();
fs.mkdirSync(path.join(config.dataDir, DIRS.service), { recursive: true });
const logFile = path.join(config.dataDir, DIRS.service, 'server.log');
function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, `${logFile}.1`);
    fs.appendFileSync(logFile, `${line}\n`);
  } catch {
    // the log is a help, not a need
  }
}

const store = openStore(config.dataDir, { keepBackups: config.keepBackups, log });
const pairing = createPairing();
pairing.issue();

/** The address the phone uses: given, the Cloudflare tunnel's, learnt from a request through a tunnel, or Tailscale's. */
let learnt = store.metaGet('publicHost') || '';
let tunnelUrl = '';
const publicUrl = () => config.publicUrl || tunnelUrl || (learnt ? `https://${learnt}` : '');
const tunnel = createTunnel({
  exe: config.tunnelExe,
  port: config.port,
  log,
  onUrl: (u) => {
    tunnelUrl = u;
  },
});
function onSeen(host) {
  if (host === learnt || /:\d+$/.test(host)) return;
  learnt = host;
  store.metaSet('publicHost', host);
  log(`address: https://${host}`);
}
function askTailscale() {
  if (config.publicUrl) return;
  const exe = process.platform === 'win32' ? 'C:\\Program Files\\Tailscale\\tailscale.exe' : 'tailscale';
  execFile(exe, ['status', '--json'], { timeout: 5000, windowsHide: true }, (err, out) => {
    if (err) return;
    try {
      const name = String(JSON.parse(out)?.Self?.DNSName || '').replace(/\.$/, '');
      if (name) onSeen(name);
    } catch {
      // not running yet
    }
  });
}

function backupNow() {
  try {
    if (store.backup()) log('database copied to «Резервные копии»');
    store.metaSet('lastBackup', new Date().toLocaleDateString('sv'));
  } catch (e) {
    log(`backup failed: ${e.message}`);
  }
}

const api = createServer(createApi({ store, config, pairing, log, onSeen }));
api.requestTimeout = 0;
api.listen(config.port, config.host, () => log(`MyGarage server ${VERSION}: API http://${config.host}:${config.port}, data ${config.dataDir}`));
const admin = createServer(createAdmin({ store, config, pairing, publicUrl, tunnel }));
admin.listen(config.adminPort, config.adminHost, () => log(`this computer's page: http://localhost:${config.adminPort}`));

askTailscale();
setInterval(askTailscale, 5 * 60_000).unref();
// Turned on by the owner on this computer's page: on again with the server.
if (store.metaGet('tunnel') === 'on' && config.tunnelExe) tunnel.start();
backupNow();
setInterval(backupNow, 60 * 60_000).unref();

function stop() {
  log('stopping');
  tunnel.stop();
  api.close();
  admin.close();
  store.close();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
