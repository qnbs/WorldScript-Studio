import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockIsDesktop, mockSetOpen } = vi.hoisted(() => ({
  mockIsDesktop: { value: false },
  mockSetOpen: vi.fn(),
}));

vi.mock('../../../app/transientUiStore', () => ({
  useTransientUiStore: (selector: (state: { setIdbUnlockOpen: typeof mockSetOpen }) => unknown) =>
    selector({ setIdbUnlockOpen: mockSetOpen }),
}));

vi.mock('../../../services/desktopPlatform', () => ({
  desktopPlatform: {
    runtime: {
      get isDesktop() {
        return mockIsDesktop.value;
      },
    },
  },
}));

vi.mock('../../../services/storage/storageEncryptionService', () => ({
  isIdbEncryptionReady: () => false,
}));

vi.mock('../../../components/ui/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: unknown }) => children,
}));

vi.mock('../../../components/settings/IdbUnlockModal', () => ({
  IdbUnlockModal: () => <div data-testid="idb-unlock-modal" />,
}));

import { IdbUnlockModalGate } from '../../../components/settings/IdbUnlockModalGate';

describe('IdbUnlockModalGate', () => {
  beforeEach(() => {
    mockIsDesktop.value = false;
    vi.clearAllMocks();
  });

  it('renders the web unlock prompt when admitted', () => {
    render(<IdbUnlockModalGate isOpen encryptionEnabled hasRecoveryJournal={false} />);
    expect(screen.getByTestId('idb-unlock-modal')).toBeInTheDocument();
  });

  it('suppresses the prompt on desktop even when the global flag is on', () => {
    mockIsDesktop.value = true;
    render(<IdbUnlockModalGate isOpen encryptionEnabled hasRecoveryJournal={false} />);
    expect(screen.queryByTestId('idb-unlock-modal')).not.toBeInTheDocument();
  });
});
