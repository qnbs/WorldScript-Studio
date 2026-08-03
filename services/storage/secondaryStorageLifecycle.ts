/**
 * Coordinates decrypt-to-plaintext (disable) and re-encrypt (rotation) across secondary IDB stores.
 * QNBS-v3: Secondary envelopes must be migrated before clearIdbPassphrase or they become unreadable.
 */

export {
  decryptAllSecondaryStoresToPlaintext,
  reEncryptAllSecondaryStores,
} from './secondaryStorageMigration';
