//! P01 spike: 6 vendored `iced_term` panes running pwsh, to measure RAM / startup against the 0.5.0
//! baseline and to prove which keystrokes reach the shell and which reach the application.
//!
//! Every keyboard event the *application* sees is appended to `%TEMP%\myterm-spike-keys.log` with
//! whether a widget already captured it. `ICED_BACKEND=tiny-skia` forces the software renderer.

use iced::keyboard::{self, key::Named, Key, Modifiers};
use iced::widget::{column, container, row};
use iced::{event, window, Element, Font, Length, Size, Subscription, Task};
use myterm::term::{self, settings::{BackendSettings, FontSettings, Settings}, AlacrittyEvent, BackendCommand, Terminal, TerminalView};
use std::io::Write;

const PANES: usize = 6;

/// The app's own Ctrl+Shift chords: the widget must not turn them into bytes for the shell.
/// Digits are matched on the physical key (layout-independent); letters on the logical key.
fn reserved(e: &keyboard::Event) -> bool {
    use keyboard::key::{Code, Physical};
    let keyboard::Event::KeyPressed { key, modified_key, physical_key, modifiers, .. } = e else { return false };
    if *modifiers != Modifiers::CTRL | Modifiers::SHIFT {
        return false;
    }
    let digit = matches!(
        physical_key,
        Physical::Code(Code::Digit1 | Code::Digit2 | Code::Digit3 | Code::Digit4 | Code::Digit5 | Code::Digit6 | Code::Digit7 | Code::Digit8 | Code::Digit9)
    ) || matches!(modified_key, Key::Character(c) if c.len() == 1 && c.chars().all(|ch| ('1'..='9').contains(&ch)));
    match key {
        Key::Named(Named::ArrowLeft | Named::ArrowRight | Named::ArrowUp | Named::ArrowDown) => true,
        Key::Character(c) => digit || matches!(c.to_lowercase().as_str(), "z" | "m"),
        _ => digit,
    }
}

struct App {
    terms: Vec<Terminal>,
    log: std::fs::File,
}

#[derive(Debug, Clone)]
enum Msg {
    Term(term::Event),
    Key(keyboard::Event, bool),
    Tick,
}

/// `SPIKE_PROGRAMS="claude;codex;pwsh -NoLogo"`: one command line per pane, cycled; default `pwsh`.
fn program_for(id: u64, dir: Option<std::path::PathBuf>) -> BackendSettings {
    let list = std::env::var("SPIKE_PROGRAMS").unwrap_or_else(|_| "pwsh".into());
    let lines: Vec<&str> = list.split(';').collect();
    let mut parts = lines[id as usize % lines.len()].split_whitespace();
    BackendSettings {
        program: parts.next().unwrap_or("pwsh").into(),
        args: parts.map(String::from).collect(),
        working_directory: dir,
        ..Default::default()
    }
}

fn boot() -> (App, Task<Msg>) {
    let dir = std::env::args().nth(1).map(std::path::PathBuf::from);
    let terms = (0..PANES as u64)
        .map(|id| {
            Terminal::new(
                id,
                Settings {
                    font: FontSettings { size: 13.0, scale_factor: 1.2, font_type: Font::with_name("Cascadia Mono") },
                    backend: program_for(id, dir.clone()),
                    reserved: Some(reserved),
                    theme: myterm::term::settings::ThemeSettings::new(myterm::palette::color_palette(
                        if std::env::var("SPIKE_THEME").as_deref() == Ok("light") {
                            myterm::palette::ResolvedTheme::Light
                        } else {
                            myterm::palette::ResolvedTheme::Dark
                        },
                    )),
                    ..Default::default()
                },
            )
            .expect("terminal")
        })
        .collect();
    let log = std::fs::File::create(std::env::temp_dir().join("myterm-spike-keys.log")).unwrap();
    let _ = &log;
    (App { terms, log }, Task::none())
}

fn update(app: &mut App, msg: Msg) -> Task<Msg> {
    match msg {
        Msg::Term(term::Event::BackendCall(id, cmd)) => {
            let mut logged_selection = false;
            if matches!(&cmd, BackendCommand::SelectStart(..) | BackendCommand::SelectUpdate(..)) {
                let _ = writeln!(app.log, "pane {id}: {cmd:?}");
                logged_selection = true;
            }
            if let BackendCommand::ProcessAlacrittyEvent(AlacrittyEvent::Bell) = &cmd {
                let _ = writeln!(app.log, "pane {id}: BEL");
            }
            let _ = &logged_selection;
            if let Some(t) = app.terms.iter_mut().find(|t| t.id == id) {
                // A pane whose process ended stays on screen (0.5.0 shows it as "exited").
                if matches!(t.handle(term::Command::ProxyToBackend(cmd)), term::actions::Action::Shutdown) {
                    let _ = writeln!(app.log, "pane {id}: process exited");
                }
                if logged_selection {
                    let _ = writeln!(app.log, "   selected={:?}", t.selected_text());
                }
            }
        }
        Msg::Key(keyboard::Event::KeyPressed { key, modified_key, physical_key, modifiers, text, .. }, captured) => {
            let _ = writeln!(app.log, "app saw key={key:?} mod_key={modified_key:?} phys={physical_key:?} mods={modifiers:?} text={text:?} captured={captured}");
            let _ = app.log.flush();
        }
        Msg::Tick => app.terms.iter_mut().for_each(Terminal::tick),
        Msg::Key(..) => {}
    }
    Task::none()
}

fn view(app: &App) -> Element<'_, Msg> {
    fn cell(t: &Terminal) -> Element<'_, Msg> {
        container(TerminalView::show(t).map(Msg::Term)).width(Length::FillPortion(1)).height(Length::FillPortion(1)).padding(2).into()
    }
    let rows = app.terms.chunks(3).map(|r| row(r.iter().map(cell)).into());
    column(rows).into()
}

fn subscription(app: &App) -> Subscription<Msg> {
    let terms = app.terms.iter().map(|t| t.subscription().map(Msg::Term));
    let keys = event::listen_with(|e, status, _| match e {
        iced::Event::Keyboard(k) => Some(Msg::Key(k, status == event::Status::Captured)),
        _ => None,
    });
    let tick = app.terms.iter().any(Terminal::is_dirty).then(|| iced::time::every(std::time::Duration::from_millis(33)).map(|_| Msg::Tick));
    Subscription::batch(terms.chain([keys]).chain(tick))
}

fn main() -> iced::Result {
    myterm::platform::restore_default_ctrl_c();
    iced::application(boot, update, view)
        .title("MyTerm spike")
        .window_size(Size::new(1600.0, 1000.0))
        .subscription(subscription)
        .run()
}
