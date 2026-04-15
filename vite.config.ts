import path from 'path';
import fs from 'fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Repository name für GitHub Pages
const REPO_NAME = 'StoryCraft-Studio';

// Custom Domain Detection:
// Wenn public/CNAME existiert und einen Wert hat, verwende '/' als base
// Sonst nutze den Repository-Namen für GitHub Pages Subpath
function getBasePath(): string {
  try {
    const cnamePath = path.resolve(__dirname, 'public/CNAME');
    if (fs.existsSync(cnamePath)) {
      const cname = fs.readFileSync(cnamePath, 'utf-8').trim();
      if (cname && cname.length > 0) {
        console.log(`📦 Custom Domain detected: ${cname} → Using base '/'`);
        return '/';
      }
    }
  } catch {
    // Fallback to default
  }
  console.log(`📦 No Custom Domain → Using base '/${REPO_NAME}/'`);
  return `/${REPO_NAME}/`;
}

export default defineConfig({
  // Fix: Statischer Base-Pfad fr GitHub Pages
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
    chunkSizeWarningLimit: 700,
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
            id.includes('/react-router')
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
          if (id.includes('/jspdf/')) {
            return 'jspdf-vendor';
          }
          if (id.includes('/docx/')) {
            return 'docx-vendor';
          }
          if (id.includes('/jszip/')) {
            return 'jszip-vendor';
          }
          if (id.includes('/html2canvas/')) {
            return 'html2canvas-vendor';
          }
          if (id.includes('@dnd-kit') || id.includes('/dnd-kit/')) {
            return 'dnd-vendor';
          }
          if (id.includes('react-force-graph-2d')) {
            return 'graph-vendor';
          }
          if (id.includes('/leaflet/') || id.includes('/react-leaflet/')) {
            return 'map-vendor';
          }
          if (id.includes('/konva/') || id.includes('/react-konva/')) {
            return 'canvas-vendor';
          }
          if (id.includes('/recharts/')) {
            return 'chart-vendor';
          }
          return undefined;
        },
      },
    },
  },
});
