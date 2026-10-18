//! Agent usage quota: shape and the pure logic around it. Port of `shared/quota.ts`.
//!
//! Two windows per provider, the two anyone actually watches. Everything here is pure, and checked
//! against the Electron code itself (`tests/parity.rs`).

use serde_json::Value;

/// One rate-limit window as the status bar needs it.
#[derive(Clone, Debug, PartialEq)]
pub struct QuotaWindow {
    /// Percentage consumed, 0-100. `None` means "unknown", never "zero".
    pub utilization: Option<i64>,
    /// Epoch ms at which the window rolls over.
    pub resets_at: Option<f64>,
    /// Length of the window in seconds when the provider says so; the gauge label comes from it.
    pub window_seconds: Option<f64>,
}

impl QuotaWindow {
    pub const EMPTY: QuotaWindow = QuotaWindow { utilization: None, resets_at: None, window_seconds: None };
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QuotaTone {
    Unknown,
    Ok,
    Warn,
    Critical,
}

/// `Date.parse` for the ISO 8601 forms an API sends: `YYYY[-MM[-DD]]`, optionally `Thh:mm[:ss[.f+]]`
/// and `Z` or `±hh:mm`. Anything else is `None`.
/// ponytail: no legacy formats (`Nov 4 2025`), and a time without an offset is read as UTC where JS
/// reads it as local time; both quota endpoints always send an offset.
fn parse_iso_ms(s: &str) -> Option<f64> {
    let b = s.as_bytes();
    let digits = |from: usize, n: usize| -> Option<i64> {
        let part = b.get(from..from + n)?;
        part.iter().all(u8::is_ascii_digit).then(|| part.iter().fold(0i64, |a, d| a * 10 + (d - b'0') as i64))
    };
    let year = digits(0, 4)?;
    let (mut month, mut day, mut at) = (1, 1, 4);
    if b.get(at) == Some(&b'-') {
        month = digits(at + 1, 2)?;
        at += 3;
        if b.get(at) == Some(&b'-') {
            day = digits(at + 1, 2)?;
            at += 3;
        }
    }
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let (mut h, mut m, mut sec, mut frac_ms, mut offset_min) = (0i64, 0i64, 0i64, 0f64, 0i64);
    if at < b.len() {
        if b[at] != b'T' && b[at] != b' ' {
            return None;
        }
        h = digits(at + 1, 2)?;
        if b.get(at + 3) != Some(&b':') {
            return None;
        }
        m = digits(at + 4, 2)?;
        at += 6;
        if b.get(at) == Some(&b':') {
            sec = digits(at + 1, 2)?;
            at += 3;
            if b.get(at) == Some(&b'.') {
                let start = at + 1;
                let mut end = start;
                while b.get(end).is_some_and(u8::is_ascii_digit) {
                    end += 1;
                }
                if end == start {
                    return None;
                }
                // Milliseconds, truncated the way V8 does for more than three digits.
                frac_ms = format!("0.{}", &s[start..end]).parse::<f64>().ok()? * 1000.0;
                frac_ms = frac_ms.floor();
                at = end;
            }
        }
        match b.get(at) {
            None => {}
            Some(b'Z') if at + 1 == b.len() => {}
            Some(&sign @ (b'+' | b'-')) => {
                let (oh, om) = (digits(at + 1, 2)?, if b.get(at + 3) == Some(&b':') { digits(at + 4, 2)? } else { digits(at + 3, 2)? });
                let used = if b.get(at + 3) == Some(&b':') { at + 6 } else { at + 5 };
                if used != b.len() {
                    return None;
                }
                offset_min = (oh * 60 + om) * if sign == b'-' { -1 } else { 1 };
            }
            _ => return None,
        }
    }
    if h > 24 || m > 59 || sec > 59 {
        return None;
    }
    // Days since 1970-01-01 (Howard Hinnant).
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let secs = days * 86_400 + h * 3600 + m * 60 + sec - offset_min * 60;
    Some(secs as f64 * 1000.0 + frac_ms)
}

/// Accepts the API's ISO strings and, defensively, epoch seconds or ms.
pub fn to_epoch_ms(value: &Value) -> Option<f64> {
    match value {
        Value::Number(n) => {
            let v = n.as_f64()?;
            if !v.is_finite() {
                return None;
            }
            // Anything below ~2001 in ms is really a seconds-precision timestamp.
            Some(if v < 1e12 { v * 1000.0 } else { v })
        }
        Value::String(s) => parse_iso_ms(s),
        _ => None,
    }
}

/// `Number(x)` for the two kinds the allowlist lets through. A blank string is excluded before this.
fn js_number(s: &str) -> Option<f64> {
    s.trim().parse::<f64>().ok().filter(|v| v.is_finite())
}

/// Normalises one window of the API payload. A missing or unparsable utilisation yields `None`,
/// never `0`: a bar at zero reads as "quota intact", the opposite of "we have no idea".
pub fn normalise_window(utilization_raw: &Value, resets_at_raw: &Value, window_seconds_raw: &Value) -> QuotaWindow {
    let resets_at = to_epoch_ms(resets_at_raw);
    let window_seconds = window_seconds_raw.as_f64().filter(|v| v.is_finite() && *v > 0.0);
    // An allowlist, not a null check: `true`, `[]` and `''` all coerce to a number in JS.
    let numeric = match utilization_raw {
        Value::Number(n) => n.as_f64().filter(|v| v.is_finite()),
        Value::String(s) if !s.trim().is_empty() => js_number(s),
        _ => None,
    };
    let utilization = numeric.map(|v| (v + 0.5).floor().clamp(0.0, 100.0) as i64);
    QuotaWindow { utilization, resets_at, window_seconds }
}

/// Time left before the window rolls over, in the shortest readable form.
pub fn format_countdown(resets_at: Option<f64>, now: f64) -> String {
    let Some(resets_at) = resets_at else { return "—".into() };
    let remaining = resets_at - now;
    if remaining <= 0.0 {
        return "réinit.".into();
    }
    let minutes = (remaining / 60_000.0).floor() as i64;
    let days = minutes / 1440;
    let hours = (minutes % 1440) / 60;
    if days > 0 {
        format!("{days} j {hours} h")
    } else if hours > 0 {
        format!("{hours} h {:02}", minutes % 60)
    } else {
        format!("{minutes} min")
    }
}

/// Severity of a consumption level. Thresholds are deliberately late: the bar is ambient.
pub fn quota_tone(utilization: Option<i64>) -> QuotaTone {
    match utilization {
        None => QuotaTone::Unknown,
        Some(u) if u >= 90 => QuotaTone::Critical,
        Some(u) if u >= 75 => QuotaTone::Warn,
        Some(_) => QuotaTone::Ok,
    }
}

pub fn format_utilization(utilization: Option<i64>) -> String {
    utilization.map_or("—".into(), |u| format!("{u} %"))
}

/// How long ago a reading was taken, for the tooltip on a stale snapshot.
pub fn format_age(fetched_at: f64, now: f64) -> String {
    let seconds = (((now - fetched_at) / 1000.0 + 0.5).floor()).max(0.0) as i64;
    if seconds < 60 {
        return format!("{seconds} s");
    }
    let minutes = seconds / 60;
    if minutes < 60 {
        format!("{minutes} min")
    } else {
        format!("{} h", minutes / 60)
    }
}

/// Short name for a window, from its own length (the duration, not a role name).
pub fn format_window_label(window_seconds: Option<f64>) -> String {
    let Some(s) = window_seconds.filter(|s| s.is_finite() && *s > 0.0) else { return "—".into() };
    let hours = (s / 3600.0 + 0.5).floor() as i64;
    if hours < 48 {
        format!("{hours} h")
    } else {
        format!("{} j", ((hours as f64 / 24.0) + 0.5).floor() as i64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn iso_with_more_than_three_fraction_digits_and_an_offset() {
        // 2025-11-04T04:59:59.943648+00:00, a shape the Anthropic endpoint really sends.
        assert_eq!(parse_iso_ms("2025-11-04T04:59:59.943648+00:00"), Some(1_762_232_399_943.0));
        assert_eq!(parse_iso_ms("2025-11-04T06:59:59+02:00"), Some(1_762_232_399_000.0));
        assert_eq!(parse_iso_ms("hier"), None);
    }

    #[test]
    fn a_blank_utilisation_is_unknown_never_zero() {
        let w = normalise_window(&json!(""), &Value::Null, &Value::Null);
        assert_eq!(w.utilization, None);
        assert_eq!(normalise_window(&json!(true), &Value::Null, &Value::Null).utilization, None);
        assert_eq!(normalise_window(&json!(" 42.6 "), &Value::Null, &Value::Null).utilization, Some(43));
    }
}
