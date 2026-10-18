//! The application's own shortcuts, and the rule that keeps them from stealing the shell's keys.
//! Port of `use-shortcuts.ts` (`isAppShortcut`).
//!
//! A terminal claims almost every keystroke, so app bindings all sit behind Ctrl+Shift, which no
//! shell uses. Ctrl+C, Ctrl+D, Ctrl+L, Ctrl+R and friends are never intercepted.
//!
//!   Ctrl+Shift+arrows   move focus through the panes as they are laid out
//!   Ctrl+Shift+1..9     focus the nth pane, unfolding it if it was folded
//!   Ctrl+Shift+Z        zoom / unzoom the focused pane
//!   Ctrl+Shift+M        fold the focused pane into the bottom bar, or unfold it
//!   Escape              unzoom, and only when something is zoomed
//!   Ctrl+S              save the layout now, instead of waiting for the autosave
//!
//! (Ctrl+Shift+C, copy, belongs to the terminal widget.) Digits are matched on the *physical* key:
//! on AZERTY the logical key of the digit row is the unshifted symbol (`&` for 1, `ç` for 9), which
//! is not what the user means. Letters are matched on the logical key, as `event.key` was.

use crate::grid::Arrow;
use iced::keyboard::key::{Code, Named, Physical};
use iced::keyboard::{Event, Key, Modifiers};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AppChord {
    Move(Arrow),
    Nth(usize),
    Zoom,
    Collapse,
    Unzoom,
    Save,
}

/// Escape belongs to the app only while a pane is zoomed; otherwise it goes to vim, to a git rebase
/// editor, to whatever runs in the pane. Set by the application whenever the zoom changes.
pub static ESCAPE_UNZOOMS: AtomicBool = AtomicBool::new(false);

const CTRL_SHIFT: Modifiers = Modifiers::CTRL.union(Modifiers::SHIFT);

fn digit(physical: &Physical) -> Option<usize> {
    let n = match physical {
        Physical::Code(Code::Digit1) => 1,
        Physical::Code(Code::Digit2) => 2,
        Physical::Code(Code::Digit3) => 3,
        Physical::Code(Code::Digit4) => 4,
        Physical::Code(Code::Digit5) => 5,
        Physical::Code(Code::Digit6) => 6,
        Physical::Code(Code::Digit7) => 7,
        Physical::Code(Code::Digit8) => 8,
        Physical::Code(Code::Digit9) => 9,
        _ => return None,
    };
    Some(n)
}

pub fn classify(event: &Event) -> Option<AppChord> {
    let Event::KeyPressed { key, modified_key, physical_key, modifiers, .. } = event else { return None };

    if modifiers.is_empty() {
        let escape = matches!(key, Key::Named(Named::Escape));
        return (escape && ESCAPE_UNZOOMS.load(Ordering::Relaxed)).then_some(AppChord::Unzoom);
    }
    if *modifiers == Modifiers::CTRL {
        // The one Ctrl-only chord: 0.5.0 caught it on the window, whatever had the focus.
        return matches!(key, Key::Character(c) if c.eq_ignore_ascii_case("s")).then_some(AppChord::Save);
    }
    if *modifiers != CTRL_SHIFT {
        return None;
    }
    if let Some(n) = digit(physical_key) {
        return Some(AppChord::Nth(n));
    }
    match key {
        Key::Named(Named::ArrowLeft) => Some(AppChord::Move(Arrow::Left)),
        Key::Named(Named::ArrowRight) => Some(AppChord::Move(Arrow::Right)),
        Key::Named(Named::ArrowUp) => Some(AppChord::Move(Arrow::Up)),
        Key::Named(Named::ArrowDown) => Some(AppChord::Move(Arrow::Down)),
        Key::Character(c) => match c.to_lowercase().as_str() {
            "z" => Some(AppChord::Zoom),
            "m" => Some(AppChord::Collapse),
            // A numeric-pad digit arrives as a character with no digit-row physical key.
            d if d.len() == 1 && matches!(d.as_bytes()[0], b'1'..=b'9') => Some(AppChord::Nth((d.as_bytes()[0] - b'0') as usize)),
            _ => match modified_key {
                Key::Character(m) if m.len() == 1 && matches!(m.as_bytes()[0], b'1'..=b'9') => {
                    Some(AppChord::Nth((m.as_bytes()[0] - b'0') as usize))
                }
                _ => None,
            },
        },
        _ => None,
    }
}

/// What the terminal widget must not turn into bytes for the shell.
pub fn reserved(event: &Event) -> bool {
    classify(event).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use iced::keyboard::Location;

    fn press(key: Key, modified: Key, physical: Physical, modifiers: Modifiers) -> Event {
        Event::KeyPressed { key, modified_key: modified, physical_key: physical, location: Location::Standard, modifiers, text: None, repeat: false }
    }

    fn ch(s: &str) -> Key {
        Key::Character(s.into())
    }

    #[test]
    fn digits_are_recognised_by_the_physical_key_on_azerty() {
        // Real events from the user's keyboard: `&` is the logical key of the 1 key, `ç` of the 9 key.
        assert_eq!(classify(&press(ch("&"), ch("1"), Physical::Code(Code::Digit1), CTRL_SHIFT)), Some(AppChord::Nth(1)));
        assert_eq!(classify(&press(ch("ç"), ch("9"), Physical::Code(Code::Digit9), CTRL_SHIFT)), Some(AppChord::Nth(9)));
        // and on QWERTY, where Shift turns the logical key into `!`
        assert_eq!(classify(&press(ch("!"), ch("!"), Physical::Code(Code::Digit1), CTRL_SHIFT)), Some(AppChord::Nth(1)));
    }

    #[test]
    fn letters_are_recognised_on_the_logical_key_whatever_the_layout() {
        // AZERTY: the Z letter sits on the physical W position.
        assert_eq!(classify(&press(ch("z"), ch("Z"), Physical::Code(Code::KeyW), CTRL_SHIFT)), Some(AppChord::Zoom));
        assert_eq!(classify(&press(ch("m"), ch("M"), Physical::Code(Code::Semicolon), CTRL_SHIFT)), Some(AppChord::Collapse));
    }

    #[test]
    fn arrows_with_ctrl_shift() {
        let a = |n| press(Key::Named(n), Key::Named(n), Physical::Code(Code::ArrowLeft), CTRL_SHIFT);
        assert_eq!(classify(&a(Named::ArrowLeft)), Some(AppChord::Move(Arrow::Left)));
        assert_eq!(classify(&a(Named::ArrowDown)), Some(AppChord::Move(Arrow::Down)));
    }

    #[test]
    fn the_shells_keys_are_never_taken() {
        assert_eq!(classify(&press(ch("s"), ch("s"), Physical::Code(Code::KeyS), Modifiers::CTRL)), Some(AppChord::Save));
        for k in ["c", "d", "l", "r", "z"] {
            let e = press(ch(k), ch(k), Physical::Code(Code::KeyA), Modifiers::CTRL);
            assert_eq!(classify(&e), None, "Ctrl+{k} belongs to the shell");
        }
        // Alt/Meta variants and bare Shift are left alone too (AltGr looks like Ctrl+Alt)
        let altgr = press(ch("z"), ch("z"), Physical::Code(Code::KeyW), Modifiers::CTRL | Modifiers::SHIFT | Modifiers::ALT);
        assert_eq!(classify(&altgr), None);
        assert_eq!(classify(&press(ch("z"), ch("Z"), Physical::Code(Code::KeyW), Modifiers::SHIFT)), None);
        assert_eq!(classify(&press(ch("5"), ch("5"), Physical::Code(Code::Digit5), Modifiers::CTRL)), None);
    }

    #[test]
    fn escape_belongs_to_the_app_only_while_something_is_zoomed() {
        let esc = press(Key::Named(Named::Escape), Key::Named(Named::Escape), Physical::Code(Code::Escape), Modifiers::empty());
        ESCAPE_UNZOOMS.store(false, Ordering::Relaxed);
        assert_eq!(classify(&esc), None);
        ESCAPE_UNZOOMS.store(true, Ordering::Relaxed);
        assert_eq!(classify(&esc), Some(AppChord::Unzoom));
        ESCAPE_UNZOOMS.store(false, Ordering::Relaxed);
    }
}
