import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { Aria2 } from "./aria2";
import * as historyStore from "./history";
import type { HistoryEntry } from "./history";
import { dominantCategory, fileCategory, type FileCategory } from "./format";
import { readValue, writeValue } from "./persistence";
import { selectionTotals, type TorrentFile } from "./torrent-files";
import { redactDiagnostics } from "./diagnostics";
import { reconcileTaskSnapshot } from "./task-snapshot";
import { taskActionForAria2Status } from "./task-actions";

export type UiState = "dl" | "seed" | "pa" | "done" | "err";
export type Filter = "all" | "dl" | "seed" | "done";
export type Task = {
  gid: string;
  name: string;
  size: number;
  done: number;
  speed: number;
  upSpeed: number;
  upTotal: number;
  seeds: number;
  peers: number;
  state: UiState;
  queued: boolean;
  since: number;
  category: FileCategory;
  dir: string;
  files: TorrentFile[];
  torrent: boolean;
  errorMessage: string;
  errorCode: string;
};
export type AddOptions = Record<string, string | string[]>;
type RetrySource = { kind: "uris"; uris: string[] };
type RetrySourceMap = Record<string, RetrySource>;
export type Settings = {
  maxDownloadMB: number;
  maxUploadMB: number;
  maxConcurrent: number;
  connectionsPerServer: number;
  downloadDir: string;
  closeToTray: boolean;
  startWithWindows: boolean;
  bridgeEnabled: boolean;
  proxyMode: "none" | "manual";
  proxyUrl: string;
  proxyUser: string;
  proxyPassword: string;
  noProxy: string;
  seedRatio: number;
  seedTimeHours: number | "";
  neverSeed: boolean;
  fileConflict: "rename" | "overwrite" | "error";
  diskAllocation: "none" | "prealloc" | "falloc";
  notifyFinished: boolean;
  notifyFailed: boolean;
  notifyBrowserAdds: boolean;
  confirmBeforeRemoving: boolean;
  deleteFilesWhenRemoving: boolean;
  chooseFilesBeforeStarting: boolean;
  theme: "system" | "dark" | "light";
  compactList: boolean;
  reduceMotion: boolean;
  startMinimized: boolean;
  connectTimeoutSeconds: number;
  customUserAgent: string;
};

export const DEFAULT_SETTINGS: Settings = {
  maxDownloadMB: 0,
  maxUploadMB: 0,
  maxConcurrent: 5,
  connectionsPerServer: 16,
  downloadDir: "",
  closeToTray: true,
  startWithWindows: false,
  bridgeEnabled: true,
  proxyMode: "none",
  proxyUrl: "",
  proxyUser: "",
  proxyPassword: "",
  noProxy: "",
  seedRatio: 1,
  seedTimeHours: "",
  neverSeed: false,
  fileConflict: "rename",
  diskAllocation: "prealloc",
  notifyFinished: true,
  notifyFailed: true,
  notifyBrowserAdds: true,
  confirmBeforeRemoving: true,
  deleteFilesWhenRemoving: false,
  chooseFilesBeforeStarting: false,
  theme: "system",
  compactList: false,
  reduceMotion: false,
  startMinimized: true,
  connectTimeoutSeconds: 10,
  customUserAgent: "",
};

export function clampSettings(settings: Settings): Settings {
  return {
    ...settings,
    proxyMode: settings.proxyMode === "manual" ? "manual" : "none",
    fileConflict: ["rename", "overwrite", "error"].includes(settings.fileConflict) ? settings.fileConflict : DEFAULT_SETTINGS.fileConflict,
    diskAllocation: ["none", "prealloc", "falloc"].includes(settings.diskAllocation) ? settings.diskAllocation : DEFAULT_SETTINGS.diskAllocation,
    theme: ["system", "dark", "light"].includes(settings.theme) ? settings.theme : DEFAULT_SETTINGS.theme,
    maxDownloadMB: clamp(settings.maxDownloadMB, 0, 100000),
    maxUploadMB: clamp(settings.maxUploadMB, 0, 100000),
    maxConcurrent: Math.round(clamp(settings.maxConcurrent, 1, 20)),
    connectionsPerServer: Math.round(clamp(settings.connectionsPerServer, 1, 16)),
    seedRatio: clamp(settings.seedRatio, 0, 1000),
    seedTimeHours: settings.seedTimeHours === "" ? "" : clamp(settings.seedTimeHours, 0, 8760),
    connectTimeoutSeconds: Math.round(clamp(settings.connectTimeoutSeconds, 1, 60)),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function numberPlaceholder(value: number | "", zeroText: string) {
  return value === 0 || value === "" ? zeroText : undefined;
}

export function numberFieldState(value: number | "", zeroText: string) {
  return { value: value === 0 ? "" : value, placeholder: numberPlaceholder(value, zeroText) };
}

const recentDiagnosticErrors: string[] = [];
const notifiedFailures = new Set<string>();
export function getRecentDiagnosticErrors() { return [...recentDiagnosticErrors]; }
function recordDiagnosticError(error: unknown) {
  recentDiagnosticErrors.push(redactDiagnostics(error instanceof Error ? error.message : String(error)));
  if (recentDiagnosticErrors.length > 20) recentDiagnosticErrors.shift();
}
export const N = 48;
export const ARIA2_URL =
  process.env.NEXT_PUBLIC_ARIA2_URL ?? "ws://127.0.0.1:6800/jsonrpc";
const BROWSER_SECRET = process.env.NEXT_PUBLIC_ARIA2_SECRET ?? "helios-dev";
const KEYS = [
  "gid",
  "status",
  "totalLength",
  "completedLength",
  "downloadSpeed",
  "uploadSpeed",
  "uploadLength",
  "numSeeders",
  "connections",
  "seeder",
  "bittorrent",
  "files",
  "dir",
  "errorMessage",
  "errorCode",
];

/** Time of the last poll. Read by the chart's animation loop, so it lives outside React state. */
export const clock = { t: 0 };

interface S {
  online: boolean;
  ariaVersion: string;
  connectedOnce: boolean;
  ready: boolean;
  rpcUrl: string;
  tasks: Task[];
  history: HistoryEntry[];
  filter: Filter;
  category?: FileCategory;
  sel?: string;
  series: "dl" | "ul";
  notify: boolean;
  view: "tasks" | "settings";
  settings: Settings;
  settingsError?: string;
  dl: number;
  up: number;
  dlHist: number[];
  upHist: number[];
  start(): Promise<void>;
  reconnect(): void;
  setFilter(f: Filter): void;
  setCategory(c?: FileCategory): void;
  select(g: string): void;
  setSeries(s: "dl" | "ul"): void;
  setView(v: "tasks" | "settings"): void;
  setNotify(v: boolean): void;
  notifyAddedDownload(name: string): Promise<void>;
  updateSettings(settings: Partial<Settings>): Promise<void>;
  updateAutostart(enabled: boolean): Promise<void>;
  clearHistory(): Promise<void>;
  removeHistory(id: string): Promise<void>;
  shutdown(): Promise<void>;
  saveSession(): Promise<void>;
  toggle(t: Task): Promise<void>;
  add(uri: string): void;
  addUris(uris: string[], options?: AddOptions): Promise<string[]>;
  addUri(uri: string, options?: AddOptions): Promise<string>;
  addTorrent(torrent: string, options?: AddOptions): Promise<string>;
  torrentFiles(gid: string): Promise<TorrentFile[]>;
  torrentFollowedBy(gid: string): Promise<string[]>;
  selectTorrentFiles(
    gid: string,
    indexes: string,
    wasActive: boolean
  ): Promise<void>;
  cancelTorrentSelection(gids: string[]): Promise<void>;
  taskUris(gid: string): Promise<string[]>;
  removeTask(task: Task, alsoDeleteFiles?: boolean): Promise<void>;
  retryTask(task: Task): Promise<void>;
  pauseAll(): Promise<void>;
  resumeAll(): Promise<void>;
}

let api: Aria2 | undefined;
export async function getAria2Version(): Promise<string> {
  if (!api) return "unavailable";
  try { return (await api.call<{ version?: string }>("getVersion")).version ?? "unknown"; }
  catch { return "unavailable"; }
}
let rpcSecret = BROWSER_SECRET;
let starting: Promise<void> | undefined;
let busy = false;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let shutdownRequested = false;
let shutdownPromise: Promise<void> | undefined;
let stoppedRevision = 1;
let loadedStoppedRevision = 0;
let stoppedCache: Record<string, any>[] = [];
let retrySources: RetrySourceMap = {};
let retrySourcesWrite = Promise.resolve();
let refreshTicks = 0;
let unlistenBridgeAdded: UnlistenFn | undefined;
let aria2DefaultDir: string | undefined;
const seen = new Map<string, number>();
const pendingCompletions = new Set<string>();
const completing = new Set<string>();
const same = (a: Task, b: Task) =>
  (Object.keys(a) as (keyof Task)[]).every((k) =>
    k === "files"
      ? a.files.length === b.files.length &&
        a.files.every((file, index) => {
          const other = b.files[index];
          return (
            file.path === other?.path &&
            file.index === other.index &&
            file.length === other.length &&
            file.completedLength === other.completedLength &&
            file.selected === other.selected
          );
        })
      : a[k] === b[k]
  );
const inTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function toTask(r: any): Task | undefined {
  const torrent = Boolean(r.bittorrent);
  const files: TorrentFile[] = (r.files ?? []).map(
    (file: any, index: number) => ({
      index: Number(file.index) || index + 1,
      path: file.path ?? "",
      length: +file.length || 0,
      completedLength: +file.completedLength || 0,
      selected: file.selected === "true",
    })
  );
  const selectedTotals = selectionTotals(files);
  const size = torrent && files.length ? selectedTotals.size : +r.totalLength;
  const completed =
    torrent && files.length ? selectedTotals.completed : +r.completedLength;
  const st: string = r.status;
  const state: UiState | undefined =
    st === "complete"
      ? "done"
      : st === "error"
        ? "err"
        : st === "active"
          ? r.seeder === "true"
            ? "seed"
            : "dl"
          : st === "paused" || st === "waiting"
            ? "pa"
            : undefined;
  if (!state) return undefined;
  const paths = files.map((file) => file.path);
  const name = r.bittorrent?.info?.name ?? paths[0]?.split(/[\\/]/).pop() ?? "";
  if (state === "dl" && !seen.has(r.gid)) seen.set(r.gid, Date.now());
  return {
    gid: r.gid,
    name: name || (state === "dl" ? "Connecting..." : r.gid),
    size,
    done: size ? completed / size : 0,
    speed: +r.downloadSpeed,
    upSpeed: +r.uploadSpeed,
    upTotal: +r.uploadLength,
    seeds: +r.numSeeders || 0,
    peers: +r.connections || 0,
    state,
    queued: st === "waiting",
    since: seen.get(r.gid) ?? Date.now(),
    category:
      fileCategory(name) === "other"
        ? dominantCategory(paths)
        : fileCategory(name),
    dir: r.dir ?? "",
    files,
    torrent,
    errorMessage: String(r.errorMessage ?? ""),
    errorCode: String(r.errorCode ?? ""),
  };
}

export function validateProxy(value: string): string | undefined {
  const input = value.trim();
  if (!input) return "Enter a proxy host and port, such as proxy.example:3128.";
  if (/\s/.test(input)) return "Enter a valid proxy host and port.";
  const candidate = /^https?:\/\//i.test(input) ? input : `http://${input}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return "Use an HTTP or HTTPS proxy.";
    if (!url.hostname || url.username || url.password || url.search || url.hash)
      return "Enter a valid proxy host and port.";
    const authority = candidate.match(/^https?:\/\/([^/?#]+)/i)?.[1] ?? "";
    const portText = authority.startsWith("[")
      ? authority.match(/^\[[^\]]+\]:(\d+)$/)?.[1]
      : authority.match(/^.+:(\d+)$/)?.[1];
    const port = Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      return "Enter a proxy port from 1 to 65535.";
    return undefined;
  } catch {
    return "Enter a valid proxy host and port.";
  }
}

export function optionsFor(settings: Settings, defaultDir?: string) {
  return {
    "max-overall-download-limit": String(
      Math.round(settings.maxDownloadMB * 1048576)
    ),
    "max-overall-upload-limit": String(
      Math.round(settings.maxUploadMB * 1048576)
    ),
    "max-concurrent-downloads": String(settings.maxConcurrent),
    "max-connection-per-server": String(settings.connectionsPerServer),
    split: String(settings.connectionsPerServer),
    "file-allocation": settings.diskAllocation,
    "connect-timeout": String(settings.connectTimeoutSeconds),
    "user-agent": settings.customUserAgent,
    "all-proxy":
      settings.proxyMode === "manual" ? settings.proxyUrl.trim() : "",
    "all-proxy-user": settings.proxyMode === "manual" ? settings.proxyUser : "",
    "all-proxy-passwd":
      settings.proxyMode === "manual" ? settings.proxyPassword : "",
    "no-proxy": settings.proxyMode === "manual" ? settings.noProxy.trim() : "",
    "seed-ratio": settings.neverSeed ? "" : String(settings.seedRatio),
    "seed-time": settings.neverSeed
      ? "0"
      : settings.seedTimeHours === ""
        ? ""
        : String(Math.round(settings.seedTimeHours * 60)),
    "auto-file-renaming": String(settings.fileConflict === "rename"),
    "allow-overwrite": String(settings.fileConflict === "overwrite"),
    ...(settings.downloadDir || defaultDir
      ? { dir: settings.downloadDir || defaultDir }
      : {}),
  };
}

export const useStore = create<S>((set, get) => {
  async function applySettings(settings = get().settings) {
    if (!api) return;
    const proxyError =
      settings.proxyMode === "manual"
        ? validateProxy(settings.proxyUrl)
        : undefined;
    if (proxyError) {
      set({ settingsError: proxyError });
      return;
    }
    try {
      if (!aria2DefaultDir)
        aria2DefaultDir = (
          await api.call<Record<string, string>>("getGlobalOption")
        ).dir;
      await api.call(
        "changeGlobalOption",
        optionsFor(settings, aria2DefaultDir)
      );
      set({ settingsError: undefined });
    } catch {
      set({ settingsError: "aria2 could not apply these settings." });
      recordDiagnosticError("aria2 could not apply preferences");
    }
  }

  async function refresh(fetchStopped = false) {
    if (fetchStopped) stoppedRevision++;
    if (!api || busy || shutdownRequested) return;
    busy = true;
    const client = api;
    const requestedStoppedRevision = stoppedRevision;
    const shouldFetchStopped = requestedStoppedRevision > loadedStoppedRevision;
    try {
      const c = (m: string, ...p: any[]) => ({
        methodName: `aria2.${m}`,
        params: [`token:${rpcSecret}`, ...p],
      });
      const calls = [c("tellActive", KEYS), c("tellWaiting", 0, 5000, KEYS)];
      const stoppedIndex = calls.length;
      if (shouldFetchStopped) calls.push(c("tellStopped", 0, 100, KEYS));
      const statIndex = calls.length;
      calls.push(c("getGlobalStat"));
      const r = await client.call("system.multicall", calls);
      if (shouldFetchStopped) {
        stoppedCache = r[stoppedIndex][0].filter(
          (task: any) => task.status !== "removed"
        );
        loadedStoppedRevision = requestedStoppedRevision;
      }
      const activeWaiting = [...r[0][0], ...r[1][0]];
      const activeGids = new Set(activeWaiting.map((task: any) => task.gid));
      const sourceCandidates = activeWaiting.filter(
        (task: any) => !task.bittorrent && !retrySources[task.gid]
      );
      await Promise.all(
        sourceCandidates.map(async (task: any) => {
          try {
            const uris = await client.call<any[]>("getUris", task.gid);
            const sources = uris
              .map((entry) => String(entry.uri ?? ""))
              .filter(Boolean);
            if (sources.length)
              await rememberRetrySource(task.gid, {
                kind: "uris",
                uris: sources,
              });
          } catch {
            // Some sources are unavailable from aria2; keep polling while active.
          }
        })
      );
      const selectedFiles = new Map<string, TorrentFile[]>();
      await Promise.all(
        activeWaiting
          .filter((task: any) => task.bittorrent)
          .map(async (task: any) => {
            try {
              const files = await client.call<any[]>("getFiles", task.gid);
              selectedFiles.set(
                task.gid,
                files.map((file, index) => ({
                  index: Number(file.index) || index + 1,
                  path: String(file.path ?? ""),
                  length: +file.length || 0,
                  completedLength: +file.completedLength || 0,
                  selected: file.selected === "true",
                }))
              );
            } catch {
              /* tellStatus still supplies the task snapshot if getFiles is unavailable */
            }
          })
      );
      const old = new Map(get().tasks.map((t) => [t.gid, t]));
      const taskByGid = new Map<string, Task>();
      for (const original of [
        ...activeWaiting,
        ...stoppedCache.filter((task) => !activeGids.has(task.gid)),
      ]) {
        const rawTask = selectedFiles.has(original.gid)
          ? { ...original, files: selectedFiles.get(original.gid) }
          : original;
        const task = toTask(rawTask);
        if (!task || taskByGid.has(task.gid)) continue;
        const previous = old.get(task.gid);
        taskByGid.set(
          task.gid,
          previous && same(previous, task) ? previous : task
        );
      }
      const tasks = reconcileTaskSnapshot(
        [...old.values()],
        [...taskByGid.values()],
        shouldFetchStopped
      );
      const completedSources = tasks
        .filter((task) => task.state === "done" && retrySources[task.gid])
        .map((task) => task.gid);
      if (completedSources.length) await forgetRetrySources(completedSources);
      for (const task of tasks) {
        if (task.state !== "err" || old.get(task.gid)?.state === "err" || notifiedFailures.has(task.gid)) continue;
        notifiedFailures.add(task.gid);
        if (!get().notify || !get().settings.notifyFailed) continue;
        const body = `Failed: ${task.name}`;
        if (inTauri()) void isPermissionGranted().then((granted) => { if (granted) sendNotification({ title: "Helios", body }); }).catch(recordDiagnosticError);
        else if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(body);
      }
      const g = r[statIndex][0];
      const { dlHist, upHist } = get();
      clock.t = performance.now();
      set({
        tasks,
        dl: +g.downloadSpeed,
        up: +g.uploadSpeed,
        dlHist: [...dlHist.slice(1), +g.downloadSpeed / 1048576],
        upHist: [...upHist.slice(1), +g.uploadSpeed / 1048576],
      });
      flushCompletions(tasks);
    } catch {
      if (!shutdownRequested) recordDiagnosticError("Download engine RPC request failed");
    } finally {
      busy = false;
    }
  }

  function flushCompletions(tasks: Task[]) {
    for (const gid of pendingCompletions) {
      if (completing.has(gid) || !api) continue;
      completing.add(gid);
      const task = tasks.find((t) => t.gid === gid && t.state === "done");
      const status = task
        ? Promise.resolve(task)
        : api.call<Record<string, any>>("tellStatus", gid, KEYS).then(toTask);
      void status
        .then((result) => {
          if (result?.state === "done")
            return saveCompletion(result).then(() => {
              pendingCompletions.delete(gid);
            });
        })
        .catch((error) => {
          recordDiagnosticError("Could not save completed download; it will be retried");
          console.error(
            `Could not save completed download ${gid}; it will be retried.`,
            error
          );
        })
        .finally(() => completing.delete(gid));
    }
  }

  async function saveCompletion(task: Task) {
    const entry: HistoryEntry = {
      id: task.gid,
      name: task.name,
      size: task.size,
      completedAt: Date.now(),
      upTotal: task.upTotal,
      category: task.category,
      filePath: task.files[0]?.path,
    };
    const result = await historyStore.add(entry);
    set({ history: result.entries });
    if (!result.added) return;
    try {
      if (get().notify && get().settings.notifyFinished) {
        if (inTauri()) {
          if (await isPermissionGranted())
            sendNotification({ title: "Helios", body: task.name });
        } else if (
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        )
          new Notification(task.name);
      }
    } catch (error) {
      recordDiagnosticError("Could not show completion notification");
      console.error("Could not show completion notification.", error);
    }
  }

  function persistRetrySources() {
    const snapshot = { ...retrySources };
    retrySourcesWrite = retrySourcesWrite
      .catch(() => {})
      .then(() => writeValue("retrySources", snapshot));
    return retrySourcesWrite;
  }

  async function rememberRetrySource(gid: string, source: RetrySource) {
    retrySources[gid] = source;
    try {
      await persistRetrySources();
    } catch {
      recordDiagnosticError("Could not save local retry source data");
    }
  }

  async function forgetRetrySources(gids: string[]) {
    let changed = false;
    for (const gid of gids) {
      if (retrySources[gid]) {
        delete retrySources[gid];
        changed = true;
      }
    }
    if (!changed) return;
    try {
      await persistRetrySources();
    } catch {
      recordDiagnosticError("Could not update local retry source data");
    }
  }

  async function initialize() {
    const [history, settings, legacyChooseFiles, storedRetrySources] =
      await Promise.all([
        historyStore.load(),
        readValue<Partial<Settings>>("settings", {}),
        readValue<boolean>("chooseFilesBeforeStarting", false),
        readValue<RetrySourceMap>("retrySources", {}),
      ]);
    retrySources =
      storedRetrySources && typeof storedRetrySources === "object"
        ? storedRetrySources
        : {};
    const loadedSettings = clampSettings({
      ...DEFAULT_SETTINGS,
      ...settings,
      chooseFilesBeforeStarting:
        settings.chooseFilesBeforeStarting ?? legacyChooseFiles,
      reduceMotion:
        settings.reduceMotion ??
        (typeof window !== "undefined" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches),
    });
    set({
      history,
      settings: loadedSettings,
      ready: true,
    });
    let url = ARIA2_URL;
    rpcSecret = BROWSER_SECRET;
    if (inTauri()) {
      unlistenBridgeAdded?.();
      unlistenBridgeAdded = await listen<{
        gids: string[];
        sources?: { gid: string; uri: string }[];
      }>(
        "bridge://added",
        ({ payload }) => {
          const saved = Promise.all(
            (payload.sources ?? []).map(({ gid, uri }) =>
              uri
                ? rememberRetrySource(gid, { kind: "uris", uris: [uri] })
                : undefined
            )
          );
          if (payload.gids.length) void saved.then(() => refresh(true));
        }
      );
      await invoke("bridge_set_enabled", {
        enabled: loadedSettings.bridgeEnabled,
      });
      const rpc = await invoke<{ port: number; secret: string }>(
        "get_rpc_config"
      );
      url = `ws://127.0.0.1:${rpc.port}/jsonrpc`;
      rpcSecret = rpc.secret;
    }
    set({ rpcUrl: url });
    clock.t = performance.now();
    api = new Aria2(
      url,
      rpcSecret,
      (method, gid) => {
        if (shutdownRequested) return;
        if (
          (method === "onDownloadComplete" ||
            method === "onBtDownloadComplete") &&
          gid
        ) {
          pendingCompletions.add(gid);
          flushCompletions(get().tasks);
        }
        const stoppedEvent =
          method === "onDownloadComplete" ||
          method === "onBtDownloadComplete" ||
          method === "onDownloadError" ||
          method === "onDownloadStop";
        void refresh(stoppedEvent);
      },
      (online) => {
        set({ online, ...(online ? { connectedOnce: true } : {}) });
        if (online && !shutdownRequested) {
          void api?.call<{ version?: string }>("getVersion").then((version) => set({ ariaVersion: version.version ?? "unknown" })).catch(() => {});
          void applySettings().then(() => refresh());
        }
      }
    );
    if (shutdownRequested) {
      api.stopReconnect();
      return;
    }
    refreshTimer = setInterval(() => {
      refreshTicks++;
      void refresh(refreshTicks % 5 === 0);
    }, 1000);
  }

  return {
    online: false,
    ariaVersion: "",
    connectedOnce: false,
    ready: false,
    rpcUrl: "",
    tasks: [],
    history: [],
    filter: "all",
    series: "dl",
    notify: false,
    view: "tasks",
    settings: DEFAULT_SETTINGS,
    dl: 0,
    up: 0,
    dlHist: Array(N + 1).fill(0),
    upHist: Array(N + 1).fill(0),
    start() {
      if (shutdownRequested) return Promise.resolve();
      if (api) return Promise.resolve();
      if (!starting)
        starting = initialize().finally(() => {
          starting = undefined;
        });
      return starting;
    },
    reconnect() {
      if (api) api.reconnect();
      else void get().start();
    },
    async saveSession() {
      if (api) await api.call("saveSession");
    },
    setFilter: (filter) => set({ filter }),
    setCategory: (category) =>
      set({ category: get().category === category ? undefined : category }),
    select: (sel) => set({ sel }),
    setSeries: (series) => set({ series }),
    setView: (view) => set({ view }),
    setNotify(notify) {
      set({ notify });
      if (!notify) return;
      if (inTauri())
        void isPermissionGranted()
          .then((granted) => (granted ? undefined : requestPermission()))
          .catch(() => {});
      else if (
        typeof Notification !== "undefined" &&
        Notification.permission === "default"
      )
        void Notification.requestPermission();
    },
    async notifyAddedDownload(name) {
      if (!get().notify || !get().settings.notifyBrowserAdds) return;
      try {
        const body = `Added: ${name}`;
        if (inTauri()) {
          if (await isPermissionGranted())
            sendNotification({ title: "Helios", body });
        } else if (
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) new Notification(body);
      } catch (error) {
        recordDiagnosticError("Could not show download notification");
        console.error("Could not show download notification.", error);
      }
    },
    async updateSettings(update) {
      const settings = clampSettings({ ...get().settings, ...update });
      if (("startMinimized" in update || "connectTimeoutSeconds" in update) && inTauri()) {
        try {
          await invoke("write_startup_settings", {
            startMinimized: settings.startMinimized,
            connectTimeoutSeconds: settings.connectTimeoutSeconds,
          });
        } catch {
          set({ settingsError: "Could not save startup preferences." });
          recordDiagnosticError("Could not save startup preferences");
          return;
        }
      }
      if ("bridgeEnabled" in update && inTauri()) {
        try {
          await invoke("bridge_set_enabled", {
            enabled: settings.bridgeEnabled,
          });
        } catch {
          set({ settingsError: "The browser bridge could not be updated." });
          recordDiagnosticError("The browser bridge could not be updated");
          return;
        }
      }
      try {
        await writeValue("settings", settings);
      } catch {
        set({ settingsError: "Could not save preferences." });
        recordDiagnosticError("Could not save preferences");
        return;
      }
      set({ settings, settingsError: undefined });
      if (get().online) await applySettings(settings);
    },
    async updateAutostart(enabled) {
      try {
        await invoke("set_autostart", { enabled });
        const settings = { ...get().settings, startWithWindows: enabled };
        await writeValue("settings", settings);
        set({ settings, settingsError: undefined });
      } catch (error) {
        set({
          settingsError: error instanceof Error ? error.message : String(error),
        });
      }
    },
    async clearHistory() {
      await historyStore.clear();
      set({ history: [] });
    },
    async removeHistory(id) {
      set({ history: await historyStore.remove(id) });
    },
    shutdown() {
      if (shutdownPromise) return shutdownPromise;
      shutdownRequested = true;
      if (refreshTimer) clearInterval(refreshTimer);
      unlistenBridgeAdded?.();
      unlistenBridgeAdded = undefined;
      const deadline = Date.now() + 3000;
      const beforeDeadline = <T>(promise: Promise<T>) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        return Promise.race([
          promise,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Shutdown timed out")),
              Math.max(0, deadline - Date.now())
            );
          }),
        ]).finally(() => {
          if (timer) clearTimeout(timer);
        });
      };
      shutdownPromise = (async () => {
        try {
          if (!api && starting) await beforeDeadline(starting).catch(() => {});
          const client = api;
          if (!client) return;
          await beforeDeadline(client.call("saveSession")).catch(() => {});
          client.stopReconnect();
          await beforeDeadline(client.call("shutdown")).catch(() => {});
          client.close();
        } catch {
          api?.close();
        }
      })();
      return shutdownPromise;
    },
    async toggle(t) {
      if (!api) return;
      try {
        const { status } = await api.call<{ status: string }>(
          "tellStatus",
          t.gid,
          ["status"]
        );
        const method = taskActionForAria2Status(status);
        if (method) await api.call(method, t.gid);
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
        if (
          !message.includes("cannot be paused now") &&
          !message.includes("cannot be unpaused now") &&
          !message.includes("not found")
        ) {
          throw error;
        }
      } finally {
        void refresh(true);
      }
    },
    async pauseAll() {
      if (!api) return;
      try {
        await api.call("pauseAll");
        void refresh(true);
      } catch (error) {
        recordDiagnosticError("Could not pause all downloads");
        console.error("Could not pause all downloads.", error);
      }
    },
    async resumeAll() {
      if (!api) return;
      try {
        await api.call("unpauseAll");
        void refresh(true);
      } catch (error) {
        recordDiagnosticError("Could not resume all downloads");
        console.error("Could not resume all downloads.", error);
      }
    },
    add(uri) {
      api
        ?.call<string>("addUri", [uri])
        .then((gid) => rememberRetrySource(gid, { kind: "uris", uris: [uri] }))
        .then(() => refresh(true))
        .catch(() => {});
    },
    async addUris(uris, options = {}) {
      if (!api) return uris.map(() => "aria2 is not connected");
      const errors = await Promise.all(
        uris.map(async (uri) => {
          try {
            const gid = await api!.call<string>("addUri", [uri], options);
            await rememberRetrySource(gid, { kind: "uris", uris: [uri] });
            return "";
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        })
      );
      void refresh(true);
      return errors;
    },
    async addUri(uri, options = {}) {
      if (!api) throw new Error("aria2 is not connected");
      const gid = await api.call<string>("addUri", [uri], options);
      await rememberRetrySource(gid, { kind: "uris", uris: [uri] });
      void refresh(true);
      return gid;
    },
    async addTorrent(torrent, options = {}) {
      if (!api) throw new Error("aria2 is not connected");
      const gid = await api.call<string>("addTorrent", torrent, [], options);
      void refresh(true);
      return gid;
    },
    async torrentFiles(gid) {
      if (!api) throw new Error("aria2 is not connected");
      const files = await api.call<any[]>("getFiles", gid);
      return files.map((file, index) => ({
        index: Number(file.index) || index + 1,
        path: String(file.path ?? ""),
        length: +file.length || 0,
        completedLength: +file.completedLength || 0,
        selected: file.selected === "true",
      }));
    },
    async torrentFollowedBy(gid) {
      if (!api) throw new Error("aria2 is not connected");
      const status = await api.call<{ followedBy?: string[] }>(
        "tellStatus",
        gid,
        ["followedBy"]
      );
      return status.followedBy ?? [];
    },
    async selectTorrentFiles(gid, indexes, wasActive) {
      if (!api) throw new Error("aria2 is not connected");
      if (wasActive) await api.call("pause", gid);
      try {
        await api.call("changeOption", gid, { "select-file": indexes });
      } finally {
        await api.call("unpause", gid);
      }
      void refresh(true);
    },
    async cancelTorrentSelection(gids) {
      if (!api)
        throw new Error(
          "aria2 is not connected; the torrent could not be canceled."
        );
      const errors: string[] = [];
      const removed: string[] = [];
      const alreadyGone = (error: unknown) => {
        const message = (
          error instanceof Error ? error.message : String(error)
        ).toLowerCase();
        return (
          message.includes("not found") ||
          message.includes("is not found") ||
          message.includes("could not remove download result")
        );
      };
      for (const gid of new Set(gids)) {
        let failed = false;
        try {
          await api.call("forceRemove", gid);
        } catch (error) {
          if (!alreadyGone(error)) {
            failed = true;
            errors.push(
              `${gid}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
        try {
          await api.call("removeDownloadResult", gid);
        } catch (error) {
          if (!alreadyGone(error)) {
            failed = true;
            errors.push(
              `${gid}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
        if (!failed) removed.push(gid);
      }
      await forgetRetrySources(removed);
      void refresh(true);
      if (errors.length) throw new Error(errors.join("\n"));
    },
    async taskUris(gid) {
      if (!api) throw new Error("aria2 is not connected");
      return api
        .call<any[]>("getUris", gid)
        .then((uris) => uris.map((entry) => entry.uri));
    },
    async removeTask(task, alsoDeleteFiles = false) {
      await get().removeHistory(task.gid);
      const alreadyGone = (error: unknown) => {
        const message = (
          error instanceof Error ? error.message : String(error)
        ).toLowerCase();
        return (
          message.includes("could not remove download result") ||
          message.includes("not found")
        );
      };
      try {
        if (!api) {
          if (task.state !== "done") throw new Error("aria2 is not connected");
        } else if (
          task.state === "dl" ||
          task.state === "seed" ||
          task.state === "pa" ||
          task.queued
        ) {
          try {
            await api.call("forceRemove", task.gid);
          } catch (error) {
            if (!alreadyGone(error)) throw error;
          }
          try {
            await api.call("removeDownloadResult", task.gid);
          } catch {
            // forceRemove may already have removed the result.
          }
        } else {
          try {
            await api.call("removeDownloadResult", task.gid);
          } catch (error) {
            if (!alreadyGone(error)) throw error;
          }
        }
      } finally {
        void refresh(true);
      }
      await forgetRetrySources([task.gid]);
      if (alsoDeleteFiles && !task.files.some((file) => file.path))
        throw new Error("aria2 has not provided file paths for this download.");
      if (alsoDeleteFiles && task.files.length) {
        const errors = await invoke<string[]>("delete_files", {
          dir: task.dir,
          paths: task.files.map((file) => file.path).filter(Boolean),
        });
        if (errors.length) throw new Error(errors.join("\n"));
      }
    },
    async retryTask(task) {
      if (!api) throw new Error("aria2 is not connected");
      let source = retrySources[task.gid];
      if (!source) {
        try {
          const uris = await get().taskUris(task.gid);
          if (uris.length) {
            source = { kind: "uris", uris };
            await rememberRetrySource(task.gid, source);
          }
        } catch {
          // Fall through to the saved source and report a clear error if absent.
        }
      }
      if (!source)
        throw new Error(
          `The original source for “${task.name}” is unavailable. Remove the failed task and add its link again.`
        );
      const errors = await get().addUris(source.uris);
      const failed = errors.find(Boolean);
      if (failed) throw new Error(failed);
      await api.call("removeDownloadResult", task.gid);
      await forgetRetrySources([task.gid]);
      void refresh(true);
    },
  };
});

if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  (window as Window & { __helios?: typeof useStore }).__helios = useStore;
}
