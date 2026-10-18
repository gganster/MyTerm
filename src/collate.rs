//! `String.prototype.localeCompare` as 0.5.0 uses it (ICU root collation, tertiary strength).
//!
//! The trust hash sorts pane ids with `localeCompare` and the preference merge sorts ISO dates with
//! it, so the *order* is part of a stored format: a different order is a different hash, which is a
//! lost approval (AC3). Exact for ASCII and the Latin-1 / Latin Extended-A accented letters (weights
//! generated from Node's ICU, see `tools/fixtures/gen-collation.mjs`, and checked against it by
//! `tests/parity.rs`).
//!
//! ponytail: any other script sorts by code point after the Latin letters, which matches ICU for the
//! common cases only. Such an id can at worst cost one re-approval; extend the table if it ever does.

use crate::collate_table::{ACCENTED, PRIMARY};
use std::cmp::Ordering;

/// One collation element: primary weight, accent weight, case weight (0 lower, 1 upper).
#[derive(Clone, Copy)]
struct Elem {
    primary: u32,
    secondary: u8,
    tertiary: u8,
}

fn push(out: &mut Vec<Elem>, c: char) {
    let cp = c as u32;
    if cp < 128 {
        let p = PRIMARY[cp as usize];
        if p != 255 {
            out.push(Elem { primary: p as u32, secondary: 0, tertiary: c.is_ascii_uppercase() as u8 });
        }
        return;
    }
    if cp == 0xdf {
        // ß expands to "ss", tertiary-greater than the plain pair.
        for _ in 0..2 {
            out.push(Elem { primary: PRIMARY[b's' as usize] as u32, secondary: 0, tertiary: 2 });
        }
        return;
    }
    if let Ok(i) = ACCENTED.binary_search_by_key(&cp, |e| e.0) {
        let (_, base, sec) = ACCENTED[i];
        out.push(Elem {
            primary: PRIMARY[base as usize] as u32,
            secondary: sec,
            tertiary: base.is_ascii_uppercase() as u8,
        });
        return;
    }
    out.push(Elem { primary: 1000 + cp, secondary: 0, tertiary: 0 });
}

fn elems(s: &str) -> Vec<Elem> {
    let mut v = Vec::with_capacity(s.len());
    s.chars().for_each(|c| push(&mut v, c));
    v
}

/// Same sign as `a.localeCompare(b)`.
pub fn locale_compare(a: &str, b: &str) -> Ordering {
    let (ea, eb) = (elems(a), elems(b));
    let level = |f: fn(&Elem) -> u32| ea.iter().map(f).cmp(eb.iter().map(f));
    level(|e| e.primary)
        .then_with(|| level(|e| e.secondary as u32))
        .then_with(|| level(|e| e.tertiary as u32))
}
