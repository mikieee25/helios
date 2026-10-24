use std::sync::Mutex;
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

struct Aria(Mutex<Option<CommandChild>>);

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Keep the download session between launches.
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let session = data.join("aria2.session");
            if !session.exists() { std::fs::File::create(&session)?; }
            let s = session.to_string_lossy().to_string();
            let dir = app.path().download_dir()?.to_string_lossy().to_string();

            let args: Vec<String> = vec![
                "--enable-rpc".into(), "--rpc-listen-port=6800".into(),
                "--rpc-secret=helios-dev".into(), // TODO: generate per launch and pass it to the UI
                "--rpc-allow-origin-all=true".into(),
                "--continue=true".into(), "--split=16".into(),
                "--max-connection-per-server=16".into(), "--min-split-size=1M".into(),
                format!("--dir={dir}"), format!("--input-file={s}"),
                format!("--save-session={s}"), "--save-session-interval=30".into(),
            ];
            let (mut rx, child) = app.shell().sidecar("aria2c")?.args(args).spawn()?;
            tauri::async_runtime::spawn(async move { while rx.recv().await.is_some() {} });
            app.manage(Aria(Mutex::new(Some(child))));
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
