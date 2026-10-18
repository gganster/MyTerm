//! Forward migration of a raw `.myterm.json`, run before validation. Port of `layout-migrate.ts`.
//!
//! v1 described a `cols x rows` grid with a `{col, row}` per pane; v2 keeps only the order. Reading
//! order (top to bottom, left to right) is the honest way to flatten a grid. Tolerant by design: it
//! repairs the shape it recognises and leaves everything else to validation, whose messages are the
//! ones a user can act on. It never writes.

use super::layout::LAYOUT_VERSION;
use serde_json::{Map, Value};
use std::cmp::Ordering;

fn cell(pane: &Value, key: &str) -> f64 {
    pane.as_object()
        .and_then(|o| o.get(key))
        .and_then(Value::as_f64)
        .filter(|f| f.is_finite())
        .unwrap_or(0.0)
}

pub fn migrate_layout(raw: Value) -> Value {
    let Value::Object(mut source) = raw else { return raw };
    if source.get("version").and_then(Value::as_f64) != Some(1.0) {
        return Value::Object(source);
    }

    // `grid` is dropped by omission; the version is bumped even when the rest is malformed, so the
    // user sees the real error instead of "version invalide".
    source.remove("grid");
    let panes = source.remove("panes");
    source.insert("version".into(), Value::from(LAYOUT_VERSION));

    match panes {
        None => {}
        Some(Value::Array(mut list)) => {
            // Stable sort: panes without usable coordinates keep the order the file gave them.
            list.sort_by(|a, b| {
                let by = |k: &str| cell(a, k).partial_cmp(&cell(b, k)).unwrap_or(Ordering::Equal);
                by("row").then_with(|| by("col"))
            });
            for pane in &mut list {
                if let Value::Object(o) = pane {
                    o.remove("col");
                    o.remove("row");
                }
            }
            source.insert("panes".into(), Value::Array(list));
        }
        Some(other) => {
            source.insert("panes".into(), other);
        }
    }
    Value::Object(source)
}

/// Coordinates left over from v1 in a file that declares v2.
///
/// Bumping `"version": 1` to `2` by hand and leaving `grid`/`col`/`row` would silently reorder the
/// panes, so it is rejected with one message. Returns the first offending field path.
pub fn legacy_field_in(raw: &Value) -> Option<String> {
    let source: &Map<String, Value> = raw.as_object()?;
    if source.contains_key("grid") {
        return Some("grid".into());
    }
    for (index, pane) in source.get("panes")?.as_array()?.iter().enumerate() {
        let Some(fields) = pane.as_object() else { continue };
        if fields.contains_key("col") {
            return Some(format!("panes.{index}.col"));
        }
        if fields.contains_key("row") {
            return Some(format!("panes.{index}.row"));
        }
    }
    None
}
