/**
 * Tests for services/lora/loraTrainingService.ts
 * QNBS-v3: Mock Tauri invoke; verify desktop detection and fallback.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue('training_completed'),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import {
  abortTraining,
  checkTrainingEnvironment,
  generateOllamaModelfile,
} from '../../../services/lora/loraTrainingService';

describe('loraTrainingService — web build (no Tauri)', () => {
  beforeEach(() => {
    // Ensure __TAURI_INTERNALS__ is NOT present (web build)
    if ('__TAURI_INTERNALS__' in window) {
      // biome-ignore lint/suspicious/noExplicitAny: test teardown
      delete (window as any).__TAURI_INTERNALS__;
    }
  });

  it('checkTrainingEnvironment returns desktop-only message on web', async () => {
    const result = await checkTrainingEnvironment();
    expect(result.pythonAvailable).toBe(false);
    expect(result.message).toContain('desktop app');
  });

  it('abortTraining is a no-op on web (does not throw)', async () => {
    await expect(abortTraining()).resolves.toBeUndefined();
  });

  it('generateOllamaModelfile returns valid template on web', async () => {
    const modelfile = await generateOllamaModelfile(
      'llama-3.2-7b',
      '/path/adapter.gguf',
      'MyStyle',
    );
    expect(modelfile).toContain('FROM llama-3.2-7b');
    expect(modelfile).toContain('ADAPTER /path/adapter.gguf');
    expect(modelfile).toContain('MyStyle');
  });
});

describe('loraTrainingService — Tauri desktop build', () => {
  beforeEach(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test setup
    (window as any).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test teardown
    delete (window as any).__TAURI_INTERNALS__;
  });

  it('generateOllamaModelfile calls generate_ollama_modelfile via Tauri', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockResolvedValueOnce('FROM base\nADAPTER path\nSYSTEM "style"\n');
    const modelfile = await generateOllamaModelfile('base', 'path', 'style');
    expect(invoke).toHaveBeenCalledWith(
      'generate_ollama_modelfile',
      expect.objectContaining({
        base_model: 'base',
      }),
    );
    expect(typeof modelfile).toBe('string');
  });
});
