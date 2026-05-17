/**
 * Batch tests for all thin XyzViewContext modules (createContext + useXyzContext guard).
 * Each context follows the same pattern: null default, throws when used outside provider.
 * QNBS-v3: Covers 13 context files in one file to avoid proliferation of near-identical suites.
 */
import { render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppContext, useAppContext } from '../../contexts/AppContext';
import {
  CharacterGraphViewContext,
  useCharacterGraphViewContext,
} from '../../contexts/CharacterGraphViewContext';
import { CharacterViewContext, useCharacterViewContext } from '../../contexts/CharacterViewContext';
import { CommandExecutorProvider, useCommandExecutor } from '../../contexts/CommandExecutorContext';
import {
  ConsistencyCheckerViewContext,
  useConsistencyCheckerViewContext,
} from '../../contexts/ConsistencyCheckerViewContext';
import { CriticViewContext, useCriticViewContext } from '../../contexts/CriticViewContext';
import { DashboardContext, useDashboardContext } from '../../contexts/DashboardContext';
import { ExportViewContext, useExportViewContext } from '../../contexts/ExportViewContext';
import { HelpViewContext, useHelpViewContext } from '../../contexts/HelpViewContext';
import {
  ManuscriptViewContext,
  useManuscriptViewContext,
} from '../../contexts/ManuscriptViewContext';
import {
  OutlineGeneratorContext,
  useOutlineGeneratorContext,
} from '../../contexts/OutlineGeneratorContext';
import {
  SceneBoardViewContext,
  useSceneBoardViewContext,
} from '../../contexts/SceneBoardViewContext';
import { SettingsViewContext, useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { TemplateViewContext, useTemplateViewContext } from '../../contexts/TemplateViewContext';
import { useWorldViewContext, WorldViewContext } from '../../contexts/WorldViewContext';
import { useWriterViewContext, WriterViewContext } from '../../contexts/WriterViewContext';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function renderInContext<T>(Context: React.Context<T | null>, value: T, hook: () => T) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Context.Provider value={value}>{children}</Context.Provider>
  );
  return renderHook(hook, { wrapper });
}

// A minimal stand-in value for each context — only shape matters.
const STUB = {} as never;

// ---------------------------------------------------------------------------
// View context guard tests (throws when used outside provider)
// ---------------------------------------------------------------------------

describe('view context hooks throw outside provider', () => {
  const cases: Array<{ name: string; hook: () => unknown }> = [
    { name: 'useAppContext', hook: useAppContext },
    { name: 'useCharacterGraphViewContext', hook: useCharacterGraphViewContext },
    { name: 'useCharacterViewContext', hook: useCharacterViewContext },
    { name: 'useConsistencyCheckerViewContext', hook: useConsistencyCheckerViewContext },
    { name: 'useCriticViewContext', hook: useCriticViewContext },
    { name: 'useDashboardContext', hook: useDashboardContext },
    { name: 'useExportViewContext', hook: useExportViewContext },
    { name: 'useHelpViewContext', hook: useHelpViewContext },
    { name: 'useManuscriptViewContext', hook: useManuscriptViewContext },
    { name: 'useOutlineGeneratorContext', hook: useOutlineGeneratorContext },
    { name: 'useSceneBoardViewContext', hook: useSceneBoardViewContext },
    { name: 'useSettingsViewContext', hook: useSettingsViewContext },
    { name: 'useTemplateViewContext', hook: useTemplateViewContext },
    { name: 'useWorldViewContext', hook: useWorldViewContext },
    { name: 'useWriterViewContext', hook: useWriterViewContext },
  ];

  for (const { name, hook } of cases) {
    it(`${name} throws when context is null`, () => {
      expect(() => renderHook(hook)).toThrow();
    });
  }
});

// ---------------------------------------------------------------------------
// View context provider tests (returns value when provided)
// ---------------------------------------------------------------------------

describe('view context hooks return value when provided', () => {
  it('useDashboardContext returns provided value', () => {
    const { result } = renderInContext(DashboardContext, STUB, useDashboardContext);
    expect(result.current).toBe(STUB);
  });

  it('useAppContext returns provided value', () => {
    const { result } = renderInContext(AppContext, STUB, useAppContext);
    expect(result.current).toBe(STUB);
  });

  it('useCharacterViewContext returns provided value', () => {
    const { result } = renderInContext(CharacterViewContext, STUB, useCharacterViewContext);
    expect(result.current).toBe(STUB);
  });

  it('useCharacterGraphViewContext returns provided value', () => {
    const { result } = renderInContext(
      CharacterGraphViewContext,
      STUB,
      useCharacterGraphViewContext,
    );
    expect(result.current).toBe(STUB);
  });

  it('useExportViewContext returns provided value', () => {
    const { result } = renderInContext(ExportViewContext, STUB, useExportViewContext);
    expect(result.current).toBe(STUB);
  });

  it('useSettingsViewContext returns provided value', () => {
    const { result } = renderInContext(SettingsViewContext, STUB, useSettingsViewContext);
    expect(result.current).toBe(STUB);
  });

  it('useHelpViewContext returns provided value', () => {
    const { result } = renderInContext(HelpViewContext, STUB, useHelpViewContext);
    expect(result.current).toBe(STUB);
  });

  it('useWriterViewContext returns provided value', () => {
    const { result } = renderInContext(WriterViewContext, STUB, useWriterViewContext);
    expect(result.current).toBe(STUB);
  });

  it('useWorldViewContext returns provided value', () => {
    const { result } = renderInContext(WorldViewContext, STUB, useWorldViewContext);
    expect(result.current).toBe(STUB);
  });

  it('useTemplateViewContext returns provided value', () => {
    const { result } = renderInContext(TemplateViewContext, STUB, useTemplateViewContext);
    expect(result.current).toBe(STUB);
  });

  it('useSceneBoardViewContext returns provided value', () => {
    const { result } = renderInContext(SceneBoardViewContext, STUB, useSceneBoardViewContext);
    expect(result.current).toBe(STUB);
  });

  it('useManuscriptViewContext returns provided value', () => {
    const { result } = renderInContext(ManuscriptViewContext, STUB, useManuscriptViewContext);
    expect(result.current).toBe(STUB);
  });

  it('useOutlineGeneratorContext returns provided value', () => {
    const { result } = renderInContext(OutlineGeneratorContext, STUB, useOutlineGeneratorContext);
    expect(result.current).toBe(STUB);
  });

  it('useCriticViewContext returns provided value', () => {
    const { result } = renderInContext(CriticViewContext, STUB, useCriticViewContext);
    expect(result.current).toBe(STUB);
  });

  it('useConsistencyCheckerViewContext returns provided value', () => {
    const { result } = renderInContext(
      ConsistencyCheckerViewContext,
      STUB,
      useConsistencyCheckerViewContext,
    );
    expect(result.current).toBe(STUB);
  });
});

// ---------------------------------------------------------------------------
// CommandExecutorContext (slightly different: non-null default)
// ---------------------------------------------------------------------------

describe('CommandExecutorContext', () => {
  it('returns default no-op executor without provider', () => {
    const { result } = renderHook(() => useCommandExecutor());
    expect(result.current('any-command')).toBe(false);
  });

  it('returns provided executor when wrapped in provider', () => {
    const execute = (id: string) => id === 'do-it';
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CommandExecutorProvider execute={execute}>{children}</CommandExecutorProvider>
    );
    const { result } = renderHook(() => useCommandExecutor(), { wrapper });
    expect(result.current('do-it')).toBe(true);
    expect(result.current('nope')).toBe(false);
  });

  it('renders children correctly', () => {
    render(
      <CommandExecutorProvider execute={() => true}>
        <span>hello</span>
      </CommandExecutorProvider>,
    );
    expect(screen.getByText('hello')).toBeTruthy();
  });
});
