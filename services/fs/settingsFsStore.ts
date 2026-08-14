/**
 * FsSettingsStore — Settings persistence on the filesystem.
 * API-key persistence is deliberately disabled here; storageService routes keys to the random-key IDB store.
 * QNBS-v3: Extracted from fileSystemService.ts.
 */

import { appStoreRef } from '../../app/storeRef';
import { statusActions } from '../../features/status/statusSlice';
import type { Settings } from '../../types';
import { logger } from '../logger';
import { normalizePersistedSettings } from '../storage/idbProjectStore';
import type { TauriApis } from './fsCore';
import { FsCore, retryFs, writeTextFileAtomic } from './fsCore';

export class FsSettingsStore extends FsCore {
  async removeLegacyApiKeyFiles(): Promise<void> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const configPath = await apis.join(appDataPath, 'config');
    const providers = ['gemini', 'openai', 'anthropic', 'grok', 'openrouter'];

    for (const provider of providers) {
      const keyFile = await apis.join(configPath, `${provider}_key.enc.json`);
      try {
        if (await apis.exists(keyFile)) await retryFs(() => apis.remove(keyFile));
      } catch (error) {
        logger.warn(`Failed to remove legacy API key file for provider "${provider}":`, error);
      }
    }
  }

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
      // QNBS-v3: reuse the same normalizer as the IDB path — older desktop settings files can
      // predate newer required Settings fields (e.g. writingSurfaceStyle); an unchecked `as
      // Settings` cast would let those fall through as undefined at runtime.
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

  // QNBS-v3: filesystem key persistence is disabled because app-path-derived material is recoverable.
  async saveApiKey(provider: string, _apiKey: string): Promise<void> {
    throw new Error(
      `Desktop filesystem API-key storage is disabled for ${provider}; use storageService instead`,
    );
  }

  async getApiKey(provider: string): Promise<string | null> {
    // QNBS-v3: separate outer refs (rather than narrowing `apis`/`keyFile` from the try block) —
    // TS's control-flow narrowing doesn't survive into the retryFs() closure below, and the catch
    // block below still needs both for the legacy-payload cleanup path.
    let apisForCleanup: TauriApis | undefined;
    let keyFileForCleanup: string | undefined;
    try {
      const apis = await this.getApis();
      apisForCleanup = apis;
      const appDataPath = await this.ensureAppDataPath();
      const keyFile = await apis.join(appDataPath, 'config', `${provider}_key.enc.json`);
      keyFileForCleanup = keyFile;
      if (!(await apis.exists(keyFile))) return null;
      await retryFs(() => apis.remove(keyFile));
      return null;
    } catch (error) {
      // QNBS-v3: pre-2026-07-29 key files used an unsalted single-SHA-256 derivation (F-05/F-06,
      // fixed in fsCore.ts) and are not migrated (locked decision — discard, not migrate). Remove
      // the stale file so this doesn't retry on every call, and surface a one-time, explicit
      // notification rather than a silent null return that looks identical to "no key ever set".
      if (apisForCleanup && keyFileForCleanup) {
        try {
          await apisForCleanup.remove(keyFileForCleanup);
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
      logger.warn(`Failed to decrypt API key for provider "${provider}":`, error);
      return null;
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
