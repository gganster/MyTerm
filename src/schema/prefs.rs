//! Global preferences (`preferences.json`). Port of `schema/preferences.ts`.
//!
//! Field order is the order 0.5.0 writes (`mergePreferences` builds `version, theme, window,
//! recentProjects, trustedProjects`), so a file saved by either build is byte-identical.

use super::layout::ThemeMode;
use super::zod::Validator;
use serde::Serialize;
use serde_json::Value;

pub const PREFERENCES_VERSION: u8 = 1;
pub const MAX_RECENT_PROJECTS: usize = 15;
pub const MAX_TRUSTED_PROJECTS: usize = 200;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    pub last_opened_at: String,
    /// Computed at read time, never persisted: the folder is gone right now.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedProject {
    pub path: String,
    /// Hash of the pane commands that were approved.
    pub commands_hash: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct WindowState {
    pub width: i64,
    pub height: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<i64>,
    pub maximized: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        WindowState { width: 1600, height: 1000, x: None, y: None, maximized: false }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub version: u8,
    pub theme: ThemeMode,
    pub window: WindowState,
    pub recent_projects: Vec<RecentProject>,
    pub trusted_projects: Vec<TrustedProject>,
}

impl Default for Preferences {
    fn default() -> Self {
        Preferences {
            version: PREFERENCES_VERSION,
            theme: ThemeMode::System,
            window: WindowState::default(),
            recent_projects: vec![],
            trusted_projects: vec![],
        }
    }
}

fn parse_window(v: &mut Validator, raw: Option<&Value>) -> Option<WindowState> {
    let Some(raw) = raw else { return Some(WindowState::default()) };
    let obj = v.object(Some(raw))?;
    let before = v.count();
    let dim = |v: &mut Validator, key: &str, min: i64, default: i64| match obj.get(key) {
        None => Some(default),
        Some(n) => v.at(key, |v| v.int(n, Some(min))),
    };
    let width = dim(v, "width", 480, 1600);
    let height = dim(v, "height", 320, 1000);
    let coord = |v: &mut Validator, key: &str| obj.get(key).and_then(|n| v.at(key, |v| v.int(n, None)));
    let (x, y) = (coord(v, "x"), coord(v, "y"));
    let maximized = v.at("maximized", |v| v.boolean_or(obj.get("maximized"), false));
    (v.count() == before).then(|| WindowState { width: width.unwrap(), height: height.unwrap(), x, y, maximized })
}

fn list<T>(
    v: &mut Validator,
    key: &str,
    raw: Option<&Value>,
    one: impl Fn(&mut Validator, &Value) -> Option<T>,
) -> Vec<T> {
    match raw {
        None => vec![],
        Some(Value::Array(items)) => v.at(key, |v| {
            items.iter().enumerate().filter_map(|(i, item)| v.at(i, |v| one(v, item))).collect()
        }),
        other => {
            v.at(key, |v| {
                v.issue(format!("Invalid input: expected array, received {}", super::zod::received(other)))
            });
            vec![]
        }
    }
}

fn parse_recent(v: &mut Validator, raw: &Value) -> Option<RecentProject> {
    let obj = v.object(Some(raw))?;
    let before = v.count();
    let path = v.at("path", |v| v.string(obj.get("path"), true));
    let name = v.at("name", |v| v.string(obj.get("name"), false));
    let last = v.at("lastOpenedAt", |v| v.string(obj.get("lastOpenedAt"), false));
    let missing = v.at("missing", |v| v.optional_bool(obj.get("missing")));
    (v.count() == before)
        .then(|| RecentProject { path: path.unwrap(), name: name.unwrap(), last_opened_at: last.unwrap(), missing })
}

fn parse_trusted(v: &mut Validator, raw: &Value) -> Option<TrustedProject> {
    let obj = v.object(Some(raw))?;
    let before = v.count();
    let path = v.at("path", |v| v.string(obj.get("path"), true));
    let hash = v.at("commandsHash", |v| v.string(obj.get("commandsHash"), false));
    (v.count() == before).then(|| TrustedProject { path: path.unwrap(), commands_hash: hash.unwrap() })
}

/// Validates a raw `preferences.json` value; `Err` carries every problem as `path : message`.
pub fn parse_preferences(raw: &Value) -> Result<Preferences, Vec<String>> {
    let mut v = Validator::new();
    let Some(obj) = v.object(Some(raw)) else { return Err(v.issues) };
    if obj.get("version").and_then(Value::as_f64) != Some(PREFERENCES_VERSION as f64) {
        v.at("version", |v| v.issue(format!("Invalid input: expected {PREFERENCES_VERSION}")));
    }
    let theme = match obj.get("theme") {
        None => Some(ThemeMode::System),
        Some(t) => v.at("theme", |v| v.choice(t, ThemeMode::ALL)),
    };
    let recent_projects = list(&mut v, "recentProjects", obj.get("recentProjects"), parse_recent);
    let trusted_projects = list(&mut v, "trustedProjects", obj.get("trustedProjects"), parse_trusted);
    let window = v.at("window", |v| parse_window(v, obj.get("window")));
    if !v.issues.is_empty() {
        return Err(v.issues);
    }
    Ok(Preferences {
        version: PREFERENCES_VERSION,
        theme: theme.unwrap(),
        window: window.unwrap(),
        recent_projects,
        trusted_projects,
    })
}
