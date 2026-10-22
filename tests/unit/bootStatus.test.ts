import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOOT_SHELL_ATTRIBUTE,
  isAppMounted,
  renderStartupNotice,
  SLOW_START_MESSAGE,
  SLOW_START_MS,
  startBootWatchdog,
} from '../../services/bootStatus';

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

    renderStartupNotice(root, { message: 'Broke.', detail: '<img src=x onerror=alert(1)>' });

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
    renderStartupNotice(root, { message: SLOW_START_MESSAGE });
    expect(root.textContent).toContain('close other tabs');
    expect(root.querySelector('button')?.textContent).toBe('Reload');
  });
});
