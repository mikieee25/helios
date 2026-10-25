mod bridge;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, State, Url,
};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use tauri_plugin_single_instance::init as single_instance;

struct Aria {
    child: Mutex<Option<CommandChild>>,
    shutting_down: Arc<AtomicBool>,
}

fn aria2_args(port: u16, secret: &str, session: &str, dir: &str) -> Vec<String> {
    vec![
        "--enable-rpc".into(),
        format!("--rpc-listen-port={port}"),
        format!("--rpc-secret={secret}"),
        "--rpc-listen-all=false".into(),
        "--continue=true".into(),
        "--split=16".into(),
        "--max-connection-per-server=16".into(),
        "--min-split-size=1M".into(),
        format!("--dir={dir}"),
        format!("--input-file={session}"),
        format!("--save-session={session}"),
        "--save-session-interval=30".into(),
    ]
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
enum OpenRequest {
    Link(String),
    Torrent(String),
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
enum TrayAction {
    PauseAll,
    ResumeAll,
    Quit,
}

#[derive(Default)]
struct PendingOpenState {
    ready: bool,
    requests: Vec<OpenRequest>,
    actions: Vec<TrayAction>,
}

#[derive(Clone)]
struct PendingOpen(Arc<Mutex<PendingOpenState>>);

fn parse_open_request(input: &str) -> Option<OpenRequest> {
    let input = input.trim();
    if input
        .get(..7)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("magnet:"))
    {
        return Some(OpenRequest::Link(input.to_string()));
    }
    let path = Url::parse(input)
        .ok()
        .filter(|url| url.scheme() == "file")
        .and_then(|url| url.to_file_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| input.to_string());
    std::path::Path::new(&path)
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("torrent"))
        .then_some(OpenRequest::Torrent(path))
}

fn forward_open_request(app: &AppHandle, pending: &PendingOpen, request: OpenRequest) {
    let mut state = pending.0.lock().unwrap();
    if state.ready {
        drop(state);
        let _ = app.emit_to("main", "helios://open", request);
    } else if !state
        .requests
        .iter()
        .any(|queued| match (queued, &request) {
            (OpenRequest::Link(a), OpenRequest::Link(b))
            | (OpenRequest::Torrent(a), OpenRequest::Torrent(b)) => a == b,
            _ => false,
        })
    {
        state.requests.push(request);
    }
}

fn forward_open_args(app: &AppHandle, pending: &PendingOpen, args: &[String]) {
    for arg in args.iter().skip(1) {
        if let Some(request) = parse_open_request(arg) {
            forward_open_request(app, pending, request);
        }
    }
}

#[derive(Serialize)]
struct PendingStartup {
    requests: Vec<OpenRequest>,
    actions: Vec<TrayAction>,
}

#[tauri::command]
fn take_open_requests(pending: State<'_, PendingOpen>) -> PendingStartup {
    let mut state = pending.0.lock().unwrap();
    state.ready = true;
    PendingStartup {
        requests: std::mem::take(&mut state.requests),
        actions: std::mem::take(&mut state.actions),
    }
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable()
    } else {
        manager.disable()
    }
    .map_err(|error| error.to_string())
}

fn emit_tray_action(app: &AppHandle, pending: &PendingOpen, action: TrayAction) {
    let mut state = pending.0.lock().unwrap();
    if state.ready {
        drop(state);
        emit_tray_action_event(app, action);
    } else {
        state.actions.push(action);
    }
}

fn emit_tray_action_event(app: &AppHandle, action: TrayAction) {
    let event = match action {
        TrayAction::PauseAll => "helios://pause-all",
        TrayAction::ResumeAll => "helios://resume-all",
        TrayAction::Quit => "helios://quit",
    };
    let _ = app.emit_to("main", event, ());
}

fn build_tray(app: &mut tauri::App, pending: PendingOpen) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Helios", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause-all", "Pause all", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "resume-all", "Resume all", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let first_separator = PredefinedMenuItem::separator(app)?;
    let second_separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &first_separator,
            &pause,
            &resume,
            &second_separator,
            &quit,
        ],
    )?;
    let tray_pending = pending.clone();
    let tray = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => show_window(app),
            "pause-all" => emit_tray_action(app, &tray_pending, TrayAction::PauseAll),
            "resume-all" => emit_tray_action(app, &tray_pending, TrayAction::ResumeAll),
            "quit" => emit_tray_action(app, &tray_pending, TrayAction::Quit),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        })
        .icon(
            app.default_window_icon()
                .ok_or_else(|| std::io::Error::other("default app icon is missing"))?
                .clone(),
        )
        .build(app)?;
    app.manage(tray);
    Ok(())
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

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
fn begin_aria_shutdown(aria: State<'_, Aria>) {
    aria.shutting_down.store(true, Ordering::SeqCst);
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

#[tauri::command]
fn delete_files(dir: String, paths: Vec<String>) -> Vec<String> {
    let root = match std::fs::canonicalize(&dir) {
        Ok(root) if root.is_dir() => root,
        Ok(_) => return vec![format!("Download directory is not a directory: {dir}")],
        Err(error) => {
            return vec![format!(
                "Could not access download directory {dir}: {error}"
            )]
        }
    };
    let mut errors = Vec::new();
    for path in paths {
        let path = std::path::PathBuf::from(&path);
        let Some(name) = path.file_name() else {
            errors.push(format!("Invalid file path: {}", path.display()));
            continue;
        };
        let Some(parent) = path.parent() else {
            errors.push(format!("Invalid file path: {}", path.display()));
            continue;
        };
        let canonical_parent = match std::fs::canonicalize(parent) {
            Ok(parent) => parent,
            Err(error) => {
                errors.push(format!("Could not access {}: {error}", path.display()));
                continue;
            }
        };
        if canonical_parent != root && !canonical_parent.starts_with(&root) {
            errors.push(format!(
                "Refusing to delete a file outside {dir}: {}",
                path.display()
            ));
            continue;
        }
        let target = canonical_parent.join(name);
        if target == root {
            errors.push(format!(
                "Refusing to delete the download directory: {}",
                target.display()
            ));
            continue;
        }
        match std::fs::symlink_metadata(&target) {
            Ok(metadata)
                if !metadata.file_type().is_file() && !metadata.file_type().is_symlink() =>
            {
                errors.push(format!(
                    "Refusing to delete a non-file path: {}",
                    target.display()
                ));
                continue;
            }
            Ok(_) => {
                if let Err(error) = std::fs::remove_file(&target) {
                    errors.push(format!("Could not delete {}: {error}", target.display()));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                errors.push(format!(
                    "File is missing or was moved: {}",
                    target.display()
                ));
            }
            Err(error) => errors.push(format!("Could not access {}: {error}", target.display())),
        }
        let control = std::path::PathBuf::from(format!("{}.aria2", target.display()));
        match std::fs::symlink_metadata(&control) {
            Ok(metadata) if metadata.file_type().is_file() || metadata.file_type().is_symlink() => {
                if let Err(error) = std::fs::remove_file(&control) {
                    errors.push(format!("Could not delete {}: {error}", control.display()));
                }
            }
            Ok(_) => errors.push(format!(
                "Refusing to delete a non-file path: {}",
                control.display()
            )),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => errors.push(format!("Could not access {}: {error}", control.display())),
        }
    }
    errors
}

#[tauri::command]
fn open_download_file(app: AppHandle, path: String) -> Result<(), String> {
    let file = std::path::Path::new(&path);
    match std::fs::metadata(file) {
        Ok(metadata) if metadata.is_file() => app
            .opener()
            .open_path(&path, None::<&str>)
            .map_err(|error| format!("Could not open {path}: {error}")),
        _ => Err(format!("File is missing or was moved: {path}")),
    }
}

pub fn run() {
    let pending = PendingOpen(Arc::new(Mutex::new(PendingOpenState::default())));
    let shutting_down = Arc::new(AtomicBool::new(false));
    let setup_shutting_down = shutting_down.clone();
    let callback_pending = pending.clone();
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(single_instance(move |app, args, _| {
        forward_open_args(app, &callback_pending, &args);
        show_window(app);
    }));
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
    let builder =
        builder
            .plugin(tauri_plugin_deep_link::init())
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ));
    let app = builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_rpc_config,
            bridge::bridge_get_state,
            bridge::bridge_set_enabled,
            bridge::bridge_start_pairing,
            bridge::bridge_cancel_pairing,
            bridge::bridge_list_clients,
            bridge::bridge_revoke_client,
            read_torrent_file,
            delete_files,
            open_download_file,
            begin_aria_shutdown,
            take_open_requests,
            set_autostart
        ])
        .setup(move |app| {
            app.manage(pending.clone());
            let app_handle = app.handle().clone();
            for argument in std::env::args().skip(1) {
                if let Some(request) = parse_open_request(&argument) {
                    forward_open_request(&app_handle, &pending, request);
                }
            }
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in urls {
                    if let Some(request) = parse_open_request(url.as_str()) {
                        forward_open_request(&app_handle, &pending, request);
                    }
                }
            }
            #[cfg(target_os = "macos")]
            {
                let app_handle = app_handle.clone();
                let pending = pending.clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        if let Some(request) = parse_open_request(url.as_str()) {
                            forward_open_request(&app_handle, &pending, request);
                        }
                    }
                });
            }
            // Keep the download session between launches.
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let session = data.join("aria2.session");
            if !session.exists() {
                std::fs::File::create(&session)?;
            }
            let s = session.to_string_lossy().to_string();
            let dir = app.path().download_dir()?.to_string_lossy().to_string();

            let secret = uuid::Uuid::new_v4().simple().to_string();
            let mut started: Option<(u16, CommandChild, tokio::sync::oneshot::Sender<()>)> = None;
            let mut last_error = "aria2 did not report an RPC listener".to_string();
            for _ in 0..5 {
                let listener = TcpListener::bind(("127.0.0.1", 0))?;
                let port = listener.local_addr()?.port();
                drop(listener);
                let args = aria2_args(port, &secret, &s, &dir);
                let (mut rx, child) = match app
                    .shell()
                    .sidecar("aria2c")
                    .and_then(|command| command.args(args).spawn())
                {
                    Ok(started) => started,
                    Err(error) => {
                        last_error = format!("Could not launch aria2: {error}");
                        continue;
                    }
                };
                let (ready_tx, ready_rx) = std::sync::mpsc::channel();
                let (armed_tx, armed_rx) = tokio::sync::oneshot::channel();
                let monitor_app = app.handle().clone();
                let monitor_shutdown = setup_shutting_down.clone();
                let monitor_session = s.clone();
                let monitor_dir = dir.clone();
                let monitor_secret = secret.clone();
                tauri::async_runtime::spawn(async move {
                    let mut ready_tx = Some(ready_tx);
                    let mut listening = false;
                    let mut terminated = false;
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                                let output = String::from_utf8_lossy(&bytes);
                                if output
                                    .contains(&format!("IPv4 RPC: listening on TCP port {port}"))
                                {
                                    if !listening {
                                        listening = true;
                                        if let Some(tx) = ready_tx.take() { let _ = tx.send(Ok(())); }
                                    }
                                } else if output.contains("RPC: Failed to bind TCP socket") {
                                    if let Some(tx) = ready_tx.take() {
                                        let _ = tx.send(Err(output.into_owned()));
                                    }
                                }
                            }
                            CommandEvent::Terminated(status) => {
                                if let Some(tx) = ready_tx.take() {
                                    let _ =
                                        tx.send(Err(format!("aria2 exited ({:?})", status.code)));
                                    return;
                                }
                                terminated = true;
                                break;
                            }
                            _ => {}
                        }
                    }
                    if !listening { return; }
                    if armed_rx.await.is_err() { return; }
                    loop {
                        if !terminated {
                            match rx.recv().await {
                                Some(CommandEvent::Terminated(_)) | None => terminated = true,
                                Some(_) => continue,
                            }
                        }
                        if monitor_shutdown.load(Ordering::SeqCst) { break; }
                        if let Some(state) = monitor_app.try_state::<Aria>() {
                            state.child.lock().unwrap().take();
                        }
                        let mut recovered = false;
                        for delay in [1u64, 2, 4] {
                            tokio::time::sleep(Duration::from_secs(delay)).await;
                            if monitor_shutdown.load(Ordering::SeqCst) { break; }
                            let args = aria2_args(port, &monitor_secret, &monitor_session, &monitor_dir);
                            let Ok((mut replacement_rx, replacement_child)) = monitor_app.shell()
                                .sidecar("aria2c")
                                .and_then(|command| command.args(args).spawn()) else { continue; };
                            let ready = tokio::time::timeout(Duration::from_secs(5), async {
                                while let Some(event) = replacement_rx.recv().await {
                                    match event {
                                        CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes)
                                            if String::from_utf8_lossy(&bytes).contains(&format!("IPv4 RPC: listening on TCP port {port}")) => return true,
                                        CommandEvent::Terminated(_) => return false,
                                        _ => {}
                                    }
                                }
                                false
                            }).await.unwrap_or(false);
                            if ready && !monitor_shutdown.load(Ordering::SeqCst) {
                                if let Some(state) = monitor_app.try_state::<Aria>() {
                                    *state.child.lock().unwrap() = Some(replacement_child);
                                    rx = replacement_rx;
                                    terminated = false;
                                    recovered = true;
                                    break;
                                }
                            }
                            let _ = replacement_child.kill();
                        }
                        if recovered { continue; }
                        if !monitor_shutdown.load(Ordering::SeqCst) {
                            monitor_app.dialog().message("aria2 stopped and could not be restarted after three attempts.")
                                .title("Download engine stopped")
                                .kind(MessageDialogKind::Error)
                                .blocking_show();
                        }
                        break;
                    }
                });
                match ready_rx.recv_timeout(Duration::from_secs(5)) {
                    Ok(Ok(())) => {
                        started = Some((port, child, armed_tx));
                        break;
                    }
                    Ok(Err(error)) => {
                        last_error = error;
                        let _ = child.kill();
                    }
                    Err(error) => {
                        last_error = format!("aria2 RPC startup timed out: {error}");
                        let _ = child.kill();
                    }
                }
            }
            let Some((port, child, armed_tx)) = started else {
                let message = format!("aria2 failed to start after 5 port attempts: {last_error}");
                app.dialog()
                    .message(message.clone())
                    .title("Helios couldn't start")
                    .kind(MessageDialogKind::Error)
                    .blocking_show();
                return Err(std::io::Error::new(std::io::ErrorKind::TimedOut, message).into());
            };
            app.manage(Aria { child: Mutex::new(Some(child)), shutting_down: setup_shutting_down.clone() });
            app.manage(RpcConfig { port, secret: secret.clone() });
            let bridge = bridge::BridgeService::start(
                app_handle.clone(),
                data.join("bridge.json"),
                port,
                secret,
            )
            .map_err(std::io::Error::other)?;
            app.manage(bridge);
            let _ = armed_tx.send(());
            build_tray(app, pending.clone())?;
            Ok(())
        })
        .build(tauri::generate_context!());
    let app = match app {
        Ok(app) => app,
        Err(error) => {
            eprintln!("failed to start Helios: {error}");
            return;
        }
    };
    app.run(move |app, event| {
        if let RunEvent::Exit = event {
            shutting_down.store(true, Ordering::SeqCst);
            if let Some(bridge) = app.try_state::<bridge::BridgeService>() {
                bridge.stop();
            }
            let aria = app.state::<Aria>();
            aria.shutting_down.store(true, Ordering::SeqCst);
            let child = aria.child.lock().unwrap().take();
            if let Some(child) = child {
                let _ = child.kill();
            }
        }
    });
}
