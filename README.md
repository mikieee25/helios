# Helios

A fast download manager: **Next.js** UI (static export) in a **Tauri 2** shell, with **aria2** as the engine.
The UI talks to aria2 over its JSON-RPC WebSocket. Rust only starts aria2 and owns the window.

## Try the UI in a browser (no Rust needed)

```powershell
# terminal 1: any aria2 with RPC on
aria2c --enable-rpc --rpc-listen-port=6800 --rpc-secret=helios-dev --rpc-allow-origin-all=true

# terminal 2
npm install
npm run dev        # http://localhost:3000
```

Paste a link (http, ftp or magnet) anywhere in the window to add a download.

## Run as a desktop app

1. Install Rust and the Tauri prerequisites for your OS (https://tauri.app/start/prerequisites/).
2. Put an aria2 build in `src-tauri/binaries/`, named with your target triple (`rustc -vV` shows it):
   - Windows: `aria2c-x86_64-pc-windows-msvc.exe`
   - macOS (Apple silicon): `aria2c-aarch64-apple-darwin`
   - Linux: `aria2c-x86_64-unknown-linux-gnu`
3. Make the app icons from any 1024px PNG: `npx tauri icon path/to/logo.png`
4. `npm install` then `npm run tauri dev` (or `npm run tauri build`).

## Download and verify

Download the Windows installer and its `.sha256` file from the draft or published GitHub Release. Verify the checksum in PowerShell:

```powershell
$installer = ".\Helios_0.1.0_x64-setup.exe"
$expected = ((Get-Content "$($installer).sha256") -split '\s+')[0].ToLowerInvariant()
$actual = (Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw "SHA-256 mismatch for $installer" }
```

Verify the build provenance with GitHub CLI:

```powershell
gh attestation verify .\Helios_0.1.0_x64-setup.exe --repo mikieee25/helios
```

Releases are not code-signed yet, so Windows SmartScreen may warn. Select **More info** > **Run anyway** only after verifying the checksum and provenance.

## Layout

| Path                           | Job                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `src/lib/aria2.ts`             | WebSocket JSON-RPC client, auto-reconnect, push events                                      |
| `src/lib/store.ts`             | Zustand store: one `system.multicall` per second, settings, explorer filters, speed history |
| `src/lib/history.ts`           | Persistent completion history, capped at 5,000 entries                                      |
| `src/lib/persistence.ts`       | Tauri store with a browser `localStorage` fallback                                          |
| `src/components/Chart.tsx`     | Animated speed chart (requestAnimationFrame, reads the store directly)                      |
| `src/components/TaskTable.tsx` | Virtualized task and completion lists; active task rows are memoized                        |
| `src/components/Settings.tsx`  | Live aria2 speed, concurrency, connection, and download-folder settings                     |
| `src-tauri/src/lib.rs`         | Starts aria2 with a per-launch secret and loopback port; keeps its session file             |

## Known gaps

- Include the target-specific aria2 sidecar and generated app icons before building a desktop bundle; see the setup steps above.
- Completed history is stored separately from aria2's stopped-task list and kept up to 5,000 entries.
- Explorer categories are inferred from file extensions; torrent folders use the dominant category of their files.
