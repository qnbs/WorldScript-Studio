/**
 * FsSettingsStore — Settings persistence and API key protection on the filesystem.
 * ENCRYPTION: AES-256-GCM under the user's real at-rest-encryption passphrase (reused from
 * services/storage/storageEncryptionService.ts) when one is configured and unlocked; honest
 * plaintext otherwise. QNBS-v3 (F-05/F-06 follow-up, 2026-08-13): the prior scheme derived its
 * PBKDF2 key from `${appDataPath}|${provider}|WorldScriptStudio|v1` — entirely public/
 * reconstructible by anyone who can read the encrypted file, so it provided no real
 * confidentiality despite looking like AES-256-GCM+PBKDF2. Retired outright rather than patched;
 * see getApiKey's legacy-format discard path.
 * QNBS-v3: Extracted from fileSystemService.ts.
 */

import { appStoreRef } from '../../app/storeRef';
import { statusActions } from '../../features/status/statusSlice';
import type { Settings } from '../../types';
import { logger } from '../logger';
import { normalizePersistedSettings } from '../storage/idbProjectStore';
import {
  IdbStorageLockedError,
  idbDecryptWithKey,
  idbEncryptWithKey,
  resolveProtectedWriteKey,
} from '../storage/storageEncryptionService';
import type { TauriApis } from './fsCore';
import { base64ToBytes, bytesToBase64, FsCore, retryFs, writeTextFileAtomic } from './fsCore';

const PLAINTEXT_SCHEME = 'plaintext-v1';
const PROTECTED_SCHEME = 'protected-v1';

interface PlaintextApiKeyPayload {
  scheme: typeof PLAINTEXT_SCHEME;
  value: string;
}

interface ProtectedApiKeyPayload {
  scheme: typeof PROTECTED_SCHEME;
  data: string;
}

export class FsSettingsStore extends FsCore {
  async saveSettings(settings: Settings): Promise<void> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const configPath = await apis.join(appDataPath, 'config');

    if (!(await apis.exists(configPath))) {
      await apis.mkdir(configPath, { recursive: true });
    }

    const settingsFile = await apis.join(configPath, 'settings.json');
    await writeTextFileAtomic(apis, settingsFile, JSON.stringify(settings, null, 2));
  }

  async loadSettings(): Promise<Settings | null> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const settingsFile = await apis.join(appDataPath, 'config', 'settings.json');

      if (!(await apis.exists(settingsFile))) {
        return null;
      }

      const content = await retryFs(() => apis.readTextFile(settingsFile));
      const parsed = JSON.parse(content) as Record<string, unknown>;
      // QNBS-v3: reuse the same normalizer as the IDB path — older desktop settings files can predate newer required Settings fields (e.g. writingSurfaceStyle); an unchecked `as Settings` cast would let those fall through as undefined at runtime.
      return normalizePersistedSettings(parsed);
    } catch (error) {
      logger.error('Failed to load settings:', error);
      return null;
    }
  }

  // Gemini API key storage — delegates to generic provider key storage
  async saveGeminiApiKey(apiKey: string): Promise<void> {
    return this.saveApiKey('gemini', apiKey);
  }

  async getGeminiApiKey(): Promise<string | null> {
    return this.getApiKey('gemini');
  }

  async clearGeminiApiKey(): Promise<void> {
    return this.clearApiKey('gemini');
  }

  // Generic provider API key — protected under the real at-rest-encryption passphrase when one is
  // configured and unlocked; stored as honest plaintext otherwise (never a fake-secret derivation).
  async saveApiKey(provider: string, apiKey: string): Promise<void> {
    if (!apiKey?.trim()) {
      throw new Error('API key cannot be empty');
    }

    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const configPath = await apis.join(appDataPath, 'config');
    if (!(await apis.exists(configPath))) await apis.mkdir(configPath, { recursive: true });

    // QNBS-v3: resolveProtectedWriteKey() throws IdbStorageLockedError when configured-but-locked — propagated deliberately (fail closed) rather than silently falling back to plaintext, matching the existing IDB protected-write policy this reuses.
    const key = await resolveProtectedWriteKey();
    const payload: ProtectedApiKeyPayload | PlaintextApiKeyPayload = key
      ? {
          scheme: PROTECTED_SCHEME,
          // QNBS-v3: encrypts {provider, apiKey} together (not just the bare key) so a ciphertext swapped between two providers' files decrypts but fails the provider check below, instead of silently handing one provider's key to another.
          data: bytesToBase64(await idbEncryptWithKey(key, { provider, apiKey: apiKey.trim() })),
        }
      : { scheme: PLAINTEXT_SCHEME, value: apiKey.trim() };

    const filePath = await apis.join(configPath, `${provider}_key.enc.json`);
    await writeTextFileAtomic(apis, filePath, JSON.stringify(payload));
  }

  private async readProtectedApiKey(provider: string, base64Data: string): Promise<string> {
    const key = await resolveProtectedWriteKey();
    if (!key) {
      // Sentinel was cleared/disabled since this key was saved under the old, now-configured-off
      // passphrase — there is nothing left to decrypt with; treat the same as an unreadable file.
      throw new Error('Protected API key exists but at-rest encryption is no longer configured');
    }
    const decrypted = await idbDecryptWithKey<{ provider: string; apiKey: string }>(
      key,
      base64ToBytes(base64Data),
    );
    if (decrypted.provider !== provider) {
      throw new Error(
        `Decrypted payload belongs to provider "${decrypted.provider}", not "${provider}"`,
      );
    }
    return decrypted.apiKey;
  }

  async getApiKey(provider: string): Promise<string | null> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const keyFile = await apis.join(appDataPath, 'config', `${provider}_key.enc.json`);

    let parsed: Record<string, unknown>;
    try {
      if (!(await apis.exists(keyFile))) return null;
      const content = await retryFs(() => apis.readTextFile(keyFile));
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch (error) {
      // A transient read/parse failure is not evidence the format is obsolete — preserve the file.
      logger.warn(`Failed to read API key file for provider "${provider}":`, error);
      return null;
    }

    if (parsed['scheme'] === PLAINTEXT_SCHEME && typeof parsed['value'] === 'string') {
      return parsed['value'];
    }

    if (parsed['scheme'] === PROTECTED_SCHEME && typeof parsed['data'] === 'string') {
      try {
        return await this.readProtectedApiKey(provider, parsed['data']);
      } catch (error) {
        if (error instanceof IdbStorageLockedError) {
          // Configured but locked — the key still exists, just temporarily unreadable. Fail closed without discarding the file; the caller re-prompts once the session is unlocked.
          return null;
        }
        // QNBS-v3: a RECOGNIZED protected-v1 envelope that fails to decrypt (rotated passphrase, transient sentinel-lookup error) is NOT an obsolete format — never discard on an ambiguous decrypt failure; only genuinely unrecognized shapes are discarded below.
        logger.warn(
          `Failed to decrypt protected API key for provider "${provider}" (file preserved, not discarded):`,
          error,
        );
        return null;
      }
    }

    // Anything else is one of the two obsolete pre-2026-08-13 formats (unsalted single-SHA-256, or
    // salted-but-publicly-derivable-passphrase — F-05/F-06) — neither provides real confidentiality
    // and neither is migrated by design; this is the only path that discards the file.
    await this.discardObsoleteApiKeyFile(provider, apis, keyFile);
    return null;
  }

  // QNBS-v3: pre-2026-08-13 key files (both obsolete crypto schemes) are not migrated (locked decision — discard); removing the stale file avoids retrying every call, and a one-time notification beats a silent null indistinguishable from "no key ever set".
  private async discardObsoleteApiKeyFile(
    provider: string,
    apis: TauriApis,
    keyFile: string,
  ): Promise<void> {
    try {
      await apis.remove(keyFile);
      appStoreRef.current?.dispatch(
        statusActions.addNotification({
          type: 'info',
          title: 'API Key Reset Required',
          description: `Your saved ${provider} API key was encrypted with a scheme that has since been hardened and could not be read. Please re-enter it in Settings → AI.`,
        }),
      );
    } catch (cleanupError) {
      logger.warn(`Failed to remove stale key file for provider "${provider}":`, cleanupError);
    }
  }

  async clearApiKey(provider: string): Promise<void> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const keyFile = await apis.join(appDataPath, 'config', `${provider}_key.enc.json`);
      if (await apis.exists(keyFile)) await retryFs(() => apis.remove(keyFile));
    } catch {
      /* ignore */
    }
  }
}
