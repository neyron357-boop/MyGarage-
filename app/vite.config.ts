/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

// mode "single" builds one self-contained index.html (used for previews);
// the default build is an installable PWA that works offline.
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };
  return {
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    },
    plugins: [
      react(),
      // In the single-file preview the PWA plugin stays disabled, but its virtual modules still resolve.
      VitePWA({
        disable: single,
        // A new version is installed in the background and applied when the user taps "Update":
        // never reload in the middle of an intake or a signature.
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['icon.svg'],
        manifest: {
          id: './',
          name: 'MyGarage',
          short_name: 'MyGarage',
          description: 'Garage manager: intake, estimates, approvals, parts, invoices, cash',
          lang: 'ru',
          theme_color: '#0f1626',
          background_color: '#f2f4f8',
          display: 'standalone',
          start_url: './',
          scope: './',
          categories: ['business', 'productivity'],
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
          shortcuts: [
            { name: 'Новый заказ', short_name: 'Заказ', url: './#/orders/new', icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }] },
            { name: 'Поиск', short_name: 'Поиск', url: './#/search', icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }] },
          ],
        },
        workbox: {
          // Everything the app needs offline, including the fonts embedded into PDF documents.
          // (.woff duplicates of .woff2 are skipped: every supported browser reads woff2.)
          globPatterns: ['**/*.{js,css,html,woff2,ttf,png,svg,webmanifest}'],
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          cleanupOutdatedCaches: true,
        },
      }),
      ...(single ? [viteSingleFile()] : []),
    ],
    build: single
      ? { outDir: 'dist-single', assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 20000 }
      : { outDir: 'dist', chunkSizeWarningLimit: 4000 },
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
  };
});
