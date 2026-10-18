//! Who else is running right now. Port of `instances.ts`.
//!
//! One file per process in `%APPDATA%\MyTerm\instances`, its mtime the heartbeat. It answers how many
//! other windows there are (the cascade) and which instance is the oldest (the one that will own the
//! update check, T08). Both signals are required for an entry to count: a pid alone is not enough,
//! because Windows reuses pids and a killed instance's file would otherwise elect a stranger forever.

use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const HEARTBEAT_MS: i64 = 60_000;
const STALE_AFTER_MS: i64 = HEARTBEAT_MS * 3;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstanceRecord {
    pub pid: u32,
    pub started_at: i64,
}

pub struct InstanceRegistry {
    dir: PathBuf,
    pid: u32,
    now: Box<dyn Fn() -> i64 + Send + Sync>,
    is_alive: Box<dyn Fn(u32) -> bool + Send + Sync>,
}

fn ms_of(t: SystemTime) -> i64 {
    t.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

impl InstanceRegistry {
    pub fn new(dir: PathBuf) -> Self {
        Self::with(dir, std::process::id(), || ms_of(SystemTime::now()), process_is_alive)
    }

    pub fn with(dir: PathBuf, pid: u32, now: impl Fn() -> i64 + Send + Sync + 'static, is_alive: impl Fn(u32) -> bool + Send + Sync + 'static) -> Self {
        InstanceRegistry { dir, pid, now: Box::new(now), is_alive: Box::new(is_alive) }
    }

    fn own_path(&self) -> PathBuf {
        self.dir.join(format!("{}.json", self.pid))
    }

    fn stamp(&self) -> std::io::Result<()> {
        let at = UNIX_EPOCH + Duration::from_millis((self.now)().max(0) as u64);
        fs::OpenOptions::new().write(true).open(self.own_path())?.set_modified(at)
    }

    /// A registry we cannot write degrades to "this instance is alone": it must never stop the app.
    pub fn register(&self) {
        let _ = fs::create_dir_all(&self.dir);
        let body = format!("{{\"pid\":{},\"startedAt\":{}}}", self.pid, (self.now)());
        if fs::write(self.own_path(), body).is_ok() {
            let _ = self.stamp();
        }
    }

    pub fn heartbeat(&self) {
        // Deleted under us (reaped after a long suspend): register again.
        if self.stamp().is_err() {
            self.register();
        }
    }

    pub fn unregister(&self) {
        let _ = fs::remove_file(self.own_path());
    }

    /// Live instances, oldest first; the pid breaks a tie so every instance elects the same one.
    pub fn live(&self) -> Vec<InstanceRecord> {
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return vec![InstanceRecord { pid: self.pid, started_at: 0 }];
        };
        let now = (self.now)();
        let mut records = Vec::new();
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(stem) = name.strip_suffix(".json") else { continue };
            let Ok(pid) = stem.parse::<u32>() else { continue };
            if pid == 0 {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            let modified = meta.modified().map(ms_of).unwrap_or(0);
            let started_at = meta.created().map(ms_of).unwrap_or(modified);
            // Our own entry is always live, whatever the clock says: a machine that slept through a
            // heartbeat must not make this process invisible to itself.
            if pid == self.pid {
                records.push(InstanceRecord { pid, started_at });
                continue;
            }
            if now - modified >= STALE_AFTER_MS || !(self.is_alive)(pid) {
                let _ = fs::remove_file(entry.path());
                continue;
            }
            records.push(InstanceRecord { pid, started_at });
        }
        if !records.iter().any(|r| r.pid == self.pid) {
            records.push(InstanceRecord { pid: self.pid, started_at: now });
        }
        records.sort_by_key(|r| (r.started_at, r.pid));
        records
    }

    pub fn is_primary(&self) -> bool {
        self.live().first().is_some_and(|r| r.pid == self.pid)
    }

    pub fn other_count(&self) -> usize {
        self.live().len().saturating_sub(1)
    }
}

/// Set once at startup, like the module-level registry of 0.5.0: the cascade and the close path both
/// need it and neither has the app state at hand.
static GLOBAL: std::sync::OnceLock<InstanceRegistry> = std::sync::OnceLock::new();

/// Registers this process (before anything reads `other_count`) and keeps the registry for `global`.
pub fn init(dir: PathBuf) -> &'static InstanceRegistry {
    let registry = GLOBAL.get_or_init(|| InstanceRegistry::new(dir));
    registry.register();
    registry
}

pub fn global() -> Option<&'static InstanceRegistry> {
    GLOBAL.get()
}

/// Exists and is still running. Access denied means it exists and belongs to someone else.
#[cfg(windows)]
fn process_is_alive(pid: u32) -> bool {
    use windows::Win32::Foundation::{CloseHandle, E_ACCESSDENIED};
    use windows::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    const STILL_ACTIVE: u32 = 259;
    match unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) } {
        Ok(handle) => {
            let mut code = 0u32;
            let ok = unsafe { GetExitCodeProcess(handle, &mut code) }.is_ok();
            let _ = unsafe { CloseHandle(handle) };
            ok && code == STILL_ACTIVE
        }
        Err(e) => e.code() == E_ACCESSDENIED,
    }
}

#[cfg(not(windows))]
fn process_is_alive(_pid: u32) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::sync::atomic::{AtomicI64, AtomicU32, Ordering};
    use std::sync::{Arc, Mutex};

    struct Rig {
        dir: PathBuf,
        clock: Arc<AtomicI64>,
        alive: Arc<Mutex<HashSet<u32>>>,
    }

    impl Rig {
        fn new(alive: &[u32]) -> Rig {
            static N: AtomicU32 = AtomicU32::new(0);
            let dir = std::env::temp_dir().join(format!("myterm-inst-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
            // Real mtimes are compared with the injected clock, so it starts at the real time.
            Rig { dir, clock: Arc::new(AtomicI64::new(ms_of(SystemTime::now()))), alive: Arc::new(Mutex::new(alive.iter().copied().collect())) }
        }
        fn reg(&self, pid: u32) -> InstanceRegistry {
            let (c, a) = (self.clock.clone(), self.alive.clone());
            InstanceRegistry::with(self.dir.clone(), pid, move || c.load(Ordering::Relaxed), move |p| a.lock().unwrap().contains(&p))
        }
        fn tick(&self, ms: i64) {
            self.clock.fetch_add(ms, Ordering::Relaxed);
        }
    }

    impl Drop for Rig {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn alone_counts_no_other() {
        let r = Rig::new(&[1]);
        let one = r.reg(1);
        one.register();
        assert_eq!(one.other_count(), 0);
        assert!(one.is_primary());
    }

    #[test]
    fn two_live_instances_see_each_other_and_leaving_stops_the_count() {
        let r = Rig::new(&[1, 2]);
        let (one, two) = (r.reg(1), r.reg(2));
        one.register();
        r.tick(10);
        two.register();
        assert_eq!((one.other_count(), two.other_count()), (1, 1));
        two.unregister();
        assert_eq!(one.other_count(), 0);
    }

    #[test]
    fn counts_itself_even_if_its_own_file_is_gone() {
        let r = Rig::new(&[1]);
        let one = r.reg(1);
        one.register();
        fs::remove_file(r.dir.join("1.json")).unwrap();
        assert_eq!(one.live().iter().map(|x| x.pid).collect::<Vec<_>>(), [1]);
        assert!(one.is_primary());
    }

    #[test]
    fn a_missing_folder_does_not_fail() {
        let r = Rig::new(&[1]);
        let alone = r.reg(1);
        assert_eq!(alone.other_count(), 0);
        assert!(alone.is_primary());
    }

    #[test]
    fn a_vanished_process_is_ignored_and_reaped() {
        let r = Rig::new(&[1]);
        r.reg(2).register();
        let one = r.reg(1);
        one.register();
        assert_eq!(one.other_count(), 0);
        assert!(!r.dir.join("2.json").exists());
    }

    #[test]
    fn a_recycled_pid_stops_counting_once_its_heartbeat_is_stale() {
        let r = Rig::new(&[1, 2]);
        r.reg(2).register();
        let one = r.reg(1);
        one.register();
        assert_eq!(one.other_count(), 1);
        r.tick(HEARTBEAT_MS * 3 + 1);
        assert_eq!(one.other_count(), 0);
    }

    #[test]
    fn a_heartbeat_keeps_the_entry_alive() {
        let r = Rig::new(&[1, 2]);
        let two = r.reg(2);
        two.register();
        let one = r.reg(1);
        one.register();
        r.tick(HEARTBEAT_MS * 2);
        two.heartbeat();
        r.tick(HEARTBEAT_MS * 2);
        assert_eq!(one.other_count(), 1);
    }

    #[test]
    fn files_that_are_not_entries_are_ignored() {
        let r = Rig::new(&[1]);
        let one = r.reg(1);
        one.register();
        fs::write(r.dir.join("notes.txt"), "x").unwrap();
        fs::write(r.dir.join("pas-un-pid.json"), "{}").unwrap();
        assert_eq!(one.other_count(), 0);
    }

    #[test]
    fn the_oldest_live_instance_is_elected_and_the_election_moves_on_when_it_leaves() {
        let r = Rig::new(&[1, 2, 3]);
        let (first, second, third) = (r.reg(1), r.reg(2), r.reg(3));
        first.register();
        // The birth time is the filesystem's, not the injected clock's: let it advance for real.
        std::thread::sleep(Duration::from_millis(30));
        second.register();
        std::thread::sleep(Duration::from_millis(30));
        third.register();
        assert_eq!([first.is_primary(), second.is_primary(), third.is_primary()], [true, false, false]);
        first.unregister();
        r.alive.lock().unwrap().remove(&1);
        assert!(second.is_primary());
    }

    #[test]
    fn a_real_pid_check_knows_this_process_is_alive_and_a_huge_one_is_not() {
        assert!(process_is_alive(std::process::id()));
        assert!(!process_is_alive(0x7fff_fff0));
    }
}
