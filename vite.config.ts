import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const isAnalyze = process.env['ANALYZE'] === 'true';

function resolveBase(): string {
  // QNBS-v3: Tauri builds need relative paths for local file:// loading
  // TAURI_PLATFORM is set by Tauri CLI during desktop builds
  const isTauri = process.env['TAURI_PLATFORM'] !== undefined;
  if (isTauri) {
    return './';
  }
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
      // QNBS-v3: inlineDynamicImports: false prevents dynamic imports from being inlined into the SW bundle
      // (Workbox 7.x uses this property; VitePWA will warn but it's the correct option)
      injectManifest: {
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: [
          '**/*.{js,css,html,svg,ico,woff,woff2,png,webp}',
          'community-templates/**/*.json',
          'locales/**/bundle.json',
        ],
        // QNBS-v3: Exclude heavy optional chunks from SW precache — loaded lazily when flag=on.
        // vendor-ai-core is now the small orchestration layer and can be precached.
        globIgnores: [
          '**/vendor-duckdb*',
          '**/vendor-webllm*',
          '**/vendor-onnx*',
          '**/vendor-transformers*',
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
      // QNBS-v3: @huggingface/transformers (transformers.js v3) lives in packages/ai-core; Rolldown
      // can't hoist it from a nested workspace node_modules. Alias mirrors the vitest.config.ts fix.
      // v3 ships a bundled web entry at dist/transformers.web.js (no src/ in the published package).
      '@huggingface/transformers': path.resolve(
        __dirname,
        './packages/ai-core/node_modules/@huggingface/transformers/dist/transformers.web.js',
      ),
      // QNBS-v3: B-3 vendor fork — resolve @domain/collab-transport to the workspace package source
      '@domain/collab-transport': path.resolve(
        __dirname,
        './packages/collab-transport/src/index.ts',
      ),
      // QNBS-v3: WorkerBus v2 — resolve workspace package for production builds (mirrors vitest alias)
      '@domain/worker-bus': path.resolve(__dirname, './packages/worker-bus/src/index.ts'),
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
            !/ai-vendor|ai-sdk-vendor|export-vendor|data-vendor|collaboration-vendor|plot-board|canvas-vendor|vendor-duckdb|vendor-ai-onnx|vendor-webllm|vendor-onnx|vendor-transformers|vendor-voice-wasm|vendor-ai-core/.test(
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
          // QNBS-v3: Workspace packages - handle before node_modules check
          // Proxy entry files for heavy AI runtimes — route to dedicated chunks.
          if (id.includes('packages/ai-core/src/vendor-webllm')) {
            return 'vendor-webllm';
          }
          if (id.includes('packages/ai-core/src/vendor-transformers')) {
            return 'vendor-transformers';
          }
          if (id.includes('packages/ai-core/src/vendor-onnx')) {
            return 'vendor-onnx';
          }
          // QNBS-v3: Heavy AI runtimes route to dedicated lazy chunks. These MUST match BEFORE the
          // @domain/ai-core source catch-all below — otherwise deps resolved under
          // packages/ai-core/node_modules/* get swept into the precacheable vendor-ai-core chunk,
          // re-bloating it and defeating lazy-loading (CodeAnt PR #130). The generic
          // `node_modules/<pkg>` substring already covers the packages/ai-core/node_modules/<pkg> case.
          // WebLLM runtime (~4-5 MB uncompressed) — lazy-loaded when local GPU inference is requested.
          if (id.includes('.pnpm/@mlc-ai+web-llm') || id.includes('node_modules/@mlc-ai/web-llm')) {
            return 'vendor-webllm';
          }
          // ONNX Runtime Web (~0.5 MB uncompressed) — shared by transformers.js and the ONNX engine.
          if (id.includes('.pnpm/onnxruntime-web') || id.includes('node_modules/onnxruntime-web')) {
            return 'vendor-onnx';
          }
          // Transformers.js (~1 MB uncompressed) — lazy-loaded for WASM text-generation fallback.
          if (
            id.includes('.pnpm/@huggingface+transformers') ||
            id.includes('node_modules/@huggingface/transformers')
          ) {
            return 'vendor-transformers';
          }
          // @domain/ai-core source code (orchestration, tab leader, model lists) — small and
          // precacheable. Heavy runtimes are already routed above, so this only captures ai-core
          // source plus any lightweight deps it pulls in.
          if (id.includes('packages/ai-core') || id.includes('.pnpm/@domain+ai-core')) {
            return 'vendor-ai-core';
          }
          if (id.includes('packages/collab-transport')) {
            return 'collaboration-vendor';
          }
          if (id.includes('packages/worker-bus')) {
            return 'worker-bus';
          }
          if (id.includes('packages/ui')) {
            return 'ui-vendor';
          }

          // QNBS-v3: Scene board chunk
          if (id.includes('components/scene-board/') || id.includes('SceneBoardView')) {
            return 'plot-board';
          }

          // QNBS-v3: Voice WASM engines - lazy-loaded when enableVoiceWasm=on
          if (
            id.includes('services/voice/wasmSttEngine') ||
            id.includes('services/voice/sileroVadEngine')
          ) {
            return 'vendor-voice-wasm';
          }

          // QNBS-v3: LoRA feature chunk - lazy-loaded
          if (
            id.includes('features/lora/') ||
            id.includes('components/lora/') ||
            id.includes('services/lora/')
          ) {
            return 'lora-feature';
          }

          // QNBS-v3: Plugin worker - isolated execution context
          if (id.includes('workers/plugin.worker')) {
            return 'plugin-worker';
          }

          // QNBS-v3: Only apply node_modules chunking for non-workspace packages.
          // Workspace packages (packages/*) are handled above.
          if (!id?.includes('node_modules')) return undefined;

          // React vendor
          if (id.includes('/react-dom/') || id.includes('/react/')) {
            return 'react-vendor';
          }

          // Redux vendor
          if (
            id.includes('@reduxjs') ||
            id.includes('/react-redux/') ||
            id.includes('/redux-undo/')
          ) {
            return 'redux-vendor';
          }

          // AI vendors
          if (id.includes('@google/genai')) {
            return 'ai-vendor';
          }
          // QNBS-v3: Vercel AI SDK + provider packages bundled together
          if (
            id.includes('node_modules/ai/') ||
            id.includes('/node_modules/ai/') ||
            id.includes('@ai-sdk/')
          ) {
            return 'ai-sdk-vendor';
          }

          // Collaboration vendor (yjs, y-webrtc)
          if (id.includes('y-webrtc') || id.includes('yjs')) {
            return 'collaboration-vendor';
          }

          // Interaction vendor
          if (id.includes('@dnd-kit') || id.includes('/dnd-kit/')) {
            return 'interaction-vendor';
          }

          // Data vendor
          if (id.includes('recharts') || id.includes('react-force-graph-2d')) {
            return 'data-vendor';
          }

          // Export vendors
          if (id.includes('/jspdf/')) {
            return 'export-vendor-pdf';
          }
          if (id.includes('/docx/') || id.includes('/jszip/') || id.includes('mammoth')) {
            return 'export-vendor-docx-ebook';
          }

          // QNBS-v3: DuckDB-WASM bundle is ~2 MB gzip; isolate for SW cache exclusion
          if (id.includes('@duckdb/duckdb-wasm')) {
            return 'vendor-duckdb';
          }

          return undefined;
        },
      },
    },
    // QNBS-v3: Rolldown code splitting optimization for Vite 8
    rolldownOptions: {
      output: {
        codeSplitting: true,
      },
    },
  },
});
