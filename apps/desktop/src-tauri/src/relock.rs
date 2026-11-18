//! Session lock state (§2): after Touch ID succeeds the app is unlocked for
//! `RELOCK_AFTER`; then it locks and needs Touch ID again. Pure: callers pass
//! the current time (seconds since the Unix epoch, wall clock so time asleep
//! counts toward the 72 hours).

/// How long one Touch ID unlock lasts. §2 default: 72 hours ("adjustable later").
pub const RELOCK_AFTER_SECS: u64 = 72 * 60 * 60;

/// How often the background watcher checks whether the session expired.
pub const RELOCK_CHECK_INTERVAL_SECS: u64 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LockState {
    unlocked_at: Option<u64>,
    period_secs: u64,
}

impl Default for LockState {
    fn default() -> Self {
        Self::new(RELOCK_AFTER_SECS)
    }
}

impl LockState {
    /// Starts locked.
    pub const fn new(period_secs: u64) -> Self {
        Self { unlocked_at: None, period_secs }
    }

    pub fn unlock(&mut self, now: u64) {
        self.unlocked_at = Some(now);
    }

    pub fn lock(&mut self) {
        self.unlocked_at = None;
    }

    /// Unlocked and the period has not run out. A clock that went backwards
    /// (now < unlocked_at) counts as locked, to be safe.
    pub fn is_unlocked(&self, now: u64) -> bool {
        match self.unlocked_at {
            Some(at) => now >= at && now - at < self.period_secs,
            None => false,
        }
    }

    /// Seconds left before relock (0 when locked).
    pub fn remaining_secs(&self, now: u64) -> u64 {
        match self.unlocked_at {
            Some(at) if self.is_unlocked(now) => self.period_secs - (now - at),
            _ => 0,
        }
    }

    /// Called by the periodic watcher: if the session has just expired, lock
    /// and return true (so the caller tells the frontend once).
    pub fn expire_if_due(&mut self, now: u64) -> bool {
        if self.unlocked_at.is_some() && !self.is_unlocked(now) {
            self.lock();
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const H: u64 = 3600;

    #[test]
    fn default_period_is_72_hours() {
        assert_eq!(RELOCK_AFTER_SECS, 72 * H);
        assert_eq!(LockState::default(), LockState::new(72 * H));
    }

    #[test]
    fn starts_locked() {
        let s = LockState::default();
        assert!(!s.is_unlocked(1_000));
        assert_eq!(s.remaining_secs(1_000), 0);
    }

    #[test]
    fn unlocked_until_exactly_72_hours() {
        let mut s = LockState::default();
        s.unlock(1_000);
        assert!(s.is_unlocked(1_000));
        assert!(s.is_unlocked(1_000 + 72 * H - 1));
        assert_eq!(s.remaining_secs(1_000 + 71 * H), H);
        assert!(!s.is_unlocked(1_000 + 72 * H));
        assert_eq!(s.remaining_secs(1_000 + 72 * H), 0);
    }

    #[test]
    fn expire_if_due_fires_once() {
        let mut s = LockState::new(10);
        s.unlock(100);
        assert!(!s.expire_if_due(105));
        assert!(s.expire_if_due(110));
        assert!(!s.expire_if_due(111));
        assert!(!s.is_unlocked(111));
    }

    #[test]
    fn never_unlocked_never_fires() {
        let mut s = LockState::new(10);
        assert!(!s.expire_if_due(1_000_000));
    }

    #[test]
    fn manual_lock_and_reunlock_restart_the_period() {
        let mut s = LockState::new(10);
        s.unlock(0);
        s.lock();
        assert!(!s.is_unlocked(1));
        s.unlock(50);
        assert!(s.is_unlocked(59));
        assert!(!s.is_unlocked(60));
    }

    #[test]
    fn clock_going_backwards_counts_as_locked() {
        let mut s = LockState::new(10);
        s.unlock(100);
        assert!(!s.is_unlocked(99));
    }
}
