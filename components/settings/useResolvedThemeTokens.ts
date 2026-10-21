import { useEffect, useState } from 'react';

function channelHex(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, '0');
}

/**
 * Serializes a computed CSS color as #rrggbb. Browsers report color-mix() results as
 * `color(srgb r g b)` and may use the space-separated `rgb(r g b / a)` form; anything else
 * (e.g. oklch) yields '' and the color input shows its own default.
 */
export function cssColorToHex(value: string): string {
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{6})$/.exec(v)?.[1];
  if (hex) return `#${hex}`;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short)
    return `#${short
      .slice(1, 4)
      .map((c) => c + c)
      .join('')}`;
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(v);
  if (rgb)
    return `#${rgb
      .slice(1, 4)
      .map((c) => channelHex(Number(c)))
      .join('')}`;
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(v);
  if (srgb)
    return `#${srgb
      .slice(1, 4)
      .map((c) => channelHex(Number(c) * 255))
      .join('')}`;
  return '';
}

/** Current value of a theme token as #rrggbb; var()/color-mix() resolve through a probe element. */
export function readTokenHex(token: string): string {
  const direct = cssColorToHex(getComputedStyle(document.body).getPropertyValue(token));
  if (direct) return direct;
  const probe = document.createElement('span');
  probe.style.color = `var(${token})`;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return cssColorToHex(resolved);
}

function readAll(tokens: readonly string[]): Record<string, string> {
  return Object.fromEntries(tokens.map((token) => [token, readTokenHex(token)]));
}

/**
 * Theme token colors as the user currently sees them (#818). The app applies theme classes and
 * customization in its own effects, which run after this component's render (and after its
 * effects, since the app is an ancestor), so the values are re-read one frame after `version`
 * changes.
 */
export function useResolvedThemeTokens(
  tokens: readonly string[],
  version: string,
): Record<string, string> {
  const [resolved, setResolved] = useState(() => ({ version, values: readAll(tokens) }));
  useEffect(() => {
    const frame = requestAnimationFrame(() => setResolved({ version, values: readAll(tokens) }));
    return () => cancelAnimationFrame(frame);
  }, [tokens, version]);
  return resolved.values;
}
