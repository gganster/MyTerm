//! ANSI palettes, light and dark. Port of `renderer/theme/palette.ts` (`ansi`).
//!
//! The light palette is designed first, not derived by inverting the dark one: standard bright ANSI
//! colours are unreadable on white (yellow becomes dark amber, "bright" goes *darker*). Chrome and
//! pane-border colours join this file with T05.

use crate::term::ColorPalette;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResolvedTheme {
    Light,
    Dark,
}

/// One xterm `ITheme`, field for field.
pub struct AnsiPalette {
    pub background: &'static str,
    pub foreground: &'static str,
    pub cursor: &'static str,
    pub cursor_accent: &'static str,
    pub selection_background: &'static str,
    pub black: &'static str,
    pub red: &'static str,
    pub green: &'static str,
    pub yellow: &'static str,
    pub blue: &'static str,
    pub magenta: &'static str,
    pub cyan: &'static str,
    pub white: &'static str,
    pub bright_black: &'static str,
    pub bright_red: &'static str,
    pub bright_green: &'static str,
    pub bright_yellow: &'static str,
    pub bright_blue: &'static str,
    pub bright_magenta: &'static str,
    pub bright_cyan: &'static str,
    pub bright_white: &'static str,
}

pub const LIGHT: AnsiPalette = AnsiPalette {
    background: "#ffffff",
    foreground: "#1c1f26",
    cursor: "#0b62d6",
    cursor_accent: "#ffffff",
    selection_background: "#bcd9ff",
    black: "#1c1f26",
    red: "#cf222e",
    green: "#116329",
    // Pure yellow on white is invisible: dark amber instead.
    yellow: "#7d4e00",
    blue: "#0550ae",
    magenta: "#7b3fbf",
    cyan: "#1b6f78",
    white: "#6e7781",
    // "Bright" must mean *more contrast*, which on white means darker.
    bright_black: "#57606a",
    bright_red: "#a40e26",
    bright_green: "#0d5122",
    bright_yellow: "#633c01",
    bright_blue: "#0a3d91",
    bright_magenta: "#5f2da8",
    bright_cyan: "#125861",
    bright_white: "#404752",
};

pub const DARK: AnsiPalette = AnsiPalette {
    background: "#16181d",
    foreground: "#d9dee6",
    cursor: "#4c8dff",
    cursor_accent: "#16181d",
    selection_background: "#2f4b73",
    black: "#484f58",
    red: "#ff7b72",
    green: "#3fb950",
    yellow: "#d29922",
    blue: "#58a6ff",
    magenta: "#bc8cff",
    cyan: "#39c5cf",
    white: "#b1bac4",
    bright_black: "#6e7681",
    bright_red: "#ffa198",
    bright_green: "#56d364",
    bright_yellow: "#e3b341",
    bright_blue: "#79c0ff",
    bright_magenta: "#d2a8ff",
    bright_cyan: "#56d4dd",
    bright_white: "#f0f6fc",
};

pub fn ansi_for(theme: ResolvedTheme) -> &'static AnsiPalette {
    match theme {
        ResolvedTheme::Light => &LIGHT,
        ResolvedTheme::Dark => &DARK,
    }
}

/// The palette in the shape the terminal widget takes. xterm has no separate "dim" colours (SGR 2 is
/// an opacity), so the dim slots repeat the normal ones; the widget already fades dim cells itself.
pub fn color_palette(theme: ResolvedTheme) -> Box<ColorPalette> {
    let p = ansi_for(theme);
    let s = |v: &str| v.to_string();
    Box::new(ColorPalette {
        foreground: s(p.foreground),
        background: s(p.background),
        black: s(p.black),
        red: s(p.red),
        green: s(p.green),
        yellow: s(p.yellow),
        blue: s(p.blue),
        magenta: s(p.magenta),
        cyan: s(p.cyan),
        white: s(p.white),
        bright_black: s(p.bright_black),
        bright_red: s(p.bright_red),
        bright_green: s(p.bright_green),
        bright_yellow: s(p.bright_yellow),
        bright_blue: s(p.bright_blue),
        bright_magenta: s(p.bright_magenta),
        bright_cyan: s(p.bright_cyan),
        bright_white: s(p.bright_white),
        bright_foreground: None,
        dim_foreground: s(p.foreground),
        dim_black: s(p.black),
        dim_red: s(p.red),
        dim_green: s(p.green),
        dim_yellow: s(p.yellow),
        dim_blue: s(p.blue),
        dim_magenta: s(p.magenta),
        dim_cyan: s(p.cyan),
        dim_white: s(p.white),
        cursor: s(p.cursor),
        cursor_accent: s(p.cursor_accent),
        selection: s(p.selection_background),
    })
}

// ---------------------------------------------------------------------------------------------
// Chrome: pane borders and the instance colour
// ---------------------------------------------------------------------------------------------

use crate::palette_chrome::{PaneBorders, DARK_BORDERS, DARK_CHROME, LIGHT_BORDERS, LIGHT_CHROME};
use crate::schema::layout::PaneColor;

pub fn pane_border(theme: ResolvedTheme, color: PaneColor) -> &'static str {
    let b: &PaneBorders = if theme == ResolvedTheme::Dark { &DARK_BORDERS } else { &LIGHT_BORDERS };
    match color {
        PaneColor::Red => b.red,
        PaneColor::Orange => b.orange,
        PaneColor::Yellow => b.yellow,
        PaneColor::Green => b.green,
        PaneColor::Cyan => b.cyan,
        PaneColor::Blue => b.blue,
        PaneColor::Purple => b.purple,
        PaneColor::Pink => b.pink,
    }
}

/// How much of the instance colour the header background takes: enough to tell two windows apart
/// at a glance, and no more (the header's muted labels still clear WCAG AA at 10 %).
pub const HEADER_TINT: f64 = 0.1;

/// The header of a project that has an instance colour.
#[derive(Debug, PartialEq, Eq)]
pub struct ProjectChrome {
    /// The colour itself: the header's bottom rule and the project-name pill.
    pub accent: &'static str,
    /// Header background, `accent` mixed into the theme's surface.
    pub tint: String,
    /// Text on the pill: the theme's surface, the colours were drawn against it.
    pub on_accent: &'static str,
}

fn mix_hex(top: &str, base: &str, amount: f64) -> String {
    let channel = |hex: &str, i: usize| u8::from_str_radix(&hex[i..i + 2], 16).unwrap_or(0) as f64;
    let mixed: Vec<String> = [1, 3, 5].iter().map(|&i| format!("{:02x}", (channel(top, i) * amount + channel(base, i) * (1.0 - amount)).round() as u8)).collect();
    format!("#{}", mixed.concat())
}

pub fn project_chrome(theme: ResolvedTheme, color: Option<PaneColor>) -> Option<ProjectChrome> {
    let accent = pane_border(theme, color?);
    let surface = if theme == ResolvedTheme::Dark { DARK_CHROME.surface } else { LIGHT_CHROME.surface };
    Some(ProjectChrome { accent, tint: mix_hex(accent, surface, HEADER_TINT), on_accent: surface })
}
