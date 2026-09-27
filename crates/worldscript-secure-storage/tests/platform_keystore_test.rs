//! Gate 1b-platform evidence against the real OS secure store (macOS Keychain, Windows Credential
//! Manager, Linux Secret Service). Ignored by default so ordinary test runs never touch a
//! developer's keychain; the evidence job runs it with `--ignored` under a unique random service
//! name and removes every item it created.
#![cfg(feature = "platform-keystore")]

use worldscript_secure_storage::platform_store::PlatformSecretStore;
use worldscript_secure_storage::secure_store::SecretStore;
use worldscript_secure_storage::store_provider::{
    SecureStoreKeyProvider, ANCHOR_ACCOUNT, EPOCH_INDEX_ACCOUNT,
};
use worldscript_secure_storage::{
    open, parse_envelope, seal, KeyProvider, KeyState, OsRandom, PrepareRootAnchor, RandomSource,
    RecordClass, RecordContext, RecordMeta, RootSlot, SealTarget,
};

fn evidence_service() -> String {
    let mut bits = [0u8; 8];
    OsRandom.fill(&mut bits).unwrap();
    let suffix: String = bits.iter().map(|b| format!("{b:02x}")).collect();
    format!("worldscript-r15-evidence-{suffix}")
}

fn remove_all(service: &str, key_accounts: &[String]) {
    let store = PlatformSecretStore::with_service(service).unwrap();
    for account in [ANCHOR_ACCOUNT, EPOCH_INDEX_ACCOUNT]
        .iter()
        .map(|a| a.to_string())
        .chain(key_accounts.iter().cloned())
    {
        store.delete(&account).unwrap();
    }
}

#[test]
#[ignore = "touches the real OS secure store; run by the platform evidence job with --ignored"]
fn full_lifecycle_against_the_real_os_secure_store() {
    let service = evidence_service();
    let mut provider =
        SecureStoreKeyProvider::new(PlatformSecretStore::with_service(&service).unwrap());
    assert_eq!(provider.state(), Ok(KeyState::Unconfigured));
    let scope = provider.read_or_provision_installation_scope().unwrap();
    let route = provider.provision_epoch_key(1).unwrap();
    let key_account = format!(
        "r15-key-{}",
        route
            .as_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );

    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        provider
            .prepare_root_anchor(&PrepareRootAnchor {
                operation_id: "evidence-boot".into(),
                expected_floor: 0,
                target_root_generation: 1,
                target_final_root_digest: [5; 32],
                target_slot: RootSlot::A,
                target_root_key_ref: route.clone(),
            })
            .unwrap();
        assert_eq!(
            provider.state(),
            Ok(KeyState::Unconfigured),
            "prepared is not committed"
        );
        provider.commit_root_anchor("evidence-boot", 1).unwrap();

        let target = SealTarget {
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
        };
        provider.unlock().unwrap();
        let envelope = seal(&provider.resolve_ref(&route).unwrap(), &target, b"evidence").unwrap();

        // A fresh provider on the same service reads everything back from the OS store.
        let mut restarted =
            SecureStoreKeyProvider::new(PlatformSecretStore::with_service(&service).unwrap());
        assert_eq!(restarted.state(), Ok(KeyState::Locked));
        assert_eq!(
            restarted.read_or_provision_installation_scope().unwrap(),
            scope
        );
        let anchor = restarted.read_root_anchor_state().unwrap();
        assert_eq!(anchor.committed_floor, 1);
        assert_eq!(
            anchor.last_committed_operation_id.as_deref(),
            Some("evidence-boot")
        );
        assert_eq!(restarted.unlock(), Ok(KeyState::Unlocked { epoch: 1 }));
        let parsed = parse_envelope(&envelope).unwrap();
        assert_eq!(
            open(&restarted.resolve(1).unwrap(), &target.context, &parsed).unwrap(),
            b"evidence"
        );
        restarted.lock();
        assert_eq!(restarted.runtime_key_count(), 0);
    }));
    remove_all(&service, std::slice::from_ref(&key_account));
    let store = PlatformSecretStore::with_service(&service).unwrap();
    assert!(
        store.get(ANCHOR_ACCOUNT).unwrap().is_none(),
        "cleanup left the anchor behind"
    );
    assert!(
        store.get(&key_account).unwrap().is_none(),
        "cleanup left the key behind"
    );
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

/// Run only where the job has deliberately provided NO secure store (e.g. a session bus without a
/// Secret Service): protected mode must be refused, never replaced by a weaker store.
#[test]
#[ignore = "run by the platform evidence job in an environment without a secure store"]
fn a_missing_secure_store_is_secure_anchor_unavailable() {
    if std::env::var("WSS_EXPECT_NO_SECURE_STORE").as_deref() != Ok("1") {
        eprintln!("skipped: WSS_EXPECT_NO_SECURE_STORE=1 not set");
        return;
    }
    let mut provider = SecureStoreKeyProvider::new(
        PlatformSecretStore::with_service(&evidence_service()).unwrap(),
    );
    let unavailable = worldscript_secure_storage::KeyProviderError::SecureAnchorUnavailable;
    assert_eq!(provider.state().map(|_| ()), Err(unavailable));
    let scope = provider.read_or_provision_installation_scope().map(|_| ());
    assert_eq!(scope, Err(unavailable));
    assert_eq!(
        provider.provision_epoch_key(1).map(|_| ()),
        Err(unavailable)
    );
}
