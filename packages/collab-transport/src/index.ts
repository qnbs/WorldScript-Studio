// QNBS-v3: B-3 vendor fork — y-webrtc 10.3.0 with StoryCraft RTCDataChannel E2E encryption patch.
// Replaces patchedDependencies approach; patch is permanently baked into this package's JS source.
// TypeScript resolves types via the adjacent y-webrtc.d.ts (moduleResolution: bundler).

export type { ProviderOptions, WebrtcProviderEvents } from './y-webrtc.js';
export { Room, SignalingConn, WebrtcConn, WebrtcProvider } from './y-webrtc.js';
