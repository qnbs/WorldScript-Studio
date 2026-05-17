import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorldView } from '../../../hooks/useWorldView';
import type { World } from '../../../types';

// ---------------------------------------------------------------------------
// vi.hoisted — thunk match fns must be stable references inside vi.mock factories
// ---------------------------------------------------------------------------
const { mockProfileMatch, mockRegenerateMatch, mockImageMatch } = vi.hoisted(() => ({
  mockProfileMatch: vi.fn((_: unknown) => true),
  mockRegenerateMatch: vi.fn((_: unknown) => true),
  mockImageMatch: vi.fn((_: unknown) => true),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
const mockSaveImage = vi.fn().mockResolvedValue(undefined);

let mockWorlds: World[] = [];

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ project: { present: { data: { worlds: { ids: [], entities: {} } } } } }),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) =>
      opts?.['name'] ? `${key}:${opts['name']}` : key,
    language: 'en',
  }),
}));

vi.mock('../../../components/ui/Toast', () => ({
  useToast: () => mockToast,
}));

vi.mock('../../../features/project/projectSelectors', () => ({
  selectAllWorlds: () => mockWorlds,
}));

vi.mock('../../../features/project/thunks/worldThunks', () => {
  const profileThunk = vi.fn(() => ({ type: 'mock-profile' }));
  (profileThunk as unknown as { fulfilled: { match: (a: unknown) => unknown } }).fulfilled = {
    match: (a: unknown) => mockProfileMatch(a),
  };

  const regenerateThunk = vi.fn(() => ({ type: 'mock-regen' }));
  (regenerateThunk as unknown as { fulfilled: { match: (a: unknown) => unknown } }).fulfilled = {
    match: (a: unknown) => mockRegenerateMatch(a),
  };

  const imageThunk = vi.fn(() => ({ type: 'mock-image' }));
  (imageThunk as unknown as { fulfilled: { match: (a: unknown) => unknown } }).fulfilled = {
    match: (a: unknown) => mockImageMatch(a),
  };

  return {
    generateWorldProfileThunk: profileThunk,
    regenerateWorldFieldThunk: regenerateThunk,
    generateWorldImageThunk: imageThunk,
    uploadWorldImageThunk: vi.fn(),
  };
});

vi.mock('../../../services/storageService', () => ({
  storageService: { saveImage: (id: unknown, data: unknown) => mockSaveImage(id, data) },
}));

vi.mock('uuid', () => ({ v4: () => 'test-uuid-world' }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorld(id: string, name = 'Arda'): World {
  return {
    id,
    name,
    description: 'A beautiful world',
    geography: 'Mountains',
    magicSystem: 'None',
    culture: 'Medieval',
    notes: '',
    timeline: [],
    locations: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDispatch.mockResolvedValue({ type: 'mock-action' });
  mockWorlds = [];
  mockProfileMatch.mockReturnValue(true);
  mockRegenerateMatch.mockReturnValue(true);
  mockImageMatch.mockReturnValue(true);
});

// ---------------------------------------------------------------------------
// handleAddNewManually
// ---------------------------------------------------------------------------
describe('handleAddNewManually', () => {
  it('dispatches addWorld with translated name', () => {
    const { result } = renderHook(() => useWorldView());
    act(() => {
      result.current.handleAddNewManually();
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'project/addWorld',
        payload: expect.objectContaining({ name: 'worlds.newWorldName' }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// handleAddNewWithAI
// ---------------------------------------------------------------------------
describe('handleAddNewWithAI', () => {
  it('opens the AI modal', () => {
    const { result } = renderHook(() => useWorldView());
    expect(result.current.isAiModalOpen).toBe(false);
    act(() => {
      result.current.handleAddNewWithAI();
    });
    expect(result.current.isAiModalOpen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleGenerateProfile
// ---------------------------------------------------------------------------
describe('handleGenerateProfile', () => {
  it('dispatches addWorld and calls toast.success on fulfilled', async () => {
    const newWorld = makeWorld('w-new');
    mockDispatch.mockResolvedValue({ type: 'fulfilled', payload: newWorld });
    mockProfileMatch.mockReturnValue(true);

    const { result } = renderHook(() => useWorldView());
    await act(async () => {
      await result.current.handleGenerateProfile();
    });

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/addWorld' }),
    );
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('calls toast.error on rejected', async () => {
    mockDispatch.mockResolvedValue({ type: 'rejected' });
    mockProfileMatch.mockReturnValue(false);

    const { result } = renderHook(() => useWorldView());
    await act(async () => {
      await result.current.handleGenerateProfile();
    });

    expect(mockToast.error).toHaveBeenCalled();
  });

  it('resets isGeneratingProfile to false after completion', async () => {
    mockDispatch.mockResolvedValue({ type: 'fulfilled', payload: makeWorld('w1') });
    mockProfileMatch.mockReturnValue(true);

    const { result } = renderHook(() => useWorldView());
    await act(async () => {
      await result.current.handleGenerateProfile();
    });
    expect(result.current.isGeneratingProfile).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleSelect
// ---------------------------------------------------------------------------
describe('handleSelect', () => {
  it('sets selectedWorld and opens atlas', () => {
    const world = makeWorld('w1');
    const { result } = renderHook(() => useWorldView());
    act(() => {
      result.current.handleSelect(world);
    });
    expect(result.current.selectedWorld?.id).toBe('w1');
    expect(result.current.isAtlasOpen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleFieldChange
// ---------------------------------------------------------------------------
describe('handleFieldChange', () => {
  it('dispatches updateWorld with field change', () => {
    const world = makeWorld('w1');
    const { result } = renderHook(() => useWorldView());
    // QNBS-v3: separate act() calls so selectedWorld state commits before handleFieldChange
    act(() => {
      result.current.handleSelect(world);
    });
    act(() => {
      result.current.handleFieldChange('description', 'New desc');
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'project/updateWorld',
        payload: { id: 'w1', changes: { description: 'New desc' } },
      }),
    );
  });

  it('does nothing when no world is selected', () => {
    const { result } = renderHook(() => useWorldView());
    act(() => {
      result.current.handleFieldChange('description', 'test');
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleRegenerateField
// ---------------------------------------------------------------------------
describe('handleRegenerateField', () => {
  it('calls toast.error when no world is selected', async () => {
    const { result } = renderHook(() => useWorldView());
    await act(async () => {
      await result.current.handleRegenerateField('description');
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('calls toast.error on rejected', async () => {
    const world = makeWorld('w1');
    mockDispatch.mockResolvedValue({ type: 'rejected' });
    mockRegenerateMatch.mockReturnValue(false);

    const { result } = renderHook(() => useWorldView());
    act(() => {
      result.current.handleSelect(world);
    });
    await act(async () => {
      await result.current.handleRegenerateField('geography');
    });
    expect(mockToast.error).toHaveBeenCalled();
  });

  it('resets isRegeneratingField to null after completion', async () => {
    const world = makeWorld('w1');
    mockDispatch.mockResolvedValue({
      type: 'fulfilled',
      payload: { field: 'geography', value: 'Plains' },
    });
    mockRegenerateMatch.mockReturnValue(true);

    const { result } = renderHook(() => useWorldView());
    act(() => {
      result.current.handleSelect(world);
    });
    await act(async () => {
      await result.current.handleRegenerateField('geography');
    });
    expect(result.current.isRegeneratingField).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleGenerateImage
// ---------------------------------------------------------------------------
describe('handleGenerateImage', () => {
  it('does nothing if selectedWorld has no description', async () => {
    const world = { ...makeWorld('w1'), description: '' };
    const { result } = renderHook(() => useWorldView());
    act(() => {
      result.current.handleSelect(world);
    });
    await act(async () => {
      await result.current.handleGenerateImage();
    });
    expect(mockDispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'mock-image' }));
  });

  it('calls toast.error when image generation fails', async () => {
    const world = makeWorld('w1');
    mockDispatch.mockResolvedValue({ type: 'rejected' });
    mockImageMatch.mockReturnValue(false);

    const { result } = renderHook(() => useWorldView());
    act(() => {
      result.current.handleSelect(world);
    });
    await act(async () => {
      await result.current.handleGenerateImage();
    });
    expect(mockToast.error).toHaveBeenCalled();
  });

  it('sets hasAmbianceImage on success', async () => {
    const world = makeWorld('w1');
    mockDispatch.mockResolvedValue({ type: 'fulfilled' });
    mockImageMatch.mockReturnValue(true);

    const { result } = renderHook(() => useWorldView());
    act(() => {
      result.current.handleSelect(world);
    });
    await act(async () => {
      await result.current.handleGenerateImage();
    });
    expect(result.current.isGeneratingImage).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleDelete / confirmDelete
// ---------------------------------------------------------------------------
describe('handleDelete', () => {
  it('sets worldToDelete when world is found', () => {
    const world = makeWorld('w1');
    mockWorlds = [world];
    const { result } = renderHook(() => useWorldView());
    act(() => {
      result.current.handleDelete('w1');
    });
    expect(result.current.worldToDelete?.id).toBe('w1');
  });

  it('does nothing when world is not found', () => {
    const { result } = renderHook(() => useWorldView());
    act(() => {
      result.current.handleDelete('nonexistent');
    });
    expect(result.current.worldToDelete).toBeNull();
  });
});

describe('confirmDelete', () => {
  it('dispatches deleteWorld and closes atlas on confirm', async () => {
    const world = makeWorld('w1');
    mockWorlds = [world];
    const { result } = renderHook(() => useWorldView());
    act(() => {
      result.current.handleDelete('w1');
      result.current.handleSelect(world);
    });
    await act(async () => {
      await result.current.confirmDelete();
    });
    expect(mockSaveImage).toHaveBeenCalledWith('w1', '');
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/deleteWorld', payload: 'w1' }),
    );
    expect(result.current.isAtlasOpen).toBe(false);
    expect(result.current.selectedWorld).toBeNull();
  });

  it('does nothing when worldToDelete is null', async () => {
    const { result } = renderHook(() => useWorldView());
    await act(async () => {
      await result.current.confirmDelete();
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Timeline handlers
// ---------------------------------------------------------------------------
describe('addTimelineEvent', () => {
  it('does nothing without a selected world', () => {
    const { result } = renderHook(() => useWorldView());
    act(() => {
      result.current.addTimelineEvent();
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('dispatches updateWorld with new timeline event', () => {
    const world = makeWorld('w1');
    const { result } = renderHook(() => useWorldView());
    // QNBS-v3: separate act() so selectedWorld state commits before addTimelineEvent runs
    act(() => {
      result.current.handleSelect(world);
    });
    act(() => {
      result.current.addTimelineEvent();
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'project/updateWorld',
        payload: expect.objectContaining({ id: 'w1' }),
      }),
    );
  });
});

describe('deleteTimelineEvent', () => {
  it('removes event from timeline', () => {
    const world = {
      ...makeWorld('w1'),
      timeline: [{ id: 'e1', title: 'Battle', era: '3rd Age', description: '' }],
    };
    const { result } = renderHook(() => useWorldView());
    act(() => {
      result.current.handleSelect(world);
    });
    act(() => {
      result.current.deleteTimelineEvent('e1');
    });
    const dispatched = mockDispatch.mock.calls.find((c) => c[0]?.payload?.changes?.timeline);
    expect(dispatched?.[0]?.payload?.changes?.timeline).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Location handlers
// ---------------------------------------------------------------------------
describe('addLocation', () => {
  it('dispatches updateWorld with new location', () => {
    const world = makeWorld('w1');
    const { result } = renderHook(() => useWorldView());
    act(() => {
      result.current.handleSelect(world);
    });
    act(() => {
      result.current.addLocation();
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'project/updateWorld',
        payload: expect.objectContaining({ id: 'w1' }),
      }),
    );
  });
});

describe('deleteLocation', () => {
  it('removes location from world', () => {
    const world = {
      ...makeWorld('w1'),
      locations: [{ id: 'loc1', name: 'Castle', description: '', type: 'other' as const }],
    };
    const { result } = renderHook(() => useWorldView());
    act(() => {
      result.current.handleSelect(world);
    });
    act(() => {
      result.current.deleteLocation('loc1');
    });
    const dispatched = mockDispatch.mock.calls.find((c) => c[0]?.payload?.changes?.locations);
    expect(dispatched?.[0]?.payload?.changes?.locations).toHaveLength(0);
  });
});
