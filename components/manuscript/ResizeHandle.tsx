import type { FC } from 'react';
import React from 'react';

export interface ResizerProps {
  onPointerDown: (e: React.PointerEvent) => void;
  onKeyAdjust: (delta: number) => void;
  label: string;
  value: number;
}

export const Resizer: FC<ResizerProps> = React.memo(
  ({ onPointerDown, onKeyAdjust, label, value }) => {
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onKeyAdjust(-2);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        onKeyAdjust(2);
      }
    };
    return (
      // QNBS-v3: w-8 (32px) expands the interactive hit zone for WCAG 2.5.5 touch target compliance;
      //          the visual pill stays w-0.5 inside. aria-valuenow reflects actual panel %.
      // biome-ignore lint/a11y/useSemanticElements: interactive separator with aria-valuenow/min/max acts as a slider widget; <hr> has no support for these ARIA props or keyboard/pointer handlers.
      <div
        role="separator"
        aria-label={label}
        aria-orientation="vertical"
        aria-valuenow={Math.round(value)}
        aria-valuemin={15}
        aria-valuemax={50}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={handleKeyDown}
        style={{ touchAction: 'none' }}
        className="w-8 h-full cursor-col-resize flex items-center justify-center group z-10 transition-colors duration-sc-fast ease-sc-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
      >
        <div
          className="w-0.5 h-8 bg-[var(--sc-border-subtle)] group-hover:bg-[var(--sc-accent)] group-hover:h-full transition-all duration-300 rounded-full"
          aria-hidden="true"
        />
      </div>
    );
  },
);
Resizer.displayName = 'Resizer';
