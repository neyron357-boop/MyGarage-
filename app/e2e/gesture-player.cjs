const fs = require('fs');
const path = require('path');
/*
 * One page that plays the same gestures of two builds side by side, in step (the frames of e2e/gestures.cjs):
 * node e2e/gesture-player.cjs <dir> <labelA> <labelB> [out.html] [nameA] [nameB] — play, pause, scrub, slow motion.
 */
const [dir, a, b, outArg, nameA = a, nameB = b] = process.argv.slice(2);
if (!dir || !a || !b) throw new Error('usage: node e2e/gesture-player.cjs <dir> <labelA> <labelB> [out.html]');
const names = [...new Set(fs.readdirSync(dir).filter((f) => f.endsWith('.frames.json')).map((f) => f.slice(f.indexOf('-') + 1, -'.frames.json'.length)))];
const load = (label, name) => {
  const p = path.join(dir, `${label}-${name}.frames.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
};
const results = (label) => {
  const p = path.join(dir, `${label}-gestures.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')).results : {};
};
// In the order they were recorded (the measurements file keeps it), the rest after.
const order = Object.keys(results(a));
names.sort((x, y) => (order.indexOf(x) + 1 || 99) - (order.indexOf(y) + 1 || 99));
const data = { a: nameA, b: nameB, sets: names.map((name) => ({ name, a: load(a, name), b: load(b, name) })), ra: results(a), rb: results(b) };

const player = `
const D = window.__D;
const root = document.getElementById('root');
for (const s of D.sets) {
  const g = document.createElement('section');
  const len = Math.max(s.a.length ? s.a[s.a.length - 1].ms : 0, s.b.length ? s.b[s.b.length - 1].ms : 0);
  g.innerHTML = '<h2></h2><div class="row"><div class="pane"><b></b><div class="frame"></div></div><div class="pane"><b></b><div class="frame"></div></div></div>' +
    '<div class="ctl"><button class="play">Пуск</button><button class="slow alt">Медленно</button><input type="range" min="0" step="1"><span class="t"></span></div><pre></pre>';
  g.querySelector('h2').textContent = s.name;
  const labels = g.querySelectorAll('.pane b');
  labels[0].textContent = D.a;
  labels[1].textContent = D.b;
  const frames = g.querySelectorAll('.frame');
  const range = g.querySelector('input');
  range.max = String(len);
  const time = g.querySelector('.t');
  g.querySelector('pre').textContent = D.a + ': ' + JSON.stringify(D.ra[s.name] || {}) + '\\n' + D.b + ': ' + JSON.stringify(D.rb[s.name] || {});
  const pick = (fr, ms) => { let k = -1; for (let i = 0; i < fr.length; i++) { if (fr[i].ms <= ms) k = i; else break; } return fr[Math.max(0, k)]; };
  const show = (ms) => {
    [s.a, s.b].forEach((fr, i) => { const f = pick(fr, ms); if (f) frames[i].style.backgroundImage = 'url(data:image/jpeg;base64,' + f.data + ')'; });
    range.value = String(Math.round(ms));
    time.textContent = Math.round(ms) + ' мс';
  };
  let playing = false, speed = 1, last = 0, at = 0;
  const playBtn = g.querySelector('.play');
  const loop = (t) => {
    if (!playing) return;
    at += (t - last) * speed;
    last = t;
    if (at >= len) { at = len; playing = false; playBtn.textContent = 'Пуск'; }
    show(at);
    if (playing) requestAnimationFrame(loop);
  };
  playBtn.onclick = () => {
    playing = !playing;
    playBtn.textContent = playing ? 'Пауза' : 'Пуск';
    if (playing) { if (at >= len) at = 0; last = performance.now(); requestAnimationFrame(loop); }
  };
  g.querySelector('.slow').onclick = (e) => { speed = speed === 1 ? 0.25 : 1; e.target.textContent = speed === 1 ? 'Медленно' : 'Обычно'; };
  range.oninput = () => { at = Number(range.value); show(at); };
  show(0);
  root.appendChild(g);
}`;

const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Жесты до и после</title>
<style>
:root{--bg:#f2f2f7;--card:#fff;--ink:#1c1c1e;--dim:#6e6e73;--accent:#007aff}
@media (prefers-color-scheme:dark){:root{--bg:#000;--card:#1c1c1e;--ink:#f2f2f7;--dim:#98989f;--accent:#0a84ff}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,system-ui,"Segoe UI",sans-serif;padding:16px}
h1{font-size:22px;margin:0 0 4px}
p{margin:0 0 16px;color:var(--dim);max-width:760px}
section{background:var(--card);border-radius:20px;padding:14px;margin:0 0 16px;max-width:860px}
h2{font-size:17px;margin:0 0 10px}
.row{display:flex;gap:12px;flex-wrap:wrap}
.pane{flex:1 1 140px;min-width:0;max-width:260px}
.pane b{display:block;font-size:13px;color:var(--dim);margin-bottom:6px}
.frame{width:100%;max-width:260px;aspect-ratio:390/844;background:#111 no-repeat center/100% auto;border-radius:14px}
.ctl{display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap}
button{font:inherit;border:0;border-radius:999px;padding:8px 16px;background:var(--accent);color:#fff;min-height:44px}
button.alt{background:rgba(118,118,128,.18);color:var(--ink)}
input[type=range]{flex:1;min-width:140px}
.t{font-variant-numeric:tabular-nums;color:var(--dim);min-width:64px}
pre{font-size:12px;white-space:pre-wrap;word-break:break-word;color:var(--dim);margin:10px 0 0}
</style></head><body>
<h1>Одинаковые жесты: «${nameA}» и «${nameB}»</h1>
<p>Кадры экрана iPhone 13 (390×844, касания) с точным временем, 30 кадров в секунду; красный кружок — палец. «Медленно» — в 4 раза медленнее. Под каждым жестом — замеры: где была линза под пальцем, какие вкладки открылись.</p>
<div id="root"></div>
<script>window.__D = ${JSON.stringify(data)};</script>
<script>${player}</script>
</body></html>`;
const out = outArg || path.join(dir, `gestures-${a}-vs-${b}.html`);
fs.writeFileSync(out, html);
console.log('wrote', out, Math.round(fs.statSync(out).size / 1024), 'KB');
