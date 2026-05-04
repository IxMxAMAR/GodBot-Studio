use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct DaemonState {
    pub child: Mutex<Option<Child>>,
}

impl DaemonState {
    pub fn new() -> Self { Self { child: Mutex::new(None) } }
}

#[tauri::command]
pub async fn spawn_daemon(
    state: tauri::State<'_, DaemonState>,
    python_path: String,
    sessions_root: String,
    port: u16,
) -> Result<(), String> {
    // If we have a child handle, check if it's still alive.
    {
        let mut g = state.child.lock().map_err(|e| e.to_string())?;
        if let Some(child) = g.as_mut() {
            match child.try_wait() {
                Ok(None) => return Ok(()), // still alive
                _ => {
                    *g = None; // dead — fall through to respawn
                }
            }
        }
    }

    let mut cmd = Command::new(&python_path);
    cmd.args([
        "-m", "godbot.interfaces.web",
        "--port", &port.to_string(),
        "--sessions-root", &sessions_root,
    ]);
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd.spawn().map_err(|e| format!("spawn failed: {}", e))?;
    *state.child.lock().map_err(|e| e.to_string())? = Some(child);

    // Poll /api/health up to 30s.
    let url = format!("http://127.0.0.1:{}/api/health", port);
    let deadline = Instant::now() + Duration::from_secs(30);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;
    while Instant::now() < deadline {
        if let Ok(resp) = client.get(&url).send().await {
            if resp.status().is_success() {
                return Ok(());
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    Err(format!("daemon did not become ready within 30s on {}", url))
}

#[tauri::command]
pub fn check_daemon_health(port: u16) -> Result<bool, String> {
    let url = format!("http://127.0.0.1:{}/api/health", port);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;
    Ok(client.get(&url).send().map(|r| r.status().is_success()).unwrap_or(false))
}

pub fn kill_daemon(state: &DaemonState) {
    if let Ok(mut g) = state.child.lock() {
        if let Some(mut child) = g.take() {
            let _ = child.kill();
            // Bounded poll — never block the UI thread.
            for _ in 0..20 {
                match child.try_wait() {
                    Ok(Some(_)) => return,
                    _ => std::thread::sleep(std::time::Duration::from_millis(50)),
                }
            }
            // Give up; OS reaps when our process exits.
        }
    }
}
