//! Gate 3 slice 3A: durable staging and promotion (`docs/native/R15-SECURE-STORAGE-CONTRACT.md` §9
//! steps 3–8, §9.2), proven on the single global settings record through the generic path.
//!
//! Evidence maturity: these are headless tests on the real local filesystem with injected I/O
//! errors at each durability boundary. An injected error is not a power loss; what a device and
//! filesystem actually persist across a crash is packaged evidence for Gate 6. The step "after the
//! directory sync, before returning" performs no I/O, so there is nothing to inject there.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use worldscript_secure_storage::{
    content_digest, generation_path, open_record, stage_and_promote, staging_path,
    DirectoryDurability, DurableFs, Key, PromotedGeneration, RecordClass, RecordIdentity,
    RecordMeta, SealError, StageFailure, StageFailureKind, StageRequest, StageStep, StagingResidue,
    StdFs, WriteOperationId,
};

const OLD_SETTINGS: &[u8] = b"{\"theme\":\"dark\",\"locale\":\"de\"}";
const NEW_SETTINGS: &[u8] = b"{\"theme\":\"light\",\"locale\":\"en\"}";

fn key() -> Key {
    Key::from_bytes(&mut [5u8; 32])
}

fn settings() -> RecordIdentity {
    RecordIdentity::new(RecordClass::Settings, &[]).unwrap()
}

fn meta(generation: u64) -> RecordMeta {
    RecordMeta {
        key_epoch: 1,
        record_generation: generation,
        record_schema: 1,
    }
}

/// A fresh, empty directory under the system temp dir, removed on drop.
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let path = std::env::temp_dir().join(format!(
            "wss-gate3a-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        TempDir(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn operation() -> WriteOperationId {
    WriteOperationId::generate().unwrap()
}

/// Stages `plaintext` as `generation` of the settings record under a fresh operation.
fn stage(
    fs: &mut impl DurableFs,
    dir: &Path,
    generation: u64,
    plaintext: &[u8],
) -> Result<PromotedGeneration, StageFailure> {
    let (identity, op) = (settings(), operation());
    stage_and_promote(
        fs,
        &key(),
        &request(dir, &identity, generation, &op),
        plaintext,
    )
}

/// A request for `generation` of `identity` under `op`.
fn request<'a>(
    dir: &'a Path,
    identity: &'a RecordIdentity,
    generation: u64,
    op: &'a WriteOperationId,
) -> StageRequest<'a> {
    StageRequest {
        dir,
        identity,
        meta: meta(generation),
        operation: op,
        retain_staging: false,
    }
}

/// A directory holding a committed-looking generation 1 of the settings record.
fn with_generation_one() -> (TempDir, Vec<u8>) {
    let dir = TempDir::new();
    stage(&mut StdFs, &dir.0, 1, OLD_SETTINGS).unwrap();
    let bytes = fs::read(generation_path(&dir.0, 1)).unwrap();
    (dir, bytes)
}

fn file_names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

/// No file in `dir` contains either plaintext anywhere in its bytes.
fn assert_no_plaintext(dir: &Path) {
    for name in file_names(dir) {
        let bytes = fs::read(dir.join(&name)).unwrap();
        for plaintext in [OLD_SETTINGS, NEW_SETTINGS] {
            assert!(
                !bytes.windows(plaintext.len()).any(|w| w == plaintext),
                "plaintext found in {name}"
            );
        }
    }
}

fn assert_generation_opens(dir: &Path, generation: u64, plaintext: &[u8]) {
    let bytes = fs::read(generation_path(dir, generation)).unwrap();
    let opened = open_record(&key(), &settings(), &bytes).unwrap();
    assert_eq!(opened.payload, plaintext);
    assert_eq!(opened.header.record_generation, generation);
}

/// Where the fault filesystem fails.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Fault {
    Create,
    /// Writes the first half of the bytes, then fails.
    Write,
    SyncFile,
    Read,
    /// Reads back the staged bytes with one byte flipped.
    CorruptRead,
    /// Reads back only the promoted generation with one byte flipped.
    CorruptPromotedRead,
    /// Fails reading only the promoted generation.
    PromotedReadError,
    Link,
    Remove,
    SyncDir,
}

/// The real filesystem with one injected failure.
struct FaultFs {
    fault: Fault,
}

struct FaultFile {
    inner: fs::File,
    fail_write: bool,
}

impl Write for FaultFile {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if self.fail_write {
            self.inner.write_all(&buf[..buf.len() / 2])?;
            return Err(io::Error::other("injected write fault"));
        }
        self.inner.write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

/// Whether `path` names a promoted generation (not a staging file), judged by its file name only.
fn is_generation_file(path: &Path) -> bool {
    let name = path.file_name().unwrap().to_string_lossy();
    name.starts_with("generation-") && name.ends_with(".wsr1")
}

/// The old generation is byte-identical and no file in `dir` holds plaintext.
fn assert_old_intact(dir: &Path, old: &[u8]) {
    assert_eq!(fs::read(generation_path(dir, 1)).unwrap(), old);
    assert_no_plaintext(dir);
}

fn failed(
    step: StageStep,
    kind: StageFailureKind,
    promoted: bool,
    staging: StagingResidue,
) -> StageFailure {
    StageFailure {
        step,
        kind,
        promoted,
        staging,
    }
}

fn flipped(mut bytes: Vec<u8>) -> io::Result<Vec<u8>> {
    let last = bytes.len() - 1;
    bytes[last] ^= 0x01;
    Ok(bytes)
}

fn injected(what: &str) -> io::Error {
    io::Error::other(format!("injected {what} fault"))
}

impl DurableFs for FaultFs {
    type File = FaultFile;

    fn create_new(&mut self, path: &Path) -> io::Result<FaultFile> {
        if self.fault == Fault::Create {
            return Err(injected("create"));
        }
        Ok(FaultFile {
            inner: StdFs.create_new(path)?,
            fail_write: self.fault == Fault::Write,
        })
    }

    fn sync_file(&mut self, file: &mut FaultFile) -> io::Result<()> {
        if self.fault == Fault::SyncFile {
            return Err(injected("sync"));
        }
        StdFs.sync_file(&mut file.inner)
    }

    fn read(&mut self, path: &Path) -> io::Result<Vec<u8>> {
        match self.fault {
            Fault::Read => Err(injected("read")),
            Fault::CorruptRead => flipped(StdFs.read(path)?),
            Fault::CorruptPromotedRead if is_generation_file(path) => flipped(StdFs.read(path)?),
            Fault::PromotedReadError if is_generation_file(path) => Err(injected("promoted read")),
            _ => StdFs.read(path),
        }
    }

    fn link_no_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        if self.fault == Fault::Link {
            return Err(injected("link"));
        }
        StdFs.link_no_replace(from, to)
    }

    fn remove_file(&mut self, path: &Path) -> io::Result<()> {
        if self.fault == Fault::Remove {
            return Err(injected("remove"));
        }
        StdFs.remove_file(path)
    }

    fn sync_dir(&mut self, dir: &Path) -> io::Result<DirectoryDurability> {
        if self.fault == Fault::SyncDir {
            return Err(injected("directory sync"));
        }
        StdFs.sync_dir(dir)
    }

    fn list_dir(&mut self, dir: &Path) -> io::Result<Vec<std::ffi::OsString>> {
        StdFs.list_dir(dir)
    }
}

#[test]
fn a_new_generation_is_promoted_beside_the_untouched_old_one() {
    let (dir, old) = with_generation_one();
    let promoted = stage(&mut StdFs, &dir.0, 2, NEW_SETTINGS).unwrap();
    let directory = if cfg!(unix) {
        DirectoryDurability::Confirmed
    } else {
        DirectoryDurability::NotConfirmed
    };
    let promoted_bytes = fs::read(generation_path(&dir.0, 2)).unwrap();
    let expected = PromotedGeneration {
        generation: 2,
        path: generation_path(&dir.0, 2),
        content_digest: content_digest(&promoted_bytes),
        directory,
        staging: StagingResidue::None,
    };
    assert_eq!(promoted, expected);
    assert_generation_opens(&dir.0, 1, OLD_SETTINGS);
    assert_generation_opens(&dir.0, 2, NEW_SETTINGS);
    let names = file_names(&dir.0);
    assert_eq!(names, ["generation-1.wsr1", "generation-2.wsr1"]);
    assert_old_intact(&dir.0, &old);
}

#[test]
fn every_failure_before_promotion_leaves_the_old_generation_untouched() {
    let io = StageFailureKind::Io(io::ErrorKind::Other);
    let mismatch = StageFailureKind::StagedEnvelopeMismatch;
    // Write/sync failures remove the operation's own unvalidated staging file; a file that fails
    // validation, or a validated one whose promotion fails, is preserved for reconciliation (§9.2).
    for (fault, step, kind, staging) in [
        (
            Fault::Create,
            StageStep::CreateStaging,
            io,
            StagingResidue::None,
        ),
        (
            Fault::Write,
            StageStep::WriteStaging,
            io,
            StagingResidue::None,
        ),
        (
            Fault::SyncFile,
            StageStep::SyncStaging,
            io,
            StagingResidue::None,
        ),
        (
            Fault::Read,
            StageStep::ValidateStaging,
            io,
            StagingResidue::Present,
        ),
        (
            Fault::CorruptRead,
            StageStep::ValidateStaging,
            mismatch,
            StagingResidue::Present,
        ),
        (Fault::Link, StageStep::Promote, io, StagingResidue::Present),
    ] {
        let (dir, old) = with_generation_one();
        let failure = stage(&mut FaultFs { fault }, &dir.0, 2, NEW_SETTINGS).unwrap_err();
        assert_eq!(failure, failed(step, kind, false, staging), "{fault:?}");
        // Old generation intact, no new generation, staging only as reported, no plaintext.
        assert_old_intact(&dir.0, &old);
        let staged = file_names(&dir.0).iter().any(|name| name.contains(".tmp-"));
        assert_eq!(staged, staging == StagingResidue::Present, "{fault:?}");
        assert!(!generation_path(&dir.0, 2).exists(), "{fault:?}");
    }
}

#[test]
fn an_existing_staging_file_is_reported_and_never_touched() {
    // A retry under the same operation finds the earlier attempt's staging file: it is reported as
    // present and left exactly as it was, for reconciliation (slice 3B).
    let (dir, old) = with_generation_one();
    let op = operation();
    let staging = staging_path(&dir.0, 2, &op);
    fs::write(&staging, b"earlier attempt").unwrap();
    let identity = settings();
    let failure = stage_and_promote(
        &mut StdFs,
        &key(),
        &request(&dir.0, &identity, 2, &op),
        NEW_SETTINGS,
    )
    .unwrap_err();
    let exists = StageFailureKind::Io(io::ErrorKind::AlreadyExists);
    let expected = failed(
        StageStep::CreateStaging,
        exists,
        false,
        StagingResidue::Present,
    );
    assert_eq!(failure, expected);
    assert_eq!(fs::read(&staging).unwrap(), b"earlier attempt");
    assert_eq!(fs::read(generation_path(&dir.0, 1)).unwrap(), old);
}

#[test]
fn a_promoted_generation_that_does_not_read_back_exactly_is_reported() {
    // The promoted name is read back by itself; bytes other than the validated envelope, or a read
    // that fails, are preserved and reported, never returned as a promoted generation.
    for (fault, kind) in [
        (
            Fault::CorruptPromotedRead,
            StageFailureKind::StagedEnvelopeMismatch,
        ),
        (
            Fault::PromotedReadError,
            StageFailureKind::Io(io::ErrorKind::Other),
        ),
    ] {
        let (dir, old) = with_generation_one();
        let failure = stage(&mut FaultFs { fault }, &dir.0, 2, NEW_SETTINGS).unwrap_err();
        let expected = failed(StageStep::VerifyPromoted, kind, true, StagingResidue::None);
        assert_eq!(failure, expected, "{fault:?}");
        assert!(generation_path(&dir.0, 2).exists(), "{fault:?}");
        assert_old_intact(&dir.0, &old);
    }
}

#[test]
fn a_failure_after_promotion_preserves_the_new_generation_without_claiming_success() {
    let (dir, old) = with_generation_one();
    let failure = stage(
        &mut FaultFs {
            fault: Fault::SyncDir,
        },
        &dir.0,
        2,
        NEW_SETTINGS,
    )
    .unwrap_err();
    // The staging link was already removed before the directory sync.
    let io = StageFailureKind::Io(io::ErrorKind::Other);
    let expected = failed(StageStep::SyncDirectory, io, true, StagingResidue::None);
    assert_eq!(failure, expected);
    // §9.2 "after promotion, before directory sync": the new generation is preserved and not yet
    // authoritative; the old one is untouched.
    assert_generation_opens(&dir.0, 2, NEW_SETTINGS);
    assert_old_intact(&dir.0, &old);
}

#[test]
fn staging_debris_is_reported_and_is_ciphertext_only() {
    // After promotion the staging link cannot be removed: the generation is promoted, and the
    // suffixed staging file is reported for startup reconciliation (slice 3B).
    let (dir, old) = with_generation_one();
    let op = operation();
    let identity = settings();
    let promoted = stage_and_promote(
        &mut FaultFs {
            fault: Fault::Remove,
        },
        &key(),
        &request(&dir.0, &identity, 2, &op),
        NEW_SETTINGS,
    )
    .unwrap();
    assert_eq!(promoted.staging, StagingResidue::Present);
    assert!(staging_path(&dir.0, 2, &op).exists());
    assert_generation_opens(&dir.0, 2, NEW_SETTINGS);
    assert_old_intact(&dir.0, &old);
}

#[test]
fn an_existing_generation_is_never_overwritten() {
    let (dir, old) = with_generation_one();
    let failure = stage(&mut StdFs, &dir.0, 1, NEW_SETTINGS).unwrap_err();
    // The existing generation is untouched and the validated candidate is kept for reconciliation.
    let exists = StageFailureKind::GenerationExists;
    let expected = failed(StageStep::Promote, exists, false, StagingResidue::Present);
    assert_eq!(failure, expected);
    assert_eq!(fs::read(generation_path(&dir.0, 1)).unwrap(), old);
    let names = file_names(&dir.0);
    assert_eq!(names.len(), 2);
    assert!(names[1].starts_with("generation-1.wsr1.tmp-"));
    assert_no_plaintext(&dir.0);
}

#[test]
fn nothing_is_written_when_the_record_cannot_be_sealed() {
    let dir = TempDir::new();
    let op = operation();
    // A class that never becomes an R-15 envelope (§10.4.1), and an unassigned generation (§5.4).
    let credential = RecordIdentity::new(RecordClass::Credential, &["openai"]).unwrap();
    let failure = stage_and_promote(
        &mut StdFs,
        &key(),
        &request(&dir.0, &credential, 1, &op),
        b"secret",
    )
    .unwrap_err();
    assert_eq!(failure.step, StageStep::Seal);
    assert_eq!(
        failure.kind,
        StageFailureKind::Seal(SealError::NotAnR15RecordClass)
    );
    let identity = settings();
    let failure = stage_and_promote(
        &mut StdFs,
        &key(),
        &request(&dir.0, &identity, 0, &op),
        NEW_SETTINGS,
    )
    .unwrap_err();
    assert_eq!(
        failure.kind,
        StageFailureKind::Seal(SealError::UnassignedCounter)
    );
    assert!(file_names(&dir.0).is_empty());
}

#[test]
fn staging_names_follow_the_contract_and_operation_ids_are_canonical() {
    let op = WriteOperationId::parse("00112233445566778899aabbccddeeff").unwrap();
    let dir = Path::new("records");
    assert_eq!(
        staging_path(dir, 7, &op),
        dir.join("generation-7.wsr1.tmp-00112233445566778899aabbccddeeff-7")
    );
    assert_eq!(generation_path(dir, 7), dir.join("generation-7.wsr1"));
    let generated = operation();
    assert_eq!(WriteOperationId::parse(generated.as_str()), Some(generated));
    for bad in [
        "",
        "0011",
        "00112233445566778899AABBCCDDEEFF",
        "../etc/passwd/00112233445566",
    ] {
        assert_eq!(WriteOperationId::parse(bad), None, "{bad:?}");
    }
}
