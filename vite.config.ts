import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';

const isAnalyze = process.env['ANALYZE'] === 'true';

export default defineConfig({
  base: '/StoryCraft-Studio/',

  server: {
    port: 3000,
    host: '0.0.0.0',
  },

  plugins: [
    react(),
    VitePWA({
      // register-sw.ts übernimmt die manuelle Registrierung
      injectRegister: false,
      registerType: 'prompt',
      // Workbox generiert den Service Worker mit Precaching
      strategies: 'generateSW',
      // sw.js wird im Build-Output generiert (überschreibt public/sw.js)
      filename: 'sw.js',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,ico,woff,woff2,png,webp}'],
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // i18n-Locale-Dateien: CacheFirst (selten veraltet)
            urlPattern: /\/locales\/.*\.json$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'storycraft-i18n',
              expiration: { maxAgeSeconds: 30 * 24 * 60 * 60, maxEntries: 60 },
            },
          },
          {
            // Gemini API: NetworkOnly (KI-Antworten dürfen nie gecacht werden)
            urlPattern: /^https:\/\/generativelanguage\.googleapis\.com\//,
            handler: 'NetworkOnly',
          },
          {
            // Google Fonts: CacheFirst
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'storycraft-fonts',
              expiration: { maxAgeSeconds: 60 * 24 * 60 * 60, maxEntries: 20 },
            },
          },
        ],
      },
      // Manifest bereits in public/manifest.json eingebunden
      manifest: false,
    }),
    ...(isAnalyze
      ? [
          visualizer({
            open: true,
            filename: 'dist/bundle-analysis.html',
            gzipSize: true,
            brotliSize: true,
          }),
        ]
      : []),
  ],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },

  build: {
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: false,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 600,
    reportCompressedSize: true,
    rollupOptions: {
      external: [
        '@tauri-apps/api',
        '@tauri-apps/api/core',
        '@tauri-apps/api/dialog',
        '@tauri-apps/api/fs',
        '@tauri-apps/api/path',
      ],
      output: {
        // Asset-Hashing für Cache-Busting
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',

        // Code-Splitting für bessere Ladezeiten
        manualChunks: (id) => {
          if (!id || !id.includes('node_modules')) return undefined;
          if (
            id.includes('/react-dom/') ||
            id.includes('/react/') ||
            id.includes('/react-router-dom/')
          ) {
            return 'react-vendor';
          }
          if (
            id.includes('@reduxjs') ||
            id.includes('/react-redux/') ||
            id.includes('/redux-undo/')
          ) {
            return 'redux-vendor';
          }
          if (id.includes('@google/genai')) {
            return 'ai-vendor';
          }
          if (id.includes('y-webrtc') || id.includes('yjs')) {
            return 'collaboration-vendor';
          }
          if (id.includes('@dnd-kit') || id.includes('/dnd-kit/')) {
            return 'interaction-vendor';
          }
          if (
            id.includes('recharts') ||
            id.includes('react-force-graph-2d')
          ) {
            return 'data-vendor';
          }
          if (id.includes('/konva/') || id.includes('/react-konva/')) {
            return 'canvas-vendor';
          }
          if (id.includes('/jspdf/')) {
            return 'export-vendor-pdf';
          }
          if (
            id.includes('/docx/') ||
            id.includes('/jszip/') ||
            id.includes('mammoth')
          ) {
            return 'export-vendor-docx-ebook';
          }
          return undefined;
        },
      },
    },
  },
});
