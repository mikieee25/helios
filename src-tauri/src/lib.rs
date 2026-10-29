mod bridge;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
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
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use tauri_plugin_single_instance::init as single_instance;

struct Aria {
    child: Mutex<Option<CommandChild>>,
    shutting_down: Arc<AtomicBool>,
}

fn aria2_args(
    port: u16,
    secret: &str,
    session: &str,
    state_dir: &str,
    dir: &str,
    connect_timeout: u32,
) -> Vec<String> {
    vec![
        "--enable-rpc".into(),
        format!("--rpc-listen-port={port}"),
        format!("--rpc-secret={secret}"),
        "--rpc-listen-all=false".into(),
        "--continue=true".into(),
        format!("--connect-timeout={connect_timeout}"),
        "--retry-wait=2".into(),
        "--split=16".into(),
        "--max-connection-per-server=16".into(),
        "--min-split-size=1M".into(),
        format!("--dir={dir}"),
        format!("--input-file={session}"),
        format!("--save-session={session}"),
        "--save-session-interval=30".into(),
        format!("--state-dir={state_dir}"),
        "--state-save-interval=10".into(),
    ]
}

fn rpc_ready_output(output: &str, port: u16) -> bool {
    output.contains(&format!("IPv4 RPC: listening on TCP port {port}"))
        || output.contains(&format!("RPC: listening on 127.0.0.1 port {port}"))
}

fn preserve_legacy_session(session: &std::path::Path) -> std::io::Result<()> {
    if !session.exists() {
        return Ok(());
    }
    let backup = session.with_file_name("aria2.session.aria2-1.37.0.bak");
    if !backup.exists() {
        std::fs::copy(session, backup)?;
    }
    Ok(())
}

fn legacy_ftp_task_count(session: &std::path::Path) -> std::io::Result<usize> {
    let contents = std::fs::read_to_string(session)?;
    Ok(contents
        .lines()
        .filter(|line| line.trim_start().to_ascii_lowercase().starts_with("ftp://"))
        .count())
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupSettings {
    #[serde(default = "default_start_minimized")]
    start_minimized: bool,
    #[serde(default = "default_connect_timeout")]
    connect_timeout_seconds: u32,
}

fn default_start_minimized() -> bool { true }
fn default_connect_timeout() -> u32 { 10 }

fn should_start_hidden(args: &[String], start_minimized: bool) -> bool {
    start_minimized && args.iter().any(|arg| arg == "--autostarted")
}

struct StartupVisibility(bool);

#[tauri::command]
fn write_startup_settings(app: AppHandle, start_minimized: bool, connect_timeout_seconds: u32) -> Result<(), String> {
    let path = app.path().app_data_dir().map_err(|error| error.to_string())?.join("startup.json");
    std::fs::create_dir_all(path.parent().expect("startup path has parent")).map_err(|error| error.to_string())?;
    let contents = serde_json::to_vec(&StartupSettings { start_minimized, connect_timeout_seconds: connect_timeout_seconds.clamp(1, 60) }).map_err(|error| error.to_string())?;
    std::fs::write(path, contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn show_after_first_paint(app: AppHandle, visibility: State<'_, StartupVisibility>) {
    if !visibility.0 { show_window(&app); }
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

#[tauri::command]
fn open_data_folder(app: AppHandle) -> Result<(), String> {
    let path = app.path().app_data_dir().map_err(|error| error.to_string())?;
    app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|error| error.to_string())
}

#[tauri::command]
fn open_licenses(app: AppHandle) -> Result<(), String> {
    let path = app.path().resource_dir().map_err(|error| error.to_string())?.join("licenses").join("THIRD_PARTY_NOTICES.txt");
    if !path.is_file() { return Err("Bundled license notices could not be found.".into()); }
    app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_os_version() -> String {
    os_info::get().to_string()
}

fn redact_log_message(message: &str) -> String {
    let mut output = String::with_capacity(message.len());
    let mut remaining = message;
    loop {
        let http = remaining.find("http://");
        let https = remaining.find("https://");
        let next = match (http, https) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (Some(a), None) | (None, Some(a)) => Some(a),
            (None, None) => None,
        };
        let Some(start) = next else { output.push_str(remaining); break; };
        output.push_str(&remaining[..start]);
        let url = &remaining[start..];
        let end = url.find(char::is_whitespace).unwrap_or(url.len());
        output.push_str("[URL]");
        remaining = &url[end..];
    }
    for key in ["cookie=", "cookie:", "authorization=", "authorization:", "token=", "token:", "password=", "password:"] {
        let lower = output.to_lowercase();
        if let Some(start) = lower.find(key) {
            let value_start = start + key.len();
            let end = output[value_start..].find(|character: char| character.is_whitespace() || matches!(character, ',' | ';' | '}' | '"' | '\''))
                .map(|offset| value_start + offset).unwrap_or(output.len());
            output.replace_range(value_start..end, "[REDACTED]");
        }
    }
    output
}

fn log_diagnostic(level: log::Level, source: &str, message: &str) {
    let entry = serde_json::json!({
        "time": chrono_time(),
        "level": level.to_string().to_lowercase(),
        "source": source,
        "message": redact_log_message(message),
    });
    match level {
        log::Level::Error => log::error!(target: "helios::diagnostics", "{entry}"),
        log::Level::Warn => log::warn!(target: "helios::diagnostics", "{entry}"),
        log::Level::Info => log::info!(target: "helios::diagnostics", "{entry}"),
        log::Level::Debug => log::debug!(target: "helios::diagnostics", "{entry}"),
        log::Level::Trace => log::trace!(target: "helios::diagnostics", "{entry}"),
    }
}

fn chrono_time() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".into())
}

fn console_log_files(app: &AppHandle) -> Result<(std::path::PathBuf, Vec<std::path::PathBuf>), String> {
    let dir = app.path().app_log_dir().map_err(|error| error.to_string())?;
    let mut files = std::fs::read_dir(&dir).map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with("helios") && path.extension().is_some_and(|ext| ext == "log")))
        .collect::<Vec<_>>();
    files.sort_by_key(|path| std::fs::metadata(path).and_then(|meta| meta.modified()).ok());
    Ok((dir, files))
}

#[tauri::command]
fn get_console_logs(app: AppHandle) -> Result<Vec<String>, String> {
    use std::collections::VecDeque;
    let (_, files) = console_log_files(&app)?;
    let cleared_at = std::fs::read_to_string(app.path().app_data_dir().map_err(|error| error.to_string())?.join("developer-console-cleared-at"))
        .ok().and_then(|value| value.parse::<u128>().ok()).unwrap_or(0);
    let mut lines = VecDeque::with_capacity(3000);
    for path in files {
        let contents = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
        for line in contents.lines() {
            let json_start = line.find('{');
            let timestamp = json_start.and_then(|start| serde_json::from_str::<serde_json::Value>(&line[start..]).ok())
                .and_then(|entry| entry.get("time").and_then(serde_json::Value::as_str).and_then(|time| time.parse::<u128>().ok()));
            if timestamp.is_some_and(|timestamp| timestamp <= cleared_at) { continue; }
            if lines.len() == 3000 { lines.pop_front(); }
            lines.push_back(line.to_owned());
        }
    }
    Ok(lines.into())
}

#[tauri::command]
fn clear_console_logs(app: AppHandle) -> Result<(), String> {
    let path = app.path().app_data_dir().map_err(|error| error.to_string())?.join("developer-console-cleared-at");
    std::fs::create_dir_all(path.parent().ok_or("Invalid log marker path")?).map_err(|error| error.to_string())?;
    let timestamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?.as_millis();
    std::fs::write(path, timestamp.to_string()).map_err(|error| error.to_string())
}

#[tauri::command]
fn export_console_logs(path: String, contents: String) -> Result<(), String> {
    std::fs::write(path, contents).map_err(|error| error.to_string())
}

pub fn run() {
    let pending = PendingOpen(Arc::new(Mutex::new(PendingOpenState::default())));
    let shutting_down = Arc::new(AtomicBool::new(false));
    let setup_shutting_down = shutting_down.clone();
    let callback_pending = pending.clone();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new()
            .clear_targets()
            .target(Target::new(TargetKind::LogDir { file_name: Some("helios".into()) }))
            .target(Target::new(TargetKind::Webview))
            .max_file_size(4 * 1024 * 1024)
            .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(3))
            .level(log::LevelFilter::Info)
            .build());
    #[cfg(desktop)]
    let builder = builder.plugin(single_instance(move |app, args, _| {
        forward_open_args(app, &callback_pending, &args);
        // Windows can retain duplicate Run entries for the same app. If the
        // second launch comes from autostart, don't let it reveal the hidden
        // first instance through this callback.
        if !args.iter().any(|arg| arg == "--autostarted") {
            show_window(app);
        }
    }));
    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::default()
            .with_state_flags(
                tauri_plugin_window_state::StateFlags::all()
                    & !tauri_plugin_window_state::StateFlags::VISIBLE,
            )
            .build(),
    );
    let builder =
        builder
            .plugin(tauri_plugin_deep_link::init())
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec!["--autostarted"]),
            ));
    let app = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_rpc_config,
            bridge::bridge_get_state,
            bridge::bridge_get_timings,
            bridge::bridge_take_pending_asks,
            bridge::bridge_set_enabled,
            bridge::bridge_start_pairing,
            bridge::bridge_cancel_pairing,
            bridge::bridge_list_clients,
            bridge::bridge_revoke_client,
            read_torrent_file,
            delete_files,
            open_download_file,
            open_data_folder,
            open_licenses,
            get_os_version,
            get_console_logs,
            clear_console_logs,
            export_console_logs,
            begin_aria_shutdown,
            take_open_requests,
            set_autostart,
            write_startup_settings,
            show_after_first_paint
        ])
        .setup(move |app| {
            app.manage(pending.clone());
            log_diagnostic(log::Level::Info, "Helios", "Application started");
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
            let startup_settings = std::fs::read(data.join("startup.json"))
                .ok()
                .and_then(|bytes| serde_json::from_slice::<StartupSettings>(&bytes).ok())
        .unwrap_or(StartupSettings { start_minimized: true, connect_timeout_seconds: 10 });
            let hidden = should_start_hidden(&std::env::args().collect::<Vec<_>>(), startup_settings.start_minimized);
            app.manage(StartupVisibility(hidden));
            let session = data.join("aria2.session");
            if !session.exists() {
                std::fs::File::create(&session)?;
            }
            preserve_legacy_session(&session)?;
            let legacy_ftp_tasks = legacy_ftp_task_count(&session)?;
            if legacy_ftp_tasks > 0 {
                app.dialog()
                    .message(format!(
                        "{legacy_ftp_tasks} saved FTP download(s) cannot be resumed by aria2-next. The original queue is preserved in aria2.session.aria2-1.37.0.bak. Re-add these downloads using an HTTP or HTTPS source if available."
                    ))
                    .title("Saved FTP downloads need attention")
                    .kind(MessageDialogKind::Warning)
                    .blocking_show();
            }
            let state_dir = data.join("aria2-next-state");
            std::fs::create_dir_all(&state_dir)?;
            let s = session.to_string_lossy().to_string();
            let state_path = state_dir.to_string_lossy().to_string();
            let dir = app.path().download_dir()?.to_string_lossy().to_string();

            let secret = uuid::Uuid::new_v4().simple().to_string();
            let mut started: Option<(u16, CommandChild, tokio::sync::oneshot::Sender<()>)> = None;
            let mut last_error = "aria2-next did not report an RPC listener".to_string();
            for _ in 0..5 {
                let listener = TcpListener::bind(("127.0.0.1", 0))?;
                let port = listener.local_addr()?.port();
                drop(listener);
                let args = aria2_args(port, &secret, &s, &state_path, &dir, startup_settings.connect_timeout_seconds);
                let (mut rx, child) = match app
                    .shell()
                    .sidecar("aria2c")
                    .and_then(|command| command.args(args).spawn())
                {
                    Ok(started) => started,
                    Err(error) => {
                        last_error = format!("Could not launch aria2-next: {error}");
                        continue;
                    }
                };
                let (ready_tx, ready_rx) = std::sync::mpsc::channel();
                let (armed_tx, armed_rx) = tokio::sync::oneshot::channel();
                let monitor_app = app.handle().clone();
                let monitor_shutdown = setup_shutting_down.clone();
                let monitor_session = s.clone();
                let monitor_state_dir = state_path.clone();
                let monitor_dir = dir.clone();
                let monitor_secret = secret.clone();
                let monitor_connect_timeout = startup_settings.connect_timeout_seconds;
                tauri::async_runtime::spawn(async move {
                    let mut ready_tx = Some(ready_tx);
                    let mut listening = false;
                    let mut terminated = false;
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                                let output = String::from_utf8_lossy(&bytes);
                                let trimmed = output.trim();
                                let lowercase = trimmed.to_lowercase();
                                if lowercase.contains("error") || lowercase.contains("warn") || lowercase.contains("failed") {
                                    log_diagnostic(log::Level::Warn, "aria2", trimmed);
                                }
                                if rpc_ready_output(&output, port) {
                                    if !listening {
                                        listening = true;
                                        log_diagnostic(log::Level::Info, "aria2", "RPC listener is ready");
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
                                        tx.send(Err(format!("aria2-next exited ({:?})", status.code)));
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
                            let args = aria2_args(port, &monitor_secret, &monitor_session, &monitor_state_dir, &monitor_dir, monitor_connect_timeout);
                            let Ok((mut replacement_rx, replacement_child)) = monitor_app.shell()
                                .sidecar("aria2c")
                                .and_then(|command| command.args(args).spawn()) else { continue; };
                            let ready = tokio::time::timeout(Duration::from_secs(5), async {
                                while let Some(event) = replacement_rx.recv().await {
                                    match event {
                                        CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes)
                                            if rpc_ready_output(&String::from_utf8_lossy(&bytes), port) => return true,
                                        CommandEvent::Terminated(_) => return false,
                                        _ => {}
                                    }
                                }
                                false
                            }).await.unwrap_or(false);
                            if ready && !monitor_shutdown.load(Ordering::SeqCst) {
                                log_diagnostic(log::Level::Info, "aria2", "aria2-next process recovered");
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
                        last_error = format!("aria2-next RPC startup timed out: {error}");
                        let _ = child.kill();
                    }
                }
            }
            let Some((port, child, armed_tx)) = started else {
                let message = format!("aria2-next failed to start after 5 port attempts: {last_error}");
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

#[cfg(test)]
mod startup_tests {
    use super::{aria2_args, legacy_ftp_task_count, preserve_legacy_session, rpc_ready_output, should_start_hidden};
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn aria2_next_arguments_use_dedicated_state_and_supported_timeouts() {
        assert_eq!(
            aria2_args(6800, "secret", "session", "state", "downloads", 12),
            [
                "--enable-rpc",
                "--rpc-listen-port=6800",
                "--rpc-secret=secret",
                "--rpc-listen-all=false",
                "--continue=true",
                "--connect-timeout=12",
                "--retry-wait=2",
                "--split=16",
                "--max-connection-per-server=16",
                "--min-split-size=1M",
                "--dir=downloads",
                "--input-file=session",
                "--save-session=session",
                "--save-session-interval=30",
                "--state-dir=state",
                "--state-save-interval=10",
            ]
            .map(str::to_owned)
        );
    }

    #[test]
    fn rpc_startup_detection_accepts_both_engine_log_formats() {
        assert!(rpc_ready_output(
            "10/28 14:28:47 [notice] RPC: listening on 127.0.0.1 port 36891",
            36891
        ));
        assert!(rpc_ready_output(
            "IPv4 RPC: listening on TCP port 36891",
            36891
        ));
        assert!(!rpc_ready_output("RPC: listening on 127.0.0.1 port 1", 36891));
    }

    #[test]
    fn legacy_session_backup_is_created_once_and_original_is_kept() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("helios-session-backup-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let session = dir.join("aria2.session");
        let backup = dir.join("aria2.session.aria2-1.37.0.bak");
        preserve_legacy_session(&session).unwrap();
        assert!(!backup.exists());
        fs::write(&session, "original session").unwrap();
        preserve_legacy_session(&session).unwrap();
        assert_eq!(fs::read(&backup).unwrap(), b"original session");
        fs::write(&session, "later session").unwrap();
        preserve_legacy_session(&session).unwrap();
        assert_eq!(fs::read(&backup).unwrap(), b"original session");
        assert_eq!(fs::read(&session).unwrap(), b"later session");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn legacy_ftp_tasks_are_counted_without_exposing_their_urls() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("helios-ftp-session-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let session = dir.join("aria2.session");
        fs::write(
            &session,
            "https://example.com/file.zip\n dir=C:/Downloads\n\nftp://private.example/file.zip\n",
        )
        .unwrap();
        assert_eq!(legacy_ftp_task_count(&session).unwrap(), 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn only_autostart_launch_hides_when_enabled() {
        assert!(should_start_hidden(&["helios.exe".into(), "--autostarted".into()], true));
        assert!(!should_start_hidden(&["helios.exe".into()], true));
        assert!(!should_start_hidden(&["helios.exe".into(), "--autostarted".into()], false));
    }
}
