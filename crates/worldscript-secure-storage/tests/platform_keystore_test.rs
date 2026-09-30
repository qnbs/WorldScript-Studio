//! Gate 1b-platform slice D evidence against the real OS secure store (macOS Keychain, Windows
//! Credential Manager, Linux Secret Service). Ignored by default so ordinary test runs never touch a
//! developer's keychain; the evidence job runs it with `--ignored` under a unique random service
//! name and removes every item it created.
#![cfg(feature = "platform-keystore")]

use std::cell::RefCell;
use std::rc::Rc;
use worldscript_secure_storage::secure_store::{PlatformSecretStore, SecretStore};

use worldscript_secure_storage::store_layout::{
    key_account, route_from_bits, ANCHOR_ACCOUNT, EPOCH_INDEX_ACCOUNT,
};
use worldscript_secure_storage::{
    open, parse_envelope, seal, InstallationScopeId, KeyProvider, KeyProviderError, KeyState,
    OsRandom, PrepareRootAnchor, RandomSource, RandomnessUnavailable, RecordClass, RecordContext,
    RecordMeta, RootKeyRefV1, RootSlot, SealTarget, SecureStoreAuthority, SecureStoreRuntime,
};

type PlatformProvider = SecureStoreRuntime<PlatformSecretStore, RecordingRandom>;

/// The OS CSPRNG, recording every 16-byte draw: a route is drawn as 16 random bytes, so the draws
/// name every key item a provisioning call may have written, even one whose index write failed.
#[derive(Clone, Default)]
struct RecordingRandom(Rc<RefCell<Vec<[u8; 16]>>>);

impl RandomSource for RecordingRandom {
    fn fill(&mut self, bytes: &mut [u8]) -> Result<(), RandomnessUnavailable> {
        OsRandom.fill(bytes)?;
        if let Ok(route_bits) = <[u8; 16]>::try_from(&*bytes) {
            self.0.borrow_mut().push(route_bits);
        }
        Ok(())
    }
}

/// One evidence run: a random, never-production service and the record of every route drawn in it.
struct Evidence {
    service: String,
    draws: RecordingRandom,
}

impl Evidence {
    fn new() -> Self {
        let mut bits = [0u8; 8];
        OsRandom.fill(&mut bits).unwrap();
        let suffix: String = bits.iter().map(|b| format!("{b:02x}")).collect();
        Evidence {
            service: format!("worldscript-r15-evidence-{suffix}"),
            draws: RecordingRandom::default(),
        }
    }

    fn store(&self) -> PlatformSecretStore {
        PlatformSecretStore::with_service(&self.service).unwrap()
    }

    fn provider(&self) -> PlatformProvider {
        SecureStoreRuntime::new(SecureStoreAuthority::with_random(
            self.store(),
            self.draws.clone(),
        ))
    }

    /// Every item this run may have created: the anchor, the index, and a key item per drawn route.
    fn candidate_accounts(&self) -> Vec<String> {
        let mut accounts = vec![ANCHOR_ACCOUNT.to_owned(), EPOCH_INDEX_ACCOUNT.to_owned()];
        for bits in self.draws.0.borrow().iter() {
            if let Ok(route) = route_from_bits(*bits) {
                accounts.push(key_account(&route));
            }
        }
        accounts
    }

    /// Attempts every deletion even if one fails, then verifies nothing is left.
    fn clean_up(&self) -> Result<(), String> {
        let store = self.store();
        let accounts = self.candidate_accounts();
        let failures: Vec<String> = accounts
            .iter()
            .filter_map(|account| {
                store
                    .delete(account)
                    .err()
                    .map(|error| format!("{account}: {error:?}"))
            })
            .collect();
        let left: Vec<&String> = accounts
            .iter()
            .filter(|account| !matches!(store.get(account), Ok(None)))
            .collect();
        if failures.is_empty() && left.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "cleanup failed: {failures:?}; left behind: {left:?}"
            ))
        }
    }

    /// Runs `body` so that cleanup always follows, before any mutating store call.
    fn run(&self, body: impl FnOnce(&Evidence)) {
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| body(self)));
        let cleaned = self.clean_up();
        if let Err(panic) = outcome {
            std::panic::resume_unwind(panic);
        }
        cleaned.unwrap();
    }
}

fn target() -> SealTarget<'static> {
    SealTarget {
        context: RecordContext {
            record_class: RecordClass::Settings,
            logical_record_id: "settings:global",
            project_id: None,
        },
        meta: RecordMeta {
            key_epoch: 1,
            record_generation: 1,
            record_schema: 1,
        },
    }
}

/// Bootstraps the first root through the session and returns an envelope sealed under its key.
fn bootstrap_and_seal(provider: &mut PlatformProvider, route: &RootKeyRefV1) -> Vec<u8> {
    assert_eq!(provider.unlock(), Ok(KeyState::Unconfigured));
    let prepare = PrepareRootAnchor {
        operation_id: "evidence-boot".into(),
        expected_floor: 0,
        target_root_generation: 1,
        target_final_root_digest: [5; 32],
        target_slot: RootSlot::A,
        target_root_key_ref: route.clone(),
    };
    provider.prepare_root_anchor(&prepare).unwrap();
    assert_eq!(provider.state(), Ok(KeyState::Unconfigured));
    provider.commit_root_anchor("evidence-boot", 1).unwrap();
    // The session's own step F rebinds it to the new root without a second unlock.
    assert_eq!(provider.state(), Ok(KeyState::Unlocked { epoch: 1 }));
    seal(
        &provider.resolve_ref(route).unwrap(),
        &target(),
        b"evidence",
    )
    .unwrap()
}

/// A fresh provider on the same service must read everything back from the OS store.
fn verify_after_restart(evidence: &Evidence, scope: &InstallationScopeId, envelope: &[u8]) {
    let mut restarted = evidence.provider();
    assert_eq!(restarted.state(), Ok(KeyState::Locked));
    assert_eq!(
        &restarted.read_or_provision_installation_scope().unwrap(),
        scope
    );
    let anchor = restarted.read_root_anchor_state().unwrap();
    assert_eq!(anchor.committed_floor, 1);
    assert_eq!(
        anchor.last_committed_operation_id.as_deref(),
        Some("evidence-boot")
    );
    assert_eq!(restarted.unlock(), Ok(KeyState::Unlocked { epoch: 1 }));
    let parsed = parse_envelope(envelope).unwrap();
    let opened = open(&restarted.resolve(1).unwrap(), &target().context, &parsed).unwrap();
    assert_eq!(opened, b"evidence");
    restarted.lock();
    assert_eq!(restarted.resolve(1).err(), Some(KeyProviderError::Locked));
}

/// The sealed boundary refuses an oversized item before the OS store is touched.
fn verify_item_bound(store: &PlatformSecretStore) {
    assert!(matches!(
        store.set(ANCHOR_ACCOUNT, &[0u8; 2561]),
        Err(KeyProviderError::AnchorConflict(_))
    ));
    assert!(store.get(ANCHOR_ACCOUNT).unwrap().is_some());
}

#[test]
fn the_production_service_is_never_an_evidence_service() {
    assert!(PlatformSecretStore::with_service("worldscript-r15").is_err());
    assert!(PlatformSecretStore::with_service("").is_err());
}

#[test]
#[ignore = "touches the real OS secure store; run by the platform evidence job with --ignored"]
fn full_lifecycle_against_the_real_os_secure_store() {
    Evidence::new().run(|evidence| {
        let mut first = evidence.provider();
        assert_eq!(first.state(), Ok(KeyState::Unconfigured));
        let scope = first.read_or_provision_installation_scope().unwrap();
        let route = first.provision_epoch_key(1).unwrap();
        let envelope = bootstrap_and_seal(&mut first, &route);
        verify_after_restart(evidence, &scope, &envelope);
        verify_item_bound(&evidence.store());
    });
}

/// Run only where the job has deliberately provided NO secure store (a session bus without a
/// Secret Service): protected mode must be refused, never replaced by a weaker store.
#[test]
#[ignore = "run by the platform evidence job in an environment without a secure store"]
fn a_missing_secure_store_is_secure_anchor_unavailable() {
    if std::env::var("WSS_EXPECT_NO_SECURE_STORE").as_deref() != Ok("1") {
        eprintln!("skipped: WSS_EXPECT_NO_SECURE_STORE=1 not set");
        return;
    }
    let mut provider = Evidence::new().provider();
    let unavailable = KeyProviderError::SecureAnchorUnavailable;
    assert_eq!(provider.state().map(|_| ()), Err(unavailable));
    assert_eq!(
        provider.read_or_provision_installation_scope().map(|_| ()),
        Err(unavailable)
    );
    assert_eq!(
        provider.provision_epoch_key(1).map(|_| ()),
        Err(unavailable)
    );
    assert_eq!(provider.unlock().map(|_| ()), Err(unavailable));
}
