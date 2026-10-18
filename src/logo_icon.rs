//! The MyTerm logo, drawn in code so its active pane can take the instance colour. Port of
//! `logo-icon.ts` (same shapes, same supersampling, so the pixels match 0.5.0's).

/// The logo's own blue: what an instance without a colour shows.
pub const LOGO_ACCENT: &str = "#4c8dff";

const SURFACE: &str = "#16181d";
const NEIGHBOUR: &str = "#2a2f3a";
const VIEWBOX: f64 = 512.0;

enum Shape {
    /// `fill: None` is the accent, the one fill an instance colour replaces.
    Rect { x: f64, y: f64, w: f64, h: f64, rx: f64, fill: Option<&'static str> },
    Stroke { points: &'static [(f64, f64)], width: f64, fill: &'static str },
}

/// In paint order, in the SVG's 512 x 512 user space.
const SHAPES: &[Shape] = &[
    Shape::Rect { x: 16.0, y: 16.0, w: 480.0, h: 480.0, rx: 104.0, fill: Some(SURFACE) },
    Shape::Rect { x: 72.0, y: 72.0, w: 216.0, h: 368.0, rx: 28.0, fill: None },
    Shape::Rect { x: 312.0, y: 72.0, w: 128.0, h: 174.0, rx: 24.0, fill: Some(NEIGHBOUR) },
    Shape::Rect { x: 312.0, y: 266.0, w: 128.0, h: 174.0, rx: 24.0, fill: Some(NEIGHBOUR) },
    // The prompt chevron: round caps and joins, so a union of two capsules.
    Shape::Stroke { points: &[(122.0, 212.0), (166.0, 256.0), (122.0, 300.0)], width: 30.0, fill: SURFACE },
    Shape::Rect { x: 190.0, y: 286.0, w: 58.0, h: 28.0, rx: 14.0, fill: Some(SURFACE) },
];

impl Shape {
    fn contains(&self, x: f64, y: f64) -> bool {
        match self {
            Shape::Rect { x: rx0, y: ry0, w, h, rx, .. } => {
                if x < *rx0 || y < *ry0 || x > rx0 + w || y > ry0 + h {
                    return false;
                }
                // Distance past the straight edges, per axis: non-zero only in a corner.
                let dx = (rx0 + rx - x).max(0.0).max(x - (rx0 + w - rx));
                let dy = (ry0 + rx - y).max(0.0).max(y - (ry0 + h - rx));
                dx * dx + dy * dy <= rx * rx
            }
            Shape::Stroke { points, width, .. } => {
                let radius = width / 2.0;
                points.windows(2).any(|seg| {
                    let ((ax, ay), (bx, by)) = (seg[0], seg[1]);
                    let length = (bx - ax).powi(2) + (by - ay).powi(2);
                    let t = (((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / length).clamp(0.0, 1.0);
                    let (px, py) = (ax + t * (bx - ax), ay + t * (by - ay));
                    (x - px).powi(2) + (y - py).powi(2) <= radius * radius
                })
            }
        }
    }

    fn fill(&self) -> Option<&'static str> {
        match self {
            Shape::Rect { fill, .. } => *fill,
            Shape::Stroke { fill, .. } => Some(fill),
        }
    }
}

fn rgb(hex: &str) -> [u32; 3] {
    let channel = |i: usize| u32::from_str_radix(&hex[i..i + 2], 16).expect("a #rrggbb colour");
    [channel(1), channel(3), channel(5)]
}

/// Straight-alpha RGBA pixels of the logo at `size` x `size`, its active pane painted in `accent`.
/// Anti-aliased by supersampling, denser at the small sizes where every edge pixel shows.
pub fn rasterize_logo(size: usize, accent: &str) -> Vec<u8> {
    let fills: Vec<[u32; 3]> = SHAPES.iter().map(|s| rgb(s.fill().unwrap_or(accent))).collect();
    let samples = if size <= 64 { 4 } else { 2 };
    let scale = VIEWBOX / size as f64;
    let mut pixels = vec![0u8; size * size * 4];
    for row in 0..size {
        for col in 0..size {
            let (mut sum, mut covered) = ([0u32; 3], 0u32);
            for sy in 0..samples {
                for sx in 0..samples {
                    let x = (col as f64 + (sx as f64 + 0.5) / samples as f64) * scale;
                    let y = (row as f64 + (sy as f64 + 0.5) / samples as f64) * scale;
                    // Painter's order: the last shape containing the point is on top.
                    if let Some(top) = SHAPES.iter().rposition(|s| s.contains(x, y)) {
                        (0..3).for_each(|c| sum[c] += fills[top][c]);
                        covered += 1;
                    }
                }
            }
            if covered == 0 {
                continue;
            }
            let at = (row * size + col) * 4;
            // JS `Math.round` rounds halves up; f64::round rounds them away from zero: same for positives.
            (0..3).for_each(|c| pixels[at + c] = (sum[c] as f64 / covered as f64).round() as u8);
            pixels[at + 3] = (covered as f64 / (samples * samples) as f64 * 255.0).round() as u8;
        }
    }
    pixels
}

#[cfg(test)]
mod tests {
    use super::*;

    fn px(p: &[u8], size: usize, x: usize, y: usize) -> [u8; 4] {
        let at = (y * size + x) * 4;
        [p[at], p[at + 1], p[at + 2], p[at + 3]]
    }

    #[test]
    fn the_active_pane_takes_the_accent_and_the_rest_does_not() {
        let p = rasterize_logo(64, "#ff7b72");
        assert_eq!(px(&p, 64, 14, 30), [0xff, 0x7b, 0x72, 255], "the big pane");
        assert_eq!(px(&p, 64, 50, 20), [0x2a, 0x2f, 0x3a, 255], "a neighbour keeps its grey");
        assert_eq!(px(&p, 64, 0, 0)[3], 0, "the corner outside the rounded square is transparent");
    }
}
