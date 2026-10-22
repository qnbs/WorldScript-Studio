import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOOT_SHELL_ATTRIBUTE,
  canShowStartupError,
  isAppMounted,
  renderStartupNotice,
  SLOW_START_KEY,
  SLOW_START_MESSAGE,
  SLOW_START_MS,
  STARTUP_NOTICE_ATTRIBUTE,
  startBootWatchdog,
  translateStartupText,
} from '../../services/bootStatus';
import { getStaticTranslation } from '../../services/i18n/staticTranslate';

vi.mock('../../services/i18n/staticTranslate', () => ({ getStaticTranslation: vi.fn() }));

const english = async (_key: string, fallback: string) => fallback;

const indexHtml = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');

/** The #root element exactly as index.html ships it. */
function shippedRoot(): HTMLElement {
  const doc = new DOMParser().parseFromString(indexHtml, 'text/html');
  const root = doc.getElementById('root');
  if (!root) throw new Error('index.html has no #root');
  document.body.replaceChildren(document.importNode(root, true));
  return document.getElementById('root') as HTMLElement;
}

describe('static boot shell', () => {
  it('index.html paints a boot shell inside #root before any script runs', () => {
    const root = shippedRoot();
    const shell = root.firstElementChild;
    expect(shell?.hasAttribute(BOOT_SHELL_ATTRIBUTE)).toBe(true);
    expect(shell?.getAttribute('role')).toBe('status');
    expect(shell?.textContent).toBe('WorldScript Studio');
  });

  it('counts as not mounted until React replaces it', () => {
    const root = shippedRoot();
    expect(isAppMounted(root)).toBe(false);
    root.replaceChildren(document.createElement('main'));
    expect(isAppMounted(root)).toBe(true);
    root.replaceChildren();
    expect(isAppMounted(root)).toBe(false);
  });
});

describe('renderStartupNotice', () => {
  it('replaces the shell, renders untrusted detail as text and reloads without an inline handler', () => {
    const root = shippedRoot();
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ reload } as unknown as Location);

    void renderStartupNotice(
      root,
      { message: 'Broke.', detail: '<img src=x onerror=alert(1)>' },
      english,
    );

    expect(root.querySelector(`[${BOOT_SHELL_ATTRIBUTE}]`)).toBeNull();
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('pre')?.textContent).toBe('<img src=x onerror=alert(1)>');
    const button = root.querySelector('button');
    expect(button?.hasAttribute('onclick')).toBe(false);
    button?.click();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(isAppMounted(root)).toBe(true);
    vi.restoreAllMocks();
  });
});

describe('startBootWatchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports a boot that never mounts, once, after the slow-start limit', () => {
    const root = shippedRoot();
    const onStall = vi.fn();
    startBootWatchdog(root, onStall);

    vi.advanceTimersByTime(SLOW_START_MS - 1);
    expect(onStall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onStall).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SLOW_START_MS * 2);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it('stays silent when the app mounted in time or the watchdog was cancelled', () => {
    const mounted = shippedRoot();
    const onStall = vi.fn();
    startBootWatchdog(mounted, onStall);
    mounted.replaceChildren(document.createElement('main'));
    vi.advanceTimersByTime(SLOW_START_MS);

    const cancel = startBootWatchdog(shippedRoot(), onStall);
    cancel();
    vi.advanceTimersByTime(SLOW_START_MS);
    expect(onStall).not.toHaveBeenCalled();
  });

  it('the slow-start notice names the likely cause and offers a reload', () => {
    const root = shippedRoot();
    void renderStartupNotice(root, { message: SLOW_START_MESSAGE }, english);
    expect(root.textContent).toContain('close other tabs');
    expect(root.firstElementChild?.hasAttribute(STARTUP_NOTICE_ATTRIBUTE)).toBe(true);
    expect(root.querySelector('button')?.textContent).toBe('Reload');
  });
});

describe('startup notice localization', () => {
  it('shows English at once, then the localized message and button', async () => {
    const root = shippedRoot();
    const translate = vi.fn(async (key: string) => `[de] ${key}`);
    const done = renderStartupNotice(
      root,
      { message: SLOW_START_MESSAGE, messageKey: SLOW_START_KEY },
      translate,
    );
    expect(root.querySelector('p')?.textContent).toBe(SLOW_START_MESSAGE);
    expect(root.querySelector('button')?.textContent).toBe('Reload');

    await done;
    expect(root.querySelector('p')?.textContent).toBe(`[de] ${SLOW_START_KEY}`);
    expect(root.querySelector('button')?.textContent).toBe('[de] error.startup.reload');
  });

  it('keeps English when no bundle has the key or loading fails', async () => {
    vi.mocked(getStaticTranslation).mockResolvedValueOnce(SLOW_START_KEY);
    expect(await translateStartupText(SLOW_START_KEY, 'fallback')).toBe('fallback');
    vi.mocked(getStaticTranslation).mockRejectedValueOnce(new Error('offline'));
    expect(await translateStartupText(SLOW_START_KEY, 'fallback')).toBe('fallback');
  });

  it('does not touch #root once the app has replaced the notice', async () => {
    const root = shippedRoot();
    const done = renderStartupNotice(
      root,
      { message: 'Broke.', messageKey: 'error.startup.critical' },
      async () => 'late translation',
    );
    const app = document.createElement('main');
    root.replaceChildren(app);
    await done;
    expect(root.firstElementChild).toBe(app);
    expect(root.textContent).not.toContain('late translation');
  });

  it('every locale ships the startup notice keys', () => {
    const dir = resolve(__dirname, '../../locales');
    for (const lang of readdirSync(dir).filter((name) => !name.includes('.'))) {
      const common = JSON.parse(readFileSync(resolve(dir, lang, 'common.json'), 'utf8')) as Record<
        string,
        string
      >;
      for (const key of [SLOW_START_KEY, 'error.startup.critical', 'error.startup.reload']) {
        expect(common[key], `${lang} ${key}`).toBeTruthy();
      }
    }
  });
});

describe('critical startup error after the slow-start notice', () => {
  it('may replace the boot shell or an earlier notice, never the mounted app', async () => {
    const root = shippedRoot();
    expect(canShowStartupError(root)).toBe(true);

    await renderStartupNotice(root, { message: SLOW_START_MESSAGE }, english);
    expect(canShowStartupError(root)).toBe(true);

    root.replaceChildren(document.createElement('main'));
    expect(canShowStartupError(root)).toBe(false);
  });
});
