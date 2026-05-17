import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertCloudAiAllowed, assertCloudAiAllowedSync } from '../../../services/ai/aiPolicy';
import type { PrivacySettings } from '../../../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockLoadSettings = vi.fn();

vi.mock('../../../services/storageService', () => ({
  storageService: {
    loadSettings: () => mockLoadSettings(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadSettings.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// assertCloudAiAllowedSync
// ---------------------------------------------------------------------------
describe('assertCloudAiAllowedSync', () => {
  it('does not throw for ollama (local provider)', () => {
    expect(() => assertCloudAiAllowedSync('ollama', undefined)).not.toThrow();
  });

  it('does not throw for webllm (local provider)', () => {
    expect(() => assertCloudAiAllowedSync('webllm', undefined)).not.toThrow();
  });

  it('does not throw for gemini when no privacy settings', () => {
    expect(() => assertCloudAiAllowedSync('gemini', undefined)).not.toThrow();
  });

  it('does not throw for gemini when localStorageOnly is false', () => {
    const privacy: PrivacySettings = {
      localStorageOnly: false,
      euDataResidency: false,
      analyticsEnabled: false,
      crashReporting: false,
      dataEncryption: true,
      shareUsageData: false,
    };
    expect(() => assertCloudAiAllowedSync('gemini', privacy)).not.toThrow();
  });

  it('throws when localStorageOnly is true for a cloud provider', () => {
    const privacy: PrivacySettings = {
      localStorageOnly: true,
      euDataResidency: false,
      analyticsEnabled: false,
      crashReporting: false,
      dataEncryption: true,
      shareUsageData: false,
    };
    expect(() => assertCloudAiAllowedSync('gemini', privacy)).toThrow(
      'Cloud provider blocked: local-only mode is active.',
    );
  });

  it('throws for openai when euDataResidency is true', () => {
    const privacy: PrivacySettings = {
      localStorageOnly: false,
      euDataResidency: true,
      analyticsEnabled: false,
      crashReporting: false,
      dataEncryption: true,
      shareUsageData: false,
    };
    expect(() => assertCloudAiAllowedSync('openai', privacy)).toThrow(
      'Cloud provider blocked by EU residency policy: openai',
    );
  });

  it('throws for grok when euDataResidency is true', () => {
    const privacy: PrivacySettings = {
      localStorageOnly: false,
      euDataResidency: true,
      analyticsEnabled: false,
      crashReporting: false,
      dataEncryption: true,
      shareUsageData: false,
    };
    expect(() => assertCloudAiAllowedSync('grok', privacy)).toThrow(
      'Cloud provider blocked by EU residency policy: grok',
    );
  });

  it('does not throw for gemini when only euDataResidency is true', () => {
    // QNBS-v3: EU residency only blocks grok and openai, not gemini/anthropic
    const privacy: PrivacySettings = {
      localStorageOnly: false,
      euDataResidency: true,
      analyticsEnabled: false,
      crashReporting: false,
      dataEncryption: true,
      shareUsageData: false,
    };
    expect(() => assertCloudAiAllowedSync('gemini', privacy)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// assertCloudAiAllowed (async)
// ---------------------------------------------------------------------------
describe('assertCloudAiAllowed', () => {
  it('resolves without throwing for local providers (no storage call)', async () => {
    await expect(assertCloudAiAllowed('ollama')).resolves.toBeUndefined();
    await expect(assertCloudAiAllowed('webllm')).resolves.toBeUndefined();
    expect(mockLoadSettings).not.toHaveBeenCalled();
  });

  it('loads settings and resolves for gemini when no restrictions', async () => {
    mockLoadSettings.mockResolvedValue({
      privacy: { localStorageOnly: false, euDataResidency: false },
    });
    await expect(assertCloudAiAllowed('gemini')).resolves.toBeUndefined();
    expect(mockLoadSettings).toHaveBeenCalled();
  });

  it('throws for gemini when settings have localStorageOnly', async () => {
    mockLoadSettings.mockResolvedValue({
      privacy: { localStorageOnly: true, euDataResidency: false },
    });
    await expect(assertCloudAiAllowed('gemini')).rejects.toThrow('local-only mode');
  });

  it('does not throw when settings are null (no privacy config)', async () => {
    mockLoadSettings.mockResolvedValue(null);
    await expect(assertCloudAiAllowed('gemini')).resolves.toBeUndefined();
  });
});
