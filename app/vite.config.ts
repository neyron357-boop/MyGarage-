/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

// mode "single" builds one self-contained index.html (used for previews);
// the default build is an installable PWA.
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: [
      react(),
      single
        ? viteSingleFile()
        : VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['icon.svg'],
            manifest: {
              name: 'MyGarage',
              short_name: 'MyGarage',
              description: 'Garage manager: intake, estimates, approvals, parts, invoices, cash',
              theme_color: '#0f1626',
              background_color: '#f2f4f8',
              display: 'standalone',
              start_url: './',
              icons: [
                { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
                { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
              ],
            },
            workbox: { maximumFileSizeToCacheInBytes: 8 * 1024 * 1024 },
          }),
    ],
    build: single
      ? { outDir: 'dist-single', assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 20000 }
      : { outDir: 'dist', chunkSizeWarningLimit: 4000 },
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
  };
});
