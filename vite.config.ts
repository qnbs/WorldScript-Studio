import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const isAnalyze = process.env['ANALYZE'] === 'true';

function resolveBase(): string {
  const viteBase = process.env['VITE_BASE']?.trim();
  if (viteBase) {
    return viteBase.endsWith('/') ? viteBase : `${viteBase}/`;
  }
  if (process.env['DEPLOY_TARGET'] === 'edge') {
    return '/';
  }
  return '/StoryCraft-Studio/';
}

const deployBase = resolveBase();

export default defineConfig({
  base: deployBase,

  // Default dependency crawl uses every *.html under the repo; reports (Playwright, Storybook, etc.) are not app entries and can break `vite dev`.
  optimizeDeps: {
    entries: [path.resolve(__dirname, 'index.html')],
  },

  server: {
    port: 3000,
    // QNBS-v3: Default to loopback for security; opt-in to 0.0.0.0 via VITE_DEV_HOST for Codespaces.
    host: process.env['VITE_DEV_HOST'] || '127.0.0.1',
  },

  preview: {
    port: 4173,
    host: process.env['VITE_DEV_HOST'] || '127.0.0.1',
  },

  plugins: [
    tailwindcss(),
    react(),
    {
      name: 'storycraft-deploy-base-html',
      transformIndexHtml(html) {
        if (deployBase === '/StoryCraft-Studio/') return html;
        return html.replaceAll('/StoryCraft-Studio/', deployBase);
      },
    },
    VitePWA({
      // register-sw.ts handles manual registration
      injectRegister: false,
      registerType: 'prompt',
      // public/sw.js is preserved; VitePWA only injects the precache manifest list
      strategies: 'injectManifest',
      srcDir: 'public',
      filename: 'sw.js',
      injectManifest: {
        // Default Workbox limit is 2 MiB; onnx/transformers vendor chunk exceeds it (CI build fails otherwise).
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: [
          '**/*.{js,css,html,svg,ico,woff,woff2,png,webp}',
          'community-templates/**/*.json',
          'locales/**/bundle.json',
        ],
        // QNBS-v3: Exclude DuckDB, WebLLM, and voice WASM chunks from SW precache — loaded lazily when flag=on.
        globIgnores: [
          '**/vendor-duckdb*',
          '**/vendor-webllm*',
          '**/vendor-voice-wasm*',
          '**/*.wasm',
        ],
      },
      // Manifest bereits in public/manifest.json eingebunden
      manifest: false,
    }),
    ...(isAnalyze
      ? [
          visualizer({
            open: process.env['CI'] !== 'true',
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
      // QNBS-v3: @xenova/transformers lives in packages/ai-core; Rolldown can't hoist it from
      // a nested workspace node_modules. Alias mirrors the vitest.config.ts fix.
      '@xenova/transformers': path.resolve(
        __dirname,
        './packages/ai-core/node_modules/@xenova/transformers/src/transformers.js',
      ),
      // QNBS-v3: B-3 vendor fork — resolve @domain/collab-transport to the workspace package source
      '@domain/collab-transport': path.resolve(
        __dirname,
        './packages/collab-transport/src/index.ts',
      ),
    },
  },

  build: {
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: false,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 600,
    reportCompressedSize: true,
    modulePreload: {
      polyfill: false,
      resolveDependencies: (_filename: string, deps: string[]) =>
        deps.filter(
          (d) =>
            !/ai-vendor|ai-sdk-vendor|export-vendor|data-vendor|collaboration-vendor|plot-board|canvas-vendor|vendor-duckdb|vendor-ai-onnx|vendor-webllm|vendor-voice-wasm/.test(
              d,
            ),
        ),
    },
    rollupOptions: {
      external: [
        // QNBS-v3: Tauri APIs are only available in the desktop shell — externalize all @tauri-apps/* so the web/Vercel build never tries to bundle them.
        /^@tauri-apps\//,
      ],
      output: {
        // Asset hashing for cache busting
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',

        // Code splitting for better load times
        manualChunks: (id) => {
          if (id.includes('components/scene-board/') || id.includes('SceneBoardView')) {
            return 'plot-board';
          }
          if (!id?.includes('node_modules')) return undefined;
          if (id.includes('/react-dom/') || id.includes('/react/')) {
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
          // QNBS-v3: Vercel AI SDK + provider packages bundled together, analogous to @google/genai.
          if (
            id.includes('node_modules/ai/') ||
            id.includes('/node_modules/ai/') ||
            id.includes('@ai-sdk/')
          ) {
            return 'ai-sdk-vendor';
          }
          if (id.includes('y-webrtc') || id.includes('yjs')) {
            return 'collaboration-vendor';
          }
          if (id.includes('@dnd-kit') || id.includes('/dnd-kit/')) {
            return 'interaction-vendor';
          }
          if (id.includes('recharts') || id.includes('react-force-graph-2d')) {
            return 'data-vendor';
          }
          if (id.includes('/jspdf/')) {
            return 'export-vendor-pdf';
          }
          if (id.includes('/docx/') || id.includes('/jszip/') || id.includes('mammoth')) {
            return 'export-vendor-docx-ebook';
          }
          // QNBS-v3: onnx/transformers exceed Workbox 8 MiB SW cache limit — separate chunk prevents exclusion.
          if (id.includes('onnxruntime-web') || id.includes('@xenova/transformers')) {
            return 'vendor-ai-onnx';
          }
          // QNBS-v3: DuckDB-WASM bundle is ~2 MB gzip; isolate so SW cache exclusion glob matches vendor-duckdb*.
          if (id.includes('@duckdb/duckdb-wasm')) {
            return 'vendor-duckdb';
          }
          // QNBS-v3: WebLLM is ~6 MB — isolate to prevent OOM during Vercel build and exclude from SW precache.
          if (id.includes('@mlc-ai/web-llm')) {
            return 'vendor-webllm';
          }
          // QNBS-v3: Voice WASM engines (WasmSttEngine, SileroVadEngine) — lazy-loaded when enableVoiceWasm=on.
          if (
            id.includes('services/voice/wasmSttEngine') ||
            id.includes('services/voice/sileroVadEngine')
          ) {
            return 'vendor-voice-wasm';
          }
          // QNBS-v3: LoRA feature chunk — lazy-loaded, no heavy training libs (training is Python sidecar).
          if (
            id.includes('features/lora/') ||
            id.includes('components/lora/') ||
            id.includes('services/lora/')
          ) {
            return 'lora-feature';
          }
          return undefined;
        },
      },
    },
  },
});
