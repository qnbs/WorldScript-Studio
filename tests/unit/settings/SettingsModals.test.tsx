/**
 * Tests for components/settings/SettingsModals.tsx
 * QNBS-v3: Mocks SettingsViewContext; tests all modal states (closed, reset, create, restore, delete).
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSetModal = vi.fn();
const mockHandleResetProject = vi.fn();
const mockHandleCreateSnapshot = vi.fn();
const mockHandleRestoreSnapshot = vi.fn();
const mockHandleDeleteSnapshot = vi.fn();
const mockSetSnapshotName = vi.fn();

let mockModal: { state: string; payload: Record<string, unknown> } = {
  state: 'closed',
  payload: {},
};
let mockSnapshotName = '';

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => ({
    t: (k: string, args?: Record<string, string>) => (args ? `${k}:${JSON.stringify(args)}` : k),
    modal: mockModal,
    setModal: mockSetModal,
    handleResetProject: mockHandleResetProject,
    snapshotName: mockSnapshotName,
    setSnapshotName: mockSetSnapshotName,
    handleCreateSnapshot: mockHandleCreateSnapshot,
    handleRestoreSnapshot: mockHandleRestoreSnapshot,
    handleDeleteSnapshot: mockHandleDeleteSnapshot,
    currentWordCount: 1500,
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { SettingsModals } from '../../../components/settings/SettingsModals';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsModals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModal = { state: 'closed', payload: {} };
    mockSnapshotName = '';
  });

  it('renders nothing when modal state is closed', () => {
    const { container } = render(<SettingsModals />);
    expect(container).toBeEmptyDOMElement();
  });

  describe('reset modal', () => {
    beforeEach(() => {
      mockModal = { state: 'reset', payload: {} };
    });

    it('renders reset modal title', () => {
      render(<SettingsModals />);
      expect(screen.getByText('settings.resetModal.title')).toBeInTheDocument();
    });

    it('renders reset modal description', () => {
      render(<SettingsModals />);
      expect(screen.getByText('settings.resetModal.description')).toBeInTheDocument();
    });

    it('calls handleResetProject when confirm button clicked', async () => {
      const user = userEvent.setup();
      render(<SettingsModals />);
      await user.click(screen.getByText('settings.resetModal.confirm'));
      expect(mockHandleResetProject).toHaveBeenCalled();
    });

    it('calls setModal with closed when cancel clicked', async () => {
      const user = userEvent.setup();
      render(<SettingsModals />);
      await user.click(screen.getByText('common.cancel'));
      expect(mockSetModal).toHaveBeenCalledWith({ state: 'closed', payload: {} });
    });
  });

  describe('create modal', () => {
    beforeEach(() => {
      mockModal = { state: 'create', payload: {} };
    });

    it('renders create snapshot title', () => {
      render(<SettingsModals />);
      expect(screen.getByText('settings.data.createSnapshot')).toBeInTheDocument();
    });

    it('renders snapshot name input label', () => {
      render(<SettingsModals />);
      expect(screen.getByText('settings.data.snapshotName')).toBeInTheDocument();
    });

    it('renders snapshot name input', () => {
      render(<SettingsModals />);
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('calls handleCreateSnapshot when generate clicked', async () => {
      const user = userEvent.setup();
      render(<SettingsModals />);
      await user.click(screen.getByText('common.generate'));
      expect(mockHandleCreateSnapshot).toHaveBeenCalled();
    });
  });

  describe('restore modal', () => {
    beforeEach(() => {
      mockModal = { state: 'restore', payload: { date: '2026-01-01', wordCount: 5000 } };
    });

    it('renders restore modal title', () => {
      render(<SettingsModals />);
      expect(screen.getByText('settings.restoreModal.title')).toBeInTheDocument();
    });

    it('calls handleRestoreSnapshot when confirm clicked', async () => {
      const user = userEvent.setup();
      render(<SettingsModals />);
      await user.click(screen.getByText('settings.restoreModal.confirm'));
      expect(mockHandleRestoreSnapshot).toHaveBeenCalled();
    });
  });

  describe('delete modal', () => {
    beforeEach(() => {
      mockModal = { state: 'delete', payload: {} };
    });

    it('renders delete modal title', () => {
      render(<SettingsModals />);
      expect(screen.getByText('settings.deleteModal.title')).toBeInTheDocument();
    });

    it('renders delete modal description', () => {
      render(<SettingsModals />);
      expect(screen.getByText('settings.deleteModal.description')).toBeInTheDocument();
    });

    it('calls handleDeleteSnapshot when confirm clicked', async () => {
      const user = userEvent.setup();
      render(<SettingsModals />);
      await user.click(screen.getByText('settings.deleteModal.confirm'));
      expect(mockHandleDeleteSnapshot).toHaveBeenCalled();
    });
  });
});
