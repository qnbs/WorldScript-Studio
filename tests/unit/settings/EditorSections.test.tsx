/**
 * Tests for components/settings/EditorSections.tsx (EditorSection + AdvancedEditorSection)
 * QNBS-v3: Mocks SettingsViewContext; tests font selector, sliders, toggles, preview.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockHandleSettingChange, settingsRef } = vi.hoisted(() => ({
  mockHandleSettingChange: vi.fn(),
  settingsRef: { current: {} as Record<string, unknown> },
}));

const makeSettings = () => ({
  editorFont: 'serif',
  customFont: null,
  fontSize: 16,
  lineSpacing: 1.6,
  paragraphSpacing: 1.0,
  indentFirstLine: false,
  advancedEditor: {
    autoComplete: true,
    spellCheck: true,
    grammarCheck: false,
    wordCount: true,
    readingTime: false,
    writingStats: false,
    distractionFree: false,
    typewriterMode: false,
    zenMode: false,
    focusMode: false,
  },
});

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => ({
    t: (k: string) => k,
    settings: { ...makeSettings(), ...settingsRef.current },
    handleSettingChange: mockHandleSettingChange,
  }),
}));

vi.mock('../../../components/ui/Select', () => ({
  Select: vi.fn(
    ({ children, value, onChange, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
      <select value={value} onChange={onChange} {...rest}>
        {children}
      </select>
    ),
  ),
}));

vi.mock('../../../components/ui/Input', () => ({
  Input: vi.fn(({ value, onChange, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input value={value} onChange={onChange} {...rest} />
  )),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import type React from 'react';
import { AdvancedEditorSection, EditorSection } from '../../../components/settings/EditorSections';

// ---------------------------------------------------------------------------
// Tests — EditorSection
// ---------------------------------------------------------------------------

describe('EditorSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the editor title', () => {
    render(<EditorSection />);
    expect(screen.getByText('settings.editor.title')).toBeInTheDocument();
  });

  it('renders font family selector', () => {
    render(<EditorSection />);
    expect(screen.getByText('settings.editor.fontFamily')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders font size slider', () => {
    render(<EditorSection />);
    expect(screen.getByText('settings.editor.fontSize')).toBeInTheDocument();
  });

  it('renders line height slider', () => {
    render(<EditorSection />);
    expect(screen.getByText('settings.editor.lineHeight')).toBeInTheDocument();
  });

  it('renders indent first line toggle', () => {
    render(<EditorSection />);
    expect(screen.getByText('settings.editor.indentFirstLine')).toBeInTheDocument();
  });

  it('renders the preview text section', () => {
    render(<EditorSection />);
    expect(screen.getByText('settings.editor.previewTitle')).toBeInTheDocument();
    expect(screen.getByText('settings.editor.previewText1')).toBeInTheDocument();
  });

  it('calls handleSettingChange when font family is changed', async () => {
    const user = userEvent.setup();
    render(<EditorSection />);
    await user.selectOptions(screen.getByRole('combobox'), 'sans-serif');
    expect(mockHandleSettingChange).toHaveBeenCalledWith('editorFont', 'sans-serif');
  });

  it('does not show custom font fields when editorFont is not custom', () => {
    render(<EditorSection />);
    expect(screen.queryByText('settings.editor.customFont')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests — AdvancedEditorSection
// ---------------------------------------------------------------------------

describe('AdvancedEditorSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsRef.current = {};
  });

  // QNBS-v3: regression — pre-v1.8 settings had no advancedEditor; page must not crash.
  it('renders without crashing when advancedEditor is undefined', () => {
    settingsRef.current = { advancedEditor: undefined };
    expect(() => render(<AdvancedEditorSection />)).not.toThrow();
    expect(screen.getByText('settings.advancedEditor.title')).toBeInTheDocument();
  });

  it('renders the advanced editor title', () => {
    render(<AdvancedEditorSection />);
    expect(screen.getByText('settings.advancedEditor.title')).toBeInTheDocument();
  });

  it('renders auto-complete toggle', () => {
    render(<AdvancedEditorSection />);
    expect(screen.getByText('settings.advancedEditor.autoComplete')).toBeInTheDocument();
  });

  it('renders spell check toggle', () => {
    render(<AdvancedEditorSection />);
    expect(screen.getByText('settings.advancedEditor.spellCheck')).toBeInTheDocument();
  });

  it('renders word count toggle', () => {
    render(<AdvancedEditorSection />);
    expect(screen.getByText('settings.advancedEditor.wordCount')).toBeInTheDocument();
  });

  it('renders the focus modes section', () => {
    render(<AdvancedEditorSection />);
    expect(screen.getByText('settings.advancedEditor.focusModes')).toBeInTheDocument();
  });

  it('renders distraction-free mode toggle', () => {
    render(<AdvancedEditorSection />);
    expect(screen.getByText('settings.advancedEditor.distractionFree')).toBeInTheDocument();
  });

  it('renders typewriter mode toggle', () => {
    render(<AdvancedEditorSection />);
    expect(screen.getByText('settings.advancedEditor.typewriterMode')).toBeInTheDocument();
  });

  it('calls handleSettingChange when a toggle is clicked', async () => {
    const user = userEvent.setup();
    render(<AdvancedEditorSection />);
    await user.click(screen.getByRole('switch', { name: 'settings.advancedEditor.autoComplete' }));
    expect(mockHandleSettingChange).toHaveBeenCalledWith(
      'advancedEditor',
      expect.objectContaining({ autoComplete: false }),
    );
  });
});
