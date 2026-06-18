import type { Meta, StoryObj } from '@storybook/react';
import { PageContainer } from '../components/ui/PageContainer';

/**
 * QNBS-v3: The desktop work-width cap lives in the `.is-desktop .view-shell` rule (index.css),
 * which only applies inside the Tauri WebView (body.is-desktop). In Storybook / the web the
 * shell is intentionally full-width — these stories document the wrapper contract, not a cap.
 */
const meta: Meta<typeof PageContainer> = {
  title: 'UI/PageContainer',
  component: PageContainer,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof PageContainer>;

const DemoContent = (
  <div className="rounded-sc-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] p-6">
    <h2 className="text-sc-xl font-bold text-[var(--sc-text-primary)]">Content-light view</h2>
    <p className="mt-2 text-sc-base text-[var(--sc-text-secondary)]">
      Wrapped views centre at the desktop work-width inside the Tauri WebView and stay full-width on
      the web. Editor, Plot Board, and Mind Map are never wrapped — they own their layout.
    </p>
  </div>
);

export const Default: Story = {
  args: { children: DemoContent },
};

export const WithExtraClassName: Story = {
  args: { children: DemoContent, className: 'px-8' },
};
