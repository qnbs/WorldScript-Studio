import { useEffect, useState } from 'react';

export type FoldAxis = 'horizontal' | 'vertical' | null;

export interface FoldableLayout {
  isFolded: boolean;
  foldAxis: FoldAxis;
  foldPosition: number | null;
}

const NO_FOLD: FoldableLayout = { isFolded: false, foldAxis: null, foldPosition: null };

function readFoldState(): FoldableLayout {
  if (typeof window === 'undefined') return NO_FOLD;
  try {
    // CSS env variables for foldable screens (W3C Device Posture API draft)
    const el = document.createElement('div');
    el.style.setProperty('display', 'none');
    el.style.setProperty('height', 'env(fold-top, 0px)');
    document.body.appendChild(el);
    const foldTop = Number.parseFloat(getComputedStyle(el).height ?? '0');
    el.style.setProperty('height', 'env(fold-left, 0px)');
    const foldLeft = Number.parseFloat(getComputedStyle(el).height ?? '0');
    document.body.removeChild(el);

    if (foldTop > 0) {
      return { isFolded: true, foldAxis: 'horizontal', foldPosition: foldTop };
    }
    if (foldLeft > 0) {
      return { isFolded: true, foldAxis: 'vertical', foldPosition: foldLeft };
    }
  } catch {
    // env() variables unsupported — treat as no fold
  }
  return NO_FOLD;
}

/** Detects foldable device posture via CSS env variables (W3C Device Posture API draft). */
export function useFoldableLayout(): FoldableLayout {
  const [layout, setLayout] = useState<FoldableLayout>(NO_FOLD);

  useEffect(() => {
    setLayout(readFoldState());

    const mq = window.matchMedia('(fold-top) or (fold-left)');
    const update = () => setLayout(readFoldState());
    mq.addEventListener('change', update);
    window.addEventListener('resize', update);
    return () => {
      mq.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return layout;
}
