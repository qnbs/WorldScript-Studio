/**
 * VENDORED FORK — y-webrtc 10.3.0
 * Upstream: https://github.com/yjs/y-webrtc  |  npm tag: v10.3.0
 * Package:  @domain/collab-transport v10.3.0-sc1  (vendored 2026-05-28)
 *
 * WorldScript patches (C-1, 2026-05-28 — commit 63afa69):
 *   1. PBKDF2 iterations raised 100k → 310k → 600k (OWASP 2024 SHA-256 minimum)
 *   2. deriveKey: extractable=false  (prevents key export via subtle.exportKey)
 *   3. encryptMessageContent: added `return` before promise.reject() (was silent swallow)
 *
 * SECURITY MAINTENANCE — Renovate cannot auto-update this fork.
 * On any new y-webrtc release: diff crypto.js + y-webrtc.js against the new tag,
 * cherry-pick security fixes, re-apply SC patches 1-3 above, bump version to <upstream>-sc1.
 * Checklist + audit log: https://github.com/qnbs/WorldScript-Studio/issues/60
 */
/* eslint-env browser */

import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as promise from 'lib0/promise'
import * as error from 'lib0/error'
import * as string from 'lib0/string'

/**
 * @param {string} secret
 * @param {string} roomName
 * @return {PromiseLike<CryptoKey>}
 */
export const deriveKey = (secret, roomName) => {
  const secretBuffer = string.encodeUtf8(secret).buffer
  const salt = string.encodeUtf8(roomName).buffer
  return crypto.subtle.importKey(
    'raw',
    secretBuffer,
    'PBKDF2',
    false,
    ['deriveKey']
  ).then(keyMaterial =>
    // SC-SEC: iterations raised 100k→310k→600k (OWASP 2024 minimum for SHA-256); extractable false (SEC-RULE-5)
    crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 600000,
        hash: 'SHA-256'
      },
      keyMaterial,
      {
        name: 'AES-GCM',
        length: 256
      },
      false,
      ['encrypt', 'decrypt']
    )
  )
}

/**
 * @param {Uint8Array} data data to be encrypted
 * @param {CryptoKey?} key
 * @return {PromiseLike<Uint8Array>} encrypted, base64 encoded message
 */
export const encrypt = (data, key) => {
  if (!key) {
    return /** @type {PromiseLike<Uint8Array>} */ (promise.resolve(data))
  }
  const iv = crypto.getRandomValues(new Uint8Array(12))
  return crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv
    },
    key,
    data
  ).then(cipher => {
    const encryptedDataEncoder = encoding.createEncoder()
    encoding.writeVarString(encryptedDataEncoder, 'AES-GCM')
    encoding.writeVarUint8Array(encryptedDataEncoder, iv)
    encoding.writeVarUint8Array(encryptedDataEncoder, new Uint8Array(cipher))
    return encoding.toUint8Array(encryptedDataEncoder)
  })
}

/**
 * @param {Object} data data to be encrypted
 * @param {CryptoKey?} key
 * @return {PromiseLike<Uint8Array>} encrypted data, if key is provided
 */
export const encryptJson = (data, key) => {
  const dataEncoder = encoding.createEncoder()
  encoding.writeAny(dataEncoder, data)
  return encrypt(encoding.toUint8Array(dataEncoder), key)
}

/**
 * @param {Uint8Array} data
 * @param {CryptoKey?} key
 * @return {PromiseLike<Uint8Array>} decrypted buffer
 */
export const decrypt = (data, key) => {
  if (!key) {
    return /** @type {PromiseLike<Uint8Array>} */ (promise.resolve(data))
  }
  const dataDecoder = decoding.createDecoder(data)
  const algorithm = decoding.readVarString(dataDecoder)
  if (algorithm !== 'AES-GCM') {
    // SC-SEC: return the rejection so decrypt() aborts — without return the error is swallowed
    return promise.reject(error.create('Unknown encryption algorithm'))
  }
  const iv = decoding.readVarUint8Array(dataDecoder)
  const cipher = decoding.readVarUint8Array(dataDecoder)
  return crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv
    },
    key,
    cipher
  ).then(data => new Uint8Array(data))
}

/**
 * @param {Uint8Array} data
 * @param {CryptoKey?} key
 * @return {PromiseLike<Object>} decrypted object
 */
export const decryptJson = (data, key) =>
  decrypt(data, key).then(decryptedValue =>
    decoding.readAny(decoding.createDecoder(new Uint8Array(decryptedValue)))
  )
