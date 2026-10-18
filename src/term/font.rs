use crate::term::settings::FontSettings;
use iced::{Font, Size};
use iced_core::{
    alignment::Vertical,
    text::{Alignment, LineHeight, Paragraph, Shaping as TextShaping},
    Text,
};
use iced_graphics::text::paragraph;

#[derive(Debug, Clone)]
pub struct TermFont {
    pub(crate) size: f32,
    pub(crate) font_type: Font,
    pub(crate) scale_factor: f32,
    pub(crate) measure: Size<f32>,
}

impl TermFont {
    pub fn new(settings: FontSettings) -> Self {
        Self {
            size: settings.size,
            font_type: settings.font_type,
            scale_factor: settings.scale_factor,
            measure: font_measure(settings.size, settings.scale_factor, settings.font_type),
        }
    }

    /// Without touching the font system: the first measurement loads every installed font (~300 ms),
    /// and a terminal is spawned before that so the shells start at once. The caller measures for
    /// real with `Terminal::measure_font` once they are all started; until then the size is a
    /// plausible monospace cell.
    pub fn estimated(settings: FontSettings) -> Self {
        let scaled = settings.size * settings.scale_factor;
        Self {
            size: settings.size,
            font_type: settings.font_type,
            scale_factor: settings.scale_factor,
            measure: Size::new((scaled * 0.6).ceil(), (scaled * 1.25).ceil()),
        }
    }

    pub fn sync(&mut self) {
        self.measure =
            font_measure(self.size, self.scale_factor, self.font_type)
    }
}

fn font_measure(
    font_size: f32,
    scale_factor: f32,
    font_type: Font,
) -> Size<f32> {
    let paragraph = paragraph::Paragraph::with_text(Text {
        content: "m",
        font: font_type,
        size: iced_core::Pixels(font_size),
        align_y: Vertical::Center,
        align_x: Alignment::Center,
        shaping: TextShaping::Advanced,
        line_height: LineHeight::Relative(scale_factor),
        bounds: Size::INFINITE,
        wrapping: iced_core::text::Wrapping::Glyph,
    });

    paragraph.min_bounds()
}
