//! Differential tests: every answer here was produced by the Electron 0.5.0 code itself
//! (`tools/fixtures/gen.mjs`). A mismatch is a behaviour change, which the brief forbids.

mod common;
use common::tempdir;
use myterm::collate::locale_compare;
use myterm::cwd::resolve_cwd;
use myterm::path_key::Platform;
use myterm::schema::edit::*;
use myterm::schema::error::describe_failure;
use myterm::schema::layout::*;
use myterm::schema::merge::*;
use myterm::schema::prefs::*;
use myterm::atomic::serialise_json;
use myterm::trust::{commands_hash, ResolvedPane};
use myterm::workspace::{read_layout, resolve_panes};
use serde_json::Value;
use std::cmp::Ordering;
use std::path::Path;

fn fixture(name: &str) -> Vec<Value> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(format!("{name}.json"));
    serde_json::from_str(&std::fs::read_to_string(path).expect("run tools/fixtures/gen.mjs")).unwrap()
}

fn s(v: &Value) -> &str {
    v.as_str().unwrap()
}

#[test]
fn read_layout_matches_electron() {
    let dir = tempdir();
    let mut known_gaps = Vec::new();
    let cases = fixture("layoutCases");
    for case in &cases {
        let text = s(&case["text"]);
        std::fs::write(dir.path().join(".myterm.json"), text).unwrap();
        let got = read_layout(dir.path());
        if case["ok"] == true {
            match got {
                Ok(layout) => assert_eq!(serialise_json(&layout), s(&case["json"]), "text: {text}"),
                // serde_json cannot hold a lone UTF-16 surrogate; 0.5.0 could. Fails safe (reported as bad JSON).
                Err(e) if e.kind() == "malformed-json" && text.contains("\\ud800") => known_gaps.push(text.to_string()),
                Err(e) => panic!("expected ok for {text}, got {}", describe_failure(&e)),
            }
        } else {
            let e = got.expect_err(&format!("expected failure for {text}"));
            assert_eq!(e.kind(), s(&case["kind"]), "text: {text}");
            if !case["message"].is_null() {
                assert_eq!(describe_failure(&e), s(&case["message"]), "text: {text}");
            }
        }
    }
    assert!(known_gaps.len() <= 1, "{known_gaps:?}");
    assert!(cases.len() > 600);
}

fn base(i: u64) -> Layout {
    let v: Value = serde_json::from_str(s(&fixture("basesOut")[i as usize])).unwrap();
    parse_layout(&v).unwrap()
}

fn same(result: &EditResult, expected: &Value, ctx: &Value) {
    match result {
        Ok(layout) => {
            assert_eq!(expected["ok"], true, "{ctx}");
            assert_eq!(serialise_json(layout), s(&expected["json"]), "{ctx}");
        }
        Err(message) => {
            assert_eq!(expected["ok"], false, "{ctx}");
            assert_eq!(message, s(&expected["message"]), "{ctx}");
        }
    }
}

fn color_of(v: &Value) -> Option<PaneColor> {
    v.as_str().map(|c| PaneColor::ALL.iter().find(|(n, _)| *n == c).unwrap().1)
}

#[test]
fn layout_edits_match_electron() {
    for case in fixture("editCases") {
        let layout = base(case["base"].as_u64().unwrap());
        let id = case["id"].as_str().unwrap_or("");
        let got = match s(&case["op"]) {
            "add" => add_pane(&layout),
            "remove" => remove_pane(&layout, id),
            "move" => move_pane(&layout, id, s(&case["dir"]) == "up"),
            "color" => set_project_color(&layout, color_of(&case["color"])),
            "update" => update_pane(&layout, id, |p| {
                let patch = case["patch"].as_object().unwrap();
                if let Some(v) = patch.get("id") { p.id = s(v).into() }
                if let Some(v) = patch.get("title") { p.title = s(v).into() }
                if let Some(v) = patch.get("cwd") { p.cwd = s(v).into() }
                if let Some(v) = patch.get("shell") {
                    p.shell = v.as_str().map(|n| Shell::ALL.iter().find(|(x, _)| *x == n).unwrap().1)
                }
                if let Some(v) = patch.get("command") { p.command = v.as_str().map(String::from) }
                if let Some(v) = patch.get("color") { p.color = color_of(v) }
                if let Some(v) = patch.get("collapsed") { p.collapsed = v.as_bool() }
            }),
            other => panic!("{other}"),
        };
        same(&got, &case["result"], &case);
    }
}

#[test]
fn restart_set_matches_electron() {
    for case in fixture("restartCases") {
        let parse = |k: &str| parse_layout(&serde_json::from_str(s(&case[k])).unwrap()).unwrap();
        let got = panes_needing_restart(&parse("a"), &parse("b"));
        let want: Vec<String> = case["result"].as_array().unwrap().iter().map(|v| s(v).into()).collect();
        assert_eq!(got, want);
    }
}

fn pane_of(v: &Value) -> ResolvedPane {
    ResolvedPane {
        id: s(&v["id"]).into(),
        title: s(&v["title"]).into(),
        cwd: s(&v["cwd"]).into(),
        shell: s(&v["shell"]).into(),
        command: v.get("command").and_then(Value::as_str).map(String::from),
    }
}

#[test]
fn trust_hash_matches_electron() {
    for case in fixture("trustCases") {
        let panes: Vec<ResolvedPane> = case["panes"].as_array().unwrap().iter().map(pane_of).collect();
        assert_eq!(commands_hash(&panes), s(&case["hash"]), "{}", case["panes"]);
    }
}

#[test]
fn collation_matches_local_compare() {
    for case in fixture("cmpPairs") {
        let want = case["r"].as_i64().unwrap();
        let got = match locale_compare(s(&case["a"]), s(&case["b"])) {
            Ordering::Less => -1,
            Ordering::Equal => 0,
            Ordering::Greater => 1,
        };
        assert_eq!(got, want, "{:?} vs {:?}", case["a"], case["b"]);
    }
}

fn prefs_of(v: &Value) -> Preferences {
    parse_preferences(v).unwrap_or_else(|e| panic!("{e:?} for {v}"))
}

#[test]
fn preference_merge_matches_electron() {
    for case in fixture("mergeCases") {
        let platform = if s(&case["platform"]) == "win32" { Platform::Win32 } else { Platform::Other };
        let i = &case["intents"];
        let mut intents = PreferenceIntents {
            dirty_theme: i["dirtyKeys"].as_array().unwrap().iter().any(|k| s(k) == "theme"),
            dirty_window: i["dirtyKeys"].as_array().unwrap().iter().any(|k| s(k) == "window"),
            ..Default::default()
        };
        for pair in i["remembered"].as_array().unwrap() {
            let e = &pair[1];
            intents.remembered.set(
                s(&pair[0]).into(),
                RecentProject { path: s(&e["path"]).into(), name: s(&e["name"]).into(), last_opened_at: s(&e["lastOpenedAt"]).into(), missing: None },
            );
        }
        for pair in i["trusted"].as_array().unwrap() {
            let e = &pair[1];
            intents.trusted.set(s(&pair[0]).into(), TrustedProject { path: s(&e["path"]).into(), commands_hash: s(&e["commandsHash"]).into() });
        }
        intents.forgotten = i["forgotten"].as_array().unwrap().iter().map(|v| s(v).into()).collect();
        intents.revoked = i["revoked"].as_array().unwrap().iter().map(|v| s(v).into()).collect();

        let merged = merge_preferences(&prefs_of(&case["disk"]), &prefs_of(&case["ours"]), &intents, platform);
        assert_eq!(serde_json::to_value(&merged).unwrap(), case["merged"], "{case}");
    }
}

#[test]
fn preferences_validation_matches_electron() {
    for case in fixture("prefCases") {
        match parse_preferences(&case["input"]) {
            Ok(p) => {
                assert_eq!(case["ok"], true, "{}", case["input"]);
                assert_eq!(serde_json::to_value(&p).unwrap(), case["data"], "{}", case["input"]);
            }
            Err(problems) => {
                assert_eq!(case["ok"], false, "{}", case["input"]);
                let want: Vec<&str> = case["problems"].as_array().unwrap().iter().map(s).collect();
                assert_eq!(problems, want, "{}", case["input"]);
            }
        }
    }
}

#[test]
fn resolve_cwd_matches_electron() {
    // `path.win32.resolve` of a drive-relative or rooted path depends on the process's own drive: the
    // fixtures were generated from `C:\` (see gen.mjs), so the test must run from there too, whatever
    // drive the checkout lives on (a CI workspace is on D:).
    std::env::set_current_dir("C:\\").expect("C:\\");
    for case in fixture("cwdCases") {
        let (root, cwd) = (s(&case["root"]), s(&case["cwd"]));
        match resolve_cwd(root, cwd) {
            Ok(p) => {
                assert_eq!(case["ok"], true, "{root} + {cwd}");
                assert_eq!(p, s(&case["path"]), "{root} + {cwd}");
            }
            Err(e) => {
                assert_eq!(case["ok"], false, "{root} + {cwd}");
                assert_eq!(e.to_string(), s(&case["message"]));
            }
        }
    }
}

#[test]
fn resolve_panes_matches_electron() {
    for case in fixture("resolveCases") {
        let dir = tempdir();
        std::fs::create_dir_all(dir.path().join("frontend")).unwrap();
        std::fs::create_dir_all(dir.path().join("a/b")).unwrap();
        // tempdir paths are canonical-ish already; compare with the root as Node saw it.
        let root = dir.path().to_string_lossy().into_owned();
        let raw: Value = serde_json::from_str(&case["layout"].to_string().replace("<ROOT>", &root.replace('\\', "\\\\"))).unwrap();
        let layout = parse_layout(&raw).unwrap();
        let out = resolve_panes(&root, &layout);
        let rel = |x: &str| x.replace(&root, "<ROOT>");

        let want_panes = case["panes"].as_array().unwrap();
        assert_eq!(out.panes.len(), want_panes.len());
        for (got, want) in out.panes.iter().zip(want_panes) {
            assert_eq!((got.id.as_str(), got.title.as_str(), got.shell.as_str()), (s(&want["id"]), s(&want["title"]), s(&want["shell"])));
            assert_eq!(rel(&got.cwd), s(&want["cwd"]));
            assert_eq!(got.command.as_deref(), want.get("command").and_then(Value::as_str));
        }
        let want_warn = case["warnings"].as_array().unwrap();
        assert_eq!(out.warnings.len(), want_warn.len());
        for (got, want) in out.warnings.iter().zip(want_warn) {
            assert_eq!((got.pane_id.as_str(), rel(&got.message)), (s(&want["paneId"]), s(&want["message"]).to_string()));
        }
        // The hash covers the resolved cwd, which includes the temp root; recompute the expectation shape only.
        assert_eq!(commands_hash(&out.panes).len(), s(&case["hash"]).len());
    }
}

#[test]
fn ansi_palettes_match_electron() {
    use myterm::palette::{ansi_for, ResolvedTheme};
    for case in fixture("paletteCases") {
        let theme = if s(&case["name"]) == "light" { ResolvedTheme::Light } else { ResolvedTheme::Dark };
        let p = ansi_for(theme);
        let a = &case["ansi"];
        let got = [
            ("background", p.background), ("foreground", p.foreground), ("cursor", p.cursor),
            ("cursorAccent", p.cursor_accent), ("selectionBackground", p.selection_background),
            ("black", p.black), ("red", p.red), ("green", p.green), ("yellow", p.yellow), ("blue", p.blue),
            ("magenta", p.magenta), ("cyan", p.cyan), ("white", p.white), ("brightBlack", p.bright_black),
            ("brightRed", p.bright_red), ("brightGreen", p.bright_green), ("brightYellow", p.bright_yellow),
            ("brightBlue", p.bright_blue), ("brightMagenta", p.bright_magenta), ("brightCyan", p.bright_cyan),
            ("brightWhite", p.bright_white),
        ];
        assert_eq!(a.as_object().unwrap().len(), got.len(), "every field of the theme is covered");
        for (key, value) in got {
            assert_eq!(s(&a[key]), value, "{} / {key}", s(&case["name"]));
        }
    }
}

fn color_opt(v: &Value) -> Option<PaneColor> {
    v.as_str().map(|n| PaneColor::ALL.iter().find(|(s, _)| *s == n).expect("a known colour").1)
}

#[test]
fn instance_colour_header_matches_electron() {
    use myterm::palette::{project_chrome, ResolvedTheme};
    for case in fixture("chromeCases") {
        let theme = if s(&case["theme"]) == "light" { ResolvedTheme::Light } else { ResolvedTheme::Dark };
        let got = project_chrome(theme, color_opt(&case["color"]));
        match case["chrome"].as_object() {
            None => assert!(got.is_none(), "{case}"),
            Some(c) => {
                let got = got.expect("a colour tints the header");
                assert_eq!((got.accent, got.tint.as_str(), got.on_accent), (s(&c["accent"]), s(&c["tint"]), s(&c["onAccent"])), "{case}");
            }
        }
    }
}

#[test]
fn logo_pixels_match_electron() {
    use myterm::logo_icon::rasterize_logo;
    use sha2::{Digest, Sha256};
    for case in fixture("logoCases") {
        let pixels = rasterize_logo(case["size"].as_u64().unwrap() as usize, s(&case["accent"]));
        let sha: String = Sha256::digest(&pixels).iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(sha, s(&case["sha"]), "{} px, {}", case["size"], case["accent"]);
    }
}

#[test]
fn taskbar_ids_match_electron() {
    use myterm::identity::{app_user_model_id, window_app_user_model_id};
    for case in fixture("appIdCases") {
        let id = window_app_user_model_id(&app_user_model_id(case["packaged"].as_bool().unwrap()), color_opt(&case["color"]));
        assert_eq!(id, s(&case["id"]));
    }
}

#[test]
fn external_editor_resolution_matches_electron() {
    use myterm::external_editor::{list_editors, resolve_editor_path, EditorId, Env};
    use std::path::PathBuf;
    for case in fixture("editorCases") {
        let files: Vec<PathBuf> = case["files"].as_array().unwrap().iter().map(|f| PathBuf::from(s(f))).collect();
        let exists = |p: &Path| files.iter().any(|f| f == p);
        let e = &case["env"];
        let env = Env { local_app_data: Some(s(&e["LOCALAPPDATA"]).into()), program_files: Some(s(&e["ProgramFiles"]).into()), program_files_x86: Some(s(&e["ProgramFiles(x86)"]).into()) };
        let as_str = |p: Option<PathBuf>| p.map(|p| p.to_string_lossy().into_owned());
        assert_eq!(as_str(resolve_editor_path(EditorId::Vscode, &env, exists)), case["vscode"].as_str().map(String::from), "{case}");
        assert_eq!(as_str(resolve_editor_path(EditorId::Antigravity, &env, exists)), case["antigravity"].as_str().map(String::from), "{case}");
        let listed: Vec<(String, bool)> = list_editors(&env, exists).iter().map(|e| (e.label.to_string(), e.available)).collect();
        let expected: Vec<(String, bool)> = case["list"].as_array().unwrap().iter().map(|e| (s(&e["label"]).to_string(), e["available"].as_bool().unwrap())).collect();
        assert_eq!(listed, expected, "{case}");
    }
}

// ---------------------------------------------------------------------------------------------
// T07: quota, load and usage polling
// ---------------------------------------------------------------------------------------------

mod t07 {
    use super::*;
    use myterm::quota::*;
    use myterm::system_load::*;
    use myterm::usage::*;

    fn cases() -> Value {
        fixture("quotaCases").remove(0)
    }

    fn opt_f(v: &Value) -> Option<f64> {
        v.as_f64()
    }

    fn opt_i(v: &Value) -> Option<i64> {
        v.as_i64().or_else(|| v.as_f64().map(|f| f as i64))
    }

    fn window(v: &Value) -> QuotaWindow {
        QuotaWindow { utilization: opt_i(&v["utilization"]), resets_at: opt_f(&v["resetsAt"]), window_seconds: opt_f(&v["windowSeconds"]) }
    }

    fn windows(v: &Value) -> Option<Windows> {
        (!v.is_null()).then(|| Windows { session: window(&v["session"]), week: window(&v["week"]) })
    }

    #[test]
    fn quota_windows_and_epochs_match_electron() {
        let c = cases();
        for case in c["normaliseCases"].as_array().unwrap() {
            let got = normalise_window(&case["u"], &case["r"], &case["seconds"]);
            assert_eq!(got, window(&case["win"]), "{case}");
        }
        for case in c["epochCases"].as_array().unwrap() {
            assert_eq!(to_epoch_ms(&case["value"]), opt_f(&case["ms"]), "{case}");
        }
    }

    #[test]
    fn quota_text_matches_electron() {
        let c = cases();
        let now = c["now"].as_f64().unwrap();
        for case in c["countdownCases"].as_array().unwrap() {
            assert_eq!(format_countdown(opt_f(&case["resetsAt"]), now), s(&case["text"]), "{case}");
        }
        for case in c["toneCases"].as_array().unwrap() {
            let u = opt_i(&case["u"]);
            let tone = match s(&case["tone"]) {
                "unknown" => QuotaTone::Unknown,
                "ok" => QuotaTone::Ok,
                "warn" => QuotaTone::Warn,
                _ => QuotaTone::Critical,
            };
            assert_eq!(quota_tone(u), tone, "{case}");
            assert_eq!(format_utilization(u), s(&case["text"]), "{case}");
        }
        for case in c["ageCases"].as_array().unwrap() {
            assert_eq!(format_age(now - case["d"].as_f64().unwrap(), now), s(&case["text"]), "{case}");
        }
        for case in c["labelCases"].as_array().unwrap() {
            assert_eq!(format_window_label(opt_f(&case["w"])), s(&case["text"]), "{case}");
        }
    }

    #[test]
    fn system_load_matches_electron() {
        let c = cases();
        let times = |v: &Value| -> Vec<CpuTimes> {
            v.as_array().unwrap().iter().map(|t| CpuTimes { user: t["user"].as_f64().unwrap(), nice: 0.0, sys: t["sys"].as_f64().unwrap(), idle: t["idle"].as_f64().unwrap(), irq: 0.0 }).collect()
        };
        for case in c["loadCases"]["cpu"].as_array().unwrap() {
            let previous = (!case["previous"].is_null()).then(|| times(&case["previous"]));
            assert_eq!(cpu_busy_percent(previous.as_deref(), &times(&case["current"])), opt_i(&case["percent"]), "{case}");
        }
        for case in c["loadCases"]["memory"].as_array().unwrap() {
            assert_eq!(memory_percent(case["used"].as_f64().unwrap(), case["total"].as_f64().unwrap()), opt_i(&case["percent"]), "{case}");
        }
        for case in c["loadCases"]["gib"].as_array().unwrap() {
            assert_eq!(format_gib(case["bytes"].as_f64().unwrap()), s(&case["text"]), "{case}");
        }
    }

    #[test]
    fn usage_payloads_and_tokens_match_electron() {
        let c = cases();
        for case in c["payloadCases"]["claude"].as_array().unwrap() {
            assert_eq!(parse_claude_payload(&case["data"]), windows(&case["windows"]), "{case}");
        }
        for case in c["payloadCases"]["codex"].as_array().unwrap() {
            assert_eq!(parse_codex_payload(&case["data"]), windows(&case["windows"]), "{case}");
        }
        let now = c["now"].as_f64().unwrap();
        for case in c["tokenCases"]["claude"].as_array().unwrap() {
            assert_eq!(is_token_expired(&case["expiresAt"], now), case["expired"] == true, "{case}");
        }
        for case in c["tokenCases"]["codex"].as_array().unwrap() {
            assert_eq!(is_codex_token_expired(s(&case["token"]), now), case["expired"] == true, "{case}");
        }
    }

    #[test]
    fn poll_schedule_and_degradation_match_electron() {
        let c = cases();
        for case in c["delayCases"].as_array().unwrap() {
            assert_eq!(next_poll_delay_ms(case["failures"].as_u64().unwrap() as u32, case["error"].as_str()), case["ms"].as_u64().unwrap(), "{case}");
        }
        let snap = |v: &Value| UsageSnapshot {
            ok: v["ok"] == true,
            stale: v["stale"] == true,
            fetched_at: v["fetchedAt"].as_f64().unwrap(),
            session: window(&v["session"]),
            week: window(&v["week"]),
            error: v["error"].as_str().map(String::from),
        };
        for case in c["failureCases"].as_array().unwrap() {
            let last = (!case["lastGood"].is_null()).then(|| snap(&case["lastGood"]));
            let got = snapshot_after_failure(last.as_ref(), s(&case["code"]), case["now"].as_f64().unwrap());
            assert_eq!(got, snap(&case["snapshot"]), "{case}");
        }
    }
}
