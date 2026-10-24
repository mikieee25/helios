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

## Layout

| Path | Job |
|---|---|
| `src/lib/aria2.ts` | WebSocket JSON-RPC client, auto-reconnect, push events |
| `src/lib/store.ts` | Zustand store: one `system.multicall` per second, speed history, actions |
| `src/components/Chart.tsx` | Animated speed chart (requestAnimationFrame, reads the store directly) |
| `src/components/TaskTable.tsx` | Task list; rows are memoized so only changed tasks re-render |
| `src-tauri/src/lib.rs` | Starts aria2 as a sidecar, keeps its session file, stops it on exit |

## Known gaps

- The RPC secret is the fixed string `helios-dev`. Generate one per launch in `lib.rs` and pass it to the UI before shipping.
- Completed history is whatever aria2 keeps (up to 100 stopped tasks are fetched). Persist your own history for the "150 completed" case.
- The task list is not virtualized yet. Add TanStack Virtual once you expect hundreds of rows.
- Explorer items, Settings and Options are visual only.
