//! Reconciles this process's preference changes with what is on disk right now.
//! Port of `preferences-merge.ts`; read its header in the original for the full argument.
//!
//! Several instances share one `preferences.json`, so a write is "replay my *intents* onto the file
//! as it is now", never "persist my cache". Scalars this process touched win; the two lists are
//! rebuilt from disk, then get this process's additions and removals. Intents are pending, never
//! standing: the caller clears them once the write lands, which is why a revoke made elsewhere is
//! never resurrected (ADR-004).

use super::prefs::*;
use crate::collate::locale_compare;
use crate::path_key::{normalise_project_path, Platform};
use std::collections::HashSet;

/// A `Map` that keeps JS semantics: insertion order, and re-setting a key keeps its slot.
#[derive(Clone, Debug)]
pub struct OrderedMap<T>(Vec<(String, T)>);

impl<T> Default for OrderedMap<T> {
    fn default() -> Self {
        OrderedMap(Vec::new())
    }
}

impl<T> OrderedMap<T> {
    pub fn set(&mut self, key: String, value: T) {
        match self.0.iter_mut().find(|(k, _)| *k == key) {
            Some(slot) => slot.1 = value,
            None => self.0.push((key, value)),
        }
    }
    pub fn remove(&mut self, key: &str) {
        self.0.retain(|(k, _)| k != key);
    }
    pub fn has(&self, key: &str) -> bool {
        self.0.iter().any(|(k, _)| k == key)
    }
    pub fn iter(&self) -> impl Iterator<Item = &(String, T)> {
        self.0.iter()
    }
    pub fn len(&self) -> usize {
        self.0.len()
    }
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[derive(Clone, Debug, Default)]
pub struct PreferenceIntents {
    pub dirty_theme: bool,
    pub dirty_window: bool,
    /// Normalised path -> entry, for projects opened here since the last write.
    pub remembered: OrderedMap<RecentProject>,
    /// Normalised paths dropped from the recent list here.
    pub forgotten: HashSet<String>,
    /// Normalised path -> approval, for projects trusted here.
    pub trusted: OrderedMap<TrustedProject>,
    /// Normalised paths whose approval was withdrawn here.
    pub revoked: HashSet<String>,
}

/// `missing` is computed per read and must never reach the file.
fn persistable(entry: &RecentProject) -> RecentProject {
    RecentProject { missing: None, ..entry.clone() }
}

fn merge_recents(disk: &[RecentProject], intents: &PreferenceIntents, platform: Platform) -> Vec<RecentProject> {
    let mut by_path: OrderedMap<RecentProject> = OrderedMap::default();
    for entry in disk {
        let k = normalise_project_path(&entry.path, platform);
        if intents.forgotten.contains(&k) {
            continue;
        }
        by_path.set(k, persistable(entry));
    }
    for (k, entry) in intents.remembered.iter() {
        if intents.forgotten.contains(k) {
            continue;
        }
        by_path.set(k.clone(), persistable(entry));
    }
    // Most recently opened first; stable, so ties keep insertion order like `Array.sort`.
    let mut all: Vec<RecentProject> = by_path.0.into_iter().map(|(_, e)| e).collect();
    all.sort_by(|a, b| locale_compare(&b.last_opened_at, &a.last_opened_at));
    all.truncate(MAX_RECENT_PROJECTS);
    all
}

fn merge_trusted(disk: &[TrustedProject], intents: &PreferenceIntents, platform: Platform) -> Vec<TrustedProject> {
    let mut by_path: OrderedMap<TrustedProject> = OrderedMap::default();
    // Our own approvals go in first: the cap slices from the end, and the disk copy may already be
    // full, so appending ours would drop the approval the user just gave.
    for (k, entry) in intents.trusted.iter() {
        if intents.revoked.contains(k) {
            continue;
        }
        by_path.set(k.clone(), entry.clone());
    }
    for entry in disk {
        let k = normalise_project_path(&entry.path, platform);
        // A revoke made here beats whatever the file still says: the fail-safe direction.
        if intents.revoked.contains(&k) || by_path.has(&k) {
            continue;
        }
        by_path.set(k, entry.clone());
    }
    let mut all: Vec<TrustedProject> = by_path.0.into_iter().map(|(_, e)| e).collect();
    all.truncate(MAX_TRUSTED_PROJECTS);
    all
}

pub fn merge_preferences(
    disk: &Preferences,
    ours: &Preferences,
    intents: &PreferenceIntents,
    platform: Platform,
) -> Preferences {
    Preferences {
        version: PREFERENCES_VERSION,
        theme: if intents.dirty_theme { ours.theme } else { disk.theme },
        window: if intents.dirty_window { ours.window.clone() } else { disk.window.clone() },
        recent_projects: merge_recents(&disk.recent_projects, intents, platform),
        trusted_projects: merge_trusted(&disk.trusted_projects, intents, platform),
    }
}
