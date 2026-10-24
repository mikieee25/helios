import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
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
  files: { path: string }[];
  errorMessage: string;
  errorCode: string;
};
export type AddOptions = Record<string, string>;
export type Settings = {
  maxDownloadMB: number;
  maxUploadMB: number;
  maxConcurrent: number;
  connectionsPerServer: number;
  downloadDir: string;
  closeToTray: boolean;
  startWithWindows: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  maxDownloadMB: 0,
  maxUploadMB: 0,
  maxConcurrent: 5,
  connectionsPerServer: 16,
  downloadDir: "",
  closeToTray: true,
  startWithWindows: false,
};
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
  updateSettings(settings: Partial<Settings>): Promise<void>;
  updateAutostart(enabled: boolean): Promise<void>;
  clearHistory(): Promise<void>;
  removeHistory(id: string): Promise<void>;
  shutdown(): Promise<void>;
  toggle(t: Task): Promise<void>;
  add(uri: string): void;
  addUris(uris: string[], options?: AddOptions): Promise<string[]>;
  addTorrent(torrent: string, options?: AddOptions): Promise<void>;
  taskUris(gid: string): Promise<string[]>;
  removeTask(task: Task, alsoDeleteFiles?: boolean): Promise<void>;
  retryTask(task: Task): Promise<void>;
  pauseAll(): Promise<void>;
  resumeAll(): Promise<void>;
}

let api: Aria2 | undefined;
let rpcSecret = BROWSER_SECRET;
let starting: Promise<void> | undefined;
let busy = false;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let shutdownRequested = false;
let shutdownPromise: Promise<void> | undefined;
let stoppedRevision = 1;
let loadedStoppedRevision = 0;
let stoppedCache: Record<string, any>[] = [];
let refreshTicks = 0;
let aria2DefaultDir: string | undefined;
const seen = new Map<string, number>();
const pendingCompletions = new Set<string>();
const completing = new Set<string>();
const same = (a: Task, b: Task) =>
  (Object.keys(a) as (keyof Task)[]).every((k) =>
    k === "files"
      ? a.files.length === b.files.length &&
        a.files.every((file, index) => file.path === b.files[index]?.path)
      : a[k] === b[k]
  );
const inTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function toTask(r: any): Task {
  const size = +r.totalLength;
  const st: string = r.status;
  const state: UiState =
    st === "complete"
      ? "done"
      : st === "error"
        ? "err"
        : st === "active"
          ? r.seeder === "true"
            ? "seed"
            : "dl"
          : "pa";
  const files: string[] = (r.files ?? []).map(
    (f: { path?: string }) => f.path ?? ""
  );
  const name =
    r.bittorrent?.info?.name ?? files[0]?.split(/[\\/]/).pop() ?? r.gid;
  if (state === "dl" && !seen.has(r.gid)) seen.set(r.gid, Date.now());
  return {
    gid: r.gid,
    name: name || r.gid,
    size,
    done: size ? +r.completedLength / size : 0,
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
        ? dominantCategory(files)
        : fileCategory(name),
    dir: r.dir ?? "",
    files: (r.files ?? []).map((f: { path?: string }) => ({ path: f.path ?? "" })),
    errorMessage: String(r.errorMessage ?? ""),
    errorCode: String(r.errorCode ?? ""),
  };
}

function optionsFor(settings: Settings, defaultDir?: string) {
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
    ...(settings.downloadDir || defaultDir
      ? { dir: settings.downloadDir || defaultDir }
      : {}),
  };
}

export const useStore = create<S>((set, get) => {
  async function applySettings(settings = get().settings) {
    if (!api) return;
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
    } catch (error) {
      set({
        settingsError: error instanceof Error ? error.message : String(error),
      });
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
      const calls = [
        c("tellActive", KEYS),
        c("tellWaiting", 0, 5000, KEYS),
      ];
      const stoppedIndex = calls.length;
      if (shouldFetchStopped) calls.push(c("tellStopped", 0, 100, KEYS));
      const statIndex = calls.length;
      calls.push(c("getGlobalStat"));
      const r = await client.call("system.multicall", calls);
      if (shouldFetchStopped) {
        stoppedCache = r[stoppedIndex][0];
        loadedStoppedRevision = requestedStoppedRevision;
      }
      const activeWaiting = [...r[0][0], ...r[1][0]];
      const activeGids = new Set(activeWaiting.map((task: any) => task.gid));
      const old = new Map(get().tasks.map((t) => [t.gid, t]));
      const tasks = [
        ...activeWaiting,
        ...stoppedCache.filter((task) => !activeGids.has(task.gid)),
      ]
        .map(toTask)
        .map((t) => {
          const o = old.get(t.gid);
          return o && same(o, t) ? o : t;
        });
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
      /* RPC can close while reconnecting. */
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
          if (result.state === "done")
            return saveCompletion(result).then(() => {
              pendingCompletions.delete(gid);
            });
        })
        .catch((error) => {
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
      if (get().notify) {
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
      console.error("Could not show completion notification.", error);
    }
  }

  async function initialize() {
    const [history, settings] = await Promise.all([
      historyStore.load(),
      readValue<Settings>("settings", DEFAULT_SETTINGS),
    ]);
    set({ history, settings: { ...DEFAULT_SETTINGS, ...settings }, ready: true });
    let url = ARIA2_URL;
    rpcSecret = BROWSER_SECRET;
    if (inTauri()) {
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
        if (online && !shutdownRequested)
          void applySettings().then(() => refresh());
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
    async updateSettings(update) {
      const settings = { ...get().settings, ...update };
      set({ settings });
      await writeValue("settings", settings);
      if (get().online) await applySettings(settings);
    },
    async updateAutostart(enabled) {
      try {
        await invoke("set_autostart", { enabled });
        const settings = { ...get().settings, startWithWindows: enabled };
        await writeValue("settings", settings);
        set({ settings, settingsError: undefined });
      } catch (error) {
        set({ settingsError: error instanceof Error ? error.message : String(error) });
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
      const deadline = Date.now() + 3000;
      const beforeDeadline = <T,>(promise: Promise<T>) => {
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
      const method =
        t.state === "dl" || t.state === "seed" || t.queued
          ? "pause"
          : t.state === "pa"
            ? "unpause"
            : null;
      if (method && api) {
        await api.call(method, t.gid);
        void refresh(true);
      }
    },
    async pauseAll() {
      if (!api) return;
      try {
        await api.call("pauseAll");
        void refresh(true);
      } catch (error) {
        console.error("Could not pause all downloads.", error);
      }
    },
    async resumeAll() {
      if (!api) return;
      try {
        await api.call("unpauseAll");
        void refresh(true);
      } catch (error) {
        console.error("Could not resume all downloads.", error);
      }
    },
    add(uri) {
      api
        ?.call("addUri", [uri])
        .then(() => refresh(true))
        .catch(() => {});
    },
    async addUris(uris, options = {}) {
      if (!api) return uris.map(() => "aria2 is not connected");
      const errors = await Promise.all(
        uris.map(async (uri) => {
          try {
            await api!.call("addUri", [uri], options);
            return "";
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        })
      );
      void refresh(true);
      return errors;
    },
    async addTorrent(torrent, options = {}) {
      if (!api) throw new Error("aria2 is not connected");
      await api.call("addTorrent", torrent, [], options);
      void refresh(true);
    },
    async taskUris(gid) {
      if (!api) throw new Error("aria2 is not connected");
      return api
        .call<any[]>("getUris", gid)
        .then((uris) => uris.map((entry) => entry.uri));
    },
    async removeTask(task, alsoDeleteFiles = false) {
      if (!api) throw new Error("aria2 is not connected");
      if (task.state === "dl" || task.state === "seed" || task.queued)
        await api.call("forceRemove", task.gid);
      else await api.call("removeDownloadResult", task.gid);
      void refresh(true);
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
      const uris = await get().taskUris(task.gid);
      if (!uris.length) throw new Error("No source URLs are available to retry.");
      const errors = await get().addUris(uris);
      const failed = errors.find(Boolean);
      if (failed) throw new Error(failed);
      await api.call("removeDownloadResult", task.gid);
      void refresh(true);
    },
  };
});
