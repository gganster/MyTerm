//! Windows-only facts and fixes: the process environment before the first shell, the light/dark
//! choice, the taskbar identity of a window, local time.

/// A process started from an environment that ignores Ctrl+C (a parent called
/// `SetConsoleCtrlHandler(NULL, TRUE)`: some launchers, CI runners and IDE tool shells do) hands that
/// on to every shell it spawns, and Ctrl+C then does nothing in any pane. Measured: `npm run dev`
/// could not be interrupted under such a parent, while 0.5.0 (node-pty) could. Clearing the flag
/// makes the children see the default behaviour whoever launched MyTerm.
#[cfg(windows)]
pub fn restore_default_ctrl_c() {
    extern "system" {
        fn SetConsoleCtrlHandler(handler: Option<unsafe extern "system" fn(u32) -> i32>, add: i32) -> i32;
    }
    // SAFETY: a documented Win32 call with a null handler, which has no preconditions.
    unsafe {
        SetConsoleCtrlHandler(None, 0);
    }
}

#[cfg(not(windows))]
pub fn restore_default_ctrl_c() {}

/// Windows' own light/dark choice, for `theme: "system"`. Light when it cannot be read.
#[cfg(windows)]
pub fn system_prefers_dark() -> bool {
    extern "system" {
        fn RegGetValueW(hkey: isize, sub: *const u16, value: *const u16, flags: u32, ty: *mut u32, data: *mut u8, len: *mut u32) -> i32;
    }
    const HKEY_CURRENT_USER: isize = 0x8000_0001u32 as i32 as isize;
    const RRF_RT_REG_DWORD: u32 = 0x10;
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let (sub, value) = (wide(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"), wide("AppsUseLightTheme"));
    let (mut data, mut len) = (1u32, 4u32);
    // SAFETY: both strings are NUL-terminated and outlive the call; `data` is the 4 bytes a DWORD needs.
    let status = unsafe { RegGetValueW(HKEY_CURRENT_USER, sub.as_ptr(), value.as_ptr(), RRF_RT_REG_DWORD, std::ptr::null_mut(), &mut data as *mut u32 as *mut u8, &mut len) };
    status == 0 && data == 0
}

#[cfg(not(windows))]
pub fn system_prefers_dark() -> bool {
    false
}

/// The id the whole process groups its windows under. Must run before the first window: a window
/// without an id of its own takes the process's.
#[cfg(windows)]
pub fn set_process_app_id(id: &str) {
    use windows::core::HSTRING;
    let _ = unsafe { windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(id)) };
}

#[cfg(not(windows))]
pub fn set_process_app_id(_id: &str) {}

/// Gives one window its own taskbar identity (what Electron's `setAppDetails({ appId })` does):
/// Windows draws one button per id, so a coloured instance has to leave the group to be seen.
#[cfg(windows)]
pub fn set_window_app_id(hwnd: isize, id: &str) -> windows::core::Result<()> {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PROPVARIANT};
    use windows::Win32::System::Variant::VT_LPWSTR;
    use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};
    use windows::Win32::UI::Shell::SHStrDupW;
    let store: IPropertyStore = unsafe { SHGetPropertyStoreForWindow(HWND(hwnd as *mut _)) }?;
    // A PROPVARIANT string owns a CoTaskMem copy; `PropVariantClear` frees it.
    let mut value = PROPVARIANT::default();
    unsafe {
        let inner = &mut *value.Anonymous.Anonymous;
        inner.vt = VT_LPWSTR;
        inner.Anonymous.pwszVal = SHStrDupW(&HSTRING::from(id))?;
        let result = store.SetValue(&APP_USER_MODEL_ID, &value).and_then(|()| store.Commit());
        let _ = PropVariantClear(&mut value);
        result
    }
}

#[cfg(windows)]
const APP_USER_MODEL_ID: windows::Win32::Foundation::PROPERTYKEY = windows::Win32::Foundation::PROPERTYKEY {
    fmtid: windows::core::GUID::from_u128(0x9F4C2855_9F79_4B39_A8D0_E1D42DE1D5F3),
    pid: 5,
};

#[cfg(not(windows))]
pub fn set_window_app_id(_hwnd: isize, _id: &str) -> Result<(), ()> {
    Ok(())
}

/// `2026-10-17T12:03:04.123Z` as the user's local `17/10/2026 14:03` (what `Intl` gives fr-FR, short).
/// Empty when the stamp does not parse.
pub fn format_local_short(iso: &str) -> String {
    let Some(parsed) = parse_iso(iso) else { return String::new() };
    let (y, mo, d, h, mi) = to_local(parsed);
    format!("{d:02}/{mo:02}/{y:04} {h:02}:{mi:02}")
}

type Stamp = (u16, u16, u16, u16, u16);

fn parse_iso(iso: &str) -> Option<Stamp> {
    let num = |range: std::ops::Range<usize>| iso.get(range)?.parse::<u16>().ok();
    let ok = iso.len() >= 16 && iso.as_bytes()[4] == b'-' && iso.as_bytes()[10] == b'T';
    ok.then_some(())?;
    Some((num(0..4)?, num(5..7)?, num(8..10)?, num(11..13)?, num(14..16)?))
}

#[cfg(windows)]
fn to_local((y, mo, d, h, mi): Stamp) -> Stamp {
    use windows::Win32::Foundation::SYSTEMTIME;
    use windows::Win32::System::Time::SystemTimeToTzSpecificLocalTime;
    let utc = SYSTEMTIME { wYear: y, wMonth: mo, wDayOfWeek: 0, wDay: d, wHour: h, wMinute: mi, wSecond: 0, wMilliseconds: 0 };
    let mut local = SYSTEMTIME::default();
    match unsafe { SystemTimeToTzSpecificLocalTime(None, &utc, &mut local) } {
        Ok(()) => (local.wYear, local.wMonth, local.wDay, local.wHour, local.wMinute),
        Err(_) => (y, mo, d, h, mi),
    }
}

#[cfg(not(windows))]
fn to_local(stamp: Stamp) -> Stamp {
    stamp
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stamp_is_shown_day_first_and_garbage_is_shown_as_nothing() {
        let shown = format_local_short("2026-10-17T12:03:04.123Z");
        assert!(shown.starts_with("17/10/2026 ") || shown.starts_with("16/10/2026 ") || shown.starts_with("18/10/2026 "), "{shown}");
        assert_eq!(shown.len(), 16);
        assert_eq!(format_local_short("hier"), "");
    }

    /// The identity really lands on the window: written through the shell's property store, read back.
    #[cfg(windows)]
    #[test]
    fn a_window_takes_the_taskbar_id_it_is_given() {
        use windows::core::w;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};
        use windows::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, WINDOW_STYLE, WS_EX_NOACTIVATE};
        let hwnd = unsafe { CreateWindowExW(WS_EX_NOACTIVATE, w!("STATIC"), w!("t"), WINDOW_STYLE(0), 0, 0, 10, 10, None, None, None, None) }.unwrap();
        set_window_app_id(hwnd.0 as isize, "dev.gganster.myterm.red").unwrap();
        let store: IPropertyStore = unsafe { SHGetPropertyStoreForWindow(HWND(hwnd.0)) }.unwrap();
        let value = unsafe { store.GetValue(&APP_USER_MODEL_ID) }.unwrap();
        let got = unsafe { windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc(&value) }.unwrap();
        assert_eq!(unsafe { got.to_string() }.unwrap(), "dev.gganster.myterm.red");
        unsafe { DestroyWindow(hwnd) }.unwrap();
    }
}
