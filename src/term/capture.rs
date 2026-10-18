//! "What is this pane actually running?", answered without unfolding it. Port of
//! `renderer/terminal/command-capture.ts`; read its header there for the full argument.
//!
//! The command is read off the *screen*, not accumulated from keystrokes: tab completion rewrites the
//! line and history recall sends `ESC [ A`, which carries none of the command it brings back. The
//! keystrokes only give the *column* the input starts at (the cursor sits just past the prompt when
//! the first key of a line arrives), so no prompt-shape heuristic is needed. The anchor is keyed on
//! the logical row, so a focus report emitted on an empty screen cannot survive to the first Enter,
//! and the row is read ~25 ms after Enter, by absolute index, so the echo of a paste has landed.

use alacritty_terminal::grid::{Dimensions, Grid};
use alacritty_terminal::index::{Column, Line};
use alacritty_terminal::term::cell::{Cell, Flags};
use std::time::{Duration, Instant};

/// Rows scanned around the cursor for one logical (possibly wrapped) line.
const MAX_LOGICAL_ROWS: usize = 6;
/// Long enough for any command worth reading, short enough to keep in a store.
const MAX_COMMAND_LENGTH: usize = 512;
/// ~2 frames: the echo of a fast burst or a paste lands, and the row cannot have left the scrollback.
const READ_DELAY: Duration = Duration::from_millis(25);

/// Box-drawing and block characters (U+2500–U+259F). A TUI that stays in the normal buffer draws its
/// frame on the cursor's row, and no offset separates a frame from a command: such a result is
/// rejected, which leaves the pane's previous command standing (for a `claude` pane, `claude`).
fn is_frame_char(c: char) -> bool {
    ('\u{2500}'..='\u{259f}').contains(&c)
}

/// The terminal buffer, reduced to the two things this file asks of it.
pub trait RowReader {
    /// Row text padded to the terminal width, or `None` past the end.
    fn text(&self, row: usize) -> Option<String>;
    /// Whether that row is the continuation of the row above it.
    fn wrapped(&self, row: usize) -> bool;
}

#[derive(Debug, PartialEq, Eq)]
pub struct LogicalLine {
    /// Absolute index of the row the line starts on.
    pub first: usize,
    /// Every row of the line, first one first, each padded to the width.
    pub rows: Vec<String>,
}

/// The whole logical line the given row belongs to: back over continuation rows (the cursor is on
/// the *last* row of something typed), then forward (and on the *first* of something pasted).
/// Bounded, so a buffer that marks everything as wrapped cannot turn this into a scrollback scan.
pub fn logical_line(reader: &dyn RowReader, row: usize) -> LogicalLine {
    let mut first = row;
    while first > 0 && row - first < MAX_LOGICAL_ROWS - 1 && reader.wrapped(first) {
        first -= 1;
    }
    let mut last = row;
    while last < first + MAX_LOGICAL_ROWS - 1 && reader.wrapped(last + 1) {
        last += 1;
    }
    LogicalLine { first, rows: (first..=last).map(|i| reader.text(i).unwrap_or_default()).collect() }
}

/// Slices the command out of the rows of one logical line. Rows arrive padded to the width, so
/// `start_column` indexes into the concatenation exactly as it indexes into the first row.
pub fn command_from_rows(rows: &[String], start_column: isize) -> Option<String> {
    let joined: String = rows.concat();
    let tail: String = joined.chars().skip(start_column.max(0) as usize).collect();
    let command = tail.trim();
    if command.is_empty() || command.chars().any(is_frame_char) {
        return None;
    }
    Some(command.chars().take(MAX_COMMAND_LENGTH).collect())
}

/// What the capture needs from the live terminal at the moment a chunk of input is sent.
pub trait Screen: RowReader {
    /// A full-screen application owns the alternate buffer: the row under its cursor is a line of a
    /// file, not a command.
    fn alternate(&self) -> bool;
    /// Absolute row of the cursor, and its column.
    fn cursor(&self) -> (usize, usize);
}

struct Pending {
    due: Instant,
    row: usize,
    column: usize,
}

#[derive(Default)]
pub struct CommandCapture {
    /// Where the current line's input begins: its first row, and the prompt's end.
    anchor: Option<(usize, usize)>,
    pending: Option<Pending>,
    last: Option<String>,
}

impl CommandCapture {
    /// The last command read off the screen, if any.
    pub fn last(&self) -> Option<&str> {
        self.last.as_deref()
    }

    /// Records a command the screen was never going to show: the autolaunch command is written
    /// straight to the shell, so the capture below never sees it. Seeding it is what lets a folded
    /// pane that has run exactly one command (a tunnel) say so.
    pub fn seed(&mut self, command: &str) {
        self.last = Some(command.to_string());
    }

    pub fn has_pending(&self) -> bool {
        self.pending.is_some()
    }

    /// Feed it every chunk of input sent to the shell, *before* it can be echoed.
    pub fn on_data(&mut self, data: &[u8], screen: &dyn Screen, now: Instant) {
        if screen.alternate() {
            return;
        }
        let (cursor_row, cursor_column) = screen.cursor();
        let first = logical_line(screen, cursor_row).first;
        // Anchored before the chunk can be echoed: right now the cursor is where the prompt ends.
        let current = match self.anchor {
            Some(a) if a.0 == first => a,
            _ => (first, cursor_column),
        };
        self.anchor = Some(current);

        // Ctrl+C runs nothing.
        if data.contains(&0x03) {
            self.anchor = None;
            return;
        }
        if !data.iter().any(|b| matches!(b, b'\r' | b'\n')) {
            return;
        }
        self.anchor = None;
        self.pending = Some(Pending { due: now + READ_DELAY, row: current.0, column: current.1 });
    }

    /// Reads the row once its delay has passed. Returns the command when a new one was captured.
    pub fn poll(&mut self, reader: &dyn RowReader, now: Instant) -> Option<&str> {
        let p = self.pending.as_ref().filter(|p| now >= p.due)?;
        let command = command_from_rows(&logical_line(reader, p.row).rows, p.column as isize);
        self.pending = None;
        if let Some(c) = command {
            self.last = Some(c);
            return self.last.as_deref();
        }
        None
    }
}

/// The alacritty grid as a `Screen`. Absolute row 0 is the oldest line of the scrollback.
pub struct GridScreen<'a> {
    pub grid: &'a Grid<Cell>,
    pub alternate: bool,
}

impl GridScreen<'_> {
    fn line(&self, row: usize) -> Option<Line> {
        let line = row as i32 - self.grid.history_size() as i32;
        (line >= self.grid.topmost_line().0 && line <= self.grid.bottommost_line().0).then_some(Line(line))
    }
}

impl RowReader for GridScreen<'_> {
    fn text(&self, row: usize) -> Option<String> {
        let line = self.line(row)?;
        let cells = &self.grid[line];
        Some(
            (0..self.grid.columns())
                .map(|c| &cells[Column(c)])
                .filter(|cell| !cell.flags.contains(Flags::WIDE_CHAR_SPACER))
                .map(|cell| cell.c)
                .collect(),
        )
    }

    fn wrapped(&self, row: usize) -> bool {
        // A row is a continuation when the row above ran off its last column.
        row.checked_sub(1)
            .and_then(|above| self.line(above))
            .is_some_and(|line| self.grid[line][Column(self.grid.columns() - 1)].flags.contains(Flags::WRAPLINE))
    }
}

impl Screen for GridScreen<'_> {
    fn alternate(&self) -> bool {
        self.alternate
    }

    fn cursor(&self) -> (usize, usize) {
        let p = self.grid.cursor.point;
        ((p.line.0 + self.grid.history_size() as i32).max(0) as usize, p.column.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Rows come out of the terminal padded to its width; reproduce that.
    fn row(text: &str, width: usize) -> String {
        format!("{text:<width$}")
    }

    struct Buffer(Vec<(String, bool)>);

    fn reader(rows: &[(&str, bool)], width: usize) -> Buffer {
        Buffer(rows.iter().map(|(t, w)| (row(t, width), *w)).collect())
    }

    impl RowReader for Buffer {
        fn text(&self, i: usize) -> Option<String> {
            self.0.get(i).map(|r| r.0.clone())
        }
        fn wrapped(&self, i: usize) -> bool {
            self.0.get(i).is_some_and(|r| r.1)
        }
    }

    // ---- logicalLine ----

    #[test]
    fn stops_at_the_cursor_row_when_nothing_wraps() {
        let b = reader(&[("PowerShell 7.6.6", false), ("PS C:\\src> npm run dev", false)], 40);
        let line = logical_line(&b, 1);
        assert_eq!((line.first, line.rows.len()), (1, 1));
    }

    #[test]
    fn climbs_continuation_rows_the_cursor_is_on_the_last_after_typing() {
        let b = reader(&[("PS C:\\src> cloudflared tunnel", false), (" run --url http", true)], 40);
        let line = logical_line(&b, 1);
        assert_eq!((line.first, line.rows.len()), (0, 2));
    }

    #[test]
    fn descends_continuation_rows_the_cursor_is_on_the_first_after_a_paste() {
        let b = reader(&[("PS C:\\src> pnpm dlx", false), (" create-something", true)], 40);
        let line = logical_line(&b, 0);
        assert_eq!((line.first, line.rows.len()), (0, 2));
    }

    #[test]
    fn bounds_the_climb_a_fully_wrapped_buffer_is_not_a_scan() {
        let rows: Vec<(&str, bool)> = (0..50).map(|_| ("x", true)).collect();
        assert!(logical_line(&reader(&rows, 40), 40).rows.len() <= 6);
    }

    // ---- commandFromRows ----

    #[test]
    fn cuts_the_prompt_and_returns_the_command_alone() {
        let prompt = "PS C:\\src> ";
        let rows = [row(&format!("{prompt}npm run dev"), 40)];
        assert_eq!(command_from_rows(&rows, prompt.len() as isize).as_deref(), Some("npm run dev"));
    }

    #[test]
    fn rejoins_a_command_that_wrapped_over_several_rows() {
        let rows = [row("> cloudflared tunnel run --url http", 34), row("://localhost:3000", 34)];
        assert_eq!(command_from_rows(&rows, 2).as_deref(), Some("cloudflared tunnel run --url http://localhost:3000"));
    }

    #[test]
    fn nothing_on_an_empty_line_enter_on_a_bare_prompt_runs_nothing() {
        assert_eq!(command_from_rows(&[row("PS C:\\src> ", 40)], 11), None);
    }

    #[test]
    fn nothing_when_the_column_is_past_the_line() {
        assert_eq!(command_from_rows(&[row("PS C:\\src> ", 40)], 999), None);
    }

    #[test]
    fn tolerates_a_negative_column() {
        assert_eq!(command_from_rows(&[row("claude", 40)], -3).as_deref(), Some("claude"));
    }

    #[test]
    fn refuses_a_tui_frame_rather_than_showing_a_piece_of_decor() {
        assert_eq!(command_from_rows(&[row("│ > déployer le tunnel        │", 40)], 0), None);
    }

    #[test]
    fn truncates_an_absurd_line_instead_of_storing_it_whole() {
        let long = command_from_rows(&[row(&format!("echo {}", "x".repeat(4000)), 4100)], 0).unwrap();
        assert_eq!(long.chars().count(), 512);
    }

    // ---- the keystroke plumbing, against a scripted screen ----

    struct Scripted {
        buffer: Buffer,
        cursor: (usize, usize),
        alternate: bool,
    }
    impl RowReader for Scripted {
        fn text(&self, i: usize) -> Option<String> {
            self.buffer.text(i)
        }
        fn wrapped(&self, i: usize) -> bool {
            self.buffer.wrapped(i)
        }
    }
    impl Screen for Scripted {
        fn alternate(&self) -> bool {
            self.alternate
        }
        fn cursor(&self) -> (usize, usize) {
            self.cursor
        }
    }

    #[test]
    fn captures_after_enter_once_the_echo_has_had_time_to_land() {
        let mut capture = CommandCapture::default();
        let t0 = Instant::now();
        // The first key arrives while the cursor sits just past the prompt (column 11).
        let at_prompt = Scripted { buffer: reader(&[("PS C:\\src> ", false)], 40), cursor: (0, 11), alternate: false };
        capture.on_data(b"n", &at_prompt, t0);
        // By Enter the screen holds the echoed command.
        let echoed = Scripted { buffer: reader(&[("PS C:\\src> npm run dev", false)], 40), cursor: (0, 22), alternate: false };
        capture.on_data(b"\r", &echoed, t0);
        assert!(capture.has_pending());
        assert_eq!(capture.poll(&echoed, t0), None, "too early: the echo may not have landed");
        assert_eq!(capture.poll(&echoed, t0 + Duration::from_millis(30)), Some("npm run dev"));
        assert_eq!(capture.last(), Some("npm run dev"));
    }

    #[test]
    fn an_anchor_taken_on_another_row_is_discarded() {
        // The terminal reports focus on its own before anything is typed, on a still-empty screen.
        // The banner and the prompt then land further down: the column taken at row 0 must not
        // survive to the first Enter, or the prompt ends up inside the "command".
        let mut capture = CommandCapture::default();
        let t0 = Instant::now();
        let empty = Scripted { buffer: reader(&[("", false)], 40), cursor: (0, 0), alternate: false };
        capture.on_data(b"\x1b[I", &empty, t0);

        let at_prompt = Scripted {
            buffer: reader(&[("PowerShell 7.6.6", false), ("", false), ("PS C:\\src> ", false)], 40),
            cursor: (2, 11),
            alternate: false,
        };
        capture.on_data(b"e", &at_prompt, t0);
        let echoed = Scripted {
            buffer: reader(&[("PowerShell 7.6.6", false), ("", false), ("PS C:\\src> echo bonjour", false)], 40),
            cursor: (2, 23),
            alternate: false,
        };
        capture.on_data(b"\r", &echoed, t0);
        assert_eq!(capture.poll(&echoed, t0 + Duration::from_millis(30)), Some("echo bonjour"));
    }

    #[test]
    fn ctrl_c_runs_nothing_and_the_alternate_screen_is_ignored() {
        let mut capture = CommandCapture::default();
        let t0 = Instant::now();
        let s = Scripted { buffer: reader(&[("PS C:\\src> sleep 99", false)], 40), cursor: (0, 19), alternate: false };
        capture.on_data(b"\x03", &s, t0);
        capture.on_data(b"\r", &Scripted { alternate: true, ..s }, t0);
        assert!(!capture.has_pending());
    }
}
