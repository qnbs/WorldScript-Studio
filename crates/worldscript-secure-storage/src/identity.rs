//! Gate 2: typed logical-record identities (§5.1, §5.2, §5.2.1, §5.2.2, §5.4).
//!
//! Every version-1 record class has exactly one identity template. A [`RecordIdentity`] can only be
//! built from that template's components, so its canonical `logical_record_id` and its AAD
//! `project_id` always follow the class's registered grammar and scope rule. There is no path,
//! title, renderer or locale input anywhere: those are never identity (§5.1). A malformed component
//! is refused, never normalized, and no owner is ever guessed.
//!
//! Existing IDs are unrestricted strings that may contain the `:` join delimiter (§15.1), so a
//! project ID or a preserved record ID keeps its exact spelling, delimiter included. The identity
//! stays unambiguous because it is the whole (`record_class`, `logical_record_id`, `project_id`)
//! triple that the AAD binds (§6.2), never the joined string alone: the project component is carried
//! as its own `project_id` field and never split out of `logical_record_id`, and every template has
//! at most one other delimiter-bearing component; all remaining components have a delimiter-free
//! grammar.

use crate::aad::RecordContext;
use crate::anchor::MAX_OPERATION_ID_LEN;
use crate::disposition::{disposition, Disposition};
use crate::provider::InstallationScopeId;
use crate::record_class::RecordClass;

/// Why a logical identity could not be built.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityError {
    /// The class's template needs a different number of components.
    WrongArity,
    /// A component is empty.
    EmptyComponent,
    /// A Core-assigned token contains the `:` separator. Only templates with two such tokens use
    /// this grammar, where a delimiter would make the joined identity ambiguous.
    SeparatorInComponent,
    /// A component contains a control character.
    ControlCharacter,
    /// A decimal component is not the canonical §5.4 spelling of an in-range value.
    NonCanonicalDecimal,
    /// A key epoch is the unassigned `0` or the terminal `u64::MAX`.
    UnassignedEpoch,
    /// An installation-scope component is not a canonical `InstallationScopeId` (§5.2.2).
    MalformedInstallationScope,
    /// A recovery ID is not the canonical Core-assigned form (§3: the `InstallationScopeId`
    /// construction), e.g. one derived from a quarantine directory name.
    MalformedRecoveryId,
    /// A migration `operation_id` exceeds the §6.1.2 bound the journal parsers enforce.
    OperationIdTooLong,
    /// A RAG `index-version` is not one the current persisted format admits (§5.2: every existing
    /// index is the fixed constant `1`).
    UnsupportedIndexVersion,
    /// `record-commit` identities are built only from another identity, never directly.
    NotBuildableDirectly,
    /// The record is not governed by an ordinary `record-commit` marker: it is a marker itself
    /// (`record-commit`, `asset-pair`), a member committed by its `asset-pair` marker (§8.4), a
    /// control record anchored by the authority root (§5.3, §10.1), or a class that keeps a
    /// separate approved authority and never becomes an R-15 record (§10.4.1).
    NoOrdinaryMarker,
}

/// One component of a class's identity template.
#[derive(Clone, Copy)]
enum Part {
    /// A fixed literal segment.
    Literal(&'static str),
    /// The owning project's exact existing ID, delimiter included; it is also the record's AAD
    /// `project_id` (§5.2.1).
    Project,
    /// The `InstallationScopeId` (§5.2.2).
    Scope,
    /// A canonical `uint32` decimal (§5.4).
    Decimal32,
    /// A canonical `u64` decimal: the preserved snapshot namespace, whose current IDs are
    /// millisecond timestamps (§5.4).
    Decimal64,
    /// A Core-assigned recovery ID (§3).
    RecoveryId,
    /// A migration `operation_id` (§6.1.2).
    OperationId,
    /// A canonical, assigned `u64` key epoch.
    Epoch,
    /// A RAG `index-version` from [`ADMITTED_RAG_INDEX_VERSIONS`].
    RagIndexVersion,
    /// A Core-assigned token that never contains `:`; used where a template has two free components.
    Token,
    /// Any other registered ID component: an existing ID, preserved exactly, delimiter included.
    Opaque,
}

use Part::{
    Decimal32, Decimal64, Epoch, Literal, Opaque, OperationId, Project, RagIndexVersion,
    RecoveryId, Scope, Token,
};

/// The RAG index versions the current persisted format admits (§5.2). A new version is added here
/// only together with the format and migration path that read it.
const ADMITTED_RAG_INDEX_VERSIONS: &[&str] = &["1"];

/// The §5.2 template of every version-1 class except `record-commit`, which has none because its
/// identity embeds another record's identity ([`RecordIdentity::commit_marker`]): the class, its
/// leading segment and the components after it. Each class appears exactly once (unit-tested).
#[rustfmt::skip]
const TEMPLATES: &[(RecordClass, &str, &[Part])] = &[
    (RecordClass::Project, "project", &[Project]),
    (RecordClass::ProjectMetadata, "project", &[Project, Literal("metadata")]),
    (RecordClass::Snapshot, "snapshot", &[Decimal64]),
    (RecordClass::Backup, "backup", &[Opaque]),
    (RecordClass::Recovery, "recovery", &[Project, RecoveryId]),
    // Version 1 has exactly one settings profile scope (§5.2.2).
    (RecordClass::Settings, "settings", &[Literal("global")]),
    (RecordClass::Credential, "credential", &[Opaque]),
    (RecordClass::Image, "image", &[Opaque]),
    (RecordClass::Asset, "asset", &[Project, Opaque]),
    (RecordClass::AssetMetadata, "asset-metadata", &[Project, Opaque]),
    (RecordClass::AssetPair, "asset-pair", &[Project, Opaque]),
    (RecordClass::Codex, "codex", &[Project]),
    (RecordClass::RagIndex, "rag-index", &[Project, RagIndexVersion]),
    (RecordClass::ActiveProject, "active-project", &[Scope]),
    (RecordClass::AuthorityRoot, "authority-root", &[Scope]),
    (RecordClass::KeyEpoch, "key-epoch", &[Scope, Epoch]),
    (RecordClass::Migration, "migration", &[OperationId]),
    (RecordClass::MigrationPage, "migration-page", &[OperationId, Decimal32]),
    (RecordClass::Diagnostic, "diagnostic", &[Scope, Token, Token]),
    (RecordClass::RecordCatalog, "record-catalog", &[Scope, Decimal32]),
    (RecordClass::LocalFirstDoc, "local-first-doc", &[Project]),
    (RecordClass::AnalyticsDb, "analytics-db", &[Scope]),
    (RecordClass::CrossProjectIndex, "cross-project-index", &[Project]),
    (RecordClass::SceneComments, "scene-comments", &[Scope]),
    (RecordClass::SceneRevision, "scene-revision", &[Opaque]),
    (RecordClass::PlotUi, "plot-ui", &[Scope]),
    (RecordClass::MindMapUi, "mind-map-ui", &[Scope]),
    (RecordClass::Progress, "progress", &[Scope]),
    (RecordClass::ProforgeMemory, "proforge-memory", &[Project, Opaque]),
    (RecordClass::ProforgeHistory, "proforge-history", &[Project]),
    (RecordClass::InferenceCache, "inference-cache", &[Scope, Opaque]),
    (RecordClass::Lora, "lora", &[Opaque]),
    (RecordClass::LoraDataset, "lora-dataset", &[Project, Opaque]),
    (RecordClass::LoraRun, "lora-run", &[Project, Opaque]),
    (RecordClass::LoraMirror, "lora-mirror", &[Scope]),
    (RecordClass::Telemetry, "telemetry", &[Scope, Opaque]),
    (RecordClass::AiBenchmark, "ai-benchmark", &[Scope]),
    (RecordClass::WorkerDlq, "worker-dlq", &[Scope, Opaque]),
    (RecordClass::IdbKdfSalt, "idb-kdf-salt", &[Scope]),
    (RecordClass::IdbPassphraseSentinel, "idb-passphrase-sentinel", &[Scope]),
];

/// The §5.2 template of `class`, or `None` for `record-commit`.
fn template(class: RecordClass) -> Option<(&'static str, &'static [Part])> {
    TEMPLATES
        .iter()
        .find(|(registered, _, _)| *registered == class)
        .map(|(_, prefix, parts)| (*prefix, *parts))
}

/// A registered logical identity: record class, canonical `logical_record_id` and the AAD project
/// scope the class requires. `Debug` shows only the class and lengths (§14).
#[derive(Clone, PartialEq, Eq)]
pub struct RecordIdentity {
    class: RecordClass,
    logical_record_id: String,
    project_id: Option<String>,
    /// The exact template components it was built from (literals excluded), so related identities
    /// (asset pairs, §8.4) and catalog descriptors (§5.5.1) are rebuilt structurally and never by
    /// parsing `logical_record_id`. Empty only for a `record-commit` marker, which has no template.
    components: Vec<String>,
}

impl std::fmt::Debug for RecordIdentity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RecordIdentity")
            .field("class", &self.class)
            .field("logical_record_id_len", &self.logical_record_id.len())
            .field("project_id_len", &self.project_id.as_ref().map(String::len))
            .finish()
    }
}

impl RecordIdentity {
    /// Builds the identity of `class` from its template's components, in order (literal segments
    /// are not passed). The project component, where the template has one, is also the AAD
    /// `project_id`; every other class carries none.
    pub fn new(class: RecordClass, components: &[&str]) -> Result<Self, IdentityError> {
        let (prefix, parts) = template(class).ok_or(IdentityError::NotBuildableDirectly)?;
        // Validate the whole template against borrowed input first; owned strings are built only once
        // every component and the arity have been checked, sized by the template, never by the slice.
        let mut values = components.iter();
        let mut segments: Vec<&str> = Vec::with_capacity(parts.len());
        let mut kept: Vec<&str> = Vec::with_capacity(parts.len());
        let mut project: Option<&str> = None;
        for part in parts {
            if let Literal(literal) = part {
                segments.push(literal);
                continue;
            }
            let value: &str = values.next().ok_or(IdentityError::WrongArity)?;
            check_component(*part, value)?;
            if matches!(part, Project) {
                project = Some(value);
            }
            kept.push(value);
            segments.push(value);
        }
        if values.next().is_some() {
            return Err(IdentityError::WrongArity);
        }
        let mut logical_record_id = prefix.to_owned();
        for segment in segments {
            logical_record_id.push(':');
            logical_record_id.push_str(segment);
        }
        Ok(RecordIdentity {
            class,
            logical_record_id,
            project_id: project.map(str::to_owned),
            components: kept.into_iter().map(str::to_owned).collect(),
        })
    }

    /// The `record-commit:<record-class>:<logical-record-id>` marker for `record`, in the same
    /// scope as the record it tracks (§5.2.1). Only ordinary records have one: markers, asset-pair
    /// members and control records are refused, so the authority root stays a finite base case.
    pub fn commit_marker(record: &RecordIdentity) -> Result<Self, IdentityError> {
        if !has_ordinary_marker(record.class) {
            return Err(IdentityError::NoOrdinaryMarker);
        }
        Ok(RecordIdentity {
            class: RecordClass::RecordCommit,
            logical_record_id: format!(
                "record-commit:{}:{}",
                record.class.token(),
                record.logical_record_id
            ),
            project_id: record.project_id.clone(),
            components: Vec::new(),
        })
    }

    /// The two fixed members (`asset`, `asset-metadata`) of this `asset-pair` marker (§8.4): the same
    /// project and asset components with only the record class substituted, built through the same
    /// templates as any other identity. `None` for every other class.
    pub fn asset_pair_members(&self) -> Option<(RecordIdentity, RecordIdentity)> {
        if self.class != RecordClass::AssetPair {
            return None;
        }
        Some((
            self.with_class(RecordClass::Asset)?,
            self.with_class(RecordClass::AssetMetadata)?,
        ))
    }

    /// The `asset-pair` marker that commits this `asset` or `asset-metadata` member (§8.4); `None`
    /// for every other class.
    pub fn asset_pair_marker(&self) -> Option<RecordIdentity> {
        if matches!(self.class, RecordClass::Asset | RecordClass::AssetMetadata) {
            self.with_class(RecordClass::AssetPair)
        } else {
            None
        }
    }

    /// This identity's components under another class with the same template shape, re-validated.
    fn with_class(&self, class: RecordClass) -> Option<RecordIdentity> {
        let components: Vec<&str> = self.components.iter().map(String::as_str).collect();
        RecordIdentity::new(class, &components).ok()
    }

    /// The template components this identity was built from, in order (literals excluded).
    pub(crate) fn components(&self) -> &[String] {
        &self.components
    }

    pub fn class(&self) -> RecordClass {
        self.class
    }

    pub fn logical_record_id(&self) -> &str {
        &self.logical_record_id
    }

    pub fn project_id(&self) -> Option<&str> {
        self.project_id.as_deref()
    }

    /// The AAD context this identity authenticates (§6.2).
    pub fn context(&self) -> RecordContext<'_> {
        RecordContext {
            record_class: self.class,
            logical_record_id: &self.logical_record_id,
            project_id: self.project_id.as_deref(),
        }
    }
}

/// Whether `class` is committed through its own `record-commit` marker (an ordinary record).
pub(crate) fn has_ordinary_marker(class: RecordClass) -> bool {
    // Only `MIGRATE_TO_R15` records (§10.4.1) are ordinary records, and an asset-pair member is
    // committed by its pair marker instead (§8.4). Control-plane records are anchored by the
    // authority root, and retained-authority classes have no R-15 record to commit at all.
    disposition(class) == Some(Disposition::MigrateToR15)
        && !matches!(class, RecordClass::Asset | RecordClass::AssetMetadata)
}

fn check_component(part: Part, value: &str) -> Result<(), IdentityError> {
    if value.is_empty() {
        return Err(IdentityError::EmptyComponent);
    }
    if value.chars().any(char::is_control) {
        return Err(IdentityError::ControlCharacter);
    }
    match part {
        Token if value.contains(':') => Err(IdentityError::SeparatorInComponent),
        Scope => InstallationScopeId::parse(value)
            .map(|_| ())
            .map_err(|_| IdentityError::MalformedInstallationScope),
        RecoveryId => InstallationScopeId::parse(value)
            .map(|_| ())
            .map_err(|_| IdentityError::MalformedRecoveryId),
        OperationId if value.len() > MAX_OPERATION_ID_LEN => Err(IdentityError::OperationIdTooLong),
        Decimal64 => canonical_decimal(value)
            .map(|_| ())
            .ok_or(IdentityError::NonCanonicalDecimal),
        Decimal32 => canonical_decimal(value)
            .filter(|number| *number <= u64::from(u32::MAX))
            .map(|_| ())
            .ok_or(IdentityError::NonCanonicalDecimal),
        Epoch => match canonical_decimal(value) {
            Some(0) | Some(u64::MAX) => Err(IdentityError::UnassignedEpoch),
            Some(_) => Ok(()),
            None => Err(IdentityError::NonCanonicalDecimal),
        },
        RagIndexVersion if !ADMITTED_RAG_INDEX_VERSIONS.contains(&value) => {
            Err(IdentityError::UnsupportedIndexVersion)
        }
        Literal(_) | Project | Opaque | OperationId | RagIndexVersion | Token => Ok(()),
    }
}

/// The value of a canonical ASCII base-10 spelling (§5.4): no sign, no leading zero except `"0"`,
/// and it must fit a `u64`; any other spelling is `None`.
fn canonical_decimal(value: &str) -> Option<u64> {
    let canonical =
        value.bytes().all(|b| b.is_ascii_digit()) && (value == "0" || !value.starts_with('0'));
    if !canonical {
        return None;
    }
    value.parse::<u64>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The injectivity argument in the module docs: besides the project component, which the AAD
    /// binds as its own field, no template has more than one component whose grammar admits `:`.
    #[test]
    fn every_class_except_record_commit_has_exactly_one_template() {
        for class in RecordClass::ALL {
            let count = TEMPLATES
                .iter()
                .filter(|(registered, _, _)| registered == class)
                .count();
            let expected = usize::from(*class != RecordClass::RecordCommit);
            assert_eq!(count, expected, "{class:?}");
        }
        assert_eq!(TEMPLATES.len(), RecordClass::ALL.len() - 1);
    }

    #[test]
    fn every_template_has_at_most_one_delimiter_bearing_component_besides_the_project() {
        for class in RecordClass::ALL {
            let Some((_, parts)) = template(*class) else {
                continue;
            };
            let delimiter_bearing = parts
                .iter()
                .filter(|part| matches!(part, Opaque | OperationId))
                .count();
            assert!(delimiter_bearing <= 1, "{class:?}");
        }
    }
}
