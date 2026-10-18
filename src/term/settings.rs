use std::{collections::HashMap, path::PathBuf};

use crate::term::ColorPalette;
use iced::Font;

#[cfg(target_os = "windows")]
const DEFAULT_SHELL: &str = "wsl.exe";

#[cfg(not(target_os = "windows"))]
const DEFAULT_SHELL: &str = "/bin/bash";

/// Keys the application keeps for itself: the widget neither handles nor captures them, so they
/// reach the application's own shortcut handler and never the shell. Receives the whole event
/// (logical, modified and physical key), because on a non-US layout the logical key of the digit row
/// is the unshifted symbol (`&` for the `1` key on AZERTY).
pub type Reserved = fn(&iced::keyboard::Event) -> bool;

#[derive(Default, Clone)]
pub struct Settings {
    pub font: FontSettings,
    pub theme: ThemeSettings,
    pub backend: BackendSettings,
    pub reserved: Option<Reserved>,
}

#[derive(Debug, Clone)]
pub struct BackendSettings {
    pub program: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub working_directory: Option<PathBuf>,
    /// Lines kept above the screen (0.5.0: 5000).
    pub scrollback: usize,
}

impl Default for BackendSettings {
    fn default() -> Self {
        Self {
            program: DEFAULT_SHELL.to_string(),
            args: vec![],
            env: HashMap::new(),
            working_directory: None,
            scrollback: 5000,
        }
    }
}

#[derive(Debug, Clone)]
pub struct FontSettings {
    pub size: f32,
    pub scale_factor: f32,
    pub font_type: Font,
}

impl Default for FontSettings {
    fn default() -> Self {
        Self {
            size: 14.0,
            scale_factor: 1.3,
            font_type: Font::MONOSPACE,
        }
    }
}

#[derive(Default, Debug, Clone)]
pub struct ThemeSettings {
    pub color_pallete: Box<ColorPalette>,
}

impl ThemeSettings {
    pub fn new(color_pallete: Box<ColorPalette>) -> Self {
        Self { color_pallete }
    }
}
