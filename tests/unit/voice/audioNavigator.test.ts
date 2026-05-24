import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AudioNavigator } from '../../../services/voice/audioNavigator';

describe('AudioNavigator', () => {
  let navigator: AudioNavigator;

  beforeEach(() => {
    navigator = new AudioNavigator();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('scans landmarks from ARIA roles', () => {
    document.body.innerHTML = `
      <nav aria-label="Main nav">Nav</nav>
      <main>Content</main>
      <aside aria-label="Sidebar">Sidebar</aside>
    `;

    navigator.scanLandmarks();
    const next = navigator.nextLandmark();
    expect(next).toContain('Main nav');
    expect(next).toContain('nav');
  });

  it('cycles through landmarks', () => {
    document.body.innerHTML = `
      <main aria-label="Main content">Main</main>
      <nav aria-label="Nav">Nav</nav>
    `;

    const first = navigator.nextLandmark();
    const second = navigator.nextLandmark();
    const third = navigator.nextLandmark(); // should wrap to first

    expect(first).not.toBe(second);
    expect(third).toBe(first);
  });

  it('cycles backwards through landmarks', () => {
    document.body.innerHTML = `
      <main aria-label="Main">Main</main>
      <nav aria-label="Nav">Nav</nav>
    `;

    const first = navigator.nextLandmark();
    navigator.nextLandmark();
    const prev = navigator.previousLandmark();

    expect(prev).toBe(first);
  });

  it('returns null when no landmarks exist', () => {
    expect(navigator.nextLandmark()).toBeNull();
    expect(navigator.previousLandmark()).toBeNull();
  });

  it('focuses first focusable element in container', () => {
    document.body.innerHTML = `
      <div id="container">
        <button id="btn">Click</button>
      </div>
    `;
    const container = document.getElementById('container');

    const result = navigator.focusFirstIn(container);
    expect(result).toBe(true);
    expect(document.activeElement?.id).toBe('btn');
  });

  it('returns false when no focusable elements exist', () => {
    document.body.innerHTML = `<div id="empty">No buttons</div>`;
    const container = document.getElementById('empty');

    expect(navigator.focusFirstIn(container)).toBe(false);
  });

  it('returns null for null container', () => {
    expect(navigator.focusFirstIn(null)).toBe(false);
  });

  it('gets focused label of active element', () => {
    document.body.innerHTML = `
      <button id="btn" aria-label="Save project">Save</button>
    `;
    const btn = document.getElementById('btn') as HTMLElement;
    btn.focus();

    expect(navigator.getFocusedLabel()).toBe('Save project');
  });

  it('returns "No focus" when body is focused', () => {
    document.body.focus();
    expect(navigator.getFocusedLabel()).toBe('No focus');
  });

  it('falls back to text content for label', () => {
    document.body.innerHTML = `<button id="btn">Click me</button>`;
    const btn = document.getElementById('btn') as HTMLElement;
    btn.focus();

    expect(navigator.getFocusedLabel()).toBe('Click me');
  });

  it('creates live region on announce', () => {
    navigator.announce('Test message', 'polite');

    const region = document.getElementById('voice-live-region');
    expect(region).not.toBeNull();
    expect(region!.getAttribute('role')).toBe('status');
    expect(region!.getAttribute('aria-live')).toBe('polite');
  });

  it('reuses existing live region', () => {
    navigator.announce('First');
    navigator.announce('Second', 'assertive');

    const regions = document.querySelectorAll('#voice-live-region');
    expect(regions.length).toBe(1);
  });

  it('sets tabindex before focusing element', () => {
    document.body.innerHTML = `<div id="target">Target</div>`;
    const target = document.getElementById('target') as HTMLElement;

    navigator.focusElement(target);
    expect(target.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(target);
  });
});
