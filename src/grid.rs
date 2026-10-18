//! How many panes fit on one line, and how short a line may get. Port of `responsive-grid.ts`.
//!
//! The rule is the whole layout system (ADR-003): a `.myterm.json` says *which* panes exist and in
//! what order, never where they sit. Position is a function of the width available at that instant,
//! so the same file is usable on a fullscreen 4K window and on a half-screen one. Measured against
//! the *pane area*, not the window: opening the layout editor takes 320 px away, and the panes
//! reflow for it exactly as they would for a narrower window.

/// (applies strictly above this width, columns)
pub const COLUMN_BREAKPOINTS: [(f32, usize); 2] = [(1600.0, 3), (1200.0, 2)];

/// Below this, a terminal shows too few lines to be worth looking at. Rows never shrink past it:
/// the pane area scrolls instead, rather than crushing every terminal into a sliver.
pub const MIN_PANE_HEIGHT: f32 = 200.0;

/// Columns for a given pane-area width. Never more columns than panes: two panes on a 4K screen take
/// half the width each rather than two thirds with a hole on the right.
pub fn columns_for_width(width: f32, pane_count: usize) -> usize {
    if !width.is_finite() || pane_count == 0 {
        return 1;
    }
    let by_width = COLUMN_BREAKPOINTS.iter().find(|(min, _)| width > *min).map_or(1, |(_, cols)| *cols);
    by_width.min(pane_count)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Arrow {
    Left,
    Right,
    Up,
    Down,
}

/// Index of the visual neighbour in the flow, or `None` at the edge (no wrap-around, which
/// disorients). What the user sees is the flow order cut into lines of `columns`, so that is what
/// the arrow keys walk: Left at the start of a line is an edge, not the end of the line above.
pub fn neighbour_index(index: usize, count: usize, columns: usize, key: Arrow) -> Option<usize> {
    let width = columns.max(1);
    let column = index % width;
    let target = match key {
        Arrow::Left => (column > 0).then(|| index - 1),
        Arrow::Right => (column < width - 1).then_some(index + 1),
        Arrow::Up => index.checked_sub(width),
        Arrow::Down => Some(index + width),
    };
    target.filter(|t| *t < count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn three_per_line_when_fullscreen_two_on_half_a_big_screen_one_below() {
        assert_eq!(columns_for_width(1920.0, 6), 3);
        assert_eq!(columns_for_width(2560.0, 6), 3);
        assert_eq!(columns_for_width(1440.0, 6), 2);
        assert_eq!(columns_for_width(1201.0, 6), 2);
        assert_eq!(columns_for_width(1200.0, 6), 1);
        assert_eq!(columns_for_width(900.0, 6), 1);
        assert_eq!(columns_for_width(320.0, 6), 1);
    }

    #[test]
    fn switches_exactly_on_the_announced_thresholds() {
        assert_eq!(columns_for_width(1600.0, 6), 2);
        assert_eq!(columns_for_width(1601.0, 6), 3);
    }

    #[test]
    fn never_more_columns_than_panes() {
        assert_eq!(columns_for_width(2560.0, 2), 2);
        assert_eq!(columns_for_width(2560.0, 1), 1);
    }

    #[test]
    fn survives_a_null_or_absurd_width_during_the_first_render() {
        assert_eq!(columns_for_width(0.0, 4), 1);
        assert_eq!(columns_for_width(f32::NAN, 4), 1);
        assert_eq!(columns_for_width(1920.0, 0), 1);
    }

    // Six panes on three columns:  0 1 2
    //                              3 4 5
    #[test]
    fn moves_within_a_line_and_between_lines() {
        assert_eq!(neighbour_index(1, 6, 3, Arrow::Left), Some(0));
        assert_eq!(neighbour_index(1, 6, 3, Arrow::Right), Some(2));
        assert_eq!(neighbour_index(4, 6, 3, Arrow::Up), Some(1));
        assert_eq!(neighbour_index(1, 6, 3, Arrow::Down), Some(4));
    }

    #[test]
    fn does_not_wrap_to_the_previous_line_and_does_not_leave_the_grid() {
        assert_eq!(neighbour_index(3, 6, 3, Arrow::Left), None);
        assert_eq!(neighbour_index(2, 6, 3, Arrow::Right), None);
        assert_eq!(neighbour_index(0, 6, 3, Arrow::Up), None);
        assert_eq!(neighbour_index(5, 6, 3, Arrow::Down), None);
    }

    #[test]
    fn does_not_aim_at_an_empty_cell_of_the_last_line() {
        assert_eq!(neighbour_index(4, 5, 3, Arrow::Right), None);
        assert_eq!(neighbour_index(2, 5, 3, Arrow::Down), None);
    }

    #[test]
    fn one_column_is_a_plain_vertical_list() {
        assert_eq!(neighbour_index(1, 3, 1, Arrow::Down), Some(2));
        assert_eq!(neighbour_index(1, 3, 1, Arrow::Up), Some(0));
        assert_eq!(neighbour_index(1, 3, 1, Arrow::Right), None);
        assert_eq!(neighbour_index(1, 3, 1, Arrow::Left), None);
    }

    #[test]
    fn tolerates_a_column_count_not_measured_yet() {
        assert_eq!(neighbour_index(0, 3, 0, Arrow::Down), Some(1));
    }
}
