mod commands;
mod durable_fs;
mod lora;
mod pandoc;

use tauri::Emitter;

#[cfg(desktop)]
fn build_file_menu<R: tauri::Runtime>(
  handle: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::menu::Submenu<R>> {
  use tauri::menu::{MenuItem, PredefinedMenuItem, Submenu};
  Submenu::with_items(
    handle,
    "File",
    true,
    &[
      &MenuItem::with_id(handle, "menu-export", "Export Project", true, None::<&str>)?,
      &MenuItem::with_id(handle, "menu-settings", "Settings", true, None::<&str>)?,
      &PredefinedMenuItem::separator(handle)?,
      &PredefinedMenuItem::quit(handle, None)?,
    ],
  )
}

// QNBS-v3 (D4): standard Edit menu via predefined items — the OS routes these to the focused
// WebView (text fields + the editor's contenteditable) automatically, so no frontend wiring or
// event emit is needed. Fills the desktop-affordance gap flagged as C-7 in DESKTOP-UI-AUDIT.md.
#[cfg(desktop)]
fn build_edit_menu<R: tauri::Runtime>(
  handle: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::menu::Submenu<R>> {
  use tauri::menu::{PredefinedMenuItem, Submenu};
  Submenu::with_items(
    handle,
    "Edit",
    true,
    &[
      &PredefinedMenuItem::undo(handle, None)?,
      &PredefinedMenuItem::redo(handle, None)?,
      &PredefinedMenuItem::separator(handle)?,
      &PredefinedMenuItem::cut(handle, None)?,
      &PredefinedMenuItem::copy(handle, None)?,
      &PredefinedMenuItem::paste(handle, None)?,
      &PredefinedMenuItem::select_all(handle, None)?,
    ],
  )
}

// QNBS-v3 (D4): View menu — custom "Command Palette" emits "menu-action" → the frontend maps it
// to the `global-open-command-palette` command (services/tauriMenuService.ts + App.tsx).
#[cfg(desktop)]
fn build_view_menu<R: tauri::Runtime>(
  handle: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::menu::Submenu<R>> {
  use tauri::menu::{MenuItem, Submenu};
  Submenu::with_items(
    handle,
    "View",
    true,
    // QNBS-v3: no native accelerator on this item. CmdOrCtrl+K is already a *toggle* in the web
    // shortcut layer; binding it here to the open-only menu command would shadow that toggle on
    // desktop (the key could open but never close the palette). The menu item still opens it on click.
    &[&MenuItem::with_id(
      handle,
      "menu-command-palette",
      "Command Palette",
      true,
      None::<&str>,
    )?],
  )
}

// QNBS-v3 (D4): Window menu via predefined items — OS-native window controls, no wiring needed.
#[cfg(desktop)]
fn build_window_menu<R: tauri::Runtime>(
  handle: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::menu::Submenu<R>> {
  use tauri::menu::{PredefinedMenuItem, Submenu};
  Submenu::with_items(
    handle,
    "Window",
    true,
    &[
      &PredefinedMenuItem::minimize(handle, None)?,
      &PredefinedMenuItem::maximize(handle, None)?,
      &PredefinedMenuItem::separator(handle)?,
      &PredefinedMenuItem::fullscreen(handle, None)?,
      &PredefinedMenuItem::close_window(handle, None)?,
    ],
  )
}

#[cfg(desktop)]
fn build_help_menu<R: tauri::Runtime>(
  handle: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::menu::Submenu<R>> {
  use tauri::menu::{MenuItem, Submenu};
  Submenu::with_items(
    handle,
    "Help",
    true,
    &[&MenuItem::with_id(handle, "menu-help", "Help Center", true, None::<&str>)?],
  )
}

// QNBS-v3: split into per-submenu builders (was one large function) to keep cyclomatic
// complexity low — DeepSource RS-R1000 flagged the monolithic version at 26 ("very-high" risk).
#[cfg(desktop)]
fn install_app_menu(app: &tauri::App) -> tauri::Result<()> {
  use tauri::menu::Menu;

  let handle = app.handle();
  let file_menu = build_file_menu(handle)?;
  let edit_menu = build_edit_menu(handle)?;
  let view_menu = build_view_menu(handle)?;
  let window_menu = build_window_menu(handle)?;
  let help_menu = build_help_menu(handle)?;
  let menu =
    Menu::with_items(handle, &[&file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])?;
  app.set_menu(menu)?;
  Ok(())
}

#[cfg(not(desktop))]
fn install_app_menu(_app: &tauri::App) -> tauri::Result<()> {
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // QNBS-v3: Single-instance plugin with deep-link feature handles file associations
    // The plugin automatically handles CLI args and emits "deep-link://new-url" event
    .plugin(tauri_plugin_single_instance::Builder::new().build())
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    // QNBS-v3 (T3): native OS notifications — permission request/gating lives entirely in JS
    // (services/desktop/desktopNotifications.ts); the Rust side only registers the plugin.
    .plugin(tauri_plugin_notification::init())
    // QNBS-v3 (#332/D3): exposes exit() to JS so tray/menu Quit can flush state before terminating.
    .plugin(tauri_plugin_process::init())
    .plugin(
      tauri_plugin_window_state::Builder::new()
        .with_state_flags(tauri_plugin_window_state::StateFlags::all())
        .build(),
    )
    .invoke_handler(tauri::generate_handler![
      pandoc::pandoc_markdown_to_epub,
      lora::train_lora,
      lora::merge_lora,
      lora::abort_lora_training,
      lora::generate_ollama_modelfile,
      lora::check_lora_environment,
      lora::set_lora_python_path,
      commands::task_supervisor::worldscript_task_supervisor_ping,
      commands::task_supervisor::worldscript_task_supervisor_submit,
      durable_fs::worldscript_atomic_write,
      durable_fs::worldscript_cleanup_atomic_temps,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      install_app_menu(app)?;
      Ok(())
    })
    .on_menu_event(|app, event| {
      let id = event.id().0.clone();
      // QNBS-v3 (#187): only forward the custom ids the frontend actually handles. The predefined
      // Edit/Window items (undo/redo/cut/copy/paste/select-all/minimize/…) are handled natively by the
      // OS; emitting them too would flood the JS bridge with high-frequency events during editing that
      // the frontend just ignores.
      if matches!(
        id.as_str(),
        "menu-export" | "menu-settings" | "menu-help" | "menu-command-palette"
      ) {
        let _ = app.emit("menu-action", id);
      }
    })
    // QNBS-v3: RunEvent handlers removed because tauri_plugin_single_instance
    // handles SecondInstance/Opened via "deep-link://new-url" events and
    // tauri::Builder no longer exposes .on_event() in Tauri v2.
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
