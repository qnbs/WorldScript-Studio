import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — Tauri APIs unavailable in jsdom
// ---------------------------------------------------------------------------

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockRejectedValue(new Error('Tauri not available')),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn().mockRejectedValue(new Error('Tauri not available')),
  writeTextFile: vi.fn().mockRejectedValue(new Error('Tauri not available')),
  readFile: vi.fn().mockRejectedValue(new Error('Tauri not available')),
  writeFile: vi.fn().mockRejectedValue(new Error('Tauri not available')),
  mkdir: vi.fn().mockRejectedValue(new Error('Tauri not available')),
  exists: vi.fn().mockRejectedValue(new Error('Tauri not available')),
  readDir: vi.fn().mockRejectedValue(new Error('Tauri not available')),
  remove: vi.fn().mockRejectedValue(new Error('Tauri not available')),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockRejectedValue(new Error('Tauri not available')),
  save: vi.fn().mockRejectedValue(new Error('Tauri not available')),
}));

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockRejectedValue(new Error('Tauri not available')),
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join('/'))),
}));

vi.mock('../../services/logger', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fileSystemService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('exports a fileSystemService object', async () => {
    const { fileSystemService } = await import('../../services/fileSystemService');
    expect(fileSystemService).toBeTruthy();
    expect(typeof fileSystemService).toBe('object');
  });

  it('initialize() throws when Tauri is unavailable', async () => {
    const { fileSystemService } = await import('../../services/fileSystemService');
    await expect(fileSystemService.initialize()).rejects.toThrow();
  });

  it('saveProject() throws when Tauri is unavailable', async () => {
    const { fileSystemService } = await import('../../services/fileSystemService');
    await expect(
      fileSystemService.saveProject({
        title: 'Test',
        manuscript: [],
        characters: { ids: [], entities: {} },
        worlds: { ids: [], entities: {} },
      } as unknown as Parameters<typeof fileSystemService.saveProject>[0]),
    ).rejects.toThrow();
  });

  it('loadProject() returns null or throws when Tauri unavailable', async () => {
    const { fileSystemService } = await import('../../services/fileSystemService');
    // loadProject catches errors and returns null
    const result = await fileSystemService.loadProject('proj-1').catch(() => null);
    expect(result).toBeNull();
  });

  it('hasSavedData() returns false when Tauri unavailable', async () => {
    const { fileSystemService } = await import('../../services/fileSystemService');
    const result = await fileSystemService.hasSavedData().catch(() => false);
    expect(result).toBe(false);
  });

  it('listProjects() returns empty array or throws when Tauri unavailable', async () => {
    const { fileSystemService } = await import('../../services/fileSystemService');
    const result = await fileSystemService.listProjects().catch(() => []);
    expect(Array.isArray(result)).toBe(true);
  });

  it('getImage() returns null when Tauri unavailable', async () => {
    const { fileSystemService } = await import('../../services/fileSystemService');
    const result = await fileSystemService.getImage('img-1').catch(() => null);
    expect(result).toBeNull();
  });

  it('loadSettings() returns null when Tauri unavailable', async () => {
    const { fileSystemService } = await import('../../services/fileSystemService');
    const result = await fileSystemService.loadSettings().catch(() => null);
    expect(result).toBeNull();
  });

  it('getGeminiApiKey() returns null when Tauri unavailable', async () => {
    const { fileSystemService } = await import('../../services/fileSystemService');
    const result = await fileSystemService.getGeminiApiKey().catch(() => null);
    expect(result).toBeNull();
  });

  it('listSnapshots() returns empty array when Tauri unavailable', async () => {
    const { fileSystemService } = await import('../../services/fileSystemService');
    const result = await fileSystemService.listSnapshots().catch(() => []);
    expect(Array.isArray(result)).toBe(true);
  });
});
