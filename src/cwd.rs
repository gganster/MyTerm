//! Path containment for pane working directories. Port of `resolve-cwd.ts` and the part of Node's
//! `path.win32.resolve` it relies on (the only target is Windows, and every interesting failure
//! here is Windows-specific).
//!
//! A `.myterm.json` is committed and cloned, so `cwd: "../../Windows"` in a hostile layout must not
//! send a pane off the project. Comparison is case-insensitive, and the trailing separator keeps
//! `C:\proj2` from passing for a child of `C:\proj`.

use crate::path_key::Platform;
use std::fmt;

#[derive(Debug, PartialEq, Eq)]
pub struct PathOutsideProject {
    pub project_root: String,
    pub requested: String,
}

impl fmt::Display for PathOutsideProject {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "« {} » sort de la racine du projet ({})", self.requested, self.project_root)
    }
}

impl std::error::Error for PathOutsideProject {}

fn is_sep(c: char) -> bool {
    c == '\\' || c == '/'
}

/// Collapses `.` and `..`; `above_root` keeps leading `..` of a relative path.
fn normalize_segments(path: &str, above_root: bool) -> String {
    let mut out: Vec<&str> = Vec::new();
    for seg in path.split(is_sep) {
        match seg {
            "" | "." => {}
            ".." => {
                if out.last().is_some_and(|l| *l != "..") {
                    out.pop();
                } else if above_root {
                    out.push("..");
                }
            }
            s => out.push(s),
        }
    }
    out.join("\\")
}

/// Splits `path` into (device, root_end, is_absolute) the way Node's win32 resolver does.
fn split_root(path: &[char]) -> (String, usize, bool) {
    let len = path.len();
    if len == 0 {
        return (String::new(), 0, false);
    }
    let code = path[0];
    if is_sep(code) {
        if len > 1 && is_sep(path[1]) {
            // Possible UNC root: \\server\share
            let mut j = 2;
            let mut last = j;
            while j < len && !is_sep(path[j]) {
                j += 1;
            }
            if j < len && j != last {
                let first: String = path[last..j].iter().collect();
                last = j;
                while j < len && is_sep(path[j]) {
                    j += 1;
                }
                if j < len && j != last {
                    last = j;
                    while j < len && !is_sep(path[j]) {
                        j += 1;
                    }
                    if j == len || j != last {
                        let share: String = path[last..j].iter().collect();
                        return (format!("\\\\{first}\\{share}"), j, true);
                    }
                }
            }
            // Not a complete UNC root: absolute, but nothing is consumed as a device.
            return (String::new(), 0, true);
        }
        return (String::new(), 1, true);
    }
    if code.is_ascii_alphabetic() && len > 1 && path[1] == ':' {
        let device: String = path[..2].iter().collect();
        if len > 2 && is_sep(path[2]) {
            return (device, 3, true);
        }
        return (device, 2, false);
    }
    (String::new(), 0, false)
}

/// `path.win32.resolve(...args)`.
pub fn resolve_win32(args: &[&str]) -> String {
    let mut device = String::new();
    let mut tail = String::new();
    let mut absolute = false;

    let mut i = args.len() as isize - 1;
    while i >= -1 {
        let path: String = if i >= 0 {
            let p = args[i as usize];
            i -= 1;
            if p.is_empty() {
                continue;
            }
            p.to_string()
        } else {
            i -= 1;
            let cwd = std::env::current_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
            if device.is_empty() || cwd.to_lowercase().starts_with(&device.to_lowercase()) {
                cwd
            } else {
                format!("{device}\\")
            }
        };
        let chars: Vec<char> = path.chars().collect();
        let (dev, root_end, is_abs) = split_root(&chars);

        if !dev.is_empty() {
            if !device.is_empty() {
                if dev.to_lowercase() != device.to_lowercase() {
                    continue;
                }
            } else {
                device = dev;
            }
        }
        if absolute {
            if !device.is_empty() {
                break;
            }
        } else {
            let rest: String = chars[root_end..].iter().collect();
            tail = format!("{rest}\\{tail}");
            absolute = is_abs;
            if is_abs && !device.is_empty() {
                break;
            }
        }
    }

    let tail = normalize_segments(&tail, !absolute);
    if absolute {
        format!("{device}\\{tail}")
    } else if device.is_empty() && tail.is_empty() {
        ".".into()
    } else {
        format!("{device}{tail}")
    }
}

fn is_absolute_win32(path: &str) -> bool {
    let c: Vec<char> = path.chars().take(3).collect();
    match c.as_slice() {
        [] => false,
        [a, ..] if is_sep(*a) => true,
        [d, ':', s, ..] => d.is_ascii_alphabetic() && is_sep(*s),
        _ => false,
    }
}

fn normalise(path: &str) -> String {
    let resolved = resolve_win32(&[path]);
    if Platform::host() == Platform::Win32 {
        resolved.to_lowercase()
    } else {
        resolved
    }
}

pub fn is_inside_root(project_root: &str, candidate: &str) -> bool {
    let root = normalise(project_root);
    let target = normalise(candidate);
    if target == root {
        return true;
    }
    let prefix = if root.ends_with('\\') { root } else { format!("{root}\\") };
    target.starts_with(&prefix)
}

/// The folder a picker returned, as a pane `cwd`: relative to the project and `/`-separated, because
/// an absolute path in the file would not survive being cloned onto another machine. `None` when it
/// is outside the project.
pub fn relative_to_project(project_root: &str, picked: &str) -> Option<String> {
    if !is_inside_root(project_root, picked) {
        return None;
    }
    let (root, picked) = (resolve_win32(&[project_root]), resolve_win32(&[picked]));
    let rest = picked.get(root.len()..)?.trim_start_matches(['\\', '/']);
    Some(if rest.is_empty() { ".".into() } else { rest.replace('\\', "/") })
}

/// Resolves a pane cwd. An absolute path is allowed only if it still lands inside the project.
pub fn resolve_cwd(project_root: &str, cwd: &str) -> Result<String, PathOutsideProject> {
    let target = if is_absolute_win32(cwd) { resolve_win32(&[cwd]) } else { resolve_win32(&[project_root, cwd]) };
    if !is_inside_root(project_root, &target) {
        return Err(PathOutsideProject { project_root: project_root.into(), requested: cwd.into() });
    }
    Ok(target)
}
