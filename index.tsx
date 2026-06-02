import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import App from './App';
import { type AppDispatch, appStoreRef, type RootState, setupStore } from './app/store';
import type { ProjectData } from './features/project/projectSlice';
import { versionControlActions } from './features/versionControl/versionControlSlice';
import { initializeStorage, resetAllDatabases } from './services/dbInitialization';
import { dbService } from './services/dbService';
import { logger } from './services/logger';
import { saveEnvelopeFromProjectData, storageService } from './services/storageService';
import type { PersistedRootState } from './types';
/* ── Self-hosted fonts (@fontsource) ── */
import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/merriweather/300.css';
import '@fontsource/merriweather/400.css';
import '@fontsource/merriweather/700.css';
import '@fontsource/merriweather/400-italic.css';

import './index.css';
import './register-sw';

// SPA redirect handler for GitHub Pages
(() => {
  const url = new URL(window.location.href);
  const redirectPath = url.searchParams.get('p');

  if (redirectPath) {
    // Entferne Query-Parameter und navigiere zur richtigen Route
    const cleanPath = decodeURIComponent(redirectPath);
    const base = import.meta.env.BASE_URL || '/';
    const targetPath = cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath;

    window.history.replaceState(null, '', base + targetPath);
  }
})();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}
const root = ReactDOM.createRoot(rootElement);

// QNBS-v3: Render a last-resort recovery screen when React never mounts (#root still empty).
// Covers both synchronous module-evaluation errors AND unhandled promise rejections from the
// async bootstrap IIFE — the latter was previously uncaught, so a rejecting initializeStorage()
// or a prod-only bundle ReferenceError (e.g. zod DCE) produced a *silent* blank screen.
function renderStartupError(message: string) {
  const rootEl = document.getElementById('root');
  if (!rootEl || rootEl.childElementCount > 0) return;
  const safe = String(message).replace(/[<>&]/g, (c) => `&#${c.charCodeAt(0)};`);
  rootEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:Inter,system-ui,sans-serif;background:#0f172a;color:#f1f5f9;text-align:center;padding:2rem;flex-direction:column;gap:1rem"><h1 style="font-size:1.5rem;font-weight:700">StoryCraft Studio</h1><p style="color:#94a3b8">A critical startup error occurred. Please reload the page.</p><pre style="background:#1e293b;border-radius:.5rem;padding:.75rem 1rem;font-size:.8rem;color:#fca5a5;max-width:36rem;overflow:auto;text-align:left">${safe}</pre><button onclick="location.reload()" style="padding:.5rem 1.25rem;border-radius:.5rem;border:1px solid #334155;background:#1e293b;color:#f1f5f9;cursor:pointer;font-family:inherit">Reload</button></div>`;
}

window.addEventListener('error', (event) => {
  renderStartupError(event.message);
});

// QNBS-v3: async-bootstrap rejections fire 'unhandledrejection', NOT 'error' — without this a
// rejected initializeStorage()/loadState() or any prod bundle crash blanks the page silently.
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const message =
    reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : String(reason);
  renderStartupError(message);
});

/** Recovery UI shown when IndexedDB initialisation fails. Intentionally no i18n dependency. */
function StorageErrorScreen({ message, onReset }: { message: string; onReset: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '2rem',
        fontFamily: 'Inter, system-ui, sans-serif',
        background: '#0f172a',
        color: '#f1f5f9',
        textAlign: 'center',
        gap: '1rem',
      }}
    >
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>StoryCraft Studio</h1>
      <p style={{ color: '#94a3b8', maxWidth: '32rem' }}>
        The local database could not be opened. This can happen after a browser update or when
        storage is full.
      </p>
      <p
        style={{
          background: '#1e293b',
          borderRadius: '0.5rem',
          padding: '0.75rem 1rem',
          fontSize: '0.875rem',
          color: '#fca5a5',
          maxWidth: '32rem',
          wordBreak: 'break-word',
        }}
      >
        {message}
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '0.5rem 1.25rem',
            borderRadius: '0.5rem',
            border: '1px solid #334155',
            background: '#1e293b',
            color: '#f1f5f9',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Reload
        </button>
        <button
          type="button"
          onClick={onReset}
          style={{
            padding: '0.5rem 1.25rem',
            borderRadius: '0.5rem',
            border: 'none',
            background: '#dc2626',
            color: '#fff',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Reset Database &amp; Reload
        </button>
      </div>
      <p style={{ fontSize: '0.75rem', color: '#475569' }}>
        Warning: resetting the database will delete all local projects and settings.
      </p>
    </div>
  );
}

// Async IIFE: pre-loads state from IndexedDB before mounting React.
(async () => {
  const initResult = await initializeStorage();
  if (!initResult.success) {
    logger.error('StorageBackend: initializeStorage failed:', initResult.error);
    root.render(
      <React.StrictMode>
        <StorageErrorScreen
          message={initResult.error ?? 'Unknown storage error.'}
          onReset={async () => {
            await resetAllDatabases();
            window.location.reload();
          }}
        />
      </React.StrictMode>,
    );
    return;
  }

  try {
    const loadedState = await dbService.loadState();
    const preloadedState: PersistedRootState | undefined = loadedState as
      | PersistedRootState
      | undefined;

    const isNewUser = !preloadedState;

    // --- CRITICAL HYDRATION LOGIC ---
    // The middleware saves only the 'present' state to save space/time.
    // However, redux-undo expects { past: [], present: ..., future: [] }.
    // We must manually reconstruct the undo envelope if we loaded flat data.
    if (preloadedState?.project) {
      const projectPart = preloadedState.project;

      // Check if the loaded project is "flat" (i.e., it doesn't have a 'present' key, but HAS 'data')
      const isFlatData = !projectPart.present && projectPart.data;

      if (isFlatData && projectPart.data) {
        logger.debug('Hydrating flat project state into Redux-Undo envelope.');
        preloadedState.project = {
          past: [],
          present: { data: projectPart.data }, // Reconstruct the slice structure
          future: [],
          _latestUnfiltered: projectPart.data, // Helper for redux-undo if needed
        };
      } else if (!projectPart.present && !projectPart.data) {
        // Fallback: Corrupt or empty project state
        logger.warn('Project state corrupted. Resetting project.');
        delete (preloadedState as Record<string, unknown>)['project'];
      }
    }
    // --------------------------------

    const store = setupStore(preloadedState);
    appStoreRef.current = store as unknown as { getState(): RootState; dispatch: AppDispatch };

    // QNBS-v3: RootState cast — configureStore mit PersistedRootState ergibt sonst zu breites getState().
    const pdata = (store.getState() as RootState).project.present?.data;
    if (pdata?.persistedVersionControl?.branches?.length) {
      store.dispatch(versionControlActions.hydrateFromPersisted(pdata.persistedVersionControl));
    }

    // QNBS-v3: visibilitychange-Flush reduziert Datenverlust, wenn Tabs abrupt in den Hintergrund wechseln.
    const flushOnHidden = () => {
      if (document.visibilityState !== 'hidden') return;
      const state = store.getState() as RootState;
      const presentData = state.project.present?.data;
      if (!presentData) return;
      const enriched: ProjectData = {
        ...presentData,
        persistedVersionControl: {
          branches: state.versionControl.branches,
          snapshots: state.versionControl.snapshots,
          currentBranchId: state.versionControl.currentBranchId,
        },
      };
      void Promise.allSettled([
        storageService.saveProject(saveEnvelopeFromProjectData(enriched)),
        storageService.saveSettings(state.settings),
      ]);
    };
    document.addEventListener('visibilitychange', flushOnHidden);

    root.render(
      <React.StrictMode>
        <Provider store={store}>
          <App isNewUser={isNewUser} />
        </Provider>
      </React.StrictMode>,
    );
  } catch (error) {
    logger.error('Failed to initialize the application:', error);
    const msg = error instanceof Error ? error.message : 'Could not load project data.';
    root.render(
      <React.StrictMode>
        <StorageErrorScreen
          message={msg}
          onReset={async () => {
            await resetAllDatabases();
            window.location.reload();
          }}
        />
      </React.StrictMode>,
    );
  }
})();
