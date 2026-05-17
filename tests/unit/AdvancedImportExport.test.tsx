import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdvancedImportExport } from '../../components/AdvancedImportExport';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => vi.fn()),
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      project: {
        present: {
          data: {
            id: 'p1',
            title: 'My Story',
            logline: '',
            manuscript: [{ id: 's1', title: 'Ch 1', content: 'Hello' }],
            characters: { ids: [], entities: {} },
            worlds: { ids: [], entities: {} },
          },
        },
      },
    }),
  ),
}));

vi.mock('../../features/project/projectSelectors', () => ({
  selectProjectData: vi.fn(
    (s: { project: { present: { data: unknown } } }) => s.project.present.data,
  ),
}));

vi.mock('../../features/project/thunks/projectManagementThunks', () => ({
  importProjectThunk: Object.assign(vi.fn(), {
    fulfilled: { match: vi.fn(() => true) },
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../../services/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../services/storageService', () => ({
  storageService: {
    getProject: vi.fn().mockResolvedValue(null),
    saveProject: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../ui/Toast', () => ({
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn() })),
}));

vi.mock('../../components/ui/Toast', () => ({
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn() })),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdvancedImportExport', () => {
  it('renders without throwing', () => {
    expect(() => render(<AdvancedImportExport />)).not.toThrow();
  });

  it('shows import button', () => {
    render(<AdvancedImportExport />);
    expect(screen.getByText('export.importProject')).toBeTruthy();
  });

  it('shows export button', () => {
    render(<AdvancedImportExport />);
    expect(screen.getByText('export.exportProject')).toBeTruthy();
  });

  it('shows Google Docs / Notion section heading', () => {
    render(<AdvancedImportExport />);
    expect(screen.getByText('Google Docs / Notion')).toBeTruthy();
  });

  it('shows copy as markdown button', () => {
    render(<AdvancedImportExport />);
    expect(screen.getByText('export.pasteSection.copyAsMarkdown')).toBeTruthy();
  });
});
