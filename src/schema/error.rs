//! Failure modes of reading a layout, with the messages of 0.5.0 (`format-error.ts`).

use super::layout::LAYOUT_VERSION;
use serde_json::Value;

#[derive(Clone, Debug, PartialEq)]
pub enum LayoutReadFailure {
    Missing,
    Empty,
    Unreadable { detail: String },
    MalformedJson { detail: String },
    FutureVersion { found: Value },
    LegacyFields { field: String },
    Invalid { problems: Vec<String> },
}

impl LayoutReadFailure {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Missing => "missing",
            Self::Empty => "empty",
            Self::Unreadable { .. } => "unreadable",
            Self::MalformedJson { .. } => "malformed-json",
            Self::FutureVersion { .. } => "future-version",
            Self::LegacyFields { .. } => "legacy-fields",
            Self::Invalid { .. } => "invalid",
        }
    }
}

/// `String(value)` for the JSON numbers a version can be.
fn js_string(v: &Value) -> String {
    match v.as_f64() {
        Some(f) if f.fract() == 0.0 && f.abs() < 1e21 => format!("{f:.0}"),
        Some(f) => f.to_string(),
        None => v.to_string(),
    }
}

pub fn describe_failure(failure: &LayoutReadFailure) -> String {
    match failure {
        LayoutReadFailure::Missing => "aucun .myterm.json à la racine du projet".into(),
        LayoutReadFailure::Empty => "le fichier .myterm.json est vide".into(),
        LayoutReadFailure::Unreadable { detail } => format!("impossible de lire .myterm.json : {detail}"),
        LayoutReadFailure::MalformedJson { detail } => {
            format!(".myterm.json n'est pas du JSON valide : {detail}")
        }
        LayoutReadFailure::FutureVersion { found } => format!(
            ".myterm.json déclare la version {} : il a été créé par une version plus récente de MyTerm (cette version lit la {LAYOUT_VERSION})",
            js_string(found)
        ),
        LayoutReadFailure::LegacyFields { field } => format!(
            ".myterm.json déclare la version {LAYOUT_VERSION} mais contient encore « {field} » : \
             la disposition n'est plus décrite dans le fichier, l'ordre des panes suffit.\n  \
             · soit vous supprimez « grid » et les « col »/« row » — les panes seront alors affichés dans leur ordre de déclaration ;\n  \
             · soit vous remettez \"version\": 1 et MyTerm convertit le fichier lui-même, en respectant la disposition actuelle."
        ),
        LayoutReadFailure::Invalid { problems } => {
            let lines: Vec<String> = problems.iter().map(|p| format!("  · {p}")).collect();
            format!(".myterm.json est invalide :\n{}", lines.join("\n"))
        }
    }
}
