use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, Rng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::VecDeque,
    fs,
    io::Read,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use subtle::ConstantTimeEq;
use tauri::{AppHandle, Emitter, Manager, State, Url};
use tiny_http::{Header, Method, Request, Response, Server};

const FIRST_PORT: u16 = 16_780;
const LAST_PORT: u16 = 16_789;
const MAX_BODY: usize = 256 * 1024;
const MAX_ITEMS: usize = 100;
const PAIR_LIFETIME: Duration = Duration::from_secs(120);
const PAIR_LOCKOUT: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeItem {
    url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    referrer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    user_agent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cookie: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    filename: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClientRecord {
    id: String,
    label: String,
    token_hash: String,
    created_at: u64,
    last_used: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeClient {
    id: String,
    label: String,
    created_at: u64,
    last_used: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeState {
    enabled: bool,
    port: u16,
    paired: bool,
    pairing_code: Option<String>,
    pairing_expires_at: Option<u64>,
}

#[derive(Default)]
struct Pairing {
    code: Option<String>,
    expires: Option<Instant>,
    expires_at: Option<u64>,
    failures: u8,
    locked_until: Option<Instant>,
}

#[derive(Debug, PartialEq, Eq)]
enum PairResult {
    Accepted,
    Missing,
    Expired,
    Wrong,
    Locked,
    StorageError,
}

impl Pairing {
    fn begin(&mut self, code: String, now: Instant) -> Result<u64, ()> {
        if self.locked_until.is_some_and(|until| now < until) {
            return Err(());
        }
        self.locked_until = None;
        self.code = Some(code);
        self.expires = Some(now + PAIR_LIFETIME);
        let expires_at = unix_now() + PAIR_LIFETIME.as_secs();
        self.expires_at = Some(expires_at);
        Ok(expires_at)
    }

    fn consume(&mut self, candidate: &str, now: Instant) -> PairResult {
        if self.locked_until.is_some_and(|until| now < until) {
            return PairResult::Locked;
        }
        self.locked_until = None;
        let Some(code) = self.code.as_ref() else {
            return PairResult::Missing;
        };
        if self.expires.is_some_and(|expires| now >= expires) {
            self.clear_code();
            return PairResult::Expired;
        }
        if code == candidate {
            self.clear_code();
            self.failures = 0;
            return PairResult::Accepted;
        }
        self.failures += 1;
        if self.failures >= 5 {
            self.clear_code();
            self.failures = 0;
            self.locked_until = Some(now + PAIR_LOCKOUT);
            PairResult::Locked
        } else {
            PairResult::Wrong
        }
    }

    fn clear_code(&mut self) {
        self.code = None;
        self.expires = None;
        self.expires_at = None;
    }

    fn clear(&mut self) {
        self.clear_code();
    }

    fn active(&mut self, now: Instant) -> (Option<String>, Option<u64>) {
        if self.expires.is_some_and(|expires| now >= expires) {
            self.clear_code();
        }
        (self.code.clone(), self.expires_at)
    }
}

struct BridgeInner {
    app: AppHandle,
    port: u16,
    rpc_port: u16,
    rpc_secret: String,
    enabled: AtomicBool,
    clients_path: PathBuf,
    clients: Mutex<Vec<ClientRecord>>,
    pairing: Mutex<Pairing>,
    stop: AtomicBool,
    agent: ureq::Agent,
    handoff_timings: Mutex<VecDeque<u64>>,
}

pub struct BridgeService {
    inner: Arc<BridgeInner>,
    server: Arc<Server>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl BridgeService {
    pub fn start(
        app: AppHandle,
        clients_path: PathBuf,
        rpc_port: u16,
        rpc_secret: String,
    ) -> Result<Self, String> {
        let clients = load_clients(&clients_path)?;
        let mut bound = None;
        let mut last_error = String::new();
        for port in FIRST_PORT..=LAST_PORT {
            match Server::http(format!("127.0.0.1:{port}")) {
                Ok(server) => {
                    bound = Some((port, Arc::new(server)));
                    break;
                }
                Err(error) => last_error = error.to_string(),
            }
        }
        let (port, server) = bound.ok_or_else(|| {
            format!("Browser bridge could not bind ports {FIRST_PORT}-{LAST_PORT}: {last_error}")
        })?;
        let inner = Arc::new(BridgeInner {
            app,
            port,
            rpc_port,
            rpc_secret,
            enabled: AtomicBool::new(true),
            clients_path,
            clients: Mutex::new(clients),
            pairing: Mutex::new(Pairing::default()),
            stop: AtomicBool::new(false),
            agent: ureq::AgentBuilder::new()
                .timeout(Duration::from_secs(4))
                .try_proxy_from_env(false)
                .build(),
            handoff_timings: Mutex::new(VecDeque::with_capacity(20)),
        });
        let worker_server = server.clone();
        let worker_inner = inner.clone();
        let worker = thread::Builder::new()
            .name("helios-browser-bridge".into())
            .spawn(move || {
                while !worker_inner.stop.load(Ordering::SeqCst) {
                    match worker_server.recv_timeout(Duration::from_millis(150)) {
                        Ok(Some(request)) => handle_request(request, &worker_inner),
                        Ok(None) => {}
                        Err(_) if worker_inner.stop.load(Ordering::SeqCst) => break,
                        Err(_) => break,
                    }
                }
            })
            .map_err(|error| format!("Browser bridge thread could not start: {error}"))?;
        Ok(Self {
            inner,
            server,
            worker: Mutex::new(Some(worker)),
        })
    }

    fn state(&self) -> BridgeState {
        let (pairing_code, pairing_expires_at) =
            self.inner.pairing.lock().unwrap().active(Instant::now());
        BridgeState {
            enabled: self.inner.enabled.load(Ordering::SeqCst),
            port: self.inner.port,
            paired: !self.inner.clients.lock().unwrap().is_empty(),
            pairing_code,
            pairing_expires_at,
        }
    }

    fn set_enabled(&self, enabled: bool) {
        self.inner.enabled.store(enabled, Ordering::SeqCst);
        if !enabled {
            self.inner.pairing.lock().unwrap().clear();
        }
    }

    fn start_pairing(&self) -> Result<BridgeState, String> {
        if !self.inner.enabled.load(Ordering::SeqCst) {
            return Err("Enable the browser bridge before pairing.".into());
        }
        let code = format!("{:06}", rand::thread_rng().gen_range(0..1_000_000));
        self.inner
            .pairing
            .lock()
            .unwrap()
            .begin(code, Instant::now())
            .map_err(|_| "Pairing is temporarily locked. Try again in one minute.".to_string())?;
        Ok(self.state())
    }

    fn cancel_pairing(&self) {
        self.inner.pairing.lock().unwrap().clear();
    }

    fn list_clients(&self) -> Vec<BridgeClient> {
        self.inner
            .clients
            .lock()
            .unwrap()
            .iter()
            .map(|client| BridgeClient {
                id: client.id.clone(),
                label: client.label.clone(),
                created_at: client.created_at,
                last_used: client.last_used,
            })
            .collect()
    }

    fn revoke_client(&self, id: &str) -> Result<(), String> {
        let mut clients = self.inner.clients.lock().unwrap();
        clients.retain(|client| client.id != id);
        persist_clients(&self.inner.clients_path, &clients)
            .map_err(|_| "Could not save browser bridge clients.".to_string())
    }

    fn handoff_timings(&self) -> Vec<u64> {
        self.inner
            .handoff_timings
            .lock()
            .unwrap()
            .iter()
            .copied()
            .collect()
    }

    pub fn stop(&self) {
        self.set_enabled(false);
        self.inner.stop.store(true, Ordering::SeqCst);
        self.server.unblock();
        if let Some(worker) = self.worker.lock().unwrap().take() {
            let _ = worker.join();
        }
    }
}

impl Drop for BridgeService {
    fn drop(&mut self) {
        self.stop();
    }
}

#[tauri::command]
pub fn bridge_get_state(service: State<'_, BridgeService>) -> BridgeState {
    service.state()
}

#[tauri::command]
pub fn bridge_set_enabled(service: State<'_, BridgeService>, enabled: bool) -> BridgeState {
    service.set_enabled(enabled);
    service.state()
}

#[tauri::command]
pub fn bridge_start_pairing(service: State<'_, BridgeService>) -> Result<BridgeState, String> {
    service.start_pairing()
}

#[tauri::command]
pub fn bridge_cancel_pairing(service: State<'_, BridgeService>) {
    service.cancel_pairing();
}

#[tauri::command]
pub fn bridge_list_clients(service: State<'_, BridgeService>) -> Vec<BridgeClient> {
    service.list_clients()
}

#[tauri::command]
pub fn bridge_revoke_client(service: State<'_, BridgeService>, id: String) -> Result<(), String> {
    service.revoke_client(&id)
}

#[tauri::command]
pub fn bridge_get_timings(service: State<'_, BridgeService>) -> Vec<u64> {
    service.handoff_timings()
}

fn handle_request(mut request: Request, inner: &BridgeInner) {
    let request_started = Instant::now();
    let method = request.method().clone();
    let path = request
        .url()
        .split('?')
        .next()
        .unwrap_or_default()
        .to_string();
    let host = single_header(&request, "Host").map(str::to_string);
    let origin_count = header_count(&request, "Origin");
    let origin = single_header(&request, "Origin").map(str::to_string);

    if header_count(&request, "Host") != 1 || !valid_host(host.as_deref(), inner.port) {
        respond_json(request, 403, json!({ "error": "Forbidden" }), None);
        return;
    }
    if origin_count > 1 || !valid_origin(origin.as_deref()) {
        respond_json(request, 403, json!({ "error": "Forbidden" }), None);
        return;
    }
    let body = match read_body(&mut request) {
        Ok(body) => body,
        Err(status) => {
            respond_json(
                request,
                status,
                json!({ "error": "Invalid request" }),
                origin.as_deref(),
            );
            return;
        }
    };
    if method == Method::Options {
        if !is_preflight_allowed(host.as_deref(), origin.as_deref(), inner.port) {
            respond_json(request, 403, json!({ "error": "Forbidden" }), None);
            return;
        }
        respond_preflight(request, origin.as_deref().unwrap());
        return;
    }
    if !inner.enabled.load(Ordering::SeqCst) {
        respond_json(
            request,
            403,
            json!({ "error": "Forbidden" }),
            origin.as_deref(),
        );
        return;
    }

    if method == Method::Get && path == "/v1/ping" {
        let paired = !inner.clients.lock().unwrap().is_empty();
        respond_json(
            request,
            200,
            json!({ "app": "helios", "version": env!("CARGO_PKG_VERSION"), "bridge": 1, "paired": paired }),
            origin.as_deref(),
        );
        return;
    }

    if !(method == Method::Post && path == "/v1/pair") && !authorized(&request, inner) {
        respond_json(
            request,
            401,
            json!({ "error": "Unauthorized" }),
            origin.as_deref(),
        );
        return;
    }

    match (method, path.as_str()) {
        (Method::Get, "/v1/status") => {
            let result = aria2_call(inner, "aria2.getGlobalStat", vec![]);
            let (online, active, download, upload) = match result {
                Ok(stat) => (
                    true,
                    stat["numActive"]
                        .as_str()
                        .and_then(|v| v.parse::<u64>().ok())
                        .unwrap_or(0),
                    stat["downloadSpeed"]
                        .as_str()
                        .and_then(|v| v.parse::<u64>().ok())
                        .unwrap_or(0),
                    stat["uploadSpeed"]
                        .as_str()
                        .and_then(|v| v.parse::<u64>().ok())
                        .unwrap_or(0),
                ),
                Err(_) => (false, 0, 0, 0),
            };
            respond_json(
                request,
                200,
                json!({ "version": env!("CARGO_PKG_VERSION"), "online": online, "active": active, "speeds": { "download": download, "upload": upload } }),
                origin.as_deref(),
            );
        }
        (Method::Post, "/v1/pair") => {
            let body = match serde_json::from_slice::<PairRequest>(&body) {
                Ok(body) => body,
                Err(_) => {
                    respond_json(
                        request,
                        400,
                        json!({ "error": "Invalid request" }),
                        origin.as_deref(),
                    );
                    return;
                }
            };
            match pair_client(inner, &body.code, &body.label) {
                Ok(token) => {
                    respond_json(request, 200, json!({ "token": token }), origin.as_deref())
                }
                Err(PairResult::Wrong | PairResult::Expired | PairResult::Missing) => respond_json(
                    request,
                    401,
                    json!({ "error": "Invalid pairing code" }),
                    origin.as_deref(),
                ),
                Err(PairResult::Locked) => respond_json(
                    request,
                    429,
                    json!({ "error": "Pairing temporarily locked" }),
                    origin.as_deref(),
                ),
                Err(_) => respond_json(
                    request,
                    500,
                    json!({ "error": "Pairing failed" }),
                    origin.as_deref(),
                ),
            }
        }
        (Method::Post, "/v1/add") => {
            let body = match serde_json::from_slice::<AddRequest>(&body) {
                Ok(body) if !body.items.is_empty() && body.items.len() <= MAX_ITEMS => body,
                Ok(_) => {
                    respond_json(
                        request,
                        400,
                        json!({ "error": "Invalid request" }),
                        origin.as_deref(),
                    );
                    return;
                }
                Err(_) => {
                    respond_json(
                        request,
                        400,
                        json!({ "error": "Invalid request" }),
                        origin.as_deref(),
                    );
                    return;
                }
            };
            if body.items.iter().any(|item| {
                Url::parse(&item.url).is_ok_and(|url| url.scheme() == "ftp")
            }) {
                respond_json(
                    request,
                    400,
                    json!({ "error": "FTP downloads are not supported. Use HTTP, HTTPS, or magnet links." }),
                    origin.as_deref(),
                );
                return;
            }
            let items = match body
                .items
                .into_iter()
                .map(sanitize_item)
                .collect::<Result<Vec<_>, _>>()
            {
                Ok(items) => items,
                Err(()) => {
                    respond_json(
                        request,
                        400,
                        json!({ "error": "Invalid download item" }),
                        origin.as_deref(),
                    );
                    return;
                }
            };
            match body.mode.as_str() {
                "ask" => {
                    if inner
                        .app
                        .emit("bridge://add", json!({ "items": items }))
                        .is_err()
                    {
                        respond_json(
                            request,
                            503,
                            json!({ "error": "Helios is unavailable" }),
                            origin.as_deref(),
                        );
                    } else {
                        respond_json(
                            request,
                            200,
                            json!({ "ok": true, "queued": true }),
                            origin.as_deref(),
                        );
                    }
                }
                "start" => {
                    let mut gids = Vec::with_capacity(items.len());
                    let mut retry_sources = Vec::with_capacity(items.len());
                    for item in &items {
                        match aria2_call(
                            inner,
                            "aria2.addUri",
                            vec![json!([item.url]), json!(options_for(item))],
                        ) {
                            Ok(gid) if gid.is_string() => {
                                let gid = gid.as_str().unwrap_or_default().to_string();
                                gids.push(gid.clone());
                                retry_sources.push(json!({ "gid": gid, "uri": item.url }));
                                let _ = inner.app.emit(
                                    "bridge://started",
                                    json!({ "name": bridge_item_label(item) }),
                                );
                            }
                            Ok(_) => {
                                eprintln!("[browser-bridge] aria2.addUri failed: response did not contain a GID");
                                respond_json(
                                    request,
                                    502,
                                    json!({ "error": "Could not add downloads", "code": "aria2_add_failed" }),
                                    origin.as_deref(),
                                );
                                return;
                            }
                            Err(error) => {
                                eprintln!("[browser-bridge] aria2.addUri failed: {error}");
                                respond_json(
                                    request,
                                    502,
                                    json!({ "error": "Could not add downloads", "code": "aria2_add_failed" }),
                                    origin.as_deref(),
                                );
                                return;
                            }
                        }
                    }
                    let elapsed_ms =
                        request_started.elapsed().as_millis().min(u64::MAX as u128) as u64;
                    record_handoff_timing(&inner.handoff_timings, elapsed_ms);
                    let _ = inner.app.emit(
                        "bridge://added",
                        json!({ "gids": gids, "sources": retry_sources }),
                    );
                    respond_json(
                        request,
                        200,
                        json!({ "ok": true, "gids": gids }),
                        origin.as_deref(),
                    );
                }
                _ => respond_json(
                    request,
                    400,
                    json!({ "error": "Invalid request" }),
                    origin.as_deref(),
                ),
            }
        }
        (Method::Post, "/v1/show") => {
            if let Some(window) = inner.app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
                respond_json(request, 200, json!({ "ok": true }), origin.as_deref());
            } else {
                respond_json(
                    request,
                    503,
                    json!({ "error": "Helios is unavailable" }),
                    origin.as_deref(),
                );
            }
        }
        _ => respond_json(
            request,
            404,
            json!({ "error": "Not found" }),
            origin.as_deref(),
        ),
    }
}

fn record_handoff_timing(timings: &Mutex<VecDeque<u64>>, elapsed_ms: u64) {
    let mut timings = timings.lock().unwrap();
    timings.push_back(elapsed_ms);
    if timings.len() > 20 {
        timings.pop_front();
    }
}

#[derive(Deserialize)]
struct PairRequest {
    code: String,
    #[serde(default)]
    label: String,
}

#[derive(Deserialize)]
struct AddRequest {
    mode: String,
    items: Vec<BridgeItem>,
}

fn read_body(request: &mut Request) -> Result<Vec<u8>, u16> {
    if request
        .body_length()
        .is_some_and(|length| length > MAX_BODY)
    {
        return Err(413);
    }
    let mut bytes = Vec::new();
    request
        .as_reader()
        .take((MAX_BODY + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| 400_u16)?;
    if bytes.len() > MAX_BODY {
        return Err(413);
    }
    Ok(bytes)
}

fn header_count(request: &Request, name: &'static str) -> usize {
    request
        .headers()
        .iter()
        .filter(|header| header.field.equiv(name))
        .count()
}

fn single_header<'a>(request: &'a Request, name: &'static str) -> Option<&'a str> {
    let mut values = request
        .headers()
        .iter()
        .filter(|header| header.field.equiv(name));
    let value = values.next()?.value.as_str();
    values.next().is_none().then_some(value)
}

fn respond_json(request: Request, status: u16, value: Value, origin: Option<&str>) {
    let body = serde_json::to_string(&value).unwrap_or_else(|_| "{}".into());
    let mut response = Response::from_string(body).with_status_code(status);
    response
        .add_header(Header::from_bytes("Content-Type", "application/json; charset=utf-8").unwrap());
    response.add_header(Header::from_bytes("Cache-Control", "no-store").unwrap());
    if let Some(origin) = origin.filter(|origin| valid_origin(Some(origin))) {
        response.add_header(Header::from_bytes("Access-Control-Allow-Origin", origin).unwrap());
        response.add_header(Header::from_bytes("Vary", "Origin").unwrap());
    }
    let _ = request.respond(response);
}

fn respond_preflight(request: Request, origin: &str) {
    let mut response = Response::empty(204);
    response.add_header(Header::from_bytes("Access-Control-Allow-Origin", origin).unwrap());
    response.add_header(
        Header::from_bytes("Access-Control-Allow-Methods", "GET, POST, OPTIONS").unwrap(),
    );
    response.add_header(
        Header::from_bytes(
            "Access-Control-Allow-Headers",
            "Authorization, Content-Type",
        )
        .unwrap(),
    );
    response.add_header(Header::from_bytes("Access-Control-Max-Age", "600").unwrap());
    response.add_header(Header::from_bytes("Vary", "Origin").unwrap());
    let _ = request.respond(response);
}

fn valid_host(host: Option<&str>, port: u16) -> bool {
    host.is_some_and(|host| {
        let Some((hostname, host_port)) = host.rsplit_once(':') else {
            return false;
        };
        host_port == port.to_string()
            && (hostname == "127.0.0.1" || hostname.eq_ignore_ascii_case("localhost"))
    })
}

fn valid_origin(origin: Option<&str>) -> bool {
    origin.is_none_or(|origin| {
        origin.starts_with("moz-extension://")
            && !origin.bytes().any(|byte| byte < 0x20 || byte == 0x7f)
    })
}

fn is_preflight_allowed(host: Option<&str>, origin: Option<&str>, port: u16) -> bool {
    valid_host(host, port) && origin.is_some() && valid_origin(origin)
}

fn allowed_url(value: &str) -> bool {
    if value.len() > 8192 {
        return false;
    }
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    match url.scheme() {
        "http" | "https" => url.host_str().is_some(),
        "magnet" => url.query().is_some_and(|query| !query.is_empty()),
        _ => false,
    }
}

fn sanitize_filename(filename: Option<&str>) -> Option<String> {
    let filename = filename?.trim();
    if filename.is_empty() {
        return None;
    }
    let mut sanitized = String::with_capacity(filename.len().min(200));
    for character in filename.chars() {
        sanitized.push(
            if character.is_control() || "<>:\"/\\|?*".contains(character) {
                '_'
            } else {
                character
            },
        );
    }
    while sanitized.contains("..") {
        sanitized = sanitized.replace("..", "_");
    }
    let mut sanitized = sanitized
        .trim_matches([' ', '.'])
        .chars()
        .take(200)
        .collect::<String>();
    sanitized = sanitized.trim_matches([' ', '.']).to_string();
    if sanitized.is_empty() {
        return None;
    }
    let base = sanitized
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end_matches([' ', '.']);
    let upper = base.to_ascii_uppercase();
    let reserved = matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| {
            upper
                .strip_prefix(prefix)
                .is_some_and(|tail| tail.len() == 1 && matches!(tail.as_bytes()[0], b'1'..=b'9'))
        });
    if reserved {
        sanitized.insert(0, '_');
    }
    sanitized = sanitized.chars().take(200).collect();
    Some(sanitized)
}

fn sanitize_item(item: BridgeItem) -> Result<BridgeItem, ()> {
    if !allowed_url(&item.url)
        || [&item.referrer, &item.user_agent, &item.cookie]
            .into_iter()
            .flatten()
            .any(|value| value.contains('\r') || value.contains('\n'))
    {
        return Err(());
    }
    Ok(BridgeItem {
        url: item.url,
        referrer: item.referrer,
        user_agent: item.user_agent,
        cookie: item.cookie,
        filename: sanitize_filename(item.filename.as_deref()),
    })
}

fn options_for(item: &BridgeItem) -> Map<String, Value> {
    let mut options = Map::new();
    if let Some(value) = item.referrer.as_ref().filter(|value| !value.is_empty()) {
        options.insert("referer".into(), json!(value));
    }
    if let Some(value) = item.user_agent.as_ref().filter(|value| !value.is_empty()) {
        options.insert("user-agent".into(), json!(value));
    }
    if let Some(value) = item.filename.as_ref() {
        options.insert("out".into(), json!(value));
    }
    if let Some(value) = item.cookie.as_ref().filter(|value| !value.is_empty()) {
        options.insert("header".into(), json!([format!("Cookie: {value}")]));
    }
    options
}

fn bridge_item_label(item: &BridgeItem) -> String {
    item.filename.clone().unwrap_or_else(|| {
        Url::parse(&item.url)
            .ok()
            .and_then(|url| url.host_str().map(str::to_owned))
            .unwrap_or_else(|| "magnet download".into())
    })
}

fn hash_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn token_matches(stored_hash: &str, token: &str) -> bool {
    hash_token(token)
        .as_bytes()
        .ct_eq(stored_hash.as_bytes())
        .into()
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn sanitize_label(value: &str) -> String {
    let label = value
        .chars()
        .filter(|character| !character.is_control())
        .take(80)
        .collect::<String>();
    let label = label.trim();
    if label.is_empty() {
        "Browser extension".into()
    } else {
        label.into()
    }
}

fn pair_client(inner: &BridgeInner, code: &str, label: &str) -> Result<String, PairResult> {
    if code.len() != 6 || !code.bytes().all(|byte| byte.is_ascii_digit()) {
        let result = inner.pairing.lock().unwrap().consume(code, Instant::now());
        return Err(result);
    }
    let result = inner.pairing.lock().unwrap().consume(code, Instant::now());
    if result != PairResult::Accepted {
        return Err(result);
    }
    let token = random_token();
    let mut clients = inner.clients.lock().unwrap();
    clients.push(ClientRecord {
        id: uuid::Uuid::new_v4().to_string(),
        label: sanitize_label(label),
        token_hash: hash_token(&token),
        created_at: unix_now(),
        last_used: None,
    });
    if persist_clients(&inner.clients_path, &clients).is_err() {
        clients.pop();
        return Err(PairResult::StorageError);
    }
    Ok(token)
}

fn authorized(request: &Request, inner: &BridgeInner) -> bool {
    let Some(token) =
        single_header(request, "Authorization").and_then(|value| value.strip_prefix("Bearer "))
    else {
        return false;
    };
    let mut clients = inner.clients.lock().unwrap();
    let Some(client) = clients
        .iter_mut()
        .find(|client| token_matches(&client.token_hash, token))
    else {
        return false;
    };
    client.last_used = Some(unix_now());
    persist_clients(&inner.clients_path, &clients).is_ok()
}

fn load_clients(path: &PathBuf) -> Result<Vec<ClientRecord>, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| "Browser bridge client store is invalid.".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(_) => Err("Browser bridge client store could not be read.".into()),
    }
}

fn persist_clients(path: &PathBuf, clients: &[ClientRecord]) -> std::io::Result<()> {
    let bytes = serde_json::to_vec_pretty(clients).map_err(std::io::Error::other)?;
    fs::write(path, bytes)
}

#[derive(Debug)]
enum Aria2CallError {
    Transport,
    RequestSerialization,
    InvalidResponse,
    Rpc { code: Option<i64> },
    MissingResult,
}

impl std::fmt::Display for Aria2CallError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Transport => formatter.write_str("RPC transport failed"),
            Self::RequestSerialization => {
                formatter.write_str("RPC request could not be serialized")
            }
            Self::InvalidResponse => formatter.write_str("RPC response was not valid JSON"),
            Self::Rpc { code: Some(code) } => {
                write!(formatter, "aria2 returned RPC error code {code}")
            }
            Self::Rpc { code: None } => formatter.write_str("aria2 returned an RPC error"),
            Self::MissingResult => formatter.write_str("RPC response did not contain a result"),
        }
    }
}

fn aria2_call(
    inner: &BridgeInner,
    method: &str,
    params: Vec<Value>,
) -> Result<Value, Aria2CallError> {
    let mut params = params;
    params.insert(0, json!(format!("token:{}", inner.rpc_secret)));
    let body = serde_json::to_string(&json!({
        "jsonrpc": "2.0",
        "id": "helios-browser-bridge",
        "method": method,
        "params": params,
    }))
    .map_err(|_| Aria2CallError::RequestSerialization)?;
    let response = inner
        .agent
        .post(&format!("http://127.0.0.1:{}/jsonrpc", inner.rpc_port))
        .set("Content-Type", "application/json")
        .send_string(&body)
        .map_err(|_| Aria2CallError::Transport)?;
    let response = response
        .into_string()
        .map_err(|_| Aria2CallError::InvalidResponse)?;
    let value: Value =
        serde_json::from_str(&response).map_err(|_| Aria2CallError::InvalidResponse)?;
    if let Some(error) = value.get("error") {
        return Err(Aria2CallError::Rpc {
            code: error.get("code").and_then(Value::as_i64),
        });
    }
    value
        .get("result")
        .cloned()
        .ok_or(Aria2CallError::MissingResult)
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn host_and_origin_policy_rejects_rebinding_and_web_pages() {
        assert!(valid_host(Some("127.0.0.1:16780"), 16780));
        assert!(valid_host(Some("LOCALHOST:16780"), 16780));
        assert!(!valid_host(Some("localhost.evil:16780"), 16780));
        assert!(!valid_host(Some("127.0.0.1:16781"), 16780));
        assert!(!valid_host(Some("localhost"), 16780));
        assert!(valid_origin(None));
        assert!(valid_origin(Some("moz-extension://abc")));
        assert!(!valid_origin(Some("https://example.com")));
        assert!(!is_preflight_allowed(
            None,
            Some("moz-extension://abc"),
            16780
        ));
        assert!(is_preflight_allowed(
            Some("localhost:16780"),
            Some("moz-extension://abc"),
            16780
        ));
        assert!(!is_preflight_allowed(
            Some("localhost:16780"),
            Some("https://example.com"),
            16780
        ));
    }

    #[test]
    fn pairing_code_expires_and_is_single_use() {
        let now = Instant::now();
        let mut pairing = Pairing::default();
        pairing.begin("123456".into(), now).unwrap();
        assert_eq!(pairing.consume("123456", now), PairResult::Accepted);
        assert_eq!(pairing.consume("123456", now), PairResult::Missing);

        pairing.begin("654321".into(), now).unwrap();
        assert_eq!(
            pairing.consume("654321", now + Duration::from_secs(121)),
            PairResult::Expired
        );
    }

    #[test]
    fn pairing_locks_after_five_wrong_attempts() {
        let now = Instant::now();
        let mut pairing = Pairing::default();
        pairing.begin("123456".into(), now).unwrap();
        for _ in 0..4 {
            assert_eq!(pairing.consume("000000", now), PairResult::Wrong);
        }
        assert_eq!(pairing.consume("000000", now), PairResult::Locked);
        assert!(pairing.begin("654321".into(), now).is_err());
        assert_eq!(
            pairing.consume("123456", now + Duration::from_secs(60)),
            PairResult::Missing
        );
    }

    #[test]
    fn token_is_hashed_and_compared_in_constant_time_helper() {
        let hash = hash_token("secret-token");
        assert_ne!(hash, "secret-token");
        assert!(token_matches(&hash, "secret-token"));
        assert!(!token_matches(&hash, "other-token"));
    }

    #[test]
    fn handoff_timings_keep_only_the_latest_twenty() {
        let timings = Mutex::new(VecDeque::new());
        for elapsed in 0..25 {
            record_handoff_timing(&timings, elapsed);
        }
        assert_eq!(
            timings.lock().unwrap().iter().copied().collect::<Vec<_>>(),
            (5..25).map(|value| value as u64).collect::<Vec<_>>()
        );
    }

    #[test]
    fn url_scheme_allow_list_and_length_are_enforced() {
        for url in [
            "http://example.com/a",
            "https://example.com/a",
            "magnet:?xt=urn:btih:abc",
        ] {
            assert!(allowed_url(url), "{url}");
        }
        for url in [
            "ftp://example.com/a",
            "file:///tmp/a",
            "javascript:alert(1)",
            "data:text/plain,x",
        ] {
            assert!(!allowed_url(url), "{url}");
        }
        assert!(!allowed_url(&format!(
            "https://example.com/{}",
            "x".repeat(8200)
        )));
    }

    #[test]
    fn filename_is_sanitized_without_paths_traversal_or_reserved_names() {
        assert_eq!(
            sanitize_filename(Some("../folder\\report.txt")),
            Some("__folder_report.txt".into())
        );
        assert_eq!(sanitize_filename(Some("CON.txt")), Some("_CON.txt".into()));
        assert_eq!(
            sanitize_filename(Some(&"x".repeat(240)))
                .unwrap()
                .chars()
                .count(),
            200
        );
    }

    #[test]
    fn header_values_reject_crlf_and_options_only_map_allowed_fields() {
        let mut item = BridgeItem {
            url: "https://example.com/file".into(),
            referrer: Some("https://example.com/page".into()),
            user_agent: Some("Helios Extension".into()),
            cookie: Some("a=b".into()),
            filename: Some("file.zip".into()),
        };
        let options = options_for(&sanitize_item(item.clone()).unwrap());
        assert_eq!(options["referer"], "https://example.com/page");
        assert_eq!(options["user-agent"], "Helios Extension");
        assert_eq!(options["out"], "file.zip");
        assert_eq!(options["header"][0], "Cookie: a=b");
        assert_eq!(options.len(), 4);

        item.cookie = Some("a=b\r\nX-Evil: yes".into());
        assert!(sanitize_item(item).is_err());
    }
}
