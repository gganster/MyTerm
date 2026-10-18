//! The permanent footer: the agents' quota on the left, machine load on the right. Port of
//! `StatusBar.tsx` and `ProviderMark.tsx`.
//!
//! Colour on a quota bar means *whose*, not *how bad*: Claude orange, Codex green. Severity has two
//! channels of its own (the number's colour and weight) and takes the fill back at `critical`, where
//! the track goes red too. CPU and RAM never escalate: a build pegs the CPU at 100 % all day.
//! Nothing here is clickable: a control in the footer would take the focus away from the terminal.

use crate::app::Msg;
use crate::palette_chrome::Chrome;
use crate::quota::{format_age, format_countdown, format_utilization, format_window_label, quota_tone, QuotaTone, QuotaWindow};
use crate::system_load::{format_gib, memory_percent, SystemLoad};
use crate::ui::{hex, with_alpha, Ch};
use crate::usage::{usage_hint, Provider, UsageSnapshot};
use iced::widget::canvas::{fill::Rule, Frame, Path};
use iced::widget::{canvas, column, container, row, text, tooltip, Space};
use iced::{font, mouse, Alignment, Background, Color, Element, Font, Length, Point, Rectangle, Renderer, Theme};

/// What the footer shows, refreshed by the app on its own slow tick.
pub struct Readings {
    pub claude: UsageSnapshot,
    pub codex: UsageSnapshot,
    pub load: Option<SystemLoad>,
    /// Clock for the countdowns, epoch ms.
    pub now: f64,
}

fn name(p: Provider) -> &'static str {
    match p {
        Provider::Claude => "Claude",
        Provider::Codex => "Codex",
    }
}

// ---------------------------------------------------------------------------------------------
// The provider marks
// ---------------------------------------------------------------------------------------------

/// The Anthropic mark, 24x24. Codex is deliberately not the OpenAI one: a six-petal rosette of the
/// same visual family, and the tooltip and the colour carry the identity.
const CLAUDE_PATH: &str = include_str!("claude_mark.txt");

/// One petal of the rosette as two cubics, from 2.6 to 14.4 on the vertical; it reaches past the
/// centre on purpose so that six of them, filled even-odd, carve the interlace out.
const PETAL: [[(f32, f32); 3]; 2] = [[(15.4, 5.6), (15.4, 11.4), (12.0, 14.4)], [(8.6, 11.4), (8.6, 5.6), (12.0, 2.6)]];

struct Mark {
    provider: Provider,
    color: Color,
}

enum Token {
    Cmd(char),
    Num(f32),
}

fn tokenize(d: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut number = String::new();
    let flush = |number: &mut String, tokens: &mut Vec<Token>| {
        if !number.is_empty() {
            tokens.push(Token::Num(number.parse::<f32>().unwrap_or(0.0)));
            number.clear();
        }
    };
    for c in d.chars() {
        match c {
            'm' | 'l' | 'h' | 'v' | 'c' | 'L' | 'Z' | 'z' => {
                flush(&mut number, &mut tokens);
                tokens.push(Token::Cmd(c));
            }
            '-' => {
                flush(&mut number, &mut tokens);
                number.push(c);
            }
            // "1.5.5" is 1.5 then .5: a second dot starts a new number.
            '.' if number.contains('.') => {
                flush(&mut number, &mut tokens);
                number.push(c);
            }
            c if c.is_ascii_digit() || c == '.' => number.push(c),
            _ => flush(&mut number, &mut tokens),
        }
    }
    flush(&mut number, &mut tokens);
    tokens
}

/// Only the commands the mark uses: m l h v c (relative), L, Z.
fn svg_path(d: &str) -> Path {
    let tokens = tokenize(d);
    Path::new(|b| {
        let (mut cmd, mut at, mut start) = ('m', (0.0f32, 0.0f32), (0.0f32, 0.0f32));
        let mut i = 0;
        while i < tokens.len() {
            if let Token::Cmd(c) = tokens[i] {
                cmd = c;
                i += 1;
                if matches!(c, 'Z' | 'z') {
                    b.close();
                    at = start;
                }
                continue;
            }
            let want = match cmd {
                'h' | 'v' => 1,
                'c' => 6,
                _ => 2,
            };
            let nums: Vec<f32> = tokens[i..].iter().take(want).map_while(|t| if let Token::Num(n) = t { Some(*n) } else { None }).collect();
            if nums.len() != want {
                break;
            }
            i += want;
            let n = nums;
            match cmd {
                'm' => {
                    at = (at.0 + n[0], at.1 + n[1]);
                    start = at;
                    b.move_to(Point::new(at.0, at.1));
                    cmd = 'l'; // further pairs after a moveto are linetos
                }
                'l' => {
                    at = (at.0 + n[0], at.1 + n[1]);
                    b.line_to(Point::new(at.0, at.1));
                }
                'L' => {
                    at = (n[0], n[1]);
                    b.line_to(Point::new(at.0, at.1));
                }
                'h' => {
                    at.0 += n[0];
                    b.line_to(Point::new(at.0, at.1));
                }
                'v' => {
                    at.1 += n[0];
                    b.line_to(Point::new(at.0, at.1));
                }
                'c' => {
                    let p = |k: usize| Point::new(at.0 + n[k], at.1 + n[k + 1]);
                    b.bezier_curve_to(p(0), p(2), p(4));
                    at = (at.0 + n[4], at.1 + n[5]);
                }
                _ => break,
            }
        }
    })
}

fn rosette() -> Path {
    let rotate = |(x, y): (f32, f32), degrees: f32| {
        let (sin, cos) = degrees.to_radians().sin_cos();
        let (dx, dy) = (x - 12.0, y - 12.0);
        Point::new(12.0 + dx * cos - dy * sin, 12.0 + dx * sin + dy * cos)
    };
    Path::new(|b| {
        for angle in [0.0, 60.0, 120.0, 180.0, 240.0, 300.0] {
            b.move_to(rotate((12.0, 2.6), angle));
            let [a, c] = &PETAL;
            b.bezier_curve_to(rotate(a[0], angle), rotate(a[1], angle), rotate(a[2], angle));
            b.bezier_curve_to(rotate(c[0], angle), rotate(c[1], angle), rotate(c[2], angle));
            b.close();
        }
    })
}

impl canvas::Program<Msg> for Mark {
    type State = ();

    fn draw(&self, _: &(), renderer: &Renderer, _: &Theme, bounds: Rectangle, _: mouse::Cursor) -> Vec<canvas::Geometry> {
        let mut frame = Frame::new(renderer, bounds.size());
        frame.scale(bounds.width / 24.0);
        let (path, rule) = match self.provider {
            Provider::Claude => (svg_path(CLAUDE_PATH), Rule::NonZero),
            Provider::Codex => (rosette(), Rule::EvenOdd),
        };
        frame.fill(&path, canvas::Fill { style: canvas::Style::Solid(self.color), rule });
        vec![frame.into_geometry()]
    }
}

fn quota_color(chrome: &Chrome, provider: Provider) -> Color {
    hex(match provider {
        Provider::Claude => chrome.quota_claude,
        Provider::Codex => chrome.quota_codex,
    })
}

fn mark<'a>(provider: Provider, chrome: Ch) -> Element<'a, Msg> {
    canvas(Mark { provider, color: quota_color(chrome, provider) }).width(14).height(14).into()
}

// ---------------------------------------------------------------------------------------------
// Gauges
// ---------------------------------------------------------------------------------------------

const SEMIBOLD: Font = Font { weight: font::Weight::Semibold, ..Font::DEFAULT };
const SIZE: f32 = 11.0;

fn fill_color(chrome: &Chrome, tone: QuotaTone) -> Color {
    match tone {
        QuotaTone::Unknown => with_alpha(hex(chrome.border_strong), 0.4),
        QuotaTone::Ok => hex(chrome.status_running),
        QuotaTone::Warn => hex(chrome.status_attention),
        QuotaTone::Critical => hex(chrome.status_exited),
    }
}

/// One gauge: label, value, 40 px bar. `identity` is the provider's colour, held until `critical`.
fn gauge<'a>(chrome: Ch, label: String, percent: Option<i64>, tone: QuotaTone, value: String, title: String, identity: Option<Color>) -> Element<'a, Msg> {
    let fill = match identity {
        Some(c) if !matches!(tone, QuotaTone::Critical | QuotaTone::Unknown) => c,
        _ => fill_color(chrome, tone),
    };
    let (value_color, value_font) = match tone {
        QuotaTone::Warn => (hex(chrome.status_attention), SEMIBOLD),
        QuotaTone::Critical => (hex(chrome.status_exited), SEMIBOLD),
        _ => (hex(chrome.text_muted), Font::DEFAULT),
    };
    let track = if tone == QuotaTone::Critical { with_alpha(hex(chrome.status_exited), 0.2) } else { hex(chrome.surface_sunken) };
    let width = 40.0 * percent.unwrap_or(0).clamp(0, 100) as f32 / 100.0;
    let bar = container(container(Space::new()).width(width).height(4).style(move |_| container::Style {
        background: Some(Background::Color(fill)),
        border: iced::border::rounded(4),
        ..Default::default()
    }))
    .width(40)
    .height(4)
    .style(move |_| container::Style { background: Some(Background::Color(track)), border: iced::border::rounded(4), ..Default::default() });
    tooltip(
        row![text(label).size(SIZE).color(hex(chrome.text_muted)), text(value).size(SIZE).color(value_color).font(value_font), bar].spacing(6).align_y(Alignment::Center),
        text(title).size(SIZE),
        tooltip::Position::Top,
    )
    .into()
}

fn quota_gauge<'a>(chrome: Ch, provider: Provider, quota: &QuotaWindow, now: f64) -> Element<'a, Msg> {
    let tone = quota_tone(quota.utilization);
    let countdown = format_countdown(quota.resets_at, now);
    let label = format_window_label(quota.window_seconds);
    // The provider name lives in the tooltip: the label is a mark, and this is where someone who does
    // not recognise the logo finds out what it is.
    let title = format!("{} — quota {label} consommé, réinitialisation dans {countdown}", name(provider));
    row![
        gauge(chrome, label, quota.utilization, tone, format_utilization(quota.utilization), title, Some(quota_color(chrome, provider))),
        text(format!("↻ {countdown}")).size(SIZE).color(with_alpha(hex(chrome.text_muted), 0.7)),
    ]
    .spacing(6)
    .align_y(Alignment::Center)
    .into()
}

/// One agent: its mark, then the windows it actually has. A window with an unknown utilisation is
/// dropped rather than drawn as "— %": an empty gauge beside a real one reads as a quota at zero.
fn provider_quota<'a>(chrome: Ch, provider: Provider, snap: &UsageSnapshot, now: f64) -> Element<'a, Msg> {
    let windows: Vec<&QuotaWindow> = if snap.ok { [&snap.session, &snap.week].into_iter().filter(|w| w.utilization.is_some()).collect() } else { Vec::new() };
    let tip = if snap.stale {
        format!("{} — quota mesuré il y a {} · {}", name(provider), format_age(snap.fetched_at, now), usage_hint(provider, snap.error.as_deref()))
    } else {
        name(provider).to_string()
    };
    let mut head = row![mark(provider, chrome)].spacing(4).align_y(Alignment::Center);
    if snap.stale {
        // One glyph, not a banner: the reading is still worth trusting, just older than promised.
        head = head.push(text("⋯").size(SIZE).color(with_alpha(hex(chrome.text_muted), 0.6)));
    }
    let mut line = row![tooltip(head, text(tip).size(SIZE), tooltip::Position::Top)].spacing(8).align_y(Alignment::Center);
    if windows.is_empty() {
        line = line.push(text(usage_hint(provider, snap.error.as_deref())).size(SIZE).color(hex(chrome.text_muted)));
    }
    for (index, w) in windows.into_iter().enumerate() {
        if index > 0 {
            line = line.push(text("│").size(SIZE).color(hex(chrome.border_strong)));
        }
        line = line.push(quota_gauge(chrome, provider, w, now));
    }
    line.into()
}

pub fn view<'a>(r: &Readings, chrome: Ch) -> Element<'a, Msg> {
    let cpu = r.load.and_then(|l| l.cpu);
    let memory = r.load.and_then(|l| memory_percent(l.memory_used, l.memory_total));
    let memory_title = match r.load {
        Some(l) => format!("Mémoire vive : {} sur {}", format_gib(l.memory_used), format_gib(l.memory_total)),
        None => "Mémoire vive".into(),
    };
    // CPU and RAM carry no identity colour and never escalate.
    let load_tone = |p: Option<i64>| if p.is_none() { QuotaTone::Unknown } else { QuotaTone::Ok };
    let load = row![
        gauge(chrome, "CPU".into(), cpu, load_tone(cpu), cpu.map_or("—".into(), |c| format!("{c} %")), "Charge processeur de la machine".into(), None),
        gauge(chrome, "RAM".into(), memory, load_tone(memory), memory.map_or("—".into(), |m| format!("{m} %")), memory_title, None),
    ]
    .spacing(12);
    let bar = row![
        row![provider_quota(chrome, Provider::Claude, &r.claude, r.now), provider_quota(chrome, Provider::Codex, &r.codex, r.now)].spacing(16),
        Space::new().width(Length::Fill),
        load,
    ]
    .spacing(16)
    .align_y(Alignment::Center);
    let (border, surface) = (hex(chrome.border), hex(chrome.surface));
    column![container(bar).padding([4, 12]).width(Length::Fill).style(move |_| container::Style {
        background: Some(Background::Color(surface)),
        border: iced::Border { color: border, width: 1.0, radius: 0.0.into() },
        ..Default::default()
    })]
    .into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_claude_mark_only_uses_the_commands_the_parser_knows() {
        let letters: std::collections::BTreeSet<char> = CLAUDE_PATH.chars().filter(char::is_ascii_alphabetic).collect();
        assert_eq!(letters.into_iter().collect::<String>(), "LZchlmv");
    }
}
