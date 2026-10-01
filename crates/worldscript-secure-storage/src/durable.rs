//! Gate 3 slice 3A: durable staging and promotion of one record generation (§9 steps 3–8, §9.2).
//!
//! A new generation is sealed in memory through the Gate 2 codec, written only as ciphertext to a
//! sibling staging file named after its target and operation (`<target>.tmp-<operation-id>-<gen>`,
//! §3, §9 step 3), synced, read back and authenticated against its exact identity and header, then
//! promoted to an immutable generation-addressed file, and finally the directory entry is synced
//! where the platform can confirm it. No existing file is ever opened for writing, overwritten or
//! removed except this operation's own staging file, so the previous generation is untouched
//! whatever fails.
//!
//! Promotion is not a commit: which generation is authoritative is decided by the commit marker and
//! authority root (§5.4, §9 steps 2 and 9–10, Gate 3 slices 3B/3C), and startup reconciliation of
//! staging debris is slice 3B. The record directory is a physical locator only; it is never part of
//! the record's identity or AAD (§6.1.1).

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use crate::error::SealError;
use crate::identity::RecordIdentity;
use crate::random::{OsRandom, RandomSource};
use crate::record::{open_record, seal_record};
use crate::seal::{Key, RecordMeta};

/// Whether the platform confirmed that a directory entry change is durable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DirectoryDurability {
    /// The containing directory was synced (`fsync` on the directory, Linux and macOS).
    Confirmed,
    /// The platform offers no directory sync through this adapter (Windows), so the new entry's
    /// durability is not confirmed; a later commit must report `COMMITTED_NOT_CONFIRMED_DURABLE`.
    NotConfirmed,
}

/// The platform file operations the Core sequences (§9: "The platform adapter implements
/// `fsync`/directory-sync mechanics. The Core owns the order, success boundary, generation rules,
/// and recovery interpretation.").
pub trait DurableFs {
    type File: Write;
    /// Creates `path`, failing if anything already exists there.
    fn create_new(&mut self, path: &Path) -> io::Result<Self::File>;
    /// Flushes the file's contents and metadata to stable storage.
    fn sync_file(&mut self, file: &mut Self::File) -> io::Result<()>;
    fn read(&mut self, path: &Path) -> io::Result<Vec<u8>>;
    /// Makes `to` refer to `from`'s contents, failing with `AlreadyExists` if `to` exists; never
    /// replaces an existing file.
    fn link_no_replace(&mut self, from: &Path, to: &Path) -> io::Result<()>;
    fn remove_file(&mut self, path: &Path) -> io::Result<()>;
    /// Persists the directory's entries where the platform can confirm it.
    fn sync_dir(&mut self, dir: &Path) -> io::Result<DirectoryDurability>;
}

/// The real filesystem. On Apple platforms `File::sync_all` issues `F_FULLFSYNC`; on Windows it is
/// `FlushFileBuffers`. Directory sync opens the directory and syncs it on Unix; Windows reports
/// [`DirectoryDurability::NotConfirmed`]. Only packaged evidence (Gate 6) can show what a given
/// filesystem and device actually guarantee under power loss.
#[derive(Debug, Default, Clone, Copy)]
pub struct StdFs;

impl DurableFs for StdFs {
    type File = File;

    fn create_new(&mut self, path: &Path) -> io::Result<File> {
        OpenOptions::new().write(true).create_new(true).open(path)
    }

    fn sync_file(&mut self, file: &mut File) -> io::Result<()> {
        file.sync_all()
    }

    fn read(&mut self, path: &Path) -> io::Result<Vec<u8>> {
        fs::read(path)
    }

    fn link_no_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        fs::hard_link(from, to)
    }

    fn remove_file(&mut self, path: &Path) -> io::Result<()> {
        fs::remove_file(path)
    }

    #[cfg(unix)]
    fn sync_dir(&mut self, dir: &Path) -> io::Result<DirectoryDurability> {
        File::open(dir)?.sync_all()?;
        Ok(DirectoryDurability::Confirmed)
    }

    #[cfg(not(unix))]
    fn sync_dir(&mut self, _dir: &Path) -> io::Result<DirectoryDurability> {
        Ok(DirectoryDurability::NotConfirmed)
    }
}

/// A Core-generated write operation identity: 128 random bits as 32 lowercase hex characters, so it
/// is filename-safe and never derived from a path, title, time or record ID.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteOperationId(String);

const WRITE_OPERATION_ID_LEN: usize = 32;

impl WriteOperationId {
    /// A fresh identity from the OS CSPRNG. Callers cannot supply their own source, so a weak or
    /// deterministic one can never make two operations share a staging name.
    pub fn generate() -> Result<Self, SealError> {
        Self::from_random(&mut OsRandom)
    }

    /// Test hook: [`generate`](Self::generate) with an injected source. Only compiled with the
    /// `test-randomness` feature, which production builds never enable.
    #[cfg(feature = "test-randomness")]
    pub fn generate_with_random(random: &mut impl RandomSource) -> Result<Self, SealError> {
        Self::from_random(random)
    }

    fn from_random(random: &mut impl RandomSource) -> Result<Self, SealError> {
        let mut bits = [0u8; 16];
        random
            .fill(&mut bits)
            .map_err(|_| SealError::RandomnessUnavailable)?;
        Ok(WriteOperationId(
            bits.iter().map(|byte| format!("{byte:02x}")).collect(),
        ))
    }

    /// Accepts only the canonical form `generate` produces.
    pub fn parse(value: &str) -> Option<Self> {
        let canonical = value.len() == WRITE_OPERATION_ID_LEN
            && value
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
        canonical.then(|| WriteOperationId(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// The immutable file of `generation` inside a record directory.
pub fn generation_path(dir: &Path, generation: u64) -> PathBuf {
    dir.join(format!("generation-{generation}.wsr1"))
}

/// The staging file for `generation` under `operation`: §3's `<target>.tmp-<operation-id>-<gen>`.
pub fn staging_path(dir: &Path, generation: u64, operation: &WriteOperationId) -> PathBuf {
    dir.join(format!(
        "generation-{generation}.wsr1.tmp-{}-{generation}",
        operation.as_str()
    ))
}

/// One generation to stage and promote.
pub struct StageRequest<'a> {
    /// The record's physical directory (a locator, never identity).
    pub dir: &'a Path,
    pub identity: &'a RecordIdentity,
    /// `record_generation` is the generation being written.
    pub meta: RecordMeta,
    pub operation: &'a WriteOperationId,
}

/// The durability step at which an attempt stopped (§9.2's fault points).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StageStep {
    Seal,
    CreateStaging,
    WriteStaging,
    SyncStaging,
    ValidateStaging,
    Promote,
    /// Reading the promoted generation back, which must be exactly the validated envelope.
    VerifyPromoted,
    SyncDirectory,
}

/// Why the step failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StageFailureKind {
    Seal(SealError),
    Io(io::ErrorKind),
    /// The target generation already exists; it is never overwritten.
    GenerationExists,
    /// The staged (or promoted) bytes did not read back as exactly the authenticated envelope that
    /// was written.
    StagedEnvelopeMismatch,
}

/// What this operation's staging file is left as.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StagingResidue {
    /// Never created, or removed by this operation.
    None,
    /// Still present: removal failed, the file already existed under this operation's name, or it
    /// failed validation and is preserved as evidence. It never holds plaintext, carries this
    /// operation's suffix, and is reconciled at startup (slice 3B).
    Present,
}

/// A failed attempt. The previous generation is untouched in every case. `promoted` says whether
/// the new generation's file exists (a failure after promotion); it is then preserved, not yet
/// authoritative, and resolved by the commit protocol (§9.2 "after promotion, before directory
/// sync").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StageFailure {
    pub step: StageStep,
    pub kind: StageFailureKind,
    pub promoted: bool,
    pub staging: StagingResidue,
}

/// A promoted generation. Promotion is not a commit: this generation becomes authoritative only
/// through the commit marker and authority root (slices 3B/3C).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromotedGeneration {
    pub generation: u64,
    pub path: PathBuf,
    pub directory: DirectoryDurability,
    pub staging: StagingResidue,
}

/// Seals `plaintext` as generation `request.meta.record_generation` of `request.identity` and
/// durably promotes it next to the existing generations (§9 steps 3–8). Plaintext is never written
/// anywhere; only the sealed envelope reaches the filesystem.
pub fn stage_and_promote<F: DurableFs>(
    fs: &mut F,
    key: &Key,
    request: &StageRequest<'_>,
    plaintext: &[u8],
) -> Result<PromotedGeneration, StageFailure> {
    let envelope =
        seal_record(key, request.identity, request.meta, plaintext).map_err(|error| {
            failure(
                StageStep::Seal,
                StageFailureKind::Seal(error),
                StagingResidue::None,
            )
        })?;
    let generation = request.meta.record_generation;
    let attempt = Attempt {
        key,
        request,
        envelope,
        staging: staging_path(request.dir, generation, request.operation),
        target: generation_path(request.dir, generation),
    };
    attempt.write_staging(fs)?;
    attempt.validate_staging(fs)?;
    attempt.promote(fs)?;
    // The new generation now exists under its own name. Dropping the staging link leaves only that
    // name; a failure here leaves suffixed ciphertext debris for startup reconciliation.
    let staging = residue_after_remove(fs, &attempt.staging);
    attempt.verify_promoted(fs, staging)?;
    let directory = fs.sync_dir(request.dir).map_err(|error| StageFailure {
        step: StageStep::SyncDirectory,
        kind: io_kind(&error),
        promoted: true,
        staging,
    })?;
    Ok(PromotedGeneration {
        generation,
        path: attempt.target,
        directory,
        staging,
    })
}

/// One staging-and-promotion attempt: the sealed envelope and the two names it lives under.
struct Attempt<'a> {
    key: &'a Key,
    request: &'a StageRequest<'a>,
    envelope: Vec<u8>,
    staging: PathBuf,
    target: PathBuf,
}

impl Attempt<'_> {
    /// Creates the staging file, writes the envelope and syncs it; the handle is closed on return,
    /// before anything reads, links or removes the file (required on Windows).
    fn write_staging<F: DurableFs>(&self, fs: &mut F) -> Result<(), StageFailure> {
        // The handle lives only inside this block, so it is closed before a failed attempt removes
        // the file (Windows refuses to delete an open file).
        let written = {
            let mut file = fs.create_new(&self.staging).map_err(|error| {
                // An existing file under this operation's staging name is never ours to remove.
                let staging = if error.kind() == io::ErrorKind::AlreadyExists {
                    StagingResidue::Present
                } else {
                    StagingResidue::None
                };
                failure(StageStep::CreateStaging, io_kind(&error), staging)
            })?;
            file.write_all(&self.envelope)
                .map_err(|error| (StageStep::WriteStaging, io_kind(&error)))
                .and_then(|()| {
                    fs.sync_file(&mut file)
                        .map_err(|error| (StageStep::SyncStaging, io_kind(&error)))
                })
        };
        written.map_err(|(step, kind)| self.abandon(fs, step, kind))
    }

    /// Reads the staged file back and proves it is exactly the envelope just sealed and that it
    /// authenticates as this generation of this identity (§9 step 6). A file that fails is
    /// preserved for reconciliation and diagnosis, never deleted.
    fn validate_staging<F: DurableFs>(&self, fs: &mut F) -> Result<(), StageFailure> {
        let fail = |kind| failure(StageStep::ValidateStaging, kind, StagingResidue::Present);
        let staged = fs
            .read(&self.staging)
            .map_err(|error| fail(io_kind(&error)))?;
        if staged != self.envelope {
            return Err(fail(StageFailureKind::StagedEnvelopeMismatch));
        }
        let opened = open_record(self.key, self.request.identity, &staged)
            .map_err(|_| fail(StageFailureKind::StagedEnvelopeMismatch))?;
        let (header, meta) = (opened.header, self.request.meta);
        let matches = header.key_epoch == meta.key_epoch
            && header.record_generation == meta.record_generation
            && header.record_schema == meta.record_schema;
        if matches {
            Ok(())
        } else {
            Err(fail(StageFailureKind::StagedEnvelopeMismatch))
        }
    }

    /// Links the validated staging file to the generation name, never replacing an existing file.
    /// If that fails, the staging file is an authenticated candidate tied to this operation, so it
    /// is preserved and reported, never deleted: whatever already holds the generation name may be
    /// unrelated or damaged, and reconciliation (slice 3B) decides between them.
    fn promote<F: DurableFs>(&self, fs: &mut F) -> Result<(), StageFailure> {
        fs.link_no_replace(&self.staging, &self.target)
            .map_err(|error| {
                let kind = if error.kind() == io::ErrorKind::AlreadyExists {
                    StageFailureKind::GenerationExists
                } else {
                    io_kind(&error)
                };
                failure(StageStep::Promote, kind, StagingResidue::Present)
            })
    }

    /// Reads the promoted generation back by its own name: promotion re-resolves the staging path,
    /// so this proves the generation holds exactly the validated envelope. A mismatch is preserved
    /// and reported; it never becomes authoritative, because the commit marker binds the envelope's
    /// digest (slice 3B).
    fn verify_promoted<F: DurableFs>(
        &self,
        fs: &mut F,
        staging: StagingResidue,
    ) -> Result<(), StageFailure> {
        let kind = match fs.read(&self.target) {
            Ok(promoted) if promoted == self.envelope => return Ok(()),
            Ok(_) => StageFailureKind::StagedEnvelopeMismatch,
            Err(error) => io_kind(&error),
        };
        Err(StageFailure {
            step: StageStep::VerifyPromoted,
            kind,
            promoted: true,
            staging,
        })
    }

    /// Removes this operation's own staging file after a write or sync failure (it was never
    /// validated) and reports what is left; nothing else is ever touched.
    fn abandon<F: DurableFs>(
        &self,
        fs: &mut F,
        step: StageStep,
        kind: StageFailureKind,
    ) -> StageFailure {
        failure(step, kind, residue_after_remove(fs, &self.staging))
    }
}

fn residue_after_remove<F: DurableFs>(fs: &mut F, staging: &Path) -> StagingResidue {
    match fs.remove_file(staging) {
        Ok(()) => StagingResidue::None,
        Err(error) if error.kind() == io::ErrorKind::NotFound => StagingResidue::None,
        Err(_) => StagingResidue::Present,
    }
}

fn failure(step: StageStep, kind: StageFailureKind, staging: StagingResidue) -> StageFailure {
    StageFailure {
        step,
        kind,
        promoted: false,
        staging,
    }
}

fn io_kind(error: &io::Error) -> StageFailureKind {
    StageFailureKind::Io(error.kind())
}
