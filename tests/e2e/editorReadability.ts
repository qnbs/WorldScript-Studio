import type { Locator } from '@playwright/test';

export type RenderedTextReadability = {
  foreground: string;
  background: string;
  ratio: number;
} | null;

// QNBS-v3 (#332/#341): measure effective colors so opaque unreadable text cannot pass the oracle.
export const readRenderedTextReadability = async (
  locator: Locator,
): Promise<RenderedTextReadability> =>
  locator.evaluate((element) => {
    type Color = { r: number; g: number; b: number; a: number };
    const parseColor = (value: string): Color | null => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const rawChannels = match[1];
      if (!rawChannels) return null;
      const channels = rawChannels
        .replace('/', ' / ')
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((part) => Number.parseFloat(part));
      const [red, green, blue, alphaValue = 1] = channels;
      if (
        red === undefined ||
        green === undefined ||
        blue === undefined ||
        channels.some((channel) => !Number.isFinite(channel))
      ) {
        return null;
      }
      return { r: red, g: green, b: blue, a: alphaValue <= 1 ? alphaValue : alphaValue / 255 };
    };
    const composite = (foreground: Color, background: Color): Color => {
      const alpha = foreground.a + background.a * (1 - foreground.a);
      if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
        g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
        b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
        a: alpha,
      };
    };
    const backgrounds: Color[] = [];
    let ancestor: Element | null = element;
    while (ancestor) {
      const color = parseColor(getComputedStyle(ancestor).backgroundColor);
      if (color && color.a > 0) backgrounds.push(color);
      ancestor = ancestor.parentElement;
    }
    let effectiveBackground: Color = { r: 0, g: 0, b: 0, a: 0 };
    for (const background of backgrounds.reverse()) {
      effectiveBackground = composite(background, effectiveBackground);
    }
    if (effectiveBackground.a === 0) return null;
    const foreground = parseColor(getComputedStyle(element).color);
    if (!foreground) return null;
    let effectiveOpacity = 1;
    let opacityElement: Element | null = element;
    while (opacityElement) {
      const opacity = Number.parseFloat(getComputedStyle(opacityElement).opacity);
      if (Number.isFinite(opacity)) effectiveOpacity *= opacity;
      opacityElement = opacityElement.parentElement;
    }
    // QNBS-v3 (#332): include ancestor opacity so transitional mirrors cannot pass on pre-blended colors.
    const effectiveForeground = composite(
      { ...foreground, a: foreground.a * effectiveOpacity },
      effectiveBackground,
    );
    const channel = (value: number) => {
      const normalized = value / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (color: Color) =>
      0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    const foregroundLuminance = luminance(effectiveForeground);
    const backgroundLuminance = luminance(effectiveBackground);
    return {
      foreground: getComputedStyle(element).color,
      background: `rgb(${effectiveBackground.r}, ${effectiveBackground.g}, ${effectiveBackground.b})`,
      ratio:
        (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05),
    };
  });