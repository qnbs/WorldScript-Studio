/**
 * Pre-React boot status. `index.html` ships a static boot shell inside `#root` so the page paints
 * before any JavaScript runs; React's first render replaces it. Until then the app counts as not
 * mounted, so the last-resort startup error and the slow-start notice can still take over `#root`.
 * These screens run before i18n is available, so their text is English, like the startup error.
 */

export const BOOT_SHELL_ATTRIBUTE = 'data-boot-shell';

/** True once React (or a recovery screen) has replaced the static boot shell. */
export function isAppMounted(rootEl: Element): boolean {
  const first = rootEl.firstElementChild;
  return first !== null && !first.hasAttribute(BOOT_SHELL_ATTRIBUTE);
}

export interface StartupNotice {
  message: string;
  detail?: string;
}

/**
 * Replaces `#root` with a self-contained notice and a Reload button. Built with DOM APIs: no
 * innerHTML (detail text is untrusted) and no inline handler (CSP `script-src 'self'` blocks them).
 */
export function renderStartupNotice(rootEl: Element, notice: StartupNotice): void {
  const doc = rootEl.ownerDocument;
  const container = doc.createElement('div');
  container.setAttribute('role', 'alert');
  container.setAttribute(
    'style',
    'display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:Inter,system-ui,sans-serif;background:#0f172a;color:#f1f5f9;text-align:center;padding:2rem;flex-direction:column;gap:1rem',
  );
  const title = doc.createElement('h1');
  title.setAttribute('style', 'font-size:1.5rem;font-weight:700');
  title.textContent = 'WorldScript Studio';
  const message = doc.createElement('p');
  message.setAttribute('style', 'color:#94a3b8;max-width:36rem');
  message.textContent = notice.message;
  container.append(title, message);
  if (notice.detail) {
    const detail = doc.createElement('pre');
    detail.setAttribute(
      'style',
      'background:#1e293b;border-radius:.5rem;padding:.75rem 1rem;font-size:.8rem;color:#fca5a5;max-width:36rem;overflow:auto;text-align:left',
    );
    detail.textContent = notice.detail;
    container.append(detail);
  }
  const reload = doc.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Reload';
  reload.setAttribute(
    'style',
    'padding:.5rem 1.25rem;border-radius:.5rem;border:1px solid #334155;background:#1e293b;color:#f1f5f9;cursor:pointer;font-family:inherit',
  );
  reload.addEventListener('click', () => doc.defaultView?.location.reload());
  container.append(reload);
  rootEl.replaceChildren(container);
}

export const SLOW_START_MS = 15_000;

export const SLOW_START_MESSAGE =
  'Startup is taking longer than expected. Another WorldScript Studio tab may still hold the local database: close other tabs, then reload.';

/**
 * Calls `onStall` once if the app has not mounted after `timeoutMs`. A boot that only hangs (for
 * example an IndexedDB open that never settles) otherwise leaves the boot shell up forever.
 */
export function startBootWatchdog(
  rootEl: Element,
  onStall: () => void,
  timeoutMs: number = SLOW_START_MS,
): () => void {
  const timer = setTimeout(() => {
    if (!isAppMounted(rootEl)) onStall();
  }, timeoutMs);
  return () => clearTimeout(timer);
}
