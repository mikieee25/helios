use std::{path::Path, sync::Arc};

#[cfg(windows)]
mod platform {
    use std::{
        path::{Path, PathBuf},
        time::Duration,
    };

    use sysinfo::{Pid, ProcessesToUpdate, System};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, HANDLE},
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
            Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
        },
    };

    pub struct AriaJob(HANDLE);

    // The handle is only used for process assignment and closed when the last Arc drops.
    unsafe impl Send for AriaJob {}
    unsafe impl Sync for AriaJob {}

    impl AriaJob {
        pub fn new() -> Result<Self, String> {
            let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if handle.is_null() {
                return Err(format!(
                    "Could not create aria2 lifetime job: {}",
                    std::io::Error::last_os_error()
                ));
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let configured = unsafe {
                SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &limits as *const _ as *const _,
                    std::mem::size_of_val(&limits) as u32,
                )
            };
            if configured == 0 {
                let error = std::io::Error::last_os_error();
                unsafe { CloseHandle(handle) };
                return Err(format!("Could not configure aria2 lifetime job: {error}"));
            }
            Ok(Self(handle))
        }

        pub fn assign(&self, pid: u32) -> Result<(), String> {
            let process = unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid) };
            if process.is_null() {
                return Err(format!(
                    "Could not open aria2 process {pid}: {}",
                    std::io::Error::last_os_error()
                ));
            }
            let assigned = unsafe { AssignProcessToJobObject(self.0, process) };
            let error = if assigned == 0 {
                Some(std::io::Error::last_os_error())
            } else {
                None
            };
            unsafe { CloseHandle(process) };
            error.map_or(Ok(()), |error| {
                Err(format!(
                    "Could not bind aria2 process {pid} to Helios: {error}"
                ))
            })
        }
    }

    impl Drop for AriaJob {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0) };
        }
    }

    #[derive(Clone)]
    struct ExistingAria {
        pid: Pid,
        started: u64,
        port: u16,
        secret: String,
    }

    fn arg_value<'a>(args: &'a [std::ffi::OsString], key: &str) -> Option<&'a str> {
        args.iter().find_map(|arg| {
            let arg = arg.to_str()?;
            arg.strip_prefix(key)
        })
    }

    fn normalize_path(path: &str) -> PathBuf {
        let unprefixed = path.strip_prefix(r"\\?\").unwrap_or(path);
        Path::new(unprefixed).components().collect::<PathBuf>()
    }

    fn matching_processes(system: &System, state_dir: &Path) -> Vec<ExistingAria> {
        system
            .processes()
            .iter()
            .filter_map(|(pid, process)| {
                let executable = process.exe()?.file_name()?.to_str()?;
                if !executable.eq_ignore_ascii_case("aria2c.exe") {
                    return None;
                }
                let args = process.cmd();
                let process_state = arg_value(args, "--state-dir=")?;
                if !normalize_path(process_state)
                    .to_string_lossy()
                    .eq_ignore_ascii_case(
                        &normalize_path(&state_dir.to_string_lossy()).to_string_lossy(),
                    )
                {
                    return None;
                }
                Some(ExistingAria {
                    pid: *pid,
                    started: process.start_time(),
                    port: arg_value(args, "--rpc-listen-port=")?.parse().ok()?,
                    secret: arg_value(args, "--rpc-secret=")?.to_owned(),
                })
            })
            .collect()
    }

    fn request_shutdown(process: &ExistingAria) -> Result<(), String> {
        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": "helios-startup-reconcile",
            "method": "aria2.shutdown",
            "params": [format!("token:{}", process.secret)],
        });
        let agent = ureq::AgentBuilder::new()
            .timeout(Duration::from_millis(700))
            .build();
        match agent
            .post(&format!("http://127.0.0.1:{}/jsonrpc", process.port))
            .set("Content-Type", "application/json")
            .send_string(&body.to_string())
        {
            Ok(response) => {
                let mut response_body = String::new();
                response
                    .into_reader()
                    .read_to_string(&mut response_body)
                    .map_err(|error| {
                        format!(
                            "Could not read shutdown response from aria2 process {}: {error}",
                            process.pid
                        )
                    })?;
                let value: serde_json::Value =
                    serde_json::from_str(&response_body).map_err(|error| {
                        format!(
                            "aria2 process {} returned invalid shutdown response: {error}",
                            process.pid
                        )
                    })?;
                if value.get("error").is_some() {
                    return Err(format!(
                        "aria2 process {} rejected the shutdown request",
                        process.pid
                    ));
                }
                Ok(())
            }
            Err(error) => Err(format!(
                "Could not request shutdown from aria2 process {}: {error}",
                process.pid
            )),
        }
    }

    pub fn reconcile_existing(state_dir: &Path) -> Result<(), String> {
        let mut system = System::new();
        system.refresh_processes(ProcessesToUpdate::All, true);
        let existing = matching_processes(&system, state_dir);
        if existing.is_empty() {
            return Ok(());
        }

        for process in &existing {
            log::warn!(target: "helios::diagnostics", "Requesting shutdown of stale aria2 process {} using Helios state", process.pid);
            if let Err(error) = request_shutdown(process) {
                log::warn!(target: "helios::diagnostics", "Shutdown request to stale aria2 process {} failed: {error}", process.pid);
            }
        }

        let deadline = std::time::Instant::now() + Duration::from_secs(8);
        loop {
            std::thread::sleep(Duration::from_millis(100));
            system.refresh_processes(ProcessesToUpdate::All, true);
            let still_running = matching_processes(&system, state_dir)
                .into_iter()
                .filter(|current| {
                    existing.iter().any(|original| {
                        original.pid == current.pid && original.started == current.started
                    })
                })
                .collect::<Vec<_>>();
            if still_running.is_empty() {
                log::info!(target: "helios::diagnostics", "Reconciled {} stale aria2 process(es) using Helios state", existing.len());
                return Ok(());
            }
            if std::time::Instant::now() >= deadline {
                let pids = still_running
                    .iter()
                    .map(|process| process.pid.to_string())
                    .collect::<Vec<_>>()
                    .join(", ");
                return Err(format!("Helios could not stop its previous aria2 process(es) ({pids}); refusing to start another engine against the same state files."));
            }
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use std::path::Path;

    pub struct AriaJob;

    impl AriaJob {
        pub fn new() -> Result<Self, String> {
            Ok(Self)
        }
        pub fn assign(&self, _pid: u32) -> Result<(), String> {
            Ok(())
        }
    }

    pub fn reconcile_existing(_state_dir: &Path) -> Result<(), String> {
        Ok(())
    }
}

pub use platform::AriaJob;

pub fn reconcile_existing(state_dir: &Path) -> Result<(), String> {
    platform::reconcile_existing(state_dir)
}

pub type SharedAriaJob = Arc<AriaJob>;
