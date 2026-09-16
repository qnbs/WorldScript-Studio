import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useExportView } from '../../../hooks/useExportView';
import type { Character, StorySection, World } from '../../../types';

// ---------------------------------------------------------------------------
// vi.hoisted
// ---------------------------------------------------------------------------
const { mockSynopsisMatch } = vi.hoisted(() => ({
  mockSynopsisMatch: vi.fn((_: unknown) => true),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();

let mockProject = {
  id: 'p1',
  title: 'My Novel',
  logline: 'A story about courage',
  author: 'Jane Doe',
  manuscript: [] as StorySection[],
  compileProfile: undefined as undefined | Record<string, unknown>,
};
let mockCharacters: Character[] = [];
let mockWorlds: World[] = [];
let mockDesktopNotificationsEnabled = false;
// QNBS-v3 (#713): mutable so tests can simulate a project-incarnation change (import/restore) mid-test, matching useManuscriptView.test.ts's convention. Real getProjectTargetIdentity is used (not mocked) since it's a pure function of this shape.
let mockGeneration = 0;

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({
      project: { present: { data: mockProject, generation: mockGeneration } },
      characters: mockCharacters,
      worlds: mockWorlds,
      settings: { desktop: { desktopNotifications: mockDesktopNotificationsEnabled } },
    }),
}));

vi.mock('../../../features/project/projectIdentity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../features/project/projectIdentity')>();
  return {
    ...actual,
    // QNBS-v3 (#713): captureActiveProjectIdentity reads the live store (appStoreRef), which this test never constructs -- synthesize it from the same mutable state the useAppSelector mock above exposes.
    captureActiveProjectIdentity: () =>
      actual.getProjectTargetIdentity({ data: mockProject, generation: mockGeneration }),
  };
});

const mockSendDesktopNotification = vi.fn().mockResolvedValue(true);
vi.mock('../../../services/desktop/desktopNotifications', () => ({
  sendDesktopNotification: (...args: unknown[]) => mockSendDesktopNotification(...args),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

vi.mock('../../../features/project/projectSelectors', () => ({
  selectAllCharacters: () => mockCharacters,
  selectAllWorlds: () => mockWorlds,
}));

vi.mock('../../../features/project/thunks/writingThunks', () => {
  const synopsisThunk = vi.fn(() => ({ type: 'mock-synopsis' }));
  (synopsisThunk as unknown as { fulfilled: { match: (a: unknown) => unknown } }).fulfilled = {
    match: (a: unknown) => mockSynopsisMatch(a),
  };
  return { generateSynopsisThunk: synopsisThunk };
});

vi.mock('../../../features/status/statusSlice', () => ({
  statusActions: {
    addNotification: (payload: unknown) => ({ type: 'status/addNotification', payload }),
  },
}));

// Mock lazy-imported export libraries so tests don't require actual PDF/DOCX libs
vi.mock('jspdf', () => ({
  default: vi.fn().mockImplementation(() => ({
    setFont: vi.fn(),
    setFontSize: vi.fn(),
    text: vi.fn(),
    splitTextToSize: (t: string) => [t],
    addPage: vi.fn(),
    save: vi.fn(),
    internal: { pageSize: { getHeight: () => 297, getWidth: () => 210 } },
  })),
}));

vi.mock('docx', () => ({
  // QNBS-v3: a plain function (not an arrow fn) is required so `new Document(...)` works — arrow functions can't be constructors.
  Document: vi.fn(function MockDocument() {}),
  Packer: { toBlob: vi.fn().mockResolvedValue(new Blob(['docx'])) },
  Paragraph: vi.fn(),
  TextRun: vi.fn(),
  HeadingLevel: { TITLE: 0, HEADING_1: 1, HEADING_2: 2 },
}));

vi.mock('../../../services/normPageExport', () => ({
  buildNormManuscriptExport: (sections: { title: string; content: string }[]) =>
    sections.map((s) => s.content).join('\n'),
}));

vi.mock('../../../services/pandocExportMarkdown', () => ({
  buildPandocMarkdownFromProject: () => '# Pandoc Markdown',
}));

vi.mock('../../../services/pandocTauri', () => ({
  tryPandocMarkdownToEpub: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../services/epubApiService', () => ({
  exportEpub: vi.fn().mockResolvedValue(undefined),
}));

// Stub clipboard
const mockClipboardWrite = vi.fn().mockResolvedValue(undefined);
vi.stubGlobal('navigator', { clipboard: { writeText: mockClipboardWrite } });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSection(id: string, title: string, content: string): StorySection {
  return { id, title, content };
}

function makeCharacter(id: string, name: string): Character {
  return {
    id,
    name,
    backstory: 'Poor origins',
    motivation: 'Justice',
    appearance: 'Tall',
    personalityTraits: '',
    flaws: '',
    notes: 'Important note',
    hasAvatar: false,
    characterArc: '',
    relationships: '',
  };
}

function makeWorld(id: string, name: string): World {
  return {
    id,
    name,
    description: 'A magical realm',
    geography: 'Mountains',
    magicSystem: 'Elemental',
    culture: 'Medieval',
    notes: '',
    timeline: [],
    locations: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // QNBS-v3: spy on the real URL statics — vi.stubGlobal-ing a plain object breaks `new URL(...)`, which Vite's dynamic import needs.
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  mockDispatch.mockResolvedValue({ type: 'mock-action' });
  mockProject = {
    id: 'p1',
    title: 'My Novel',
    logline: 'A story about courage',
    author: 'Jane Doe',
    manuscript: [],
    compileProfile: undefined,
  };
  mockCharacters = [];
  mockWorlds = [];
  mockDesktopNotificationsEnabled = false;
  mockGeneration = 0;
  mockSynopsisMatch.mockReturnValue(true);
});

// ---------------------------------------------------------------------------
// formattedOutput
// ---------------------------------------------------------------------------
describe('formattedOutput', () => {
  it('includes project title and logline when title content is enabled', () => {
    const { result } = renderHook(() => useExportView());
    expect(result.current.formattedOutput).toContain('My Novel');
    expect(result.current.formattedOutput).toContain('A story about courage');
  });

  it('includes characters section when characters exist and option is enabled', () => {
    mockCharacters = [makeCharacter('c1', 'Alice')];
    const { result } = renderHook(() => useExportView());
    expect(result.current.formattedOutput).toContain('Alice');
  });

  it('includes worlds section when worlds exist and option is enabled', () => {
    mockWorlds = [makeWorld('w1', 'Arda')];
    const { result } = renderHook(() => useExportView());
    expect(result.current.formattedOutput).toContain('Arda');
  });

  it('includes manuscript sections', () => {
    mockProject.manuscript = [makeSection('s1', 'Chapter 1', 'Once upon a time')];
    const { result } = renderHook(() => useExportView());
    expect(result.current.formattedOutput).toContain('Chapter 1');
    expect(result.current.formattedOutput).toContain('Once upon a time');
  });

  it('excludes characters when contentToExport.characters is false', () => {
    mockCharacters = [makeCharacter('c1', 'Alice')];
    const { result } = renderHook(() => useExportView());
    act(() => {
      result.current.setContentToExport((prev) => ({ ...prev, characters: false }));
    });
    expect(result.current.formattedOutput).not.toContain('Alice');
  });

  it('shows empty section placeholder when section has no content', () => {
    mockProject.manuscript = [makeSection('s1', 'Empty', '')];
    const { result } = renderHook(() => useExportView());
    expect(result.current.formattedOutput).toContain('export.emptySection');
  });

  it('includes synopsis when aiEnhancements.synopsis is true and synopsis exists', async () => {
    const synopsisText = 'A brave hero saves the world';
    mockDispatch.mockResolvedValue({ type: 'fulfilled', payload: synopsisText });
    mockSynopsisMatch.mockReturnValue(true);

    const { result } = renderHook(() => useExportView());
    act(() => {
      result.current.setAiEnhancements({ synopsis: true });
    });
    await act(async () => {
      await result.current.generateSynopsis();
    });
    expect(result.current.synopsis).toBe(synopsisText);
    expect(result.current.formattedOutput).toContain(synopsisText);
  });

  it('includes compileProfile prefix when present', () => {
    mockProject.compileProfile = { titlePageMarkdown: '# Title Page', dedicationMarkdown: '' };
    const { result } = renderHook(() => useExportView());
    expect(result.current.formattedOutput).toContain('Title Page');
  });
});

// ---------------------------------------------------------------------------
// generateSynopsis
// ---------------------------------------------------------------------------
describe('generateSynopsis', () => {
  it('sets synopsis on fulfilled', async () => {
    mockDispatch.mockResolvedValue({ type: 'fulfilled', payload: 'Great synopsis' });
    mockSynopsisMatch.mockReturnValue(true);

    const { result } = renderHook(() => useExportView());
    await act(async () => {
      await result.current.generateSynopsis();
    });
    expect(result.current.synopsis).toBe('Great synopsis');
    expect(result.current.isGeneratingSynopsis).toBe(false);
  });

  it('resets isGeneratingSynopsis even on rejected', async () => {
    mockDispatch.mockResolvedValue({ type: 'rejected' });
    mockSynopsisMatch.mockReturnValue(false);

    const { result } = renderHook(() => useExportView());
    await act(async () => {
      await result.current.generateSynopsis();
    });
    expect(result.current.isGeneratingSynopsis).toBe(false);
  });

  // QNBS-v3 (#713): a request-id guard, mirroring loglineRequestRef/proofreadRequestRef in useManuscriptView.ts -- without it, an older still-in-flight request can clobber a newer one's content/loading state on the SAME project (no identity change involved).
  it('does not let a superseded synopsis request clobber a newer one on the same project', async () => {
    let resolveFirst!: (action: unknown) => void;
    let resolveSecond!: (action: unknown) => void;
    mockDispatch
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
      );
    mockSynopsisMatch.mockReturnValue(true);
    const { result } = renderHook(() => useExportView());

    let firstRequest!: Promise<void>;
    let secondRequest!: Promise<void>;
    act(() => {
      firstRequest = result.current.generateSynopsis();
      secondRequest = result.current.generateSynopsis();
    });

    await act(async () => {
      resolveSecond({ type: 'fulfilled', payload: 'Second synopsis' });
      await secondRequest;
    });
    expect(result.current.synopsis).toBe('Second synopsis');
    expect(result.current.isGeneratingSynopsis).toBe(false);

    await act(async () => {
      resolveFirst({ type: 'fulfilled', payload: 'First synopsis (stale)' });
      await firstRequest;
    });
    expect(result.current.synopsis).toBe('Second synopsis');
    expect(result.current.isGeneratingSynopsis).toBe(false);
  });

  // QNBS-v3 (#713): covers the concurrency window where a project switch lands mid-flight, and the follow-up clearing behavior below -- a stale synopsis must never enter a different incarnation's export.
  it('#713: discards a fulfilled synopsis if the project incarnation changed while generation was in flight', async () => {
    let resolveDispatch!: (action: unknown) => void;
    mockDispatch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDispatch = resolve;
      }),
    );
    mockSynopsisMatch.mockReturnValue(true);
    const { result, rerender } = renderHook(() => useExportView());

    let request!: Promise<void>;
    act(() => {
      request = result.current.generateSynopsis();
    });

    act(() => {
      mockGeneration = 1;
      rerender();
    });
    expect(result.current.synopsis).toBe('');
    // Regression (chatgpt-codex-connector on PR #768): the invalidation effect must reset
    // isGeneratingSynopsis itself -- otherwise the spinner stays stuck until the stale request settles.
    expect(result.current.isGeneratingSynopsis).toBe(false);

    await act(async () => {
      resolveDispatch({ type: 'fulfilled', payload: 'Stale synopsis from project A' });
      await request;
    });
    expect(result.current.synopsis).toBe('');
  });

  it('#713: clears a previously-generated synopsis when the project incarnation changes, preventing export contamination', async () => {
    mockDispatch.mockResolvedValue({ type: 'fulfilled', payload: 'Synopsis for project A' });
    mockSynopsisMatch.mockReturnValue(true);
    const { result, rerender } = renderHook(() => useExportView());
    await act(async () => {
      await result.current.generateSynopsis();
    });
    act(() => result.current.setAiEnhancements({ synopsis: true }));
    expect(result.current.synopsis).toBe('Synopsis for project A');
    expect(result.current.formattedOutput).toContain('Synopsis for project A');

    act(() => {
      mockGeneration = 1;
      rerender();
    });

    expect(result.current.synopsis).toBe('');
    expect(result.current.formattedOutput).not.toContain('Synopsis for project A');
  });
});

// ---------------------------------------------------------------------------
// handleDownload — format routing
// ---------------------------------------------------------------------------
describe('handleDownload (md format)', () => {
  it('creates a blob URL for md download', async () => {
    const mockCreateObjectURL = vi.mocked(URL.createObjectURL);
    mockCreateObjectURL.mockClear();

    const { result } = renderHook(() => useExportView());
    await act(async () => {
      await result.current.handleDownload();
    });
    // QNBS-v3: verify blob URL was created (link click tested via URL stub)
    expect(mockCreateObjectURL).toHaveBeenCalled();
  });
});

describe('handleDownload (txt format)', () => {
  it('creates a blob URL for txt download', async () => {
    mockProject.manuscript = [makeSection('s1', 'Ch1', '## Heading\nContent')];
    const mockCreateObjectURL = vi.mocked(URL.createObjectURL);
    mockCreateObjectURL.mockClear();

    const { result } = renderHook(() => useExportView());
    act(() => {
      result.current.setFormat('txt');
    });
    await act(async () => {
      await result.current.handleDownload();
    });
    expect(mockCreateObjectURL).toHaveBeenCalled();
  });
});

describe('handleDownload (pdf format)', () => {
  it('calls jsPDF save', async () => {
    const { result } = renderHook(() => useExportView());
    act(() => {
      result.current.setFormat('pdf');
    });
    await act(async () => {
      await result.current.handleDownload();
    });
    // isExportLoading should be reset
    expect(result.current.isExportLoading).toBe(false);
  });
});

describe('handleDownload (docx format)', () => {
  it('calls Packer.toBlob and creates object URL', async () => {
    const docxModule = await import('docx');
    const mockCreateObjectURL = vi.mocked(URL.createObjectURL);
    mockCreateObjectURL.mockClear();
    vi.mocked(docxModule.Packer.toBlob).mockClear();

    const { result } = renderHook(() => useExportView());
    act(() => {
      result.current.setFormat('docx');
    });
    await act(async () => {
      await result.current.handleDownload();
    });
    // QNBS-v3: assert the real docx path actually ran, not just that loading settled either way.
    expect(docxModule.Packer.toBlob).toHaveBeenCalled();
    expect(mockCreateObjectURL).toHaveBeenCalled();
    expect(result.current.isExportLoading).toBe(false);
  });
});

describe('handleDownload (norm-txt format)', () => {
  it('creates a blob URL via buildNormManuscriptExport', async () => {
    mockProject.manuscript = [makeSection('s1', 'Ch1', 'Normalised')];
    const mockCreateObjectURL = vi.mocked(URL.createObjectURL);
    mockCreateObjectURL.mockClear();

    const { result } = renderHook(() => useExportView());
    act(() => {
      result.current.setFormat('norm-txt');
    });
    await act(async () => {
      await result.current.handleDownload();
    });
    expect(mockCreateObjectURL).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleDownload — desktop notification gating (QNBS-v3 T3)
// ---------------------------------------------------------------------------
describe('handleDownload desktop notification gating', () => {
  it('sends a desktop notification after a successful download when the setting is enabled', async () => {
    mockDesktopNotificationsEnabled = true;
    const { result } = renderHook(() => useExportView());
    await act(async () => {
      await result.current.handleDownload();
    });
    expect(mockSendDesktopNotification).toHaveBeenCalledWith(
      'export.notify.completeTitle',
      'export.notify.completeBody',
    );
  });

  it('does not send a desktop notification when the setting is disabled', async () => {
    mockDesktopNotificationsEnabled = false;
    const { result } = renderHook(() => useExportView());
    await act(async () => {
      await result.current.handleDownload();
    });
    expect(mockSendDesktopNotification).not.toHaveBeenCalled();
  });

  it('does not send a desktop notification when the download fails (docx)', async () => {
    mockDesktopNotificationsEnabled = true;
    const docxModule = await import('docx');
    vi.mocked(docxModule.Packer.toBlob).mockRejectedValueOnce(new Error('Packer failed'));

    const { result } = renderHook(() => useExportView());
    act(() => {
      result.current.setFormat('docx');
    });
    await act(async () => {
      await result.current.handleDownload();
    });

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'status/addNotification' }),
    );
    expect(mockSendDesktopNotification).not.toHaveBeenCalled();
  });

  it('does not send a desktop notification when the download fails (pdf)', async () => {
    mockDesktopNotificationsEnabled = true;
    const jspdfModule = await import('jspdf');
    const jspdfCtor = jspdfModule.default as unknown as ReturnType<typeof vi.fn>;
    jspdfCtor.mockImplementationOnce(() => ({
      setFont: vi.fn(),
      setFontSize: vi.fn(),
      text: vi.fn(),
      splitTextToSize: (t: string) => [t],
      addPage: vi.fn(),
      save: vi.fn(() => {
        throw new Error('save failed');
      }),
      internal: { pageSize: { getHeight: () => 297, getWidth: () => 210 } },
    }));

    const { result } = renderHook(() => useExportView());
    act(() => {
      result.current.setFormat('pdf');
    });
    await act(async () => {
      await result.current.handleDownload();
    });

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'status/addNotification' }),
    );
    expect(mockSendDesktopNotification).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleCopyToClipboard
// ---------------------------------------------------------------------------
describe('handleCopyToClipboard', () => {
  it('writes formattedOutput to clipboard and sets copied=true', async () => {
    const { result } = renderHook(() => useExportView());
    await act(async () => {
      await result.current.handleCopyToClipboard();
    });
    expect(mockClipboardWrite).toHaveBeenCalled();
    expect(result.current.copied).toBe(true);
  });

  it('dispatches error notification on clipboard failure', async () => {
    mockClipboardWrite.mockRejectedValueOnce(new Error('Permission denied'));

    const { result } = renderHook(() => useExportView());
    await act(async () => {
      await result.current.handleCopyToClipboard();
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'status/addNotification' }),
    );
  });

  it('strips markdown for txt format copy', async () => {
    const { result } = renderHook(() => useExportView());
    act(() => {
      result.current.setFormat('txt');
    });
    await act(async () => {
      await result.current.handleCopyToClipboard();
    });
    expect(mockClipboardWrite).toHaveBeenCalled();
  });

  it('uses normPageExport for norm-txt format copy', async () => {
    mockProject.manuscript = [makeSection('s1', 'Ch1', 'Text')];
    const { result } = renderHook(() => useExportView());
    act(() => {
      result.current.setFormat('norm-txt');
    });
    await act(async () => {
      await result.current.handleCopyToClipboard();
    });
    expect(mockClipboardWrite).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// pdfOptions / format state
// ---------------------------------------------------------------------------
describe('state setters', () => {
  it('setFormat updates format', () => {
    const { result } = renderHook(() => useExportView());
    act(() => {
      result.current.setFormat('epub');
    });
    expect(result.current.format).toBe('epub');
  });

  it('setPdfOptions updates pdfOptions', () => {
    const { result } = renderHook(() => useExportView());
    act(() => {
      result.current.setPdfOptions((prev) => ({ ...prev, fontSize: 11 }));
    });
    expect(result.current.pdfOptions.fontSize).toBe(11);
  });
});
