// The icon of myterm.exe itself: Explorer, the Start menu, the context-menu entries and the pinned taskbar button all read it from the file.
fn main() {
    #[cfg(windows)]
    embed_resource::compile("installer/myterm.rc", embed_resource::NONE).manifest_optional().unwrap();
}
