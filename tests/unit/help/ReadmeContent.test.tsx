/**
 * QNBS-v3: PR5 — tests the localized README help page. The README body is lazily fetched from
 * public/readme/<lang>.html (not an i18n bundle), with English fallback and a machine-translated notice
 * for non-Production locales.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUseTranslation } = vi.hoisted(() => ({
  mockUseTranslation: vi.fn(),
}));

vi.mock('../../../hooks/useTranslation', () => ({ useTranslation: mockUseTranslation }));
vi.mock('../../../app/hooks', () => ({ useAppSelector: () => 'light' }));
vi.mock('../../../services/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import { ReadmeContent } from '../../../components/help/ReadmeContent';

function setLocale(language: string) {
  mockUseTranslation.mockReturnValue({ language, t: (k: string) => k });
}

const okHtml = (body: string) =>
  Promise.resolve({ ok: true, text: () => Promise.resolve(body) } as Response);
const notOk = () => Promise.resolve({ ok: false, text: () => Promise.resolve('') } as Response);

describe('ReadmeContent', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and renders the active-locale README', async () => {
    setLocale('fr');
    const fetchMock = vi.fn((u: string) =>
      u.includes('/readme/fr.html') ? okHtml('<h1>Bonjour le monde</h1>') : notOk(),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<ReadmeContent />);
    await waitFor(() => expect(screen.getByText('Bonjour le monde')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/readme/fr.html'));
  });

  it('falls back to the English README when the active locale is missing', async () => {
    setLocale('ru');
    const fetchMock = vi.fn((u: string) =>
      u.includes('/readme/en.html') ? okHtml('<h1>Hello world</h1>') : notOk(),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<ReadmeContent />);
    await waitFor(() => expect(screen.getByText('Hello world')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/readme/en.html'));
    // QNBS-v3: fell back to the English README → the content IS English, so the machine-translated
    // notice must NOT show even though the requested locale (ru) is a Beta tier.
    expect(screen.queryByText('help.machineTranslatedNotice')).not.toBeInTheDocument();
  });

  it('shows the machine-translated notice for any non-English locale (incl. Production de/es)', async () => {
    // QNBS-v3: the README is MT'd for EVERY non-English locale — Production locales included — so the
    // notice shows for de (Production) just as for ru (Beta), unlike the help.json fallback rule.
    for (const code of ['ru', 'de'] as const) {
      setLocale(code);
      vi.stubGlobal(
        'fetch',
        vi.fn((u: string) => (u.includes('/readme/') ? okHtml('<p>x</p>') : notOk())),
      );
      const { unmount } = render(<ReadmeContent />);
      await waitFor(() =>
        expect(screen.getByText('help.machineTranslatedNotice')).toBeInTheDocument(),
      );
      unmount();
    }
  });

  it('does NOT show the machine-translated notice for English (the source)', async () => {
    setLocale('en');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => okHtml('<p>x</p>')),
    );
    render(<ReadmeContent />);
    await waitFor(() => expect(screen.getByText('help.readme.viewOnGithub')).toBeInTheDocument());
    expect(screen.queryByText('help.machineTranslatedNotice')).not.toBeInTheDocument();
  });

  it('shows the load error when every fetch fails', async () => {
    setLocale('de');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => notOk()),
    );
    render(<ReadmeContent />);
    await waitFor(() => expect(screen.getByText('help.readme.loadError')).toBeInTheDocument());
  });
});
