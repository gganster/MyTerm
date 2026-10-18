//! Writes that never leave a truncated file, and a cross-process lock. Port of `atomic-write.ts`.
//!
//! `.myterm.json` lives in the user's repository, and several instances share `preferences.json`:
//! content goes to a sibling temp file, then is renamed over the target (atomic on NTFS within a
//! volume). The temp name is unique per process *and* per call, or two writers would share one file
//! and the survivor would be an interleaving of both.

use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread::sleep;
use std::time::{Duration, Instant, SystemTime};

static WRITE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut os = path.as_os_str().to_owned();
    os.push(suffix);
    PathBuf::from(os)
}

const RENAME_ATTEMPTS: u32 = 5;
const RENAME_BACKOFF: Duration = Duration::from_millis(20);

/// Windows says "someone else holds the destination right now" as access denied or a sharing/lock
/// violation. On NTFS two renames onto the same destination collide in the ordinary case once several
/// instances share a file, so those codes are retried; anything else fails at once.
fn is_transient(e: &io::Error) -> bool {
    e.kind() == io::ErrorKind::PermissionDenied || matches!(e.raw_os_error(), Some(5 | 32 | 33))
}

fn rename_with_retry(from: &Path, to: &Path) -> io::Result<()> {
    let mut attempt = 1;
    loop {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if attempt < RENAME_ATTEMPTS && is_transient(&e) => {
                sleep(RENAME_BACKOFF * attempt);
                attempt += 1;
            }
            Err(e) => return Err(e),
        }
    }
}

pub fn atomic_write(path: &Path, content: impl AsRef<[u8]>) -> io::Result<()> {
    let seq = WRITE_SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1;
    let temporary = with_suffix(path, &format!(".{}.{}.tmp", std::process::id(), seq));
    let result = fs::write(&temporary, content).and_then(|()| rename_with_retry(&temporary, path));
    if result.is_err() {
        // Best effort: a leftover .tmp is untidy, a lost original is not acceptable.
        let _ = fs::remove_file(&temporary);
    }
    result
}

/// JSON as it should land in git: 2-space indent, trailing newline, LF.
pub fn serialise_json(value: &impl Serialize) -> String {
    let mut s = serde_json::to_string_pretty(value).expect("serialisable");
    s.push('\n');
    s
}

/// How long a lock may be held before it is assumed to belong to a dead process.
const LOCK_STALE: Duration = Duration::from_secs(10);
const LOCK_RETRY: Duration = Duration::from_millis(25);
const LOCK_TIMEOUT: Duration = Duration::from_secs(2);

struct Held(Option<PathBuf>);

impl Drop for Held {
    fn drop(&mut self) {
        if let Some(p) = &self.0 {
            let _ = fs::remove_file(p);
        }
    }
}

/// Serialises a read-modify-write across processes (`create_new` is the atomic primitive).
///
/// Two deliberate escape hatches, because a preferences save must never hang a quit: a lock older
/// than ten seconds is stolen, and after two seconds the work runs anyway, unlocked. That reopens
/// the race for one write rather than dropping the user's data. The lock is released even if `work`
/// panics.
pub fn with_file_lock<T>(path: &Path, work: impl FnOnce() -> T) -> T {
    let lock = with_suffix(path, ".lock");
    let deadline = Instant::now() + LOCK_TIMEOUT;
    let mut held = Held(None);

    while Instant::now() < deadline {
        if OpenOptions::new().write(true).create_new(true).open(&lock).is_ok() {
            held.0 = Some(lock.clone());
            break;
        }
        let age = fs::metadata(&lock)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| SystemTime::now().duration_since(t).ok())
            .unwrap_or_default();
        if age > LOCK_STALE {
            let _ = fs::remove_file(&lock);
            continue;
        }
        sleep(LOCK_RETRY);
    }
    work()
}
