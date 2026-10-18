//! "Open this project in…": a fixed list of IDEs, each with the install locations it is looked for
//! in. Port of `external-editor.ts`. The UI names an id; this module decides what that id may start
//! and on which folder, and never goes through a shell (so the folder is one argv entry, never
//! parsed).

use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EditorId {
    Vscode,
    Antigravity,
}

pub const EDITORS: [EditorId; 2] = [EditorId::Vscode, EditorId::Antigravity];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EditorInfo {
    pub id: EditorId,
    pub label: &'static str,
    pub available: bool,
}

#[derive(Clone, Debug, Default)]
pub struct Env {
    pub local_app_data: Option<PathBuf>,
    pub program_files: Option<PathBuf>,
    pub program_files_x86: Option<PathBuf>,
}

impl Env {
    pub fn from_process() -> Env {
        let var = |k| std::env::var_os(k).map(PathBuf::from);
        Env { local_app_data: var("LOCALAPPDATA"), program_files: var("ProgramFiles"), program_files_x86: var("ProgramFiles(x86)") }
    }
}

impl EditorId {
    pub fn label(self) -> &'static str {
        match self {
            EditorId::Vscode => "VS Code",
            EditorId::Antigravity => "Antigravity",
        }
    }

    /// Absolute paths, in the order a machine is likely to have them.
    fn candidates(self, env: &Env) -> Vec<PathBuf> {
        let under = |base: &Option<PathBuf>, parts: &[&str]| base.as_ref().map(|b| parts.iter().fold(b.clone(), |p, part| p.join(part)));
        let programs = env.local_app_data.as_ref().map(|b| b.join("Programs"));
        let found = match self {
            // The user-scoped installer is the default download, so it goes first.
            EditorId::Vscode => [
                under(&programs, &["Microsoft VS Code", "Code.exe"]),
                under(&env.program_files, &["Microsoft VS Code", "Code.exe"]),
                under(&env.program_files_x86, &["Microsoft VS Code", "Code.exe"]),
            ]
            .to_vec(),
            // Two products ship under this name and only one is an editor: `Antigravity\Antigravity.exe`
            // is the agent Manager and ignores the folder it is given. Only `Antigravity IDE.exe` opens it.
            EditorId::Antigravity => [
                under(&programs, &["Antigravity IDE", "Antigravity IDE.exe"]),
                under(&env.program_files, &["Antigravity IDE", "Antigravity IDE.exe"]),
            ]
            .to_vec(),
        };
        found.into_iter().flatten().collect()
    }
}

/// First candidate that exists, or `None`. `exists` is injected so the order is testable without
/// installing the IDEs.
pub fn resolve_editor_path(id: EditorId, env: &Env, exists: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    id.candidates(env).into_iter().find(|p| exists(p))
}

/// What the header renders: every editor, the ones we cannot find marked unavailable (a button that
/// silently vanished would read as a bug on a machine where the IDE lives somewhere unusual).
pub fn list_editors(env: &Env, exists: impl Fn(&Path) -> bool) -> Vec<EditorInfo> {
    EDITORS.iter().map(|&id| EditorInfo { id, label: id.label(), available: resolve_editor_path(id, env, &exists).is_some() }).collect()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OpenFailure {
    NotInstalled,
    LaunchFailed,
}

impl OpenFailure {
    pub fn hint(&self) -> &'static str {
        match self {
            OpenFailure::NotInstalled => "installation introuvable",
            OpenFailure::LaunchFailed => "l'éditeur n'a pas démarré",
        }
    }
}

/// Opens `project_root` in `id`. Detached: the editor must outlive MyTerm, and it gets no stdio.
pub fn open_in_editor(id: EditorId, project_root: &Path, env: &Env) -> Result<(), OpenFailure> {
    let exe = resolve_editor_path(id, env, |p| p.exists()).ok_or(OpenFailure::NotInstalled)?;
    spawn_detached(&exe, project_root).map_err(|_| OpenFailure::LaunchFailed)
}

fn spawn_detached(exe: &Path, folder: &Path) -> std::io::Result<()> {
    let mut command = std::process::Command::new(exe);
    command.arg(folder).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    command.spawn().map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env() -> Env {
        Env {
            local_app_data: Some(r"C:\Users\u\AppData\Local".into()),
            program_files: Some(r"C:\Program Files".into()),
            program_files_x86: Some(r"C:\Program Files (x86)".into()),
        }
    }

    #[test]
    fn the_user_scoped_install_wins_over_the_machine_one() {
        let both = |_: &Path| true;
        let got = resolve_editor_path(EditorId::Vscode, &env(), both).unwrap();
        assert_eq!(got, PathBuf::from(r"C:\Users\u\AppData\Local").join("Programs").join("Microsoft VS Code").join("Code.exe"));
        let only_pf = |p: &Path| p.starts_with(r"C:\Program Files") && !p.starts_with(r"C:\Program Files (x86)");
        assert!(resolve_editor_path(EditorId::Vscode, &env(), only_pf).unwrap().starts_with(r"C:\Program Files"));
    }

    #[test]
    fn antigravity_is_the_ide_never_the_agent_manager() {
        for candidate in EditorId::Antigravity.candidates(&env()) {
            assert_eq!(candidate.file_name().unwrap(), "Antigravity IDE.exe");
        }
    }

    #[test]
    fn a_missing_editor_stays_listed_but_unavailable() {
        let list = list_editors(&env(), |p| p.to_string_lossy().contains("VS Code"));
        assert_eq!(list.iter().map(|e| (e.label, e.available)).collect::<Vec<_>>(), [("VS Code", true), ("Antigravity", false)]);
        assert_eq!(open_in_editor(EditorId::Antigravity, Path::new("."), &Env::default()), Err(OpenFailure::NotInstalled));
    }

    #[test]
    fn an_editor_that_cannot_start_is_reported_not_swallowed() {
        let dir = std::env::temp_dir().join(format!("myterm-ed-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("Programs").join("Microsoft VS Code")).unwrap();
        // An empty "Code.exe": it exists, so it is found, but Windows cannot run it.
        std::fs::write(dir.join("Programs").join("Microsoft VS Code").join("Code.exe"), b"").unwrap();
        let env = Env { local_app_data: Some(dir), ..Default::default() };
        assert_eq!(open_in_editor(EditorId::Vscode, Path::new("."), &env), Err(OpenFailure::LaunchFailed));
    }
}
