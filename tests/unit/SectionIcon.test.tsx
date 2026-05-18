import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SectionIcon } from '../../components/ui/SectionIcon';
import { APP_SECTIONS } from '../../constants/sections';

describe('SectionIcon', () => {
  it('renders without throwing for every section', () => {
    const sections = Object.keys(APP_SECTIONS) as Array<keyof typeof APP_SECTIONS>;
    for (const section of sections) {
      expect(() => render(<SectionIcon section={section} />)).not.toThrow();
    }
  });

  it('applies aria-hidden for decorative icon', () => {
    const { container } = render(<SectionIcon section="characters" />);
    const badge = container.querySelector('[aria-hidden="true"]');
    expect(badge).toBeTruthy();
  });

  it('applies size xs classes correctly', () => {
    const { container } = render(<SectionIcon section="outline" size="xs" />);
    const badge = container.querySelector('[aria-hidden="true"]');
    expect(badge?.className).toContain('rounded-lg');
  });

  it('applies size xl classes correctly', () => {
    const { container } = render(<SectionIcon section="world" size="xl" />);
    const badge = container.querySelector('[aria-hidden="true"]');
    expect(badge?.className).toContain('rounded-2xl');
  });

  it('uses colorClass from APP_SECTIONS for characters (blue)', () => {
    const { container } = render(<SectionIcon section="characters" />);
    const badge = container.querySelector('[aria-hidden="true"]');
    // colorClass includes blue-500
    expect(badge?.className).toContain('blue-500');
  });

  it('uses colorClass from APP_SECTIONS for worlds (purple)', () => {
    const { container } = render(<SectionIcon section="world" />);
    const badge = container.querySelector('[aria-hidden="true"]');
    expect(badge?.className).toContain('purple-500');
  });

  it('uses colorClass from APP_SECTIONS for outline (amber)', () => {
    const { container } = render(<SectionIcon section="outline" />);
    const badge = container.querySelector('[aria-hidden="true"]');
    expect(badge?.className).toContain('amber-500');
  });

  it('uses colorClass from APP_SECTIONS for manuscript (emerald)', () => {
    const { container } = render(<SectionIcon section="manuscript" />);
    const badge = container.querySelector('[aria-hidden="true"]');
    expect(badge?.className).toContain('emerald-500');
  });

  it('passes through custom className', () => {
    const { container } = render(<SectionIcon section="critic" className="my-custom-class" />);
    const badge = container.querySelector('[aria-hidden="true"]');
    expect(badge?.className).toContain('my-custom-class');
  });

  it('renders an SVG inside the badge', () => {
    const { container } = render(<SectionIcon section="writer" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('APP_SECTIONS covers all View values', () => {
    // Every section key must have a colorClass, textColor, icon and accentColor
    for (const [, config] of Object.entries(APP_SECTIONS)) {
      expect(config.colorClass).toBeTruthy();
      expect(config.textColor).toBeTruthy();
      expect(config.accentColor).toBeTruthy();
      expect(config.icon).toBeDefined();
    }
  });
});
