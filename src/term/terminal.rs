use crate::term::actions::Action;
use crate::term::backend;
use crate::term::capture;
use crate::term::bindings::{Binding, BindingAction, BindingsLayout, InputKind};
use crate::term::font::TermFont;
use crate::term::settings::{FontSettings, Settings, ThemeSettings};
use crate::term::theme::{ColorPalette, Theme};
use crate::term::AlacrittyEvent;
use iced::futures::stream::BoxStream;
use iced::futures::{SinkExt, StreamExt};
use iced::widget::canvas::Cache;
use iced::Subscription;
use std::hash::{Hash, Hasher};
use std::io::Result;
use std::sync::Arc;
use tokio::sync::mpsc::{self, Receiver};
use tokio::sync::Mutex;

#[derive(Debug, Clone)]
pub enum Event {
    BackendCall(u64, backend::Command),
}

#[derive(Debug, Clone)]
pub enum Command {
    ChangeTheme(Box<ColorPalette>),
    ChangeFont(FontSettings),
    AddBindings(Vec<(Binding<InputKind>, BindingAction)>),
    ProxyToBackend(backend::Command),
}

/// Output arrives in bursts of thousands of chunks per second; repainting a pane for each one is
/// what made a flood of output cost several cores. At most one repaint per interval, plus a
/// trailing one (`tick`) so the last chunk of a burst is never left unpainted.
/// xterm.js blinks its caret every 600 ms (`cursorBlink: true` in 0.5.0).
pub const CURSOR_BLINK_INTERVAL: std::time::Duration = std::time::Duration::from_millis(600);

const MIN_REPAINT_INTERVAL: std::time::Duration = std::time::Duration::from_millis(33);

pub struct Terminal {
    pub id: u64,
    widget_id: iced::widget::Id,
    pub(crate) font: TermFont,
    pub(crate) theme: Theme,
    pub(crate) cache: Cache,
    pub(crate) bindings: BindingsLayout,
    pub(crate) reserved: Option<crate::term::settings::Reserved>,
    dirty: bool,
    /// Phase of the caret blink. Only a focused pane shows a filled caret, and only while this is on.
    pub(crate) cursor_on: bool,
    capture: crate::term::capture::CommandCapture,
    last_repaint: std::time::Instant,
    pub(crate) backend: backend::Backend,
    backend_event_rx: Arc<Mutex<Receiver<AlacrittyEvent>>>,
}

impl Terminal {
    pub fn new(id: u64, settings: Settings) -> Result<Self> {
        let (backend_event_tx, backend_event_rx) = mpsc::channel(100);
        let reserved = settings.reserved;
        let theme = Theme::new(settings.theme);
        let font = TermFont::estimated(settings.font);

        let mut terminal = Self {
            id,
            widget_id: iced::widget::Id::unique(),
            font,
            theme,
            bindings: BindingsLayout::default(),
            reserved,
            dirty: false,
            cursor_on: true,
            capture: Default::default(),
            last_repaint: std::time::Instant::now(),
            cache: Cache::default(),
            backend: backend::Backend::new(
                id,
                backend_event_tx,
                settings.backend,
            )?,
            backend_event_rx: Arc::new(Mutex::new(backend_event_rx)),
        };
        // The font is measured once here (and on `ChangeFont`), not on every repaint. Only the cell
        // size is stored: the grid keeps its 80x50 until the view reports a real size.
        terminal.backend.set_cell_size(terminal.font.measure);
        Ok(terminal)
    }

    /// The real cell size, once the shells are started (see `TermFont::estimated`).
    pub fn measure_font(&mut self) {
        self.font.sync();
        self.backend.set_cell_size(self.font.measure);
    }

    pub fn widget_id(&self) -> &iced::widget::Id {
        &self.widget_id
    }

    pub fn subscription(&self) -> Subscription<Event> {
        let data = TerminalSubscriptionData {
            id: self.id,
            event_receiver: self.backend_event_rx.clone(),
        };

        Subscription::run_with(data, terminal_subscription_stream)
    }

    pub fn handle(&mut self, cmd: Command) -> Action {
        let mut action = Action::default();

        match cmd {
            Command::ChangeTheme(color_pallete) => {
                self.theme = Theme::new(ThemeSettings::new(color_pallete));
            },
            Command::ChangeFont(font_settings) => {
                self.font = TermFont::new(font_settings);
                self.sync_font();
            },
            Command::AddBindings(bindings) => {
                self.bindings.add_bindings(bindings);
            },
            Command::ProxyToBackend(cmd) => {
                // Taken before the input can be echoed: the cursor is still where the prompt ends.
                if let backend::Command::Write(bytes) = &cmd {
                    self.capture_input(bytes);
                    // Typing shows the caret solid, as every terminal does.
                    self.cursor_on = true;
                }
                action = self.backend.handle(cmd);
                self.poll_capture();
            },
        };

        if self.last_repaint.elapsed() >= MIN_REPAINT_INTERVAL {
            self.repaint();
        } else {
            self.dirty = true;
        }
        action
    }

    fn capture_input(&mut self, bytes: &[u8]) {
        let handle = self.backend.term_handle();
        let term = handle.lock();
        let screen = capture::GridScreen {
            grid: term.grid(),
            alternate: term.mode().contains(crate::term::TermMode::ALT_SCREEN),
        };
        self.capture.on_data(bytes, &screen, std::time::Instant::now());
    }

    fn poll_capture(&mut self) {
        if !self.capture.has_pending() {
            return;
        }
        let handle = self.backend.term_handle();
        let term = handle.lock();
        let screen = capture::GridScreen { grid: term.grid(), alternate: false };
        self.capture.poll(&screen, std::time::Instant::now());
    }

    /// Writes a notice into the pane's screen (not to its process), e.g. when the process ends.
    pub fn print_notice(&mut self, text: &str) {
        self.backend.feed_screen(text.as_bytes());
        self.repaint();
    }

    /// The text currently selected with the mouse (empty when nothing is).
    pub fn selected_text(&self) -> String {
        self.backend.selectable_content()
    }

    /// See `CommandCapture::seed`.
    pub fn seed_command(&mut self, command: &str) {
        self.capture.seed(command);
    }

    /// The last command read off this pane's screen (what a folded pane shows on hover).
    pub fn last_command(&self) -> Option<&str> {
        self.capture.last()
    }

    /// What the application's subscription does: feed each backend event back through `handle`
    /// (ConPTY asks for the cursor position at startup and waits for the answer).
    #[cfg(test)]
    pub(crate) fn drain_events_for_tests(&mut self) {
        let mut events = Vec::new();
        if let Ok(mut rx) = self.backend_event_rx.try_lock() {
            while let Ok(e) = rx.try_recv() {
                events.push(e);
            }
        }
        for e in events {
            self.handle(Command::ProxyToBackend(backend::Command::ProcessAlacrittyEvent(e)));
        }
    }

    fn repaint(&mut self) {
        self.sync_and_redraw();
        self.dirty = false;
        self.last_repaint = std::time::Instant::now();
    }

    /// Flips the caret. Call it every `CURSOR_BLINK_INTERVAL` for the *focused* pane only: an
    /// unfocused pane shows a hollow caret that does not blink, so it costs nothing.
    pub fn blink_tick(&mut self) {
        self.cursor_on = !self.cursor_on;
        self.redraw();
    }

    /// Output was skipped by the throttle and still has to be painted.
    pub fn is_dirty(&self) -> bool {
        self.dirty || self.capture.has_pending()
    }

    /// Paints what the throttle held back. Call it from a timer while `is_dirty()`.
    pub fn tick(&mut self) {
        self.poll_capture();
        if self.dirty {
            self.repaint();
        }
    }

    fn sync_and_redraw(&mut self) {
        self.backend.sync();
        self.redraw();
    }

    fn sync_font(&mut self) {
        self.font.sync();
        self.backend
            .handle(backend::Command::Resize(None, Some(self.font.measure)));
    }

    fn redraw(&mut self) {
        self.cache.clear();
    }
}

#[derive(Clone)]
struct TerminalSubscriptionData {
    id: u64,
    event_receiver: Arc<Mutex<Receiver<AlacrittyEvent>>>,
}

impl Hash for TerminalSubscriptionData {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.id.hash(state);
    }
}

fn terminal_subscription_stream(
    data: &TerminalSubscriptionData,
) -> BoxStream<'static, Event> {
    let id = data.id;
    let event_receiver = data.event_receiver.clone();
    iced::stream::channel(1000, async move |mut output| {
        let mut shutdown = false;
        loop {
            let mut event_receiver = event_receiver.lock().await;
            match event_receiver.recv().await {
                Some(event) => {
                    if let AlacrittyEvent::Exit = event {
                        shutdown = true
                    };

                    output
                        .send(Event::BackendCall(id, backend::Command::ProcessAlacrittyEvent(event)))
                        .await
                        .unwrap_or_else(|_| {
                            panic!("iced_term stream {}: sending BackendEventReceived event is failed", id)
                        });
                },
                None => {
                    if !shutdown {
                        panic!("iced_term stream {}: terminal event channel closed unexpected", id);
                    }
                },
            }
        }
    })
    .boxed()
}
