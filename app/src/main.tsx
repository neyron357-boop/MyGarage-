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
import { installHaptics, isApple } from './ui/haptics';

/** An app, not a web page: iPhone Safari ignores `user-scalable=no`, so pinch-zoom is blocked here. */
function blockPinchZoom() {
  const stop = (e: Event) => e.preventDefault();
  document.addEventListener('gesturestart', stop);
  document.addEventListener('gesturechange', stop);
}

async function start() {
  const html = document.documentElement;
  html.lang = i18n.language;
  // Platform hooks for the stylesheet: the iPhone keeps its rubber band, an installed app its own chrome.
  html.classList.toggle('ios', isApple());
  html.classList.toggle('standalone', window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
  blockPinchZoom();
  // iPhone shows the pressed state (:active) of buttons and rows only when the page listens to touches.
  document.addEventListener('touchstart', () => undefined, { passive: true });
  installHaptics();
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
