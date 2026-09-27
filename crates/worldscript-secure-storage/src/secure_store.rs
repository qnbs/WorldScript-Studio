//! The narrow secret-store boundary a platform secure store must provide (§8.2.2): named items that
//! can be read, atomically replaced, and deleted. A later gate builds the §8.2 `KeyProvider` on top of
//! it, so every platform shares one implementation.
//!
//! The version-1 item bound ([`MAX_ITEM_LEN`]) belongs to the boundary itself: implementations
//! provide only the raw [`SecretStore::load`] / [`SecretStore::store`] operations, and the provided
//! [`SecretStore::get`] / [`SecretStore::set`] refuse any larger item in either direction.

use zeroize::Zeroizing;

use crate::error::KeyProviderError;
use crate::store_layout::MAX_ITEM_LEN;

/// One secure store namespace (a service) holding named items (accounts).
///
/// Callers use [`SecretStore::get`] and [`SecretStore::set`]; implementations must not override them.
pub trait SecretStore {
    /// Raw read: the item's bytes, or `None` if the item does not exist. Any failure to reach the
    /// store is an error, never `None`.
    fn load(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, KeyProviderError>;
    /// Raw write: creates or atomically replaces the item.
    fn store(&self, account: &str, secret: &[u8]) -> Result<(), KeyProviderError>;

    /// The item's bytes, or `None` if it does not exist. An item larger than [`MAX_ITEM_LEN`] can
    /// only come from outside this boundary and is refused as `RecoveryRequired`.
    fn get(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, KeyProviderError> {
        match self.load(account)? {
            Some(item) if item.len() > MAX_ITEM_LEN => Err(KeyProviderError::RecoveryRequired),
            item => Ok(item),
        }
    }

    /// Creates or atomically replaces the item. An item larger than [`MAX_ITEM_LEN`] is refused
    /// before the store is touched.
    fn set(&self, account: &str, secret: &[u8]) -> Result<(), KeyProviderError> {
        if secret.len() > MAX_ITEM_LEN {
            return Err(KeyProviderError::AnchorConflict(
                "secure-store item exceeds the version-1 size bound",
            ));
        }
        self.store(account, secret)
    }

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
        fn load(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, KeyProviderError> {
            self.check()?;
            Ok(self.0.borrow().items.get(account).cloned())
        }

        fn store(&self, account: &str, secret: &[u8]) -> Result<(), KeyProviderError> {
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
