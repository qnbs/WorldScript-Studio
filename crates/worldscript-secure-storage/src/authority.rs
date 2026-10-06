//! Gate 3 slice 3C part 3c-2a: the persisted record catalog under the authority root (§5.5,
//! §5.5.1).
//!
//! Catalog pages are written as `<root_dir>/catalog/<shard>/generation-<n>.wsr1` (a locator, never
//! identity or AAD), sealed under the root's key route with the root's `active_key_epoch` — they
//! are control records of the root, like the key-epoch records. A page's `catalog_generation` is
//! the `root_generation` of the root that publishes it (§5.5.1), so a shard's generations rise
//! strictly but not consecutively, and a page newer than the committed root is a leftover of a
//! change whose root never committed: [`load_catalog`] ignores it, and the next
//! [`commit_catalog_change`] relocates it (never deletes it) before any page is written.
//!
//! [`load_catalog`] trusts nothing the directory listing says: it starts from the trusted cold
//! start ([`load_committed_root`]), opens each shard's newest committed page under that same
//! anchor's scope and route, requires it to carry the root's `active_key_epoch`, and requires the
//! pages to hash to the root's `catalog_set_digest` and their descriptors' markers to hash to its
//! `marker_set_digest`; any other result is `RECOVERY_REQUIRED`. [`list_records`] returns the
//! verified descriptors. [`commit_catalog_change`] applies descriptor upserts and removals,
//! checks everything [`commit_root`] would refuse, writes one new page generation per affected
//! shard (an emptied shard keeps a zero-descriptor page), and commits the root that names them;
//! until that root commits, the prior catalog stays authority. A change keeps the committed key
//! route and epoch; changing them is a key rotation (Gate 5). Each change runs under the
//! `root_commit_mutex` (§11.1, slice 4A); operation admission above it is slice 4B.
//! [`protected`](crate::protected) commits
//! the record write protocol through it.

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};

use crate::anchor::check_operation_id;
use crate::catalog::{
    catalog_shard_of, CatalogDescriptor, CatalogError, CatalogPage, PageAddress,
    CATALOG_PAGE_RECORD_SCHEMA, CATALOG_SHARD_COUNT,
};
use crate::commit::{parse_counter, parse_generation_name, relocate, CommitError};
use crate::durable::{
    generation_path, stage_and_promote, DirectoryDurability, DurableFs, StageFailure, StageRequest,
    WriteOperationId,
};
use crate::envelope::parse_envelope;
use crate::error::SealError;
use crate::identity::RecordIdentity;
use crate::journal::{
    assert_binding_successor, load_authoritative_manifest, promote_manifest_fenced,
    JournalDurableContext, JournalDurableError, JournalManifest, MigrationExecutionError,
    MigrationFence,
};
use crate::marker::content_digest;
use crate::provider::{InstallationScopeId, KeyProvider, RootKeyRefV1};
use crate::root::{
    catalog_set_digest, key_epoch_set_digest, marker_set_digest, CatalogShard, KeyEpochEntry,
    LiveMigration, MarkerSetEntry, RootBody, RootCommitEvidence, RootCommitState, RootError,
};
use crate::root_lock::RootCommitGuard;
use crate::root_store::{
    active_epoch_bound, commit_root, is_generation_debris, load_committed_root, load_key_epoch_set,
    RootCommitRequest, RootCommitted, RootLayout, RootRecoveryReason, RootStep, RootStoreError,
};
use crate::seal::{Key, RecordMeta};

/// The durability step at which a catalog operation stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatalogStep {
    ListCatalog,
    ReadPage,
    CreateShardDir,
    RelocatePage,
    /// Syncing the journal directory a binding advance names a manifest generation in.
    SyncJournal,
}

/// Why the persisted catalog cannot be trusted. Ordinary reads and writes stop (§7).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatalogRecoveryReason {
    /// The committed pages do not hash to the root's `catalog_set_digest`, a committed page is
    /// missing, does not open or carries another key epoch than the root's `active_key_epoch`, or
    /// an unexpected entry is present in the catalog directory.
    CatalogSetMismatch,
    /// The catalogued descriptors' markers do not hash to the root's `marker_set_digest`.
    MarkerSetMismatch,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthorityError {
    /// A read, write or sync failed for a reason other than absence; nothing was decided.
    Io {
        step: CatalogStep,
        kind: io::ErrorKind,
    },
    Root(RootStoreError),
    Catalog(CatalogError),
    Digest(RootError),
    RecoveryRequired(CatalogRecoveryReason),
    /// No installation scope is provisioned, so no root can be committed (§5.3.2).
    NoInstallationScope,
    /// The commit's `operation_id` is empty or longer than §6.1.2's bound.
    InvalidOperationId,
    /// The commit names another key route or `active_key_epoch` than the committed root. Pages the
    /// change does not touch stay sealed under the committed epoch, so only a key rotation (Gate 5),
    /// which rewrites every page, may change them.
    KeyRotationNotAdmitted,
    /// A removal names a record the committed catalog does not hold.
    NotCatalogued,
    /// A change names the same record twice.
    DuplicateChange,
    /// Writing a page generation failed (slice 3A's staging and promotion).
    PageWrite(StageFailure),
    /// Relocating a leftover page of an uncommitted change failed.
    Relocate(CommitError),
    /// The next root generation would be `u64::MAX` (§5.4's lifecycle rule).
    GenerationExhausted,
    OperationId(SealError),
    /// The committed root binds no live migration, so there is no binding to advance.
    NoLiveMigration,
    /// The advance is not the journal owner's next revision of the committed binding (§5.4).
    LiveMigration(MigrationExecutionError),
    /// The manifest generation the advance names is not durable, or does not authenticate against
    /// the binding the advance would commit.
    Journal(JournalDurableError),
}

impl From<RootStoreError> for AuthorityError {
    fn from(error: RootStoreError) -> Self {
        AuthorityError::Root(error)
    }
}

/// One committed shard: its `catalog_set_digest` entry and its page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommittedShard {
    pub shard: CatalogShard,
    pub page: CatalogPage,
}

/// The verified catalog of the committed root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedCatalog {
    pub root: RootBody,
    /// The installation scope the root and pages were opened in.
    pub scope: InstallationScopeId,
    /// Every committed shard, ascending by `shard_id`.
    pub shards: Vec<CommittedShard>,
}

impl LoadedCatalog {
    /// Every catalogued descriptor, in shard then page order.
    pub fn descriptors(&self) -> impl Iterator<Item = &CatalogDescriptor> {
        self.shards
            .iter()
            .flat_map(|shard| shard.page.descriptors())
    }
}

/// The descriptor changes of one catalog commit. A record appears at most once across both lists.
#[derive(Debug, Clone, Copy)]
pub struct CatalogChange<'a> {
    /// Descriptors that are added or replace the descriptor of the same record.
    pub upsert: &'a [CatalogDescriptor],
    /// Records whose descriptor is dropped (a deletion or a rolled-back first write).
    pub remove: &'a [RecordIdentity],
}

/// One catalog commit: the descriptor changes, the key route and epoch the new root and pages are
/// sealed under, and the operation that commits the root.
#[derive(Debug, Clone, Copy)]
pub struct CatalogCommit<'a> {
    pub change: CatalogChange<'a>,
    pub root_key_ref: &'a RootKeyRefV1,
    pub active_key_epoch: u64,
    /// The root's `root_commit_evidence` operation (§5.4).
    pub operation_id: &'a str,
}

/// The trusted catalog: the committed root (§5.3.1 cold start) and its verified pages. `None`
/// before the first root commit; pages written by a change whose root never committed are
/// ignored.
pub fn load_catalog<F: DurableFs, P: KeyProvider>(
    fs: &mut F,
    provider: &P,
    layout: RootLayout<'_>,
) -> Result<Option<LoadedCatalog>, AuthorityError> {
    let Some(view) = load_committed_root(fs, provider, layout)? else {
        return Ok(None);
    };
    let key = resolve(provider, &view.root_key_ref)?;
    load_snapshot_catalog(fs, layout, view, &key).map(Some)
}

pub(crate) fn load_snapshot_catalog<F: DurableFs>(
    fs: &mut F,
    layout: RootLayout<'_>,
    view: crate::root_store::CommittedRootView,
    key: &Key,
) -> Result<LoadedCatalog, AuthorityError> {
    let reader = PageRead {
        key,
        scope: &view.scope,
        key_epoch: view.root.active_key_epoch,
    };
    let mut shards = Vec::new();
    for listed in scan_catalog(fs, layout)? {
        if let Some(generation) = listed.committed(view.root.root_generation) {
            shards.push(reader.open(fs, &listed, generation)?);
        }
    }
    verify_catalog(&view.root, &shards)?;
    Ok(LoadedCatalog {
        root: view.root,
        scope: view.scope,
        shards,
    })
}

/// `list_records` (§5.5): every catalogued record's descriptor, verified against the committed
/// root. A descriptor may name a record that is enumerable but not yet readable (§5.5).
pub fn list_records<F: DurableFs, P: KeyProvider>(
    fs: &mut F,
    provider: &P,
    layout: RootLayout<'_>,
) -> Result<Vec<CatalogDescriptor>, AuthorityError> {
    Ok(load_catalog(fs, provider, layout)?
        .map(|catalog| catalog.descriptors().cloned().collect())
        .unwrap_or_default())
}

/// Applies `commit.change` to the committed catalog and commits the next root naming the new
/// pages. Everything [`commit_root`] would refuse — the operation ID, the generation, the
/// key-epoch set and its active-epoch binding — is checked before any leftover is relocated or
/// any page written; until the root commits (step F) the prior root and catalog stay authority.
pub fn commit_catalog_change<F: DurableFs, P: KeyProvider>(
    fs: &mut F,
    provider: &mut P,
    layout: RootLayout<'_>,
    commit: CatalogCommit<'_>,
) -> Result<RootCommitted, AuthorityError> {
    check_operation_id(commit.operation_id).map_err(|_| AuthorityError::InvalidOperationId)?;
    // §11.1: the root is re-read, the change planned and the root committed under one
    // `root_commit_mutex`, so a concurrent writer can never commit from the same prior root.
    let held = RootCommitGuard::acquire(layout.root_dir).map_err(|error| {
        AuthorityError::Root(RootStoreError::Io {
            step: RootStep::LockRootCommit,
            kind: error.kind(),
        })
    })?;
    commit_catalog_change_held(fs, provider, layout, commit, &held)
}

/// Where, and under which key, the journal's manifest generation is read (§10.1.1).
#[derive(Clone, Copy)]
pub struct JournalSource<'a> {
    pub key: &'a Key,
    pub dir: &'a Path,
    pub operation: &'a WriteOperationId,
}

/// One advance of the committed live-migration binding to the journal owner's next revision.
#[derive(Clone, Copy)]
pub struct BindingAdvance<'a> {
    /// The binding to commit: the same operation and fence at `journal_revision + 1`, naming the
    /// envelope digest of the durable manifest generation.
    pub next: &'a LiveMigration,
    pub journal: JournalSource<'a>,
    pub root_key_ref: &'a RootKeyRefV1,
    pub active_key_epoch: u64,
}

/// Commits a root whose live-migration binding is the journal owner's next revision (§5.4).
///
/// The root is re-read under `root_commit_mutex`; the advance must be the CAS successor of the
/// binding found there ([`assert_binding_successor`]), and the manifest generation it names must be
/// durable, authenticate under the journal key and hash to the binding's `manifest_digest`
/// ([`load_authoritative_manifest`]). Only then is a root committed that keeps the catalog, key
/// route and epoch unchanged, swaps in the new binding and records the operation's own positive
/// fence as its commit evidence. No journal byte is written or deleted, and until step F the prior
/// root and binding stay authority. A stale owner that still holds an older binding is refused
/// because the comparison is against the root read under the lock, not against the caller's copy.
pub fn advance_live_migration<F: DurableFs, P: KeyProvider>(
    fs: &mut F,
    provider: &mut P,
    layout: RootLayout<'_>,
    advance: BindingAdvance<'_>,
) -> Result<RootCommitted, AuthorityError> {
    check_operation_id(&advance.next.operation_id)
        .map_err(|_| AuthorityError::InvalidOperationId)?;
    let held = RootCommitGuard::acquire(layout.root_dir).map_err(|error| {
        AuthorityError::Root(RootStoreError::Io {
            step: RootStep::LockRootCommit,
            kind: error.kind(),
        })
    })?;
    let commit = CatalogCommit {
        change: CatalogChange {
            upsert: &[],
            remove: &[],
        },
        root_key_ref: advance.root_key_ref,
        active_key_epoch: advance.active_key_epoch,
        operation_id: &advance.next.operation_id,
    };
    commit_planned(fs, provider, layout, commit, &held, Some(&advance))
}

/// One journal-owner checkpoint: the next manifest revision to publish and where the journal lives.
#[derive(Clone, Copy)]
pub struct JournalCheckpoint<'a> {
    pub manifest: &'a JournalManifest,
    pub fence: &'a MigrationFence,
    pub journal: JournalSource<'a>,
    pub root_key_ref: &'a RootKeyRefV1,
    pub active_key_epoch: u64,
}

/// Publishes the journal owner's next manifest revision and advances the root binding to it (§5.4).
///
/// Everything runs under one `root_commit_mutex`. The committed binding is read from the root, so
/// [`promote_manifest_fenced`] checks the manifest against the authenticated binding rather than a
/// copy the caller carries: only the committed owner's next revision is written, and a stale owner
/// is refused before any journal write. The binding is then advanced to exactly that generation as
/// [`advance_live_migration`] does. A refusal before the promote (no bound migration, another key
/// route or epoch, a stale or wrong manifest or fence) writes nothing. A failure after the promote
/// leaves revision `r + 1` as an unadopted candidate while the root still names `r`; adopting or
/// discarding such a candidate on retry is not done here, so a retry meets `GenerationExists`.
/// Lock order is the root lock, then the journal mutex inside the promote; nothing takes them in
/// the opposite order.
pub fn commit_journal_checkpoint<F: DurableFs, P: KeyProvider>(
    fs: &mut F,
    provider: &mut P,
    layout: RootLayout<'_>,
    checkpoint: JournalCheckpoint<'_>,
) -> Result<RootCommitted, AuthorityError> {
    check_operation_id(&checkpoint.manifest.operation_id)
        .map_err(|_| AuthorityError::InvalidOperationId)?;
    let held = RootCommitGuard::acquire(layout.root_dir).map_err(|error| {
        AuthorityError::Root(RootStoreError::Io {
            step: RootStep::LockRootCommit,
            kind: error.kind(),
        })
    })?;
    let commit = CatalogCommit {
        change: CatalogChange {
            upsert: &[],
            remove: &[],
        },
        root_key_ref: checkpoint.root_key_ref,
        active_key_epoch: checkpoint.active_key_epoch,
        operation_id: &checkpoint.manifest.operation_id,
    };
    // QNBS-v3: the key route is checked before the promote, because a refusal after the promote would already have left a candidate generation in the journal.
    let committed = match load_catalog(fs, provider, layout)? {
        Some(catalog) if !keeps_key_route(&catalog.root, commit) => {
            return Err(AuthorityError::KeyRotationNotAdmitted)
        }
        Some(catalog) => catalog.root.live_migration,
        None => None,
    }
    .ok_or(AuthorityError::NoLiveMigration)?;
    let promoted = {
        let mut journal = JournalDurableContext::new(
            &mut *fs,
            checkpoint.journal.key,
            checkpoint.journal.dir,
            checkpoint.journal.operation,
        );
        promote_manifest_fenced(
            &mut journal,
            checkpoint.manifest,
            checkpoint.fence,
            Some(&committed),
        )
        .map_err(AuthorityError::Journal)?
    };
    let next = LiveMigration {
        operation_id: checkpoint.manifest.operation_id.clone(),
        fencing_generation: checkpoint.manifest.fencing_generation,
        journal_revision: checkpoint.manifest.journal_revision,
        manifest_digest: promoted.content_digest,
    };
    let advance = BindingAdvance {
        next: &next,
        journal: checkpoint.journal,
        root_key_ref: checkpoint.root_key_ref,
        active_key_epoch: checkpoint.active_key_epoch,
    };
    commit_planned(fs, provider, layout, commit, &held, Some(&advance))
}

pub(crate) fn commit_catalog_change_held<F: DurableFs, P: KeyProvider>(
    fs: &mut F,
    provider: &mut P,
    layout: RootLayout<'_>,
    commit: CatalogCommit<'_>,
    held: &RootCommitGuard,
) -> Result<RootCommitted, AuthorityError> {
    commit_planned(fs, provider, layout, commit, held, None)
}

/// The commit shared by catalog changes and binding advances: `advance` replaces the binding the
/// root would otherwise copy forward, after proving it against the root read here.
fn commit_planned<F: DurableFs, P: KeyProvider>(
    fs: &mut F,
    provider: &mut P,
    layout: RootLayout<'_>,
    commit: CatalogCommit<'_>,
    held: &RootCommitGuard,
    advance: Option<&BindingAdvance<'_>>,
) -> Result<RootCommitted, AuthorityError> {
    if !held.guards(layout.root_dir) {
        return Err(AuthorityError::Root(RootStoreError::MutexNotHeld));
    }
    check_operation_id(commit.operation_id).map_err(|_| AuthorityError::InvalidOperationId)?;
    let current = load_catalog(fs, provider, layout)?;
    let scope = match &current {
        Some(catalog) if !keeps_key_route(&catalog.root, commit) => {
            return Err(AuthorityError::KeyRotationNotAdmitted)
        }
        Some(catalog) => catalog.scope.clone(),
        None => provider
            .read_root_anchor_state()
            .map_err(|error| AuthorityError::Root(RootStoreError::Anchor(error)))?
            .installation_scope_id
            .ok_or(AuthorityError::NoInstallationScope)?,
    };
    let mut journal_durability = DirectoryDurability::Confirmed;
    if let Some(advance) = advance {
        journal_durability = verify_binding_advance(fs, current.as_ref(), advance)?;
    }
    let plan = ChangePlan::new(current, commit.change)?;
    let target = RootTarget {
        layout,
        scope: &scope,
    };
    let key_epoch_set_digest = preflight_key_epochs(fs, provider, &target, commit)?;
    let key = resolve(provider, commit.root_key_ref)?;
    relocate_leftovers(fs, layout, plan.prior_generation, commit.operation_id)?;
    let write = PageWrite {
        layout,
        scope: &scope,
        key: &key,
        key_epoch: commit.active_key_epoch,
        catalog_generation: plan.target_generation,
    };
    let (catalog_shards, pages_durability) = plan.write_pages(fs, &write)?;
    let mut root = plan.root_body(commit, &catalog_shards, key_epoch_set_digest)?;
    if let Some(advance) = advance {
        root.live_migration = Some(advance.next.clone());
        // §5.4: a migration-driven commit records that operation's positive fence, not the ordinary 0.
        root.commit_evidence = RootCommitEvidence {
            operation_id: advance.next.operation_id.clone(),
            fencing_generation: advance.next.fencing_generation,
            state: RootCommitState::Committed,
        };
    }
    let request = RootCommitRequest {
        scope: &scope,
        root: &root,
        root_key_ref: commit.root_key_ref,
        held,
    };
    let mut committed = commit_root(fs, provider, layout, request)?;
    // `Confirmed` only if every page and journal directory sync was too, not just the slot and
    // pointer ones.
    committed.directories = all_confirmed([
        all_confirmed([committed.directories, pages_durability]),
        journal_durability,
    ]);
    Ok(committed)
}

/// Proves `advance` against the root read under the held lock: it is the CAS successor of the
/// committed binding, and the manifest generation it names is durable and authenticates. Returns
/// the durability of the journal directory sync that makes that generation's entry durable.
fn verify_binding_advance<F: DurableFs>(
    fs: &mut F,
    current: Option<&LoadedCatalog>,
    advance: &BindingAdvance<'_>,
) -> Result<DirectoryDurability, AuthorityError> {
    let committed = current
        .and_then(|catalog| catalog.root.live_migration.as_ref())
        .ok_or(AuthorityError::NoLiveMigration)?;
    // QNBS-v3: the stale-owner comparison runs against the binding read from the root under root_commit_mutex, never against a binding the caller carried in; the journal is read by exact generation, with no directory enumeration.
    assert_binding_successor(committed, advance.next).map_err(AuthorityError::LiveMigration)?;
    let mut journal = JournalDurableContext::new(
        fs,
        advance.journal.key,
        advance.journal.dir,
        advance.journal.operation,
    );
    load_authoritative_manifest(&mut journal, advance.next).map_err(AuthorityError::Journal)?;
    // The read takes no journal mutex, so it can see a generation whose directory entry a concurrent
    // promote has linked but not yet synced. Sync it here: the root must never name a manifest that
    // a crash could still lose.
    fs.sync_dir(advance.journal.dir)
        .map_err(|error| AuthorityError::Io {
            step: CatalogStep::SyncJournal,
            kind: error.kind(),
        })
}

/// Whether `commit` keeps the committed root's key route and active epoch.
fn keeps_key_route(root: &RootBody, commit: CatalogCommit<'_>) -> bool {
    root.active_key_epoch == commit.active_key_epoch
        && root.root_key_ref_digest == commit.root_key_ref.digest()
}

/// The key-epoch set the new root names: its digest, after checking that `active_key_epoch` is
/// exactly one `KEY_EPOCH_ACTIVE` record binding the commit's route (§8.3) — the check
/// [`commit_root`] repeats, made here so a refused commit writes no page.
fn preflight_key_epochs<F: DurableFs, P: KeyProvider>(
    fs: &mut F,
    provider: &P,
    target: &RootTarget<'_>,
    commit: CatalogCommit<'_>,
) -> Result<[u8; 32], AuthorityError> {
    let set = load_key_epoch_set(
        fs,
        provider,
        target.layout,
        target.scope,
        commit.root_key_ref,
    )?;
    let route_digest = commit.root_key_ref.digest();
    if !active_epoch_bound(&set, commit.active_key_epoch, &route_digest) {
        return Err(AuthorityError::Root(RootStoreError::RecoveryRequired(
            RootRecoveryReason::ActiveEpochNotBound,
        )));
    }
    let entries: Vec<KeyEpochEntry> = set.iter().map(|(_, entry)| *entry).collect();
    key_epoch_set_digest(&entries).map_err(AuthorityError::Digest)
}

/// The root directory and installation scope a catalog commit targets.
struct RootTarget<'a> {
    layout: RootLayout<'a>,
    scope: &'a InstallationScopeId,
}

/// Relocates (never deletes) every page no root up to `prior_generation` published: it would
/// otherwise collide with this change's pages, or be mistaken for a committed page once the root
/// reaches its generation.
fn relocate_leftovers<F: DurableFs>(
    fs: &mut F,
    layout: RootLayout<'_>,
    prior_generation: u64,
    operation_id: &str,
) -> Result<(), AuthorityError> {
    for listed in scan_catalog(fs, layout)? {
        for generation in listed.uncommitted(prior_generation) {
            let path = generation_path(&listed.dir, generation);
            relocate(fs, &listed.dir, &path, operation_id).map_err(AuthorityError::Relocate)?;
        }
    }
    Ok(())
}

/// A validated catalog change: the resulting descriptors per shard and the pages to write.
struct ChangePlan {
    prior_generation: u64,
    target_generation: u64,
    descriptors: BTreeMap<u32, Vec<CatalogDescriptor>>,
    pages: Vec<CatalogPage>,
    /// The committed `catalog_set_digest` entries the change starts from.
    committed: BTreeMap<u32, CatalogShard>,
    live_migration: Option<LiveMigration>,
}

impl ChangePlan {
    fn new(
        current: Option<LoadedCatalog>,
        change: CatalogChange<'_>,
    ) -> Result<Self, AuthorityError> {
        let prior_generation = current.as_ref().map_or(0, |c| c.root.root_generation);
        let target_generation = prior_generation
            .checked_add(1)
            .filter(|&next| next < u64::MAX)
            .ok_or(AuthorityError::GenerationExhausted)?;
        let mut descriptors = BTreeMap::new();
        let mut committed = BTreeMap::new();
        let mut live_migration = None;
        if let Some(catalog) = current {
            for shard in catalog.shards {
                let shard_id = shard.shard.shard_id;
                descriptors.insert(shard_id, shard.page.descriptors().to_vec());
                committed.insert(shard_id, shard.shard);
            }
            // An ordinary catalog change never ends a live migration's binding.
            live_migration = catalog.root.live_migration;
        }
        let affected = apply_change(&mut descriptors, change)?;
        let pages = affected
            .into_iter()
            .map(|shard_id| {
                let page = descriptors.get(&shard_id).cloned().unwrap_or_default();
                CatalogPage::new(shard_id, page).map_err(AuthorityError::Catalog)
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ChangePlan {
            prior_generation,
            target_generation,
            descriptors,
            pages,
            committed,
            live_migration,
        })
    }

    /// Writes every page and returns the resulting `catalog_set_digest` entries and whether every
    /// directory sync of the pages was confirmed.
    fn write_pages<F: DurableFs>(
        &self,
        fs: &mut F,
        write: &PageWrite<'_>,
    ) -> Result<(Vec<CatalogShard>, DirectoryDurability), AuthorityError> {
        let mut set = self.committed.clone();
        let mut durability = DirectoryDurability::Confirmed;
        for page in &self.pages {
            let (shard, page_durability) = write.page(fs, page)?;
            durability = all_confirmed([durability, page_durability]);
            set.insert(shard.shard_id, shard);
        }
        Ok((set.into_values().collect(), durability))
    }

    /// The `COMMITTED` root naming the new catalog, marker and key-epoch sets.
    fn root_body(
        &self,
        commit: CatalogCommit<'_>,
        catalog_shards: &[CatalogShard],
        key_epoch_set_digest: [u8; 32],
    ) -> Result<RootBody, AuthorityError> {
        let markers = self
            .descriptors
            .values()
            .flatten()
            .map(MarkerSetEntry::from_descriptor)
            .collect::<Result<Vec<_>, _>>()
            .map_err(AuthorityError::Digest)?;
        Ok(RootBody {
            root_generation: self.target_generation,
            active_key_epoch: commit.active_key_epoch,
            root_key_ref_digest: commit.root_key_ref.digest(),
            marker_set_digest: marker_set_digest(&markers).map_err(AuthorityError::Digest)?,
            catalog_set_digest: catalog_set_digest(catalog_shards)
                .map_err(AuthorityError::Digest)?,
            key_epoch_set_digest,
            commit_evidence: RootCommitEvidence {
                operation_id: commit.operation_id.to_owned(),
                fencing_generation: 0,
                state: RootCommitState::Committed,
            },
            live_migration: self.live_migration.clone(),
        })
    }
}

/// Applies the removals then the upserts, returning the affected shards in ascending order.
fn apply_change(
    shards: &mut BTreeMap<u32, Vec<CatalogDescriptor>>,
    change: CatalogChange<'_>,
) -> Result<Vec<u32>, AuthorityError> {
    let named: Vec<&RecordIdentity> = change
        .remove
        .iter()
        .chain(change.upsert.iter().map(CatalogDescriptor::record))
        .collect();
    for (index, record) in named.iter().enumerate() {
        if named[..index].contains(record) {
            return Err(AuthorityError::DuplicateChange);
        }
    }
    let mut affected = Vec::new();
    for record in change.remove {
        let shard_id = catalog_shard_of(record).map_err(AuthorityError::Catalog)?;
        let descriptors = shards
            .get_mut(&shard_id)
            .ok_or(AuthorityError::NotCatalogued)?;
        let position = descriptors
            .iter()
            .position(|descriptor| descriptor.record() == record)
            .ok_or(AuthorityError::NotCatalogued)?;
        descriptors.remove(position);
        affected.push(shard_id);
    }
    for descriptor in change.upsert {
        let shard_id = catalog_shard_of(descriptor.record()).map_err(AuthorityError::Catalog)?;
        let descriptors = shards.entry(shard_id).or_default();
        descriptors.retain(|existing| existing.record() != descriptor.record());
        descriptors.push(descriptor.clone());
        affected.push(shard_id);
    }
    affected.sort_unstable();
    affected.dedup();
    Ok(affected)
}

/// Where and how this change's pages are sealed.
struct PageWrite<'a> {
    layout: RootLayout<'a>,
    scope: &'a InstallationScopeId,
    key: &'a Key,
    key_epoch: u64,
    catalog_generation: u64,
}

impl PageWrite<'_> {
    /// Seals and promotes `page` as this change's generation of its shard, in a directory made
    /// durable first, and returns its `catalog_set_digest` entry and whether every directory sync
    /// of the write was confirmed.
    fn page<F: DurableFs>(
        &self,
        fs: &mut F,
        page: &CatalogPage,
    ) -> Result<(CatalogShard, DirectoryDurability), AuthorityError> {
        let address = PageAddress {
            scope: self.scope,
            shard_id: page.shard_id(),
            catalog_generation: self.catalog_generation,
        };
        let identity = address.identity().map_err(AuthorityError::Catalog)?;
        let catalog_dir = catalog_dir(self.layout);
        let dir = shard_dir(self.layout, page.shard_id());
        let fail = |error: io::Error| io_error(CatalogStep::CreateShardDir, &error);
        fs.create_dir_all(&dir).map_err(fail)?;
        let mut durability = DirectoryDurability::Confirmed;
        for path in [dir.as_path(), catalog_dir.as_path(), self.layout.root_dir] {
            durability = all_confirmed([durability, fs.sync_dir(path).map_err(fail)?]);
        }
        let operation = WriteOperationId::generate().map_err(AuthorityError::OperationId)?;
        let stage = StageRequest {
            dir: &dir,
            identity: &identity,
            meta: RecordMeta {
                key_epoch: self.key_epoch,
                record_generation: self.catalog_generation,
                record_schema: CATALOG_PAGE_RECORD_SCHEMA,
            },
            operation: &operation,
            retain_staging: false,
        };
        let promoted = stage_and_promote(fs, self.key, &stage, &page.encode())
            .map_err(AuthorityError::PageWrite)?;
        let shard = CatalogShard {
            shard_id: page.shard_id(),
            catalog_generation: self.catalog_generation,
            content_digest: promoted.content_digest,
        };
        Ok((shard, all_confirmed([durability, promoted.directory])))
    }
}

/// How the committed root's pages are opened: under its route, in its scope, at its epoch.
struct PageRead<'a> {
    key: &'a Key,
    scope: &'a InstallationScopeId,
    key_epoch: u64,
}

impl PageRead<'_> {
    /// Opens `listed`'s page of `generation`. A page that is missing, does not open or was sealed
    /// under another key epoch is `RECOVERY_REQUIRED`.
    fn open<F: DurableFs>(
        &self,
        fs: &mut F,
        listed: &ListedShard,
        generation: u64,
    ) -> Result<CommittedShard, AuthorityError> {
        let envelope = match fs.read(&generation_path(&listed.dir, generation)) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Err(catalog_recovery()),
            Err(error) => return Err(io_error(CatalogStep::ReadPage, &error)),
        };
        let address = PageAddress {
            scope: self.scope,
            shard_id: listed.shard_id,
            catalog_generation: generation,
        };
        let page =
            CatalogPage::open(self.key, &address, &envelope).map_err(|_| catalog_recovery())?;
        // The header is authenticated as AAD, so after a successful open its epoch is trusted.
        let epoch = parse_envelope(&envelope).map(|parsed| parsed.header().key_epoch);
        if epoch != Ok(self.key_epoch) {
            return Err(catalog_recovery());
        }
        Ok(CommittedShard {
            shard: CatalogShard {
                shard_id: listed.shard_id,
                catalog_generation: generation,
                content_digest: content_digest(&envelope),
            },
            page,
        })
    }
}

/// One shard directory and the page generations it holds, ascending.
struct ListedShard {
    shard_id: u32,
    dir: PathBuf,
    generations: Vec<u64>,
}

impl ListedShard {
    /// The newest generation a root of `root_generation` can have published.
    fn committed(&self, root_generation: u64) -> Option<u64> {
        self.generations
            .iter()
            .copied()
            .rfind(|&generation| generation <= root_generation)
    }

    /// Generations no root up to `root_generation` published.
    fn uncommitted(&self, root_generation: u64) -> impl Iterator<Item = u64> + '_ {
        self.generations
            .iter()
            .copied()
            .filter(move |&generation| generation > root_generation)
    }
}

/// Lists every shard directory and its page generations. Staging leftovers and relocated bytes
/// are ignored — the root's set digest binds what counts — and any other name, including a file
/// where a shard directory belongs, is `RECOVERY_REQUIRED`.
fn scan_catalog<F: DurableFs>(
    fs: &mut F,
    layout: RootLayout<'_>,
) -> Result<Vec<ListedShard>, AuthorityError> {
    let names = list(fs, &catalog_dir(layout))?;
    let mut shards = Vec::with_capacity(names.len());
    for name in names {
        let shard_id = name
            .to_str()
            .and_then(parse_shard)
            .ok_or(catalog_recovery())?;
        let dir = shard_dir(layout, shard_id);
        let mut generations = Vec::new();
        for entry in list_shard(fs, &dir)? {
            if let Some(generation) = parse_generation_name(&entry) {
                generations.push(generation);
            } else if !is_generation_debris(&entry) {
                return Err(catalog_recovery());
            }
        }
        generations.sort_unstable();
        shards.push(ListedShard {
            shard_id,
            dir,
            generations,
        });
    }
    shards.sort_unstable_by_key(|shard| shard.shard_id);
    Ok(shards)
}

/// The committed pages must hash to the root's `catalog_set_digest`, and their descriptors'
/// markers to its `marker_set_digest` (§5.4).
fn verify_catalog(root: &RootBody, shards: &[CommittedShard]) -> Result<(), AuthorityError> {
    let set: Vec<CatalogShard> = shards.iter().map(|committed| committed.shard).collect();
    if catalog_set_digest(&set).map_err(|_| catalog_recovery())? != root.catalog_set_digest {
        return Err(catalog_recovery());
    }
    let marker_recovery =
        || AuthorityError::RecoveryRequired(CatalogRecoveryReason::MarkerSetMismatch);
    let markers = shards
        .iter()
        .flat_map(|committed| committed.page.descriptors())
        .map(MarkerSetEntry::from_descriptor)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| marker_recovery())?;
    if marker_set_digest(&markers).map_err(|_| marker_recovery())? != root.marker_set_digest {
        return Err(marker_recovery());
    }
    Ok(())
}

fn resolve<P: KeyProvider>(
    provider: &P,
    root_key_ref: &RootKeyRefV1,
) -> Result<Key, AuthorityError> {
    provider
        .resolve_ref(root_key_ref)
        .map_err(|error| AuthorityError::Root(RootStoreError::Anchor(error)))
}

fn catalog_dir(layout: RootLayout<'_>) -> PathBuf {
    layout.root_dir.join("catalog")
}

fn shard_dir(layout: RootLayout<'_>, shard_id: u32) -> PathBuf {
    catalog_dir(layout).join(shard_id.to_string())
}

/// A canonical shard decimal: `0`, or a counter without leading zeros, below the shard count.
fn parse_shard(name: &str) -> Option<u32> {
    let value = if name == "0" { 0 } else { parse_counter(name)? };
    u32::try_from(value)
        .ok()
        .filter(|&shard| shard < CATALOG_SHARD_COUNT)
}

fn list<F: DurableFs>(fs: &mut F, dir: &Path) -> Result<Vec<std::ffi::OsString>, AuthorityError> {
    match fs.list_dir(dir) {
        Ok(names) => Ok(names),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(io_error(CatalogStep::ListCatalog, &error)),
    }
}

/// Lists a shard directory. If it cannot be listed but reads as a file, the entry is not a
/// directory at all — unexpected catalog state, not a transient failure.
fn list_shard<F: DurableFs>(
    fs: &mut F,
    dir: &Path,
) -> Result<Vec<std::ffi::OsString>, AuthorityError> {
    match list(fs, dir) {
        Err(AuthorityError::Io { .. }) if fs.read(dir).is_ok() => Err(catalog_recovery()),
        other => other,
    }
}

/// `Confirmed` only if every entry is.
fn all_confirmed(durabilities: [DirectoryDurability; 2]) -> DirectoryDurability {
    if durabilities.contains(&DirectoryDurability::NotConfirmed) {
        DirectoryDurability::NotConfirmed
    } else {
        DirectoryDurability::Confirmed
    }
}

fn catalog_recovery() -> AuthorityError {
    AuthorityError::RecoveryRequired(CatalogRecoveryReason::CatalogSetMismatch)
}

fn io_error(step: CatalogStep, error: &io::Error) -> AuthorityError {
    AuthorityError::Io {
        step,
        kind: error.kind(),
    }
}
