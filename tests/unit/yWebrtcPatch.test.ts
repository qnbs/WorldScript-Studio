import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

// QNBS-v3: Smoke-test verifies the y-webrtc RTCDataChannel encryption patch is applied.
// This catches accidental patch removal or y-webrtc upgrades that overwrite the patch.
describe('y-webrtc RTCDataChannel encryption patch', () => {
  const yWebrtcPath = path.resolve(
    import.meta.dirname,
    '../../node_modules/y-webrtc/src/y-webrtc.js',
  );

  it('patch file exists and is non-empty', () => {
    const patchPath = path.resolve(import.meta.dirname, '../../patches/y-webrtc@10.3.0.patch');
    expect(fs.existsSync(patchPath)).toBe(true);
    const patchContent = fs.readFileSync(patchPath, 'utf-8');
    expect(patchContent.length).toBeGreaterThan(0);
    expect(patchContent).toContain('cryptoutils.encrypt');
    expect(patchContent).toContain('cryptoutils.decrypt');
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
