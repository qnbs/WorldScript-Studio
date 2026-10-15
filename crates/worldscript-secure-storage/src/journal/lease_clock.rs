//! Gate 4 slice Q1: the clock a takeover is judged against (§10.1).
//!
//! Lease expiry only makes a new owner *eligible*; the authority is still the fence advanced under the
//! root lock. Core never reads the system clock: a takeover reads a [`LeaseClock`] that the privileged
//! native adapter implements, once, inside the takeover and under its root-commit event, and judges
//! the claim against that [`TrustedLeaseTimeObservation`]. The observation cannot be built from a
//! bare number outside this crate, so no argument of a mutation-capable API is a timestamp that a UI,
//! a WebView, a plugin, a file or a remote peer could have chosen. The pure predicate
//! ([`assert_takeover_successor`](super::assert_takeover_successor)) keeps a plain `now_unix_ms` input so
//! that it stays testable.
//!
//! The wall clock of the operating system is not attested. A clock that is set back only makes a
//! takeover refuse; one that is set forward can make it eligible early, and protection against a
//! compromised OS clock is not claimed. A reading that is unavailable or implausible (zero is an unset
//! clock) is refused before anything is written.
//!
//! An observation has no public constructor from a number:
//!
//! ```compile_fail
//! let _ = worldscript_secure_storage::TrustedLeaseTimeObservation { unix_ms: 1 };
//! ```
//!
//! ```compile_fail
//! let _: worldscript_secure_storage::TrustedLeaseTimeObservation = 1u64.into();
//! ```

/// Why a clock reading cannot be used.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeaseClockError {
    /// The clock could not be read.
    Unavailable,
    /// The clock answered, but with a value no real clock gives (zero: an unset clock).
    Implausible,
}

/// A source of UTC Unix milliseconds that the native adapter vouches for.
pub trait LeaseClock {
    fn unix_ms(&self) -> Result<u64, LeaseClockError>;
}

/// One reading of a [`LeaseClock`], taken under the root-commit event of a takeover.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrustedLeaseTimeObservation {
    unix_ms: u64,
}

impl TrustedLeaseTimeObservation {
    /// Reads `clock` once. An unavailable clock and a reading of zero are refused.
    pub fn observe(clock: &dyn LeaseClock) -> Result<Self, LeaseClockError> {
        match clock.unix_ms()? {
            0 => Err(LeaseClockError::Implausible),
            unix_ms => Ok(TrustedLeaseTimeObservation { unix_ms }),
        }
    }

    /// The observed time in UTC Unix milliseconds.
    pub fn unix_ms(&self) -> u64 {
        self.unix_ms
    }
}

/// A clock that always answers the same time, for tests (an answer of `0` is an unset clock).
#[cfg(feature = "test-support")]
#[derive(Debug, Clone, Copy)]
pub struct FixedLeaseClock(pub u64);

#[cfg(feature = "test-support")]
impl LeaseClock for FixedLeaseClock {
    fn unix_ms(&self) -> Result<u64, LeaseClockError> {
        Ok(self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Broken;

    impl LeaseClock for Broken {
        fn unix_ms(&self) -> Result<u64, LeaseClockError> {
            Err(LeaseClockError::Unavailable)
        }
    }

    struct Fixed(u64);

    impl LeaseClock for Fixed {
        fn unix_ms(&self) -> Result<u64, LeaseClockError> {
            Ok(self.0)
        }
    }

    #[test]
    fn a_reading_is_used_only_if_the_clock_answers_with_a_real_time() {
        let outcomes = [
            TrustedLeaseTimeObservation::observe(&Fixed(1_700_000_000_000))
                .map(|seen| seen.unix_ms()),
            TrustedLeaseTimeObservation::observe(&Fixed(0)).map(|seen| seen.unix_ms()),
            TrustedLeaseTimeObservation::observe(&Broken).map(|seen| seen.unix_ms()),
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
}
