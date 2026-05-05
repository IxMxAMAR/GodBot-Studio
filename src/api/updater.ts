/**
 * Thin wrapper around `@tauri-apps/plugin-updater`.
 *
 * `checkForUpdate()` is the only entry point used at startup. It:
 *   1. Calls `check()`, which hits the configured `plugins.updater.endpoints`
 *      (see `src-tauri/tauri.conf.json`) and returns an `Update` handle when
 *      one is available, or `null` when the app is current.
 *   2. Catches every error path — missing endpoint, no signing pubkey, IPC
 *      not available (running under `vite dev` rather than `tauri dev`),
 *      transient HTTP failure — and returns `{available: false, error}` so
 *      callers don't have to reason about the plugin's failure modes.
 *
 * We intentionally do NOT auto-download or auto-install. The dispatch
 * is "non-blocking toast → user restarts when convenient", so the
 * caller (App.tsx) renders a banner with the version and lets the
 * actual install happen at the user's next launch.
 */

export interface UpdateInfo {
  available: boolean;
  version?: string;
  notes?: string | null;
  error?: string;
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  try {
    // Lazy-import so the Vite dev server (which doesn't have the Tauri
    // shim loaded) doesn't blow up when the module evaluates.
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) {
      return { available: false };
    }
    return {
      available: true,
      version: update.version,
      notes: update.body ?? null,
    };
  } catch (e: any) {
    // Common cases here:
    // - "no updater pubkey" (haven't set up signing yet — expected pre-1.0)
    // - "Failed to fetch" (offline / endpoint not reachable)
    // - "window.__TAURI_INTERNALS__ is undefined" (running under `vite dev`)
    return { available: false, error: String(e?.message ?? e) };
  }
}
