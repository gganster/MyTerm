//! Reading, writing and resolving a project's `.myterm.json`. Port of the file half of `workspace.ts`.

use crate::atomic::{atomic_write, serialise_json};
use crate::cwd::resolve_cwd;
use crate::schema::error::LayoutReadFailure;
use crate::schema::layout::{pane_shell, parse_layout, Layout, LAYOUT_VERSION};
use crate::schema::migrate::{legacy_field_in, migrate_layout};
pub use crate::trust::ResolvedPane;
use serde_json::Value;
use std::path::{Path, PathBuf};

pub const LAYOUT_FILENAME: &str = ".myterm.json";

pub fn layout_path(project_root: &Path) -> PathBuf {
    project_root.join(LAYOUT_FILENAME)
}

/// `String.prototype.trim`: Unicode spaces and the BOM, but not U+0085, which Rust also counts.
fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}')
}

/// Reads and validates a project layout.
///
/// Never repairs, never rewrites: a file the user committed is only ever read here. Every failure
/// carries enough detail to fix the file by hand, which is the intended way to fix it.
pub fn read_layout(project_root: &Path) -> Result<Layout, LayoutReadFailure> {
    let path = layout_path(project_root);
    if !path.exists() {
        return Err(LayoutReadFailure::Missing);
    }
    let bytes = std::fs::read(&path).map_err(|e| LayoutReadFailure::Unreadable { detail: e.to_string() })?;
    let raw = String::from_utf8_lossy(&bytes);

    // Windows editors happily prepend a BOM.
    let text = js_trim(raw.strip_prefix('\u{feff}').unwrap_or(&raw));
    if text.is_empty() {
        return Err(LayoutReadFailure::Empty);
    }
    let parsed: Value =
        serde_json::from_str(text).map_err(|e| LayoutReadFailure::MalformedJson { detail: e.to_string() })?;

    // Checked before validation so a newer file gets a message about versions, not a wall of errors.
    let version = parsed.get("version").filter(|v| v.is_number());
    if let Some(v) = version {
        if v.as_f64().is_some_and(|f| f > LAYOUT_VERSION as f64) {
            return Err(LayoutReadFailure::FutureVersion { found: v.clone() });
        }
        // A hand-bumped file: version 2, v1 coordinates still in it. Ignoring it would reorder the panes.
        if v.as_f64() == Some(LAYOUT_VERSION as f64) {
            if let Some(field) = legacy_field_in(&parsed) {
                return Err(LayoutReadFailure::LegacyFields { field });
            }
        }
    }

    // An older file is upgraded in memory only; it reaches disk when the user next saves an edit.
    parse_layout(&migrate_layout(parsed)).map_err(|problems| LayoutReadFailure::Invalid { problems })
}

pub fn write_layout(project_root: &Path, layout: &Layout) -> std::io::Result<()> {
    atomic_write(&layout_path(project_root), serialise_json(layout))
}

#[derive(Debug, PartialEq)]
pub struct PaneWarning {
    pub pane_id: String,
    pub message: String,
}

#[derive(Debug)]
pub struct ResolveOutcome {
    pub panes: Vec<ResolvedPane>,
    /// Panes whose cwd could not be used, with the reason, for display in-pane.
    pub warnings: Vec<PaneWarning>,
}

/// Turns a validated layout into panes ready to start. A bad cwd degrades that one pane to the
/// project root and reports it; five working panes beat an error screen.
pub fn resolve_panes(project_root: &str, layout: &Layout) -> ResolveOutcome {
    let mut warnings = Vec::new();
    let panes = layout
        .panes
        .iter()
        .map(|pane| {
            let requested = if pane.cwd.is_empty() { layout.defaults.cwd.as_str() } else { pane.cwd.as_str() };
            let mut cwd = project_root.to_string();
            match resolve_cwd(project_root, requested) {
                Ok(resolved) if Path::new(&resolved).exists() => cwd = resolved,
                Ok(_) => warnings.push(PaneWarning {
                    pane_id: pane.id.clone(),
                    message: format!("le dossier « {requested} » n'existe pas — démarrage à la racine du projet"),
                }),
                Err(e) => warnings.push(PaneWarning {
                    pane_id: pane.id.clone(),
                    message: format!("{e} — démarrage à la racine du projet"),
                }),
            }
            ResolvedPane {
                id: pane.id.clone(),
                title: if pane.title.is_empty() { pane.id.clone() } else { pane.title.clone() },
                cwd,
                shell: pane_shell(layout, pane).as_str().to_string(),
                command: pane.command.clone().filter(|c| !c.is_empty()),
            }
        })
        .collect();
    ResolveOutcome { panes, warnings }
}

pub fn project_name_for(project_root: &Path, layout: Option<&Layout>) -> String {
    layout
        .and_then(|l| l.name.clone())
        .unwrap_or_else(|| project_root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())
}

/// A fingerprint of `.myterm.json` as it is on disk right now (`None`: no such file). Two reads with
/// the same fingerprint are the same file, which is how an outside edit is told from our own write.
pub fn layout_fingerprint(project_root: &Path) -> Option<String> {
    use sha2::{Digest, Sha256};
    let bytes = std::fs::read(layout_path(project_root)).ok()?;
    Some(Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect())
}
