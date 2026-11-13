// The app icon, drawn here and rendered by the browser of the tests (Playwright):
// public/icon.svg (rounded — the browser tab), icon-192/512.png (rounded — the manifest),
// icon-maskable-512.png and apple-touch-icon.png (edge to edge — the phone masks its own corners).
// Run from app/: node scripts/app-icon.cjs — then powershell -ExecutionPolicy Bypass -File scripts/ios-splash.ps1
// for the launch screens, which carry the icon.
// A bright iOS gradient (blue into violet, a pink glow from below, light from the top left) and a white car
// facing you, its headlights on in the iPhone's yellow.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = process.argv[2] || path.join(__dirname, '..', 'public');
const svg = (rounded) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2E8BFF"/>
      <stop offset="0.55" stop-color="#3D5AFE"/>
      <stop offset="1" stop-color="#7B3FF2"/>
    </linearGradient>
    <radialGradient id="shine" cx="0.22" cy="0.12" r="0.75">
      <stop offset="0" stop-color="#fff" stop-opacity="0.38"/>
      <stop offset="0.6" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow" cx="0.5" cy="0.92" r="0.6">
      <stop offset="0" stop-color="#FF5FD2" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#FF5FD2" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="car" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#E4E9FF"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="22" stdDeviation="26" flood-color="#1A1060" flood-opacity="0.38"/>
    </filter>
    <mask id="cut">
      <rect width="1024" height="1024" fill="#fff"/>
      <!-- windscreen -->
      <path d="M383 352 Q389 330 412 330 H612 Q635 330 641 352 L676 466 H348 Z" fill="#000"/>
      <!-- grille -->
      <rect x="432" y="598" width="160" height="34" rx="17" fill="#000"/>
    </mask>
    ${rounded ? '<clipPath id="r"><rect width="1024" height="1024" rx="230"/></clipPath>' : ''}
  </defs>
  <g ${rounded ? 'clip-path="url(#r)"' : ''}>
    <rect width="1024" height="1024" fill="url(#bg)"/>
    <rect width="1024" height="1024" fill="url(#glow)"/>
    <rect width="1024" height="1024" fill="url(#shine)"/>
    <g filter="url(#shadow)">
      <g mask="url(#cut)" fill="url(#car)">
        <!-- cabin -->
        <path d="M330 470 L370 330 Q382 286 428 286 H596 Q642 286 654 330 L694 470 Z"/>
        <!-- body -->
        <rect x="226" y="452" width="572" height="252" rx="84"/>
        <!-- wheels -->
        <rect x="262" y="660" width="112" height="112" rx="40"/>
        <rect x="650" y="660" width="112" height="112" rx="40"/>
      </g>
      <!-- headlights -->
      <circle cx="332" cy="572" r="44" fill="#FFD60A"/>
      <circle cx="692" cy="572" r="44" fill="#FFD60A"/>
      <circle cx="320" cy="560" r="14" fill="#fff" opacity="0.85"/>
      <circle cx="680" cy="560" r="14" fill="#fff" opacity="0.85"/>
    </g>
  </g>
</svg>`;
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/icon.svg`, svg(true).replace(/\n\s*/g, ' '));
  let browser;
  for (const channel of ['chromium', 'chrome', 'msedge']) { try { browser = await chromium.launch(channel === 'chromium' ? {} : { channel }); break; } catch {} }
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const render = async (rounded, size, file) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(rounded).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: `${OUT}/${file}`, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  };
  await render(true, 512, 'icon-512.png');
  await render(true, 192, 'icon-192.png');
  await render(false, 512, 'icon-maskable-512.png');
  await render(false, 180, 'apple-touch-icon.png');
  await browser.close();
  console.log('ok');
})();
