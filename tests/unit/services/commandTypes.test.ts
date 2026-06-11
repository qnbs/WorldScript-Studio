/**
 * Tests for services/commands/commandTypes.ts
 * QNBS-v3: Pure constant — verifies COMMAND_CATEGORY_I18N maps every category to the correct i18n key.
 */

import { describe, expect, it } from 'vitest';
import { COMMAND_CATEGORY_I18N } from '../../../services/commands/commandTypes';

describe('COMMAND_CATEGORY_I18N', () => {
  it('maps navigation to palette.category.navigation', () => {
    expect(COMMAND_CATEGORY_I18N.navigation).toBe('palette.category.navigation');
  });

  it('maps aiActions to palette.category.ai', () => {
    expect(COMMAND_CATEGORY_I18N.aiActions).toBe('palette.category.ai');
  });

  it('maps projectManagement to palette.category.actions', () => {
    expect(COMMAND_CATEGORY_I18N.projectManagement).toBe('palette.category.actions');
  });

  it('maps editor to palette.category.editor', () => {
    expect(COMMAND_CATEGORY_I18N.editor).toBe('palette.category.editor');
  });

  it('maps settings to palette.category.settings', () => {
    expect(COMMAND_CATEGORY_I18N.settings).toBe('palette.category.settings');
  });

  it('maps help to palette.category.help', () => {
    expect(COMMAND_CATEGORY_I18N.help).toBe('palette.category.help');
  });

  it('maps global to palette.category.global', () => {
    expect(COMMAND_CATEGORY_I18N.global).toBe('palette.category.global');
  });

  it('maps customUser to palette.category.custom', () => {
    expect(COMMAND_CATEGORY_I18N.customUser).toBe('palette.category.custom');
  });

  it('has exactly 10 category entries', () => {
    expect(Object.keys(COMMAND_CATEGORY_I18N)).toHaveLength(10);
  });
});
