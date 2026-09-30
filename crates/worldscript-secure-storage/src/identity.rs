//! Gate 2: typed logical-record identities (§5.1, §5.2, §5.2.1, §5.2.2, §5.4).
//!
//! Every version-1 record class has exactly one identity template. A [`RecordIdentity`] can only be
//! built from that template's components, so its canonical `logical_record_id` and its AAD
//! `project_id` always follow the class's registered grammar and scope rule. There is no path,
//! title, renderer or locale input anywhere: those are never identity (§5.1). A malformed component
//! is refused, never normalized, and no owner is ever guessed.

use crate::aad::RecordContext;
use crate::provider::InstallationScopeId;
use crate::record_class::RecordClass;

/// Why a logical identity could not be built.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityError {
    /// The class's template needs a different number of components.
    WrongArity,
    /// A component is empty.
    EmptyComponent,
    /// A component contains the `:` separator, which would make the identity ambiguous.
    SeparatorInComponent,
    /// A component contains a control character.
    ControlCharacter,
    /// A decimal component is not the canonical §5.4 spelling of an in-range value.
    NonCanonicalDecimal,
    /// A key epoch is the unassigned `0` or the terminal `u64::MAX`.
    UnassignedEpoch,
    /// An installation-scope component is not a canonical `InstallationScopeId` (§5.2.2).
    MalformedInstallationScope,
    /// `record-commit` identities are built only from another identity, never nested.
    NotBuildableDirectly,
}

/// One component of a class's identity template.
#[derive(Clone, Copy)]
enum Part {
    /// A fixed literal segment.
    Literal(&'static str),
    /// The owning project's ID; it is also the record's AAD `project_id` (§5.2.1).
    Project,
    /// The `InstallationScopeId` (§5.2.2).
    Scope,
    /// A canonical `uint32` decimal (§5.4).
    Decimal32,
    /// A canonical, assigned `u64` key epoch.
    Epoch,
    /// Any other registered ID component.
    Opaque,
}

use Part::{Decimal32, Epoch, Literal, Opaque, Project, Scope};

/// The §5.2 template of `class`: its leading segment and the components after it. `record-commit`
/// has none, because its identity embeds another record's identity ([`RecordIdentity::commit_marker`]).
fn template(class: RecordClass) -> Option<(&'static str, &'static [Part])> {
    Some(match class {
        RecordClass::Project => ("project", &[Project]),
        RecordClass::ProjectMetadata => ("project", &[Project, Literal("metadata")]),
        RecordClass::Snapshot => ("snapshot", &[Decimal32]),
        RecordClass::Backup => ("backup", &[Opaque]),
        RecordClass::Recovery => ("recovery", &[Project, Opaque]),
        RecordClass::Settings => ("settings", &[Opaque]),
        RecordClass::Credential => ("credential", &[Opaque]),
        RecordClass::Image => ("image", &[Opaque]),
        RecordClass::Asset => ("asset", &[Project, Opaque]),
        RecordClass::AssetMetadata => ("asset-metadata", &[Project, Opaque]),
        RecordClass::AssetPair => ("asset-pair", &[Project, Opaque]),
        RecordClass::Codex => ("codex", &[Project]),
        RecordClass::RagIndex => ("rag-index", &[Project, Opaque]),
        RecordClass::ActiveProject => ("active-project", &[Scope]),
        RecordClass::AuthorityRoot => ("authority-root", &[Scope]),
        RecordClass::KeyEpoch => ("key-epoch", &[Scope, Epoch]),
        RecordClass::RecordCommit => return None,
        RecordClass::Migration => ("migration", &[Opaque]),
        RecordClass::MigrationPage => ("migration-page", &[Opaque, Decimal32]),
        RecordClass::Diagnostic => ("diagnostic", &[Scope, Opaque, Opaque]),
        RecordClass::RecordCatalog => ("record-catalog", &[Scope, Decimal32]),
        RecordClass::LocalFirstDoc => ("local-first-doc", &[Project]),
        RecordClass::AnalyticsDb => ("analytics-db", &[Scope]),
        RecordClass::CrossProjectIndex => ("cross-project-index", &[Project]),
        RecordClass::SceneComments => ("scene-comments", &[Scope]),
        RecordClass::SceneRevision => ("scene-revision", &[Opaque]),
        RecordClass::PlotUi => ("plot-ui", &[Scope]),
        RecordClass::MindMapUi => ("mind-map-ui", &[Scope]),
        RecordClass::Progress => ("progress", &[Scope]),
        RecordClass::ProforgeMemory => ("proforge-memory", &[Project, Opaque]),
        RecordClass::ProforgeHistory => ("proforge-history", &[Project]),
        RecordClass::InferenceCache => ("inference-cache", &[Scope, Opaque]),
        RecordClass::Lora => ("lora", &[Opaque]),
        RecordClass::LoraDataset => ("lora-dataset", &[Project, Opaque]),
        RecordClass::LoraRun => ("lora-run", &[Project, Opaque]),
        RecordClass::LoraMirror => ("lora-mirror", &[Scope]),
        RecordClass::Telemetry => ("telemetry", &[Scope, Opaque]),
        RecordClass::AiBenchmark => ("ai-benchmark", &[Scope]),
        RecordClass::WorkerDlq => ("worker-dlq", &[Scope, Opaque]),
        RecordClass::IdbKdfSalt => ("idb-kdf-salt", &[Scope]),
        RecordClass::IdbPassphraseSentinel => ("idb-passphrase-sentinel", &[Scope]),
    })
}

/// A registered logical identity: record class, canonical `logical_record_id` and the AAD project
/// scope the class requires. `Debug` shows only the class and lengths (§14).
#[derive(Clone, PartialEq, Eq)]
pub struct RecordIdentity {
    class: RecordClass,
    logical_record_id: String,
    project_id: Option<String>,
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
        let mut values = components.iter();
        let mut logical_record_id = prefix.to_owned();
        let mut project_id = None;
        for part in parts {
            let segment = match part {
                Literal(literal) => (*literal).to_owned(),
                _ => {
                    let value = values.next().ok_or(IdentityError::WrongArity)?;
                    check_component(*part, value)?;
                    if matches!(part, Project) {
                        project_id = Some((*value).to_owned());
                    }
                    (*value).to_owned()
                }
            };
            logical_record_id.push(':');
            logical_record_id.push_str(&segment);
        }
        if values.next().is_some() {
            return Err(IdentityError::WrongArity);
        }
        Ok(RecordIdentity {
            class,
            logical_record_id,
            project_id,
        })
    }

    /// The `record-commit:<record-class>:<logical-record-id>` marker for `record`, in the same
    /// scope as the record it tracks (§5.2.1). Markers are never nested.
    pub fn commit_marker(record: &RecordIdentity) -> Result<Self, IdentityError> {
        if record.class == RecordClass::RecordCommit {
            return Err(IdentityError::NotBuildableDirectly);
        }
        Ok(RecordIdentity {
            class: RecordClass::RecordCommit,
            logical_record_id: format!(
                "record-commit:{}:{}",
                record.class.token(),
                record.logical_record_id
            ),
            project_id: record.project_id.clone(),
        })
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

fn check_component(part: Part, value: &str) -> Result<(), IdentityError> {
    if value.is_empty() {
        return Err(IdentityError::EmptyComponent);
    }
    if value.contains(':') {
        return Err(IdentityError::SeparatorInComponent);
    }
    if value.chars().any(char::is_control) {
        return Err(IdentityError::ControlCharacter);
    }
    match part {
        Scope => InstallationScopeId::parse(value)
            .map(|_| ())
            .map_err(|_| IdentityError::MalformedInstallationScope),
        Decimal32 => canonical_decimal(value)
            .filter(|number| *number <= u64::from(u32::MAX))
            .map(|_| ())
            .ok_or(IdentityError::NonCanonicalDecimal),
        Epoch => match canonical_decimal(value) {
            Some(0) | Some(u64::MAX) => Err(IdentityError::UnassignedEpoch),
            Some(_) => Ok(()),
            None => Err(IdentityError::NonCanonicalDecimal),
        },
        Literal(_) | Project | Opaque => Ok(()),
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
