//! MyTerm, native. `myterm [folder]` opens a project in its own window and process.

use myterm::app::App;
use myterm::prefs_store::{user_data_dir, PrefsStore};
use myterm::window_geometry::{cascaded, visible_bounds, work_areas};

fn main() -> iced::Result {
    // Shells must see the default Ctrl+C whoever launched MyTerm.
    myterm::platform::restore_default_ctrl_c();
    // Before the first window: a window without an id of its own groups under the process's.
    myterm::platform::set_process_app_id(&myterm::identity::app_user_model_id(myterm::identity::packaged()));
    // The software renderer: ~50 MB for six panes against ~215 MB with the GPU one (spike P01).
    // `ICED_BACKEND=wgpu` opts back in.
    if std::env::var_os("ICED_BACKEND").is_none() {
        std::env::set_var("ICED_BACKEND", "tiny-skia");
    }

    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        myterm::updater::remove_electron_updater_cache(std::path::Path::new(&local));
    }

    // Registered before the window is placed: the cascade counts the *other* live instances.
    let dir = user_data_dir();
    let others = myterm::instances::init(dir.join("instances")).other_count();
    let saved = PrefsStore::load(dir.join("preferences.json")).get().window.clone();
    let areas = work_areas();
    let bounds = cascaded(visible_bounds(&saved, &areas), others, &areas);

    iced::application(App::boot, App::update, App::view)
        .title(App::title)
        .theme(App::theme)
        .subscription(App::subscription)
        .window(iced::window::Settings {
            size: iced::Size::new(bounds.width, bounds.height),
            position: bounds.at.map_or(iced::window::Position::Default, |(x, y)| iced::window::Position::Specific(iced::Point::new(x, y))),
            maximized: saved.maximized,
            min_size: Some(iced::Size::new(720.0, 480.0)),
            icon: myterm::identity::window_icon(None),
            // The close is handled in `App` so the last preferences reach the disk first.
            exit_on_close_request: false,
            ..Default::default()
        })
        .run()
}
