//! Identity of "what this project will execute" (ADR-004). Port of `trust-hash.ts`.
//!
//! The hash must match 0.5.0 bit for bit, or every approval ever given is lost (AC3, AC14). It is
//! the SHA-256 of `JSON.stringify` of `[{id, cwd, shell, command}]` for the panes that have a
//! command, sorted by `id` with `localeCompare`, `cwd` normalised like a project path.

use crate::collate::locale_compare;
use crate::path_key::{normalise_project_path, Platform};
use crate::schema::prefs::TrustedProject;
use sha2::{Digest, Sha256};

/// A pane as the PTY will start it: effective shell, resolved cwd.
#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedPane {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub shell: String,
    pub command: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TrustSubject {
    pub pane_id: String,
    pub title: String,
    pub cwd: String,
    pub shell: String,
    pub command: String,
}

/// `JSON.stringify` for a string: only `"`, `\` and C0 controls are escaped (lowercase hex).
fn js_json_string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// Covers only command, cwd and shell: renaming or moving a pane changes nothing about what runs.
pub fn commands_hash(panes: &[ResolvedPane]) -> String {
    commands_hash_on(panes, Platform::host())
}

pub fn commands_hash_on(panes: &[ResolvedPane], platform: Platform) -> String {
    let mut material: Vec<(&ResolvedPane, &str)> = panes
        .iter()
        .filter_map(|p| p.command.as_deref().filter(|c| !c.is_empty()).map(|c| (p, c)))
        .collect();
    // Sorted so pane order in the file cannot change the identity (stable, like `Array.sort`).
    material.sort_by(|a, b| locale_compare(&a.0.id, &b.0.id));

    let mut json = String::from("[");
    for (i, (pane, command)) in material.iter().enumerate() {
        if i > 0 {
            json.push(',');
        }
        json.push_str("{\"id\":");
        js_json_string(&mut json, &pane.id);
        json.push_str(",\"cwd\":");
        js_json_string(&mut json, &normalise_project_path(&pane.cwd, platform));
        json.push_str(",\"shell\":");
        js_json_string(&mut json, &pane.shell);
        json.push_str(",\"command\":");
        js_json_string(&mut json, command);
        json.push('}');
    }
    json.push(']');

    Sha256::digest(json.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

pub fn commands_of(panes: &[ResolvedPane]) -> Vec<TrustSubject> {
    panes
        .iter()
        .filter_map(|p| {
            p.command.as_deref().filter(|c| !c.is_empty()).map(|c| TrustSubject {
                pane_id: p.id.clone(),
                title: p.title.clone(),
                cwd: p.cwd.clone(),
                shell: p.shell.clone(),
                command: c.to_string(),
            })
        })
        .collect()
}

/// Same panes with commands removed: the "open without executing" fallback.
pub fn strip_commands(panes: &[ResolvedPane]) -> Vec<ResolvedPane> {
    panes.iter().map(|p| ResolvedPane { command: None, ..p.clone() }).collect()
}

pub fn is_trusted(trusted: &[TrustedProject], project_path: &str, hash: &str) -> bool {
    let key = normalise_project_path(project_path, Platform::host());
    trusted
        .iter()
        .any(|t| normalise_project_path(&t.path, Platform::host()) == key && t.commands_hash == hash)
}

/// A layout with no autolaunch command has nothing to approve.
pub fn requires_approval(trusted: &[TrustedProject], project_path: &str, panes: &[ResolvedPane]) -> bool {
    if commands_of(panes).is_empty() {
        return false;
    }
    !is_trusted(trusted, project_path, &commands_hash(panes))
}
