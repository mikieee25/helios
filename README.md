# Helios

Helios is a desktop app for managing direct downloads and BitTorrent transfers. Add links, magnets, or `.torrent` files; follow progress and transfer speeds; choose files from a torrent; and manage completed downloads from one window.

The current installer is for **Windows x64**. Helios includes the aria2 download engine and can keep running in the system tray.

## For users

### Download and install

Download the latest Helios installer and its `.sha256` file from [GitHub Releases](https://github.com/mikieee25/helios/releases). In PowerShell, set `$installer` to the name of the downloaded installer and verify its checksum:

```powershell
$installer = ".\Helios_VERSION_x64-setup.exe" # Replace VERSION with the downloaded version.
$expected = ((Get-Content "$installer.sha256") -split '\s+')[0].ToLowerInvariant()
$actual = (Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw "SHA-256 mismatch for $installer" }
```

You can also verify the build provenance with [GitHub CLI](https://cli.github.com/):

```powershell
gh attestation verify $installer --repo mikieee25/helios
```

Releases are not code-signed yet, so Windows SmartScreen may warn. Select **More info** > **Run anyway** only after verifying the checksum and provenance.

### Add and manage downloads

- Select **+** or press **Ctrl+N** to add one or more HTTP, HTTPS, FTP, magnet, or `.torrent` sources.
- Paste a supported link anywhere in the app, or drop a link or torrent file onto the window.
- For torrents, choose **Choose files before starting** to select which files to download.
- Pause, resume, retry, remove, or open completed files from the task list.
- Use Settings to choose a download folder, set speed and seeding limits, configure a proxy, and choose how name conflicts are handled.

### Connect the Firefox extension

Helios can receive downloads from the [Helios Firefox extension](https://github.com/mikieee25/helios-firefox). Enable **Browser integration** in Helios Settings, start pairing, then enter the displayed code in the extension's options. Interception is controlled from the extension.

The bridge listens on this computer only. The extension sends download details to Helios; it sends login cookies and browser details only when you grant its optional permission. Helios and the extension do not send this information to the developer or another server, and neither uses analytics. See the extension's [privacy policy](https://github.com/mikieee25/helios-firefox/blob/main/PRIVACY.md).

## For developers

### Requirements

- Node.js and npm
- Rust stable and the [Tauri prerequisites](https://tauri.app/start/prerequisites/)
- The aria2 sidecar executable for the target platform

The automated release currently packages Windows x64 only. Other platforms need their own Tauri prerequisites and target-specific aria2 sidecar.

### Run locally

Install dependencies and start the desktop app:

```powershell
npm ci
npm run tauri dev
```

The Tauri app starts aria2 with a per-launch RPC port and secret. To preview the UI in a browser instead, run a local aria2 instance with RPC enabled, then start Next.js in another terminal:

```powershell
# Terminal 1: aria2 must be installed and available on PATH.
aria2c --enable-rpc --rpc-listen-port=6800 --rpc-secret=helios-dev --rpc-allow-origin-all=true

# Terminal 2
npm run dev # http://localhost:3000
```

### Checks and build

```powershell
npx tsc --noEmit
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

To build a desktop bundle, place the target-specific aria2 executable in `src-tauri/binaries/` using the target triple in its filename. For Windows x64, use `aria2c-x86_64-pc-windows-msvc.exe`. Then run:

```powershell
npm run tauri build
```

### Project structure

| Path | Purpose |
| --- | --- |
| `src/lib/aria2.ts` | aria2 WebSocket JSON-RPC client and reconnect handling |
| `src/lib/store.ts` | Download state, settings, polling, and speed history |
| `src/lib/history.ts` | Persistent completion history |
| `src/lib/persistence.ts` | Tauri storage with a browser `localStorage` fallback |
| `src/components/TaskTable.tsx` | Virtualized download and completion lists |
| `src/components/Settings.tsx` | Download and app settings, including browser integration |
| `src-tauri/src/lib.rs` | Native window, aria2 process, tray, and desktop commands |
| `src-tauri/src/bridge.rs` | Loopback browser bridge server |

### Make a release

In GitHub, open **Actions** > **Release** > **Run workflow**, select `main`, choose a `patch`, `minor`, or `major` bump, then run it. The workflow updates the version files, pushes a version tag, builds the Windows x64 installer, and creates a draft release.

The updater uses a Tauri signing key. The private key is stored locally at `%USERPROFILE%\.tauri\helios-updater.key`; protect it and keep a secure backup. Add its contents to the repository secret `TAURI_SIGNING_PRIVATE_KEY` before running a release. In PowerShell: `Get-Content -Raw "$env:USERPROFILE\.tauri\helios-updater.key" | gh secret set TAURI_SIGNING_PRIVATE_KEY`. For local release builds, set `$env:TAURI_SIGNING_PRIVATE_KEY="$env:USERPROFILE\.tauri\helios-updater.key"` before `npm run tauri build`. Releases include `latest.json` and the updater signature; publish the draft release to make updates available. Existing Helios 0.1.2 installs need one manual install of a release that includes the updater before they can update in-app.

Under **Settings** > **Actions** > **General** > **Workflow permissions**, choose **Read and write permissions**. Branch protection on `main` blocks the workflow's push unless the bot can bypass those rules.

If a run fails after its tag was pushed, delete the unpublished draft release and the tag, then run the workflow again.

### Licensing

Helios is MIT licensed. aria2 is bundled as a separate, unmodified program under GPL-2.0-or-later; its notices and license files are in `src-tauri/licenses/`.
