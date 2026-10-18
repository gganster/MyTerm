//! Claude and Codex usage quota. Port of `usage-parse`, `usage-poller`, `usage-claude`, `usage-codex`
//! and `agent-fetch`.
//!
//! Rules shared by both readers:
//! 1. **The token never leaves this file.** It is read from the CLI's credentials file, put in one
//!    `Authorization` header and dropped. No error carries a path, a URL or an exception text: a
//!    failure is a coarse code (`no-credentials`, `http-403`...), because the code ends up on screen.
//! 2. Failures are silent and non-fatal: the bar shows a hint and the app carries on.
//! 3. Each provider polls on its own, so one outage does not slow the other bar down.

use crate::quota::{normalise_window, QuotaWindow};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Provider {
    Claude,
    Codex,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Windows {
    pub session: QuotaWindow,
    pub week: QuotaWindow,
}

#[derive(Clone, Debug, PartialEq)]
pub struct UsageSnapshot {
    pub ok: bool,
    /// The reading is real but the last poll failed: older than `fetched_at` suggests.
    pub stale: bool,
    /// When the values it carries were actually measured, epoch ms.
    pub fetched_at: f64,
    pub session: QuotaWindow,
    pub week: QuotaWindow,
    pub error: Option<String>,
}

pub fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0.0, |d| d.as_millis() as f64)
}

// ---------------------------------------------------------------------------------------------
// Parsing, without the network
// ---------------------------------------------------------------------------------------------

pub const FIVE_HOUR_SECONDS: f64 = 5.0 * 3600.0;
pub const SEVEN_DAY_SECONDS: f64 = 7.0 * 24.0 * 3600.0;
/// Longest Codex window still read as "the session one": its two windows are named by position,
/// not meaning, so they are classified by declared length.
const SESSION_MAX_SECONDS: f64 = 24.0 * 3600.0;

fn field<'a>(v: &'a Value, key: &str) -> &'a Value {
    v.get(key).unwrap_or(&Value::Null)
}

/// Whether a Claude credentials `expiresAt` is in the past. Absent or unparsable is not an expiry.
pub fn is_token_expired(expires_at_raw: &Value, now: f64) -> bool {
    crate::quota::to_epoch_ms(expires_at_raw).is_some_and(|e| e < now)
}

/// The two windows of an Anthropic usage payload, or `None`: a 200 we cannot read is a failure, not
/// an empty quota.
pub fn parse_claude_payload(data: &Value) -> Option<Windows> {
    let one = |key: &str, seconds: f64| {
        let w = field(data, key);
        normalise_window(field(w, "utilization"), field(w, "resets_at"), &Value::from(seconds))
    };
    let (session, week) = (one("five_hour", FIVE_HOUR_SECONDS), one("seven_day", SEVEN_DAY_SECONDS));
    // Not "one window missing" (an account may lack one): both blank means we did not understand.
    (session.utilization.is_some() || week.utilization.is_some()).then_some(Windows { session, week })
}

/// The two windows of a Codex usage payload, or `None`. Primary/secondary is not session/week: a
/// 7-day plan declares a weekly *primary* and no secondary, so the declared length decides.
pub fn parse_codex_payload(data: &Value) -> Option<Windows> {
    let limit = field(data, "rate_limit");
    let (mut session, mut week, mut session_set) = (QuotaWindow::EMPTY, QuotaWindow::EMPTY, false);
    for key in ["primary_window", "secondary_window"] {
        let raw = field(limit, key);
        if !raw.is_object() {
            continue;
        }
        let seconds = field(raw, "limit_window_seconds");
        let parsed = normalise_window(field(raw, "used_percent"), field(raw, "reset_at"), seconds);
        if parsed.utilization.is_none() {
            continue;
        }
        // A window that does not say how long it is keeps its arrival position: short first.
        let is_session = match seconds.as_f64() {
            Some(s) => s <= SESSION_MAX_SECONDS,
            None => !session_set,
        };
        if is_session {
            session = parsed;
            session_set = true;
        } else {
            week = parsed;
        }
    }
    (session.utilization.is_some() || week.utilization.is_some()).then_some(Windows { session, week })
}

/// Node's `Buffer.from(s, 'base64url')`: lenient, both alphabets, stops at padding.
fn base64url_decode(s: &str) -> Vec<u8> {
    let (mut out, mut acc, mut bits) = (Vec::new(), 0u32, 0u32);
    for c in s.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'-' | b'+' => 62,
            b'_' | b'/' => 63,
            b'=' => break,
            _ => continue,
        };
        acc = (acc << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    out
}

/// Whether a Codex access token has expired, from its own `exp` claim (decoded, never verified).
/// Anything it cannot parse is "we do not know", never "expired".
pub fn is_codex_token_expired(token: &str, now: f64) -> bool {
    let Some(payload) = token.split('.').nth(1).filter(|p| !p.is_empty()) else { return false };
    let Ok(claims) = serde_json::from_slice::<Value>(&base64url_decode(payload)) else { return false };
    // `exp` is epoch *seconds* by spec.
    claims.get("exp").and_then(Value::as_f64).is_some_and(|exp| exp * 1000.0 < now)
}

// ---------------------------------------------------------------------------------------------
// Poll schedule and degradation
// ---------------------------------------------------------------------------------------------

/// Two minutes, not one: the endpoints are shared with each vendor's own CLI and answer 429 when
/// the pollers add up.
const POLL_INTERVAL_MS: u64 = 120_000;
const FIRST_POLL_DELAY_MS: u64 = 2_000;
const MAX_BACKOFF_MS: u64 = 15 * 60_000;
/// A rate limit is about pressure, not breakage: back off hard on the first one.
const RATE_LIMIT_BACKOFF_MS: u64 = 5 * 60_000;
/// One failure known to pass on its own (bot challenge, dropped connection) is retried quickly.
const TRANSIENT_RETRY_MS: u64 = 20_000;
/// How long a good reading stays on screen, marked stale, once polling fails.
const STALE_TOLERANCE_MS: f64 = 15.0 * 60_000.0;

fn is_transient(code: Option<&str>) -> bool {
    matches!(code, Some("network" | "http-403" | "http-408"))
        || code.is_some_and(|c| c.len() == 8 && c.starts_with("http-5") && c.as_bytes()[6..].iter().all(u8::is_ascii_digit))
}

/// Delay before the next attempt.
pub fn next_poll_delay_ms(consecutive_failures: u32, last_error: Option<&str>) -> u64 {
    if consecutive_failures == 0 {
        return POLL_INTERVAL_MS;
    }
    if consecutive_failures == 1 && is_transient(last_error) {
        return TRANSIENT_RETRY_MS;
    }
    let base = if last_error == Some("http-429") { RATE_LIMIT_BACKOFF_MS } else { POLL_INTERVAL_MS };
    // One failure keeps `base`, then doubles: the first miss is usually a blip.
    base.saturating_mul(1u64 << (consecutive_failures - 1).min(20)).min(MAX_BACKOFF_MS)
}

pub fn unavailable(error: &str, now: f64) -> UsageSnapshot {
    UsageSnapshot { ok: false, stale: false, fetched_at: now, session: QuotaWindow::EMPTY, week: QuotaWindow::EMPTY, error: Some(error.into()) }
}

/// What to show once a poll has failed: the last good reading marked stale, until it is too old.
pub fn snapshot_after_failure(last_good: Option<&UsageSnapshot>, code: &str, now: f64) -> UsageSnapshot {
    match last_good {
        Some(good) if now - good.fetched_at < STALE_TOLERANCE_MS => {
            // `fetched_at` kept: it is when these numbers were true, and the tooltip needs that.
            UsageSnapshot { stale: true, error: Some(code.into()), ..good.clone() }
        }
        _ => unavailable(code, now),
    }
}

// ---------------------------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------------------------

/// A coarse code, never an exception text.
type Code = String;

fn home() -> Option<std::path::PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(Into::into)
}

/// The file's JSON, with a code for each way it can fail. Deliberately not `io::Error`: its message
/// carries the path.
fn read_credentials(relative: &[&str]) -> Result<Value, Code> {
    let path = relative.iter().fold(home().ok_or("no-credentials")?, |p, part| p.join(part));
    let raw = std::fs::read_to_string(path).map_err(|_| "no-credentials")?;
    serde_json::from_str(&raw).map_err(|_| "credentials-parse".to_string())
}

const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

/// The one HTTP call both readers make. Coarse failure codes only: a rejected request can quote the
/// URL back.
/// ponytail: rustls with the bundled web roots. Measured on this machine against chatgpt.com: the
/// system TLS stack (schannel) is answered by Cloudflare with a 403 `cf-mitigated: challenge` for good,
/// rustls gets the JSON. The cost is that a corporate root CA or proxy is ignored; if the fingerprint
/// is ever challenged too, the bar says so (`http-403`) and the 20 s retry covers the passing cases.
pub fn fetch_json(url: &str, headers: &[(&str, &str)]) -> Result<Value, Code> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(FETCH_TIMEOUT))
        .http_status_as_error(false)
        .build()
        .into();
    let mut request = agent.get(url);
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let mut response = request.call().map_err(|_| "network".to_string())?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(format!("http-{status}"));
    }
    // A challenge page is valid HTTP with an HTML body: a failure, not an empty quota.
    response.body_mut().read_json::<Value>().map_err(|_| "parse".to_string())
}

/// The header Claude Code sends; the endpoint is version-gated on it. If the bar reports a 4xx that
/// outlives a token refresh, suspect this constant first.
const CLAUDE_CLIENT_VERSION: &str = "2.1.201";
const CODEX_CLIENT_VERSION: &str = "0.154.0";

fn fetch_claude() -> Result<Windows, Code> {
    let creds = read_credentials(&[".claude", ".credentials.json"])?;
    let oauth = field(&creds, "claudeAiOauth");
    let token = field(oauth, "accessToken").as_str().filter(|t| !t.is_empty()).ok_or("no-token")?;
    // Claude Code refreshes the token on its next run; nothing for us to do but say so.
    if is_token_expired(field(oauth, "expiresAt"), now_ms()) {
        return Err("token-expired".into());
    }
    let data = fetch_json(
        "https://api.anthropic.com/api/oauth/usage",
        &[
            ("Authorization", &format!("Bearer {token}")),
            ("anthropic-beta", "oauth-2025-04-20"),
            ("Accept", "application/json"),
            ("User-Agent", &format!("claude-code/{CLAUDE_CLIENT_VERSION}")),
        ],
    )?;
    parse_claude_payload(&data).ok_or_else(|| "shape".into())
}

fn fetch_codex() -> Result<Windows, Code> {
    let creds = read_credentials(&[".codex", "auth.json"])?;
    let tokens = field(&creds, "tokens");
    let token = field(tokens, "access_token").as_str().filter(|t| !t.is_empty()).ok_or("no-token")?;
    if is_codex_token_expired(token, now_ms()) {
        return Err("token-expired".into());
    }
    // An API-key login has no ChatGPT account: the header is sent empty, as the CLI does.
    let account = field(tokens, "account_id").as_str().unwrap_or("");
    // The answer carries the account's e-mail and user id: only the two windows are lifted out.
    let data = fetch_json(
        "https://chatgpt.com/backend-api/codex/usage",
        &[
            ("Authorization", &format!("Bearer {token}")),
            ("chatgpt-account-id", account),
            ("Accept", "application/json"),
            ("User-Agent", &format!("codex-cli/{CODEX_CLIENT_VERSION}")),
            ("originator", "codex_cli_rs"),
        ],
    )?;
    parse_codex_payload(&data).ok_or_else(|| "shape".into())
}

// ---------------------------------------------------------------------------------------------
// Pollers
// ---------------------------------------------------------------------------------------------

pub type Shared = Arc<Mutex<UsageSnapshot>>;

/// One thread per provider, each with its own failure count and backoff, writing its latest
/// snapshot into the returned cell. The threads live as long as the process.
pub fn start_poller(provider: Provider) -> Shared {
    start_with(unavailable("pending", now_ms()), move || match provider {
        Provider::Claude => fetch_claude(),
        Provider::Codex => fetch_codex(),
    })
}

fn start_with(initial: UsageSnapshot, fetch: impl Fn() -> Result<Windows, Code> + Send + 'static) -> Shared {
    let shared: Shared = Arc::new(Mutex::new(initial));
    let cell = shared.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(FIRST_POLL_DELAY_MS));
        let (mut failures, mut last_good): (u32, Option<UsageSnapshot>) = (0, None);
        loop {
            let latest = match fetch() {
                Ok(w) => {
                    failures = 0;
                    let snap = UsageSnapshot { ok: true, stale: false, fetched_at: now_ms(), session: w.session, week: w.week, error: None };
                    last_good = Some(snap.clone());
                    snap
                }
                Err(code) => {
                    failures += 1;
                    snapshot_after_failure(last_good.as_ref(), &code, now_ms())
                }
            };
            let delay = next_poll_delay_ms(failures, latest.error.as_deref());
            *cell.lock().unwrap_or_else(|e| e.into_inner()) = latest;
            std::thread::sleep(Duration::from_millis(delay));
        }
    });
    shared
}

/// The reason in French, in sync with the codes above. The CLI named in the credential messages is
/// the one that would fix it.
pub fn usage_hint(provider: Provider, error: Option<&str>) -> String {
    let (name, cli) = match provider {
        Provider::Claude => ("Claude", "claude"),
        Provider::Codex => ("Codex", "codex"),
    };
    match error {
        Some("pending") => "Lecture du quota…".into(),
        Some("no-credentials" | "no-token") => format!("Aucune session {name} sur cette machine"),
        Some("token-expired") => format!("Session {name} expirée — relancez `{cli}`"),
        Some("network") => "Quota injoignable (hors ligne ?)".into(),
        Some("shape") => "Réponse de quota non reconnue (format changé ?)".into(),
        // A provider's bot check, not a missing right: the next request goes through.
        Some("http-403") => "Quota momentanément refusé — nouvelle tentative en cours".into(),
        Some("http-429") => "Quota temporairement limité par l'API".into(),
        other => format!("Quota indisponible ({})", other.unwrap_or("inconnu")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::{Read, Write};

    #[test]
    fn a_claude_200_we_cannot_read_is_a_failure_not_an_empty_quota() {
        assert_eq!(parse_claude_payload(&json!({"unrelated": 1})), None);
        let w = parse_claude_payload(&json!({"five_hour": {"utilization": 12, "resets_at": "2025-11-04T04:59:59+00:00"}})).unwrap();
        assert_eq!(w.session.utilization, Some(12));
        assert_eq!(w.session.window_seconds, Some(FIVE_HOUR_SECONDS));
        assert_eq!(w.week.utilization, None);
    }

    #[test]
    fn a_weekly_codex_primary_is_the_week_not_the_session() {
        let data = json!({"rate_limit": {"primary_window": {"used_percent": 40, "limit_window_seconds": 604800, "reset_at": 1_762_232_399}}});
        let w = parse_codex_payload(&data).unwrap();
        assert_eq!((w.session.utilization, w.week.utilization), (None, Some(40)));
    }

    #[test]
    fn a_token_that_cannot_be_read_is_not_expired() {
        assert!(!is_codex_token_expired("nope", 1e15));
        assert!(!is_codex_token_expired("a.%%%.c", 1e15));
        // {"exp":1} -> expired; {"exp":99999999999} -> alive
        assert!(is_codex_token_expired("x.eyJleHAiOjF9.y", 1e12));
        assert!(!is_codex_token_expired("x.eyJleHAiOjk5OTk5OTk5OTk5fQ.y", 1e12));
    }

    #[test]
    fn backoff_follows_the_rules_of_0_5_0() {
        assert_eq!(next_poll_delay_ms(0, None), 120_000);
        assert_eq!(next_poll_delay_ms(1, Some("http-403")), 20_000);
        assert_eq!(next_poll_delay_ms(2, Some("http-403")), 240_000);
        assert_eq!(next_poll_delay_ms(1, Some("http-429")), 300_000);
        assert_eq!(next_poll_delay_ms(9, Some("http-429")), 900_000);
    }

    #[test]
    fn a_good_reading_survives_a_failure_for_fifteen_minutes_then_the_bar_admits_it() {
        let good = UsageSnapshot { ok: true, stale: false, fetched_at: 1000.0, session: QuotaWindow::EMPTY, week: QuotaWindow::EMPTY, error: None };
        let kept = snapshot_after_failure(Some(&good), "network", 1000.0 + 60_000.0);
        assert!(kept.ok && kept.stale && kept.fetched_at == 1000.0);
        let gone = snapshot_after_failure(Some(&good), "network", 1000.0 + STALE_TOLERANCE_MS);
        assert!(!gone.ok && !gone.stale);
    }

    /// A missing or unreadable credentials file is a bare code: the `io::Error` text would carry the
    /// path, and the code ends up on screen.
    #[test]
    fn a_failure_shows_a_code_and_a_fixed_sentence_never_a_path_or_a_token() {
        assert_eq!(read_credentials(&["no-such-dir", "no-such-file.json"]), Err("no-credentials".to_string()));
        for code in ["pending", "no-credentials", "no-token", "token-expired", "network", "shape", "http-403", "http-429", "http-401", "parse", "credentials-parse"] {
            for provider in [Provider::Claude, Provider::Codex] {
                let hint = usage_hint(provider, Some(code));
                assert!(!hint.contains('\\') && !hint.contains("C:"), "{hint}");
            }
        }
    }

    /// One real request over a socket: status codes become `http-N`, a JSON body parses, and the
    /// error text carries neither the URL nor the header values.
    #[test]
    fn fetch_json_maps_status_and_body_to_coarse_codes() {
        let serve = |status: &'static str, body: &'static str| {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/usage", listener.local_addr().unwrap());
            std::thread::spawn(move || {
                let (mut s, _) = listener.accept().unwrap();
                let mut buf = [0u8; 2048];
                let _ = s.read(&mut buf);
                let _ = write!(s, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            });
            url
        };
        assert_eq!(fetch_json(&serve("200 OK", "{\"a\":1}"), &[("Authorization", "Bearer SECRET")]), Ok(json!({"a": 1})));
        assert_eq!(fetch_json(&serve("403 Forbidden", "<html>"), &[]), Err("http-403".into()));
        assert_eq!(fetch_json(&serve("200 OK", "<html>challenge"), &[]), Err("parse".into()));
        assert_eq!(fetch_json("http://127.0.0.1:1/x", &[("Authorization", "Bearer SECRET")]), Err("network".into()));
    }
}
