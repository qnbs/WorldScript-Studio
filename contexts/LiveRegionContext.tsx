import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useAppSelector } from '../app/hooks';

export type AnnouncePriority = 'polite' | 'assertive';

export interface AnnounceOptions {
  /** When live region verbosity is minimal, skip this announcement (navigation titles never use this). */
  skipIfMinimal?: boolean;
}

interface LiveRegionContextValue {
  announce: (message: string, priority?: AnnouncePriority, options?: AnnounceOptions) => void;
}

const LiveRegionContext = createContext<LiveRegionContextValue | undefined>(undefined);

// QNBS-v3: Zentrale aria-live-Regionen statt dynamisch erzeugter Nodes — stabil für Screenreader.
export function LiveRegionProvider({ children }: { children: ReactNode }) {
  const liveRegionVerbosity = useAppSelector((s) => s.settings.accessibility.liveRegionVerbosity);
  const [politeMessage, setPoliteMessage] = useState('');
  const [assertiveMessage, setAssertiveMessage] = useState('');
  const politeSeq = useRef(0);
  const assertiveSeq = useRef(0);

  const flushPolite = useCallback((message: string) => {
    politeSeq.current += 1;
    const seq = politeSeq.current;
    setPoliteMessage('');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (seq === politeSeq.current) {
          setPoliteMessage(message);
        }
      });
    });
  }, []);

  const flushAssertive = useCallback((message: string) => {
    assertiveSeq.current += 1;
    const seq = assertiveSeq.current;
    setAssertiveMessage('');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (seq === assertiveSeq.current) {
          setAssertiveMessage(message);
        }
      });
    });
  }, []);

  const announce = useCallback(
    (message: string, priority: AnnouncePriority = 'polite', options?: AnnounceOptions) => {
      if (!message.trim()) return;
      if (liveRegionVerbosity === 'minimal' && options?.skipIfMinimal) {
        return;
      }
      if (priority === 'assertive') {
        flushAssertive(message);
      } else {
        flushPolite(message);
      }
    },
    [flushAssertive, flushPolite, liveRegionVerbosity],
  );

  const value = useMemo(() => ({ announce }), [announce]);

  return (
    <LiveRegionContext.Provider value={value}>
      {children}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {politeMessage}
      </div>
      <div aria-live="assertive" aria-atomic="true" className="sr-only">
        {assertiveMessage}
      </div>
    </LiveRegionContext.Provider>
  );
}

export function useAnnounce(): LiveRegionContextValue['announce'] {
  const ctx = useContext(LiveRegionContext);
  if (!ctx) {
    throw new Error('useAnnounce must be used within LiveRegionProvider');
  }
  return ctx.announce;
}
