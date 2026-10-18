//! Box-drawing (U+2500..U+257F) and block (U+2580..U+259F) characters, drawn as rectangles.
//!
//! A font draws these inside its own line box, so with a 1.2 line height the vertical strokes stop
//! short of the cell and a TUI frame (an agent CLI's input box, a table, a rule) shows gaps between
//! rows. xterm.js's WebGL renderer draws them itself for the same reason (`customGlyphs`); so do we.
//! Cell-local pixel rectangles, no dependency on the renderer, so the geometry is unit-testable.

mod table {
    include!("box_table.rs");
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    /// 1.0 for a solid fill; the shade blocks (░ ▒ ▓) are a translucent full cell.
    pub alpha: f32,
}

fn solid(x: f32, y: f32, w: f32, h: f32) -> Rect {
    Rect { x, y, w, h, alpha: 1.0 }
}

/// Stroke thickness in pixels for a weight (1 light, 2 heavy). Scales with the cell, never below 1.
fn thickness(cell_w: f32, weight: u8) -> f32 {
    let light = (cell_w / 8.0).round().max(1.0);
    if weight >= 2 && weight != 3 {
        light * 2.0
    } else {
        light
    }
}

fn box_lines(c: char, w: f32, h: f32) -> Option<Vec<Rect>> {
    let [l, r, u, d] = table::BOX[(c as u32 - 0x2500) as usize];
    if [l, r, u, d] == [0, 0, 0, 0] {
        return None; // diagonals: left to the font
    }
    let cx = (w / 2.0).floor();
    let cy = (h / 2.0).floor();
    // How far a stroke reaches past the centre so that corners and crossings fill in.
    let horizontal = thickness(w, l.max(r));
    let vertical = thickness(w, u.max(d));
    let (reach_x, reach_y) = (vertical, horizontal);

    // A double stroke is two light strokes `gap` apart, centred on the axis.
    let strokes = |weight: u8| -> Vec<(f32, f32)> {
        let t = thickness(w, weight);
        if weight == 3 {
            let gap = t * 1.5;
            vec![(-gap - t / 2.0, t), (gap - t / 2.0, t)]
        } else {
            vec![(-t / 2.0, t)]
        }
    };

    let mut out = Vec::new();
    for (weight, horizontal_arm, from_start) in [(l, true, true), (r, true, false), (u, false, true), (d, false, false)] {
        if weight == 0 {
            continue;
        }
        for (offset, t) in strokes(weight) {
            let rect = match (horizontal_arm, from_start) {
                (true, true) => solid(0.0, (cy + offset).round(), cx + reach_x / 2.0, t),
                (true, false) => solid(cx - reach_x / 2.0, (cy + offset).round(), w - (cx - reach_x / 2.0), t),
                (false, true) => solid((cx + offset).round(), 0.0, t, cy + reach_y / 2.0),
                (false, false) => solid((cx + offset).round(), cy - reach_y / 2.0, t, h - (cy - reach_y / 2.0)),
            };
            out.push(rect);
        }
    }
    Some(out)
}

/// Fractions of the cell: (x, y, w, h).
type Part = (f32, f32, f32, f32);

fn block_parts(c: char) -> Option<(Vec<Part>, f32)> {
    let cp = c as u32;
    let eighth = |n: f32| n / 8.0;
    let parts: (Vec<Part>, f32) = match cp {
        0x2580 => (vec![(0.0, 0.0, 1.0, 0.5)], 1.0),
        0x2581..=0x2588 => {
            let f = eighth((cp - 0x2580) as f32);
            (vec![(0.0, 1.0 - f, 1.0, f)], 1.0)
        }
        0x2589..=0x258F => {
            let f = eighth((8 - (cp - 0x2588)) as f32);
            (vec![(0.0, 0.0, f, 1.0)], 1.0)
        }
        0x2590 => (vec![(0.5, 0.0, 0.5, 1.0)], 1.0),
        0x2591 => (vec![(0.0, 0.0, 1.0, 1.0)], 0.25),
        0x2592 => (vec![(0.0, 0.0, 1.0, 1.0)], 0.5),
        0x2593 => (vec![(0.0, 0.0, 1.0, 1.0)], 0.75),
        0x2594 => (vec![(0.0, 0.0, 1.0, eighth(1.0))], 1.0),
        0x2595 => (vec![(1.0 - eighth(1.0), 0.0, eighth(1.0), 1.0)], 1.0),
        0x2596..=0x259F => {
            const UL: Part = (0.0, 0.0, 0.5, 0.5);
            const UR: Part = (0.5, 0.0, 0.5, 0.5);
            const LL: Part = (0.0, 0.5, 0.5, 0.5);
            const LR: Part = (0.5, 0.5, 0.5, 0.5);
            let quadrants: &[Part] = match cp {
                0x2596 => &[LL],
                0x2597 => &[LR],
                0x2598 => &[UL],
                0x2599 => &[UL, LL, LR],
                0x259A => &[UL, LR],
                0x259B => &[UL, UR, LL],
                0x259C => &[UL, UR, LR],
                0x259D => &[UR],
                0x259E => &[UR, LL],
                _ => &[UR, LL, LR],
            };
            (quadrants.to_vec(), 1.0)
        }
        _ => return None,
    };
    Some(parts)
}

/// The rectangles that draw `c` in a `w` x `h` cell, or `None` when the font should draw it.
pub fn rects(c: char, w: f32, h: f32) -> Option<Vec<Rect>> {
    match c as u32 {
        0x2500..=0x257F => box_lines(c, w, h),
        0x2580..=0x259F => block_parts(c).map(|(parts, alpha)| {
            parts
                .into_iter()
                .map(|(fx, fy, fw, fh)| Rect {
                    x: (fx * w).round(),
                    y: (fy * h).round(),
                    w: ((fx + fw) * w).round() - (fx * w).round(),
                    h: ((fy + fh) * h).round() - (fy * h).round(),
                    alpha,
                })
                .collect()
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: f32 = 8.0;
    const H: f32 = 19.0;

    fn bounds(rs: &[Rect]) -> (f32, f32, f32, f32) {
        let x0 = rs.iter().map(|r| r.x).fold(f32::MAX, f32::min);
        let y0 = rs.iter().map(|r| r.y).fold(f32::MAX, f32::min);
        let x1 = rs.iter().map(|r| r.x + r.w).fold(f32::MIN, f32::max);
        let y1 = rs.iter().map(|r| r.y + r.h).fold(f32::MIN, f32::max);
        (x0, y0, x1, y1)
    }

    #[test]
    fn the_table_reads_the_unicode_names() {
        assert_eq!(table::BOX[0x00], [1, 1, 0, 0]); // ─
        assert_eq!(table::BOX[0x03], [0, 0, 2, 2]); // ┃
        assert_eq!(table::BOX[0x4B], [2, 2, 2, 2]); // ╋
        assert_eq!(table::BOX[0x0C], [0, 1, 0, 1]); // ┌
        assert_eq!(table::BOX[0x50], [3, 3, 0, 0]); // ═
        assert_eq!(table::BOX[0x6D], [0, 1, 0, 1]); // ╭ (an arc is drawn as its corner)
        assert_eq!(table::BOX[0x1C], [0, 1, 1, 1]); // ├
        assert_eq!(table::BOX[0x1D], [0, 2, 1, 1]); // ┝ vertical light and right heavy
        assert_eq!(table::BOX[0x74], [1, 0, 0, 0]); // ╴
    }

    #[test]
    fn a_horizontal_rule_spans_the_whole_cell_so_neighbours_join() {
        let (x0, _, x1, _) = bounds(&rects('─', W, H).unwrap());
        assert_eq!((x0, x1), (0.0, W));
    }

    #[test]
    fn a_vertical_stroke_spans_the_whole_cell_height_so_rows_have_no_gap() {
        let (_, y0, _, y1) = bounds(&rects('│', W, H).unwrap());
        assert_eq!((y0, y1), (0.0, H));
    }

    #[test]
    fn a_corner_covers_its_two_arms_and_the_joint() {
        let rs = rects('┌', W, H).unwrap();
        let (x0, y0, x1, y1) = bounds(&rs);
        // Right and down arms: reaches the right and bottom edges, and the centre, not the left/top.
        assert_eq!((x1, y1), (W, H));
        assert!(x0 > 0.0 && y0 > 0.0);
    }

    #[test]
    fn heavy_is_thicker_than_light_and_double_is_two_strokes() {
        let light = rects('─', W, H).unwrap();
        let heavy = rects('━', W, H).unwrap();
        let double = rects('═', W, H).unwrap();
        assert!(heavy[0].h > light[0].h);
        assert_eq!(double.len(), 4, "two strokes per arm");
    }

    #[test]
    fn blocks_cover_the_fraction_they_name() {
        let full = rects('█', W, H).unwrap();
        assert_eq!(bounds(&full), (0.0, 0.0, W, H));
        let upper = rects('▀', W, H).unwrap();
        assert_eq!(bounds(&upper), (0.0, 0.0, W, (H * 0.5).round()));
        let lower_quarter = rects('▂', W, H).unwrap()[0];
        assert_eq!((lower_quarter.y + lower_quarter.h, lower_quarter.w), (H, W));
        let left_half = rects('▌', W, H).unwrap();
        assert_eq!(bounds(&left_half), (0.0, 0.0, W / 2.0, H));
        assert_eq!(rects('░', W, H).unwrap()[0].alpha, 0.25);
        assert_eq!(rects('▟', W, H).unwrap().len(), 3);
    }

    #[test]
    fn everything_else_is_left_to_the_font() {
        assert!(rects('a', W, H).is_none());
        assert!(rects('╱', W, H).is_none(), "diagonals stay with the font");
        assert!(rects('é', W, H).is_none());
    }
}
