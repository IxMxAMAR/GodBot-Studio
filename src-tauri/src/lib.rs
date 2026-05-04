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
            fs::list_dir_cmd,
            fs::read_file_cmd,
            fs::write_file_cmd,
            daemon::spawn_daemon,
            daemon::check_daemon_health,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<DaemonState>() {
                    daemon::kill_daemon(&state);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
