import {
  buildEntityCommands,
  buildLanguageCommands,
  getStaticCommandDefinitions,
} from './commandDefinitions';
import type { CommandDefinition, CommandRuntimeDeps, PaletteCommandModel } from './commandTypes';
import { COMMAND_CATEGORY_I18N } from './commandTypes';

function resolveTitle(def: CommandDefinition, deps: CommandRuntimeDeps): string {
  if (def.inlineTitle) return def.inlineTitle;
  return deps.t<string>(def.titleKey);
}

export function collectAllDefinitions(deps: CommandRuntimeDeps): CommandDefinition[] {
  return [
    ...getStaticCommandDefinitions(),
    ...buildLanguageCommands(deps),
    ...buildEntityCommands(deps),
  ];
}

export function buildPaletteCommandModels(deps: CommandRuntimeDeps): PaletteCommandModel[] {
  const defs = collectAllDefinitions(deps);
  const models: PaletteCommandModel[] = [];

  for (const def of defs) {
    if (def.when && !def.when(deps)) continue;
    const categoryLabel = deps.t<string>(COMMAND_CATEGORY_I18N[def.category]);
    const model: PaletteCommandModel = {
      id: def.id,
      title: resolveTitle(def, deps),
      categoryLabel,
      category: def.category,
      icon: def.icon,
      keywords: def.keywords ?? [],
      run: () => def.run(deps),
    };
    if (def.shortcutHint) {
      model.shortcutDisplay = def.shortcutHint;
    }
    models.push(model);
  }

  return models;
}

export function runCommandById(id: string, deps: CommandRuntimeDeps): boolean {
  const defs = collectAllDefinitions(deps);
  const def = defs.find((d) => d.id === id);
  if (!def) return false;
  if (def.when && !def.when(deps)) return false;
  def.run(deps);
  return true;
}
