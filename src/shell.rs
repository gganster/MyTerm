//! Which executable a pane's `shell` name means. Port of `resolveShell` in `pty-manager.ts`.

use std::path::{Path, PathBuf};

/// Shell names accepted in `.myterm.json`, mapped to their Windows executable.
fn executable_for(name: &str) -> &str {
    match name {
        "pwsh" => "pwsh.exe",
        "powershell" => "powershell.exe",
        "cmd" => "cmd.exe",
        "bash" => "bash.exe",
        other => other,
    }
}

fn find_on_path(executable: &str, path_var: &str) -> Option<PathBuf> {
    std::env::split_paths(path_var)
        .filter(|dir| !dir.as_os_str().is_empty())
        .map(|dir| dir.join(executable))
        .find(|candidate| Path::new(candidate).is_file())
}

/// `pwsh` is preferred but not installed by default on Windows; Windows PowerShell always is. A pane
/// that asks for a shell we cannot find falls back rather than failing to open.
pub fn resolve_shell(requested: &str) -> String {
    resolve_shell_in(requested, &std::env::var("PATH").unwrap_or_default())
}

pub fn resolve_shell_in(requested: &str, path_var: &str) -> String {
    let wanted = executable_for(requested);
    if let Some(found) = find_on_path(wanted, path_var) {
        return found.to_string_lossy().into_owned();
    }
    for fallback in ["powershell.exe", "cmd.exe"] {
        if let Some(alt) = find_on_path(fallback, path_var) {
            return alt.to_string_lossy().into_owned();
        }
    }
    // Let the spawn report the error: every fallback is missing.
    wanted.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bin_dir(files: &[&str]) -> PathBuf {
        use std::sync::atomic::{AtomicU32, Ordering};
        static N: AtomicU32 = AtomicU32::new(0);
        let d = std::env::temp_dir().join(format!("myterm-shell-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
        std::fs::create_dir_all(&d).unwrap();
        for f in files {
            std::fs::write(d.join(f), "").unwrap();
        }
        d
    }

    #[test]
    fn maps_the_names_of_the_file_to_executables_found_on_path() {
        let d = bin_dir(&["pwsh.exe", "cmd.exe"]);
        let path = d.to_string_lossy().into_owned();
        assert_eq!(resolve_shell_in("pwsh", &path), d.join("pwsh.exe").to_string_lossy());
        assert_eq!(resolve_shell_in("cmd", &path), d.join("cmd.exe").to_string_lossy());
    }

    #[test]
    fn falls_back_to_windows_powershell_then_cmd_rather_than_failing() {
        let d = bin_dir(&["powershell.exe", "cmd.exe"]);
        assert_eq!(resolve_shell_in("pwsh", &d.to_string_lossy()), d.join("powershell.exe").to_string_lossy());
        let d = bin_dir(&["cmd.exe"]);
        assert_eq!(resolve_shell_in("bash", &d.to_string_lossy()), d.join("cmd.exe").to_string_lossy());
    }

    #[test]
    fn when_nothing_is_found_the_spawn_gets_to_report_it() {
        let d = bin_dir(&[]);
        assert_eq!(resolve_shell_in("pwsh", &d.to_string_lossy()), "pwsh.exe");
    }
}
