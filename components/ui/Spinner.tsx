import React from "react";

interface SpinnerProps {
  className?: string;
  label?: string;
}

export const Spinner: React.FC<SpinnerProps> = ({ className, label }) => (
  <div
    role="status"
    aria-label={label ?? "Loading…"}
    className={`relative flex items-center justify-center ${className || "w-5 h-5"}`}
  >
    <div
      className="absolute w-full h-full rounded-full border-2 border-[var(--border-primary)] opacity-30"
      aria-hidden="true"
    />
    <div
      className="absolute w-full h-full rounded-full border-t-2 border-[var(--background-interactive)] animate-spin"
      aria-hidden="true"
    />
    <div
      className="w-1/2 h-1/2 bg-[var(--background-interactive)] rounded-full animate-pulse opacity-50"
      aria-hidden="true"
    />
    <span className="sr-only">{label ?? "Loading…"}</span>
  </div>
);
