// Read-only against GitHub: what the updater of a 0.5.0 would find on the real release channel.
fn main() {
    let dir = std::env::temp_dir().join("MyTerm-update-probe");
    let ready = myterm::updater::check_once("0.5.0", &myterm::updater::Source::github(), &dir);
    println!("from 0.5.0: {ready:?}");
    println!("from 0.6.0: {:?}", myterm::updater::check_once("0.6.0", &myterm::updater::Source::github(), &dir));
    let _ = std::fs::remove_dir_all(dir);
}
