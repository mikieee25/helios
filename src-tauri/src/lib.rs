use serde::Serialize;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{net::TcpListener, sync::Mutex, time::Duration};
use tauri::{Manager, RunEvent, State};
use tauri_plugin_shell::{process::{CommandChild, CommandEvent}, ShellExt};

struct Aria(Mutex<Option<CommandChild>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RpcConfig {
    port: u16,
    secret: String,
}

#[tauri::command]
fn get_rpc_config(config: State<'_, RpcConfig>) -> RpcConfig {
    config.inner().clone()
}

#[tauri::command]
fn read_torrent_file(path: String) -> Result<String, String> {
    if !std::path::Path::new(&path)
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("torrent"))
    {
        return Err("Choose a .torrent file.".into());
    }
    std::fs::read(&path)
        .map(|bytes| STANDARD.encode(bytes))
        .map_err(|error| format!("Could not read torrent file {path}: {error}"))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_rpc_config, read_torrent_file])
        .setup(|app| {
            // Keep the download session between launches.
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let session = data.join("aria2.session");
            if !session.exists() { std::fs::File::create(&session)?; }
            let s = session.to_string_lossy().to_string();
            let dir = app.path().download_dir()?.to_string_lossy().to_string();

            let secret = uuid::Uuid::new_v4().simple().to_string();
            let mut started: Option<(u16, CommandChild)> = None;
            let mut last_error = "aria2 did not report an RPC listener".to_string();
            for _ in 0..5 {
                let listener = TcpListener::bind(("127.0.0.1", 0))?;
                let port = listener.local_addr()?.port();
                drop(listener);
                let args: Vec<String> = vec![
                    "--enable-rpc".into(), format!("--rpc-listen-port={port}"),
                    format!("--rpc-secret={secret}"), "--rpc-listen-all=false".into(),
                    "--continue=true".into(), "--split=16".into(),
                    "--max-connection-per-server=16".into(), "--min-split-size=1M".into(),
                    format!("--dir={dir}"), format!("--input-file={s}"),
                    format!("--save-session={s}"), "--save-session-interval=30".into(),
                ];
                let (mut rx, child) = app.shell().sidecar("aria2c")?.args(args).spawn()?;
                let (ready_tx, ready_rx) = std::sync::mpsc::channel();
                tauri::async_runtime::spawn(async move {
                    let mut ready_tx = Some(ready_tx);
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                                let output = String::from_utf8_lossy(&bytes);
                                if output.contains(&format!("IPv4 RPC: listening on TCP port {port}")) {
                                    if let Some(tx) = ready_tx.take() { let _ = tx.send(Ok(())); }
                                } else if output.contains("RPC: Failed to bind TCP socket") {
                                    if let Some(tx) = ready_tx.take() { let _ = tx.send(Err(output.into_owned())); }
                                }
                            }
                            CommandEvent::Terminated(status) => {
                                if let Some(tx) = ready_tx.take() { let _ = tx.send(Err(format!("aria2 exited ({:?})", status.code))); }
                                break;
                            }
                            _ => {}
                        }
                    }
                });
                match ready_rx.recv_timeout(Duration::from_secs(5)) {
                    Ok(Ok(())) => { started = Some((port, child)); break; }
                    Ok(Err(error)) => { last_error = error; let _ = child.kill(); }
                    Err(error) => { last_error = format!("aria2 RPC startup timed out: {error}"); let _ = child.kill(); }
                }
            }
            let Some((port, child)) = started else {
                return Err(std::io::Error::new(std::io::ErrorKind::TimedOut, format!("aria2 failed to start after 5 port attempts: {last_error}")).into());
            };
            app.manage(Aria(Mutex::new(Some(child))));
            app.manage(RpcConfig { port, secret });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Helios")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(child) = app.state::<Aria>().0.lock().unwrap().take() { let _ = child.kill(); }
            }
        });
}
