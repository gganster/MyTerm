//! Canonical form of a project path for comparison (`normaliseProjectPath`).

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Platform {
    Win32,
    Other,
}

impl Platform {
    pub fn host() -> Self {
        if cfg!(windows) {
            Platform::Win32
        } else {
            Platform::Other
        }
    }
}

/// Trailing separators dropped; lowercased on Windows, where `C:\Proj`, `c:\proj` and `C:\Proj\` are one project.
pub fn normalise_project_path(path: &str, platform: Platform) -> String {
    let trimmed = path.trim_end_matches(['\\', '/']);
    match platform {
        Platform::Win32 => trimmed.to_lowercase(),
        Platform::Other => trimmed.to_string(),
    }
}
