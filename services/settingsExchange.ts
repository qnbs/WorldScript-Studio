import { z } from 'zod';
import type { Settings } from '../types';

export const SETTINGS_EXPORT_VERSION = 1 as const;

export const settingsExportEnvelopeSchema = z.object({
  worldscriptSettingsExportVersion: z.literal(SETTINGS_EXPORT_VERSION),
  settings: z.record(z.string(), z.unknown()),
});

export type SettingsExportEnvelope = z.infer<typeof settingsExportEnvelopeSchema>;

export function buildSettingsExportEnvelope(settings: Settings): SettingsExportEnvelope {
  return {
    worldscriptSettingsExportVersion: SETTINGS_EXPORT_VERSION,
    settings: { ...(settings as unknown as Record<string, unknown>) },
  };
}

export function parseSettingsImportEnvelope(raw: unknown): Partial<Settings> | null {
  const result = settingsExportEnvelopeSchema.safeParse(raw);
  if (!result.success) return null;
  return result.data.settings as Partial<Settings>;
}
