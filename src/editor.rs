//! The layout editor: the side panel that edits `.myterm.json`. Port of `LayoutEditor` and
//! `ColorSwatches`. The editing rules themselves are `schema::edit`, shared with the reload diff.

use crate::app::Msg;
use crate::palette::{pane_border, ResolvedTheme};
use crate::schema::layout::{Layout, Pane, PaneColor, Shell, MAX_PANES};
use crate::ui::{button_style, hex, input_style, with_alpha, Ch, Look};
use crate::view_state::ViewState;
use iced::widget::{button, checkbox, column, container, pick_list, row, scrollable, text, text_editor, text_input, Space};
use iced::{Background, Border, Element, Font, Length};
use std::collections::BTreeSet;

#[derive(Clone, Debug)]
pub enum EditOp {
    Title(String),
    Cwd(String),
    Color(Option<PaneColor>),
    Shell(Option<Shell>),
    Command(text_editor::Action),
    Collapsed(bool),
    Add,
    Move(String, bool),
    Remove(String),
    ProjectColor(Option<PaneColor>),
}

/// What the panel remembers besides the layout itself.
pub struct EditorState {
    pub open: bool,
    pub error: Option<String>,
    /// Panes whose cwd, shell or command changed: the running process still has the old spec.
    pub pending_restart: BTreeSet<String>,
    /// The command box keeps its own cursor and undo state, so it is rebuilt when the selection
    /// changes, never while the user types in it.
    pub command: text_editor::Content,
    pub command_for: Option<String>,
    /// A running pane asks before it is deleted (0.5.0 used `window.confirm`).
    pub confirm_remove: Option<String>,
}

impl Default for EditorState {
    fn default() -> Self {
        EditorState { open: false, error: None, pending_restart: BTreeSet::new(), command: text_editor::Content::new(), command_for: None, confirm_remove: None }
    }
}

impl EditorState {
    /// The edited pane *is* the focused one, rather than a second selection the panel keeps to
    /// itself: clicking a terminal in the grid switches what the panel edits.
    pub fn selected<'a>(view: &'a ViewState) -> Option<&'a Pane> {
        view.layout.panes.iter().find(|p| view.focused.as_deref() == Some(p.id.as_str())).or(view.layout.panes.first())
    }

    /// Rebuilds the command box when the selected pane is not the one it shows.
    pub fn sync_command(&mut self, view: &ViewState, force: bool) {
        let selected = Self::selected(view);
        let id = selected.map(|p| p.id.clone());
        if force || self.command_for != id {
            self.command = text_editor::Content::with_text(selected.and_then(|p| p.command.as_deref()).unwrap_or(""));
            self.command_for = id;
        }
    }
}

pub const COLOR_LABELS: [(PaneColor, &str); 8] = [
    (PaneColor::Red, "rouge"),
    (PaneColor::Orange, "orange"),
    (PaneColor::Yellow, "jaune"),
    (PaneColor::Green, "vert"),
    (PaneColor::Cyan, "cyan"),
    (PaneColor::Blue, "bleu"),
    (PaneColor::Purple, "violet"),
    (PaneColor::Pink, "rose"),
];

/// The eight colours plus `∅`, as one exclusive choice. Selected means *filled*, never "has an
/// accent ring": the accent is a blue, and on the blue swatch a ring would be the same colour twice.
pub fn swatches<'a>(legend: &'static str, value: Option<PaneColor>, theme: ResolvedTheme, chrome: Ch, on_pick: impl Fn(Option<PaneColor>) -> Msg + 'a) -> Element<'a, Msg> {
    let swatch = |fill: Option<iced::Color>, edge: iced::Color, label: &'static str, msg: Msg, tip: String| {
        let content = text(label).size(10).color(hex(if fill.is_some() { chrome.accent_contrast } else { chrome.text_muted }));
        iced::widget::tooltip(
            button(container(content).center_x(Length::Fill).center_y(Length::Fill))
                .width(24)
                .height(24)
                .padding(0)
                .on_press(msg)
                .style(move |_, _| button::Style {
                    background: fill.map(Background::Color),
                    border: Border { color: edge, width: 2.0, radius: 4.0.into() },
                    ..Default::default()
                }),
            text(tip).size(11),
            iced::widget::tooltip::Position::Bottom,
        )
    };
    let none_selected = value.is_none();
    let none = swatch(
        none_selected.then(|| hex(chrome.accent)),
        if none_selected { hex(chrome.accent) } else { hex(chrome.border) },
        "∅",
        on_pick(None),
        "Aucune".into(),
    );
    let colors = COLOR_LABELS.iter().map(|&(color, label)| {
        let c = hex(pane_border(theme, color));
        let active = value == Some(color);
        // Clicking the active colour clears it: the ∅ button is the discoverable way out, this the fast one.
        swatch(active.then_some(c), c, "", on_pick(if active { None } else { Some(color) }), label.into()).into()
    });
    column![text(legend).size(11).color(hex(chrome.text_muted)), row(std::iter::once(none.into()).chain(colors)).spacing(4).wrap()].spacing(4).into()
}

#[derive(Clone, PartialEq, Eq)]
struct ShellChoice(Option<Shell>, String);

impl std::fmt::Display for ShellChoice {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.1)
    }
}

fn label<'a>(chrome: Ch, caption: &'static str, field: impl Into<Element<'a, Msg>>) -> Element<'a, Msg> {
    column![text(caption).size(11).color(hex(chrome.text_muted)), field.into()].spacing(4).into()
}

pub fn view<'a>(ed: &'a EditorState, view: &'a ViewState, theme: ResolvedTheme, chrome: Ch) -> Element<'a, Msg> {
    let layout: &Layout = &view.layout;
    let selected = EditorState::selected(view);
    let mono = Font::with_name("Cascadia Mono");

    let header = row![
        text("Layout").size(14).color(hex(chrome.text)),
        Space::new().width(Length::Fill),
        button(text("✕").size(12)).padding([0, 6]).on_press(Msg::ToggleEditor).style(button_style(chrome, Look::Ghost)),
    ]
    .align_y(iced::Alignment::Center);

    let error = ed.error.as_ref().map(|message| {
        container(text(message.as_str()).size(11).color(hex(chrome.status_exited)))
            .padding([4, 8])
            .width(Length::Fill)
            .style(move |_| container::Style {
                background: Some(Background::Color(with_alpha(hex(chrome.status_exited), 0.10))),
                border: Border { color: with_alpha(hex(chrome.status_exited), 0.4), width: 1.0, radius: 4.0.into() },
                ..Default::default()
            })
    });

    // The project's own setting, above the panes: it belongs to the whole file, not to the selected pane.
    let project = column![
        swatches("Couleur de l'instance", layout.color, theme, chrome, |c| Msg::Edit(EditOp::ProjectColor(c))),
        text("Teinte la barre du haut et l'icône de la barre des tâches, pour reconnaître cette fenêtre parmi plusieurs MyTerm.")
            .size(10)
            .color(hex(chrome.text_muted)),
    ]
    .spacing(4);

    let columns = view.columns.max(1);
    let hint = row![
        text(format!("Disposition automatique : {} pane{} par ligne à cette largeur. Les suivants passent à la ligne.", columns, if columns > 1 { "s" } else { "" }))
            .size(11)
            .color(hex(chrome.text_muted))
            .width(Length::Fill),
        button(text("+ Pane").size(12))
            .padding([4, 8])
            .on_press_maybe((layout.panes.len() < MAX_PANES).then_some(Msg::Edit(EditOp::Add)))
            .style(button_style(chrome, Look::Primary)),
    ]
    .spacing(8)
    .align_y(iced::Alignment::Center);

    let count = layout.panes.len();
    let rows = layout.panes.iter().enumerate().map(|(index, pane)| {
        let is_selected = selected.is_some_and(|s| s.id == pane.id);
        let dot_color = pane.color.map(|c| hex(pane_border(theme, c))).unwrap_or(iced::Color::TRANSPARENT);
        let dot = container(Space::new()).width(10).height(10).style(move |_| container::Style {
            background: Some(Background::Color(dot_color)),
            border: Border { color: hex(chrome.border), width: 1.0, radius: 5.0.into() },
            ..Default::default()
        });
        let folded = view.is_collapsed(&pane.id);
        let name = button(
            row![
                text(format!("{}", index + 1)).size(10).font(mono).color(hex(chrome.text_muted)),
                dot,
                text(if pane.title.is_empty() { pane.id.as_str() } else { pane.title.as_str() }).size(12).width(Length::Fill),
                text(if folded { "⤓" } else { "" }).size(10).color(hex(chrome.text_muted)),
            ]
            .spacing(8)
            .align_y(iced::Alignment::Center),
        )
        .width(Length::Fill)
        .padding([4, 8])
        .on_press(Msg::EditorSelect(pane.id.clone()))
        .style(button_style(chrome, if is_selected { Look::Selected } else { Look::Outline }));
        let restart = ed.pending_restart.contains(&pane.id).then(|| {
            button(text("redémarrer").size(10)).padding([2, 6]).on_press(Msg::Restart(pane.id.clone())).style(button_style(chrome, Look::Attention))
        });
        let arrow = |glyph: &'static str, up: bool, enabled: bool| {
            button(text(glyph).size(10)).padding([4, 5]).on_press_maybe(enabled.then(|| Msg::Edit(EditOp::Move(pane.id.clone(), up)))).style(button_style(chrome, Look::Outline))
        };
        let mut line = row![name].spacing(4);
        if let Some(r) = restart {
            line = line.push(r);
        }
        line.push(arrow("↑", true, index > 0)).push(arrow("↓", false, index + 1 < count)).align_y(iced::Alignment::Center).into()
    });
    let list_height = (count as f32 * 32.0).min(256.0);
    let list = scrollable(column(rows).spacing(4)).height(Length::Fixed(list_height));

    let mut body = column![header].spacing(12);
    if let Some(error) = error {
        body = body.push(error);
    }
    body = body.push(project).push(hint).push(list);

    if let Some(pane) = selected {
        let default_shell = ShellChoice(None, format!("défaut ({})", layout.defaults.shell.as_str()));
        let mut choices = vec![default_shell.clone()];
        choices.extend(Shell::ALL.iter().map(|&(name, shell)| ShellChoice(Some(shell), name.to_string())));
        let current = choices.iter().find(|c| c.0 == pane.shell).cloned();

        let title = text_input("", &pane.title).on_input(|t| Msg::Edit(EditOp::Title(t))).size(12).padding([4, 8]).style(input_style(chrome));
        let cwd = row![
            text_input("", &pane.cwd).on_input(|t| Msg::Edit(EditOp::Cwd(t))).font(mono).size(12).padding([4, 8]).style(input_style(chrome)),
            button(text("…").size(12)).padding([4, 8]).on_press(Msg::PickPaneCwd).style(button_style(chrome, Look::Outline)),
        ]
        .spacing(4);
        let shell = pick_list(choices, current, |c: ShellChoice| Msg::Edit(EditOp::Shell(c.0))).text_size(12).padding([4, 8]);
        let command = text_editor(&ed.command)
            .placeholder("vide = shell en attente")
            .on_action(|a| Msg::Edit(EditOp::Command(a)))
            .font(mono)
            .size(12)
            .height(Length::Fixed(58.0))
            .padding([4, 8])
            .style(move |_, status| text_editor::Style {
                background: Background::Color(hex(chrome.surface)),
                border: Border {
                    color: if matches!(status, text_editor::Status::Focused { .. }) { hex(chrome.accent) } else { hex(chrome.border) },
                    width: 1.0,
                    radius: 4.0.into(),
                },
                placeholder: with_alpha(hex(chrome.text_muted), 0.7),
                value: hex(chrome.text),
                selection: with_alpha(hex(chrome.accent), 0.35),
            });
        // Writes the file's default *and* applies it now: ticking it must show something today, not tomorrow.
        let folded = checkbox(pane.collapsed == Some(true)).label("Démarrer réduit").text_size(11).size(14).on_toggle(|b| Msg::Edit(EditOp::Collapsed(b)));

        let mut form = column![
            label(chrome, "Titre", title),
            label(chrome, "Dossier (relatif au projet)", cwd),
            swatches("Couleur du contour", pane.color, theme, chrome, |c| Msg::Edit(EditOp::Color(c))),
            label(chrome, "Shell", shell),
            label(chrome, "Commande au lancement", command),
            folded,
            text("Le pane s'ouvre dans la barre du bas. Son shell et sa commande démarrent normalement.").size(10).color(hex(chrome.text_muted)),
        ]
        .spacing(8);
        if ed.pending_restart.contains(&pane.id) {
            form = form.push(
                button(text("Redémarrer ce pane pour appliquer").size(12))
                    .padding([4, 8])
                    .on_press(Msg::Restart(pane.id.clone()))
                    .style(button_style(chrome, Look::Attention)),
            );
        }
        let name = if pane.title.is_empty() { pane.id.as_str() } else { pane.title.as_str() };
        let remove: Element<'a, Msg> = if ed.confirm_remove.as_deref() == Some(pane.id.as_str()) {
            column![
                text(format!("Le pane « {name} » tourne encore. Le supprimer ?")).size(11).color(hex(chrome.status_exited)),
                row![
                    button(text("Annuler").size(12)).padding([4, 8]).on_press(Msg::CancelRemove).style(button_style(chrome, Look::Outline)),
                    button(text("Supprimer").size(12)).padding([4, 8]).on_press(Msg::Edit(EditOp::Remove(pane.id.clone()))).style(button_style(chrome, Look::Attention)),
                ]
                .spacing(6),
            ]
            .spacing(4)
            .into()
        } else {
            row![
                Space::new().width(Length::Fill),
                button(text("Supprimer").size(12).color(hex(chrome.status_exited)))
                    .padding([4, 8])
                    .on_press(Msg::Edit(EditOp::Remove(pane.id.clone())))
                    .style(button_style(chrome, Look::Outline)),
            ]
            .into()
        };
        body = body.push(container(Space::new()).height(1).width(Length::Fill).style(move |_| container::Style { background: Some(Background::Color(hex(chrome.border))), ..Default::default() }));
        body = body.push(form).push(remove);
    }

    container(scrollable(container(body).padding(12)))
        .width(320)
        .height(Length::Fill)
        .style(move |_| container::Style {
            background: Some(Background::Color(hex(chrome.surface_raised))),
            border: Border { color: hex(chrome.border), width: 1.0, radius: 0.0.into() },
            ..Default::default()
        })
        .into()
}
