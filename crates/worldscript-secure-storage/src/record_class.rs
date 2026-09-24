macro_rules! record_classes {
    ($($variant:ident => $token:literal),+ $(,)?) => {
        /// Version-1 record-class registry (§6.1.1). Tokens are immutable once emitted; an unknown
        /// token is `PROTECTED_UNSUPPORTED_VERSION`, never an unbound generic record.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        pub enum RecordClass {
            $($variant),+
        }

        impl RecordClass {
            pub const ALL: &'static [RecordClass] = &[$(RecordClass::$variant),+];

            /// Exact ASCII registry token serialized into AAD.
            pub fn token(self) -> &'static str {
                match self {
                    $(RecordClass::$variant => $token),+
                }
            }

            /// Exact-match lookup; aliases and locale labels are never accepted.
            pub fn from_token(token: &str) -> Option<RecordClass> {
                match token {
                    $($token => Some(RecordClass::$variant),)+
                    _ => None,
                }
            }
        }
    };
}

record_classes! {
    Project => "project",
    ProjectMetadata => "project-metadata",
    Snapshot => "snapshot",
    Backup => "backup",
    Recovery => "recovery",
    Settings => "settings",
    Credential => "credential",
    Image => "image",
    Asset => "asset",
    AssetMetadata => "asset-metadata",
    AssetPair => "asset-pair",
    Codex => "codex",
    RagIndex => "rag-index",
    ActiveProject => "active-project",
    AuthorityRoot => "authority-root",
    KeyEpoch => "key-epoch",
    RecordCommit => "record-commit",
    Migration => "migration",
    MigrationPage => "migration-page",
    Diagnostic => "diagnostic",
    RecordCatalog => "record-catalog",
    LocalFirstDoc => "local-first-doc",
    AnalyticsDb => "analytics-db",
    CrossProjectIndex => "cross-project-index",
    SceneComments => "scene-comments",
    SceneRevision => "scene-revision",
    PlotUi => "plot-ui",
    MindMapUi => "mind-map-ui",
    Progress => "progress",
    ProforgeMemory => "proforge-memory",
    ProforgeHistory => "proforge-history",
    InferenceCache => "inference-cache",
    Lora => "lora",
    LoraDataset => "lora-dataset",
    LoraRun => "lora-run",
    LoraMirror => "lora-mirror",
    Telemetry => "telemetry",
    AiBenchmark => "ai-benchmark",
    WorkerDlq => "worker-dlq",
    IdbKdfSalt => "idb-kdf-salt",
    IdbPassphraseSentinel => "idb-passphrase-sentinel",
}
