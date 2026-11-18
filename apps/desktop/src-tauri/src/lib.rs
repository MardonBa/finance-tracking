//! Native side of the desktop app (§2, §3): Touch ID, the Keychain-held app
//! credential (readable only while unlocked), the 72h relock, the
//! `financetracker://` deep link and Google sign-in.
//!
//! Frontend contract (see apps/desktop/src/native/bridge.ts):
//! commands `authenticate`, `unlock`, `get_credential`, `has_credential`,
//! `lock_status`, `lock`, `sign_in_with_google`, `sign_out`, `take_deep_links`;
//! events `app-locked` (relock fired) and `deep-link` (string[] of URLs).

mod native;
mod oauth;
mod pkce;
mod relock;

use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;

use relock::{LockState, RELOCK_AFTER_SECS, RELOCK_CHECK_INTERVAL_SECS};

#[derive(Default)]
struct Session {
    lock: Mutex<LockState>,
    pending_links: Mutex<Vec<String>>,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

async fn touch_id(reason: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native::authenticate(&reason))
        .await
        .map_err(|e| e.to_string())?
}

/// Touch ID (password fallback). Success unlocks the session for 72 hours.
#[tauri::command]
async fn authenticate(reason: String, session: State<'_, Session>) -> Result<(), String> {
    touch_id(reason).await?;
    session.lock.lock().unwrap().unlock(now_secs());
    Ok(())
}

/// Touch ID, then read the credential from the Keychain. `None` = no credential stored.
#[tauri::command]
async fn unlock(reason: String, session: State<'_, Session>) -> Result<Option<String>, String> {
    touch_id(reason).await?;
    session.lock.lock().unwrap().unlock(now_secs());
    native::read_credential()
}

/// The credential, but only while the session is unlocked (§2: read only after Touch ID).
#[tauri::command]
fn get_credential(session: State<'_, Session>) -> Result<Option<String>, String> {
    if !session.lock.lock().unwrap().is_unlocked(now_secs()) {
        return Err("locked".into());
    }
    native::read_credential()
}

/// Whether a credential exists, without reading its value.
#[tauri::command]
fn has_credential() -> bool {
    native::has_credential()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LockStatus {
    unlocked: bool,
    remaining_secs: u64,
    relock_after_secs: u64,
}

#[tauri::command]
fn lock_status(session: State<'_, Session>) -> LockStatus {
    let s = session.lock.lock().unwrap();
    let now = now_secs();
    LockStatus { unlocked: s.is_unlocked(now), remaining_secs: s.remaining_secs(now), relock_after_secs: RELOCK_AFTER_SECS }
}

#[tauri::command]
fn lock(session: State<'_, Session>) {
    session.lock.lock().unwrap().lock();
}

/// Google sign-in in the system browser, then `POST /auth/google`; the
/// returned credential goes straight into the Keychain (never returned here).
#[tauri::command]
async fn sign_in_with_google(app: AppHandle, api_url: String) -> Result<(), String> {
    let opener = app.clone();
    let cred = oauth::sign_in(&api_url, move |url| {
        opener.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
    })
    .await?;
    native::write_credential(&cred.token)?;
    // Bring the app back in front of the browser.
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_focus();
    }
    Ok(())
}

/// Forget the credential (after a 401 or revoke) and lock.
#[tauri::command]
fn sign_out(session: State<'_, Session>) -> Result<(), String> {
    session.lock.lock().unwrap().lock();
    native::delete_credential()
}

/// Deep links that arrived before the frontend was listening.
#[tauri::command]
fn take_deep_links(session: State<'_, Session>) -> Vec<String> {
    std::mem::take(&mut *session.pending_links.lock().unwrap())
}

fn forward_links(app: &AppHandle, urls: Vec<String>) {
    if urls.is_empty() {
        return;
    }
    app.state::<Session>().pending_links.lock().unwrap().extend(urls.iter().cloned());
    let _ = app.emit("deep-link", urls);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_focus();
    }
}

/// The app menu. Replaces Tauri's default macOS menu, whose "Close Window"
/// (⌘W) and window-cycling (⌘`) items would act on the native window; the
/// in-app window manager owns those shortcuts (§14). Edit keeps copy/paste
/// working in text fields.
fn app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let app_items = Submenu::with_items(
        app,
        "Finance Tracker",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view = Submenu::with_items(app, "View", true, &[&PredefinedMenuItem::fullscreen(app, None)?])?;
    Menu::with_items(app, &[&app_items, &edit, &view])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(Session::default())
        .setup(|app| {
            let handle = app.handle().clone();
            app.set_menu(app_menu(&handle)?)?;
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                forward_links(&handle, urls.into_iter().map(|u| u.to_string()).collect());
            }
            let h = handle.clone();
            app.deep_link().on_open_url(move |event| {
                forward_links(&h, event.urls().into_iter().map(|u| u.to_string()).collect());
            });
            // Relock watcher: when 72h pass, lock and tell the frontend once.
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(Duration::from_secs(RELOCK_CHECK_INTERVAL_SECS));
                    let expired = handle.state::<Session>().lock.lock().unwrap().expire_if_due(now_secs());
                    if expired {
                        let _ = handle.emit("app-locked", ());
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            authenticate,
            unlock,
            get_credential,
            has_credential,
            lock_status,
            lock,
            sign_in_with_google,
            sign_out,
            take_deep_links
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
