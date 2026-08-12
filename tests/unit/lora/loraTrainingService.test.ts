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
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

import {
  abortTraining,
  checkTrainingEnvironment,
  generateOllamaModelfile,
  selectPythonExecutable,
} from '../../../services/lora/loraTrainingService';

describe('loraTrainingService — web build (no Tauri)', () => {
  beforeEach(() => {
    // Ensure __TAURI_INTERNALS__ is NOT present (web build)
    if ('__TAURI_INTERNALS__' in window) {
      delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }
  });

  it('checkTrainingEnvironment returns desktop-only message on web', async () => {
    const result = await checkTrainingEnvironment();
    expect(result.pythonAvailable).toBe(false);
    expect(result.message).toContain('desktop app');
  });

  it('abortTraining is a no-op on web and reports nothing to cancel', async () => {
    await expect(abortTraining()).resolves.toBe('nothing_to_cancel');
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
    vi.clearAllMocks();
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it('generateOllamaModelfile calls generate_ollama_modelfile via Tauri', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockResolvedValueOnce('FROM base\nADAPTER path\nSYSTEM "style"\n');
    const modelfile = await generateOllamaModelfile('base', 'path', 'style');
    expect(invoke).toHaveBeenCalledWith(
      'generate_ollama_modelfile',
      expect.objectContaining({
        baseModel: 'base',
      }),
    );
    expect(typeof modelfile).toBe('string');
  });

  it('propagates a native cancellation failure instead of claiming training stopped', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockRejectedValueOnce(new Error('training_cancel_not_confirmed'));

    await expect(abortTraining()).rejects.toThrow('training_cancel_not_confirmed');
    expect(invoke).toHaveBeenCalledWith('abort_lora_training', undefined);
  });

  it('passes through the native confirmed-process-stopped result', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockResolvedValueOnce('confirmed');
    await expect(abortTraining()).resolves.toBe('confirmed');
  });

  it('passes through the native no-op result (nothing was actually running)', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockResolvedValueOnce('nothing_to_cancel');
    await expect(abortTraining()).resolves.toBe('nothing_to_cancel');
  });

  it('passes through the native pending-start-cancelled result', async () => {
    // QNBS-v3 regression: a cancel during startup is a recorded cancellation, not a no-op — the
    // caller must be able to tell it apart from 'nothing_to_cancel'.
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockResolvedValueOnce('pending_start_cancelled');
    await expect(abortTraining()).resolves.toBe('pending_start_cancelled');
  });

  it('validates and persists an explicitly selected Python executable through the native resolver', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { open } = await import('@tauri-apps/plugin-dialog');
    vi.mocked(open).mockResolvedValueOnce('/opt/python 3.12/bin/python3');
    vi.mocked(invoke).mockResolvedValueOnce({
      python_available: true,
      unsloth_available: false,
      cuda_available: true,
      vram_gb: 24,
      python_version: '3.12.1',
      python_path: '/opt/python 3.12/bin/python3',
      last_error: null,
    });

    await expect(selectPythonExecutable()).resolves.toEqual({
      pythonAvailable: true,
      unslothAvailable: false,
      cudaAvailable: true,
      vramGb: 24,
      pythonVersion: '3.12.1',
      pythonPath: '/opt/python 3.12/bin/python3',
    });
    expect(invoke).toHaveBeenCalledWith('set_lora_python_path', {
      pythonPath: '/opt/python 3.12/bin/python3',
    });
  });

  it('does not invoke the native resolver when interpreter selection is cancelled', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { open } = await import('@tauri-apps/plugin-dialog');
    vi.mocked(open).mockResolvedValueOnce(null);

    await expect(selectPythonExecutable()).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalledWith('set_lora_python_path', expect.anything());
  });
});
