import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

// QNBS-v3: Smoke-test verifies the y-webrtc RTCDataChannel encryption patch is applied.
// This catches accidental patch removal or y-webrtc upgrades that overwrite the patch.
describe('y-webrtc RTCDataChannel encryption patch', () => {
  // QNBS-v3: encryption lives in the vendor fork, not in node_modules
  const yWebrtcPath = path.resolve(
    import.meta.dirname,
    '../../packages/collab-transport/src/y-webrtc.js',
  );

  it('deprecated pnpm patch file is gone — the vendored fork is the single source (#60)', () => {
    // QNBS-v3 (#60): patches/y-webrtc@10.3.0.patch was removed when the fork moved from
    // pnpm-patched node_modules to the vendored @domain/collab-transport workspace package.
    // verify:vendor (CI security job) guards the full invariant set; here we pin the file-level
    // contract so a stray patch reintroduction fails fast in unit tests too.
    const patchPath = path.resolve(import.meta.dirname, '../../patches/y-webrtc@10.3.0.patch');
    expect(fs.existsSync(patchPath)).toBe(false);
    expect(fs.existsSync(yWebrtcPath)).toBe(true);
  });

  it('sendWebrtcConn encrypts before peer.send when room.key is set', () => {
    const source = fs.readFileSync(yWebrtcPath, 'utf-8');
    // QNBS-v3: Verify the patched function contains the encrypt branch.
    expect(source).toContain('cryptoutils.encrypt(data, room.key).then(encrypted => {');
    expect(source).toContain('webrtcConn.peer.send(encrypted)');
  });

  it('broadcastWebrtcConn encrypts before broadcasting when room.key is set', () => {
    const source = fs.readFileSync(yWebrtcPath, 'utf-8');
    expect(source).toContain('cryptoutils.encrypt(m, room.key).then(encrypted => {');
    expect(source).toContain('conn.peer.send(encrypted)');
  });

  it('peer.on data decrypts before readPeerMessage when room.key is set', () => {
    const source = fs.readFileSync(yWebrtcPath, 'utf-8');
    expect(source).toContain('cryptoutils.decrypt(data, room.key).then(plaintext => {');
    expect(source).toContain('readPeerMessage(this, plaintext)');
  });

  it('plaintext fallback remains when room.key is absent', () => {
    const source = fs.readFileSync(yWebrtcPath, 'utf-8');
    // QNBS-v3: Both encrypted and plaintext branches must exist for backward compatibility.
    expect(source).toContain('if (room.key)');
    expect(source).toContain('webrtcConn.peer.send(data)');
    expect(source).toContain('conn.peer.send(m)');
    expect(source).toContain('readPeerMessage(this, data)');
  });
});
