//! Gate 4 slice Q1: the clock a takeover is judged against (§10.1).
//!
//! Lease expiry only makes a new owner *eligible*; the authority is still the fence advanced under the
//! root lock. No argument of a mutation-capable API is a timestamp: a takeover reads a [`LeaseClock`]
//! once, inside the takeover, while the root-commit event is held, and judges the claim against that
//! [`TrustedLeaseTimeObservation`]. The pure predicate
//! ([`assert_takeover_successor`](super::assert_takeover_successor)) keeps a plain `now_unix_ms` input so
//! that it stays testable.
//!
//! **Provenance is enforced, not promised.** A public trait could be implemented by any caller with a
//! number from a UI, a plugin, a file or a remote peer, so [`LeaseClock`] is *sealed*: it cannot be
//! implemented outside this crate. The one production clock is [`SystemLeaseClock`], which reads the UTC
//! wall clock of the operating system and nothing else (a clock read: bounded, non-blocking, no I/O,
//! taken while the root-commit lock is held). A clock for tests exists with the `test-support` feature
//! only. If a platform ever needs another source, it is added here, behind the same seal.
//!
//! The wall clock of the operating system is not attested. A clock that is set back only makes a
//! takeover refuse; one that is set forward can make it eligible early, and protection against a
//! compromised OS clock is not claimed. A reading that is unavailable or implausible (zero is an unset
//! clock) is refused before any journal byte is written. An observation has no constructor from a number
//! and cannot be taken without a held root-commit guard, and no clock can be implemented outside the
//! crate:
//!
//! ```compile_fail
//! let _ = worldscript_secure_storage::TrustedLeaseTimeObservation { unix_ms: 1 };
//! ```
//!
//! ```compile_fail
//! let _: worldscript_secure_storage::TrustedLeaseTimeObservation = 1u64.into();
//! ```
//!
//! ```compile_fail
//! use worldscript_secure_storage::{LeaseClock, LeaseClockError};
//!
//! struct FromTheUi(u64);
//!
//! impl LeaseClock for FromTheUi {
//!     fn unix_ms(&self) -> Result<u64, LeaseClockError> {
//!         Ok(self.0)
//!     }
//! }
//! ```

use std::time::{SystemTime, UNIX_EPOCH};

use crate::root_lock::RootCommitGuard;

mod sealed {
    pub trait Sealed {}
}

/// Why a clock reading cannot be used.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeaseClockError {
    /// The clock could not be read.
    Unavailable,
    /// The clock answered, but with a value no real clock gives (zero: an unset clock).
    Implausible,
}

/// A source of UTC Unix milliseconds. Sealed: only the clocks of this crate implement it, so no caller can
/// supply a number as "the clock".
pub trait LeaseClock: sealed::Sealed {
    fn unix_ms(&self) -> Result<u64, LeaseClockError>;
}

/// The UTC wall clock of the operating system, read directly (a clock read; it neither blocks nor does
/// I/O). A time before the Unix epoch is `Unavailable`, a value that does not fit `u64` is `Implausible`.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemLeaseClock;

impl sealed::Sealed for SystemLeaseClock {}

impl LeaseClock for SystemLeaseClock {
    fn unix_ms(&self) -> Result<u64, LeaseClockError> {
        let since_epoch = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| LeaseClockError::Unavailable)?;
        u64::try_from(since_epoch.as_millis()).map_err(|_| LeaseClockError::Implausible)
    }
}

/// One reading of a [`LeaseClock`], taken while the root-commit event is held.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrustedLeaseTimeObservation {
    unix_ms: u64,
}

impl TrustedLeaseTimeObservation {
    /// Reads `clock` once, while `held` (the root-commit guard of the takeover) is held. An unavailable
    /// clock and a reading of zero are refused.
    pub fn observe(
        clock: &dyn LeaseClock,
        held: &RootCommitGuard,
    ) -> Result<Self, LeaseClockError> {
        let _ = held;
        Self::reading(clock)
    }

    fn reading(clock: &dyn LeaseClock) -> Result<Self, LeaseClockError> {
        match clock.unix_ms()? {
            0 => Err(LeaseClockError::Implausible),
            unix_ms => Ok(TrustedLeaseTimeObservation { unix_ms }),
        }
    }

    /// The observed time in UTC Unix milliseconds.
    pub fn unix_ms(&self) -> u64 {
        self.unix_ms
    }

    /// An observation of `unix_ms` without a guard, for the tests of the layers below the root commit.
    #[cfg(feature = "test-support")]
    pub fn for_test(unix_ms: u64) -> Self {
        TrustedLeaseTimeObservation { unix_ms }
    }
}

/// A clock that always answers the same time, for tests (an answer of `0` is an unset clock).
#[cfg(feature = "test-support")]
#[derive(Debug, Clone, Copy)]
pub struct FixedLeaseClock(pub u64);

#[cfg(feature = "test-support")]
impl sealed::Sealed for FixedLeaseClock {}

#[cfg(feature = "test-support")]
impl LeaseClock for FixedLeaseClock {
    fn unix_ms(&self) -> Result<u64, LeaseClockError> {
        Ok(self.0)
    }
}

/// A clock that cannot be read, for tests.
#[cfg(feature = "test-support")]
#[derive(Debug, Clone, Copy)]
pub struct UnreadableLeaseClock;

#[cfg(feature = "test-support")]
impl sealed::Sealed for UnreadableLeaseClock {}

#[cfg(feature = "test-support")]
impl LeaseClock for UnreadableLeaseClock {
    fn unix_ms(&self) -> Result<u64, LeaseClockError> {
        Err(LeaseClockError::Unavailable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixed(u64);

    impl sealed::Sealed for Fixed {}

    impl LeaseClock for Fixed {
        fn unix_ms(&self) -> Result<u64, LeaseClockError> {
            Ok(self.0)
        }
    }

    impl sealed::Sealed for LeaseClockError {}

    impl LeaseClock for LeaseClockError {
        fn unix_ms(&self) -> Result<u64, LeaseClockError> {
            Err(*self)
        }
    }

    #[test]
    fn a_reading_is_used_only_if_the_clock_answers_with_a_real_time() {
        let outcomes = [
            TrustedLeaseTimeObservation::reading(&Fixed(1_700_000_000_000))
                .map(|seen| seen.unix_ms()),
            TrustedLeaseTimeObservation::reading(&Fixed(0)).map(|seen| seen.unix_ms()),
            TrustedLeaseTimeObservation::reading(&LeaseClockError::Unavailable)
                .map(|seen| seen.unix_ms()),
        ];
        assert_eq!(
            outcomes,
            [
                Ok(1_700_000_000_000),
                Err(LeaseClockError::Implausible),
                Err(LeaseClockError::Unavailable)
            ]
        );
    }

    #[test]
    fn the_system_clock_reads_a_time_after_this_code_was_written() {
        // 2026-01-01T00:00:00Z; a wall clock set before that is a broken clock.
        let seen = SystemLeaseClock.unix_ms().unwrap();
        assert!(seen > 1_767_225_600_000, "{seen}");
    }
}
