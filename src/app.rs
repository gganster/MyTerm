//! The application: one window, one project. Opening flow, window chrome, grid, panes, folded-pane
//! bar, trust dialog, layout editor, autosave and reload.
//!
//! Ports `App.tsx`, `GridView`, `PaneView`, `PaneHeader`, `PaneBadge`, `CollapsedBar`, `TrustDialog`,
//! `ThemeToggle`, `OpenInEditor`, `ReloadBanner`, `use-autosave` and `use-workspace`. The status bar
//! is T07, the update banner T08.

use crate::chords::{self, AppChord, ESCAPE_UNZOOMS};
use crate::cwd::relative_to_project;
use crate::editor::{self, EditOp, EditorState};
use crate::external_editor::{self, EditorId, EditorInfo};
use crate::grid::{columns_for_width, MIN_PANE_HEIGHT};
use crate::home::{self, Home};
use crate::identity;
use crate::instances;
use crate::open::{decide_trust, open_workspace, OpenResult, Opened, PendingTrust, TrustDecision};
use crate::palette::{color_palette, pane_border, project_chrome, ResolvedTheme};
use crate::palette_chrome::{Chrome, DARK_CHROME, LIGHT_CHROME};
use crate::platform;
use crate::prefs_store::{user_data_dir, PrefsStore};
use crate::schema::edit::{add_pane, move_pane, panes_needing_restart, remove_pane, set_project_color, update_pane};
use crate::schema::layout::{Pane, PaneColor, ThemeMode};
use crate::schema::prefs::WindowState;
use crate::shell::resolve_shell;
use crate::status_bar;
use crate::system_load;
use crate::updater;
use crate::usage::{self, Provider};
use crate::status::{self, PaneEvent, PaneStatus, PaneStatusState, IDLE_AFTER};
use crate::term::settings::{BackendSettings, FontSettings, Settings, ThemeSettings};
use crate::term::{self, AlacrittyEvent, BackendCommand, Terminal, TerminalView, CURSOR_BLINK_INTERVAL};
use crate::trust::ResolvedPane;
use crate::ui::{button_style, card, hex, with_alpha, Ch, Look};
use crate::view_state::ViewState;
use crate::workspace::{layout_fingerprint, resolve_panes};
use iced::widget::{button, column, container, mouse_area, opaque, responsive, row, scrollable, stack, text, tooltip, Space};
use iced::{border, event, keyboard, time, window, Alignment, Background, Border, Color, Element, Font, Length, Point, Size, Subscription, Task, Theme};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const STATUS_TICK: Duration = Duration::from_millis(250);
const PERSIST_TICK: Duration = Duration::from_millis(500);
/// 0.5.0 saved a layout edit about a second after the last keystroke.
const AUTOSAVE_AFTER: Duration = Duration::from_secs(1);
const SAVE_TICK: Duration = Duration::from_millis(250);
/// ponytail: the file is re-read twice a second where 0.5.0 used a directory watcher. A few
/// kilobytes per tick; swap for the `notify` crate if a project with a huge layout ever shows up.
const DISK_TICK: Duration = Duration::from_millis(500);
/// How often Windows' own light/dark choice is looked at while the theme follows it.
const THEME_TICK: Duration = Duration::from_secs(2);
/// CPU and RAM are sampled every two seconds, as in 0.5.0; the quotas ride the same tick.
const BAR_TICK: Duration = Duration::from_secs(2);
const GAP: f32 = 6.0;
const EDITOR_WIDTH: f32 = 320.0;

struct PaneRt {
    id: String,
    term: Terminal,
    status: PaneStatusState,
    exit_noticed: bool,
}

struct Workspace {
    opened: Opened,
    view: ViewState,
    panes: Vec<PaneRt>,
    ed: EditorState,
    /// Edited and not yet written. Autosave writes it `AUTOSAVE_AFTER` after the last edit.
    dirty: bool,
    edited_at: Instant,
    save_error: Option<String>,
    /// Fingerprint of `.myterm.json` as we last read or wrote it: a different one on disk is an outside edit.
    disk: Option<String>,
    changed_on_disk: bool,
    reload_error: Option<String>,
    editors: Vec<EditorInfo>,
    editor_failure: Option<String>,
    /// A reload whose commands are not the approved ones: the dialog is shown over the running panes.
    pending_trust: Option<Box<PendingTrust>>,
}

enum Screen {
    Home(Home),
    Trust(Box<PendingTrust>),
    Workspace(Box<Workspace>),
}

pub struct App {
    prefs: PrefsStore,
    screen: Screen,
    window: Size,
    /// Last known top-left, logical. `None` until the window has moved once.
    position: Option<Point>,
    mode: ThemeMode,
    dark: bool,
    next_term_id: u64,
    /// The instance colour the window was last told about; `None` = never coloured, never touched.
    identity: Option<Option<PaneColor>>,
    /// The footer's source: one poller per agent, written by their threads, copied on `BarTick`.
    pollers: [usage::Shared; 2],
    sampler: system_load::Sampler,
    bar: status_bar::Readings,
    /// The elected instance's download, copied on `BarTick`; `None` when updates are disabled.
    updates: Option<updater::Shared>,
    update: Option<updater::Ready>,
    /// The version the user said « Plus tard » to: hidden until a newer one lands.
    update_later: Option<String>,
    /// Other windows are open: the install asks before closing them all.
    update_confirm: bool,
    update_error: Option<String>,
}

#[derive(Debug, Clone)]
pub enum Msg {
    Term(term::Event),
    Key(keyboard::Event, bool),
    Resized(Size),
    Moved(Point),
    Maximized(bool),
    Heartbeat,
    BarTick,
    InstallUpdate,
    ConfirmUpdate,
    CancelUpdate,
    UpdateLater,
    CloseRequested(window::Id),
    StatusTick,
    RepaintTick,
    Blink,
    PersistTick,
    SaveTick,
    DiskTick,
    ThemeTick,
    Trust(TrustChoice),
    Collapse(String),
    Zoom(String),
    FocusPane(String),
    Restore(String),
    // home
    PickFolder,
    Picked(Option<PathBuf>),
    OpenRecent(String),
    Forget(String),
    // window chrome
    SetTheme(ThemeMode),
    CloseProject,
    ToggleEditor,
    OpenEditor(EditorId),
    TaskbarId(u64, String),
    // layout editor
    Edit(EditOp),
    EditorSelect(String),
    CancelRemove,
    Restart(String),
    PickPaneCwd,
    PanePicked(Option<PathBuf>),
    // outside edits
    Reload,
    DismissReload,
}

#[derive(Debug, Clone, Copy)]
pub enum TrustChoice {
    Approve,
    OpenWithoutExecuting,
    Cancel,
}

fn chrome_for(dark: bool) -> Ch {
    if dark {
        &DARK_CHROME
    } else {
        &LIGHT_CHROME
    }
}

fn status_dot(chrome: &Chrome, status: PaneStatus) -> Color {
    hex(match status {
        PaneStatus::Running => chrome.status_running,
        PaneStatus::Attention => chrome.status_attention,
        PaneStatus::Idle => chrome.status_idle,
        PaneStatus::Exited => chrome.status_exited,
    })
}

fn title_of(pane: &Pane) -> &str {
    if pane.title.is_empty() {
        pane.id.as_str()
    } else {
        pane.title.as_str()
    }
}

fn resolve_mode(mode: ThemeMode) -> bool {
    match mode {
        ThemeMode::Dark => true,
        ThemeMode::Light => false,
        ThemeMode::System => platform::system_prefers_dark(),
    }
}

/// A shell for one pane. The command goes to it only when the caller holds the approval (that is
/// what `command` being `Some` means: it comes from [`Opened::autolaunch`]).
fn spawn_pane(term_id: u64, theme: ResolvedTheme, rp: &ResolvedPane, command: Option<&str>) -> Result<PaneRt, String> {
    let settings = Settings {
        font: FontSettings { size: 13.0, scale_factor: 1.2, font_type: Font::with_name("Cascadia Mono") },
        theme: ThemeSettings::new(color_palette(theme)),
        backend: BackendSettings { program: resolve_shell(&rp.shell), working_directory: Some(rp.cwd.clone().into()), ..Default::default() },
        reserved: Some(chords::reserved),
    };
    let mut term = Terminal::new(term_id, settings).map_err(|e| format!("impossible de démarrer le shell du pane « {} » : {e}", rp.id))?;
    if let Some(command) = command {
        term.seed_command(command);
        term.handle(term::Command::ProxyToBackend(BackendCommand::Write(format!("{command}\r").into_bytes())));
    }
    let mut state = status::initial(Instant::now());
    state.status = PaneStatus::Running;
    Ok(PaneRt { id: rp.id.clone(), term, status: state, exit_noticed: false })
}

// ---------------------------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------------------------

impl App {
    pub fn boot() -> (App, Task<Msg>) {
        let prefs = PrefsStore::load(user_data_dir().join("preferences.json"));
        let mode = prefs.get().theme;
        let w = prefs.get().window.clone();
        let screen = Screen::Home(Home::load(&prefs, None));
        // Only the oldest live instance checks: every window polling GitHub would multiply the requests
        // and point several downloads at one folder.
        let updates = updater::Source::for_run(identity::packaged()).map(|source| {
            updater::start(env!("CARGO_PKG_VERSION"), source, || instances::global().is_none_or(|r| r.is_primary()))
        });
        let pollers = [usage::start_poller(Provider::Claude), usage::start_poller(Provider::Codex)];
        let mut sampler = system_load::Sampler::default();
        // Primes the counters: the first pushed sample then has a delta to work with.
        let first = sampler.sample();
        let bar = status_bar::Readings { claude: usage::unavailable("pending", usage::now_ms()), codex: usage::unavailable("pending", usage::now_ms()), load: Some(first), now: usage::now_ms() };
        let mut app = App { prefs, screen, window: Size::new(w.width as f32, w.height as f32), position: None, mode, dark: resolve_mode(mode), next_term_id: 0, identity: None, pollers, sampler, bar, updates, update: None, update_later: None, update_confirm: false, update_error: None };

        // `myterm <folder>`: the CLI door. (The shim, the context menu and single-instance rules are T06.)
        let task = match std::env::args().skip(1).find(|a| !a.starts_with('-')) {
            Some(path) => app.open(&path),
            None => Task::none(),
        };
        let identity = app.sync_identity();
        (app, Task::batch([task, identity]))
    }

    fn open(&mut self, path: &str) -> Task<Msg> {
        match open_workspace(path, &mut self.prefs) {
            OpenResult::Error { message, .. } => {
                self.go_home(Some(message));
                Task::none()
            }
            OpenResult::NeedsTrust(pending) => {
                self.screen = Screen::Trust(Box::new(pending));
                Task::none()
            }
            OpenResult::Ok(opened) => self.start(opened),
        }
    }

    fn go_home(&mut self, error: Option<String>) {
        self.screen = Screen::Home(Home::load(&self.prefs, error));
        ESCAPE_UNZOOMS.store(false, std::sync::atomic::Ordering::Relaxed);
    }

    fn resolved(&self) -> ResolvedTheme {
        if self.dark {
            ResolvedTheme::Dark
        } else {
            ResolvedTheme::Light
        }
    }

    fn start(&mut self, opened: Opened) -> Task<Msg> {
        let theme = self.resolved();
        let mut panes = Vec::new();
        for rp in &opened.panes {
            // The command goes to the shell only through `Opened::autolaunch`, which needs the approval.
            match spawn_pane(self.next_term_id, theme, rp, opened.autolaunch(&rp.id).as_deref()) {
                Ok(pane) => {
                    self.next_term_id += 1;
                    panes.push(pane);
                }
                Err(message) => {
                    self.go_home(Some(message));
                    return Task::none();
                }
            }
        }
        // Every shell is started: now the (slow, once) font measurement.
        panes.iter_mut().for_each(|p: &mut PaneRt| p.term.measure_font());
        let mut view = ViewState::open(opened.layout.clone());
        view.columns = columns_for_width(self.window.width, view.visible_panes().len());
        ESCAPE_UNZOOMS.store(false, std::sync::atomic::Ordering::Relaxed);
        let focus = view.focused.clone();
        let disk = layout_fingerprint(Path::new(&opened.project_path));
        let mut ed = EditorState::default();
        ed.sync_command(&view, true);
        let editors = external_editor::list_editors(&external_editor::Env::from_process(), |p| p.exists());
        self.screen = Screen::Workspace(Box::new(Workspace {
            opened,
            view,
            panes,
            ed,
            dirty: false,
            edited_at: Instant::now(),
            save_error: None,
            disk,
            changed_on_disk: false,
            reload_error: None,
            editors,
            editor_failure: None,
            pending_trust: None,
        }));
        match focus {
            Some(id) => self.focus_task(&id),
            None => Task::none(),
        }
    }

    fn workspace_mut(&mut self) -> Option<&mut Workspace> {
        match &mut self.screen {
            Screen::Workspace(w) => Some(w),
            _ => None,
        }
    }

    fn focus_task(&self, pane_id: &str) -> Task<Msg> {
        match &self.screen {
            Screen::Workspace(w) => w
                .panes
                .iter()
                .find(|p| p.id == pane_id)
                .map(|p| TerminalView::focus::<Msg>(p.term.widget_id().clone()))
                .unwrap_or_else(Task::none),
            _ => Task::none(),
        }
    }

    /// Columns follow the width of the pane area (the window minus the editor, as in 0.5.0) and
    /// the number of panes on the grid.
    fn relayout(&mut self) {
        let window = self.window.width;
        if let Some(w) = self.workspace_mut() {
            let width = window - if w.ed.open { EDITOR_WIDTH } else { 0.0 };
            w.view.columns = columns_for_width(width, w.view.visible_panes().len().max(1));
            ESCAPE_UNZOOMS.store(w.view.zoomed.is_some(), std::sync::atomic::Ordering::Relaxed);
        }
    }

    fn apply_theme(&mut self) {
        let theme = self.resolved();
        if let Screen::Workspace(w) = &mut self.screen {
            for p in &mut w.panes {
                p.term.handle(term::Command::ChangeTheme(color_palette(theme)));
            }
        }
    }

    /// The taskbar follows the layout this process validated and wrote, never the text being typed:
    /// the colour reaches the icon and the button when it reaches the file.
    fn sync_identity(&mut self) -> Task<Msg> {
        let color = match &self.screen {
            Screen::Workspace(w) => w.opened.layout.color,
            _ => None,
        };
        if self.identity == Some(color) || (self.identity.is_none() && color.is_none()) {
            return Task::none();
        }
        self.identity = Some(color);
        let app_id = identity::window_app_user_model_id(&identity::app_user_model_id(identity::packaged()), color);
        let icon = identity::window_icon(color);
        window::oldest().and_then(move |id| {
            let app_id = app_id.clone();
            let mut tasks = vec![window::raw_id::<Msg>(id).map(move |raw| Msg::TaskbarId(raw, app_id.clone()))];
            if let Some(icon) = icon.clone() {
                tasks.push(window::set_icon(id, icon));
            }
            Task::batch(tasks)
        })
    }

    // -----------------------------------------------------------------------------------------
    // layout editing
    // -----------------------------------------------------------------------------------------

    /// Starts any pane the layout has and the runtime does not, drops the ones it no longer has.
    /// `with_commands`: only a reload (whose `Opened` was approved) may launch a new pane's command.
    fn reconcile(&mut self, with_commands: bool) {
        let theme = self.resolved();
        let App { screen, next_term_id, .. } = self;
        let Screen::Workspace(w) = screen else { return };
        let ids: Vec<String> = w.view.layout.panes.iter().map(|p| p.id.clone()).collect();
        w.panes.retain(|p| ids.contains(&p.id));
        let missing: Vec<&String> = ids.iter().filter(|id| !w.panes.iter().any(|p| &p.id == *id)).collect();
        if missing.is_empty() {
            return;
        }
        let resolved = resolve_panes(&w.opened.project_path, &w.view.layout).panes;
        for id in missing {
            let Some(rp) = resolved.iter().find(|r| &r.id == id) else { continue };
            let command = with_commands.then(|| w.opened.autolaunch(id)).flatten();
            match spawn_pane(*next_term_id, theme, rp, command.as_deref()) {
                Ok(mut pane) => {
                    *next_term_id += 1;
                    pane.term.measure_font();
                    w.panes.push(pane);
                }
                Err(message) => w.ed.error = Some(message),
            }
        }
    }

    /// Replaces a pane's shell with a fresh one from the *saved* spec.
    fn respawn(&mut self, id: &str) {
        let theme = self.resolved();
        let App { screen, next_term_id, .. } = self;
        let Screen::Workspace(w) = screen else { return };
        let Some(rp) = w.opened.panes.iter().find(|p| p.id == id).cloned() else { return };
        let command = w.opened.autolaunch(id);
        match spawn_pane(*next_term_id, theme, &rp, command.as_deref()) {
            Ok(mut pane) => {
                *next_term_id += 1;
                pane.term.measure_font();
                match w.panes.iter_mut().find(|p| p.id == id) {
                    Some(slot) => *slot = pane,
                    None => w.panes.push(pane),
                }
                w.ed.pending_restart.remove(id);
            }
            Err(message) => w.ed.error = Some(message),
        }
    }

    fn edit(&mut self, op: EditOp) -> Task<Msg> {
        let Some(w) = self.workspace_mut() else { return Task::none() };
        // Typing in the command box moves its own cursor; every other edit is a plain layout mutation.
        if let EditOp::Command(action) = &op {
            let is_edit = action.is_edit();
            w.ed.command.perform(action.clone());
            if !is_edit {
                return Task::none();
            }
        }
        let Some(selected) = EditorState::selected(&w.view).map(|p| p.id.clone()) else { return Task::none() };
        let layout = &w.view.layout;
        let mut restart = None;
        let result = match &op {
            EditOp::Title(t) => update_pane(layout, &selected, |p| p.title = t.clone()),
            EditOp::Cwd(c) => {
                restart = Some(selected.clone());
                update_pane(layout, &selected, |p| p.cwd = c.clone())
            }
            EditOp::Color(c) => update_pane(layout, &selected, |p| p.color = *c),
            EditOp::Shell(s) => {
                restart = Some(selected.clone());
                update_pane(layout, &selected, |p| p.shell = *s)
            }
            EditOp::Command(_) => {
                restart = Some(selected.clone());
                let command = w.ed.command.text().trim_end_matches('\n').to_string();
                update_pane(layout, &selected, |p| p.command = Some(command))
            }
            EditOp::Collapsed(b) => update_pane(layout, &selected, |p| p.collapsed = Some(*b)),
            EditOp::Add => add_pane(layout),
            EditOp::Move(id, up) => move_pane(layout, id, *up),
            EditOp::Remove(id) => {
                let running = w.panes.iter().find(|p| &p.id == id).is_some_and(|p| p.status.status != PaneStatus::Exited);
                if running && w.ed.confirm_remove.as_deref() != Some(id.as_str()) {
                    w.ed.confirm_remove = Some(id.clone());
                    return Task::none();
                }
                remove_pane(layout, id)
            }
            EditOp::ProjectColor(c) => set_project_color(layout, *c),
        };
        w.ed.confirm_remove = None;
        match result {
            Err(message) => w.ed.error = Some(message),
            Ok(next) => {
                w.ed.error = None;
                w.view.replace_layout(next);
                if let EditOp::Collapsed(b) = op {
                    w.view.set_collapsed(&selected, b);
                }
                if let Some(id) = restart {
                    w.ed.pending_restart.insert(id);
                }
                // A pane that no longer exists cannot need a restart (`unique_id` reuses freed names).
                let alive: Vec<String> = w.view.layout.panes.iter().map(|p| p.id.clone()).collect();
                w.ed.pending_restart.retain(|id| alive.contains(id));
                w.dirty = true;
                w.edited_at = Instant::now();
                let force = matches!(op, EditOp::Remove(_) | EditOp::Move(..));
                w.ed.sync_command(&w.view, force);
            }
        }
        self.reconcile(false);
        self.relayout();
        // No focus task: the keyboard stays in the box being typed in, not in a terminal.
        Task::none()
    }

    /// Writes the edited layout. A save with no edit behind it is a no-op: an untouched v1 file
    /// would otherwise be silently reserialised as v2, breaking it for a teammate on an older build.
    fn save_now(&mut self) {
        let App { screen, prefs, .. } = self;
        let Screen::Workspace(w) = screen else { return };
        if !w.dirty {
            return;
        }
        let layout = w.view.layout.clone();
        match w.opened.save_edit(&layout, prefs) {
            Ok(()) => {
                w.dirty = false;
                w.save_error = None;
                // Our own write is not an outside edit.
                w.disk = layout_fingerprint(Path::new(&w.opened.project_path));
            }
            // `dirty` stays set: the edit is still unsaved and will be retried.
            Err(e) => w.save_error = Some(e.to_string()),
        }
    }

    fn reload(&mut self) -> Task<Msg> {
        let App { screen, prefs, .. } = self;
        let Screen::Workspace(w) = screen else { return Task::none() };
        w.changed_on_disk = false;
        match open_workspace(&w.opened.project_path.clone(), prefs) {
            OpenResult::Error { message, .. } => {
                w.reload_error = Some(message);
                Task::none()
            }
            OpenResult::NeedsTrust(pending) => {
                w.pending_trust = Some(Box::new(pending));
                Task::none()
            }
            OpenResult::Ok(opened) => self.apply_reloaded(opened),
        }
    }

    /// Applies an outside edit, restarting only the panes whose spec changed. A renamed pane keeps
    /// its process: killing a dev server over a typo would be indefensible.
    fn apply_reloaded(&mut self, opened: Opened) -> Task<Msg> {
        let Some(w) = self.workspace_mut() else { return Task::none() };
        let to_restart = panes_needing_restart(&w.view.layout, &opened.layout);
        let existing: Vec<String> = w.panes.iter().map(|p| p.id.clone()).collect();
        w.reload_error = None;
        w.view.replace_layout(opened.layout.clone());
        w.disk = layout_fingerprint(Path::new(&opened.project_path));
        w.opened = opened;
        w.dirty = false;
        w.ed.error = None;
        w.ed.sync_command(&w.view, true);
        self.reconcile(true);
        // A pane the reload introduced was just started by `reconcile`; only the ones that were running restart.
        for id in to_restart.iter().filter(|id| existing.contains(id)) {
            self.respawn(id);
        }
        self.relayout();
        Task::none()
    }

    // -----------------------------------------------------------------------------------------
    // update
    // -----------------------------------------------------------------------------------------

    pub fn update(&mut self, msg: Msg) -> Task<Msg> {
        let task = self.handle(msg);
        Task::batch([task, self.sync_identity()])
    }

    fn handle(&mut self, msg: Msg) -> Task<Msg> {
        match msg {
            Msg::Term(term::Event::BackendCall(id, cmd)) => {
                if let Some(w) = self.workspace_mut() {
                    if let Some(pane) = w.panes.iter_mut().find(|p| p.term.id == id) {
                        let at = Instant::now();
                        let mut event = None;
                        match &cmd {
                            BackendCommand::ProcessAlacrittyEvent(AlacrittyEvent::Bell) => event = Some(PaneEvent::Output { at, bell: true }),
                            BackendCommand::ProcessAlacrittyEvent(AlacrittyEvent::Wakeup) => event = Some(PaneEvent::Output { at, bell: false }),
                            BackendCommand::ProcessAlacrittyEvent(AlacrittyEvent::ChildExit(code)) => event = Some(PaneEvent::Exit { code: *code }),
                            // What the user types: it answers whatever the pane was asking.
                            BackendCommand::Write(_) => event = Some(PaneEvent::Input { at }),
                            _ => {}
                        }
                        let action = pane.term.handle(term::Command::ProxyToBackend(cmd));
                        if let Some(e) = event {
                            pane.status = status::reduce(pane.status, e, IDLE_AFTER);
                        }
                        if matches!(action, term::actions::Action::Shutdown) && pane.status.status != PaneStatus::Exited {
                            pane.status = status::reduce(pane.status, PaneEvent::Exit { code: 0 }, IDLE_AFTER);
                        }
                        if pane.status.status == PaneStatus::Exited && !pane.exit_noticed {
                            pane.exit_noticed = true;
                            let code = pane.status.exit_code.unwrap_or(0);
                            pane.term.print_notice(&format!("\r\n\x1b[2m[processus terminé · code {code}]\x1b[0m\r\n"));
                        }
                    }
                }
                Task::none()
            }
            Msg::Key(event, captured) => {
                // Ctrl+S is claimed whoever holds the focus, a text box included.
                let chord = chords::classify(&event);
                if captured && chord != Some(AppChord::Save) {
                    return Task::none();
                }
                match chord {
                    Some(chord) => self.apply_chord(chord),
                    None => Task::none(),
                }
            }
            Msg::Resized(size) => {
                self.window = size;
                self.relayout();
                self.ask_maximized()
            }
            Msg::Moved(at) => {
                // A minimised window reports (-32000, -32000): that is not where it lives.
                if at.x > -30000.0 && at.y > -30000.0 {
                    self.position = Some(at);
                }
                self.ask_maximized()
            }
            Msg::Maximized(maximized) => {
                self.remember_geometry(maximized);
                Task::none()
            }
            Msg::BarTick => {
                let read = |cell: &usage::Shared| cell.lock().unwrap_or_else(|e| e.into_inner()).clone();
                if let Some(cell) = &self.updates {
                    let ready = cell.lock().unwrap_or_else(|e| e.into_inner()).clone();
                    if ready != self.update {
                        self.update = ready;
                    }
                }
                self.bar = status_bar::Readings { claude: read(&self.pollers[0]), codex: read(&self.pollers[1]), load: Some(self.sampler.sample()), now: usage::now_ms() };
                Task::none()
            }
            Msg::InstallUpdate => {
                let others = instances::global().map_or(0, |r| r.other_count());
                if others > 0 && !self.update_confirm {
                    self.update_confirm = true;
                    return Task::none();
                }
                self.install_update()
            }
            Msg::ConfirmUpdate => self.install_update(),
            Msg::CancelUpdate => {
                self.update_confirm = false;
                Task::none()
            }
            Msg::UpdateLater => {
                self.update_later = self.update.as_ref().map(|u| u.version.clone());
                self.update_confirm = false;
                Task::none()
            }
            Msg::Heartbeat => {
                if let Some(registry) = instances::global() {
                    registry.heartbeat();
                }
                Task::none()
            }
            Msg::CloseRequested(id) => {
                // `exit_on_close_request` is off so the last preferences reach the disk first.
                if let Err(e) = self.prefs.persist() {
                    eprintln!("[myterm] écriture des préférences échouée : {e}");
                }
                if let Some(registry) = instances::global() {
                    registry.unregister();
                }
                window::close(id)
            }
            Msg::StatusTick => {
                let now = Instant::now();
                if let Some(w) = self.workspace_mut() {
                    for p in &mut w.panes {
                        p.status = status::reduce(p.status, PaneEvent::Tick { at: now }, IDLE_AFTER);
                    }
                }
                Task::none()
            }
            Msg::RepaintTick => {
                if let Some(w) = self.workspace_mut() {
                    w.panes.iter_mut().for_each(|p| p.term.tick());
                }
                Task::none()
            }
            Msg::Blink => {
                if let Some(w) = self.workspace_mut() {
                    let focused = w.view.focused.clone();
                    if let Some(p) = w.panes.iter_mut().find(|p| Some(&p.id) == focused.as_ref()) {
                        p.term.blink_tick();
                    }
                }
                Task::none()
            }
            Msg::PersistTick => {
                if let Err(e) = self.prefs.persist() {
                    eprintln!("[myterm] écriture des préférences échouée : {e}");
                }
                Task::none()
            }
            Msg::SaveTick => {
                if self.workspace_mut().is_some_and(|w| w.dirty && w.edited_at.elapsed() >= AUTOSAVE_AFTER) {
                    self.save_now();
                }
                Task::none()
            }
            Msg::DiskTick => {
                if let Some(w) = self.workspace_mut() {
                    if !w.changed_on_disk && layout_fingerprint(Path::new(&w.opened.project_path)) != w.disk {
                        w.changed_on_disk = true;
                    }
                }
                Task::none()
            }
            Msg::ThemeTick => {
                let dark = resolve_mode(self.mode);
                if dark != self.dark {
                    self.dark = dark;
                    self.apply_theme();
                }
                Task::none()
            }
            Msg::Trust(choice) => {
                let decision = match choice {
                    TrustChoice::Approve => TrustDecision::Approve,
                    TrustChoice::OpenWithoutExecuting => TrustDecision::OpenWithoutExecuting,
                    TrustChoice::Cancel => TrustDecision::Cancel,
                };
                // A reload asked: the workspace stays under the dialog, and Cancel leaves it as it is.
                if let Some(pending) = self.workspace_mut().and_then(|w| w.pending_trust.take()) {
                    let task = match decide_trust(*pending, decision, &mut self.prefs) {
                        Some(opened) => self.apply_reloaded(opened),
                        None => Task::none(),
                    };
                    let _ = self.prefs.persist();
                    return task;
                }
                let Screen::Trust(_) = &self.screen else { return Task::none() };
                let Screen::Trust(pending) = std::mem::replace(&mut self.screen, Screen::Home(Home::default())) else { unreachable!() };
                let task = match decide_trust(*pending, decision, &mut self.prefs) {
                    Some(opened) => self.start(opened),
                    None => {
                        self.go_home(None);
                        Task::none()
                    }
                };
                let _ = self.prefs.persist();
                task
            }
            Msg::Collapse(id) => {
                if let Some(w) = self.workspace_mut() {
                    w.view.set_collapsed(&id, true);
                }
                self.relayout();
                let focus = self.workspace_mut().and_then(|w| w.view.focused.clone());
                focus.map(|f| self.focus_task(&f)).unwrap_or_else(Task::none)
            }
            Msg::Zoom(id) => {
                if let Some(w) = self.workspace_mut() {
                    w.view.toggle_zoom(Some(&id));
                }
                self.relayout();
                self.focus_task(&id)
            }
            Msg::FocusPane(id) => {
                if let Some(w) = self.workspace_mut() {
                    w.view.select_pane(&id);
                    w.ed.sync_command(&w.view, false);
                }
                self.relayout();
                Task::none()
            }
            Msg::Restore(id) => {
                if let Some(w) = self.workspace_mut() {
                    w.view.focus_pane(&id);
                    w.ed.sync_command(&w.view, false);
                }
                self.relayout();
                self.focus_task(&id)
            }
            // ponytail: the dialogs have no parent window, so they are not modal to MyTerm. Pass the
            // window handle to rfd (`set_parent`) if that ever confuses someone.
            Msg::PickFolder => Task::perform(async { rfd::AsyncFileDialog::new().pick_folder().await.map(|h| h.path().to_path_buf()) }, Msg::Picked),
            Msg::Picked(picked) => match picked {
                Some(path) => self.open(&path.to_string_lossy()),
                None => Task::none(),
            },
            Msg::OpenRecent(path) => self.open(&path),
            Msg::Forget(path) => {
                self.prefs.forget_project(&path);
                self.go_home(None);
                Task::none()
            }
            Msg::SetTheme(mode) => {
                self.mode = mode;
                self.prefs.set_theme(mode);
                self.dark = resolve_mode(mode);
                self.apply_theme();
                Task::none()
            }
            Msg::CloseProject => {
                self.save_now();
                self.go_home(None);
                Task::none()
            }
            Msg::ToggleEditor => {
                if let Some(w) = self.workspace_mut() {
                    w.ed.open = !w.ed.open;
                    w.ed.sync_command(&w.view, true);
                }
                self.relayout();
                Task::none()
            }
            Msg::OpenEditor(id) => {
                if let Some(w) = self.workspace_mut() {
                    w.editor_failure = external_editor::open_in_editor(id, Path::new(&w.opened.project_path), &external_editor::Env::from_process())
                        .err()
                        .map(|f| format!("{} : {}", id.label(), f.hint()));
                }
                Task::none()
            }
            Msg::TaskbarId(raw, id) => {
                if let Err(e) = platform::set_window_app_id(raw as isize, &id) {
                    eprintln!("[myterm] identité de fenêtre non appliquée : {e}");
                }
                Task::none()
            }
            Msg::Edit(op) => self.edit(op),
            Msg::EditorSelect(id) => {
                if let Some(w) = self.workspace_mut() {
                    w.view.select_pane(&id);
                    w.ed.confirm_remove = None;
                    w.ed.sync_command(&w.view, false);
                }
                self.relayout();
                Task::none()
            }
            Msg::CancelRemove => {
                if let Some(w) = self.workspace_mut() {
                    w.ed.confirm_remove = None;
                }
                Task::none()
            }
            Msg::Restart(id) => {
                // Flush the pending save first: restarting before the new cwd/shell/command has been
                // written would relaunch the pane with its old spec, which looks like the button not working.
                self.save_now();
                self.respawn(&id);
                self.focus_task(&id)
            }
            Msg::PickPaneCwd => {
                let Some(root) = self.workspace_mut().map(|w| w.opened.project_path.clone()) else { return Task::none() };
                Task::perform(
                    async move { rfd::AsyncFileDialog::new().set_directory(&root).pick_folder().await.map(|h| h.path().to_path_buf()) },
                    Msg::PanePicked,
                )
            }
            Msg::PanePicked(picked) => {
                let relative = self.workspace_mut().zip(picked).and_then(|(w, p)| relative_to_project(&w.opened.project_path, &p.to_string_lossy()));
                match relative {
                    Some(cwd) => self.edit(EditOp::Cwd(cwd)),
                    None => Task::none(),
                }
            }
            Msg::Reload => self.reload(),
            Msg::DismissReload => {
                if let Some(w) = self.workspace_mut() {
                    // Only a *further* change raises the banner again.
                    w.disk = layout_fingerprint(Path::new(&w.opened.project_path));
                    w.changed_on_disk = false;
                    w.reload_error = None;
                }
                Task::none()
            }
        }
    }

    fn apply_chord(&mut self, chord: AppChord) -> Task<Msg> {
        if chord == AppChord::Save {
            self.save_now();
            return Task::none();
        }
        let Some(w) = self.workspace_mut() else { return Task::none() };
        let focus = match chord {
            AppChord::Move(arrow) => w.view.move_focus(arrow),
            AppChord::Nth(n) => w.view.focus_nth(n),
            AppChord::Zoom => {
                w.view.toggle_zoom(None);
                w.view.focused.clone()
            }
            AppChord::Collapse => {
                w.view.toggle_collapse(None);
                w.view.focused.clone()
            }
            AppChord::Unzoom => {
                if let Some(z) = w.view.zoomed.clone() {
                    w.view.toggle_zoom(Some(&z));
                }
                w.view.focused.clone()
            }
            AppChord::Save => None,
        };
        w.ed.sync_command(&w.view, false);
        self.relayout();
        focus.map(|f| self.focus_task(&f)).unwrap_or_else(Task::none)
    }

    // -----------------------------------------------------------------------------------------
    // subscriptions
    // -----------------------------------------------------------------------------------------

    /// Hands over to the installer, which closes every window and relaunches MyTerm. Preferences are
    /// written and the instance unregistered first, as on a normal close.
    fn install_update(&mut self) -> Task<Msg> {
        let Some(update) = self.update.clone() else { return Task::none() };
        if let Err(e) = self.prefs.persist() {
            eprintln!("[myterm] écriture des préférences échouée : {e}");
        }
        match updater::run_installer(&update.installer) {
            Ok(()) => {
                if let Some(registry) = instances::global() {
                    registry.unregister();
                }
                iced::exit()
            }
            Err(e) => {
                // The installer did not start: the app stays as it was, and says so.
                self.update_error = Some(format!("Impossible de lancer l'installation ({})", e.kind()));
                self.update_confirm = false;
                Task::none()
            }
        }
    }

    fn update_banner<'a>(&'a self, chrome: Ch) -> Option<Element<'a, Msg>> {
        let update = self.update.as_ref().filter(|u| self.update_later.as_deref() != Some(u.version.as_str()))?;
        let live = matches!(&self.screen, Screen::Workspace(w) if w.panes.iter().any(|p| p.status.status != PaneStatus::Exited));
        let others = instances::global().map_or(0, |r| r.other_count());
        let mut line = row![text(format!("Version {} disponible.", update.version)).size(12).color(hex(chrome.text))].spacing(12).align_y(Alignment::Center);
        if self.update_confirm {
            let which = if others == 1 { "Une autre fenêtre MyTerm est ouverte.".to_string() } else { format!("{others} autres fenêtres MyTerm sont ouvertes.") };
            line = line.push(text(format!("{which} L'installation ferme toutes les fenêtres MyTerm, et les shells qui y tournent, pas seulement celle-ci.")).size(12).color(hex(chrome.status_attention)));
        } else if live {
            line = line.push(text("Redémarrer fermera les panes en cours d'exécution.").size(12).color(hex(chrome.status_attention)));
        }
        if let Some(error) = &self.update_error {
            line = line.push(text(error.as_str()).size(12).color(hex(chrome.status_exited)));
        }
        line = line.push(Space::new().width(Length::Fill));
        if self.update_confirm {
            line = line.push(button(text("Installer et tout fermer").size(12)).padding([4, 8]).on_press(Msg::ConfirmUpdate).style(button_style(chrome, Look::Primary)));
            line = line.push(button(text("Annuler").size(12)).padding([4, 8]).on_press(Msg::CancelUpdate).style(button_style(chrome, Look::Ghost)));
        } else {
            line = line.push(button(text("Redémarrer maintenant").size(12)).padding([4, 8]).on_press(Msg::InstallUpdate).style(button_style(chrome, Look::Primary)));
            line = line.push(button(text("Plus tard").size(12)).padding([4, 8]).on_press(Msg::UpdateLater).style(button_style(chrome, Look::Ghost)));
        }
        Some(
            container(line)
                .padding([6, 12])
                .width(Length::Fill)
                .style(move |_| container::Style {
                    background: Some(Background::Color(hex(chrome.surface_raised))),
                    border: Border { color: hex(chrome.border), width: 1.0, radius: 0.0.into() },
                    ..Default::default()
                })
                .into(),
        )
    }

    /// Maximised or not is only known by asking; the answer decides what a resize or move means.
    fn ask_maximized(&self) -> Task<Msg> {
        window::oldest().and_then(window::is_maximized).map(Msg::Maximized)
    }

    /// While maximised the restored size and position are kept, so un-maximising returns where the
    /// user was (what 0.5.0 did). Persisted by the usual PersistTick.
    fn remember_geometry(&mut self, maximized: bool) {
        let before = self.prefs.get().window.clone();
        let next = if maximized {
            WindowState { maximized: true, ..before.clone() }
        } else {
            // The schema floor: a smaller value would make the saved file fail its own validation.
            WindowState {
                width: (self.window.width.round() as i64).max(480),
                height: (self.window.height.round() as i64).max(320),
                x: self.position.map(|p| p.x.round() as i64).or(before.x),
                y: self.position.map(|p| p.y.round() as i64).or(before.y),
                maximized: false,
            }
        };
        if next != before {
            self.prefs.set_window(next);
        }
    }

    pub fn subscription(&self) -> Subscription<Msg> {
        let mut subs = vec![
            event::listen_with(|e, status, id| match e {
                iced::Event::Keyboard(k) => Some(Msg::Key(k, status == event::Status::Captured)),
                iced::Event::Window(window::Event::Moved(at)) => Some(Msg::Moved(at)),
                iced::Event::Window(window::Event::CloseRequested) => Some(Msg::CloseRequested(id)),
                _ => None,
            }),
            window::resize_events().map(|(_, size)| Msg::Resized(size)),
            time::every(Duration::from_millis(crate::instances::HEARTBEAT_MS as u64)).map(|_| Msg::Heartbeat),
            time::every(BAR_TICK).map(|_| Msg::BarTick),
        ];
        if self.prefs.has_pending() {
            subs.push(time::every(PERSIST_TICK).map(|_| Msg::PersistTick));
        }
        if self.mode == ThemeMode::System {
            subs.push(time::every(THEME_TICK).map(|_| Msg::ThemeTick));
        }
        if let Screen::Workspace(w) = &self.screen {
            subs.extend(w.panes.iter().map(|p| p.term.subscription().map(Msg::Term)));
            subs.push(time::every(STATUS_TICK).map(|_| Msg::StatusTick));
            subs.push(time::every(DISK_TICK).map(|_| Msg::DiskTick));
            if w.dirty {
                subs.push(time::every(SAVE_TICK).map(|_| Msg::SaveTick));
            }
            if w.panes.iter().any(|p| p.term.is_dirty()) {
                subs.push(time::every(Duration::from_millis(33)).map(|_| Msg::RepaintTick));
            }
            subs.push(time::every(CURSOR_BLINK_INTERVAL).map(|_| Msg::Blink));
        }
        Subscription::batch(subs)
    }

    pub fn theme(&self) -> Theme {
        if self.dark {
            Theme::Dark
        } else {
            Theme::Light
        }
    }

    pub fn title(&self) -> String {
        match &self.screen {
            Screen::Workspace(w) => format!("{} — MyTerm", w.opened.project_name),
            _ => "MyTerm".into(),
        }
    }

    // -----------------------------------------------------------------------------------------
    // view
    // -----------------------------------------------------------------------------------------

    pub fn view(&self) -> Element<'_, Msg> {
        let chrome = chrome_for(self.dark);
        let root: Element<'_, Msg> = match &self.screen {
            Screen::Home(h) => home::view(h, chrome, self.theme_toggle(chrome)),
            Screen::Trust(pending) => trust_dialog(pending, chrome),
            Screen::Workspace(w) => self.workspace_view(w, chrome),
        };
        // The footer is present in every view, the home screen included: a quota you only see once a
        // project is open is a quota you discover too late.
        let mut page = column![];
        if let Some(banner) = self.update_banner(chrome) {
            page = page.push(banner);
        }
        container(page.push(container(root).height(Length::Fill)).push(status_bar::view(&self.bar, chrome)))
            .width(Length::Fill)
            .height(Length::Fill)
            .style(move |_| container::Style { background: Some(Background::Color(hex(chrome.surface_sunken))), ..Default::default() })
            .into()
    }

    fn theme_toggle(&self, chrome: Ch) -> Element<'_, Msg> {
        let modes = [(ThemeMode::Light, "☀", "Thème clair"), (ThemeMode::Dark, "☾", "Thème sombre"), (ThemeMode::System, "⌂", "Suivre Windows")];
        let buttons = modes.into_iter().map(|(mode, glyph, tip)| {
            let look = if self.mode == mode { Look::Primary } else { Look::Ghost };
            tooltip(
                button(text(glyph).size(12)).padding([2, 6]).on_press(Msg::SetTheme(mode)).style(button_style(chrome, look)),
                text(tip).size(11),
                tooltip::Position::Bottom,
            )
            .into()
        });
        container(row(buttons).spacing(2)).padding(2).style(card(chrome, 6.0)).into()
    }

    /// The bar tells one MyTerm window from another: the instance colour tints it and fills the
    /// project name; without a colour, the plain bar.
    fn header<'a>(&'a self, w: &'a Workspace, chrome: Ch) -> Element<'a, Msg> {
        let tint = project_chrome(self.resolved(), w.view.layout.color);
        let name_text = text(w.opened.project_name.as_str()).size(12);
        let name: Element<'a, Msg> = match &tint {
            Some(t) => {
                let (accent, on) = (hex(t.accent), hex(t.on_accent));
                container(name_text.color(on)).padding([0, 6]).style(move |_| container::Style { background: Some(Background::Color(accent)), border: border::rounded(4), ..Default::default() }).into()
            }
            None => name_text.color(hex(chrome.text_muted)).into(),
        };
        let editors = w.editors.iter().map(|e| {
            let id = e.id;
            let available = e.available;
            tooltip(
                button(text(e.label).size(11))
                    .padding([2, 6])
                    .on_press(Msg::OpenEditor(id))
                    .style(move |t, s| {
                        let base = button_style(chrome, Look::Outline)(t, s);
                        if available {
                            base
                        } else {
                            button::Style { text_color: with_alpha(hex(chrome.text_muted), 0.4), ..base }
                        }
                    }),
                text(if available { format!("Ouvrir le projet dans {}", e.label) } else { format!("{} introuvable sur cette machine", e.label) }).size(11),
                tooltip::Position::Bottom,
            )
            .into()
        });
        let mut bar = row![text("MyTerm").size(12).color(hex(chrome.text)), text("·").size(12).color(hex(chrome.text_muted)), name].spacing(8).align_y(Alignment::Center);
        bar = bar.push(row(editors).spacing(4));
        if let Some(failure) = &w.editor_failure {
            bar = bar.push(text(failure.as_str()).size(11).color(hex(chrome.status_exited)));
        }
        if w.dirty {
            bar = bar.push(
                container(text("• non enregistré").size(11).color(hex(chrome.status_attention)))
                    .padding([0, 4])
                    .style(move |_| container::Style { background: Some(Background::Color(hex(chrome.surface))), border: border::rounded(4), ..Default::default() }),
            );
        }
        bar = bar
            .push(Space::new().width(Length::Fill))
            .push(button(text("Layout").size(12)).padding([4, 8]).on_press(Msg::ToggleEditor).style(button_style(chrome, if w.ed.open { Look::Selected } else { Look::Ghost })))
            .push(button(text("Fermer le projet").size(12)).padding([4, 8]).on_press(Msg::CloseProject).style(button_style(chrome, Look::Ghost)))
            .push(self.theme_toggle(chrome));
        container(bar)
            .padding([6, 12])
            .width(Length::Fill)
            .style(move |_| {
                let (background, edge, width) = match &tint {
                    Some(t) => (hex(&t.tint), hex(t.accent), 2.0),
                    None => (hex(chrome.surface), hex(chrome.border), 1.0),
                };
                container::Style { background: Some(Background::Color(background)), border: Border { color: edge, width, radius: 0.0.into() }, ..Default::default() }
            })
            .into()
    }

    fn reload_banner<'a>(&self, w: &'a Workspace, chrome: Ch) -> Option<Element<'a, Msg>> {
        if !w.changed_on_disk && w.reload_error.is_none() {
            return None;
        }
        let mut line = row![].spacing(12).align_y(Alignment::Center);
        if let Some(error) = &w.reload_error {
            line = line.push(text(format!("Rechargement impossible : {error}")).size(12).color(hex(chrome.status_exited)));
        } else {
            line = line.push(text("Le fichier .myterm.json a changé sur le disque.").size(12).color(hex(chrome.text)));
            if w.dirty {
                line = line.push(text("Vous avez des modifications non enregistrées : recharger les écrasera.").size(12).color(hex(chrome.status_attention)));
            }
        }
        line = line.push(Space::new().width(Length::Fill));
        if w.reload_error.is_none() {
            line = line.push(button(text("Recharger").size(12)).padding([4, 8]).on_press(Msg::Reload).style(button_style(chrome, Look::Primary)));
        }
        line = line.push(button(text("Ignorer").size(12)).padding([4, 8]).on_press(Msg::DismissReload).style(button_style(chrome, Look::Ghost)));
        Some(
            container(line)
                .padding([6, 12])
                .width(Length::Fill)
                .style(move |_| container::Style {
                    background: Some(Background::Color(hex(chrome.surface_raised))),
                    border: Border { color: hex(chrome.border), width: 1.0, radius: 0.0.into() },
                    ..Default::default()
                })
                .into(),
        )
    }

    fn workspace_view<'a>(&'a self, w: &'a Workspace, chrome: Ch) -> Element<'a, Msg> {
        let bar = collapsed_bar(w, chrome, self.resolved());

        let grid: Element<'a, Msg> = if let Some(zoomed) = &w.view.zoomed {
            let pane = w.view.layout.panes.iter().find(|p| &p.id == zoomed);
            match (pane, w.panes.iter().find(|p| &p.id == zoomed)) {
                (Some(pane), Some(rt)) => container(self.pane_view(w, rt, pane, chrome, Length::Fill)).padding(GAP).height(Length::Fill).into(),
                _ => Space::new().into(),
            }
        } else if w.view.visible_panes().is_empty() {
            centered(
                text("Tous les panes sont réduits et continuent de tourner. Cliquez un onglet de la barre du bas pour en ramener un.")
                    .size(12)
                    .color(hex(chrome.text_muted))
                    .into(),
            )
        } else {
            // The area is measured, not guessed: the header, the banners and the folded bar all take their share.
            responsive(move |size| {
                let visible = w.view.visible_panes();
                let columns = w.view.columns.max(1);
                let rows = visible.len().div_ceil(columns);
                // CSS `minmax(200px, 1fr)`: rows share the height while they fit; past that they keep a
                // usable height and the area scrolls instead of crushing every terminal.
                let available = (size.height - GAP * (rows as f32 + 1.0)).max(1.0);
                let row_height = (available / rows as f32).max(MIN_PANE_HEIGHT);
                let lines = visible.chunks(columns).map(|chunk| {
                    let cells = chunk.iter().map(|pane| {
                        let rt = w.panes.iter().find(|p| p.id == pane.id).expect("a runtime per pane");
                        self.pane_view(w, rt, pane, chrome, Length::Fixed(row_height))
                    });
                    // A short last line keeps its cells the width of the others (a grid track), not stretched.
                    let missing = columns - chunk.len();
                    row(cells.chain((0..missing).map(|_| Space::new().width(Length::FillPortion(1)).into()))).spacing(GAP).into()
                });
                scrollable(column(lines).spacing(GAP).padding(GAP)).height(Length::Fill).into()
            })
            .into()
        };

        let main: Element<'a, Msg> = match bar {
            Some(bar) => column![container(grid).height(Length::Fill), bar].into(),
            None => grid,
        };
        let mut body = row![container(main).width(Length::Fill).height(Length::Fill)];
        if w.ed.open {
            body = body.push(editor::view(&w.ed, &w.view, self.resolved(), chrome));
        }

        let mut page = column![self.header(w, chrome)];
        if let Some(banner) = self.reload_banner(w, chrome) {
            page = page.push(banner);
        }
        if let Some(error) = &w.save_error {
            page = page.push(
                container(text(format!("échec de la sauvegarde : {error}")).size(11).color(hex(chrome.status_exited)))
                    .padding([4, 12])
                    .width(Length::Fill)
                    .style(move |_| container::Style { background: Some(Background::Color(with_alpha(hex(chrome.status_exited), 0.10))), ..Default::default() }),
            );
        }
        if !w.opened.warnings.is_empty() {
            let lines = w.opened.warnings.iter().map(|x| text(format!("{} : {}", x.pane_id, x.message)).size(11).color(hex(chrome.status_attention)).into());
            page = page.push(
                container(column(lines))
                    .padding([4, 12])
                    .width(Length::Fill)
                    .style(move |_| container::Style { background: Some(Background::Color(with_alpha(hex(chrome.status_attention), 0.10))), ..Default::default() }),
            );
        }
        let page = page.push(body.height(Length::Fill));

        match &w.pending_trust {
            Some(pending) => stack![
                page,
                opaque(
                    container(trust_dialog(pending, chrome))
                        .width(Length::Fill)
                        .height(Length::Fill)
                        .style(move |_| container::Style { background: Some(Background::Color(with_alpha(Color::BLACK, 0.45))), ..Default::default() })
                )
            ]
            .into(),
            None => page.into(),
        }
    }

    fn pane_view<'a>(&'a self, w: &'a Workspace, rt: &'a PaneRt, pane: &'a Pane, chrome: Ch, height: Length) -> Element<'a, Msg> {
        let theme = self.resolved();
        let focused = w.view.focused.as_deref() == Some(pane.id.as_str());
        let zoomed = w.view.zoomed.as_deref() == Some(pane.id.as_str());
        let title = title_of(pane);
        let status = rt.status.status;
        let attention = status == PaneStatus::Attention;

        // The badge: a dot, and the words only when the pane asks for you.
        let dot = container(Space::new()).width(6).height(6).style({
            let color = status_dot(chrome, status);
            move |_| container::Style { background: Some(Background::Color(color)), border: border::rounded(3), ..Default::default() }
        });
        let badge: Element<'a, Msg> = if attention {
            container(row![dot, text(status.label()).size(10).color(hex(chrome.status_attention))].spacing(6).align_y(Alignment::Center))
                .padding([2, 6])
                .style(move |_| container::Style {
                    background: Some(Background::Color(with_alpha(hex(chrome.status_attention), 0.12))),
                    border: border::rounded(10),
                    ..Default::default()
                })
                .into()
        } else {
            tooltip(container(dot).padding([2, 4]), text(status.label()).size(11), tooltip::Position::Bottom).into()
        };

        let icon_button = |glyph: &'static str, tip: &'static str, msg: Msg| {
            tooltip(
                button(text(glyph).size(12).color(hex(chrome.text_muted)))
                    .padding([0, 4])
                    .on_press(msg)
                    .style(move |_, st| button::Style {
                        background: matches!(st, button::Status::Hovered).then(|| Background::Color(hex(chrome.surface_sunken))),
                        text_color: hex(chrome.text_muted),
                        border: border::rounded(3),
                        ..Default::default()
                    }),
                text(tip).size(11),
                tooltip::Position::Bottom,
            )
        };

        let header = container(
            row![
                badge,
                text(title).size(12).color(hex(chrome.text)),
                Space::new().width(Length::Fill),
                icon_button("⤓", "Réduire dans la barre (Ctrl+Shift+M) — le terminal continue de tourner", Msg::Collapse(pane.id.clone())),
                icon_button(if zoomed { "⤡" } else { "⤢" }, if zoomed { "Réduire (Ctrl+Shift+Z)" } else { "Agrandir (Ctrl+Shift+Z)" }, Msg::Zoom(pane.id.clone())),
            ]
            .spacing(8)
            .align_y(Alignment::Center),
        )
        .height(28)
        .padding([0, 8])
        .width(Length::Fill)
        .style(move |_| container::Style { background: Some(Background::Color(hex(chrome.surface_raised))), ..Default::default() });

        let rule = container(Space::new()).height(1).width(Length::Fill).style(move |_| container::Style {
            background: Some(Background::Color(hex(chrome.border))),
            ..Default::default()
        });

        // A coloured pane keeps its colour even while focused (2 px, so the hue is not a hairline);
        // focus then moves to the ring. Uncoloured: 1 px, accent while focused.
        let (edge, width) = match pane.color {
            Some(c) => (hex(pane_border(theme, c)), 2.0),
            None => (hex(if focused { chrome.accent } else { chrome.border }), 1.0),
        };
        let ring = focused && pane.color.is_some();

        let body = column![header, rule, TerminalView::show(&rt.term).map(Msg::Term)].height(Length::Fill);
        let framed_card = container(body).width(Length::Fill).height(height).clip(true).style(move |_| container::Style {
            background: Some(Background::Color(hex(chrome.surface))),
            border: Border { color: edge, width, radius: 6.0.into() },
            ..Default::default()
        });
        // Wrapped again so the focus ring sits two pixels *outside* the colour, never flush against it.
        let framed = container(framed_card).padding(if ring { 2 } else { 0 }).width(Length::FillPortion(1)).style(move |_| container::Style {
            border: if ring { Border { color: hex(chrome.accent), width: 2.0, radius: 8.0.into() } } else { Default::default() },
            ..Default::default()
        });
        mouse_area(framed).on_press(Msg::FocusPane(pane.id.clone())).into()
    }
}

fn centered<'a>(content: Element<'a, Msg>) -> Element<'a, Msg> {
    container(content).center_x(Length::Fill).center_y(Length::Fill).padding(24).into()
}

fn collapsed_bar<'a>(w: &'a Workspace, chrome: Ch, theme: ResolvedTheme) -> Option<Element<'a, Msg>> {
    let folded: Vec<&Pane> = w.view.layout.panes.iter().filter(|p| w.view.is_collapsed(&p.id)).collect();
    if folded.is_empty() {
        return None;
    }
    let chips = folded.into_iter().map(|pane| {
        let rt = w.panes.iter().find(|p| p.id == pane.id);
        let status = rt.map_or(PaneStatus::Idle, |p| p.status.status);
        let last = rt.and_then(|p| p.term.last_command()).map(str::to_string);
        let title = title_of(pane).to_string();
        let accent = pane.color.map_or(hex(chrome.border_strong), |c| hex(pane_border(theme, c)));
        let (text_color, edge, fill) = match status {
            // Emphasised here and only here: a folded pane is the one whose death nobody can see.
            PaneStatus::Exited => (hex(chrome.status_exited), with_alpha(hex(chrome.status_exited), 0.4), Some(with_alpha(hex(chrome.status_exited), 0.08))),
            PaneStatus::Attention => (hex(chrome.status_attention), with_alpha(hex(chrome.status_attention), 0.4), Some(with_alpha(hex(chrome.status_attention), 0.10))),
            _ => (hex(chrome.text_muted), hex(chrome.border), None),
        };
        let dot = container(Space::new()).width(6).height(6).style({
            let c = status_dot(chrome, status);
            move |_| container::Style { background: Some(Background::Color(c)), border: border::rounded(3), ..Default::default() }
        });
        let bar = container(Space::new()).width(2).height(12).style(move |_| container::Style { background: Some(Background::Color(accent)), border: border::rounded(1), ..Default::default() });
        let chip = button(row![bar, dot, text(title.clone()).size(12).color(text_color)].spacing(6).align_y(Alignment::Center))
            .padding([2, 8])
            .on_press(Msg::Restore(pane.id.clone()))
            .style(move |_, st| button::Style {
                background: fill.map(Background::Color).or_else(|| matches!(st, button::Status::Hovered).then(|| Background::Color(hex(chrome.surface_sunken)))),
                text_color,
                border: Border { color: edge, width: 1.0, radius: 4.0.into() },
                ..Default::default()
            });
        let hover_card = container(
            column![
                text(title).size(12).color(hex(chrome.text)),
                match last {
                    Some(c) => text(c).size(11).font(Font::MONOSPACE).color(hex(chrome.text_muted)),
                    None => text("shell en attente").size(11).color(hex(chrome.text_muted)),
                }
            ]
            .spacing(2)
            .max_width(320),
        )
        .padding(8)
        .style(card(chrome, 6.0));
        let element: Element<'a, Msg> = tooltip(chip, hover_card, tooltip::Position::Top).into();
        element
    });
    let strip = row![text("réduits").size(10).color(hex(chrome.text_muted))].push(row(chips).spacing(4).wrap()).spacing(6).align_y(Alignment::Center);
    Some(
        container(strip)
            .padding([4, 6])
            .width(Length::Fill)
            .style(move |_| container::Style {
                background: Some(Background::Color(hex(chrome.surface_raised))),
                border: Border { color: hex(chrome.border), width: 1.0, radius: 0.0.into() },
                ..Default::default()
            })
            .into(),
    )
}

fn trust_dialog<'a>(pending: &'a PendingTrust, chrome: Ch) -> Element<'a, Msg> {
    let n = pending.commands.len();
    let items = pending.commands.iter().map(|c| {
        container(
            column![
                row![text(c.title.as_str()).size(12).color(hex(chrome.text)), text(c.cwd.as_str()).size(11).font(Font::with_name("Cascadia Mono")).shaping(text::Shaping::Basic).color(hex(chrome.text_muted))].spacing(8),
                // Shown raw, with no variable expansion: a rewritten command would mislead more than the original.
                text(format!("{} → {}", c.shell, c.command)).size(12).font(Font::with_name("Cascadia Mono")).shaping(text::Shaping::Basic).color(hex(chrome.text)),
            ]
            .spacing(4),
        )
        .padding([8, 10])
        .width(Length::Fill)
        .style(move |_| container::Style {
            background: Some(Background::Color(hex(chrome.surface_raised))),
            border: Border { color: hex(chrome.border), width: 1.0, radius: 4.0.into() },
            ..Default::default()
        })
        .into()
    });
    let action = |label: &'static str, msg: Msg, primary: bool| {
        button(text(label).size(12)).padding([6, 12]).on_press(msg).style(button_style(chrome, if primary { Look::Primary } else { Look::Outline }))
    };
    let dialog = container(
        column![
            text("Exécuter les commandes de ce projet ?").size(16).color(hex(chrome.text)),
            text(format!(
                "{} est ouvert pour la première fois. Son fichier .myterm.json demande à lancer {} commande{} automatiquement.",
                pending.project_name,
                n,
                if n > 1 { "s" } else { "" }
            ))
            .size(12)
            .color(hex(chrome.text_muted)),
            text(pending.project_path.as_str()).size(11).font(Font::MONOSPACE).color(hex(chrome.text_muted)),
            scrollable(column(items).spacing(6)).height(Length::Shrink),
            text("N'approuvez que si vous faites confiance à la source de ce dépôt. Un .myterm.json est un fichier versionné : il peut venir de n'importe qui.")
                .size(11)
                .color(hex(chrome.text_muted)),
            row![
                Space::new().width(Length::Fill),
                action("Annuler", Msg::Trust(TrustChoice::Cancel), false),
                action("Ouvrir sans exécuter", Msg::Trust(TrustChoice::OpenWithoutExecuting), false),
                action("Approuver et ouvrir", Msg::Trust(TrustChoice::Approve), true),
            ]
            .spacing(8),
        ]
        .spacing(10)
        .width(Length::Fill),
    )
    .padding(20)
    .max_width(680)
    .style(card(chrome, 8.0));
    centered(dialog.into())
}
