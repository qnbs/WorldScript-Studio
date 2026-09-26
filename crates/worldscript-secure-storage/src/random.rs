/// The provider could not produce cryptographically secure random bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RandomnessUnavailable;

/// Source of nonce bytes. Production code uses [`OsRandom`]; the trait exists so tests can supply
/// fixed vector nonces and prove the fail-closed path. A nonce is never derived from a path, record
/// id, timestamp, or revision (§6.3).
#[cfg_attr(not(feature = "test-randomness"), doc(hidden))]
pub trait RandomSource {
    fn fill(&mut self, buf: &mut [u8]) -> Result<(), RandomnessUnavailable>;
}

/// OS-backed CSPRNG via `getrandom`. Any OS failure is surfaced, never replaced by a weaker source.
#[derive(Debug, Default, Clone, Copy)]
pub struct OsRandom;

impl RandomSource for OsRandom {
    fn fill(&mut self, buf: &mut [u8]) -> Result<(), RandomnessUnavailable> {
        getrandom::getrandom(buf).map_err(|_| RandomnessUnavailable)
    }
}
