//! `preferences.json`, read once and written under a cross-process lock. Port of `preferences.ts`.
//!
//! The cache is the read path, never the write path. Several instances share this file, so a write
//! re-reads what is on disk, replays the changes *this* process made onto it (`merge`), and stores
//! the result. Approvals and withdrawals are recorded as *what changed*, never as a new copy of the
//! list: a list written wholesale is indistinguishable from a stale cache, and another window saving
//! a moment later would put back an approval this one just withdrew (ADR-004).

use crate::atomic::{atomic_write, serialise_json, with_file_lock};
use crate::path_key::{normalise_project_path, Platform};
use crate::schema::layout::ThemeMode;
use crate::schema::merge::{merge_preferences, PreferenceIntents};
use crate::schema::prefs::*;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// `%APPDATA%\MyTerm`: where Electron's `userData` lived, so existing preferences, approvals and
/// recent projects are found as they are.
pub fn user_data_dir() -> PathBuf {
    std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join("MyTerm")
}

/// `new Date().toISOString()`.
pub fn iso_now() -> String {
    let ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    iso_from_unix_millis(ms)
}

pub fn iso_from_unix_millis(ms: i64) -> String {
    let (secs, milli) = (ms.div_euclid(1000), ms.rem_euclid(1000));
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Days since 1970-01-01 -> civil date (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{milli:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

pub struct PrefsStore {
    path: PathBuf,
    cache: Preferences,
    intents: PreferenceIntents,
}

fn read_from_disk(path: &Path) -> Option<Preferences> {
    if !path.exists() {
        return Some(Preferences::default());
    }
    let value = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    parse_preferences(&value).ok()
}

fn is_empty(i: &PreferenceIntents) -> bool {
    !i.dirty_theme && !i.dirty_window && i.remembered.is_empty() && i.forgotten.is_empty() && i.trusted.is_empty() && i.revoked.is_empty()
}

impl PrefsStore {
    /// Reads the file. A damaged one is kept as `.bak` rather than silently replaced: losing someone's
    /// whole recent-projects list is worse than starting from defaults for one session.
    pub fn load(path: PathBuf) -> Self {
        let cache = if path.exists() {
            match std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).map(|v| parse_preferences(&v)) {
                Some(Ok(prefs)) => prefs,
                _ => {
                    let mut bak = path.clone().into_os_string();
                    bak.push(".bak");
                    let _ = std::fs::copy(&path, PathBuf::from(bak));
                    Preferences::default()
                }
            }
        } else {
            Preferences::default()
        };
        PrefsStore { path, cache, intents: PreferenceIntents::default() }
    }

    pub fn get(&self) -> &Preferences {
        &self.cache
    }

    pub fn has_pending(&self) -> bool {
        !is_empty(&self.intents)
    }

    fn key(path: &str) -> String {
        normalise_project_path(path, Platform::host())
    }

    pub fn remember_project(&mut self, project_path: &str, name: &str) {
        let key = Self::key(project_path);
        let entry = RecentProject { path: project_path.into(), name: name.into(), last_opened_at: iso_now(), missing: None };
        self.intents.remembered.set(key.clone(), entry.clone());
        self.intents.forgotten.remove(&key);
        self.cache.recent_projects.retain(|p| Self::key(&p.path) != key);
        self.cache.recent_projects.insert(0, entry);
        self.cache.recent_projects.truncate(MAX_RECENT_PROJECTS);
    }

    pub fn forget_project(&mut self, project_path: &str) {
        let key = Self::key(project_path);
        self.intents.forgotten.insert(key.clone());
        self.intents.remembered.remove(&key);
        self.cache.recent_projects.retain(|p| Self::key(&p.path) != key);
    }

    pub fn record_trust(&mut self, project_path: &str, commands_hash: &str) {
        let key = Self::key(project_path);
        let entry = TrustedProject { path: project_path.into(), commands_hash: commands_hash.into() };
        self.intents.trusted.set(key.clone(), entry.clone());
        self.intents.revoked.remove(&key);
        self.cache.trusted_projects.retain(|t| Self::key(&t.path) != key);
        self.cache.trusted_projects.insert(0, entry);
    }

    pub fn record_revoke(&mut self, project_path: &str) {
        let key = Self::key(project_path);
        self.intents.revoked.insert(key.clone());
        self.intents.trusted.remove(&key);
        self.cache.trusted_projects.retain(|t| Self::key(&t.path) != key);
    }

    pub fn set_theme(&mut self, theme: ThemeMode) {
        self.cache.theme = theme;
        self.intents.dirty_theme = true;
    }

    pub fn set_window(&mut self, window: WindowState) {
        self.cache.window = window;
        self.intents.dirty_window = true;
    }

    /// Read, merge, write, under a cross-process lock so a concurrent instance cannot slip a write
    /// between our read and our rename. Intents are taken before the lock and cleared only once the
    /// file is on disk; a failed write puts them back so the next save retries the same changes.
    pub fn persist(&mut self) -> io::Result<()> {
        if !self.has_pending() {
            return Ok(());
        }
        let pending = std::mem::take(&mut self.intents);
        let ours = self.cache.clone();
        let path = self.path.clone();

        let result = with_file_lock(&path, || -> io::Result<Preferences> {
            // An unreadable or invalid file is not evidence that the other instances' state is gone:
            // merging onto our own cache keeps this process's view and leaves the damaged file alone.
            let disk = read_from_disk(&path).unwrap_or_else(|| ours.clone());
            let merged = merge_preferences(&disk, &ours, &pending, Platform::host());
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir)?;
            }
            atomic_write(&path, serialise_json(&merged))?;
            Ok(merged)
        });

        match result {
            Ok(merged) => {
                // Changes made while the write was in flight are in `self.intents`, not in `merged`.
                self.cache = merge_preferences(&merged, &self.cache, &self.intents, Platform::host());
                Ok(())
            }
            Err(e) => {
                self.restore(pending);
                Err(e)
            }
        }
    }

    /// Puts a failed write's changes back at the front of the queue. A newer intent for the same
    /// project already recorded since wins, so a retry can never resurrect a reversed decision.
    fn restore(&mut self, pending: PreferenceIntents) {
        let now = &mut self.intents;
        now.dirty_theme |= pending.dirty_theme;
        now.dirty_window |= pending.dirty_window;
        for (k, v) in pending.remembered.iter() {
            if !now.remembered.has(k) && !now.forgotten.contains(k) {
                now.remembered.set(k.clone(), v.clone());
            }
        }
        for k in pending.forgotten {
            if !now.remembered.has(&k) {
                now.forgotten.insert(k);
            }
        }
        for (k, v) in pending.trusted.iter() {
            if !now.trusted.has(k) && !now.revoked.contains(k) {
                now.trusted.set(k.clone(), v.clone());
            }
        }
        for k in pending.revoked {
            if !now.trusted.has(&k) {
                now.revoked.insert(k);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> PathBuf {
        use std::sync::atomic::{AtomicU32, Ordering};
        static N: AtomicU32 = AtomicU32::new(0);
        let p = std::env::temp_dir().join(format!("myterm-prefs-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn iso_matches_toisostring() {
        assert_eq!(iso_from_unix_millis(0), "1970-01-01T00:00:00.000Z");
        // 2026-10-16T07:49:29.886Z, a value from a real preferences.json
        assert_eq!(iso_from_unix_millis(1_792_136_969_886), "2026-10-16T07:49:29.886Z");
        assert_eq!(iso_from_unix_millis(951_782_400_000), "2000-02-29T00:00:00.000Z");
    }

    #[test]
    fn an_approval_survives_a_restart_and_a_withdrawal_stands() {
        let d = dir();
        let file = d.join("preferences.json");
        let mut a = PrefsStore::load(file.clone());
        a.record_trust("C:\\Proj", "h1");
        a.remember_project("C:\\Proj", "proj");
        a.persist().unwrap();

        let mut b = PrefsStore::load(file.clone());
        assert_eq!(b.get().trusted_projects.len(), 1);
        assert_eq!(b.get().recent_projects[0].name, "proj");

        b.record_revoke("c:\\proj\\");
        b.persist().unwrap();
        assert!(PrefsStore::load(file).get().trusted_projects.is_empty());
        std::fs::remove_dir_all(d).ok();
    }

    #[test]
    fn two_instances_do_not_erase_each_others_changes() {
        // The race the merge exists for: both load the same file, each records something, both save.
        let d = dir();
        let file = d.join("preferences.json");
        let mut a = PrefsStore::load(file.clone());
        let mut b = PrefsStore::load(file.clone());
        a.record_trust("C:\\A", "ha");
        b.record_trust("C:\\B", "hb");
        a.persist().unwrap();
        b.persist().unwrap();
        let on_disk = PrefsStore::load(file);
        let mut paths: Vec<_> = on_disk.get().trusted_projects.iter().map(|t| t.path.clone()).collect();
        paths.sort();
        assert_eq!(paths, ["C:\\A", "C:\\B"]);
        std::fs::remove_dir_all(d).ok();
    }

    #[test]
    fn a_revoke_in_one_instance_is_not_resurrected_by_a_stale_cache_in_another() {
        let d = dir();
        let file = d.join("preferences.json");
        let mut seed = PrefsStore::load(file.clone());
        seed.record_trust("C:\\Hostile", "h");
        seed.persist().unwrap();
        let mut a = PrefsStore::load(file.clone());
        let mut b = PrefsStore::load(file.clone()); // still holds the approval in its cache
        a.record_revoke("C:\\Hostile");
        a.persist().unwrap();
        b.set_theme(ThemeMode::Dark); // b saves something unrelated afterwards
        b.persist().unwrap();
        assert!(PrefsStore::load(file).get().trusted_projects.is_empty());
        std::fs::remove_dir_all(d).ok();
    }

    #[test]
    fn a_damaged_file_is_kept_as_bak_and_defaults_are_used() {
        let d = dir();
        let file = d.join("preferences.json");
        std::fs::write(&file, "{ not json").unwrap();
        let s = PrefsStore::load(file.clone());
        assert!(s.get().recent_projects.is_empty());
        assert_eq!(std::fs::read_to_string(d.join("preferences.json.bak")).unwrap(), "{ not json");
        std::fs::remove_dir_all(d).ok();
    }

    #[test]
    fn nothing_pending_means_no_write() {
        let d = dir();
        let file = d.join("preferences.json");
        let mut s = PrefsStore::load(file.clone());
        s.persist().unwrap();
        assert!(!file.exists());
        std::fs::remove_dir_all(d).ok();
    }
}
