mod fs;
mod daemon;

use daemon::DaemonState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(DaemonState::new())
        .invoke_handler(tauri::generate_handler![
            fs::list_dir,
            fs::read_file,
            fs::write_file,
            daemon::spawn_daemon,
            daemon::check_daemon_health,
        ])
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed => {
                if let Some(state) = window.app_handle().try_state::<DaemonState>() {
                    daemon::kill_daemon(&state);
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
