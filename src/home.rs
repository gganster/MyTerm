//! The home screen: recent projects and *Ouvrir un dossier…*. Port of `ProjectPicker`.

use crate::app::Msg;
use crate::platform::format_local_short;
use crate::prefs_store::PrefsStore;
use crate::ui::{button_style, card, hex, with_alpha, Ch, Look};
use iced::widget::{button, column, container, row, scrollable, text, Space};
use iced::{Alignment, Background, Border, Element, Font, Length};
use std::path::Path;

pub struct RecentRow {
    pub path: String,
    pub name: String,
    pub when: String,
    /// Missing is not the same as gone: an unplugged network drive greys out, it does not vanish.
    pub missing: bool,
}

#[derive(Default)]
pub struct Home {
    pub recents: Vec<RecentRow>,
    pub error: Option<String>,
}

impl Home {
    /// Read once when the screen appears: `view` runs on every frame, and a stat per row per frame
    /// would be a disk access for nothing.
    pub fn load(prefs: &PrefsStore, error: Option<String>) -> Home {
        let recents = prefs
            .get()
            .recent_projects
            .iter()
            .map(|p| RecentRow { path: p.path.clone(), name: p.name.clone(), when: format_local_short(&p.last_opened_at), missing: !Path::new(&p.path).is_dir() })
            .collect();
        Home { recents, error }
    }
}

pub fn view<'a>(home: &'a Home, chrome: Ch, theme_toggle: Element<'a, Msg>) -> Element<'a, Msg> {
    let mono = Font::with_name("Cascadia Mono");
    let bar = container(row![text("MyTerm").size(12).color(hex(chrome.text)), Space::new().width(Length::Fill), theme_toggle].align_y(Alignment::Center))
        .padding([6, 12])
        .width(Length::Fill)
        .style(move |_| container::Style {
            border: Border { color: hex(chrome.border), width: 1.0, radius: 0.0.into() },
            background: Some(Background::Color(hex(chrome.surface))),
            ..Default::default()
        });

    let title = row![
        text("Ouvrir un projet").size(18).color(hex(chrome.text)),
        Space::new().width(Length::Fill),
        button(text("Ouvrir un dossier…").size(12)).padding([6, 12]).on_press(Msg::PickFolder).style(button_style(chrome, Look::Primary)),
    ]
    .align_y(Alignment::Center);

    let error = home.error.as_ref().map(|message| {
        container(text(message.as_str()).size(12).color(hex(chrome.status_exited)))
            .padding([8, 12])
            .width(Length::Fill)
            .style(move |_| container::Style {
                background: Some(Background::Color(with_alpha(hex(chrome.status_exited), 0.10))),
                border: Border { color: with_alpha(hex(chrome.status_exited), 0.4), width: 1.0, radius: 4.0.into() },
                ..Default::default()
            })
    });

    let list: Element<'a, Msg> = if home.recents.is_empty() {
        container(
            column![
                text("Aucun projet récent").size(14).color(hex(chrome.text)),
                text("Ouvrez un dossier, ou lancez `myterm .` depuis un terminal.").size(12).color(hex(chrome.text_muted)),
            ]
            .spacing(4)
            .align_x(Alignment::Center),
        )
        .padding([40, 16])
        .width(Length::Fill)
        .center_x(Length::Fill)
        .style(move |_| container::Style { border: Border { color: hex(chrome.border), width: 1.0, radius: 6.0.into() }, ..Default::default() })
        .into()
    } else {
        column(home.recents.iter().map(|r| {
            let name = format!("{}{}", r.name, if r.missing { " · introuvable" } else { "" });
            let open = button(
                column![
                    text(name).size(14).color(hex(if r.missing { chrome.text_muted } else { chrome.text })),
                    text(r.path.as_str()).size(11).font(mono).color(hex(chrome.text_muted)),
                ]
                .spacing(2),
            )
            .width(Length::Fill)
            .padding(0)
            .on_press_maybe((!r.missing).then(|| Msg::OpenRecent(r.path.clone())))
            .style(button_style(chrome, Look::Ghost));
            container(
                row![
                    open,
                    text(r.when.as_str()).size(11).color(hex(chrome.text_muted)),
                    button(text("✕").size(12)).padding([0, 6]).on_press(Msg::Forget(r.path.clone())).style(button_style(chrome, Look::Ghost)),
                ]
                .spacing(12)
                .align_y(Alignment::Center),
            )
            .padding([8, 12])
            .width(Length::Fill)
            .style(card(chrome, 6.0))
            .into()
        }))
        .spacing(6)
        .into()
    };

    let mut page = column![title].spacing(16).max_width(672);
    if let Some(error) = error {
        page = page.push(error);
    }
    let page = page.push(list);

    column![bar, scrollable(container(page).padding(32).center_x(Length::Fill)).height(Length::Fill)].into()
}
