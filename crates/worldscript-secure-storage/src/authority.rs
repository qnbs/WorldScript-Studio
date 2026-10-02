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
//! start ([`load_committed_root`]), opens each shard's newest committed page, and requires the
//! pages to hash to the root's `catalog_set_digest` and their descriptors' markers to hash to its
//! `marker_set_digest`; any other result is `RECOVERY_REQUIRED`. [`list_records`] returns the
//! verified descriptors. [`commit_catalog_change`] applies descriptor upserts and removals,
//! writes one new page generation per affected shard (an emptied shard keeps a zero-descriptor
//! page), and commits the root that names them through [`commit_root`]; until that root commits,
//! the prior catalog stays authority. Wiring the record commit protocol through it is slice 3C
//! part 3c-2b.

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};

use crate::catalog::{
    catalog_shard_of, CatalogDescriptor, CatalogError, CatalogPage, PageAddress,
    CATALOG_PAGE_RECORD_SCHEMA, CATALOG_SHARD_COUNT,
};
use crate::commit::{parse_counter, parse_generation_name, relocate, CommitError};
use crate::durable::{
    generation_path, stage_and_promote, DurableFs, StageFailure, StageRequest, WriteOperationId,
};
use crate::error::{KeyProviderError, SealError};
use crate::identity::RecordIdentity;
use crate::marker::content_digest;
use crate::provider::{InstallationScopeId, KeyProvider, RootKeyRefV1};
use crate::root::{
    catalog_set_digest, key_epoch_set_digest, marker_set_digest, CatalogShard, KeyEpochEntry,
    MarkerSetEntry, RootBody, RootCommitEvidence, RootCommitState, RootError,
};
use crate::root_store::{
    commit_root, is_generation_debris, load_committed_root, load_key_epoch_set, RootCommitRequest,
    RootCommitted, RootLayout, RootStoreError,
};
use crate::seal::{Key, RecordMeta};

/// The durability step at which a catalog operation stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatalogStep {
    ListCatalog,
    ReadPage,
    CreateShardDir,
    RelocatePage,
}

/// Why the persisted catalog cannot be trusted. Ordinary reads and writes stop (§7).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatalogRecoveryReason {
    /// The committed pages do not hash to the root's `catalog_set_digest`, a committed page does
    /// not open, or an unexpected entry is present in the catalog directory.
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

/// How the root that publishes a catalog change is sealed and who commits it.
#[derive(Debug, Clone, Copy)]
pub struct CatalogCommit<'a> {
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
    let anchor = provider
        .read_root_anchor_state()
        .map_err(|error| AuthorityError::Root(RootStoreError::Anchor(error)))?;
    let (Some(committed), Some(scope)) = (anchor.committed_root, anchor.installation_scope_id)
    else {
        return Err(AuthorityError::Root(RootStoreError::Anchor(
            KeyProviderError::RecoveryRequired,
        )));
    };
    let key = provider
        .resolve_ref(&committed.root_key_ref)
        .map_err(|error| AuthorityError::Root(RootStoreError::Anchor(error)))?;
    let root = view.root;
    let mut shards = Vec::new();
    for listed in scan_catalog(fs, layout)? {
        let Some(generation) = listed.committed(root.root_generation) else {
            continue;
        };
        shards.push(open_page(fs, &key, &scope, &listed, generation)?);
    }
    verify_catalog(&root, &shards)?;
    Ok(Some(LoadedCatalog { root, shards }))
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

/// Applies `change` to the committed catalog and commits the next root naming the new pages.
/// Everything that can be refused is refused before any durable write; until the root commits
/// (step F of [`commit_root`]) the prior root and catalog stay authority.
pub fn commit_catalog_change<F: DurableFs, P: KeyProvider>(
    fs: &mut F,
    provider: &mut P,
    layout: RootLayout<'_>,
    change: CatalogChange<'_>,
    commit: CatalogCommit<'_>,
) -> Result<RootCommitted, AuthorityError> {
    let current = load_catalog(fs, provider, layout)?;
    let scope = provider
        .read_root_anchor_state()
        .map_err(|error| AuthorityError::Root(RootStoreError::Anchor(error)))?
        .installation_scope_id
        .ok_or(AuthorityError::NoInstallationScope)?;
    let prior_generation = current.as_ref().map_or(0, |c| c.root.root_generation);
    let target_generation = prior_generation
        .checked_add(1)
        .filter(|&next| next < u64::MAX)
        .ok_or(AuthorityError::GenerationExhausted)?;
    let mut shards = current_pages(current.as_ref());
    let affected = apply_change(&mut shards, change)?;
    let mut pages = Vec::with_capacity(affected.len());
    for shard_id in affected {
        let descriptors = shards.get(&shard_id).cloned().unwrap_or_default();
        pages.push(CatalogPage::new(shard_id, descriptors).map_err(AuthorityError::Catalog)?);
    }
    let key_epochs = load_key_epoch_set(fs, provider, layout, &scope, commit.root_key_ref)?;
    let key_epoch_entries: Vec<KeyEpochEntry> =
        key_epochs.iter().map(|(_, entry)| *entry).collect();
    let key = provider
        .resolve_ref(commit.root_key_ref)
        .map_err(|error| AuthorityError::Root(RootStoreError::Anchor(error)))?;

    // Leftovers of an uncommitted change would otherwise collide with this change's pages or be
    // mistaken for committed ones once the root reaches their generation.
    for listed in scan_catalog(fs, layout)? {
        for generation in listed.uncommitted(prior_generation) {
            let path = generation_path(&listed.dir, generation);
            relocate(fs, &listed.dir, &path, commit.operation_id)
                .map_err(AuthorityError::Relocate)?;
        }
    }

    let mut set: BTreeMap<u32, CatalogShard> = current
        .iter()
        .flat_map(|catalog| catalog.shards.iter())
        .map(|committed| (committed.shard.shard_id, committed.shard))
        .collect();
    let write = PageWrite {
        layout,
        scope: &scope,
        key: &key,
        key_epoch: commit.active_key_epoch,
        catalog_generation: target_generation,
    };
    for page in &pages {
        let shard = write.page(fs, page)?;
        set.insert(shard.shard_id, shard);
    }

    let catalog_shards: Vec<CatalogShard> = set.into_values().collect();
    let markers = shards
        .values()
        .flatten()
        .map(MarkerSetEntry::from_descriptor)
        .collect::<Result<Vec<_>, _>>()
        .map_err(AuthorityError::Digest)?;
    let root = RootBody {
        root_generation: target_generation,
        active_key_epoch: commit.active_key_epoch,
        root_key_ref_digest: commit.root_key_ref.digest(),
        marker_set_digest: marker_set_digest(&markers).map_err(AuthorityError::Digest)?,
        catalog_set_digest: catalog_set_digest(&catalog_shards).map_err(AuthorityError::Digest)?,
        key_epoch_set_digest: key_epoch_set_digest(&key_epoch_entries)
            .map_err(AuthorityError::Digest)?,
        commit_evidence: RootCommitEvidence {
            operation_id: commit.operation_id.to_owned(),
            fencing_generation: 0,
            state: RootCommitState::Committed,
        },
        // An ordinary catalog change never ends a live migration's binding.
        live_migration: current.and_then(|catalog| catalog.root.live_migration),
    };
    let request = RootCommitRequest {
        scope: &scope,
        root: &root,
        root_key_ref: commit.root_key_ref,
    };
    Ok(commit_root(fs, provider, layout, request)?)
}

/// The committed descriptors by shard; a committed empty shard is kept as an empty list.
fn current_pages(current: Option<&LoadedCatalog>) -> BTreeMap<u32, Vec<CatalogDescriptor>> {
    current
        .into_iter()
        .flat_map(|catalog| catalog.shards.iter())
        .map(|committed| {
            (
                committed.shard.shard_id,
                committed.page.descriptors().to_vec(),
            )
        })
        .collect()
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
    /// durable first, and returns its `catalog_set_digest` entry.
    fn page<F: DurableFs>(
        &self,
        fs: &mut F,
        page: &CatalogPage,
    ) -> Result<CatalogShard, AuthorityError> {
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
        for path in [dir.as_path(), catalog_dir.as_path(), self.layout.root_dir] {
            fs.sync_dir(path).map_err(fail)?;
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
        Ok(CatalogShard {
            shard_id: page.shard_id(),
            catalog_generation: self.catalog_generation,
            content_digest: promoted.content_digest,
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
/// are ignored — the root's set digest binds what counts — and any other name is
/// `RECOVERY_REQUIRED`.
fn scan_catalog<F: DurableFs>(
    fs: &mut F,
    layout: RootLayout<'_>,
) -> Result<Vec<ListedShard>, AuthorityError> {
    let mut names = list(fs, &catalog_dir(layout))?;
    names.sort_unstable();
    let mut shards = Vec::with_capacity(names.len());
    for name in names {
        let shard_id = name
            .to_str()
            .and_then(parse_shard)
            .ok_or(catalog_recovery())?;
        let dir = shard_dir(layout, shard_id);
        let mut generations = Vec::new();
        for entry in list(fs, &dir)? {
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

/// Opens `listed`'s page of `generation`; a page that does not open is `RECOVERY_REQUIRED`.
fn open_page<F: DurableFs>(
    fs: &mut F,
    key: &Key,
    scope: &InstallationScopeId,
    listed: &ListedShard,
    generation: u64,
) -> Result<CommittedShard, AuthorityError> {
    let envelope = fs
        .read(&generation_path(&listed.dir, generation))
        .map_err(|error| io_error(CatalogStep::ReadPage, &error))?;
    let address = PageAddress {
        scope,
        shard_id: listed.shard_id,
        catalog_generation: generation,
    };
    let page = CatalogPage::open(key, &address, &envelope).map_err(|_| catalog_recovery())?;
    Ok(CommittedShard {
        shard: CatalogShard {
            shard_id: listed.shard_id,
            catalog_generation: generation,
            content_digest: content_digest(&envelope),
        },
        page,
    })
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

fn catalog_recovery() -> AuthorityError {
    AuthorityError::RecoveryRequired(CatalogRecoveryReason::CatalogSetMismatch)
}

fn io_error(step: CatalogStep, error: &io::Error) -> AuthorityError {
    AuthorityError::Io {
        step,
        kind: error.kind(),
    }
}
