//! Which taskbar button and icon a window gets. Port of `app-id.ts` and the pure half of
//! `instance-identity.ts`.

use crate::logo_icon::{rasterize_logo, LOGO_ACCENT};
use crate::palette::{pane_border, ResolvedTheme};
use crate::schema::layout::PaneColor;

/// `appId` of the 0.5.0 installer, written into the Start menu and desktop shortcuts as their
/// AppUserModelID. The process claims the same id so its windows group with those shortcuts,
/// including a pinned one (AC14).
pub const APP_ID: &str = "dev.gganster.myterm";

/// A development build gets its own id, so that `cargo run` never lands in the taskbar button of
/// the installed MyTerm the developer is typing in.
/// A release build outside a test run. `MYTERM_DEV` keeps a test run out of the taskbar button of the
/// installed MyTerm, and out of its update channel.
pub fn packaged() -> bool {
    !cfg!(debug_assertions) && std::env::var_os("MYTERM_DEV").is_none()
}

pub fn app_user_model_id(packaged: bool) -> String {
    if packaged { APP_ID.into() } else { format!("{APP_ID}.dev") }
}

/// One id per colour: Windows gives one button to every window sharing an id and draws it with the
/// app's icon, so a coloured instance has to leave the group to be seen. Two windows of the same
/// colour still share a button, which is the colour meaning what it says.
pub fn window_app_user_model_id(base: &str, color: Option<PaneColor>) -> String {
    match color {
        Some(c) => format!("{base}.{}", c.as_str()),
        None => base.into(),
    }
}

/// The logo is dark whatever the theme, so it takes the dark set of border colours.
pub fn logo_accent(color: Option<PaneColor>) -> &'static str {
    color.map_or(LOGO_ACCENT, |c| pane_border(ResolvedTheme::Dark, c))
}

/// ponytail: one 64 px bitmap, scaled by Windows, where 0.5.0 wrote an `.ico` with eight sizes.
/// Upgrade by building a multi-size `HICON` with `CreateIconFromResourceEx` if the 16 px taskbar
/// chevron looks smeared.
const ICON_SIZE: usize = 64;

pub fn window_icon(color: Option<PaneColor>) -> Option<iced::window::Icon> {
    iced::window::icon::from_rgba(rasterize_logo(ICON_SIZE, logo_accent(color)), ICON_SIZE as u32, ICON_SIZE as u32).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_running_process_and_the_installed_shortcuts_agree_and_a_colour_gets_its_own_button() {
        assert_eq!(app_user_model_id(true), "dev.gganster.myterm");
        assert_eq!(app_user_model_id(false), "dev.gganster.myterm.dev");
        assert_eq!(window_app_user_model_id("dev.gganster.myterm", None), "dev.gganster.myterm");
        assert_eq!(window_app_user_model_id("dev.gganster.myterm", Some(PaneColor::Purple)), "dev.gganster.myterm.purple");
    }

    #[test]
    fn every_colour_has_an_icon_accent_and_no_colour_keeps_the_logo_blue() {
        assert_eq!(logo_accent(None), "#4c8dff");
        assert_eq!(logo_accent(Some(PaneColor::Pink)), "#f778ba");
        assert!(window_icon(Some(PaneColor::Green)).is_some());
    }
}
