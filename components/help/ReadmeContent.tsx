import { type FC, useEffect, useState } from 'react';
import { useAppSelector } from '../../app/hooks';
import { useTranslation } from '../../hooks/useTranslation';
import { getLocaleInfo, type Language } from '../../i18n/locales';
import { logger } from '../../services/logger';
import { SanitizedHtml } from '../ui/SanitizedHtml';

const GITHUB_README = 'https://github.com/qnbs/WorldScript-Studio#readme';

// QNBS-v3: PR5 — renders the localized project README. The body is a static, lazily-fetched
// public/readme/<lang>.html (built by scripts/build-readme-locales.mjs), NOT an i18n bundle key — so
// the ~30 KB of README prose per locale never touches the app's initial load. Falls back to English.
export const ReadmeContent: FC = () => {
  const { t, language } = useTranslation();
  const theme = useAppSelector((state) => state.settings.theme);
  const [html, setHtml] = useState<string | null>(null);
  const [loadedLang, setLoadedLang] = useState<Language | null>(null);
  const [failed, setFailed] = useState(false);
  // QNBS-v3: the notice must reflect the LOADED file, not the requested locale — if a non-Production
  // locale is missing and we fall back to en.html, the shown content is the original English README,
  // so no "machine-translated" notice should appear (CodeAnt).
  const showFallbackNotice = loadedLang
    ? (getLocaleInfo(loadedLang)?.helpFallback ?? false)
    : false;

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setLoadedLang(null);
    setFailed(false);
    const base = import.meta.env.BASE_URL || '/';
    const load = async () => {
      // QNBS-v3: try the active locale, then English. Annotated so `lang` stays `Language` (the array
      // literal would otherwise widen 'en' to `string`).
      const candidates: Language[] = [language, 'en'];
      for (const lang of candidates) {
        try {
          const res = await fetch(`${base}readme/${lang}.html`);
          if (!res.ok) continue;
          const text = await res.text();
          if (!cancelled) {
            setHtml(text);
            setLoadedLang(lang);
          }
          return;
        } catch (err) {
          logger.warn('README fetch failed', { lang, err: String(err) });
        }
      }
      if (!cancelled) setFailed(true);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [language]);

  return (
    <div>
      {showFallbackNotice ? (
        <p
          role="note"
          className="mb-4 rounded-sc-md border border-[var(--sc-info-fg)]/30 bg-[var(--sc-info-bg)] px-3 py-2 text-sm text-[var(--sc-info-fg)]"
        >
          {t('help.machineTranslatedNotice')}
        </p>
      ) : null}
      <p className="mb-4 text-sm">
        <a
          href={GITHUB_README}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--sc-accent)] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
        >
          {t('help.readme.viewOnGithub')}
        </a>
      </p>
      {failed ? (
        <p className="text-[var(--sc-text-muted)]">{t('help.readme.loadError')}</p>
      ) : html === null ? (
        <p className="text-[var(--sc-text-muted)]">{t('common.loading')}</p>
      ) : (
        <SanitizedHtml
          dir="auto"
          className={`prose max-w-[var(--sc-prose-measure)] prose-h2:text-2xl prose-h2:font-bold prose-h3:font-semibold prose-p:text-[var(--sc-text-secondary)] prose-strong:text-[var(--sc-text-primary)] prose-a:text-[var(--sc-accent)] prose-ul:list-disc prose-li:text-[var(--sc-text-secondary)] prose-ol:text-[var(--sc-text-secondary)] ${theme === 'dark' ? 'prose-invert' : ''}`}
          html={html}
        />
      )}
    </div>
  );
};
