//! The narrow secret-store boundary a platform secure store must provide (§8.2.2): named items that
//! can be read, atomically replaced, and deleted. [`crate::store_provider::SecureStoreKeyProvider`]
//! builds the whole §8.2 `KeyProvider` on top of it, so every platform shares one implementation.

use zeroize::Zeroizing;

use crate::error::KeyProviderError;

/// One secure store namespace (a service) holding named items (accounts).
pub trait SecretStore {
    /// The item's bytes, or `None` if the item does not exist. Any failure to reach the store is an
    /// error, never `None`.
    fn get(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, KeyProviderError>;
    /// Creates or atomically replaces the item.
    fn set(&self, account: &str, secret: &[u8]) -> Result<(), KeyProviderError>;
    /// Removes the item; removing a missing item succeeds.
    fn delete(&self, account: &str) -> Result<(), KeyProviderError>;
}

#[cfg(feature = "test-support")]
pub use memory::MemorySecretStore;

#[cfg(feature = "test-support")]
mod memory {
    use std::cell::RefCell;
    use std::collections::BTreeMap;
    use std::rc::Rc;

    use zeroize::Zeroizing;

    use super::SecretStore;
    use crate::error::KeyProviderError;

    #[derive(Default)]
    struct Inner {
        items: BTreeMap<String, Zeroizing<Vec<u8>>>,
        unavailable: bool,
        read_only: bool,
    }

    /// Headless in-memory [`SecretStore`] for tests. Clones share the same items, so a second
    /// provider built on a clone behaves like the same installation after a restart.
    #[derive(Clone, Default)]
    pub struct MemorySecretStore(Rc<RefCell<Inner>>);

    impl MemorySecretStore {
        pub fn new() -> Self {
            Self::default()
        }

        /// Makes every call fail as an unreachable store would.
        pub fn set_unavailable(&self, unavailable: bool) {
            self.0.borrow_mut().unavailable = unavailable;
        }

        /// Makes writes and deletes fail while reads keep working (a store refusing mutation).
        pub fn set_read_only(&self, read_only: bool) {
            self.0.borrow_mut().read_only = read_only;
        }

        fn check_writable(&self) -> Result<(), KeyProviderError> {
            self.check()?;
            if self.0.borrow().read_only {
                Err(KeyProviderError::Unavailable)
            } else {
                Ok(())
            }
        }

        /// Overwrites an item directly, bypassing the provider (to simulate corruption).
        pub fn put_raw(&self, account: &str, bytes: &[u8]) {
            let value = Zeroizing::new(bytes.to_vec());
            self.0.borrow_mut().items.insert(account.to_owned(), value);
        }

        pub fn accounts(&self) -> Vec<String> {
            self.0.borrow().items.keys().cloned().collect()
        }

        fn check(&self) -> Result<(), KeyProviderError> {
            if self.0.borrow().unavailable {
                Err(KeyProviderError::SecureAnchorUnavailable)
            } else {
                Ok(())
            }
        }
    }

    impl SecretStore for MemorySecretStore {
        fn get(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, KeyProviderError> {
            self.check()?;
            Ok(self.0.borrow().items.get(account).cloned())
        }

        fn set(&self, account: &str, secret: &[u8]) -> Result<(), KeyProviderError> {
            self.check_writable()?;
            self.put_raw(account, secret);
            Ok(())
        }

        fn delete(&self, account: &str) -> Result<(), KeyProviderError> {
            self.check_writable()?;
            self.0.borrow_mut().items.remove(account);
            Ok(())
        }
    }
}
