//! Who owns a keystroke. Port of `tests/renderer/key-chords.test.ts`.
//!
//! Both failure directions are silent: claim too much and a key the shell needed never arrives;
//! claim too little and the chord does nothing. So most of these are about what must still reach the
//! pane untouched.

use super::bindings::{BindingAction, BindingsLayout, InputKind};
use alacritty_terminal::term::TermMode;
use iced_core::keyboard::{key::Named, Modifiers};

fn action(input: InputKind, modifiers: Modifiers) -> BindingAction {
    BindingsLayout::new().get_action(input, modifiers, TermMode::empty())
}

fn ch(c: &str) -> InputKind {
    InputKind::Char(c.into())
}

fn key(n: Named) -> InputKind {
    InputKind::KeyCode(n)
}

const CTRL_SHIFT: Modifiers = Modifiers::CTRL.union(Modifiers::SHIFT);

// ---- Ctrl+Shift+C: copy ----

#[test]
fn ctrl_shift_c_copies() {
    assert_eq!(action(ch("c"), CTRL_SHIFT), BindingAction::Copy);
}

#[test]
fn ctrl_c_stays_with_the_process_it_is_sigint() {
    // Never Copy: the byte goes to the shell, which is what interrupts the running process.
    assert_eq!(action(ch("c"), Modifiers::CTRL), BindingAction::Char('\x03'));
}

#[test]
fn shift_c_alone_is_a_capital_and_alt_variants_are_left_alone() {
    assert_eq!(action(ch("c"), Modifiers::SHIFT), BindingAction::Ignore);
    assert_ne!(action(ch("c"), CTRL_SHIFT | Modifiers::ALT), BindingAction::Copy);
}

#[test]
fn no_other_letter_is_taken_for_copy() {
    for k in ["v", "z", "a", "x"] {
        assert_ne!(action(ch(k), CTRL_SHIFT), BindingAction::Copy, "{k}");
    }
}

// ---- Ctrl+Enter: a newline, not a submit ----

#[test]
fn ctrl_enter_is_a_bare_line_feed_and_so_is_ctrl_shift_enter() {
    assert_eq!(action(key(Named::Enter), Modifiers::CTRL), BindingAction::Char('\n'));
    assert_eq!(action(key(Named::Enter), CTRL_SHIFT), BindingAction::Char('\n'));
}

#[test]
fn enter_alone_still_submits_and_shift_enter_is_untouched() {
    // The reverse would be worse than the bug: nothing would ever run.
    assert_eq!(action(key(Named::Enter), Modifiers::empty()), BindingAction::Char('\r'));
    assert_eq!(action(key(Named::Enter), Modifiers::SHIFT), BindingAction::Char('\r'));
}

#[test]
fn ctrl_alt_enter_goes_back_to_the_pane() {
    // AltGr looks like Ctrl+Alt on European layouts: capturing it would steal typed characters.
    assert_ne!(action(key(Named::Enter), Modifiers::CTRL | Modifiers::ALT), BindingAction::Char('\n'));
}

#[test]
fn other_keys_with_ctrl_are_not_newlines() {
    for k in [Named::Escape, Named::Tab] {
        assert_ne!(action(key(k), Modifiers::CTRL), BindingAction::Char('\n'), "{k:?}");
    }
    // Ctrl+J already *is* a line feed, in every terminal: that is the byte Ctrl+Enter reuses.
    assert_eq!(action(ch("j"), Modifiers::CTRL), BindingAction::Char('\n'));
}

#[test]
fn the_newline_is_not_a_carriage_return() {
    // `\r` is what Enter sends: resending it would reproduce the bug while looking like a fix.
    let BindingAction::Char(c) = action(key(Named::Enter), Modifiers::CTRL) else { panic!() };
    assert_eq!(c, '\n');
}
