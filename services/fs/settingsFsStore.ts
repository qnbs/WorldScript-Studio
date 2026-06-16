/**
 * FsSettingsStore — Settings persistence and AES-256-GCM API key encryption on the filesystem.
 * ENCRYPTION: AES-256-GCM — API keys stored as `<provider>_key.enc.json` in config/.
 * QNBS-v3: Extracted from fileSystemService.ts.
 */

import type { Settings } from '../../types';
import { DEFAULT_WEBRTC_SIGNALING_URLS } from '../collaborationService';
import { logger } from '../logger';
import { decryptText, encryptText, FsCore, retryFs } from './fsCore';

export class FsSettingsStore extends FsCore {
  async saveSettings(settings: Settings): Promise<void> {
    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const configPath = await apis.join(appDataPath, 'config');

    if (!(await apis.exists(configPath))) {
      await apis.mkdir(configPath, { recursive: true });
    }

    const settingsFile = await apis.join(configPath, 'settings.json');
    await retryFs(() => apis.writeTextFile(settingsFile, JSON.stringify(settings, null, 2)));
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
      const parsed = JSON.parse(content) as Settings;
      const collabDefaults = {
        realTimeCollaboration: false,
        publicSharing: false,
        commentSystem: true,
        versionHistory: true,
        webrtcSignalingUrls: [...DEFAULT_WEBRTC_SIGNALING_URLS],
      };
      parsed.collaboration = {
        ...collabDefaults,
        ...(parsed.collaboration ?? {}),
      };
      if (
        !parsed.collaboration.webrtcSignalingUrls ||
        parsed.collaboration.webrtcSignalingUrls.length === 0
      ) {
        parsed.collaboration.webrtcSignalingUrls = [...DEFAULT_WEBRTC_SIGNALING_URLS];
      }
      const integrationsDefaults = {
        syncProvider: 'none' as const,
        evernoteSync: false,
        notionSync: false,
        scrivenerExport: false,
        googleDocsImport: false,
        languageToolEnabled: false,
        languageToolBaseUrl: 'http://localhost:8010',
      };
      parsed.integrations = { ...integrationsDefaults, ...(parsed.integrations ?? {}) };
      return parsed;
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

  // Generic provider API key — stored encrypted in app data dir
  async saveApiKey(provider: string, apiKey: string): Promise<void> {
    if (!apiKey?.trim()) {
      throw new Error('API key cannot be empty');
    }

    const apis = await this.getApis();
    const appDataPath = await this.ensureAppDataPath();
    const configPath = await apis.join(appDataPath, 'config');
    if (!(await apis.exists(configPath))) await apis.mkdir(configPath, { recursive: true });

    const encrypted = await encryptText(
      apiKey.trim(),
      `${appDataPath}|${provider}|WorldScriptStudio|v1`,
    );
    const filePath = await apis.join(configPath, `${provider}_key.enc.json`);
    await retryFs(() => apis.writeTextFile(filePath, JSON.stringify(encrypted)));
  }

  async getApiKey(provider: string): Promise<string | null> {
    try {
      const apis = await this.getApis();
      const appDataPath = await this.ensureAppDataPath();
      const keyFile = await apis.join(appDataPath, 'config', `${provider}_key.enc.json`);
      if (!(await apis.exists(keyFile))) return null;
      const content = await retryFs(() => apis.readTextFile(keyFile));
      const payload = JSON.parse(content) as { iv: string; data: string };
      return await decryptText(payload, `${appDataPath}|${provider}|WorldScriptStudio|v1`);
    } catch (error) {
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
