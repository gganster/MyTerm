//! The installer's contract, read from its source. Port of `tests/installer/*.test.ts`.
//!
//! The PATH half of the 0.5.0 installer shipped broken from 0.1.0 through 0.2.0 and nobody noticed,
//! because everything around it worked: the shim was copied, the registry key written, the installer
//! reported success. Only the PATH entry was missing. Two causes, a guard for each: the PowerShell was
//! inlined in an NSIS string and quoted by doubling quotes (NSIS escapes with `$\'`), and the exit
//! code was printed, never tested.
//!
//! What these assertions cannot prove is that the entry lands in the registry and that a fresh
//! terminal resolves `myterm`: that was run for real on the SANDBOX build (see trace.md).

use regex::Regex;
use std::path::PathBuf;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn read(relative: &str) -> String {
    std::fs::read_to_string(root().join(relative)).unwrap_or_else(|e| panic!("{relative}: {e}"))
}

/// The real (non-sandbox) values of `paths.nsh`: the branch after `!else`.
fn real_paths() -> Vec<(String, String)> {
    let paths = read("installer/paths.nsh");
    let real = paths.split("!else").nth(1).expect("!else").split("!endif").next().unwrap();
    let define = Regex::new(r#"!define\s+(\w+)\s+"([^"]*)""#).unwrap();
    define.captures_iter(real).map(|c| (c[1].to_string(), c[2].to_string())).collect()
}

/// The script without comments, defines resolved to the real branch.
fn nsi_code() -> String {
    let mut text: String = read("installer/myterm.nsi").lines().filter(|l| !l.trim_start().starts_with(';')).collect::<Vec<_>>().join("\n");
    for (name, value) in real_paths() {
        text = text.replace(&format!("${{{name}}}"), &value);
    }
    text
}

fn macro_body(code: &str, name: &str) -> String {
    let start = code.find(&format!("!macro {name}")).unwrap_or_else(|| panic!("macro {name} introuvable"));
    let end = code[start..].find("!macroend").expect("!macroend") + start;
    code[start..end].to_string()
}

fn ps1_code() -> String {
    let text = read("installer/path-entry.ps1");
    let block = Regex::new(r"(?s)<#.*?#>").unwrap();
    block.replace_all(&text, "").lines().filter(|l| !l.trim_start().starts_with('#')).collect::<Vec<_>>().join("\n")
}

struct RegWrite {
    root: String,
    key: String,
    value_name: String,
    value: String,
}

fn writes_in(body: &str) -> Vec<RegWrite> {
    let pattern = Regex::new(r#"(?m)^\s*WriteRegStr\s+(\S+)\s+"([^"]*)"\s+"([^"]*)"\s+(.+)$"#).unwrap();
    pattern.captures_iter(body).map(|c| RegWrite { root: c[1].into(), key: c[2].into(), value_name: c[3].into(), value: c[4].trim().into() }).collect()
}

fn deletes_in(body: &str) -> Vec<(String, String)> {
    let pattern = Regex::new(r#"(?m)^\s*DeleteRegKey\s+(?:/ifempty\s+)?(\S+)\s+"([^"]*)""#).unwrap();
    pattern.captures_iter(body).map(|c| (c[1].to_string(), c[2].to_string())).collect()
}

const CONTEXT_MENU_KEYS: [&str; 2] = ["Software\\Classes\\Directory\\shell\\MyTerm", "Software\\Classes\\Directory\\Background\\shell\\MyTerm"];

#[test]
fn the_context_menu_has_a_verb_on_the_folder_and_one_in_its_background() {
    let install = macro_body(&nsi_code(), "customInstall");
    let writes = writes_in(&install);
    for key in CONTEXT_MENU_KEYS {
        let label = writes.iter().find(|w| w.key == key && w.value_name.is_empty()).unwrap_or_else(|| panic!("libellé manquant pour {key}"));
        assert!(label.value.contains("MyTerm"));
    }
}

#[test]
fn the_verbs_launch_the_installed_exe_with_percent_v_quoted() {
    let install = macro_body(&nsi_code(), "customInstall");
    let writes = writes_in(&install);
    for key in CONTEXT_MENU_KEYS {
        let command = writes.iter().find(|w| w.key == format!("{key}\\command")).unwrap_or_else(|| panic!("commande manquante pour {key}"));
        // The executable, not the .cmd shim (a console window flashes); %V, never %1 (empty in the
        // background menu); quoted, or a folder with a space breaks the command.
        assert_eq!(command.value, r#"'"$INSTDIR\MyTerm.exe" "%V"'"#);
    }
}

#[test]
fn the_verb_hides_when_several_folders_are_selected() {
    let writes = writes_in(&macro_body(&nsi_code(), "customInstall"));
    let model = writes.iter().find(|w| w.key == CONTEXT_MENU_KEYS[0] && w.value_name == "MultiSelectModel").unwrap();
    assert_eq!(model.value, "\"Single\"");
}

#[test]
fn everything_is_per_user_and_nothing_asks_for_elevation() {
    let code = nsi_code();
    for w in writes_in(&code) {
        assert_eq!(w.root, "HKCU", "{} écrit hors de HKCU", w.key);
    }
    let written = Regex::new(r"(?m)^\s*WriteReg\w+").unwrap().find_iter(&code).count();
    assert_eq!(writes_in(&code).len() + 2, written, "le parseur doit voir toutes les écritures (2 DWORD NoModify/NoRepair)");
    assert!(!Regex::new(r"\b(HKLM|HKCR|HKEY_LOCAL_MACHINE|HKEY_CLASSES_ROOT)\b").unwrap().is_match(&code));
    assert!(code.contains("RequestExecutionLevel user"));
    assert!(!code.contains("RequestExecutionLevel admin") && !code.contains("RequestExecutionLevel highest"));
}

#[test]
fn uninstalling_removes_every_key_the_install_created_and_no_shared_branch() {
    let code = nsi_code();
    let deletes = deletes_in(&code);
    for w in writes_in(&code) {
        let covered = deletes.iter().any(|(root, key)| *root == w.root && (w.key == *key || w.key.starts_with(&format!("{key}\\"))));
        assert!(covered, "{}\\{} n'est jamais supprimée", w.root, w.key);
    }
    let shared = [
        "Software",
        "Software\\Classes",
        "Software\\Classes\\Directory",
        "Software\\Classes\\Directory\\shell",
        "Software\\Classes\\Directory\\Background",
        "Software\\Classes\\Directory\\Background\\shell",
        "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    ];
    for (_, key) in &deletes {
        let k = key.trim_end_matches('\\').to_lowercase();
        assert!(!shared.iter().any(|s| s.to_lowercase() == k), "la désinstallation supprime {key}, branche partagée");
    }
}

#[test]
fn the_installer_is_a_drop_in_for_the_electron_one() {
    let code = nsi_code();
    // The same "Installed apps" key as 0.5.0, so an update leaves one entry and not two.
    assert!(code.contains("bb20937c-569f-5a89-9956-bcc0a0242b0b"));
    // The same executable name: shortcuts, context menu and a pinned button written by 0.5.0 point at it.
    assert!(code.contains(r#"/oname=MyTerm.exe"#));
    assert!(code.contains(r#"InstallDir "$LOCALAPPDATA\Programs\MyTerm""#));
    // The arguments the 0.5.0 updater passes.
    assert!(code.contains("--force-run"));
    // The shortcuts carry the AppUserModelID the app claims.
    assert!(code.contains(r#"!define AUMID "dev.gganster.myterm""#) || code.contains("dev.gganster.myterm"));
    assert!(code.contains("SetLnkAUMI"));
    // An update installs over the files: it never runs an uninstaller of its own, which would tear
    // the PATH entry and the context menu down and rebuild them (and lose them if it aborted).
    assert!(!Regex::new(r"ExecWait[^\n]*Uninstall").unwrap().is_match(&code));
}

#[test]
fn the_sandbox_build_cannot_reach_the_real_keys() {
    let paths = read("installer/paths.nsh");
    let sandbox = paths.split("!else").next().unwrap();
    for line in sandbox.lines().filter(|l| l.contains("!define")) {
        assert!(line.contains("MyTermSandbox") || line.contains("$INSTDIR"), "{line}");
    }
}

// ---- the PATH half -------------------------------------------------------------------------------

#[test]
fn both_macros_edit_the_path_through_the_script_with_dash_file() {
    let code = nsi_code();
    let (install, uninstall) = (macro_body(&code, "customInstall"), macro_body(&code, "customUnInstall"));
    for body in [&install, &uninstall] {
        assert!(body.contains("path-entry.ps1"));
        assert!(body.contains("-NoProfile") && body.contains("-NonInteractive") && body.contains("-ExecutionPolicy Bypass"));
        assert!(Regex::new(r#"-File "\$LOCALAPPDATA\\MyTerm\\bin\\path-entry\.ps1""#).unwrap().is_match(body));
    }
    assert!(Regex::new(r"-Mode\s+Add").unwrap().is_match(&install));
    assert!(Regex::new(r"-Mode\s+Remove").unwrap().is_match(&uninstall));
}

#[test]
fn no_inline_powershell_and_no_doubled_quotes() {
    let code = nsi_code();
    assert!(!code.contains("-Command"));
    assert!(!code.contains("''"), "NSIS échappe avec $\\', jamais en doublant");
}

#[test]
fn the_script_is_copied_next_to_the_shim_outside_the_uninstalled_folder() {
    let code = nsi_code();
    let (install, uninstall) = (macro_body(&code, "customInstall"), macro_body(&code, "customUnInstall"));
    assert!(install.contains(r"$INSTDIR\resources\path-entry.ps1"));
    assert!(install.contains(r"$LOCALAPPDATA\MyTerm\bin\path-entry.ps1"));
    assert!(uninstall.contains(r#"Delete "$LOCALAPPDATA\MyTerm\bin\path-entry.ps1""#));
    assert!(uninstall.contains(r#"Delete "$LOCALAPPDATA\MyTerm\bin\myterm.cmd""#));
}

#[test]
fn the_exit_code_is_tested_not_just_printed() {
    let install = macro_body(&nsi_code(), "customInstall");
    let call = &install[install.find("path-entry.ps1").unwrap()..];
    assert!(call.contains("Pop $0"));
    assert!(Regex::new(r"\$\{If\}\s+\$0\s*==\s*0").unwrap().is_match(call));
    assert!(call.contains("${Else}"));
    assert!(Regex::new(r"(?s)ECHEC.*myterm").unwrap().is_match(call));
}

#[test]
fn the_ps1_cannot_break_the_rest_of_the_path() {
    let ps1 = ps1_code();
    // SetEnvironmentVariable always writes REG_SZ and would turn every %VAR% of an expandable PATH
    // into a dead literal.
    assert!(!ps1.contains("SetEnvironmentVariable"));
    assert!(ps1.contains("GetValueKind"));
    assert!(ps1.contains("SetValue('Path', $joined, $kind)"));
    assert!(ps1.contains("DoNotExpandEnvironmentNames"));
    // Without the broadcast, new terminals keep a stale environment until the next sign-out.
    assert!(ps1.contains("WM_SETTINGCHANGE") && ps1.contains("SendMessageTimeout"));
    assert!(ps1.contains("exit 2") && ps1.contains("exit 3") && ps1.contains("exit 0"));
    assert!(Regex::new(r"ValidateSet\('Add',\s*'Remove'\)").unwrap().is_match(&ps1));
    // Appended, so MyTerm never shadows a command the user already resolves.
    assert!(ps1.contains("@($without + $bin)"));
}

#[test]
fn the_shim_finds_the_install_dir_from_the_registry_and_detaches() {
    let shim = read("installer/myterm.cmd");
    assert!(shim.contains(r#"reg query "HKCU\Software\MyTerm" /v InstallDir"#));
    assert!(shim.contains(r#"start "" "%MYTERM_EXE%""#));
}

#[test]
fn the_sandbox_installer_defaults_to_a_temp_folder_never_the_real_one() {
    let nsi = read("installer/myterm.nsi");
    let sandbox = nsi.split("!ifdef SANDBOX").nth(1).unwrap().split("!else").next().unwrap();
    assert!(sandbox.contains(r#"InstallDir "$TEMP\myterm-sandbox-install""#));
}

// ---- the release workflow ------------------------------------------------------------------------
//
// It cannot run here (it needs GitHub); what is checked is that the guardrails of the 0.5.0 workflow
// survived the port, one assertion each.

fn workflow(name: &str) -> String {
    read(&format!(".github/workflows/{name}"))
}

#[test]
fn the_release_workflow_keeps_every_guardrail_of_the_electron_one() {
    let yml = workflow("release.yml");
    // The version is validated as X.Y.Z before it becomes a tag or a step output, and read from Cargo.toml.
    assert!(yml.contains(r"/^\d+\.\d+\.\d+$/") && yml.contains("Cargo.toml") && !yml.contains("package.json"));
    // A version not strictly above the highest published one is refused: publishing it would be marked
    // "latest" and freeze the updates of every install.
    assert!(yml.contains("regression:") && yml.contains("cmp(mine, highest) <= 0"));
    // Draft first, upload into it, publish last: a draft is invisible to /releases/latest.
    assert!(yml.contains("draft=true") && yml.contains("draft=false"));
    let (draft, upload, promote) = (yml.find("draft=true").unwrap(), yml.find("Upload to the draft").unwrap(), yml.find("draft=false").unwrap());
    assert!(draft < upload && upload < promote, "brouillon, puis téléversement, puis publication");
    // Never promote a release the updater could not see, nor one that holds two tags' worth of ambiguity.
    assert!(yml.contains("latest.yml absent") && yml.contains("Aucun installeur .exe"));
    assert!(yml.contains("Publication refusée : impossible de choisir"));
    assert!(yml.contains("make_latest"));
    // Two pushes must not race to create the same release, and a build is never cancelled mid-upload.
    assert!(yml.contains("cancel-in-progress: false") && yml.contains("group: release"));
    // The job token can write: it must not stay in .git/config for the whole job.
    assert!(yml.contains("persist-credentials: false"));
    // A dry run publishes nothing and does not even ask GitHub.
    assert!(yml.contains("workflow_dispatch") && yml.contains("Build à blanc"));
    // It publishes the repository the installed apps read from.
    assert!(read("src/updater.rs").contains("github.com/gganster/myterm"));
}

#[test]
fn ci_builds_the_installer_without_publishing() {
    let yml = workflow("ci.yml");
    assert!(yml.contains("cargo test") && yml.contains("installer/build.ps1"));
    assert!(yml.contains("contents: read") && !yml.contains("contents: write"));
    assert!(!yml.contains("releases"));
}

#[test]
fn the_build_script_writes_latest_yml_in_the_electron_updater_format() {
    let ps1 = read("installer/build.ps1");
    for needle in ["version: $version", "- url: $name", "sha512: $sha512", "path: $name", "releaseDate:"] {
        assert!(ps1.contains(needle), "{needle}");
    }
    assert!(ps1.contains("SHA512") && ps1.contains("ToBase64String"));
}

// ---- leaving no trace of the Electron install ----------------------------------------------------

#[test]
fn the_electron_leftovers_are_removed_by_name_and_never_the_whole_install_folder() {
    let code = nsi_code();
    let body = macro_body(&code, "removeElectronTraces");
    // Only when the folder really is an Electron install of ours.
    assert!(body.contains(r#"FileExists} "$INSTDIR\resources\app.asar""#));
    for needle in ["app.asar.unpacked", "locales", "chrome_100_percent.pak", "snapshot_blob.bin", "vulkan-1.dll", "app-update.yml"] {
        assert!(body.contains(needle), "{needle}");
    }
    // The bookkeeping key of electron-builder and the updater's cache.
    assert!(body.contains(r#"DeleteRegKey HKCU "Software\bb20937c-569f-5a89-9956-bcc0a0242b0b""#));
    assert!(body.contains(r#"RMDir /r "$LOCALAPPDATA\myterm-updater""#));
    for line in body.lines().filter(|l| l.contains("RMDir /r")) {
        assert!(!Regex::new(r#"RMDir /r "\$INSTDIR"\s*$"#).unwrap().is_match(line), "{line}");
    }
    // Runs before the files are laid down, so the shim copy and ours are never swept.
    let section = &code[code.find("Section \"MyTerm\"").unwrap()..];
    assert!(section.find("removeElectronTraces").unwrap() < section.find("File \"/oname=MyTerm.exe\"").unwrap());
    // The user's data is the point of the update: nothing here may name it.
    assert!(!code.contains(r"$APPDATA\MyTerm") && !code.contains("preferences.json"));
}

#[test]
fn an_update_does_not_bring_back_a_desktop_shortcut_the_user_never_had() {
    let code = nsi_code();
    let desktop = code.find(r#"CreateShortCut "$DESKTOP\MyTerm.lnk""#).expect("desktop shortcut");
    let guard = code[..desktop].rfind("${If} $Fresh == 1").expect("guard");
    assert!(code[guard..desktop].lines().count() <= 3, "le raccourci doit être dans la garde");
    assert!(code.contains(r#"${If} ${FileExists} "$INSTDIR\MyTerm.exe""#));
}
