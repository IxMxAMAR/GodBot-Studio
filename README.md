# GodBot Studio

Standalone desktop IDE for collaborating with the [GodBot](https://github.com/IxMxAMAR/GodBot-Gemma) agent harness. Open a folder, browse files, edit in Monaco, chat with a local Gemma model via tool calls.

![screenshot — TODO add when ready]

## Stack

- Tauri 2 (Rust shell + WebView2)
- React 18 + TypeScript + Vite
- Monaco Editor (`@monaco-editor/react`)
- Zustand (state)
- GodBot daemon (Python sidecar, spawned on launch)

## Prereqs

1. Install [Rust](https://rustup.rs/) (1.75+)
2. Install Node.js 18+
3. Install [GodBot](https://github.com/IxMxAMAR/GodBot-Gemma) into a Python venv:
   ```bash
   git clone https://github.com/IxMxAMAR/GodBot-Gemma C:/GodBot
   cd C:/GodBot
   python -m venv .venv
   .venv\Scripts\pip install -e ".[dev]"
   ```
4. Have [LM Studio](https://lmstudio.ai/) running with a Gemma model loaded on `localhost:1234`

## Develop

```bash
git clone https://github.com/IxMxAMAR/GodBot-Studio
cd GodBot-Studio
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

Outputs `src-tauri/target/release/godbot-studio.exe` plus installers under `src-tauri/target/release/bundle/`.

## Configure

The default Python path used to spawn the GodBot daemon is defined in `src/api/config.ts` (`PYTHON_PATH`). Override it at runtime in the Settings panel, or edit the compile-time default if your GodBot venv lives elsewhere.

## What ships in v0.1.0 (Phase A)

- Custom title bar + dark theme
- Workspace folder picker
- File tree (collapsible, hides node_modules / .git / .venv)
- Tabbed Monaco editor with Ctrl+S save
- Chat panel with streaming, tool-call cards, gate widgets
- Daemon auto-spawn on folder open
- Status bar with daemon health

## Known issues (Phase A)

- File tree refresh after agent edits is best-effort — only the active workspace root is re-listed; nested folders that are currently expanded are not auto-refreshed (use the refresh button or collapse/re-expand).
- Monaco editor adds ~3 MB to the bundle (self-hosted; no CDN load required).

## Roadmap (Phase B)

- Integrated terminal
- Settings UI (daemon path, themes, keybindings)
- Quick file open (Ctrl+P with fuzzy search)
- Search across files
- Light theme
- Auto-update
- macOS / Linux builds
