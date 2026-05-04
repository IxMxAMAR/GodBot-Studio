use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
}

const SKIP: &[&str] = &[
    "node_modules", ".git", "__pycache__", ".venv", "venv",
    "target", "dist", "build", ".pytest_cache",
];

/// Cap on files returned by `walk_workspace_cmd`. Beyond this we silently
/// stop walking — the @-mention picker only ever shows the top 50 ranked
/// hits anyway, and a runaway walk on a huge tree blocks the UI thread.
const MAX_WALK_FILES: usize = 5000;

#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<FileEntry>, String> {
    let p = PathBuf::from(&path);
    let mut out = Vec::new();
    let entries = fs::read_dir(&p).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if SKIP.contains(&name.as_str()) { continue; }
        if name.starts_with('.') && name.len() > 1 { continue; }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        out.push(FileEntry {
            name: name.clone(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir: meta.is_dir(),
        });
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = PathBuf::from(&path).parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct WalkEntry {
    /// POSIX-style path relative to the workspace root (forward slashes,
    /// no leading slash). Used as the display + insert text for the
    /// @-mention picker.
    pub rel: String,
    /// Absolute path — handy if a future caller wants to open the file.
    pub abs: String,
}

fn walk_into(root: &Path, dir: &Path, out: &mut Vec<WalkEntry>) {
    if out.len() >= MAX_WALK_FILES {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if out.len() >= MAX_WALK_FILES {
            return;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if SKIP.contains(&name.as_str()) {
            continue;
        }
        // Hide dot-dirs / dot-files (matches list_dir behaviour). `.git`,
        // `.venv` etc are already in SKIP; this catches `.idea`, `.vscode`,
        // `.DS_Store`, etc.
        if name.starts_with('.') && name.len() > 1 {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let path = entry.path();
        if meta.is_dir() {
            walk_into(root, &path, out);
        } else if meta.is_file() {
            // Build a POSIX-style relative path. Falls back to the file
            // name if the path is somehow not under root.
            let rel = path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| name.clone());
            out.push(WalkEntry {
                rel,
                abs: path.to_string_lossy().to_string(),
            });
        }
    }
}

/// Recursively walk a workspace, returning every file (capped at
/// MAX_WALK_FILES) with workspace-relative POSIX paths. The @-mention
/// picker fuzzy-matches against the `rel` field.
#[tauri::command]
pub fn walk_workspace(path: String) -> Result<Vec<WalkEntry>, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("not a directory: {}", path));
    }
    let mut out = Vec::new();
    walk_into(&root, &root, &mut out);
    out.sort_by(|a, b| a.rel.to_lowercase().cmp(&b.rel.to_lowercase()));
    Ok(out)
}

#[derive(Serialize)]
pub struct SessionEntry {
    pub sid: String,
    pub started_at: String,
    /// The legacy "model" field. Older sessions wrote this; newer
    /// sessions populate `provider`/`model_name` separately.
    pub model: String,
    pub provider: String,
    pub model_name: String,
    /// First 80 chars of the most recent user message in events.jsonl.
    /// Empty if the session never received a turn.
    pub last_user_msg_preview: String,
}

fn read_meta(sdir: &Path) -> Option<serde_json::Value> {
    let raw = fs::read_to_string(sdir.join("meta.json")).ok()?;
    serde_json::from_str(&raw).ok()
}

fn read_last_user_msg(sdir: &Path) -> String {
    let path = sdir.join("events.jsonl");
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return String::new(),
    };
    let mut last = String::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if v.get("type").and_then(|t| t.as_str()) == Some("user") {
            if let Some(c) = v.get("content").and_then(|c| c.as_str()) {
                last = c.to_string();
            }
        }
    }
    // Truncate + strip newlines for a single-line preview.
    let collapsed: String = last.chars().map(|c| if c == '\n' || c == '\r' { ' ' } else { c }).collect();
    if collapsed.chars().count() > 80 {
        collapsed.chars().take(80).collect::<String>() + "…"
    } else {
        collapsed
    }
}

/// List sessions stored under `<workspace>/.godbot-sessions/`. Returns a
/// list sorted newest-first by started_at. Each entry is a parsed view
/// of the session's `meta.json` plus a 1-line preview of the last user
/// message from `events.jsonl`. The daemon owns the canonical reader
/// (`Session.load`), but reading from Rust avoids a daemon round-trip
/// for what's effectively a directory scan.
#[tauri::command]
pub fn list_sessions(sessions_root: String) -> Result<Vec<SessionEntry>, String> {
    let root = PathBuf::from(&sessions_root);
    if !root.exists() {
        return Ok(Vec::new());
    }
    if !root.is_dir() {
        return Err(format!("not a directory: {}", sessions_root));
    }
    let mut out = Vec::new();
    let entries = fs::read_dir(&root).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let sdir = entry.path();
        if !sdir.is_dir() {
            continue;
        }
        let sid = entry.file_name().to_string_lossy().to_string();
        let meta = match read_meta(&sdir) {
            Some(m) => m,
            None => continue,
        };
        let started_at = meta.get("started_at").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let model = meta.get("model").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let provider = meta.get("provider").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let model_name = meta
            .get("model_name").and_then(|v| v.as_str())
            .unwrap_or(&model)
            .to_string();
        let preview = read_last_user_msg(&sdir);
        out.push(SessionEntry {
            sid,
            started_at,
            model,
            provider,
            model_name,
            last_user_msg_preview: preview,
        });
    }
    // Newest first.
    out.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(out)
}

#[derive(Serialize)]
pub struct PythonValidation {
    pub ok: bool,
    pub version: String,
    pub error: Option<String>,
}

/// Run `<path> --version` to confirm the Python interpreter is callable
/// and report its version string. Used by the Settings panel to
/// validate the python_path field before the user saves it.
#[tauri::command]
pub fn validate_python(path: String) -> PythonValidation {
    if path.trim().is_empty() {
        return PythonValidation { ok: false, version: String::new(), error: Some("empty path".into()) };
    }
    let p = PathBuf::from(&path);
    if !p.exists() {
        return PythonValidation { ok: false, version: String::new(), error: Some(format!("not found: {}", path)) };
    }
    let mut cmd = Command::new(&p);
    cmd.arg("--version");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    match cmd.output() {
        Ok(o) if o.status.success() => {
            // Python prints to stdout (3.4+) — older versions used stderr.
            let mut combined = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if combined.is_empty() {
                combined = String::from_utf8_lossy(&o.stderr).trim().to_string();
            }
            PythonValidation { ok: true, version: combined, error: None }
        }
        Ok(o) => {
            let err = String::from_utf8_lossy(&o.stderr).trim().to_string();
            PythonValidation { ok: false, version: String::new(), error: Some(err) }
        }
        Err(e) => PythonValidation { ok: false, version: String::new(), error: Some(e.to_string()) },
    }
}

/// Permanently delete a session directory under sessions_root. The
/// caller is responsible for confirming with the user; we just recurse.
#[tauri::command]
pub fn delete_session(sessions_root: String, sid: String) -> Result<(), String> {
    // Refuse anything with a path separator in `sid` to keep this from
    // escaping the sessions root.
    if sid.contains('/') || sid.contains('\\') || sid.contains("..") || sid.is_empty() {
        return Err(format!("invalid session id: {}", sid));
    }
    let root = PathBuf::from(&sessions_root);
    let sdir = root.join(&sid);
    if !sdir.exists() {
        return Ok(());
    }
    if !sdir.is_dir() {
        return Err(format!("not a directory: {}", sdir.display()));
    }
    fs::remove_dir_all(&sdir).map_err(|e| e.to_string())
}
