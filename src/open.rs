//! The single entry point for opening a project, whatever the door: CLI, recent list, folder
//! picker. Port of `open-workspace.ts`.
//!
//! One implementation on purpose: three copies of this flow would eventually mean one of them
//! forgetting the trust check. The rule that makes it a rule of the *code*, not of discipline (the
//! README's security invariant 3): nothing in the crate can launch a command in a pane without an
//! [`Approved`], and the only places that can mint one are in this file.

use crate::schema::error::describe_failure;
use crate::schema::layout::{default_layout, Layout};
use crate::prefs_store::PrefsStore;
use crate::trust::{commands_hash, commands_of, requires_approval, strip_commands, ResolvedPane, TrustSubject};
use crate::workspace::{read_layout, resolve_panes, write_layout, PaneWarning};
use std::path::Path;

/// Proof that the commands of this workspace may run. Not constructible outside this module.
#[derive(Debug)]
pub struct Approved(());

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrustDecision {
    Approve,
    OpenWithoutExecuting,
    Cancel,
}

/// An open workspace, ready to spawn.
#[derive(Debug)]
pub struct Opened {
    pub project_path: String,
    pub project_name: String,
    pub layout: Layout,
    pub panes: Vec<ResolvedPane>,
    pub warnings: Vec<PaneWarning>,
    /// No `.myterm.json`: a single default pane, and nothing was written into the repository.
    pub generated: bool,
    /// `Some` when the autolaunch commands may run (approved now, approved before, or none to approve).
    pub approval: Option<Approved>,
}

/// Held while the user answers the dialog. Nothing is spawned meanwhile.
#[derive(Debug)]
pub struct PendingTrust {
    pub project_path: String,
    pub project_name: String,
    pub layout: Layout,
    pub commands: Vec<TrustSubject>,
    panes: Vec<ResolvedPane>,
    warnings: Vec<PaneWarning>,
}

#[derive(Debug)]
pub enum OpenResult {
    Error { project_path: String, message: String },
    NeedsTrust(PendingTrust),
    Ok(Opened),
}

fn base_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string_lossy().into_owned())
}

pub fn open_workspace(project_path: &str, prefs: &mut PrefsStore) -> OpenResult {
    let root = Path::new(project_path);
    if !root.is_dir() {
        return OpenResult::Error { project_path: project_path.into(), message: "ce chemin n'est pas un dossier existant".into() };
    }

    let mut generated = false;
    let layout = match read_layout(root) {
        Ok(layout) => layout,
        // No file: open a single pane. We do NOT create a .myterm.json: writing into someone's
        // repository uninvited is not ours to do.
        Err(crate::schema::error::LayoutReadFailure::Missing) => {
            generated = true;
            default_layout(Some(&base_name(root)))
        }
        Err(failure) => {
            return OpenResult::Error { project_path: project_path.into(), message: describe_failure(&failure) }
        }
    };

    let project_name = layout.name.clone().unwrap_or_else(|| base_name(root));
    let resolved = resolve_panes(project_path, &layout);

    if requires_approval(&prefs.get().trusted_projects, project_path, &resolved.panes) {
        // Held, not loaded: no pane exists yet, so none can spawn.
        let commands = commands_of(&resolved.panes);
        return OpenResult::NeedsTrust(PendingTrust {
            project_path: project_path.into(),
            project_name,
            layout,
            commands,
            panes: resolved.panes,
            warnings: resolved.warnings,
        });
    }

    OpenResult::Ok(commit(prefs, project_path, project_name, layout, resolved.panes, resolved.warnings, generated, true))
}

pub fn decide_trust(pending: PendingTrust, decision: TrustDecision, prefs: &mut PrefsStore) -> Option<Opened> {
    match decision {
        TrustDecision::Cancel => None,
        TrustDecision::Approve => {
            prefs.record_trust(&pending.project_path, &commands_hash(&pending.panes));
            Some(commit(prefs, &pending.project_path, pending.project_name, pending.layout, pending.panes, pending.warnings, false, true))
        }
        // The grid is restored, the commands are not run, and nothing is remembered as approved.
        TrustDecision::OpenWithoutExecuting => {
            let panes = strip_commands(&pending.panes);
            Some(commit(prefs, &pending.project_path, pending.project_name, pending.layout, panes, pending.warnings, false, false))
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn commit(
    prefs: &mut PrefsStore,
    project_path: &str,
    project_name: String,
    layout: Layout,
    panes: Vec<ResolvedPane>,
    warnings: Vec<PaneWarning>,
    generated: bool,
    may_run: bool,
) -> Opened {
    prefs.remember_project(project_path, &project_name);
    Opened {
        project_path: project_path.into(),
        project_name,
        layout,
        panes,
        warnings,
        generated,
        approval: may_run.then_some(Approved(())),
    }
}

impl Opened {
    /// Persists a layout edited inside the app. Trust is refreshed rather than re-asked: the user
    /// typed these commands here, which is consent by definition; the prompt exists for commands
    /// that arrive from a file someone else wrote. (Like `Opened`, this is one of the only places
    /// that can mint an [`Approved`].)
    pub fn save_edit(&mut self, layout: &Layout, prefs: &mut PrefsStore) -> std::io::Result<()> {
        write_layout(Path::new(&self.project_path), layout)?;
        let resolved = resolve_panes(&self.project_path, layout);
        prefs.record_trust(&self.project_path, &commands_hash(&resolved.panes));
        self.layout = layout.clone();
        self.panes = resolved.panes;
        self.warnings = resolved.warnings;
        self.generated = false;
        self.approval = Some(Approved(()));
        Ok(())
    }

    /// The command to send to a pane's shell right after it starts, if the workspace is approved and
    /// the pane has one. The only way out of this crate to a pane's stdin from a layout file.
    pub fn autolaunch(&self, pane_id: &str) -> Option<String> {
        self.approval.as_ref()?;
        self.panes.iter().find(|p| p.id == pane_id)?.command.clone().filter(|c| !c.is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmp() -> PathBuf {
        use std::sync::atomic::{AtomicU32, Ordering};
        static N: AtomicU32 = AtomicU32::new(0);
        let p = std::env::temp_dir().join(format!("myterm-open-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn project(layout: &str) -> (PathBuf, PrefsStore) {
        let d = tmp();
        std::fs::write(d.join(".myterm.json"), layout).unwrap();
        let prefs = PrefsStore::load(d.join("prefs").join("preferences.json"));
        (d, prefs)
    }

    const WITH_COMMANDS: &str = r#"{"version":2,"panes":[{"id":"web","command":"npm run dev"},{"id":"free"}]}"#;

    #[test]
    fn an_unknown_project_with_commands_is_held_and_nothing_launches() {
        let (d, mut prefs) = project(WITH_COMMANDS);
        let OpenResult::NeedsTrust(p) = open_workspace(d.to_str().unwrap(), &mut prefs) else { panic!("must ask") };
        assert_eq!(p.commands.len(), 1);
        assert_eq!(p.commands[0].command, "npm run dev");
        assert!(prefs.get().recent_projects.is_empty(), "not even remembered until it opens");
    }

    #[test]
    fn approving_opens_it_remembers_the_approval_and_allows_the_command() {
        let (d, mut prefs) = project(WITH_COMMANDS);
        let OpenResult::NeedsTrust(p) = open_workspace(d.to_str().unwrap(), &mut prefs) else { panic!() };
        let opened = decide_trust(p, TrustDecision::Approve, &mut prefs).unwrap();
        assert_eq!(opened.autolaunch("web").as_deref(), Some("npm run dev"));
        assert_eq!(opened.autolaunch("free"), None);
        // the next opening goes straight through
        assert!(matches!(open_workspace(d.to_str().unwrap(), &mut prefs), OpenResult::Ok(_)));
    }

    #[test]
    fn open_without_executing_runs_nothing_and_remembers_no_approval() {
        let (d, mut prefs) = project(WITH_COMMANDS);
        let OpenResult::NeedsTrust(p) = open_workspace(d.to_str().unwrap(), &mut prefs) else { panic!() };
        let opened = decide_trust(p, TrustDecision::OpenWithoutExecuting, &mut prefs).unwrap();
        assert_eq!(opened.autolaunch("web"), None);
        assert!(opened.panes.iter().all(|p| p.command.is_none()));
        assert_eq!(opened.panes.len(), 2, "the grid is restored");
        assert!(prefs.get().trusted_projects.is_empty());
        // and asking again next time
        assert!(matches!(open_workspace(d.to_str().unwrap(), &mut prefs), OpenResult::NeedsTrust(_)));
    }

    #[test]
    fn saving_an_edit_trusts_what_the_user_typed_and_the_next_opening_does_not_ask() {
        let (d, mut prefs) = project(r#"{"version":2,"panes":[{"id":"a"}]}"#);
        let OpenResult::Ok(mut opened) = open_workspace(d.to_str().unwrap(), &mut prefs) else { panic!() };
        let mut edited = opened.layout.clone();
        edited.panes[0].command = Some("npm run dev".into());
        opened.save_edit(&edited, &mut prefs).unwrap();
        assert_eq!(opened.autolaunch("a").as_deref(), Some("npm run dev"));
        assert!(std::fs::read_to_string(d.join(".myterm.json")).unwrap().contains("npm run dev"));
        assert!(matches!(open_workspace(d.to_str().unwrap(), &mut prefs), OpenResult::Ok(_)), "typed here, so approved here");
    }

    #[test]
    fn cancelling_opens_nothing() {
        let (d, mut prefs) = project(WITH_COMMANDS);
        let OpenResult::NeedsTrust(p) = open_workspace(d.to_str().unwrap(), &mut prefs) else { panic!() };
        assert!(decide_trust(p, TrustDecision::Cancel, &mut prefs).is_none());
        assert!(prefs.get().trusted_projects.is_empty() && prefs.get().recent_projects.is_empty());
    }

    #[test]
    fn changing_a_command_asks_again_but_renaming_or_moving_a_pane_does_not() {
        let (d, mut prefs) = project(WITH_COMMANDS);
        let OpenResult::NeedsTrust(p) = open_workspace(d.to_str().unwrap(), &mut prefs) else { panic!() };
        decide_trust(p, TrustDecision::Approve, &mut prefs).unwrap();

        let rewrite = |json: &str| std::fs::write(d.join(".myterm.json"), json).unwrap();
        rewrite(r#"{"version":2,"panes":[{"id":"free","title":"scratch"},{"id":"web","title":"renamed","command":"npm run dev"}]}"#);
        assert!(matches!(open_workspace(d.to_str().unwrap(), &mut prefs), OpenResult::Ok(_)), "rename + move: no prompt");
        rewrite(r#"{"version":2,"panes":[{"id":"web","command":"npm run build"},{"id":"free"}]}"#);
        assert!(matches!(open_workspace(d.to_str().unwrap(), &mut prefs), OpenResult::NeedsTrust(_)), "edited command: prompt");
    }

    #[test]
    fn a_layout_with_no_command_has_nothing_to_approve() {
        let (d, mut prefs) = project(r#"{"version":2,"panes":[{"id":"a"},{"id":"b"}]}"#);
        let OpenResult::Ok(o) = open_workspace(d.to_str().unwrap(), &mut prefs) else { panic!() };
        assert_eq!(o.panes.len(), 2);
        assert_eq!(prefs.get().recent_projects.len(), 1, "opening remembers the project");
    }

    #[test]
    fn no_file_opens_one_default_pane_and_writes_nothing_into_the_repository() {
        let d = tmp();
        let mut prefs = PrefsStore::load(d.join("p.json"));
        let OpenResult::Ok(o) = open_workspace(d.to_str().unwrap(), &mut prefs) else { panic!() };
        assert!(o.generated);
        assert_eq!(o.panes.len(), 1);
        assert!(!d.join(".myterm.json").exists());
    }

    #[test]
    fn errors_are_reported_with_the_file_message_and_nothing_opens() {
        let (d, mut prefs) = project("{ nope");
        let OpenResult::Error { message, .. } = open_workspace(d.to_str().unwrap(), &mut prefs) else { panic!() };
        assert!(message.starts_with(".myterm.json n'est pas du JSON valide"));
        let OpenResult::Error { message, .. } = open_workspace(d.join("absent").to_str().unwrap(), &mut prefs) else { panic!() };
        assert_eq!(message, "ce chemin n'est pas un dossier existant");
    }

    #[test]
    fn an_approval_recorded_for_the_resolved_panes_is_recognised() {
        // (The cross-check against real 0.5.0 approvals is `examples/real_data.rs`.)
        let (d, mut prefs) = project(WITH_COMMANDS);
        let OpenResult::NeedsTrust(p) = open_workspace(d.to_str().unwrap(), &mut prefs) else { panic!() };
        let hash = commands_hash(&p.panes_for_test());
        prefs.record_trust(d.to_str().unwrap(), &hash);
        assert!(matches!(open_workspace(d.to_str().unwrap(), &mut prefs), OpenResult::Ok(_)));
    }

    impl PendingTrust {
        fn panes_for_test(&self) -> Vec<ResolvedPane> {
            self.panes.clone()
        }
    }
}
