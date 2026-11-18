import { VERSION } from './config.mjs';

/*
 * The server's own page, for this computer only (http://localhost:8788): is it running, where the data is, the code to
 * pair a phone (and the link to send to it), the paired devices — each can be cut off.
 */

const page = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MyGarage — сервер</title>
<style>
  :root { color-scheme: light dark; --bg:#f2f2f7; --card:#fff; --dim:#6e6e73; --acc:#007aff; --red:#ff3b30; --green:#34c759; }
  @media (prefers-color-scheme: dark) { :root { --bg:#000; --card:#1c1c1e; --dim:#98989f; } }
  body { margin:0; background:var(--bg); font:16px/1.4 -apple-system, "Segoe UI", system-ui, sans-serif; }
  main { max-width:720px; margin:0 auto; padding:24px 16px 48px; }
  h1 { font-size:30px; margin:8px 0 18px; } h2 { font-size:15px; color:var(--dim); font-weight:600; margin:22px 4px 8px; }
  .card { background:var(--card); border-radius:18px; padding:16px 18px; }
  .row { display:flex; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:0.5px solid rgba(128,128,128,.25); }
  .row:last-child { border-bottom:0; } .dim { color:var(--dim); }
  .code { font:800 46px/1.1 ui-rounded, -apple-system, system-ui, sans-serif; letter-spacing:6px; }
  button { font:600 15px system-ui; border:0; border-radius:20px; padding:10px 16px; background:var(--acc); color:#fff; cursor:pointer; }
  button.ghost { background:rgba(128,128,128,.16); color:inherit; } button.red { background:transparent; color:var(--red); }
  code, .mono { font-family: ui-monospace, Consolas, monospace; font-size:14px; word-break:break-all; }
  .ok { color:var(--green); } .bad { color:var(--red); }
</style></head><body><main>
<h1>MyGarage — сервер</h1>
<div class="card" id="state">…</div>
<h2>Подключить телефон</h2>
<div class="card">
  <div class="row"><span>Адрес сервера</span><span class="mono" id="addr">…</span></div>
  <div style="padding:12px 0 4px"><div class="dim">Код (15 минут)</div><div class="code" id="code">— — —</div></div>
  <p class="dim" style="margin:6px 0 12px">В приложении: Ещё → Настройки → Данные → Сервер → «Подключить»: адрес и код. Или отправьте себе ссылку ниже и вставьте её в поле адреса.</p>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    <button onclick="newCode()">Новый код</button>
    <button class="ghost" onclick="copyLink()">Скопировать ссылку для телефона</button>
  </div>
  <p class="mono dim" id="link" style="margin:10px 0 0"></p>
  <p class="dim" id="copied" style="margin:6px 0 0"></p>
</div>
<h2>Доступ из интернета</h2>
<div class="card" id="tunnel">…</div>
<h2>Устройства</h2>
<div class="card" id="devices">…</div>
<h2>Где данные</h2>
<div class="card"><div class="mono" id="folder">…</div><p class="dim" style="margin:8px 0 0">Фото и видео, документы (инвойсы, сметы, акты), база и её ежедневные копии — всё в этой папке.</p></div>
</main>
<script>
// Questions are asked on the page itself, not by confirm()/alert(): a browser built into an app answers them «no» at
// once without showing anything — and the button did nothing.
let code = null, addr = '', asking = false, revoking = '';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const when = (s) => s ? new Date(s).toLocaleString('ru-RU', { timeZone: 'Asia/Dubai' }) : '—';
const mb = (b) => (b / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' МБ';
async function load() {
  const s = await (await fetch('status.json')).json();
  addr = s.publicUrl || '';
  code = s.code;
  document.getElementById('state').innerHTML =
    '<div class="row"><span>Сервер</span><span class="ok">● работает · v' + esc(s.version) + '</span></div>' +
    '<div class="row"><span>Записей</span><span>' + s.records.toLocaleString('ru-RU') + '</span></div>' +
    '<div class="row"><span>Файлов</span><span>' + s.files.toLocaleString('ru-RU') + ' · ' + mb(s.bytes) + '</span></div>' +
    '<div class="row"><span>Копия базы</span><span>' + esc(s.lastBackup || '—') + '</span></div>';
  document.getElementById('addr').textContent = addr || 'появится после «Включить доступ из интернета» (ниже) или Tailscale';
  document.getElementById('code').textContent = code ? code.code.replace(/(\\d{3})(\\d{3})/, '$1 $2') : '— — —';
  document.getElementById('link').textContent = addr && code ? addr + '#pair=' + code.code : '';
  document.getElementById('folder').textContent = s.dataDir;
  document.getElementById('tunnel').innerHTML = tunnelHtml(s.tunnel);
  document.getElementById('devices').innerHTML = s.devices.length ? s.devices.map((d) =>
    '<div class="row"><span>' + esc(d.name) + (s.main && s.main.id === d.id ? ' <span class="ok">· главное</span>' : '') + '<br>' + (d.live ? '<span class="ok">● на связи сейчас</span>' : '<span class="dim">был на связи: ' + when(d.last_seen) + '</span>') + '</span>' +
    (d.revoked ? '<span class="bad">отключено</span>' : revoking === d.id
      ? '<span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end"><span class="dim">перестанет получать данные</span>' +
        '<button class="red" onclick="revoke(\\'' + d.id + '\\')">Отключить</button><button class="ghost" onclick="askRevoke(\\'\\')">Отмена</button></span>'
      : '<button class="red" onclick="askRevoke(\\'' + d.id + '\\')">Отключить</button>') + '</div>').join('')
    : '<span class="dim">Пока ни одного</span>';
}
function tunnelHtml(t) {
  if (!t.available) return '<span class="dim">Здесь — через Tailscale (см. инструкцию сервера).</span>';
  const state = t.url ? '<span class="ok">● включён</span>' : t.on ? '<span class="dim">подключается…</span>' : '<span class="dim">выключен</span>';
  return '<div class="row"><span>Cloudflare (бесплатно)</span>' + state + '</div>' +
    (t.url ? '<div class="row"><span>Адрес</span><span class="mono">' + esc(t.url) + '</span></div>' : '') +
    '<p class="dim" style="margin:8px 0 12px">Телефон видит сервер из любой сети. Подключиться можно только по коду с этого компьютера. ' +
    'После перезагрузки ПК адрес меняется — новый будет здесь, его нужно один раз ввести в приложении (Сервер → адрес). Постоянный адрес — Tailscale.</p>' +
    (t.on ? '<button class="ghost" onclick="setTunnel(0)">Выключить</button>'
      : asking ? '<p style="margin:0 0 12px">Сервер станет доступен из интернета через Cloudflare. Данные можно получить только с устройства, подключённого по коду с этого компьютера. Включить?</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button onclick="setTunnel(1)">Включить</button><button class="ghost" onclick="askTunnel(false)">Отмена</button></div>'
      : '<button onclick="askTunnel(true)">Включить доступ из интернета</button>');
}
function askTunnel(v) { asking = v; load(); }
function askRevoke(id) { revoking = id; load(); }
async function setTunnel(on) {
  asking = false;
  await fetch('tunnel?on=' + on, { method: 'POST' });
  load();
}
async function newCode() { await fetch('code', { method: 'POST' }); load(); }
async function revoke(id) { revoking = ''; await fetch('revoke?id=' + encodeURIComponent(id), { method: 'POST' }); load(); }
async function copyLink() {
  const t = document.getElementById('link').textContent, note = document.getElementById('copied');
  if (!t) { note.textContent = 'Сначала нужен адрес (доступ из интернета) и код.'; return; }
  let ok = navigator.clipboard ? await navigator.clipboard.writeText(t).then(() => true, () => false) : false;
  if (!ok) {
    const area = document.createElement('textarea');
    area.value = t; document.body.appendChild(area); area.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
  }
  note.textContent = ok ? 'Скопировано. Отправьте себе на телефон и вставьте в поле «Адрес сервера».' : 'Скопируйте ссылку выше вручную.';
}
load(); setInterval(load, 5000);
</script></body></html>`;

export function createAdmin({ store, config, pairing, publicUrl, tunnel, events }) {
  return async function admin(req, res) {
    const url = new URL(req.url, 'http://local');
    const json = (body) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(page);
    }
    if (req.method === 'GET' && url.pathname === '/status.json') {
      return json({
        version: VERSION,
        dataDir: config.dataDir,
        publicUrl: publicUrl(),
        code: pairing.current(),
        devices: (() => {
          const live = events?.live() ?? new Set();
          return store.devices().map((d) => ({ ...d, live: live.has(d.id) }));
        })(),
        main: store.mainDevice(),
        lastBackup: store.metaGet('lastBackup'),
        tunnel: { available: !!tunnel && !!config.tunnelExe && tunnel.available(), on: !!tunnel?.on(), url: tunnel?.url() ?? '' },
        ...store.counts(),
      });
    }
    if (req.method === 'POST' && url.pathname === '/code') return json(pairing.issue());
    // Access from any network: only the owner turns it on, here on this computer.
    if (req.method === 'POST' && url.pathname === '/tunnel' && tunnel && config.tunnelExe) {
      const on = url.searchParams.get('on') === '1';
      store.metaSet('tunnel', on ? 'on' : 'off');
      if (on) tunnel.start();
      else tunnel.stop();
      return json({ ok: true, on });
    }
    if (req.method === 'POST' && url.pathname === '/revoke') {
      store.revoke(url.searchParams.get('id') || '');
      events?.drop(url.searchParams.get('id') || '');
      return json({ ok: true });
    }
    res.writeHead(404);
    res.end();
  };
}
