import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// QNBS-v3: hoisted spy captures WebrtcProvider constructor options so we can assert on password wiring.
const mockWebrtcConstructorSpy = vi.hoisted(() => vi.fn());

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

import {
  collaborationService,
  DEFAULT_WEBRTC_SIGNALING_URLS,
  resolveWebRtcSignalingUrls,
} from '../../services/collaborationService';

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
    constructor(roomId: string, doc: unknown, options?: Record<string, unknown>) {
      mockWebrtcConstructorSpy(roomId, doc, options);
    }
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

  describe('resolveWebRtcSignalingUrls', () => {
    it('returns defaults when empty or invalid', () => {
      expect(resolveWebRtcSignalingUrls(undefined)).toEqual([...DEFAULT_WEBRTC_SIGNALING_URLS]);
      expect(resolveWebRtcSignalingUrls([])).toEqual([...DEFAULT_WEBRTC_SIGNALING_URLS]);
      expect(resolveWebRtcSignalingUrls(['http://bad'])).toEqual([
        ...DEFAULT_WEBRTC_SIGNALING_URLS,
      ]);
    });

    it('keeps valid ws URLs', () => {
      expect(resolveWebRtcSignalingUrls(['wss://a.example/ws'])).toEqual(['wss://a.example/ws']);
    });
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
        'password1',
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
        'password2',
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
        'shared-secret',
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
        'shared-secret',
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

  // QNBS-v3: Retry-Backoff-Branches — connectWithBackoff hatte 0 % Branch-Coverage.
  describe('connectWithBackoff', () => {
    it('succeeds on first attempt — connect called exactly once', async () => {
      const spy = vi.spyOn(collaborationService, 'connect').mockResolvedValueOnce(undefined);
      await collaborationService.connectWithBackoff('proj', { id: 'u', name: 'U', color: '#000' });
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('retries once after failure then succeeds', async () => {
      vi.useFakeTimers();
      const spy = vi
        .spyOn(collaborationService, 'connect')
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce(undefined);

      const promise = collaborationService.connectWithBackoff(
        'proj',
        { id: 'u', name: 'U', color: '#000' },
        { maxRetries: 4, baseDelayMs: 100 },
      );
      await vi.runAllTimersAsync();
      await promise;

      expect(spy).toHaveBeenCalledTimes(2);
      spy.mockRestore();
      vi.useRealTimers();
    });

    it('throws after maxRetries exhausted', async () => {
      vi.useFakeTimers();
      const err = new Error('always fails');
      const spy = vi.spyOn(collaborationService, 'connect').mockRejectedValue(err);

      const promise = collaborationService.connectWithBackoff(
        'proj',
        { id: 'u', name: 'U', color: '#000' },
        { maxRetries: 2, baseDelayMs: 10 },
      );
      // Attach handler immediately — prevents unhandled-rejection warning from timer-advanced calls
      const caught = promise.catch((e: unknown) => e as Error);
      await vi.runAllTimersAsync();
      const result = await caught;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe('always fails');
      // initial attempt + 2 retries = 3 total calls
      expect(spy).toHaveBeenCalledTimes(3);
      spy.mockRestore();
      vi.useRealTimers();
    });
  });

  // QNBS-v3: getConnectedUsers-Branches — awareness-Zustände mit/ohne cursor, Name-Länge.
  describe('getConnectedUsers branches', () => {
    type AwarenessMock = {
      setLocalStateField: ReturnType<typeof vi.fn>;
      getLocalState: ReturnType<typeof vi.fn>;
      getStates: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
    };

    const getAwareness = (): AwarenessMock =>
      (
        (collaborationService as unknown as Record<string, unknown>)['provider'] as {
          awareness: AwarenessMock;
        }
      ).awareness;

    beforeEach(async () => {
      await collaborationService.connect('proj', { id: 'u', name: 'Test', color: '#000' });
    });

    it('returns user when all required fields are valid', () => {
      getAwareness().getStates.mockReturnValue(
        new Map([[1, { user: { id: 'u1', name: 'Alice', color: '#ff0' } }]]),
      );
      const users = collaborationService.getConnectedUsers();
      expect(users).toHaveLength(1);
      expect(users[0]).toEqual({ id: 'u1', name: 'Alice', color: '#ff0' });
    });

    it('skips entries where name exceeds 100 characters', () => {
      getAwareness().getStates.mockReturnValue(
        new Map([[1, { user: { id: 'u1', name: 'a'.repeat(101), color: '#ff0' } }]]),
      );
      expect(collaborationService.getConnectedUsers()).toHaveLength(0);
    });

    it('includes cursor field when cursor is a number', () => {
      getAwareness().getStates.mockReturnValue(
        new Map([[1, { user: { id: 'u1', name: 'Bob', color: '#00f', cursor: 42 } }]]),
      );
      const users = collaborationService.getConnectedUsers();
      expect(users[0]?.cursor).toBe(42);
    });

    it('omits cursor field when cursor is not a number', () => {
      getAwareness().getStates.mockReturnValue(
        new Map([[1, { user: { id: 'u1', name: 'Carol', color: '#0f0', cursor: 'invalid' } }]]),
      );
      const users = collaborationService.getConnectedUsers();
      expect(users[0]).not.toHaveProperty('cursor');
    });

    it('skips entries where user state is missing', () => {
      getAwareness().getStates.mockReturnValue(new Map([[1, {}]]));
      expect(collaborationService.getConnectedUsers()).toHaveLength(0);
    });
  });

  // QNBS-v3: updateUserState no-op branch — provider null → früher Return.
  describe('updateUserState', () => {
    it('no-ops when not connected', () => {
      expect(() => collaborationService.updateUserState({ name: 'X' })).not.toThrow();
    });

    it('merges patch into existing local state', async () => {
      await collaborationService.connect('proj', { id: 'u', name: 'Old', color: '#000' });
      type AwarenessMock = {
        setLocalStateField: ReturnType<typeof vi.fn>;
        getLocalState: ReturnType<typeof vi.fn>;
        getStates: ReturnType<typeof vi.fn>;
        on: ReturnType<typeof vi.fn>;
      };
      const awareness: AwarenessMock = (
        (collaborationService as unknown as Record<string, unknown>)['provider'] as {
          awareness: AwarenessMock;
        }
      ).awareness;
      awareness.getLocalState.mockReturnValue({ user: { id: 'u', name: 'Old', color: '#000' } });

      collaborationService.updateUserState({ name: 'New' });

      expect(awareness.setLocalStateField).toHaveBeenCalledWith(
        'user',
        expect.objectContaining({ name: 'New', id: 'u', color: '#000' }),
      );
    });
  });

  // QNBS-v3: disconnect-Listener-Branch und getSharedText-Throw-Branch.
  describe('disconnect fires listeners', () => {
    it('calls registered listeners on disconnect', async () => {
      await collaborationService.connect('proj', { id: 'u', name: 'U', color: '#000' });
      const listener = vi.fn();
      collaborationService.onUsersChange(listener);
      collaborationService.disconnect();
      expect(listener).toHaveBeenCalled();
    });
  });

  describe('getSharedText', () => {
    it('throws when not connected', () => {
      expect(() => collaborationService.getSharedText('manuscript')).toThrow(
        'Not connected to a collaboration room.',
      );
    });
  });
});

// ─── Encryption methods ───────────────────────────────────────────────────────
// QNBS-v3: vi.spyOn mocks avoid real PBKDF2 310k iterations while still exercising the call path.

describe('collaborationService encryption', () => {
  const mockCryptoKey = {} as CryptoKey;
  let importKeySpy: ReturnType<typeof vi.spyOn>;
  let deriveKeySpy: ReturnType<typeof vi.spyOn>;
  let encryptSpy: ReturnType<typeof vi.spyOn>;
  let decryptSpy: ReturnType<typeof vi.spyOn>;
  let getRandomValuesSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    importKeySpy = vi
      .spyOn(crypto.subtle, 'importKey')
      .mockResolvedValue(mockCryptoKey as unknown as CryptoKey);
    deriveKeySpy = vi
      .spyOn(crypto.subtle, 'deriveKey')
      .mockResolvedValue(mockCryptoKey as unknown as CryptoKey);
    // QNBS-v3: double-cast via unknown required — TS6 strict ArrayBufferLike ≠ ArrayBuffer.
    encryptSpy = vi
      .spyOn(crypto.subtle, 'encrypt')
      .mockImplementation(
        async (_algo, _key, data) =>
          (data instanceof ArrayBuffer
            ? data
            : (data as ArrayBufferView).buffer) as unknown as ArrayBuffer,
      );
    decryptSpy = vi
      .spyOn(crypto.subtle, 'decrypt')
      .mockImplementation(
        async (_algo, _key, data) =>
          (data instanceof ArrayBuffer
            ? data
            : (data as ArrayBufferView).buffer) as unknown as ArrayBuffer,
      );
    // QNBS-v3: Deterministic IV so slice offsets are predictable in round-trip test.
    getRandomValuesSpy = vi.spyOn(crypto, 'getRandomValues').mockImplementation((<
      T extends ArrayBufferView | null,
    >(
      arr: T,
    ): T => {
      if (arr instanceof Uint8Array) {
        for (let i = 0; i < arr.length; i++) arr[i] = i;
      }
      return arr;
    }) as typeof crypto.getRandomValues);
  });

  afterEach(() => {
    importKeySpy.mockRestore();
    deriveKeySpy.mockRestore();
    encryptSpy.mockRestore();
    decryptSpy.mockRestore();
    getRandomValuesSpy.mockRestore();
    collaborationService.disconnect();
  });

  it('getEncryptionStatus returns "plaintext" when not connected', () => {
    expect(collaborationService.getEncryptionStatus()).toBe('plaintext');
  });

  it('getEncryptionStatus returns "psk-only" when connected without password', async () => {
    await collaborationService.connect('proj', { id: 'u', name: 'U', color: '#000' });
    expect(collaborationService.getEncryptionStatus()).toBe('psk-only');
  });

  it('getEncryptionStatus returns "encrypted" when connected with password', async () => {
    await collaborationService.connect('proj', { id: 'u', name: 'U', color: '#000' }, 'secret');
    expect(collaborationService.getEncryptionStatus()).toBe('encrypted');
    expect(importKeySpy).toHaveBeenCalled();
    expect(deriveKeySpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'PBKDF2', iterations: 310_000 }),
      mockCryptoKey,
      expect.objectContaining({ name: 'AES-GCM', length: 256 }),
      false,
      ['encrypt', 'decrypt'],
    );
  });

  it('encryptUpdate prepends 12-byte IV to ciphertext', async () => {
    const data = new Uint8Array([10, 20, 30]);
    const result = await collaborationService.encryptUpdate(mockCryptoKey, data);
    const arr = new Uint8Array(result);
    // IV = deterministic bytes 0..11
    expect(Array.from(arr.slice(0, 12))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(arr.length).toBeGreaterThan(12);
  });

  it('encryptUpdate + decryptUpdate round-trip recovers original data', async () => {
    const original = new Uint8Array([42, 43, 44]);
    const encrypted = await collaborationService.encryptUpdate(mockCryptoKey, original);
    const encArr = new Uint8Array(encrypted);
    const iv = encArr.slice(0, 12);
    const ciphertext = encArr.slice(12).buffer;
    const decrypted = await collaborationService.decryptUpdate(mockCryptoKey, iv, ciphertext);
    expect(Array.from(decrypted)).toEqual(Array.from(original));
    expect(encryptSpy).toHaveBeenCalled();
    expect(decryptSpy).toHaveBeenCalled();
  });

  it('getEncryptionStatus returns "plaintext" after disconnect', async () => {
    await collaborationService.connect('proj', { id: 'u', name: 'U', color: '#000' }, 'pw');
    collaborationService.disconnect();
    expect(collaborationService.getEncryptionStatus()).toBe('plaintext');
  });

  it('passes password to WebrtcProvider constructor enabling y-webrtc E2E encryption', async () => {
    mockWebrtcConstructorSpy.mockClear();
    await collaborationService.connect('proj', { id: 'u', name: 'U', color: '#000' }, 'mysecret');
    const lastCall = mockWebrtcConstructorSpy.mock.calls.at(-1);
    // QNBS-v3: opt-in E2E — password forwarded so y-webrtc activates its AES-GCM-256 path.
    expect(lastCall?.[2]).toMatchObject({ password: 'mysecret' });
  });

  it('does not pass password to WebrtcProvider when connecting without password', async () => {
    mockWebrtcConstructorSpy.mockClear();
    await collaborationService.connect('proj', { id: 'u', name: 'U', color: '#000' });
    const lastCall = mockWebrtcConstructorSpy.mock.calls.at(-1);
    expect(lastCall?.[2]).not.toHaveProperty('password');
  });

  // QNBS-v3: Awareness-encryption — local user state is stored as { __enc: base64 } when password is set.
  it('stores awareness as __enc blob when connecting with password', async () => {
    type AwarenessMock = { setLocalStateField: ReturnType<typeof vi.fn> };
    await collaborationService.connect('proj', { id: 'u', name: 'U', color: '#000' }, 'secret');
    const provider = (collaborationService as unknown as Record<string, unknown>)['provider'] as {
      awareness: AwarenessMock;
    };
    const calls = provider.awareness.setLocalStateField.mock.calls;
    // The call from _setAwarenessUser in connect() should pass an __enc object, not a plain user
    const awarenessCall = calls.find((c: unknown[]) => c[0] === 'user');
    expect(awarenessCall?.[1]).toHaveProperty('__enc');
    expect(typeof (awarenessCall?.[1] as Record<string, unknown>)['__enc']).toBe('string');
  });

  // QNBS-v3: Plaintext mode — awareness is stored as plain CollaborationUser object.
  it('stores awareness as plain user object when connecting without password', async () => {
    type AwarenessMock = { setLocalStateField: ReturnType<typeof vi.fn> };
    await collaborationService.connect('proj', { id: 'u', name: 'U', color: '#000' });
    const provider = (collaborationService as unknown as Record<string, unknown>)['provider'] as {
      awareness: AwarenessMock;
    };
    const calls = provider.awareness.setLocalStateField.mock.calls;
    const awarenessCall = calls.find((c: unknown[]) => c[0] === 'user');
    expect(awarenessCall?.[1]).toMatchObject({ id: 'u', name: 'U', color: '#000' });
    expect(awarenessCall?.[1]).not.toHaveProperty('__enc');
  });

  // QNBS-v3: updateUserState in encrypted mode re-encrypts merged user; emits __enc blob.
  it('updateUserState emits __enc blob in encrypted mode', async () => {
    type AwarenessMock = { setLocalStateField: ReturnType<typeof vi.fn> };
    await collaborationService.connect('proj', { id: 'u', name: 'Old', color: '#000' }, 'pw');
    const provider = (collaborationService as unknown as Record<string, unknown>)['provider'] as {
      awareness: AwarenessMock;
    };
    provider.awareness.setLocalStateField.mockClear();

    collaborationService.updateUserState({ name: 'New' });
    // updateUserState fires void async — flush microtasks and macrotask (multi-await chain)
    await new Promise((resolve) => setTimeout(resolve, 0));

    const call = provider.awareness.setLocalStateField.mock.calls.at(-1);
    expect(call?.[0]).toBe('user');
    expect(call?.[1]).toHaveProperty('__enc');
  });

  // QNBS-v3: getConnectedUsers in encrypted mode returns _decryptedUsers cache (empty until awareness fires).
  it('getConnectedUsers returns empty cache before first awareness change in encrypted mode', async () => {
    await collaborationService.connect('proj', { id: 'u', name: 'U', color: '#000' }, 'secret');
    // No awareness change fired yet — cache is empty
    expect(collaborationService.getConnectedUsers()).toEqual([]);
  });

  // QNBS-v3: _refreshDecryptedUsers decrypts __enc awareness entries; plaintext entries are validated normally.
  it('refreshDecryptedUsers decrypts encrypted awareness entries via awareness change', async () => {
    await collaborationService.connect('proj', { id: 'u', name: 'U', color: '#000' }, 'secret');
    type AwarenessMock = {
      setLocalStateField: ReturnType<typeof vi.fn>;
      getStates: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
    };
    const provider = (collaborationService as unknown as Record<string, unknown>)['provider'] as {
      awareness: AwarenessMock;
    };

    // Simulate an encrypted peer entry: build a valid __enc payload using encryptUpdate
    const peerUser = { id: 'peer1', name: 'Peer', color: '#0f0' };
    const peerJson = JSON.stringify(peerUser);
    const peerBytes = new TextEncoder().encode(peerJson) as Uint8Array<ArrayBuffer>;
    // encryptSpy mock returns the input data as ciphertext (identity mock)
    const peerEncrypted = await collaborationService.encryptUpdate(
      {} as CryptoKey, // key is mocked — encryptSpy ignores it
      peerBytes,
    );
    const peerBytes2 = new Uint8Array(peerEncrypted);
    let binary = '';
    for (const byte of peerBytes2) binary += String.fromCharCode(byte);
    const peerEncB64 = btoa(binary);

    provider.awareness.getStates.mockReturnValue(new Map([[2, { user: { __enc: peerEncB64 } }]]));

    // Trigger the awareness change handler
    const onCall = provider.awareness.on.mock.calls.find((c: unknown[]) => c[0] === 'change');
    const changeHandler = onCall?.[1] as (() => void) | undefined;
    expect(changeHandler).toBeDefined();
    changeHandler?.();
    // Wait for the async _refreshDecryptedUsers + listener chain to complete
    await new Promise((resolve) => setTimeout(resolve, 0));

    const users = collaborationService.getConnectedUsers();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ id: 'peer1', name: 'Peer', color: '#0f0' });
  });

  // QNBS-v3: _decryptAwarenessPayload returns null for tampered base64 data.
  it('returns empty users list when awareness payload is tampered', async () => {
    await collaborationService.connect('proj', { id: 'u', name: 'U', color: '#000' }, 'secret');
    type AwarenessMock = {
      getStates: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
    };
    const provider = (collaborationService as unknown as Record<string, unknown>)['provider'] as {
      awareness: AwarenessMock;
    };

    // Invalid base64 / wrong-key ciphertext — decryptSpy will reject
    decryptSpy.mockRejectedValueOnce(new Error('decryption failed'));
    provider.awareness.getStates.mockReturnValue(
      new Map([[2, { user: { __enc: 'AAAAAAAAAAAAAAAA' } }]]),
    );

    const onCall = provider.awareness.on.mock.calls.find((c: unknown[]) => c[0] === 'change');
    const changeHandler = onCall?.[1] as (() => void) | undefined;
    changeHandler?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(collaborationService.getConnectedUsers()).toEqual([]);
  });

  // QNBS-v3: _decryptedUsers and _localUser cleared on disconnect.
  it('clears decryptedUsers and localUser on disconnect', async () => {
    await collaborationService.connect('proj', { id: 'u', name: 'U', color: '#000' }, 'secret');
    collaborationService.disconnect();
    expect((collaborationService as unknown as Record<string, unknown>)['_localUser']).toBeNull();
    expect((collaborationService as unknown as Record<string, unknown>)['_decryptedUsers']).toEqual(
      [],
    );
  });
});
