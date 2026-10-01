//! Gate 2 closure: which record classes may exist as R-15 envelopes at all (§10.4.1).
//!
//! §10.4.1 is an exhaustive registry: every class has exactly one disposition, and none defaults to
//! `MIGRATE_TO_R15` merely because it is not listed elsewhere. This module mirrors it with explicit
//! lists, so a class missing from all of them has no admitted disposition and the record codec
//! refuses it, the contract's `REFUSE_AUTHORITY_SWITCH` default, rather than sealing it silently.

use crate::record_class::RecordClass;

/// How a record class relates to R-15 envelopes (§10.4.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Disposition {
    /// `MIGRATE_TO_R15`: an ordinary protected record whose destination is an R-15 envelope.
    MigrateToR15,
    /// R-15's own control-plane records (§5.3, §5.4, §10.1), created natively under the target
    /// epoch; no migration disposition applies, but they are R-15 envelopes.
    NativeControlPlane,
    /// `RETAIN_APPROVED_SEPARATE_PROTECTED_AUTHORITY`: the class keeps its own approved protection
    /// mechanism, and no R-15 ciphertext is ever created for it.
    RetainSeparateAuthority,
}

use Disposition::{MigrateToR15, NativeControlPlane, RetainSeparateAuthority};

/// §10.4.1's registry, one row per version-1 class token.
#[rustfmt::skip]
const DISPOSITIONS: &[(RecordClass, Disposition)] = &[
    // MIGRATE_TO_R15: §10.4.1's 28 class rows as 31 tokens. The plot-board/mind-map row covers two
    // tokens and the "LoRA adapters, datasets and run metadata" row three; every other row is one.
    (RecordClass::Project, MigrateToR15),
    (RecordClass::ProjectMetadata, MigrateToR15),
    (RecordClass::Snapshot, MigrateToR15),
    (RecordClass::Backup, MigrateToR15),
    (RecordClass::Recovery, MigrateToR15),
    (RecordClass::Settings, MigrateToR15),
    (RecordClass::Image, MigrateToR15),
    (RecordClass::Asset, MigrateToR15),
    (RecordClass::AssetMetadata, MigrateToR15),
    (RecordClass::Codex, MigrateToR15),
    (RecordClass::RagIndex, MigrateToR15),
    (RecordClass::WorkerDlq, MigrateToR15),
    (RecordClass::ActiveProject, MigrateToR15),
    (RecordClass::Diagnostic, MigrateToR15),
    (RecordClass::LocalFirstDoc, MigrateToR15),
    (RecordClass::AnalyticsDb, MigrateToR15),
    (RecordClass::CrossProjectIndex, MigrateToR15),
    (RecordClass::SceneComments, MigrateToR15),
    (RecordClass::SceneRevision, MigrateToR15),
    (RecordClass::PlotUi, MigrateToR15),
    (RecordClass::MindMapUi, MigrateToR15),
    (RecordClass::Progress, MigrateToR15),
    (RecordClass::ProforgeMemory, MigrateToR15),
    (RecordClass::ProforgeHistory, MigrateToR15),
    (RecordClass::InferenceCache, MigrateToR15),
    (RecordClass::Lora, MigrateToR15),
    (RecordClass::LoraDataset, MigrateToR15),
    (RecordClass::LoraRun, MigrateToR15),
    (RecordClass::LoraMirror, MigrateToR15),
    (RecordClass::Telemetry, MigrateToR15),
    (RecordClass::AiBenchmark, MigrateToR15),
    // Native control plane: §10.4.1's 5 class rows as 7 tokens. The manifest-and-catalog,
    // commit-marker (`record-commit` plus the `asset-pair` marker) and migration-journal rows cover
    // two tokens each, key epochs one, and migration staging none (it is never a record identity).
    (RecordClass::AuthorityRoot, NativeControlPlane),
    (RecordClass::RecordCatalog, NativeControlPlane),
    (RecordClass::KeyEpoch, NativeControlPlane),
    (RecordClass::RecordCommit, NativeControlPlane),
    (RecordClass::AssetPair, NativeControlPlane),
    (RecordClass::Migration, NativeControlPlane),
    (RecordClass::MigrationPage, NativeControlPlane),
    // RETAIN_APPROVED_SEPARATE_PROTECTED_AUTHORITY.
    (RecordClass::Credential, RetainSeparateAuthority),
    (RecordClass::IdbKdfSalt, RetainSeparateAuthority),
    (RecordClass::IdbPassphraseSentinel, RetainSeparateAuthority),
];

/// The §10.4.1 disposition of `class`, or `None` when it has none admitted.
pub fn disposition(class: RecordClass) -> Option<Disposition> {
    DISPOSITIONS
        .iter()
        .find(|(registered, _)| *registered == class)
        .map(|(_, disposition)| *disposition)
}

/// Whether records of `class` may be sealed or opened as R-15 envelopes: only `MIGRATE_TO_R15` and
/// native control-plane classes. A retained separate authority, or a class without an admitted
/// disposition, never yields R-15 ciphertext.
pub fn is_r15_record_class(class: RecordClass) -> bool {
    matches!(disposition(class), Some(MigrateToR15 | NativeControlPlane))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_class_has_exactly_one_disposition() {
        for class in RecordClass::ALL {
            let rows = DISPOSITIONS
                .iter()
                .filter(|(registered, _)| registered == class)
                .count();
            assert_eq!(rows, 1, "{class:?}");
        }
        assert_eq!(DISPOSITIONS.len(), RecordClass::ALL.len());
    }

    #[test]
    fn the_registry_matches_the_contract_counts() {
        let count = |wanted: Disposition| {
            DISPOSITIONS
                .iter()
                .filter(|(_, disposition)| *disposition == wanted)
                .count()
        };
        assert_eq!(count(MigrateToR15), 31);
        assert_eq!(count(NativeControlPlane), 7);
        assert_eq!(count(RetainSeparateAuthority), 3);
    }
}
