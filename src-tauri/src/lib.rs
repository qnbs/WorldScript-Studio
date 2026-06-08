mod commands;
mod lora;
mod pandoc;

use tauri::Emitter;

#[cfg(desktop)]
fn install_app_menu(app: &tauri::App) -> tauri::Result<()> {
  use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

  let handle = app.handle();
  let file_menu = Submenu::with_items(
    handle,
    "File",
    true,
    &[
      &MenuItem::with_id(handle, "menu-export", "Export Project", true, None::<&str>)?,
      &MenuItem::with_id(handle, "menu-settings", "Settings", true, None::<&str>)?,
      &PredefinedMenuItem::separator(handle)?,
      &PredefinedMenuItem::quit(handle, None)?,
    ],
  )?;
  let help_menu = Submenu::with_items(
    handle,
    "Help",
    true,
    &[&MenuItem::with_id(handle, "menu-help", "Help Center", true, None::<&str>)?],
  )?;
  let menu = Menu::with_items(handle, &[&file_menu, &help_menu])?;
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
      commands::task_supervisor::storycraft_task_supervisor_ping,
      commands::task_supervisor::storycraft_task_supervisor_submit,
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
      let _ = app.emit("menu-action", id);
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
