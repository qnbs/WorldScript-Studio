import DOMPurify from 'dompurify';
import { type FC, useEffect, useRef } from 'react';

interface SanitizedHtmlProps {
  /** Raw HTML string — sanitized with DOMPurify before injection. */
  html: string;
  className?: string;
  /** Text direction; `auto` lets the browser infer per the content (useful for the localized README). */
  dir?: 'ltr' | 'rtl' | 'auto';
}

/**
 * QNBS-v3: PR5 — the single, audited place for rendering trusted-but-dynamic HTML (help articles, the
 * localized README page). Mirrors the project pattern in CopilotMessageList: the sanitized HTML is set
 * imperatively via a ref (`innerHTML`) rather than `dangerouslySetInnerHTML`, so there is exactly one
 * DOMPurify call site and no scattered lint suppressions. DOMPurify strips scripts/handlers/iframes.
 */
export const SanitizedHtml: FC<SanitizedHtmlProps> = ({ html, className, dir }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = DOMPurify.sanitize(html);
  }, [html]);
  return <div ref={ref} className={className} {...(dir ? { dir } : {})} />;
};
