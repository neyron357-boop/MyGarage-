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
<h2>ИИ (Gemini)</h2>
<div class="card" id="ai">…</div>
<h2>Уведомления</h2>
<div class="card" id="push">…</div>
<h2>WhatsApp</h2>
<div class="card" id="wa">…</div>
<h2>Устройства</h2>
<div class="card" id="devices">…</div>
<h2>Где данные</h2>
<div class="card"><div class="mono" id="folder">…</div><p class="dim" style="margin:8px 0 0">Фото и видео, документы (инвойсы, сметы, акты), база и её ежедневные копии — всё в этой папке.</p></div>
</main>
<script>
// Questions are asked on the page itself, not by confirm()/alert(): a browser built into an app answers them «no» at
// once without showing anything — and the button did nothing.
let code = null, addr = '', asking = false, revoking = '', waAsking = false, waBusy = false, waQr = 0;
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
  document.getElementById('tunnel').innerHTML = tunnelHtml(s.tunnel, s.relay);
  if (!aiTyping) document.getElementById('ai').innerHTML = aiHtml(s.ai);
  document.getElementById('push').innerHTML = pushHtml(s.push);
  // (The QR is the same picture until WhatsApp renews it: not drawn again each time — it would blink.)
  if (!s.wa || s.wa.phase !== 'qr' || s.wa.qrAt !== waQr) document.getElementById('wa').innerHTML = waHtml(s.wa);
  waQr = s.wa && s.wa.phase === 'qr' ? s.wa.qrAt : 0;
  document.getElementById('devices').innerHTML = s.devices.length ? s.devices.map((d) =>
    '<div class="row"><span>' + esc(d.name) + (s.main && s.main.id === d.id ? ' <span class="ok">· главное</span>' : '') + '<br>' + (d.live ? '<span class="ok">● на связи сейчас</span>' : '<span class="dim">был на связи: ' + when(d.last_seen) + '</span>') + '</span>' +
    (d.revoked ? '<span class="bad">отключено</span>' : revoking === d.id
      ? '<span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end"><span class="dim">перестанет получать данные</span>' +
        '<button class="red" onclick="revoke(\\'' + d.id + '\\')">Отключить</button><button class="ghost" onclick="askRevoke(\\'\\')">Отмена</button></span>'
      : '<button class="red" onclick="askRevoke(\\'' + d.id + '\\')">Отключить</button>') + '</div>').join('')
    : '<span class="dim">Пока ни одного</span>';
}
function tunnelHtml(t, r) {
  if (!t.available) return '<span class="dim">Здесь — через Tailscale (см. инструкцию сервера).</span>';
  const state = t.url ? '<span class="ok">● включён</span>' : t.on ? '<span class="dim">подключается…</span>' : '<span class="dim">выключен</span>';
  return '<div class="row"><span>Cloudflare (бесплатно)</span>' + state + '</div>' +
    (t.url ? '<div class="row"><span>Адрес</span><span class="mono">' + esc(t.url) + '</span></div>' : '') +
    (r && t.url ? '<div class="row"><span>Новый адрес — устройствам</span>' + (r.at && r.url === t.url ? '<span class="ok">● отправлен ' + esc(when(r.at)) + ' · устройств: ' + r.devices + '</span>'
      : r.error ? '<span class="bad">не отправлен: ' + esc(r.error) + '</span>' : '<span class="dim">отправляется…</span>') + '</div>' : '') +
    '<p class="dim" style="margin:8px 0 12px">Телефон видит сервер из любой сети. Подключиться можно только по коду с этого компьютера. ' +
    'После перезагрузки ПК адрес меняется — подключённые устройства находят новый сами: сервер оставляет его на ntfy.sh зашифрованным. Постоянный адрес — Tailscale.</p>' +
    (t.on ? '<button class="ghost" onclick="setTunnel(0)">Выключить</button>'
      : asking ? '<p style="margin:0 0 12px">Сервер станет доступен из интернета через Cloudflare. Данные можно получить только с устройства, подключённого по коду с этого компьютера. Включить?</p>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button onclick="setTunnel(1)">Включить</button><button class="ghost" onclick="askTunnel(false)">Отмена</button></div>'
      : '<button onclick="askTunnel(true)">Включить доступ из интернета</button>');
}
// Notifications on the phones (v0.74, push.mjs): who takes them, what is planned, when the last one went.
function pushHtml(p) {
  if (!p) return '<span class="dim">—</span>';
  return '<div class="row"><span>Устройств с уведомлениями</span><span>' + (p.devices ? '<span class="ok">● ' + p.devices + '</span>' : '<span class="dim">нет — включаются в приложении: Ещё → Уведомления</span>') + '</span></div>' +
    '<div class="row"><span>В плане</span><span>' + (p.groups ? p.groups + ' · обновлён ' + esc(when(p.madeAt)) : '<span class="dim">пусто</span>') + '</span></div>' +
    '<div class="row"><span>Последнее отправлено</span><span>' + (p.lastAt ? esc(when(p.lastAt)) + ' · всего ' + p.sent : '<span class="dim">—</span>') + (p.error ? ' <span class="bad">' + esc(p.error) + '</span>' : '') + '</span></div>';
}
// WhatsApp (v0.78, whatsapp.mjs): this computer as a linked device of the garage's account — linked here by the QR
// (or from the app by a code), unlinked here or on the phone.
function waHtml(w) {
  if (!w) return '<span class="dim">—</span>';
  if (!w.installed) return '<span class="dim">Не установлен. В папке сервера <span class="mono">server/whatsapp</span> выполните <span class="mono">npm install</span> и перезапустите сервер.</span>';
  if (!w.browser) return '<span class="bad">Нужен Chrome или Edge на этом компьютере.</span>';
  const names = { off: 'не привязан', starting: 'запускается…', qr: 'ждёт привязки', loading: 'загрузка' + (w.loading ? ' ' + w.loading + ' %' : '…'), ready: 'связан', offline: 'нет связи — пробует снова' };
  const cls = w.phase === 'ready' ? 'ok' : w.phase === 'offline' ? 'bad' : 'dim';
  const busy = waBusy ? ' disabled' : '';
  let h = '<div class="row"><span>Состояние</span><span class="' + cls + '">' + (w.phase === 'ready' ? '● ' : '') + esc(names[w.phase] || w.phase) + '</span></div>';
  if (w.me && w.linked) h += '<div class="row"><span>Номер</span><span>+' + esc(w.me.phone) + (w.me.name ? ' · ' + esc(w.me.name) : '') + '</span></div>';
  if (w.phase === 'ready') h += '<div class="row"><span>Чатов</span><span>' + w.chats + (w.unread ? ' · непрочитанных ' + w.unread : '') + '</span></div>';
  // What goes by itself (v0.79): reports, the boss, the wash, requests to suppliers.
  if (w.outbox && (w.outbox.queued || w.outbox.failed || w.outbox.sent)) h += '<div class="row"><span>Отправляется само</span><span>' + (w.outbox.queued ? 'в очереди ' + w.outbox.queued + ' · ' : '') + (w.outbox.failed ? '<span class="bad">не ушло ' + w.outbox.failed + '</span> · ' : '') + 'ушло ' + w.outbox.sent + '</span></div>';
  if (w.error && w.phase !== 'ready') h += '<div class="row"><span>Причина</span><span class="dim mono">' + esc(w.error) + '</span></div>';
  if (w.phase === 'qr' && w.qr) h += '<div style="padding:14px 0;text-align:center"><img alt="QR" src="' + esc(w.qr) + '" style="width:280px;height:280px;border-radius:12px;background:#fff;padding:8px"><p class="dim" style="margin:10px 0 0">WhatsApp на телефоне → Настройки → Связанные устройства → Привязка устройства → наведите камеру на код.</p></div>';
  h += '<p class="dim" style="margin:8px 0 12px">Этот компьютер — связанное устройство WhatsApp мастерской: приложение показывает чаты и отправляет сообщения и файлы. Переписка не копируется — читается из WhatsApp. Сессия хранится только здесь.</p>';
  if (waAsking) return h + '<p style="margin:0 0 12px">Отвязать этот компьютер от WhatsApp? В приложении чаты пропадут до новой привязки.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="red" onclick="wa(\\'logout\\')"' + busy + '>Отвязать</button><button class="ghost" onclick="waAsk(false)">Отмена</button></div>';
  if (w.phase === 'off') return h + '<button onclick="wa(\\'link\\')"' + busy + '>Привязать WhatsApp</button>';
  return h + '<div style="display:flex;gap:8px;flex-wrap:wrap">' + (w.linked ? '<button class="ghost" onclick="wa(\\'restart\\')"' + busy + '>Перезапустить</button>' : '') + '<button class="red" onclick="waAsk(true)">' + (w.linked ? 'Отвязать' : 'Отмена') + '</button></div>';
}
function waAsk(v) { waAsking = v; waQr = -1; load(); }
async function wa(what) {
  waAsking = false; waBusy = true; waQr = -1;
  try { await fetch('wa/' + what, { method: 'POST' }); } catch {}
  waBusy = false;
  load();
}
// The key is typed or pasted here only: it stays on this computer (Служебное/ai.json), the page shows its last four.
let aiTyping = false;
function aiHtml(a) {
  if (!a) return '<span class="dim">—</span>';
  // What the key paid for (v0.49): questions, tokens in / out / thinking — and the paid Google searches, only on the
  // days before v0.85 that made them (the part search is gone: none since).
  const k = (n) => (n >= 1000 ? (n / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' тыс.' : String(n));
  const spent = (u) => u ? esc(u.questions + ' вопр.' + (u.searches ? ' · ' + u.searches + ' поиск.' : '') + ' · токены: ' + k(u.in) + ' вход, ' + k(u.out) + ' ответ, ' + k(u.think) + ' размышл.') : '—';
  return '<div class="row"><span>Ключ</span>' + (a.on ? '<span class="ok">● ' + esc(a.key) + '</span>' : '<span class="dim">не задан</span>') + '</div>' +
    (a.on ? '<div class="row"><span>Последний ответ</span><span>' + (a.lastOk ? when(a.lastOk) : '—') + '</span></div>' +
      '<div class="row"><span>Сегодня</span><span class="dim">' + spent(a.usage && a.usage.today) + '</span></div>' +
      '<div class="row"><span>Этот месяц</span><span class="dim">' + spent(a.usage && a.usage.month) + '</span></div>' +
      (a.lastError ? '<div class="row"><span>Ошибка</span><span class="bad mono">' + esc(a.lastError) + '</span></div>' : '') : '') +
    '<p class="dim" style="margin:8px 0 12px">VIN — марка, модель, год и двигатель сами; название запчасти — без ошибок; чек поставщика. Ключ хранится только на этом компьютере.</p>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap"><input id="aikey" type="password" autocomplete="off" placeholder="Ключ Gemini API" onfocus="aiTyping=true" style="flex:1;min-width:220px;font:15px system-ui;padding:9px 12px;border-radius:12px;border:0.5px solid rgba(128,128,128,.4);background:transparent;color:inherit">' +
    '<button onclick="saveKey()">' + (a.on ? 'Заменить ключ' : 'Сохранить ключ') + '</button></div>';
}
async function saveKey() {
  const v = document.getElementById('aikey').value.trim();
  if (!v) return;
  await fetch('ai-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: v }) });
  aiTyping = false;
  load();
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
load(); setInterval(load, 3000);
</script></body></html>`;

export function createAdmin({ store, config, pairing, publicUrl, tunnel, events, relay, ai, push, wa }) {
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
        relay: relay?.status() ?? null,
        ai: ai?.status() ?? null,
        push: push?.status() ?? null,
        wa: wa?.status() ?? null,
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
    // Every job numbered once more (v0.42.3, store.renumber): this computer only, asked by hand — `apply` false says
    // what would change.
    if (req.method === 'POST' && url.pathname === '/renumber') {
      let body = '';
      for await (const c of req) body += c;
      const opts = JSON.parse(body || '{}');
      const r = store.renumber({ fixed: opts.fixed ?? {}, floor: opts.floor, apply: opts.apply === true });
      if (opts.apply === true) events?.changed(r.rev, null);
      return json(r);
    }
    // Records written by the garage itself (v0.42.3: Eaglecart jobs brought in here): this computer only, by hand —
    // every device takes them, as they are.
    if (req.method === 'POST' && url.pathname === '/records') {
      let body = '';
      for await (const c of req) body += c;
      const { changes } = JSON.parse(body || '{}');
      const rev = store.push(null, Array.isArray(changes) ? changes : [], { server: true });
      events?.changed(rev, null);
      return json({ ok: true, rev, n: Array.isArray(changes) ? changes.length : 0 });
    }
    // The AI's key (v0.48): typed on this computer's page only — the page and the key never leave this computer.
    if (req.method === 'POST' && url.pathname === '/ai-key' && ai) {
      let body = '';
      for await (const c of req) body += c;
      const key = String(JSON.parse(body || '{}').key ?? '').trim();
      if (!/^[A-Za-z0-9._-]{20,200}$/.test(key)) {
        res.writeHead(400);
        return res.end();
      }
      ai.setKey(key);
      return json({ ok: true, ai: ai.status() });
    }
    // WhatsApp (v0.78): linked, unlinked, started again — here on this computer, as from the app.
    if (req.method === 'POST' && wa && /^\/wa\/(link|logout|restart)$/.test(url.pathname)) {
      try {
        return json({ ok: true, wa: await wa.admin(url.pathname.slice(4)) });
      } catch (e) {
        return json({ ok: false, error: e.message, wa: wa.status() });
      }
    }
    if (req.method === 'POST' && url.pathname === '/revoke') {
      store.revoke(url.searchParams.get('id') || '');
      events?.drop(url.searchParams.get('id') || '');
      // A device cut off takes no more notifications.
      push?.unsubscribe(url.searchParams.get('id') || '');
      return json({ ok: true });
    }
    res.writeHead(404);
    res.end();
  };
}
