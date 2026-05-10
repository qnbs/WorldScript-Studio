import { z } from 'zod';

export const accessibilityPresetIdSchema = z.enum([
  'custom',
  'motor',
  'lowVision',
  'cognitive',
  'screenReader',
]);

export const accessibilitySettingsSchema = z.object({
  highContrast: z.boolean(),
  reducedMotion: z.boolean(),
  largeText: z.boolean(),
  screenReader: z.boolean(),
  focusIndicators: z.boolean(),
  colorBlindMode: z.enum(['none', 'protanopia', 'deuteranopia', 'tritanopia']),
  presetId: accessibilityPresetIdSchema,
  liveRegionVerbosity: z.enum(['minimal', 'normal', 'verbose']),
  comfortableTargets: z.boolean(),
});

export type NormalizedAccessibilitySettings = z.infer<typeof accessibilitySettingsSchema>;

export const DEFAULT_NORMALIZED_ACCESSIBILITY: NormalizedAccessibilitySettings = {
  highContrast: false,
  reducedMotion: false,
  largeText: false,
  screenReader: false,
  focusIndicators: true,
  colorBlindMode: 'none',
  presetId: 'custom',
  liveRegionVerbosity: 'normal',
  comfortableTargets: false,
};

/** Merge unknown/partial persisted accessibility with defaults and enforce schema (hydration-safe). */
export function normalizeAccessibilitySettings(input: unknown): NormalizedAccessibilitySettings {
  const merged: Record<string, unknown> = {
    ...DEFAULT_NORMALIZED_ACCESSIBILITY,
    ...(typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}),
  };
  const parsed = accessibilitySettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_NORMALIZED_ACCESSIBILITY;
}

export function accessibilityPresetDefaults(
  preset: Exclude<NormalizedAccessibilitySettings['presetId'], 'custom'>,
): NormalizedAccessibilitySettings {
  const base = { ...DEFAULT_NORMALIZED_ACCESSIBILITY };
  switch (preset) {
    case 'motor':
      return normalizeAccessibilitySettings({
        ...base,
        presetId: 'motor',
        largeText: true,
        focusIndicators: true,
        comfortableTargets: true,
      });
    case 'lowVision':
      return normalizeAccessibilitySettings({
        ...base,
        presetId: 'lowVision',
        highContrast: true,
        largeText: true,
        focusIndicators: true,
      });
    case 'cognitive':
      return normalizeAccessibilitySettings({
        ...base,
        presetId: 'cognitive',
        reducedMotion: true,
        focusIndicators: true,
        liveRegionVerbosity: 'minimal',
      });
    case 'screenReader':
      return normalizeAccessibilitySettings({
        ...base,
        presetId: 'screenReader',
        screenReader: true,
        focusIndicators: true,
        liveRegionVerbosity: 'verbose',
      });
    default:
      return DEFAULT_NORMALIZED_ACCESSIBILITY;
  }
}
