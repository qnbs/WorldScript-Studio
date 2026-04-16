import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock crypto.subtle for SHA-256 room derivation
const mockDigest = vi.fn().mockImplementation(async (_algo: string, data: ArrayBuffer) => {
  // Simple deterministic hash mock: use the data bytes to create a unique ArrayBuffer
  const input = new Uint8Array(data);
  const output = new Uint8Array(32);
  for (let i = 0; i < input.length; i++) {
    const idx = i % 32;
    const inputByte = input[i] ?? 0;
    output[idx] = ((output[idx] ?? 0) + inputByte) % 256;
  }
  return output.buffer;
});

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    writable: true,
    value: {
      subtle: { digest: mockDigest },
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
        return arr;
      },
    },
  });
} else if (!globalThis.crypto.subtle.digest) {
  globalThis.crypto.subtle.digest = mockDigest as unknown as SubtleCrypto['digest'];
}
import { collaborationService } from '../../services/collaborationService';

// Mock y-webrtc and yjs
vi.mock('y-webrtc', () => {
  class MockWebrtcProvider {
    awareness = {
      setLocalStateField: vi.fn(),
      getLocalState: vi.fn().mockReturnValue(null),
      getStates: vi.fn().mockReturnValue(new Map()),
      on: vi.fn(),
    };
    disconnect = vi.fn();
    destroy = vi.fn();
    constructor(_room: string, _doc: unknown, _opts: unknown) {}
  }
  return { WebrtcProvider: MockWebrtcProvider };
});

vi.mock('yjs', () => {
  class MockDoc {
    getText(_name: string) {
      return { toString: () => '' };
    }
    destroy() {}
  }
  return {
    Doc: MockDoc,
  };
});

describe('collaborationService', () => {
  beforeEach(() => {
    collaborationService.disconnect();
  });

  describe('initial state', () => {
    it('should not be connected', () => {
      expect(collaborationService.isConnected).toBe(false);
      expect(collaborationService.roomId).toBeNull();
    });

    it('should return empty users list when disconnected', () => {
      expect(collaborationService.getConnectedUsers()).toEqual([]);
    });
  });

  describe('connect', () => {
    it('should establish connection with project ID', async () => {
      await collaborationService.connect('test-project', {
        id: 'user-1',
        name: 'Test User',
        color: '#000',
      });

      expect(collaborationService.isConnected).toBe(true);
      expect(collaborationService.roomId).toBeTruthy();
    });

    it('should generate different room IDs for different passwords', async () => {
      await collaborationService.connect(
        'project-1',
        {
          id: 'u1',
          name: 'A',
          color: '#000',
        },
        'password1'
      );
      const room1 = collaborationService.roomId;

      collaborationService.disconnect();

      await collaborationService.connect(
        'project-1',
        {
          id: 'u1',
          name: 'A',
          color: '#000',
        },
        'password2'
      );
      const room2 = collaborationService.roomId;

      expect(room1).not.toBe(room2);
    });

    it('should generate same room ID for same password', async () => {
      await collaborationService.connect(
        'project-1',
        {
          id: 'u1',
          name: 'A',
          color: '#000',
        },
        'shared-secret'
      );
      const room1 = collaborationService.roomId;

      collaborationService.disconnect();

      await collaborationService.connect(
        'project-1',
        {
          id: 'u2',
          name: 'B',
          color: '#fff',
        },
        'shared-secret'
      );
      const room2 = collaborationService.roomId;

      expect(room1).toBe(room2);
    });
  });

  describe('disconnect', () => {
    it('should clean up state', async () => {
      await collaborationService.connect('test', {
        id: 'u',
        name: 'U',
        color: '#000',
      });
      collaborationService.disconnect();

      expect(collaborationService.isConnected).toBe(false);
      expect(collaborationService.roomId).toBeNull();
    });
  });

  describe('onUsersChange', () => {
    it('should register and unregister listeners', () => {
      const listener = vi.fn();
      const unsubscribe = collaborationService.onUsersChange(listener);
      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
    });
  });
});
