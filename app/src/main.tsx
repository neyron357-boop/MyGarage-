import '@fontsource/golos-text/latin-400.css';
import '@fontsource/golos-text/latin-500.css';
import '@fontsource/golos-text/latin-600.css';
import '@fontsource/golos-text/latin-700.css';
import '@fontsource/golos-text/cyrillic-400.css';
import '@fontsource/golos-text/cyrillic-500.css';
import '@fontsource/golos-text/cyrillic-600.css';
import '@fontsource/golos-text/cyrillic-700.css';
import '@fontsource/oswald/latin-500.css';
import '@fontsource/oswald/latin-600.css';
import '@fontsource/oswald/cyrillic-600.css';
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

async function start() {
  document.documentElement.lang = i18n.language;
  try {
    await navigator.storage?.persist?.();
  } catch {
    // not supported
  }
  try {
    await ensureSeed();
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
