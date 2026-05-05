# GodBot Studio — Release Runbook

End-to-end checklist for cutting a tagged release with a working
auto-updater. Everything below assumes you're on Windows; the macOS /
Linux paths are listed where they differ but otherwise mirror the same
flow.

## 0. One-time setup — generate the updater signing key

Tauri's updater verifies every downloaded artefact with an Ed25519
signature. The pubkey is baked into the app at build time
(`src-tauri/tauri.conf.json` → `plugins.updater.pubkey`); the privkey
must NEVER be checked in.

```powershell
# Generate a keypair. The password is optional but recommended.
npx tauri signer generate -w $HOME/.tauri/godbot.key
# → prints the pubkey on stdout. Copy it.
```

Then, in `src-tauri/tauri.conf.json`, paste the pubkey:

```jsonc
"plugins": {
  "updater": {
    "endpoints": ["https://github.com/IxMxAMAR/GodBot-Studio/releases/latest/download/latest.json"],
    "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbml…"
  }
}
```

Commit the pubkey change. The privkey path goes in env vars so the
build picks it up:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$HOME/.tauri/godbot.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<your-password>"  # omit if unset
```

## 1. Bump the version

Three files MUST stay in lock-step or the updater will silently keep
serving the old artefact. The release script is whatever you want it to
be — just don't forget any of these:

- `package.json` → `"version": "0.x.y"`
- `src-tauri/Cargo.toml` → `version = "0.x.y"` under `[package]`
- `src-tauri/tauri.conf.json` → `"version": "0.x.y"` (top-level)

After bumping, regenerate `Cargo.lock`:

```powershell
cd src-tauri
cargo update -p godbot-studio
cd ..
```

Commit with message `release: v0.x.y`.

## 2. Build the installers

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$HOME/.tauri/godbot.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password>"
npm run tauri:build
```

Outputs (under `src-tauri/target/release/bundle/`):

- `msi/GodBot Studio_0.x.y_x64_en-US.msi` + `.msi.sig`
- `nsis/GodBot Studio_0.x.y_x64-setup.exe` + `.exe.sig`
- (macOS) `dmg/…dmg` + `.dmg.tar.gz` + `.tar.gz.sig`
- (Linux) `appimage/…AppImage.tar.gz` + `.tar.gz.sig`

The `.sig` siblings are the updater signatures. They're tiny — paste
their contents into the `latest.json` manifest below.

## 3. Tag + push + publish on GitHub

```powershell
git tag v0.x.y
git push origin master --tags
```

Then `gh release create v0.x.y` (or via the web UI) and upload BOTH
the installer AND its `.sig` file as release assets. Naming doesn't
matter as long as the URL inside `latest.json` matches.

## 4. Write `latest.json`

This is the manifest the updater fetches from
`https://github.com/IxMxAMAR/GodBot-Studio/releases/latest/download/latest.json`.
It MUST be uploaded as a release asset on the same release.

```json
{
  "version": "0.x.y",
  "notes": "Short release notes the updater UI will show.",
  "pub_date": "2026-05-05T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contents of GodBot Studio_0.x.y_x64-setup.exe.sig>",
      "url": "https://github.com/IxMxAMAR/GodBot-Studio/releases/download/v0.x.y/GodBot.Studio_0.x.y_x64-setup.exe"
    },
    "darwin-x86_64": {
      "signature": "<contents of GodBot Studio_0.x.y_x64.dmg.tar.gz.sig>",
      "url": "https://github.com/IxMxAMAR/GodBot-Studio/releases/download/v0.x.y/GodBot.Studio_0.x.y_x64.dmg.tar.gz"
    },
    "linux-x86_64": {
      "signature": "<contents of godbot-studio_0.x.y_amd64.AppImage.tar.gz.sig>",
      "url": "https://github.com/IxMxAMAR/GodBot-Studio/releases/download/v0.x.y/godbot-studio_0.x.y_amd64.AppImage.tar.gz"
    }
  }
}
```

GitHub URL-escapes spaces in asset filenames as `.` (so `GodBot
Studio_0.x.y_…` becomes `GodBot.Studio_0.x.y_…` in the download URL).
Sanity-check the URLs with `curl -I` before promoting the release.

## 5. Smoke-test the auto-updater

1. Install the previous version.
2. Launch it. Within ~1s of boot, the in-app banner should read
   "Update available: v0.x.y — restart Studio to install."
3. Quit + reinstall the new MSI manually OR (once
   `update.downloadAndInstall()` is wired) click the banner's
   eventual "Install" button.

If the banner never appears, common culprits:

- `latest.json` not uploaded as a release asset on `latest`
- Version in manifest ≤ installed version (updater treats equal as no-op)
- Pubkey mismatch (regenerated key + forgot to update tauri.conf.json)
- Signing privkey env vars missing during build → no `.sig` produced
- Endpoint blocked by corporate firewall (check the update probe in
  `src/api/updater.ts` → it logs to console)

## 6. Post-release housekeeping

- Bump `package.json` to the next dev version (`0.x.(y+1)-dev`).
- Update `docs/ROADMAP.md` with what shipped.
- Tag a follow-up "post-release" commit so `git describe` keeps useful
  output for ad-hoc builds.
