//! The `.myterm.json` contract (v2). Port of `src/shared/schema/layout.ts`.

use super::zod::Validator;
use serde::Serialize;
use serde_json::Value;

pub const LAYOUT_VERSION: u8 = 2;
/// A sanity limit, not a target: past a dozen panes each terminal is a few lines tall.
pub const MAX_PANES: usize = 24;

macro_rules! name_enum {
    ($(#[$m:meta])* $name:ident { $($variant:ident => $s:literal),+ $(,)? }) => {
        $(#[$m])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
        pub enum $name { $(#[serde(rename = $s)] $variant),+ }
        impl $name {
            pub const ALL: &'static [(&'static str, $name)] = &[$(($s, $name::$variant)),+];
            pub fn as_str(self) -> &'static str { match self { $($name::$variant => $s),+ } }
        }
    };
}

name_enum!(Shell { Pwsh => "pwsh", Powershell => "powershell", Cmd => "cmd", Bash => "bash" });
name_enum!(ThemeMode { Light => "light", Dark => "dark", System => "system" });
name_enum!(
    /// The pane border palette, as names: a closed list that stays legible in both themes.
    PaneColor {
        Red => "red", Orange => "orange", Yellow => "yellow", Green => "green",
        Cyan => "cyan", Blue => "blue", Purple => "purple", Pink => "pink",
    }
);

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Pane {
    pub id: String,
    pub title: String,
    pub cwd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shell: Option<Shell>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<PaneColor>,
    /// Start folded into the bottom bar. Absent, not `false`, when never set: no noise in everyone's diff.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collapsed: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Defaults {
    pub shell: Shell,
    pub cwd: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Layout {
    pub version: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The instance colour.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<PaneColor>,
    pub theme: ThemeMode,
    pub defaults: Defaults,
    pub panes: Vec<Pane>,
}

impl Pane {
    pub fn new(id: impl Into<String>) -> Self {
        Pane { id: id.into(), title: String::new(), cwd: ".".into(), shell: None, command: None, color: None, collapsed: None }
    }
}

/// Layout used when a project has no `.myterm.json`. Never written to disk on its own.
pub fn default_layout(name: Option<&str>) -> Layout {
    Layout {
        version: LAYOUT_VERSION,
        name: name.map(str::to_string),
        color: None,
        theme: ThemeMode::System,
        defaults: Defaults { shell: Shell::Pwsh, cwd: ".".into() },
        panes: vec![Pane::new("pane-1")],
    }
}

/// Effective shell for a pane, applying the layout-level default.
pub fn pane_shell(layout: &Layout, pane: &Pane) -> Shell {
    pane.shell.unwrap_or(layout.defaults.shell)
}

fn optional_choice<T: Copy>(v: &mut Validator, value: Option<&Value>, options: &[(&str, T)]) -> Option<T> {
    value.and_then(|value| v.choice(value, options))
}

fn parse_pane(v: &mut Validator, raw: &Value) -> Option<Pane> {
    let obj = v.object(Some(raw))?;
    let before = v.count();
    let id = v.at("id", |v| v.string(obj.get("id"), true));
    let title = match obj.get("title") {
        None => Some(String::new()),
        some => v.at("title", |v| v.string(some, false)),
    };
    let cwd = match obj.get("cwd") {
        None => Some(".".to_string()),
        some => v.at("cwd", |v| v.string(some, false)),
    };
    let shell = v.at("shell", |v| optional_choice(v, obj.get("shell"), Shell::ALL));
    let command = v.at("command", |v| v.optional_string(obj.get("command")));
    let color = v.at("color", |v| optional_choice(v, obj.get("color"), PaneColor::ALL));
    let collapsed = v.at("collapsed", |v| v.optional_bool(obj.get("collapsed")));
    if v.count() != before {
        return None;
    }
    Some(Pane { id: id?, title: title?, cwd: cwd?, shell, command, color, collapsed })
}

fn parse_defaults(v: &mut Validator, raw: Option<&Value>) -> Option<Defaults> {
    let Some(raw) = raw else { return Some(Defaults { shell: Shell::Pwsh, cwd: ".".into() }) };
    let obj = v.object(Some(raw))?;
    let before = v.count();
    let shell = match obj.get("shell") {
        None => Some(Shell::Pwsh),
        Some(s) => v.at("shell", |v| v.choice(s, Shell::ALL)),
    };
    let cwd = match obj.get("cwd") {
        None => Some(".".to_string()),
        some => v.at("cwd", |v| v.string(some, false)),
    };
    (v.count() == before).then(|| Defaults { shell: shell.unwrap(), cwd: cwd.unwrap() })
}

/// Validates a raw JSON value. `Err` carries every problem, each already formatted `path : message`.
pub fn parse_layout(raw: &Value) -> Result<Layout, Vec<String>> {
    let mut v = Validator::new();
    let Some(obj) = v.object(Some(raw)) else { return Err(v.issues) };

    // A literal, not a number: a file written by a newer MyTerm is rejected, not half-interpreted.
    let version_ok = obj.get("version").and_then(Value::as_f64) == Some(LAYOUT_VERSION as f64);
    if !version_ok {
        v.at("version", |v| v.issue(format!("Invalid input: expected {LAYOUT_VERSION}")));
    }
    let name = v.at("name", |v| v.optional_string(obj.get("name")));
    let color = v.at("color", |v| optional_choice(v, obj.get("color"), PaneColor::ALL));
    let theme = match obj.get("theme") {
        None => Some(ThemeMode::System),
        Some(t) => v.at("theme", |v| v.choice(t, ThemeMode::ALL)),
    };
    let defaults = v.at("defaults", |v| parse_defaults(v, obj.get("defaults")));

    let mut panes = Vec::new();
    match obj.get("panes") {
        Some(Value::Array(items)) => {
            v.at("panes", |v| {
                for (i, item) in items.iter().enumerate() {
                    if let Some(p) = v.at(i, |v| parse_pane(v, item)) {
                        panes.push(p);
                    }
                }
                if items.is_empty() {
                    v.soft_issue("un workspace doit déclarer au moins un pane");
                }
                if items.len() > MAX_PANES {
                    v.soft_issue(format!("un workspace ne peut pas dépasser {MAX_PANES} panes"));
                }
            });
        }
        other => v.at("panes", |v| {
            v.issue(format!("Invalid input: expected array, received {}", super::zod::received(other)));
            // Zod's size checks still run on whatever has a `length` — a string, here — so `"panes": ""`
            // also earns the "at least one pane" message.
            if let Some(Value::String(s)) = other {
                let len = s.encode_utf16().count();
                if len < 1 {
                    v.soft_issue("un workspace doit déclarer au moins un pane");
                }
                if len > MAX_PANES {
                    v.soft_issue(format!("un workspace ne peut pas dépasser {MAX_PANES} panes"));
                }
            }
        }),
    }

    // Duplicate ids (a refinement): checked unless a wrong type or value already broke the shape.
    // Size problems do not stop it, nor does an empty id, which is still an id.
    if v.hard == 0 {
        let ids = obj.get("panes").and_then(Value::as_array).into_iter().flatten().map(|p| p["id"].as_str().unwrap_or_default());
        let mut seen = std::collections::HashSet::new();
        for (i, id) in ids.enumerate() {
            if !seen.insert(id) {
                v.issue_at(
                    &["panes".into(), i.to_string(), "id".into()],
                    format!("identifiant dupliqué : « {id} » est déjà utilisé par un autre pane"),
                );
            }
        }
    }

    if !v.issues.is_empty() {
        return Err(v.issues);
    }
    Ok(Layout {
        version: LAYOUT_VERSION,
        name,
        color,
        theme: theme.unwrap(),
        defaults: defaults.unwrap(),
        panes,
    })
}

/// `Layout` -> JSON value, as the editor re-validates it after every mutation.
pub fn to_value(layout: &Layout) -> Value {
    serde_json::to_value(layout).expect("a Layout always serialises")
}

