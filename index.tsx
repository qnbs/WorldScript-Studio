import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import App from './App';
import type { RootState } from './app/store';
import { setupStore } from './app/store';
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

// SPA Redirect Handler für GitHub Pages
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

// A sophisticated async IIFE to handle pre-loading state from IndexedDB before app mount.
(async () => {
  try {
    await dbService.initDB();
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

    // QNBS-v3: visibilitychange-Flush reduziert Datenverlust, wenn Tabs abrupt in den Hintergrund wechseln.
    const flushOnHidden = () => {
      if (document.visibilityState !== 'hidden') return;
      const state = store.getState() as RootState;
      const presentData = state.project.present?.data;
      if (!presentData) return;
      void Promise.allSettled([
        storageService.saveProject(saveEnvelopeFromProjectData(presentData)),
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
    root.render(
      <div style={{ color: 'red', padding: '20px' }}>
        <h1>Application Initialization Failed</h1>
        <p>Could not load project data. Please check the browser console for more details.</p>
      </div>,
    );
  }
})();
