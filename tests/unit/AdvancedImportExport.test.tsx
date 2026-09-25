import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    rejected: {
      match: vi.fn(
        (action: { type?: string }) => action?.type === 'project/importProject/rejected',
      ),
    },
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../../services/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
  // QNBS-v3: routingLogger.ts (pulled in transitively via aiThunkUtils.ts's policy pre-check) calls createLogger() and sanitizeLogContext() at module scope, so this mock must cover both or the import throws.
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() }),
  sanitizeLogContext: (ctx: unknown) => ctx,
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

vi.mock('docx', () => ({
  // QNBS-v3: a plain function (not an arrow fn) is required so `new Document(...)` works — arrow functions can't be constructors.
  Document: vi.fn(function MockDocument() {}),
  Packer: {
    toBlob: vi.fn().mockResolvedValue(new Blob(['fake-docx-bytes'])),
  },
  Paragraph: vi.fn(),
  TextRun: vi.fn(),
  HeadingLevel: { TITLE: 0, HEADING_1: 1, HEADING_2: 2 },
}));

vi.mock('../../components/ui/Select', () => ({
  Select: (props: {
    id?: string;
    value: string;
    onChange: (v: string) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <select id={props.id} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
      {props.options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  ),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// QNBS-v3 (#553 a4): a rejected JSON import surfaces the thunk's own error message (or the fallback) as an import failure.
describe('AdvancedImportExport — rejected JSON import', () => {
  async function importRejected(error: { message?: string }) {
    const { useAppDispatch } = await import('../../app/hooks');
    const { useToast } = await import('../../components/ui/Toast');
    const { logger } = await import('../../services/logger');
    const toastError = vi.fn();
    vi.mocked(useToast).mockReturnValue({ success: vi.fn(), error: toastError } as never);
    vi.mocked(useAppDispatch).mockReturnValue(
      vi.fn(async () => ({ type: 'project/importProject/rejected', error })) as never,
    );
    let fileInput: HTMLInputElement | undefined;
    const create = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = create(tag);
      if (tag === 'input') {
        fileInput = element as HTMLInputElement;
        vi.spyOn(fileInput, 'click').mockImplementation(() => {});
      }
      return element;
    });
    const user = userEvent.setup();
    render(<AdvancedImportExport />);
    await user.click(screen.getByText('export.importProject'));
    await user.click(screen.getByText('export.import'));
    spy.mockRestore();
    const file = new File(['{}'], 'broken.json', { type: 'application/json' });
    Object.defineProperty(fileInput as HTMLInputElement, 'files', { value: [file] });
    await (fileInput as HTMLInputElement).onchange?.({ target: fileInput } as unknown as Event);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('export.importFailed'));
    return vi.mocked(logger.error).mock.calls.at(-1)?.[1] as Error;
  }

  it('reports the thunk’s error message', async () => {
    expect((await importRejected({ message: 'Invalid project file: FUTURE' })).message).toBe(
      'Invalid project file: FUTURE',
    );
  });

  it('falls back to a generic message when the rejection has none', async () => {
    expect((await importRejected({})).message).toBe('Import failed');
  });
});

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
    expect(screen.getByText('export.pasteSection.heading')).toBeTruthy();
  });

  it('shows copy as markdown button', () => {
    render(<AdvancedImportExport />);
    expect(screen.getByText('export.pasteSection.copyAsMarkdown')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // DOCX export (DA-05): selecting DOCX must produce a real docx payload —
  // it must never silently fall through to the Markdown branch.
  // -------------------------------------------------------------------------
  it('selecting DOCX and exporting calls Packer.toBlob and downloads a .docx file, not markdown', async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    // QNBS-v3: spy on the real URL statics — vi.stubGlobal-ing a plain object breaks `new URL(...)`, which Vite's dynamic import needs.
    const mockCreateObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    render(<AdvancedImportExport />);
    await user.click(screen.getByText('export.exportProject'));
    await user.selectOptions(screen.getByLabelText('export.exportFormat'), 'docx');
    await user.click(screen.getByText('export.export'));

    // QNBS-v3: onClick is async and userEvent.click doesn't await it — wait for its side effect instead.
    const { Packer } = await import('docx');
    await waitFor(() => expect(Packer.toBlob).toHaveBeenCalled());
    expect(mockCreateObjectURL).toHaveBeenCalled();
    const createdBlob = mockCreateObjectURL.mock.calls[0]?.[0] as Blob;
    expect(createdBlob.type).not.toBe('text/markdown');
  });

  it('does not call Packer.toBlob when exporting as markdown', async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const mockCreateObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    render(<AdvancedImportExport />);
    await user.click(screen.getByText('export.exportProject'));
    await user.selectOptions(screen.getByLabelText('export.exportFormat'), 'markdown');
    await user.click(screen.getByText('export.export'));

    await waitFor(() => expect(mockCreateObjectURL).toHaveBeenCalled());
    const { Packer } = await import('docx');
    expect(Packer.toBlob).not.toHaveBeenCalled();
  });
});
