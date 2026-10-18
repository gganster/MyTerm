//! A throwaway directory without a dependency (the toolchain is 1.75; recent `tempfile` needs newer).
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

pub struct TempDir(PathBuf);

static N: AtomicU32 = AtomicU32::new(0);

pub fn tempdir() -> TempDir {
    let p = std::env::temp_dir().join(format!("myterm-test-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
    std::fs::create_dir_all(&p).unwrap();
    TempDir(p)
}

impl TempDir {
    pub fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
