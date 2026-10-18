//! What a pane's activity badge says (PRD feature 4). Port of `pane-status-machine.ts`.
//!
//! A purely temporal rule ("no output for N ms, so waiting") fires every time an agent pauses to
//! think, which is exactly when it is *not* waiting. So the signals are ranked, and the weakest only
//! ever produces `Idle`:
//!
//! - BEL           -> `Attention` (strong: Claude Code rings the bell when it wants an answer)
//! - silence > 800 ms -> `Idle`   (weak, last resort)
//! - process exit  -> `Exited`    (certain)
//!
//! `Attention` is sticky: it survives further output and is cleared only when the user types into
//! that pane.
//!
//! One signal 0.5.0 also used is gone: OSC 133 prompt markers. The terminal engine (`alacritty`)
//! consumes them without reporting them, and the default shells do not emit them; the BEL and silence
//! rules above are what decided the badge in practice. Pure, with no clock of its own.

use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PaneStatus {
    /// Producing output right now.
    Running,
    /// Waiting for the user.
    Attention,
    /// Alive but quiet, most likely at a prompt.
    Idle,
    /// The process is gone.
    Exited,
}

impl PaneStatus {
    /// The badge's tooltip, as in 0.5.0.
    pub fn label(self) -> &'static str {
        match self {
            PaneStatus::Running => "en cours",
            PaneStatus::Attention => "attend une réponse",
            PaneStatus::Idle => "inactif",
            PaneStatus::Exited => "terminé",
        }
    }
}

pub const IDLE_AFTER: Duration = Duration::from_millis(800);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PaneStatusState {
    pub status: PaneStatus,
    pub last_output_at: Instant,
    pub exit_code: Option<i32>,
}

#[derive(Clone, Copy, Debug)]
pub enum PaneEvent {
    /// Output reached the pane; `bell` is whether it carried a BEL.
    Output { at: Instant, bell: bool },
    Input { at: Instant },
    Exit { code: i32 },
    Tick { at: Instant },
}

pub fn initial(at: Instant) -> PaneStatusState {
    PaneStatusState { status: PaneStatus::Idle, last_output_at: at, exit_code: None }
}

pub fn reduce(state: PaneStatusState, event: PaneEvent, idle_after: Duration) -> PaneStatusState {
    use PaneStatus::*;
    match event {
        PaneEvent::Exit { code } => PaneStatusState { status: Exited, exit_code: Some(code), ..state },
        PaneEvent::Input { at } => {
            // The user answered, so whatever was being asked is answered.
            if state.status == Exited {
                return state;
            }
            PaneStatusState { status: Running, last_output_at: at, ..state }
        }
        PaneEvent::Output { at, bell } => {
            if state.status == Exited {
                return state;
            }
            if bell {
                return PaneStatusState { status: Attention, last_output_at: at, ..state };
            }
            // Output alone never clears attention: the prompt may still be waiting while the agent
            // redraws its spinner.
            if state.status == Attention {
                return PaneStatusState { last_output_at: at, ..state };
            }
            PaneStatusState { status: Running, last_output_at: at, ..state }
        }
        PaneEvent::Tick { at } => {
            if state.status != Running || at.saturating_duration_since(state.last_output_at) < idle_after {
                return state;
            }
            PaneStatusState { status: Idle, ..state }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(base: Instant, n: u64) -> Instant {
        base + Duration::from_millis(n)
    }

    fn feed(base: Instant, events: &[PaneEvent]) -> PaneStatusState {
        events.iter().fold(initial(base), |s, e| reduce(s, *e, IDLE_AFTER))
    }

    #[test]
    fn running_as_soon_as_there_is_output() {
        let t = Instant::now();
        assert_eq!(feed(t, &[PaneEvent::Output { at: ms(t, 10), bell: false }]).status, PaneStatus::Running);
    }

    #[test]
    fn bell_raises_attention() {
        let t = Instant::now();
        assert_eq!(feed(t, &[PaneEvent::Output { at: ms(t, 10), bell: true }]).status, PaneStatus::Attention);
    }

    #[test]
    fn attention_survives_output_that_continues() {
        // An agent redrawing its spinner while the prompt still waits must not clear the badge.
        let t = Instant::now();
        let s = feed(t, &[
            PaneEvent::Output { at: ms(t, 10), bell: true },
            PaneEvent::Output { at: ms(t, 20), bell: false },
            PaneEvent::Output { at: ms(t, 30), bell: false },
        ]);
        assert_eq!(s.status, PaneStatus::Attention);
    }

    #[test]
    fn a_tick_cannot_clear_attention() {
        let t = Instant::now();
        let s = feed(t, &[PaneEvent::Output { at: ms(t, 10), bell: true }, PaneEvent::Tick { at: ms(t, 60_000) }]);
        assert_eq!(s.status, PaneStatus::Attention);
    }

    #[test]
    fn the_users_keystroke_acknowledges_attention() {
        let t = Instant::now();
        let s = feed(t, &[PaneEvent::Output { at: ms(t, 10), bell: true }, PaneEvent::Input { at: ms(t, 20) }]);
        assert_eq!(s.status, PaneStatus::Running);
    }

    #[test]
    fn no_false_positive_during_a_long_command() {
        let t = Instant::now();
        let mut s = initial(t);
        for i in 1..=20u64 {
            s = reduce(s, PaneEvent::Output { at: ms(t, i * 100), bell: false }, IDLE_AFTER);
            s = reduce(s, PaneEvent::Tick { at: ms(t, i * 100 + 50) }, IDLE_AFTER);
        }
        assert_eq!(s.status, PaneStatus::Running);
    }

    #[test]
    fn falls_back_to_idle_after_a_long_silence() {
        let t = Instant::now();
        let s = feed(t, &[
            PaneEvent::Output { at: ms(t, 100), bell: false },
            PaneEvent::Tick { at: ms(t, 300) },
            PaneEvent::Tick { at: ms(t, 1500) },
        ]);
        assert_eq!(s.status, PaneStatus::Idle);
    }

    #[test]
    fn records_the_exit_code_and_never_moves_again() {
        let t = Instant::now();
        let s = feed(t, &[
            PaneEvent::Exit { code: 3 },
            PaneEvent::Output { at: ms(t, 20), bell: false },
            PaneEvent::Input { at: ms(t, 30) },
            PaneEvent::Tick { at: ms(t, 40) },
        ]);
        assert_eq!((s.status, s.exit_code), (PaneStatus::Exited, Some(3)));
    }
}
