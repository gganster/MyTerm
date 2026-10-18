//! Hand-written cases ported from the Vitest suites (the executable spec), complementing the
//! differential corpus in `parity.rs`: they name the rule each one protects.

mod common;
use common::tempdir;
use myterm::cwd::{is_inside_root, resolve_cwd};
use myterm::path_key::{normalise_project_path, Platform};
use myterm::schema::error::{describe_failure, LayoutReadFailure};
use myterm::schema::layout::*;
use myterm::trust::*;
use myterm::workspace::read_layout;
use serde_json::json;

const ROOT: &str = "C:\\Users\\dev\\proj";

// ---- resolve-cwd.test.ts ----

#[test]
fn resolves_relative_paths_with_either_separator() {
    assert!(resolve_cwd(ROOT, "frontend").unwrap().to_lowercase().contains("proj\\frontend"));
    assert!(resolve_cwd(ROOT, "apps/web").unwrap().to_lowercase().contains("proj\\apps\\web"));
    assert_eq!(resolve_cwd(ROOT, "a/b").unwrap(), resolve_cwd(ROOT, "a\\b").unwrap());
    assert_eq!(normalise_project_path(&resolve_cwd(ROOT, ".").unwrap(), Platform::Win32), normalise_project_path(ROOT, Platform::Win32));
}

#[test]
fn refuses_anything_that_leaves_the_project() {
    for escape in ["../../Windows", "C:\\Windows\\System32", "frontend/../../other"] {
        assert!(resolve_cwd(ROOT, escape).is_err(), "{escape}");
    }
    assert!(resolve_cwd(ROOT, "C:\\Users\\dev\\proj\\frontend").is_ok());
}

#[test]
fn containment_is_case_insensitive_and_not_fooled_by_a_prefix() {
    assert!(is_inside_root("C:\\Proj", "c:\\proj\\src"));
    assert!(is_inside_root(ROOT, ROOT));
    assert!(!is_inside_root(ROOT, "C:\\Users\\dev\\proj2"));
    assert!(!is_inside_root(ROOT, "C:\\Users\\dev\\proj2\\src"));
    assert!(is_inside_root("C:\\Users\\dev\\proj\\", "C:\\Users\\dev\\proj\\src"));
}

#[test]
fn normalised_paths_ignore_case_and_trailing_separator_on_windows_only() {
    assert_eq!(normalise_project_path("C:\\Proj\\", Platform::Win32), normalise_project_path("c:\\proj", Platform::Win32));
    assert_ne!(normalise_project_path("/home/Proj", Platform::Other), normalise_project_path("/home/proj", Platform::Other));
}

// ---- trust-hash.test.ts ----

fn pane(id: &str, title: &str, cwd: &str, command: Option<&str>) -> ResolvedPane {
    ResolvedPane { id: id.into(), title: title.into(), cwd: cwd.into(), shell: "pwsh".into(), command: command.map(Into::into) }
}

fn panes() -> Vec<ResolvedPane> {
    vec![
        pane("web", "frontend", "C:\\proj\\frontend", Some("npm run dev")),
        pane("api", "backend", "C:\\proj\\backend", Some("npm run dev")),
        pane("free", "scratch", "C:\\proj", None),
    ]
}

fn with(id: &str, f: impl Fn(&mut ResolvedPane)) -> Vec<ResolvedPane> {
    let mut p = panes();
    p.iter_mut().filter(|x| x.id == id).for_each(f);
    p
}

#[test]
fn hash_ignores_pane_order_title_case_of_paths_and_command_less_panes() {
    let h = commands_hash(&panes());
    let mut reversed = panes();
    reversed.reverse();
    assert_eq!(commands_hash(&reversed), h);
    assert_eq!(commands_hash(&with("web", |p| p.title = "tout autre chose".into())), h);
    let shouted: Vec<_> = panes().into_iter().map(|p| ResolvedPane { cwd: p.cwd.to_uppercase(), ..p }).collect();
    assert_eq!(commands_hash(&shouted), h);
    assert_eq!(commands_hash(&panes().into_iter().filter(|p| p.command.is_some()).collect::<Vec<_>>()), h);
}

#[test]
fn hash_changes_with_command_cwd_or_shell() {
    let h = commands_hash(&panes());
    assert_ne!(commands_hash(&with("web", |p| p.command = Some("npm run build".into()))), h);
    assert_ne!(commands_hash(&with("web", |p| p.cwd = "C:\\proj\\autre".into())), h);
    assert_ne!(commands_hash(&with("web", |p| p.shell = "cmd".into())), h);
}

#[test]
fn commands_of_keeps_only_executing_panes_and_their_cwd() {
    let subjects = commands_of(&panes());
    assert_eq!(subjects.len(), 2);
    assert!(subjects.iter().any(|s| s.cwd == "C:\\proj\\frontend"));
}

#[test]
fn strip_commands_is_the_open_without_executing_mode() {
    let stripped = strip_commands(&panes());
    assert!(stripped.iter().all(|p| p.command.is_none()));
    assert_eq!(stripped.len(), 3);
    assert_eq!((stripped[0].id.as_str(), stripped[0].cwd.as_str()), ("web", "C:\\proj\\frontend"));
}

// ---- workspace-read.test.ts ----

const V1: &str = r#"{"version":1,"name":"demo","grid":{"cols":2,"rows":2},"panes":[{"id":"d","col":1,"row":1},{"id":"a","col":0,"row":0},{"id":"c","col":0,"row":1},{"id":"b","col":1,"row":0,"command":"npm run dev"}]}"#;

fn ids(l: &Layout) -> Vec<&str> {
    l.panes.iter().map(|p| p.id.as_str()).collect()
}

fn read(text: &str) -> Result<Layout, LayoutReadFailure> {
    let dir = tempdir();
    std::fs::write(dir.path().join(".myterm.json"), text).unwrap();
    read_layout(dir.path())
}

#[test]
fn migrates_a_v1_file_and_reads_it_in_reading_order() {
    let l = read(V1).unwrap();
    assert_eq!(l.version, LAYOUT_VERSION);
    assert_eq!(ids(&l), ["a", "b", "c", "d"]);
    assert_eq!(l.panes[1].command.as_deref(), Some("npm run dev"));
    assert!(!serde_json::to_string(&l).unwrap().contains("grid"));
    assert_eq!(ids(&read(&format!("\u{feff}{V1}")).unwrap()), ["a", "b", "c", "d"]);
}

#[test]
fn reads_a_v2_file_untouched_in_declaration_order() {
    assert_eq!(ids(&read(&json!({"version": 2, "panes": [{"id": "b"}, {"id": "a"}]}).to_string()).unwrap()), ["b", "a"]);
}

#[test]
fn refuses_a_hand_bumped_v2_that_kept_its_grid_with_both_ways_out() {
    let e = read(&json!({"version": 2, "grid": {"cols": 2, "rows": 1}, "panes": [{"id": "a"}]}).to_string()).unwrap_err();
    assert_eq!(e.kind(), "legacy-fields");
    let message = describe_failure(&e);
    assert!(message.contains("grid") && message.contains("\"version\": 1"));
    let e = read(&json!({"version": 2, "panes": [{"id": "a"}, {"id": "b", "col": 1, "row": 0}]}).to_string()).unwrap_err();
    assert_eq!(e, LayoutReadFailure::LegacyFields { field: "panes.1.col".into() });
}

#[test]
fn refuses_a_newer_version_and_reports_a_missing_file() {
    assert_eq!(read(&json!({"version": 3, "panes": [{"id": "a"}]}).to_string()).unwrap_err().kind(), "future-version");
    let dir = tempdir();
    assert_eq!(read_layout(dir.path()).unwrap_err(), LayoutReadFailure::Missing);
    assert!(!dir.path().join(".myterm.json").exists(), "reading never creates the file");
}

#[test]
fn an_invalid_v1_names_the_faulty_field() {
    let e = read(&json!({"version": 1, "grid": {"cols": 1, "rows": 1}, "panes": [{"id": "", "col": 0, "row": 0}]}).to_string()).unwrap_err();
    let LayoutReadFailure::Invalid { problems } = e else { panic!() };
    assert!(problems.join("\n").contains("panes.0.id"));
}

#[test]
fn reading_never_rewrites_the_file() {
    let dir = tempdir();
    std::fs::write(dir.path().join(".myterm.json"), V1).unwrap();
    read_layout(dir.path()).unwrap();
    assert_eq!(std::fs::read_to_string(dir.path().join(".myterm.json")).unwrap(), V1);
}

// ---- layout.test.ts (the rules the corpus does not name) ----

fn parse(v: serde_json::Value) -> Result<Layout, Vec<String>> {
    parse_layout(&v)
}

#[test]
fn applies_defaults_keeps_order_and_drops_old_coordinates() {
    let l = parse(json!({"version": 2, "name": "demo", "panes": [{"id": "claude-1", "command": "claude"}, {"id": "web", "cwd": "frontend"}, {"id": "free", "col": 2, "row": 1}]})).unwrap();
    assert_eq!((l.theme, l.defaults.shell, l.defaults.cwd.as_str()), (ThemeMode::System, Shell::Pwsh, "."));
    assert_eq!(ids(&l), ["claude-1", "web", "free"]);
    assert_eq!((l.panes[2].title.as_str(), l.panes[2].cwd.as_str()), ("", "."));
    assert!(!serde_json::to_string(&l).unwrap().contains("\"col\""));
}

#[test]
fn collapsed_and_colours_stay_absent_when_the_file_is_silent() {
    let l = parse(json!({"version": 2, "panes": [{"id": "a"}, {"id": "t", "collapsed": true, "color": "blue"}]})).unwrap();
    let out = serde_json::to_value(&l).unwrap();
    assert!(out["panes"][0].get("collapsed").is_none() && out["panes"][0].get("color").is_none());
    assert_eq!(out["panes"][1]["collapsed"], true);
    assert!(out.get("color").is_none());
}

#[test]
fn rejects_what_the_schema_rejects() {
    let bad = [
        json!({"version": 2, "panes": []}),
        json!({"version": 1, "panes": [{"id": "a"}]}),
        json!({"version": 3, "panes": [{"id": "a"}]}),
        json!({"version": 2, "panes": [{"id": "a", "color": "#ff0000"}]}),
        json!({"version": 2, "panes": [{"id": "a", "collapsed": "oui"}]}),
        json!({"version": 2, "color": "turquoise", "panes": [{"id": "a"}]}),
    ];
    for b in bad {
        assert!(parse(b.clone()).is_err(), "{b}");
    }
    let dup = parse(json!({"version": 2, "panes": [{"id": "dup"}, {"id": "dup"}]})).unwrap_err().join("\n");
    assert!(dup.contains("dup") && dup.contains("panes.1.id"));
    let many: Vec<_> = (0..=MAX_PANES).map(|i| json!({"id": format!("p{i}")})).collect();
    assert!(parse(json!({"version": 2, "panes": many})).is_err());
}

#[test]
fn default_layout_is_valid_with_one_pane() {
    let l = default_layout(Some("projet"));
    assert!(parse(serde_json::to_value(&l).unwrap()).is_ok());
    assert_eq!(l.panes.len(), 1);
}

#[test]
fn a_picked_folder_becomes_a_relative_slash_path_or_nothing() {
    use myterm::cwd::relative_to_project;
    assert_eq!(relative_to_project(r"C:\proj", r"C:\proj\apps\web").as_deref(), Some("apps/web"));
    assert_eq!(relative_to_project(r"C:\proj", r"C:\PROJ").as_deref(), Some("."));
    assert_eq!(relative_to_project(r"C:\proj", r"C:\elsewhere"), None);
}
