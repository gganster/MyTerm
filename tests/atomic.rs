//! Port of `tests/util/atomic-write.test.ts`. Both guarantees only matter because several
//! instances share one file.

mod common;
use common::tempdir;
use myterm::atomic::{atomic_write, serialise_json, with_file_lock};
use std::fs;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

fn names(dir: &std::path::Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into()).collect();
    v.sort();
    v
}

#[test]
fn writes_the_content_and_leaves_no_temporary() {
    let dir = tempdir();
    let path = dir.path().join("prefs.json");
    atomic_write(&path, "bonjour").unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "bonjour");
    assert_eq!(names(dir.path()), ["prefs.json"]);
}

#[test]
fn two_concurrent_writes_leave_a_whole_file_never_a_mix() {
    let dir = tempdir();
    let path = dir.path().join("prefs.json");
    let (a, b) = ("a".repeat(20_000), "b".repeat(20_000));
    let handles: Vec<_> = [a.clone(), b.clone()]
        .into_iter()
        .map(|c| {
            let p = path.clone();
            std::thread::spawn(move || atomic_write(&p, c).unwrap())
        })
        .collect();
    handles.into_iter().for_each(|h| h.join().unwrap());
    let written = fs::read_to_string(&path).unwrap();
    assert!(written == a || written == b);
    assert_eq!(names(dir.path()), ["prefs.json"]);
}

#[test]
fn a_failed_write_destroys_nothing() {
    let dir = tempdir();
    let path = dir.path().join("existe.json");
    fs::write(&path, "original").unwrap();
    // Destination in a missing folder: the temporary cannot be created, and the original must survive.
    assert!(atomic_write(&dir.path().join("absent").join("x.json"), "nouveau").is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), "original");
    assert_eq!(names(dir.path()), ["existe.json"]);
}

#[test]
fn survives_many_simultaneous_writes_to_one_file() {
    // On NTFS a second rename onto a destination being swapped fails with a permission error; without
    // the retry roughly one save in three was lost (measured on 0.5.0).
    let dir = tempdir();
    let path = dir.path().join("prefs.json");
    let contents: Vec<String> = (0..12).map(|i| format!("contenu-{i}").chars().chain(std::iter::repeat('x')).take(4_000).collect()).collect();
    let handles: Vec<_> = contents
        .iter()
        .cloned()
        .map(|c| {
            let p = path.clone();
            std::thread::spawn(move || atomic_write(&p, c).unwrap())
        })
        .collect();
    handles.into_iter().for_each(|h| h.join().unwrap());
    assert!(contents.contains(&fs::read_to_string(&path).unwrap()));
    assert_eq!(names(dir.path()), ["prefs.json"]);
}

#[test]
fn serialise_json_is_two_space_indent_with_trailing_newline() {
    assert_eq!(serialise_json(&serde_json::json!({ "a": 1 })), "{\n  \"a\": 1\n}\n");
}

#[test]
fn the_lock_serialises_two_critical_sections() {
    let dir = tempdir();
    let path = dir.path().join("prefs.json");
    let trace = Arc::new(Mutex::new(Vec::<String>::new()));
    let handles: Vec<_> = ["a", "b"]
        .into_iter()
        .map(|name| {
            let (p, t) = (path.clone(), trace.clone());
            std::thread::spawn(move || {
                with_file_lock(&p, || {
                    t.lock().unwrap().push(format!("{name}:entre"));
                    std::thread::sleep(Duration::from_millis(30));
                    t.lock().unwrap().push(format!("{name}:sort"));
                })
            })
        })
        .collect();
    handles.into_iter().for_each(|h| h.join().unwrap());
    let trace = trace.lock().unwrap();
    assert_eq!(trace.len(), 4);
    assert_eq!(trace[1], format!("{}:sort", trace[0].split(':').next().unwrap()));
}

#[test]
fn the_lock_is_removed_on_exit_even_when_the_work_panics() {
    let dir = tempdir();
    let path = dir.path().join("prefs.json");
    let p = path.clone();
    let result = std::panic::catch_unwind(move || with_file_lock(&p, || panic!("boum")));
    assert!(result.is_err());
    assert!(!dir.path().join("prefs.json.lock").exists());
}

#[test]
fn a_stale_lock_is_stolen_instead_of_blocking_forever() {
    // An instance killed mid-write leaves its lock behind; without stealing, no preference would ever be saved again.
    let dir = tempdir();
    let path = dir.path().join("prefs.json");
    let lock = dir.path().join("prefs.json.lock");
    let file = fs::File::create(&lock).unwrap();
    file.set_modified(SystemTime::now() - Duration::from_secs(60)).unwrap();
    drop(file);
    let started = Instant::now();
    with_file_lock(&path, || ());
    assert!(started.elapsed() < Duration::from_millis(1_500));
    assert!(!lock.exists());
}

#[test]
fn the_work_still_runs_if_the_lock_is_never_released() {
    // A preferences save must never be the reason a quit hangs: past the timeout, write unlocked.
    let dir = tempdir();
    let path = dir.path().join("prefs.json");
    let mut done = false;
    with_file_lock(&path, || with_file_lock(&path, || done = true));
    assert!(done);
}
