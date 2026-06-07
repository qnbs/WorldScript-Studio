import { beforeEach, describe, expect, it } from 'vitest';
import { AudioNavigator } from '../../services/voice/audioNavigator';

describe('AudioNavigator', () => {
  let navigator: AudioNavigator;

  beforeEach(() => {
    navigator = new AudioNavigator();
    document.body.innerHTML = '';
  });

  // ── scanLandmarks ────────────────────────────────────────────────────────

  it('scans main landmark with aria-label', () => {
    document.body.innerHTML = '<main aria-label="Main content">Content</main>';
    navigator.scanLandmarks();
    expect(navigator.nextLandmark()).toBe('Main content, main');
  });

  it('scans role="navigation" landmark', () => {
    document.body.innerHTML = '<nav aria-label="Sidebar">Links</nav>';
    navigator.scanLandmarks();
    expect(navigator.nextLandmark()).toBe('Sidebar, nav');
  });

  it('scans role="complementary" landmark', () => {
    document.body.innerHTML = '<aside aria-label="Notes">Side content</aside>';
    navigator.scanLandmarks();
    expect(navigator.nextLandmark()).toBe('Notes, aside');
  });

  it('scans role="search" landmark', () => {
    document.body.innerHTML = '<div role="search" aria-label="Find">Search box</div>';
    navigator.scanLandmarks();
    expect(navigator.nextLandmark()).toBe('Find, search');
  });

  it('reads aria-labelledby attribute value as label', () => {
    document.body.innerHTML = `
      <main aria-labelledby="lbl">Content</main>
    `;
    navigator.scanLandmarks();
    expect(navigator.nextLandmark()).toBe('lbl, main');
  });

  it('falls back to title attribute', () => {
    document.body.innerHTML = '<nav title="Main Nav">Links</nav>';
    navigator.scanLandmarks();
    expect(navigator.nextLandmark()).toBe('Main Nav, nav');
  });

  it('falls back to "Unnamed region" when no label', () => {
    document.body.innerHTML = '<main>No label</main>';
    navigator.scanLandmarks();
    expect(navigator.nextLandmark()).toBe('Unnamed region, main');
  });

  it('returns null when no landmarks exist', () => {
    expect(navigator.nextLandmark()).toBeNull();
  });

  // ── nextLandmark / previousLandmark ──────────────────────────────────────

  it('cycles through landmarks with nextLandmark', () => {
    document.body.innerHTML = `
      <main aria-label="Main">Main</main>
      <nav aria-label="Nav">Nav</nav>
    `;
    navigator.scanLandmarks();
    expect(navigator.nextLandmark()).toContain('Main');
    expect(navigator.nextLandmark()).toContain('Nav');
    expect(navigator.nextLandmark()).toContain('Main'); // cycles back
  });

  it('cycles backwards with previousLandmark', () => {
    document.body.innerHTML = `
      <main aria-label="Main">Main</main>
      <nav aria-label="Nav">Nav</nav>
    `;
    navigator.scanLandmarks();
    expect(navigator.previousLandmark()).toContain('Nav');
    expect(navigator.previousLandmark()).toContain('Main');
  });

  // ── focusElement ─────────────────────────────────────────────────────────

  it('sets tabindex -1 on unfocusable element', () => {
    const div = document.createElement('div');
    navigator.focusElement(div);
    expect(div.getAttribute('tabindex')).toBe('-1');
  });

  it('does not override existing tabindex', () => {
    const div = document.createElement('div');
    div.setAttribute('tabindex', '0');
    navigator.focusElement(div);
    expect(div.getAttribute('tabindex')).toBe('0');
  });

  // ── focusFirstIn ─────────────────────────────────────────────────────────

  it('focuses first focusable element in container', () => {
    document.body.innerHTML = `
      <div id="container">
        <span>Text</span>
        <button id="btn">Click</button>
        <a href="#">Link</a>
      </div>
    `;
    const container = document.getElementById('container');
    const result = navigator.focusFirstIn(container);
    expect(result).toBe(true);
    expect(document.activeElement?.id).toBe('btn');
  });

  it('returns false when no focusable elements', () => {
    const div = document.createElement('div');
    div.innerHTML = '<span>Text</span>';
    expect(navigator.focusFirstIn(div)).toBe(false);
  });

  it('returns false for null container', () => {
    expect(navigator.focusFirstIn(null)).toBe(false);
  });

  // ── getFocusedLabel ──────────────────────────────────────────────────────

  it('returns aria-label of focused element', () => {
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Save');
    document.body.appendChild(btn);
    btn.focus();
    expect(navigator.getFocusedLabel()).toBe('Save');
  });

  it('returns textContent as fallback', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Submit';
    document.body.appendChild(btn);
    btn.focus();
    expect(navigator.getFocusedLabel()).toBe('Submit');
  });

  it('returns "No focus" when nothing focused', () => {
    document.body.focus();
    expect(navigator.getFocusedLabel()).toBe('No focus');
  });

  // ── announce ─────────────────────────────────────────────────────────────

  it('creates live region on first announce', () => {
    navigator.announce('Hello');
    const region = document.getElementById('voice-live-region');
    expect(region).not.toBeNull();
    expect(region!.getAttribute('role')).toBe('status');
  });

  it('reuses existing live region', () => {
    navigator.announce('First');
    navigator.announce('Second');
    expect(document.querySelectorAll('#voice-live-region')).toHaveLength(1);
  });

  it('sets aria-live to assertive when requested', () => {
    navigator.announce('Urgent', 'assertive');
    const region = document.getElementById('voice-live-region');
    expect(region!.getAttribute('aria-live')).toBe('assertive');
  });
});
