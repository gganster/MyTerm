//! The terminal against a real ConPTY and a real shell, with no window: these are the behaviours
//! the 0.5.0 terminal had and the widget must keep (5000 lines of scrollback, input reaching the
//! shell, the last command read off the screen).

use alacritty_terminal::grid::Dimensions;
use super::capture::{GridScreen, RowReader};
use super::settings::{BackendSettings, Settings};
use super::terminal::{Command, Terminal};
use super::backend;
use std::time::{Duration, Instant};

fn spawn(args: &[&str]) -> Terminal {
    let mut t = Terminal::new(
        0,
        Settings {
            backend: BackendSettings {
                program: "cmd.exe".into(),
                args: args.iter().map(|a| a.to_string()).collect(),
                ..Default::default()
            },
            ..Default::default()
        },
    )
    .expect("a ConPTY and cmd.exe");
    // The view normally sizes the grid; without one the layout is 80x50 *pixels*, i.e. 9 columns.
    t.handle(Command::ProxyToBackend(backend::Command::Resize(Some(iced_core::Size::new(1000.0, 700.0)), None)));
    t
}

/// Every row of the terminal, scrollback first.
fn rows(t: &Terminal) -> Vec<String> {
    let handle = t.backend.term_handle();
    let term = handle.lock();
    let screen = GridScreen { grid: term.grid(), alternate: false };
    let total = term.grid().history_size() + term.grid().screen_lines();
    (0..total).filter_map(|i| screen.text(i)).map(|r| r.trim_end().to_string()).collect()
}

fn history(t: &Terminal) -> usize {
    t.backend.term_handle().lock().grid().history_size()
}

/// Drains the event channel (a full one would stall the shell's reader thread) and ticks the
/// terminal until `done` holds.
fn wait_until(t: &mut Terminal, what: &str, done: impl Fn(&Terminal) -> bool) {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        t.drain_events_for_tests();
        t.tick();
        if done(t) {
            return;
        }
        assert!(Instant::now() < deadline, "timed out waiting for {what}\n{:#?}", rows(t));
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn send(t: &mut Terminal, bytes: &str) {
    t.handle(Command::ProxyToBackend(backend::Command::Write(bytes.as_bytes().to_vec())));
}

#[test]
fn keeps_exactly_5000_lines_of_scrollback() {
    let mut t = spawn(&["/c", "for /L %i in (1,1,6000) do @echo line %i"]);
    wait_until(&mut t, "line 6000", |t| rows(t).iter().any(|r| r == "line 6000"));
    // 6000 lines were printed; 5000 stay above the screen. (0.5.0: xterm `scrollback: 5000`.)
    assert_eq!(history(&t), 5000);
    let all = rows(&t);
    assert!(!all.iter().any(|r| r == "line 1"), "the oldest lines are gone");
}

#[test]
fn input_reaches_the_shell() {
    let mut t = spawn(&["/q"]);
    wait_until(&mut t, "the prompt", |t| rows(t).iter().any(|r| r.ends_with('>')));
    send(&mut t, "echo bonjour-monde\r");
    wait_until(&mut t, "the echoed output", |t| rows(t).iter().any(|r| r == "bonjour-monde"));
}

#[test]
fn reads_the_last_command_off_the_screen_even_when_typed_one_key_at_a_time() {
    let mut t = spawn(&["/q"]);
    wait_until(&mut t, "the prompt", |t| rows(t).iter().any(|r| r.ends_with('>')));
    for c in "echo bonjour-monde".chars() {
        send(&mut t, &c.to_string());
        std::thread::sleep(Duration::from_millis(15));
    }
    send(&mut t, "\r");
    wait_until(&mut t, "the captured command", |t| t.last_command().is_some());
    // The prompt (`C:\...>`) is cut off by the column the first key arrived at; no prompt heuristic.
    assert_eq!(t.last_command(), Some("echo bonjour-monde"));
}

#[test]
fn a_command_recalled_without_typing_is_still_captured_from_the_screen() {
    // Tab completion and history recall are how people actually re-run a command: the keystrokes
    // (`ESC [ A`) carry none of the text, which is exactly why the screen is read instead.
    let mut t = spawn(&["/q"]);
    wait_until(&mut t, "the prompt", |t| rows(t).iter().any(|r| r.ends_with('>')));
    send(&mut t, "echo une-premiere\r");
    wait_until(&mut t, "first command captured", |t| t.last_command() == Some("echo une-premiere"));
    send(&mut t, "\u{1b}[A"); // history: Up (cmd redraws the previous command on the line)
    std::thread::sleep(Duration::from_millis(300));
    send(&mut t, "\r");
    wait_until(&mut t, "the recalled command", |t| rows(t).iter().filter(|r| *r == "une-premiere").count() >= 2);
    assert_eq!(t.last_command(), Some("echo une-premiere"));
}

#[test]
fn a_mouse_selection_is_readable_back_as_text() {
    let mut t = spawn(&["/q"]);
    wait_until(&mut t, "the prompt", |t| rows(t).iter().any(|r| r.ends_with('>')));
    send(&mut t, "echo selectable-text-here\r");
    wait_until(&mut t, "the output", |t| rows(t).iter().any(|r| r == "selectable-text-here"));
    t.tick();
    // Absolute row (scrollback included) -> row on screen, which is what a mouse position means.
    let row = rows(&t).iter().position(|r| r == "selectable-text-here").unwrap() - history(&t);
    let size = t.backend.renderable_content().terminal_size;
    let (cw, ch) = (size.cell_width, size.cell_height);
    let y = (row as f32 + 0.5) * ch;
    // Drag from the left edge of the first cell to the middle of the 10th: "selectable".
    t.handle(Command::ProxyToBackend(backend::Command::SelectStart(super::SelectionType::Simple, (1.0, y))));
    t.handle(Command::ProxyToBackend(backend::Command::SelectUpdate((cw * 10.2, y))));
    // Two commands in a row: the second falls inside the repaint throttle, and only `tick` paints it.
    t.tick();
    assert_eq!(t.backend.selectable_content(), "selectable");
}

#[test]
fn the_caret_blinks_and_typing_makes_it_solid_again() {
    let mut t = spawn(&["/q"]);
    wait_until(&mut t, "the prompt", |t| rows(t).iter().any(|r| r.ends_with('>')));
    assert!(t.cursor_on, "solid at start");
    t.blink_tick();
    assert!(!t.cursor_on);
    t.blink_tick();
    assert!(t.cursor_on);
    t.blink_tick();
    assert!(!t.cursor_on);
    send(&mut t, "a");
    assert!(t.cursor_on, "a keystroke restarts the blink with the caret visible");
}

#[test]
fn a_command_written_right_after_spawn_runs_in_pwsh() {
    // The autolaunch path: the command goes in before the shell has printed its first prompt.
    let mut t = Terminal::new(
        0,
        Settings { backend: BackendSettings { program: "pwsh.exe".into(), ..Default::default() }, ..Default::default() },
    )
    .expect("pwsh");
    t.handle(Command::ProxyToBackend(backend::Command::Resize(Some(iced_core::Size::new(1000.0, 700.0)), None)));
    send(&mut t, "echo alpha-ok\r");
    wait_until(&mut t, "the output of the autolaunch command", |t| rows(t).iter().any(|r| r == "alpha-ok"));
}

#[test]
fn a_new_terminal_starts_at_a_sane_size_not_at_the_layout_placeholder() {
    let t = spawn_without_resize(&["/q"]);
    let handle = t.backend.term_handle();
    let term = handle.lock();
    assert_eq!((term.grid().columns(), term.grid().screen_lines()), (80, 50));
}

fn spawn_without_resize(args: &[&str]) -> Terminal {
    Terminal::new(
        0,
        Settings { backend: BackendSettings { program: "cmd.exe".into(), args: args.iter().map(|a| a.to_string()).collect(), ..Default::default() }, ..Default::default() },
    )
    .expect("a ConPTY and cmd.exe")
}
