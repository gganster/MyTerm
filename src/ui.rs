//! Colours and widget looks shared by the window chrome, the home screen and the layout editor.

use crate::palette_chrome::Chrome;
use iced::widget::{button, container, text_input};
use iced::{Background, Border, Color, Theme};

pub type Ch = &'static Chrome;

pub fn hex(value: &str) -> Color {
    let channel = |i: usize| u8::from_str_radix(&value[i..i + 2], 16).unwrap_or(0);
    Color::from_rgb8(channel(1), channel(3), channel(5))
}

pub fn with_alpha(c: Color, a: f32) -> Color {
    Color { a, ..c }
}

/// A bordered surface, the look of a card.
pub fn card(chrome: Ch, radius: f32) -> impl Fn(&Theme) -> container::Style {
    move |_| container::Style {
        background: Some(Background::Color(hex(chrome.surface))),
        border: Border { color: hex(chrome.border), width: 1.0, radius: radius.into() },
        ..Default::default()
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Look {
    /// The one action of a screen: accent fill.
    Primary,
    /// Bordered, quiet.
    Outline,
    /// No frame until hovered.
    Ghost,
    /// The current item of a list.
    Selected,
    /// A warning action (attention colour).
    Attention,
}

pub fn button_style(chrome: Ch, look: Look) -> impl Fn(&Theme, button::Status) -> button::Style {
    move |_, status| {
        let hovered = matches!(status, button::Status::Hovered | button::Status::Pressed);
        let disabled = matches!(status, button::Status::Disabled);
        let (background, text_color, edge) = match look {
            Look::Primary => (Some(hex(chrome.accent)), hex(chrome.accent_contrast), None),
            Look::Outline => (hovered.then(|| hex(chrome.surface_sunken)), hex(chrome.text), Some(hex(chrome.border))),
            Look::Ghost => (hovered.then(|| hex(chrome.surface_sunken)), if hovered { hex(chrome.text) } else { hex(chrome.text_muted) }, None),
            Look::Selected => (Some(hex(chrome.surface)), hex(chrome.text), Some(hex(chrome.accent))),
            Look::Attention => {
                let c = hex(chrome.status_attention);
                (Some(with_alpha(c, 0.10)), c, Some(with_alpha(c, 0.5)))
            }
        };
        let fade = if disabled { 0.4 } else if look == Look::Primary && hovered { 0.9 } else { 1.0 };
        button::Style {
            background: background.map(|c| Background::Color(with_alpha(c, c.a * fade))),
            text_color: with_alpha(text_color, fade),
            border: Border { color: edge.unwrap_or(Color::TRANSPARENT), width: if edge.is_some() { 1.0 } else { 0.0 }, radius: 4.0.into() },
            ..Default::default()
        }
    }
}

pub fn input_style(chrome: Ch) -> impl Fn(&Theme, text_input::Status) -> text_input::Style {
    move |_, status| text_input::Style {
        background: Background::Color(hex(chrome.surface)),
        border: Border {
            color: if matches!(status, text_input::Status::Focused { .. }) { hex(chrome.accent) } else { hex(chrome.border) },
            width: 1.0,
            radius: 4.0.into(),
        },
        icon: hex(chrome.text_muted),
        placeholder: with_alpha(hex(chrome.text_muted), 0.7),
        value: hex(chrome.text),
        selection: with_alpha(hex(chrome.accent), 0.35),
    }
}
