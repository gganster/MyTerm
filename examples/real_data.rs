//! Reads the real `%APPDATA%\MyTerm\preferences.json` and the real `.myterm.json` of every trusted
//! project, and checks the approvals 0.5.0 stored are still recognised (T02, AC3/AC14).
//! Read-only. Run: `cargo run --example real_data`.

use myterm::atomic::serialise_json;
use myterm::path_key::Platform;
use myterm::schema::prefs::parse_preferences;
use myterm::trust::{commands_hash, commands_of};
use myterm::workspace::{read_layout, resolve_panes};
use std::path::Path;

fn main() {
    let file = Path::new(&std::env::var("APPDATA").unwrap()).join("MyTerm").join("preferences.json");
    let text = std::fs::read_to_string(&file).expect("preferences.json");
    let prefs = parse_preferences(&serde_json::from_str(&text).unwrap()).expect("0.5.0 preferences must parse");
    println!(
        "preferences.json: {} recents, {} trusted, byte-identical on re-serialisation: {}",
        prefs.recent_projects.len(),
        prefs.trusted_projects.len(),
        serialise_json(&prefs) == text
    );
    assert_eq!(Platform::host(), Platform::Win32);

    for t in &prefs.trusted_projects {
        let root = Path::new(&t.path);
        let status = match read_layout(root) {
            Err(e) => format!("layout not readable now ({})", e.kind()),
            Ok(layout) => {
                let panes = resolve_panes(&t.path, &layout).panes;
                if commands_of(&panes).is_empty() {
                    "no command to approve".to_string()
                } else if commands_hash(&panes) == t.commands_hash {
                    "APPROVAL RECOGNISED".to_string()
                } else {
                    "hash differs".to_string()
                }
            }
        };
        println!("  {:<55} {}", t.path, status);
    }
}
