/**
 * Tests for services/lora/loraTrainingService.ts
 * QNBS-v3: Mock the desktopPlatform adapter; verify desktop detection and web fallback.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  isDesktop: { value: true },
  trainLora: vi.fn(async (_request: unknown) => 'training_completed'),
  onLoraTrainingProgress: vi.fn(async (_cb: (payload: unknown) => void) => () => {}),
  abortLoraTraining: vi.fn(
    async (): Promise<'confirmed' | 'pending_start_cancelled' | 'nothing_to_cancel'> => 'confirmed',
  ),
  mergeLora: vi.fn(async (_request: unknown) => {}),
  checkLoraEnvironment: vi.fn(async () => ({
    python_available: false,
    unsloth_available: false,
    cuda_available: false,
    vram_gb: 0,
    python_version: '',
  })),
  setLoraPythonPath: vi.fn(async (_pythonPath: string) => ({
    python_available: true,
    unsloth_available: false,
    cuda_available: true,
    vram_gb: 24,
    python_version: '3.12.1',
    python_path: '/opt/python 3.12/bin/python3',
    last_error: null,
  })),
  generateOllamaModelfile: vi.fn(async (_request: unknown) => 'FROM base\nADAPTER path\n'),
  openFilePicker: vi.fn(async (_opts?: unknown): Promise<string | null> => null),
}));

vi.mock('../../../services/desktopPlatform', () => ({
  get desktopPlatform() {
    return {
      runtime: {
        get isDesktop() {
          return h.isDesktop.value;
        },
        os: null,
      },
      tasks: {
        trainLora: (request: unknown) => h.trainLora(request),
        onLoraTrainingProgress: (cb: (payload: unknown) => void) => h.onLoraTrainingProgress(cb),
        abortLoraTraining: () => h.abortLoraTraining(),
        mergeLora: (request: unknown) => h.mergeLora(request),
        checkLoraEnvironment: () => h.checkLoraEnvironment(),
        setLoraPythonPath: (pythonPath: string) => h.setLoraPythonPath(pythonPath),
        generateOllamaModelfile: (request: unknown) => h.generateOllamaModelfile(request),
      },
      dialogs: {
        openFilePicker: (opts?: unknown) => h.openFilePicker(opts),
      },
    };
  },
}));

import {
  abortTraining,
  checkTrainingEnvironment,
  generateOllamaModelfile,
  mergeAdapter,
  selectPythonExecutable,
  startTraining,
} from '../../../services/lora/loraTrainingService';

describe('loraTrainingService — web build (no desktop)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.isDesktop.value = false;
  });

  it('checkTrainingEnvironment returns desktop-only message on web', async () => {
    const result = await checkTrainingEnvironment();
    expect(result.pythonAvailable).toBe(false);
    expect(result.message).toContain('desktop app');
  });

  it('abortTraining is a no-op on web and reports nothing to cancel', async () => {
    await expect(abortTraining()).resolves.toBe('nothing_to_cancel');
    expect(h.abortLoraTraining).not.toHaveBeenCalled();
  });

  it('startTraining rejects on web', async () => {
    await expect(startTraining({} as never, vi.fn())).rejects.toThrow('desktop app');
  });

  it('mergeAdapter rejects on web', async () => {
    await expect(mergeAdapter('base', '/a', '/o')).rejects.toThrow('desktop app');
  });

  it('selectPythonExecutable resolves null on web', async () => {
    await expect(selectPythonExecutable()).resolves.toBeNull();
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
    expect(h.generateOllamaModelfile).not.toHaveBeenCalled();
  });
});

describe('loraTrainingService — desktop build', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.isDesktop.value = true;
  });

  it('startTraining wraps the request under the LoraTrainRequest shape and unsubscribes progress on completion', async () => {
    const preset = {
      id: 'balanced',
    } as unknown as import('../../../features/lora/types').HyperparamPreset;
    const onProgress = vi.fn();
    const result = await startTraining(
      {
        projectId: 'p1',
        baseModelId: 'base',
        datasetPath: '/data',
        outputDir: '/out',
        preset,
        customRank: 8,
      },
      onProgress,
    );
    expect(h.trainLora).toHaveBeenCalledWith({
      model_id: 'base',
      dataset_path: '/data',
      output_dir: '/out',
      preset: 'balanced',
      rank: 8,
      alpha: null,
      epochs: null,
      max_seq_len: null,
    });
    expect(result.adapterPath).toBe('/out/adapter');
    expect(result.ggufPath).toBe('/out/adapter.gguf');
    expect(h.onLoraTrainingProgress).toHaveBeenCalledTimes(1);
  });

  it('startTraining forwards progress events to onProgress', async () => {
    h.onLoraTrainingProgress.mockImplementationOnce(async (cb: (payload: unknown) => void) => {
      cb({ event: 'progress', progress_percent: 50 });
      return () => {};
    });
    const preset = {
      id: 'balanced',
    } as unknown as import('../../../features/lora/types').HyperparamPreset;
    const onProgress = vi.fn();
    await startTraining(
      { projectId: 'p1', baseModelId: 'base', datasetPath: '/data', outputDir: '/out', preset },
      onProgress,
    );
    expect(onProgress).toHaveBeenCalledWith({ event: 'progress', progress_percent: 50 });
  });

  it('generateOllamaModelfile calls the platform adapter', async () => {
    h.generateOllamaModelfile.mockResolvedValueOnce('FROM base\nADAPTER path\nSYSTEM "style"\n');
    const modelfile = await generateOllamaModelfile('base', 'path', 'style');
    expect(h.generateOllamaModelfile).toHaveBeenCalledWith({
      baseModel: 'base',
      adapterPath: 'path',
      name: 'style',
    });
    expect(typeof modelfile).toBe('string');
  });

  it('mergeAdapter calls the platform adapter with the correct request shape', async () => {
    await mergeAdapter('base', '/adapter', '/out');
    expect(h.mergeLora).toHaveBeenCalledWith({
      baseModel: 'base',
      adapterPath: '/adapter',
      outputPath: '/out',
    });
  });

  it('propagates a native cancellation failure instead of claiming training stopped', async () => {
    h.abortLoraTraining.mockRejectedValueOnce(new Error('training_cancel_not_confirmed'));
    await expect(abortTraining()).rejects.toThrow('training_cancel_not_confirmed');
  });

  it('passes through the native confirmed-process-stopped result', async () => {
    h.abortLoraTraining.mockResolvedValueOnce('confirmed');
    await expect(abortTraining()).resolves.toBe('confirmed');
  });

  it('passes through the native no-op result (nothing was actually running)', async () => {
    h.abortLoraTraining.mockResolvedValueOnce('nothing_to_cancel');
    await expect(abortTraining()).resolves.toBe('nothing_to_cancel');
  });

  it('passes through the native pending-start-cancelled result', async () => {
    // QNBS-v3 regression: a cancel during startup is a recorded cancellation, not a no-op — the
    // caller must be able to tell it apart from 'nothing_to_cancel'.
    h.abortLoraTraining.mockResolvedValueOnce('pending_start_cancelled');
    await expect(abortTraining()).resolves.toBe('pending_start_cancelled');
  });

  it('validates and persists an explicitly selected Python executable through the native resolver', async () => {
    h.openFilePicker.mockResolvedValueOnce('/opt/python 3.12/bin/python3');

    await expect(selectPythonExecutable()).resolves.toEqual({
      pythonAvailable: true,
      unslothAvailable: false,
      cudaAvailable: true,
      vramGb: 24,
      pythonVersion: '3.12.1',
      pythonPath: '/opt/python 3.12/bin/python3',
    });
    expect(h.setLoraPythonPath).toHaveBeenCalledWith('/opt/python 3.12/bin/python3');
  });

  it('does not invoke the native resolver when interpreter selection is cancelled', async () => {
    h.openFilePicker.mockResolvedValueOnce(null);

    await expect(selectPythonExecutable()).resolves.toBeNull();
    expect(h.setLoraPythonPath).not.toHaveBeenCalled();
  });

  it('checkTrainingEnvironment falls back gracefully when the platform adapter rejects', async () => {
    h.checkLoraEnvironment.mockRejectedValueOnce(new Error('native check failed'));
    const result = await checkTrainingEnvironment();
    expect(result.pythonAvailable).toBe(false);
    expect(result.message).toContain('native check failed');
  });
});
