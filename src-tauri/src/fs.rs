use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

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
