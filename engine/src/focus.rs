//! Which program is in front: the game, the overlay app itself, or anything
//! else. The app hides its overlays while it is anything else (an alt-tab to
//! Discord) and shows them again when the game comes back.
//!
//! The game is recognised as A2Tools DPS Meter does it (Windows only; elsewhere
//! nothing is reported and the app never hides):
//! Copied from A2Tools DPS Meter (GPL-3.0), https://github.com/taengu/A2Tools-DPS-Meter
//! src-tauri/src/platform/win32/window_detector.rs at 08b249d49ef18be9ac9b41d8dd35596ae99aacfd
//! (`is_game_title`, `is_game_exe`, `window_title`, `exe_path`, `is_aion2_foreground`).

use std::time::Duration;

use serde_json::json;

use crate::{emit, event};

const POLL: Duration = Duration::from_millis(250);

// Off Windows nothing is in front to tell apart.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Foreground {
    Game,
    /// One of the overlay app's own windows (the panel, clicked into).
    App,
    Other,
}

/// Report the foreground as it changes: `{"type": "focus", "game": bool, "app": bool}`.
/// `app_pid` is the overlay app's process, whose windows count as its own.
pub fn watch(app_pid: Option<u32>) {
    if !SUPPORTED {
        return;
    }
    std::thread::spawn(move || {
        let mut last = None;
        loop {
            // No window in front (mid alt-tab, the lock screen) changes nothing:
            // upstream's `front_is_ours_or_game` counts it as the game's too.
            let Some(now) = foreground(app_pid) else {
                std::thread::sleep(POLL);
                continue;
            };
            if Some(now) != last {
                last = Some(now);
                emit(&event("focus", json!({ "game": now == Foreground::Game, "app": now == Foreground::App })));
            }
            std::thread::sleep(POLL);
        }
    });
}

#[cfg(not(windows))]
const SUPPORTED: bool = false;

#[cfg(not(windows))]
fn foreground(_app_pid: Option<u32>) -> Option<Foreground> {
    None
}

#[cfg(windows)]
const SUPPORTED: bool = true;

/// The window in front, or None when there is none.
#[cfg(windows)]
fn foreground(app_pid: Option<u32>) -> Option<Foreground> {
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return None;
    }
    let mut pid: u32 = 0;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if app_pid.is_some_and(|app| app == pid) {
        return Some(Foreground::App);
    }
    let game = win::is_game_title(&win::window_title(hwnd)) || win::exe_path(pid).is_some_and(|p| win::is_game_exe(&p));
    Some(if game { Foreground::Game } else { Foreground::Other })
}

#[cfg(windows)]
mod win {
    use windows::Win32::Foundation::{CloseHandle, HWND};
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetWindowTextW;

    pub fn is_game_title(title: &str) -> bool {
        title.starts_with("AION2")
    }

    pub fn is_game_exe(path: &str) -> bool {
        path.rsplit(['\\', '/']).next().is_some_and(|name| name.eq_ignore_ascii_case("AION2.exe"))
    }

    pub fn window_title(hwnd: HWND) -> String {
        let mut buf = [0u16; 256];
        let len = unsafe { GetWindowTextW(hwnd, &mut buf) } as usize;
        String::from_utf16_lossy(&buf[..len])
    }

    /// The full path of process `pid`'s program. Needs no elevation for the
    /// player's own processes.
    pub fn exe_path(pid: u32) -> Option<String> {
        if pid == 0 {
            return None;
        }
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 512];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_FORMAT(0), windows::core::PWSTR(buf.as_mut_ptr()), &mut len)
                .is_ok();
            let _ = CloseHandle(handle);
            ok.then(|| String::from_utf16_lossy(&buf[..len as usize]))
        }
    }
}
