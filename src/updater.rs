//! Background updates from GitHub Releases. Port of `updater.ts`.
//!
//! Two rules, from the 0.5.0 architecture notes:
//!
//! 1. An update is never installed while a pane is alive unless the user is told what it costs and
//!    accepts: restarting kills every shell (dev servers, agents mid-conversation).
//! 2. Failures are silent. Being offline or rate-limited is not worth interrupting anyone's work.
//!
//! Several instances can run at once, so only the elected one (the oldest alive, `instances.rs`)
//! checks and downloads, and an install with other windows open asks first: the installer closes
//! *every* MyTerm, not just the one whose banner was clicked.
//!
//! The release carries `latest.yml` in the electron-updater format (written by installer/build.ps1),
//! so an installed 0.5.0 (Electron) and this updater read the same file, check the same `sha512` and
//! run the same installer with `/S --updated --force-run`.

use serde::Deserialize;
use sha2::{Digest, Sha512};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// First check a few seconds after start: opening a project fast is a metric, and a network round
/// trip has no business in that path. Then every four hours.
const FIRST_CHECK: Duration = Duration::from_secs(5);
const CHECK_EVERY: Duration = Duration::from_secs(4 * 60 * 60);
const TIMEOUT: Duration = Duration::from_secs(30);
const MAX_YML: u64 = 1024 * 1024;
/// A release installer is ~10 MB; anything near this is not one.
const MAX_INSTALLER: u64 = 400 * 1024 * 1024;

/// An update downloaded, verified and waiting for the user's go.
#[derive(Clone, Debug, PartialEq)]
pub struct Ready {
    pub version: String,
    pub installer: PathBuf,
}

pub type Shared = Arc<Mutex<Option<Ready>>>;

// ---------------------------------------------------------------------------------------------
// latest.yml, versions, hashes
// ---------------------------------------------------------------------------------------------

/// The fields of `latest.yml` the updater uses. Unknown keys (`files`, `releaseDate`, `size`) are ignored.
#[derive(Debug, Deserialize, PartialEq)]
pub struct Latest {
    pub version: String,
    pub path: String,
    pub sha512: String,
}

/// electron-builder writes a flat YAML with one nested list (`files`) the updater does not need, so
/// the top-level `key: value` lines are all that is read: no YAML library for four fields.
pub fn parse_latest_yml(text: &str) -> Option<Latest> {
    let field = |name: &str| {
        text.lines().find_map(|line| {
            // A top-level key: no indentation, so `files[].sha512` (indented) is not confused with it.
            let value = line.strip_prefix(name)?.strip_prefix(':')?;
            Some(value.trim().trim_matches(['\'', '"']).to_string())
        })
    };
    let latest = Latest { version: field("version")?, path: field("path")?, sha512: field("sha512")? };
    (!latest.version.is_empty() && !latest.path.is_empty() && !latest.sha512.is_empty()).then_some(latest)
}

/// `X.Y.Z` only: the release workflow refuses anything else, so no pre-release ordering is needed.
pub fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
    let mut parts = v.trim_start_matches('v').split('.');
    let triple = (parts.next()?.parse().ok()?, parts.next()?.parse().ok()?, parts.next()?.parse().ok()?);
    parts.next().is_none().then_some(triple)
}

pub fn is_newer(remote: &str, current: &str) -> bool {
    matches!((parse_version(remote), parse_version(current)), (Some(r), Some(c)) if r > c)
}

/// An installer name is a file name, nothing else: it ends up in a URL and in a temp folder, and a
/// `latest.yml` with `path: ..\..\x` must not write outside it.
pub fn is_plain_file_name(name: &str) -> bool {
    !name.is_empty() && !name.contains(['/', '\\', ':']) && name != "." && name != ".." && name.to_lowercase().ends_with(".exe")
}

fn base64(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().enumerate().fold(0u32, |acc, (i, b)| acc | (*b as u32) << (16 - 8 * i));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(A[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// What electron-updater compares: the base64 of the SHA-512 of the file.
pub fn sha512_base64(bytes: &[u8]) -> String {
    base64(&Sha512::digest(bytes))
}

// ---------------------------------------------------------------------------------------------
// Where to look
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub struct Source {
    yml: String,
    /// `{version}` and `{name}` are replaced.
    file: String,
}

impl Source {
    /// The latest *published* release (drafts are invisible there, so nobody can land on a
    /// half-uploaded one): `latest.yml` through the `latest/download` redirect, then the installer
    /// from the tag the yml names.
    pub fn github() -> Source {
        Source {
            yml: "https://github.com/gganster/myterm/releases/latest/download/latest.yml".into(),
            file: "https://github.com/gganster/myterm/releases/download/v{version}/{name}".into(),
        }
    }

    /// A folder served over HTTP, for tests and for trying an update locally.
    pub fn at(base: &str) -> Source {
        let base = base.trim_end_matches('/');
        Source { yml: format!("{base}/latest.yml"), file: format!("{base}/{{name}}") }
    }

    /// The source for this run: GitHub in a packaged build. A development build is silent unless
    /// `MYTERM_UPDATE_BASE` names a folder, which a packaged build never reads: an environment
    /// variable must not be able to redirect where an installed MyTerm takes its installer from.
    pub fn for_run(packaged: bool) -> Option<Source> {
        if packaged {
            return Some(Source::github());
        }
        std::env::var("MYTERM_UPDATE_BASE").ok().filter(|b| !b.is_empty()).map(|b| Source::at(&b))
    }

    fn file_url(&self, version: &str, name: &str) -> String {
        self.file.replace("{version}", version).replace("{name}", name)
    }
}

// ---------------------------------------------------------------------------------------------
// Check and download
// ---------------------------------------------------------------------------------------------

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder().timeout_global(Some(TIMEOUT)).http_status_as_error(false).build().into()
}

/// Coarse codes only, like the usage readers: the URL is not worth showing and a log line may be read.
fn get(agent: &ureq::Agent, url: &str, limit: u64) -> Result<Vec<u8>, &'static str> {
    let mut response = agent.get(url).call().map_err(|_| "network")?;
    if !response.status().is_success() {
        return Err("http");
    }
    let mut bytes = Vec::new();
    response.body_mut().with_config().limit(limit).reader().read_to_end(&mut bytes).map_err(|_| "download")?;
    Ok(bytes)
}

/// One check: `None` when up to date, the verified installer on disk when there is a newer one.
pub fn check_once(current: &str, source: &Source, dir: &Path) -> Result<Option<Ready>, &'static str> {
    let agent = agent();
    let yml = String::from_utf8(get(&agent, &source.yml, MAX_YML)?).map_err(|_| "yml")?;
    let latest = parse_latest_yml(&yml).ok_or("yml")?;
    if !is_newer(&latest.version, current) {
        return Ok(None);
    }
    if parse_version(&latest.version).is_none() || !is_plain_file_name(&latest.path) {
        return Err("yml");
    }
    std::fs::create_dir_all(dir).map_err(|_| "disk")?;
    let target = dir.join(&latest.path);
    // Already downloaded by an earlier tick (or an earlier run): verified again, never trusted.
    if let Ok(existing) = std::fs::read(&target) {
        if sha512_base64(&existing) == latest.sha512 {
            return Ok(Some(Ready { version: latest.version, installer: target }));
        }
    }
    let bytes = get(&agent, &source.file_url(&latest.version, &latest.path), MAX_INSTALLER)?;
    if sha512_base64(&bytes) != latest.sha512 {
        return Err("sha512");
    }
    // Written under a temporary name and renamed: a half-written installer never has its final name.
    let partial = dir.join(format!("{}.part", latest.path));
    std::fs::write(&partial, &bytes).map_err(|_| "disk")?;
    std::fs::rename(&partial, &target).map_err(|_| "disk")?;
    Ok(Some(Ready { version: latest.version, installer: target }))
}

/// The download cache the Electron updater (0.5.0) leaves in `%LOCALAPPDATA%\myterm-updater`. The 0.5.0
/// runs the installer from inside it, so the installer cannot delete the folder it is running from: the
/// first start of the new version does, once nothing runs from there any more. Best effort, silent.
pub fn remove_electron_updater_cache(local_app_data: &Path) {
    let dir = local_app_data.join("myterm-updater");
    if dir.is_dir() {
        let _ = std::fs::remove_dir_all(dir);
    }
}

pub fn download_dir() -> PathBuf {
    std::env::temp_dir().join("MyTerm-update")
}

/// Starts the background loop and returns the cell it fills. `is_primary` is asked on every tick,
/// not decided once: the elected instance is the oldest alive, so when it quits the next one picks the
/// duty up on its own with nothing to hand over.
pub fn start(current: &'static str, source: Source, is_primary: fn() -> bool) -> Shared {
    let shared: Shared = Arc::new(Mutex::new(None));
    let cell = shared.clone();
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_CHECK);
        loop {
            if is_primary() {
                match check_once(current, &source, &download_dir()) {
                    Ok(Some(ready)) => *cell.lock().unwrap_or_else(|e| e.into_inner()) = Some(ready),
                    Ok(None) => {}
                    Err(code) => eprintln!("[myterm] vérification de mise à jour échouée ({code})"),
                }
            }
            std::thread::sleep(CHECK_EVERY);
        }
    });
    shared
}

/// Hands over to the installer, detached so it outlives this process. `/S` is silent, `--updated`
/// tells it this is an update, `--force-run` relaunches MyTerm when it is done: the arguments the
/// 0.5.0 updater passes, so one installer serves both.
pub fn run_installer(installer: &Path) -> std::io::Result<()> {
    let mut command = std::process::Command::new(installer);
    command.args(["/S", "--updated", "--force-run"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    command.spawn().map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn the_electron_updater_cache_is_removed_and_nothing_else() {
        let base = tmp("legacy");
        std::fs::create_dir_all(base.join("myterm-updater").join("pending")).unwrap();
        std::fs::write(base.join("myterm-updater").join("pending").join("MyTerm-0.6.1-setup.exe"), "x").unwrap();
        std::fs::create_dir_all(base.join("MyTerm").join("bin")).unwrap();
        remove_electron_updater_cache(&base);
        assert!(!base.join("myterm-updater").exists());
        assert!(base.join("MyTerm").join("bin").exists(), "le shim n'est pas touché");
        remove_electron_updater_cache(&base); // nothing there: no panic
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn latest_yml_is_read_at_top_level_only() {
        let yml = "version: 0.6.0\nfiles:\n  - url: MyTerm-0.6.0-setup.exe\n    sha512: INNER\n    size: 10\npath: MyTerm-0.6.0-setup.exe\nsha512: OUTER==\nreleaseDate: '2026-10-17T10:00:00.000Z'\n";
        assert_eq!(parse_latest_yml(yml), Some(Latest { version: "0.6.0".into(), path: "MyTerm-0.6.0-setup.exe".into(), sha512: "OUTER==".into() }));
        assert_eq!(parse_latest_yml("version: 0.6.0\n"), None);
        assert_eq!(parse_latest_yml("garbage"), None);
    }

    #[test]
    fn only_a_strictly_greater_x_y_z_is_an_update() {
        assert!(is_newer("0.6.1", "0.6.0") && is_newer("0.10.0", "0.9.9") && is_newer("1.0.0", "0.99.99"));
        assert!(!is_newer("0.6.0", "0.6.0") && !is_newer("0.5.9", "0.6.0"));
        assert!(!is_newer("1.0.0-beta.1", "0.6.0") && !is_newer("x", "0.6.0") && !is_newer("1.0", "0.6.0"));
    }

    #[test]
    fn an_installer_name_cannot_leave_its_folder() {
        assert!(is_plain_file_name("MyTerm-0.6.0-setup.exe"));
        for bad in ["..\\x.exe", "../x.exe", "C:\\x.exe", "a/b.exe", "", "..", "setup.msi"] {
            assert!(!is_plain_file_name(bad), "{bad}");
        }
    }

    #[test]
    fn sha512_base64_matches_what_electron_builder_writes() {
        // `printf abc | openssl dgst -sha512 -binary | base64`
        assert_eq!(sha512_base64(b"abc"), "3a81oZNherrMQXNJriBBMRLm+k6JqX6iCp7u5ktV05ohkpkqJ0/BqDa6PCOj/uu9RU1EI2Q86A4qmslPpUyknw==");
    }

    /// Serves `files` (path -> bytes) on a local port for as many requests as there are paths asked.
    fn serve(files: Vec<(&'static str, Vec<u8>)>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut stream = stream;
                let mut buf = [0u8; 2048];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
                match files.iter().find(|(p, _)| *p == path) {
                    Some((_, body)) => {
                        let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                        let _ = stream.write_all(body);
                    }
                    None => {
                        let _ = write!(stream, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    }
                }
            }
        });
        base
    }

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("myterm-upd-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    fn yml(version: &str, name: &str, sha: &str) -> Vec<u8> {
        format!("version: {version}\nfiles:\n  - url: {name}\n    sha512: {sha}\npath: {name}\nsha512: {sha}\n").into_bytes()
    }

    #[test]
    fn a_newer_release_is_downloaded_verified_and_kept() {
        let installer = b"MZ fake installer".to_vec();
        let sha = sha512_base64(&installer);
        let base = serve(vec![("/latest.yml", yml("0.7.0", "MyTerm-0.7.0-setup.exe", &sha)), ("/MyTerm-0.7.0-setup.exe", installer.clone())]);
        let dir = tmp("ok");
        let ready = check_once("0.6.0", &Source::at(&base), &dir).unwrap().unwrap();
        assert_eq!(ready.version, "0.7.0");
        assert_eq!(std::fs::read(&ready.installer).unwrap(), installer);
        assert!(!dir.join("MyTerm-0.7.0-setup.exe.part").exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn up_to_date_downloads_nothing() {
        let base = serve(vec![("/latest.yml", yml("0.6.0", "MyTerm-0.6.0-setup.exe", "x"))]);
        let dir = tmp("same");
        assert_eq!(check_once("0.6.0", &Source::at(&base), &dir), Ok(None));
        assert!(!dir.exists());
    }

    #[test]
    fn a_tampered_installer_is_refused_and_not_kept() {
        let base = serve(vec![("/latest.yml", yml("0.7.0", "MyTerm-0.7.0-setup.exe", &sha512_base64(b"the real one"))), ("/MyTerm-0.7.0-setup.exe", b"something else".to_vec())]);
        let dir = tmp("bad");
        assert_eq!(check_once("0.6.0", &Source::at(&base), &dir), Err("sha512"));
        assert!(!dir.join("MyTerm-0.7.0-setup.exe").exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_yml_naming_a_path_is_refused_before_anything_is_fetched() {
        let base = serve(vec![("/latest.yml", yml("0.7.0", "..\\evil.exe", "x"))]);
        assert_eq!(check_once("0.6.0", &Source::at(&base), &tmp("trav")), Err("yml"));
    }

    #[test]
    fn a_missing_release_and_an_unreachable_server_are_coarse_codes() {
        let base = serve(vec![]);
        assert_eq!(check_once("0.6.0", &Source::at(&base), &tmp("404")), Err("http"));
        assert_eq!(check_once("0.6.0", &Source::at("http://127.0.0.1:1"), &tmp("down")), Err("network"));
    }

    #[test]
    fn a_packaged_build_ignores_the_environment_override() {
        std::env::set_var("MYTERM_UPDATE_BASE", "http://127.0.0.1:9");
        let packaged = Source::for_run(true).unwrap();
        assert!(packaged.yml.starts_with("https://github.com/gganster/myterm/"));
        std::env::remove_var("MYTERM_UPDATE_BASE");
        assert!(Source::for_run(false).is_none());
    }
}
