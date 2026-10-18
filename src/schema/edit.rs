//! Pure layout mutations, shared by the editor UI and the reload diff. Port of `layout-edit.ts`.
//!
//! Every mutation is re-validated before it is returned, so the editor can never push an invalid
//! layout into the store.

use super::layout::{parse_layout, to_value, Layout, Pane, PaneColor, MAX_PANES};

pub type EditResult = Result<Layout, String>;

fn validated(layout: Layout) -> EditResult {
    parse_layout(&to_value(&layout)).map_err(|issues| issues.into_iter().next().unwrap_or_else(|| "layout invalide".into()))
}

fn unique_id(layout: &Layout) -> String {
    let mut index = layout.panes.len() + 1;
    while layout.panes.iter().any(|p| p.id == format!("pane-{index}")) {
        index += 1;
    }
    format!("pane-{index}")
}

/// Appended at the end: position is order, and a new pane belongs last.
pub fn add_pane(layout: &Layout) -> EditResult {
    if layout.panes.len() >= MAX_PANES {
        return Err(format!("un workspace ne peut pas dépasser {MAX_PANES} panes"));
    }
    let mut next = layout.clone();
    next.panes.push(Pane::new(unique_id(layout)));
    validated(next)
}

pub fn remove_pane(layout: &Layout, pane_id: &str) -> EditResult {
    // An empty workspace is not a state the app can be in.
    if layout.panes.len() <= 1 {
        return Err("un workspace doit garder au moins un pane".into());
    }
    let mut next = layout.clone();
    next.panes.retain(|p| p.id != pane_id);
    validated(next)
}

/// `patch` edits the pane in place. Optional fields left empty are dropped, not stored empty: the
/// file stays clean and diffs stay small.
pub fn update_pane(layout: &Layout, pane_id: &str, patch: impl FnOnce(&mut Pane)) -> EditResult {
    let mut next = layout.clone();
    if let Some(pane) = next.panes.iter_mut().find(|p| p.id == pane_id) {
        patch(pane);
        if pane.command.as_deref() == Some("") {
            pane.command = None;
        }
        if pane.collapsed == Some(false) {
            pane.collapsed = None;
        }
    }
    validated(next)
}

/// Sets the instance colour, or removes it with `None`.
pub fn set_project_color(layout: &Layout, color: Option<PaneColor>) -> EditResult {
    let mut next = layout.clone();
    next.color = color;
    validated(next)
}

/// Moves a pane one position earlier (`up`) or later in the flow: a shift, not a swap.
pub fn move_pane(layout: &Layout, pane_id: &str, up: bool) -> EditResult {
    let Some(from) = layout.panes.iter().position(|p| p.id == pane_id) else {
        return Err("pane introuvable".into());
    };
    let to = if up { from.checked_sub(1) } else { Some(from + 1) };
    let Some(to) = to.filter(|&t| t < layout.panes.len()) else {
        return Err("ce pane est déjà à cette extrémité".into());
    };
    let mut next = layout.clone();
    let moved = next.panes.remove(from);
    next.panes.insert(to, moved);
    validated(next)
}

/// Which panes must restart for a new layout to take effect: only the three fields that define the
/// process. A rename, a colour or a fold never kills a dev server.
pub fn panes_needing_restart(previous: &Layout, next: &Layout) -> Vec<String> {
    next.panes
        .iter()
        .filter(|pane| match previous.panes.iter().find(|p| p.id == pane.id) {
            None => true,
            Some(old) => old.cwd != pane.cwd || old.shell != pane.shell || old.command != pane.command,
        })
        .map(|p| p.id.clone())
        .collect()
}
