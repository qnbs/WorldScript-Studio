//! Gate 2 slice 1: typed logical-record identities (`docs/native/R15-SECURE-STORAGE-CONTRACT.md`
//! §5.1, §5.2, §5.2.1, §5.2.2, §5.4). Every version-1 record class is addressable only through its
//! own §5.2 template, carries exactly its §5.2.1 AAD project scope, and ciphertext sealed under one
//! identity never opens under another.

use worldscript_secure_storage::{
    canonical_aad, open, parse_envelope, seal, EnvelopeHeader, IdentityError, Key, OpenError,
    RecordClass, RecordIdentity, RecordMeta, SealTarget,
};

const SCOPE: &str = "0123456789abcdef0123456789abcdef";
const OTHER_SCOPE: &str = "fedcba9876543210fedcba9876543210";
const RECOVERY_ID: &str = "00112233445566778899aabbccddeeff";

const META: RecordMeta = RecordMeta {
    key_epoch: 1,
    record_generation: 1,
    record_schema: 1,
};

fn key() -> Key {
    Key::from_bytes(&mut [7u8; 32])
}

/// `$S` in a row stands for [`SCOPE`], `$R` for [`RECOVERY_ID`].
type Row = (
    RecordClass,
    &'static [&'static str],
    &'static str,
    Option<&'static str>,
);

/// Valid components, the expected canonical `logical_record_id`, and the expected AAD project scope
/// for every version-1 class except `record-commit`, which is built from another identity.
#[rustfmt::skip]
const REGISTRY: &[Row] = &[
    (RecordClass::Project, &["p1"], "project:p1", Some("p1")),
    (RecordClass::ProjectMetadata, &["p1"], "project:p1:metadata", Some("p1")),
    (RecordClass::Snapshot, &["1727704800000"], "snapshot:1727704800000", None),
    (RecordClass::Backup, &["b1"], "backup:b1", None),
    (RecordClass::Recovery, &["p1", "$R"], "recovery:p1:$R", Some("p1")),
    (RecordClass::Settings, &[], "settings:global", None),
    (RecordClass::Credential, &["openai"], "credential:openai", None),
    (RecordClass::Image, &["i1"], "image:i1", None),
    (RecordClass::Asset, &["p1", "a1"], "asset:p1:a1", Some("p1")),
    (RecordClass::AssetMetadata, &["p1", "a1"], "asset-metadata:p1:a1", Some("p1")),
    (RecordClass::AssetPair, &["p1", "a1"], "asset-pair:p1:a1", Some("p1")),
    (RecordClass::Codex, &["p1"], "codex:p1", Some("p1")),
    (RecordClass::RagIndex, &["p1", "1"], "rag-index:p1:1", Some("p1")),
    (RecordClass::ActiveProject, &["$S"], "active-project:$S", None),
    (RecordClass::AuthorityRoot, &["$S"], "authority-root:$S", None),
    (RecordClass::KeyEpoch, &["$S", "3"], "key-epoch:$S:3", None),
    (RecordClass::Migration, &["op1"], "migration:op1", None),
    (RecordClass::MigrationPage, &["op1", "0"], "migration-page:op1:0", None),
    (RecordClass::Diagnostic, &["$S", "2026-09-30", "c1"], "diagnostic:$S:2026-09-30:c1", None),
    (RecordClass::RecordCatalog, &["$S", "4294967295"], "record-catalog:$S:4294967295", None),
    (RecordClass::LocalFirstDoc, &["p1"], "local-first-doc:p1", Some("p1")),
    (RecordClass::AnalyticsDb, &["$S"], "analytics-db:$S", None),
    (RecordClass::CrossProjectIndex, &["p1"], "cross-project-index:p1", Some("p1")),
    (RecordClass::SceneComments, &["$S"], "scene-comments:$S", None),
    (RecordClass::SceneRevision, &["rev1"], "scene-revision:rev1", None),
    (RecordClass::PlotUi, &["$S"], "plot-ui:$S", None),
    (RecordClass::MindMapUi, &["$S"], "mind-map-ui:$S", None),
    (RecordClass::Progress, &["$S"], "progress:$S", None),
    (RecordClass::ProforgeMemory, &["p1", "e1"], "proforge-memory:p1:e1", Some("p1")),
    (RecordClass::ProforgeHistory, &["p1"], "proforge-history:p1", Some("p1")),
    (RecordClass::InferenceCache, &["$S", "k1"], "inference-cache:$S:k1", None),
    (RecordClass::Lora, &["ad1"], "lora:ad1", None),
    (RecordClass::LoraDataset, &["p1", "d1"], "lora-dataset:p1:d1", Some("p1")),
    (RecordClass::LoraRun, &["p1", "run1"], "lora-run:p1:run1", Some("p1")),
    (RecordClass::LoraMirror, &["$S"], "lora-mirror:$S", None),
    (RecordClass::Telemetry, &["$S", "c1"], "telemetry:$S:c1", None),
    (RecordClass::AiBenchmark, &["$S"], "ai-benchmark:$S", None),
    (RecordClass::WorkerDlq, &["$S", "t1"], "worker-dlq:$S:t1", None),
    (RecordClass::IdbKdfSalt, &["$S"], "idb-kdf-salt:$S", None),
    (RecordClass::IdbPassphraseSentinel, &["$S"], "idb-passphrase-sentinel:$S", None),
];

/// [`REGISTRY`] with `$S` and `$R` resolved.
fn registry() -> Vec<(RecordClass, Vec<&'static str>, String, Option<&'static str>)> {
    resolve_rows(REGISTRY)
}

/// `rows` with `$S` and `$R` resolved.
fn resolve_rows(
    rows: &[Row],
) -> Vec<(RecordClass, Vec<&'static str>, String, Option<&'static str>)> {
    let resolve = |part: &'static str| match part {
        "$S" => SCOPE,
        "$R" => RECOVERY_ID,
        _ => part,
    };
    rows.iter()
        .map(|(class, parts, id, project)| {
            let parts = parts.iter().copied().map(resolve).collect();
            let id = id.replace("$S", SCOPE).replace("$R", RECOVERY_ID);
            (*class, parts, id, *project)
        })
        .collect()
}

fn identity(class: RecordClass, components: &[&str]) -> RecordIdentity {
    RecordIdentity::new(class, components).unwrap()
}

fn seal_under(identity: &RecordIdentity) -> Vec<u8> {
    let target = SealTarget {
        context: identity.context(),
        meta: META,
    };
    seal(&key(), &target, b"payload").unwrap()
}

fn open_under(identity: &RecordIdentity, envelope: &[u8]) -> Result<Vec<u8>, OpenError> {
    open(
        &key(),
        &identity.context(),
        &parse_envelope(envelope).unwrap(),
    )
}

#[path = "gate2_identity_test/grammar.rs"]
mod grammar;
#[path = "gate2_identity_test/registry.rs"]
mod registry;
#[path = "gate2_identity_test/substitution.rs"]
mod substitution;
