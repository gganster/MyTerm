//! What the user is looking at: focus, zoom, folded panes, columns. Port of the UI slice of
//! `renderer/store/index.ts` and of `pane-focus.ts`.
//!
//! View state, never layout state: `pane.collapsed` in the file is only the value folding *starts*
//! from, and folding or zooming afterwards must never dirty the workspace (ADR-003).

use crate::grid::{neighbour_index, Arrow};
use crate::schema::layout::{Layout, Pane};

#[derive(Clone, Debug)]
pub struct ViewState {
    pub layout: Layout,
    /// Folded panes, in layout order (the bar is read like the grid).
    pub collapsed: Vec<String>,
    pub focused: Option<String>,
    pub zoomed: Option<String>,
    /// Panes per line at the current width, measured by the view. Arrow keys must know the shape the
    /// user is actually looking at.
    pub columns: usize,
}

impl ViewState {
    /// Opening a project: the one moment `pane.collapsed` is read.
    pub fn open(layout: Layout) -> Self {
        let collapsed = layout.panes.iter().filter(|p| p.collapsed == Some(true)).map(|p| p.id.clone()).collect();
        let focused = layout
            .panes
            .iter()
            .find(|p| p.collapsed != Some(true))
            .or(layout.panes.first())
            .map(|p| p.id.clone());
        ViewState { layout, collapsed, focused, zoomed: None, columns: 1 }
    }

    pub fn is_collapsed(&self, id: &str) -> bool {
        self.collapsed.iter().any(|c| c == id)
    }

    /// The panes actually on the grid, in order. The arrows walk what is on screen, not what the file
    /// declares: a folded pane occupies no cell.
    pub fn visible_panes(&self) -> Vec<&Pane> {
        self.layout.panes.iter().filter(|p| !self.is_collapsed(&p.id)).collect()
    }

    /// An edit or a reload. A pane that already existed keeps what the user is looking at (a reload
    /// must not re-fold a pane just opened); only a pane the layout introduces adopts its default.
    pub fn replace_layout(&mut self, layout: Layout) {
        let known: Vec<&str> = self.layout.panes.iter().map(|p| p.id.as_str()).collect();
        let collapsed: Vec<String> = layout
            .panes
            .iter()
            .filter(|p| {
                if known.contains(&p.id.as_str()) {
                    self.is_collapsed(&p.id)
                } else {
                    p.collapsed == Some(true)
                }
            })
            .map(|p| p.id.clone())
            .collect();
        let exists = |id: &Option<String>| id.as_ref().is_some_and(|id| layout.panes.iter().any(|p| &p.id == id));
        let focused = if exists(&self.focused) {
            self.focused.clone()
        } else {
            layout.panes.iter().find(|p| !collapsed.contains(&p.id)).or(layout.panes.first()).map(|p| p.id.clone())
        };
        let zoomed = if exists(&self.zoomed) { self.zoomed.clone() } else { None };
        *self = ViewState { layout, collapsed, focused, zoomed, columns: self.columns };
    }

    /// Zooming something folded unfolds it: "make this fill the window" cannot mean "leave it in the bar".
    pub fn toggle_zoom(&mut self, id: Option<&str>) {
        let Some(target) = id.map(String::from).or_else(|| self.focused.clone()) else { return };
        self.set_collapsed(&target, false);
        self.zoomed = if self.zoomed.as_deref() == Some(target.as_str()) { None } else { Some(target) };
    }

    pub fn set_collapsed(&mut self, id: &str, collapsed: bool) {
        if self.is_collapsed(id) == collapsed {
            return;
        }
        if !collapsed {
            self.collapsed.retain(|c| c != id);
            return;
        }
        // Layout order, not fold order: a chip that jumped every time something else was folded
        // would have to be hunted for.
        let order: Vec<&str> = self.layout.panes.iter().map(|p| p.id.as_str()).collect();
        self.collapsed.push(id.to_string());
        self.collapsed.sort_by_key(|c| order.iter().position(|o| o == c));
        // Folding the pane you were looking at hands the keyboard to the next one still on the grid.
        let still_visible = self.layout.panes.iter().find(|p| p.id != id && !self.is_collapsed(&p.id)).map(|p| p.id.clone());
        if self.zoomed.as_deref() == Some(id) {
            self.zoomed = None;
        }
        if self.focused.as_deref() == Some(id) {
            if let Some(next) = still_visible {
                self.focused = Some(next);
            }
        }
    }

    pub fn toggle_collapse(&mut self, id: Option<&str>) {
        let Some(target) = id.map(String::from).or_else(|| self.focused.clone()) else { return };
        let now = !self.is_collapsed(&target);
        self.set_collapsed(&target, now);
    }

    /// Moves the pointer. Returns true when the zoom had to follow: selecting a hidden pane while
    /// zoomed would put the ring somewhere invisible and leave the keyboard on the pane on screen.
    pub fn select_pane(&mut self, id: &str) -> bool {
        self.focused = Some(id.to_string());
        let moves_zoom = self.zoomed.as_deref().is_some_and(|z| z != id);
        if moves_zoom {
            self.toggle_zoom(Some(id));
        }
        moves_zoom
    }

    /// Makes a pane "the current one", unfolding it first if need be (handing the keyboard to a folded
    /// pane means bringing it back).
    pub fn focus_pane(&mut self, id: &str) {
        if self.is_collapsed(id) {
            self.set_collapsed(id, false);
        }
        self.select_pane(id);
    }

    /// Ctrl+Shift+1..9: the nth pane *of the file*, folded or not.
    pub fn focus_nth(&mut self, n: usize) -> Option<String> {
        let id = self.layout.panes.get(n.checked_sub(1)?)?.id.clone();
        self.focus_pane(&id);
        Some(id)
    }

    /// Ctrl+Shift+arrows: walk the grid.
    pub fn move_focus(&mut self, key: Arrow) -> Option<String> {
        let target = {
            let visible = self.visible_panes();
            let from = visible.iter().position(|p| Some(&p.id) == self.focused.as_ref()).unwrap_or(0);
            visible.get(from)?;
            neighbour_index(from, visible.len(), self.columns, key).map(|i| visible[i].id.clone())
        };
        let id = target?;
        self.focus_pane(&id);
        Some(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::layout::parse_layout;
    use serde_json::json;

    fn layout(panes: serde_json::Value) -> Layout {
        parse_layout(&json!({"version": 2, "panes": panes})).unwrap()
    }

    fn six() -> ViewState {
        let mut v = ViewState::open(layout(json!([{"id":"a"},{"id":"b"},{"id":"c"},{"id":"d"},{"id":"e"},{"id":"f"}])));
        v.columns = 3;
        v
    }

    #[test]
    fn opening_reads_the_file_default_for_folding_and_focuses_the_first_visible_pane() {
        let v = ViewState::open(layout(json!([{"id":"tunnel","collapsed":true},{"id":"web"}])));
        assert_eq!(v.collapsed, ["tunnel"]);
        assert_eq!(v.focused.as_deref(), Some("web"));
    }

    #[test]
    fn folding_keeps_layout_order_hands_focus_on_and_leaves_zoom() {
        let mut v = six();
        v.set_collapsed("c", true);
        v.set_collapsed("a", true);
        assert_eq!(v.collapsed, ["a", "c"], "layout order, not fold order");
        assert_eq!(v.focused.as_deref(), Some("b"), "focus left the folded pane a");
        v.toggle_zoom(Some("b"));
        v.set_collapsed("b", true);
        assert_eq!(v.zoomed, None);
    }

    #[test]
    fn zooming_a_folded_pane_unfolds_it() {
        let mut v = six();
        v.set_collapsed("d", true);
        v.toggle_zoom(Some("d"));
        assert_eq!((v.is_collapsed("d"), v.zoomed.as_deref()), (false, Some("d")));
        v.toggle_zoom(Some("d"));
        assert_eq!(v.zoomed, None);
    }

    #[test]
    fn arrows_walk_the_grid_not_the_file() {
        let mut v = six();
        v.set_collapsed("b", true); // visible: a c d e f -> a c d / e f
        v.focused = Some("c".into());
        assert_eq!(v.move_focus(Arrow::Left).as_deref(), Some("a"), "b is in the bar, not a neighbour");
        assert_eq!(v.move_focus(Arrow::Down).as_deref(), Some("e"));
        assert_eq!(v.move_focus(Arrow::Down), None, "no wrap, no empty cell");
    }

    #[test]
    fn a_number_names_the_nth_pane_of_the_file_and_brings_it_back() {
        let mut v = six();
        v.set_collapsed("e", true);
        assert_eq!(v.focus_nth(5).as_deref(), Some("e"));
        assert!(!v.is_collapsed("e"));
        assert_eq!(v.focused.as_deref(), Some("e"));
        assert_eq!(v.focus_nth(9), None);
        assert_eq!(v.focus_nth(0), None);
    }

    #[test]
    fn selecting_a_hidden_pane_while_zoomed_moves_the_zoom() {
        let mut v = six();
        v.toggle_zoom(Some("a"));
        assert!(v.select_pane("c"));
        assert_eq!((v.zoomed.as_deref(), v.focused.as_deref()), (Some("c"), Some("c")));
    }

    #[test]
    fn a_reload_keeps_what_the_user_set_and_only_new_panes_take_their_default() {
        let mut v = ViewState::open(layout(json!([{"id":"a","collapsed":true},{"id":"b"}])));
        v.set_collapsed("a", false); // the user opened it
        v.replace_layout(layout(json!([{"id":"a","collapsed":true},{"id":"b"},{"id":"n","collapsed":true}])));
        assert_eq!(v.collapsed, ["n"], "a stays open, the new pane starts folded");
    }

    #[test]
    fn a_reload_never_leaves_focus_or_zoom_on_a_dropped_pane() {
        let mut v = six();
        v.toggle_zoom(Some("f"));
        v.replace_layout(layout(json!([{"id":"a"},{"id":"b"}])));
        assert_eq!((v.focused.as_deref(), v.zoomed.as_deref()), (Some("a"), None));
    }
}
