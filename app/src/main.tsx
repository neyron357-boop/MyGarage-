// Interface text uses the phone's own system font; Oswald is kept only for the UAE number plate.
import '@fontsource/oswald/latin-600.css';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import 'dayjs/locale/ru';
import './styles.css';
import i18n from './i18n';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ensureSeed } from './services/seed';
import { applyAccent } from './ui/accent';
import { installHaptics, isApple } from './ui/haptics';
import { installTapGuard } from './ui/tapGuard';

/** The Mini App owns vertical swipes inside its webview. Telegram's header still handles dismissal. */
function prepareTelegramGestures() {
  const bridge = (window as Window & { TelegramWebviewProxy?: { postEvent: (event: string, data: string) => void } }).TelegramWebviewProxy;
  if (typeof bridge?.postEvent !== 'function') return;
  const fragment = location.hash.slice(1);
  if (fragment.startsWith('tgWebApp')) {
    // Telegram launch parameters share the fragment with HashRouter. A launch without a route opens the board.
    history.replaceState(history.state, '', `${location.pathname}${location.search}#/`);
  }
  try {
    bridge.postEvent('web_app_setup_swipe_behavior', JSON.stringify({ allow_vertical_swipe: false }));
  } catch {
    // A client without this native event can still use the in-page gesture.
  }
}

/** An app, not a web page: iPhone Safari ignores `user-scalable=no`, so pinch-zoom is blocked here. */
function blockPinchZoom() {
  const stop = (e: Event) => e.preventDefault();
  document.addEventListener('gesturestart', stop);
  document.addEventListener('gesturechange', stop);
}

async function start() {
  const html = document.documentElement;
  html.lang = i18n.language;
  // Platform hooks for the stylesheet: an installed app has its own chrome.
  html.classList.toggle('ios', isApple());
  html.classList.toggle('standalone', window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
  prepareTelegramGestures();
  blockPinchZoom();
  // The accent chosen on this device, before the first paint (no blue flash).
  applyAccent();
  // iPhone shows the pressed state (:active) of buttons and rows only when the page listens to touches.
  document.addEventListener('touchstart', () => undefined, { passive: true });
  installHaptics();
  // A double tap whose second tap lands on what the first one put under the finger is dropped.
  installTapGuard();
  try {
    await navigator.storage?.persist?.();
  } catch {
    // not supported
  }
  try {
    await ensureSeed(i18n.language === 'en' ? 'en' : 'ru');
  } catch (e) {
    // IndexedDB is unavailable (private mode, blocked site data): the app cannot keep data.
    document.getElementById('root')!.innerHTML =
      '<div style="font-family:system-ui;padding:24px;max-width:520px;margin:auto">' +
      '<h2>MyGarage</h2><p>Браузер не даёт сохранять данные (приватный режим или запрет хранения для сайта). ' +
      'Откройте приложение в обычном окне Chrome или Safari.</p>' +
      '<p>The browser does not allow storing data (private mode or blocked site data). Open the app in a normal Chrome or Safari window.</p>' +
      `<pre style="white-space:pre-wrap;color:#888">${String(e)}</pre></div>`;
    return;
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void start();
