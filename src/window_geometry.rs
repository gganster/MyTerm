//! Where a window opens. Port of `visibleBounds` and `cascaded` from `window.ts`.
//!
//! Saved coordinates can point at a monitor that has since been unplugged, and every instance restores
//! the same saved geometry: without the cascade the second `myterm .` opens pixel-perfectly over the
//! first and looks like nothing happened.

use crate::schema::prefs::WindowState;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bounds {
    pub width: f32,
    pub height: f32,
    pub at: Option<(f32, f32)>,
}

/// One title bar and a little more: enough to grab the window underneath.
const CASCADE_STEP: f32 = 32.0;
/// Past this many steps the cascade restarts rather than marching off-screen.
const CASCADE_WRAP: usize = 8;

/// Keeps a restored window on a display that currently exists.
pub fn visible_bounds(state: &WindowState, areas: &[Rect]) -> Bounds {
    let size = Bounds { width: state.width as f32, height: state.height as f32, at: None };
    let (Some(x), Some(y)) = (state.x, state.y) else { return size };
    let (x, y) = (x as f32, y as f32);
    let on_some = areas.iter().any(|a| x >= a.x - 40.0 && y >= a.y - 40.0 && x < a.x + a.width && y < a.y + a.height);
    if on_some { Bounds { at: Some((x, y)), ..size } } else { size }
}

/// Electron's `getDisplayNearestPoint`: the display holding the point, else the closest one.
fn nearest(areas: &[Rect], (px, py): (f32, f32)) -> Option<Rect> {
    let distance = |a: &Rect| {
        let dx = (a.x - px).max(0.0).max(px - (a.x + a.width));
        let dy = (a.y - py).max(0.0).max(py - (a.y + a.height));
        dx * dx + dy * dy
    };
    areas.iter().copied().min_by(|a, b| distance(a).total_cmp(&distance(b)))
}

/// Offsets a new window so it does not land on another instance, clamped back into the work area:
/// a cascade that pushes a window under the taskbar is worse than none.
pub fn cascaded(bounds: Bounds, other_instances: usize, areas: &[Rect]) -> Bounds {
    let step = other_instances % CASCADE_WRAP;
    let Some((x, y)) = bounds.at else { return bounds };
    if step == 0 {
        return bounds;
    }
    let Some(area) = nearest(areas, (x, y)) else { return bounds };
    let offset = step as f32 * CASCADE_STEP;
    let clamp = |v: f32, lo: f32, size: f32, extent: f32| (v + offset).min(lo.max(lo + extent - size));
    Bounds {
        at: Some((clamp(x, area.x, bounds.width, area.width), clamp(y, area.y, bounds.height, area.height))),
        ..bounds
    }
}

/// The work area (screen minus taskbar) of each display, in logical pixels like iced's positions.
/// ponytail: one scale factor for all (the system DPI); mixed-DPI setups can be off by the ratio.
#[cfg(windows)]
pub fn work_areas() -> Vec<Rect> {
    use windows::Win32::Foundation::{LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO};
    use windows::Win32::UI::HiDpi::GetDpiForSystem;
    use windows::core::BOOL;

    unsafe extern "system" fn each(monitor: HMONITOR, _: HDC, _: *mut RECT, out: LPARAM) -> BOOL {
        let list = unsafe { &mut *(out.0 as *mut Vec<RECT>) };
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
            list.push(info.rcWork);
        }
        true.into()
    }

    let mut raw: Vec<RECT> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(each), LPARAM(&mut raw as *mut _ as isize));
    }
    let scale = unsafe { GetDpiForSystem() } as f32 / 96.0;
    raw.iter()
        .map(|r| Rect {
            x: r.left as f32 / scale,
            y: r.top as f32 / scale,
            width: (r.right - r.left) as f32 / scale,
            height: (r.bottom - r.top) as f32 / scale,
        })
        .collect()
}

#[cfg(not(windows))]
pub fn work_areas() -> Vec<Rect> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Rect = Rect { x: 0.0, y: 0.0, width: 1920.0, height: 1040.0 };
    const BIG: Rect = Rect { x: 0.0, y: 0.0, width: 3840.0, height: 2000.0 };

    fn state(x: Option<i64>, y: Option<i64>) -> WindowState {
        WindowState { width: 1600, height: 1000, x, y, maximized: false }
    }

    #[test]
    fn no_saved_position_keeps_only_the_size() {
        let b = visible_bounds(&state(None, None), &[SCREEN]);
        assert_eq!((b.width, b.height, b.at), (1600.0, 1000.0, None));
    }

    #[test]
    fn a_position_on_a_display_is_kept_and_one_on_an_unplugged_monitor_is_dropped() {
        assert_eq!(visible_bounds(&state(Some(100), Some(50)), &[SCREEN]).at, Some((100.0, 50.0)));
        assert_eq!(visible_bounds(&state(Some(-40), Some(-40)), &[SCREEN]).at, Some((-40.0, -40.0)));
        assert_eq!(visible_bounds(&state(Some(2500), Some(50)), &[SCREEN]).at, None);
        assert_eq!(visible_bounds(&state(Some(-41), Some(0)), &[SCREEN]).at, None);
    }

    #[test]
    fn the_first_instance_is_not_offset_and_each_next_one_steps_by_32() {
        let b = visible_bounds(&state(Some(100), Some(50)), &[BIG]);
        assert_eq!(cascaded(b, 0, &[BIG]).at, Some((100.0, 50.0)));
        assert_eq!(cascaded(b, 1, &[BIG]).at, Some((132.0, 82.0)));
        assert_eq!(cascaded(b, 3, &[BIG]).at, Some((196.0, 146.0)));
    }

    #[test]
    fn the_cascade_wraps_after_eight_steps() {
        let b = visible_bounds(&state(Some(100), Some(50)), &[BIG]);
        assert_eq!(cascaded(b, 8, &[BIG]).at, Some((100.0, 50.0)));
        assert_eq!(cascaded(b, 9, &[BIG]).at, Some((132.0, 82.0)));
    }

    #[test]
    fn the_cascade_is_clamped_into_the_work_area() {
        // 1600x1000 on a 1920x1040 area leaves 320 and 40 of room.
        let b = visible_bounds(&state(Some(300), Some(30)), &[SCREEN]);
        assert_eq!(cascaded(b, 2, &[SCREEN]).at, Some((320.0, 40.0)));
    }

    #[test]
    fn without_a_position_there_is_nothing_to_cascade() {
        let b = visible_bounds(&state(None, None), &[SCREEN]);
        assert_eq!(cascaded(b, 3, &[SCREEN]), b);
    }
}
