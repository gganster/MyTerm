//! Machine load: CPU and RAM, the two numbers a developer glances at before a build. Port of
//! `shared/system-load.ts` and `load-monitor.ts`.

/// Cumulative tick counters, shaped like Node's `os.cpus()[i].times`.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CpuTimes {
    pub user: f64,
    pub nice: f64,
    pub sys: f64,
    pub idle: f64,
    pub irq: f64,
}

impl CpuTimes {
    fn total(&self) -> f64 {
        self.user + self.nice + self.sys + self.idle + self.irq
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SystemLoad {
    /// Machine-wide CPU busy percentage. `None` until two samples exist.
    pub cpu: Option<i64>,
    pub memory_used: f64,
    pub memory_total: f64,
}

/// `Math.round`: halves go up.
fn round_js(v: f64) -> f64 {
    (v + 0.5).floor()
}

/// CPU busy percentage between two samples. A rate only exists between two readings, so the first
/// tick is `None`; so are unusable samples (zero-length interval, changed core count).
pub fn cpu_busy_percent(previous: Option<&[CpuTimes]>, current: &[CpuTimes]) -> Option<i64> {
    let previous = previous.filter(|p| !p.is_empty() && p.len() == current.len())?;
    let (mut busy, mut total) = (0.0, 0.0);
    for (before, after) in previous.iter().zip(current) {
        let elapsed = after.total() - before.total();
        // Counters only climb: a negative delta means the sample is bogus.
        if elapsed <= 0.0 {
            continue;
        }
        total += elapsed;
        busy += elapsed - (after.idle - before.idle);
    }
    if total <= 0.0 {
        return None;
    }
    Some(round_js(busy / total * 100.0).clamp(0.0, 100.0) as i64)
}

/// Share of physical memory in use, 0-100.
pub fn memory_percent(used: f64, total: f64) -> Option<i64> {
    if !used.is_finite() || !total.is_finite() || total <= 0.0 {
        return None;
    }
    Some(round_js(used / total * 100.0).clamp(0.0, 100.0) as i64)
}

/// Bytes as gibibytes with one decimal, the unit Windows itself reports.
pub fn format_gib(bytes: f64) -> String {
    if !bytes.is_finite() || bytes < 0.0 {
        return "—".into();
    }
    format!("{:.1} Gio", bytes / 1024f64.powi(3))
}

/// Takes a sample every call and remembers the previous one.
#[derive(Default)]
pub struct Sampler {
    previous: Option<Vec<CpuTimes>>,
}

impl Sampler {
    pub fn sample(&mut self) -> SystemLoad {
        let current: Vec<CpuTimes> = system_cpu_times().into_iter().collect();
        let cpu = cpu_busy_percent(self.previous.as_deref(), &current);
        self.previous = Some(current);
        let (used, total) = memory();
        SystemLoad { cpu, memory_used: used, memory_total: total }
    }
}

/// One machine-wide entry (`GetSystemTimes`) instead of one per core: the busy share over all
/// cores is the same number. Kernel time includes idle, as `os.cpus()` reports it separately.
#[cfg(windows)]
fn system_cpu_times() -> Option<CpuTimes> {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::GetSystemTimes;
    let (mut idle, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
    unsafe { GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)) }.ok()?;
    let ticks = |f: FILETIME| ((f.dwHighDateTime as u64) << 32 | f.dwLowDateTime as u64) as f64;
    Some(CpuTimes { user: ticks(user), nice: 0.0, sys: ticks(kernel) - ticks(idle), idle: ticks(idle), irq: 0.0 })
}

#[cfg(not(windows))]
fn system_cpu_times() -> Option<CpuTimes> {
    None
}

/// (used, total) physical memory in bytes, `total - available` like Node's `totalmem() - freemem()`.
#[cfg(windows)]
fn memory() -> (f64, f64) {
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut status = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
    if unsafe { GlobalMemoryStatusEx(&mut status) }.is_err() {
        return (0.0, 0.0);
    }
    let total = status.ullTotalPhys as f64;
    (total - status.ullAvailPhys as f64, total)
}

#[cfg(not(windows))]
fn memory() -> (f64, f64) {
    (0.0, 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_sample_has_no_rate_and_a_real_machine_reports_memory() {
        let mut s = Sampler::default();
        let first = s.sample();
        assert_eq!(first.cpu, None);
        assert!(first.memory_total > 0.0 && first.memory_used > 0.0 && first.memory_used <= first.memory_total);
        std::thread::sleep(std::time::Duration::from_millis(300));
        let second = s.sample();
        assert!(second.cpu.is_some_and(|c| (0..=100).contains(&c)));
    }
}
