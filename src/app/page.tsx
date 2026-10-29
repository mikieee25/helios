"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { installUpdate } from "@/lib/updater";
import { useStore } from "@/lib/store";
import TitleBar from "@/components/TitleBar";
import Sidebar from "@/components/Sidebar";
import TaskTable from "@/components/TaskTable";
import Chart, { SeriesToggle } from "@/components/Chart";
import Stats from "@/components/Stats";
import Settings from "@/components/Settings";
import AddDialog from "@/components/AddDialog";
import DetailsPanel from "@/components/DetailsPanel";
import Toast from "@/components/Toast";
import SelectFilesDialog from "@/components/SelectFilesDialog";
import type { BridgeAddItem } from "@/lib/bridge";
import { isSupportedDownloadSource } from "@/lib/download-source";
import { prefersReducedMotion } from "@/lib/motion";
import { shortcutMatches } from "@/lib/shortcuts";
import { logDiagnostic } from "@/lib/developer-log";
import { applyThemeColors, type ThemeMode } from "@/lib/theme";

type SelectionRequest = {
  gid: string;
  cleanupGids?: string[];
  removeOnCancel: boolean;
  wasActive: boolean;
};

export default function Page() {
  const view = useStore((s) => s.view);
  const reduceMotion = useStore((s) => s.settings.reduceMotion);
  const theme = useStore((s) => s.settings.theme);
  const themeColors = useStore((s) => s.settings.themeColors);
  const rootRef = useRef<HTMLDivElement>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const previousView = useRef(view);
  const introPlayed = useRef(false);
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const mode: ThemeMode = theme === "system" ? (query.matches ? "dark" : "light") : theme;
      applyThemeColors(mode, themeColors[mode]);
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [theme, themeColors]);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const originalError = console.error;
    const originalWarn = console.warn;
    const format = (values: unknown[]) => values.map((value) => {
      if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`;
      if (typeof value === "string") return value;
      try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
    }).join(" ");
    console.error = (...values) => { originalError(...values); logDiagnostic("error", "Helios", format(values)); };
    console.warn = (...values) => { originalWarn(...values); logDiagnostic("warn", "Helios", format(values)); };
    const onError = (event: ErrorEvent) => logDiagnostic("error", "Helios", event.error instanceof Error ? `${event.message}\n${event.error.stack ?? ""}` : event.message);
    const onRejection = (event: PromiseRejectionEvent) => logDiagnostic("error", "Helios", `Unhandled rejection: ${format([event.reason])}`);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      console.error = originalError;
      console.warn = originalWarn;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  const [addOpen, setAddOpen] = useState(false);
  const [dropLinks, setDropLinks] = useState<string>();
  const [dropPath, setDropPath] = useState<string>();
  const [bridgeItems, setBridgeItems] = useState<BridgeAddItem[]>();
  const [selectionQueue, setSelectionQueue] = useState<SelectionRequest[]>([]);
  const enqueueSelection = useCallback(
    (gid: string, _metadata: boolean, cleanupGids?: string[]) => {
      setSelectionQueue((current) => [
        ...current,
        { gid, cleanupGids, removeOnCancel: true, wasActive: false },
      ]);
    },
    []
  );
  const closeAdd = useCallback(() => {
    setAddOpen(false);
    setDropLinks(undefined);
    setDropPath(undefined);
    setBridgeItems(undefined);
  }, []);
  const openFromDrop = useCallback((links?: string, path?: string) => {
    setBridgeItems(undefined);
    setDropLinks(links);
    setDropPath(path);
    setAddOpen(true);
  }, []);
  const openFromBridge = useCallback(async (items: BridgeAddItem[]) => {
    const win = getCurrentWindow();
    await win.show();
    await win.unminimize();
    await win.setFocus();
    setDropPath(undefined);
    setBridgeItems(items);
    setDropLinks(items.map((item) => item.url).join("\n"));
    setAddOpen(true);
  }, []);
  const takePendingBridgeAdds = useCallback(async () => {
    const batches = await invoke<BridgeAddItem[][]>("bridge_take_pending_asks");
    const items = batches.flat();
    if (items.length) await openFromBridge(items);
  }, [openFromBridge]);
  useLayoutEffect(() => {
    if (introPlayed.current) return;
    if (prefersReducedMotion(reduceMotion)) {
      introPlayed.current = true;
      return;
    }
    if (!rootRef.current) return;
    const elements = rootRef.current.querySelectorAll<HTMLElement>(
      ".bar, .body > .side, .body > main"
    );
    const tween = gsap.fromTo(
      elements,
      { autoAlpha: 0, y: 9 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.38,
        stagger: 0.07,
        ease: "power2.out",
        clearProps: "opacity,visibility,transform",
        onComplete: () => {
          introPlayed.current = true;
        },
      }
    );
    return () => {
      tween.kill();
    };
  }, [reduceMotion]);
  useLayoutEffect(() => {
    const changed = previousView.current !== view;
    previousView.current = view;
    const content = mainContentRef.current;
    if (!changed || !content || prefersReducedMotion(reduceMotion)) return;
    const tween = gsap.fromTo(
      content,
      { autoAlpha: 0, y: 5 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.2,
        ease: "power2.out",
        clearProps: "opacity,visibility,transform",
      }
    );
    return () => {
      tween.kill();
    };
  }, [view, reduceMotion]);
  useEffect(() => {
    void useStore.getState().start();
    let updateTimer: number | undefined;
    let paintFrame = 0;
    if ("__TAURI_INTERNALS__" in window) {
      paintFrame = requestAnimationFrame(() => {
        void invoke("show_after_first_paint").catch((error) =>
          console.error("Could not show the startup window.", error)
        );
      });
    }
    // Paste an HTTP(S) or magnet link anywhere to add a download.
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      const t = e.clipboardData?.getData("text").trim() ?? "";
      if (isSupportedDownloadSource(t)) useStore.getState().add(t);
    };
    window.addEventListener("paste", onPaste);
    let disposed = false;
    let closing = false;
    let unlistenClose: (() => void) | undefined;
    let unlistenNative: (() => void)[] = [];
    if ("__TAURI_INTERNALS__" in window) {
      const win = getCurrentWindow();
      if (process.env.NODE_ENV === "production") updateTimer = window.setTimeout(() => {
        void (async () => {
          let update;
          try {
            if (!(await win.isVisible())) return;
            update = await check();
            if (!update) return;
          } catch (error) {
            console.error("Could not check for a Helios update.", error);
            return;
          }
          const accepted = await confirm(`Helios ${update.version} is available. Download and install it now?`, { title: "Helios update available", kind: "info" });
          if (!accepted) { await update.close(); return; }
          try { await installUpdate(update); }
          catch (error) {
            await update.close().catch(() => {});
            await message("Helios could not install the update. You can try again from Settings > About.", { title: "Update failed", kind: "error" }).catch(() => {});
            console.error("Could not install a Helios update.", error);
          }
        })();
      }, 15000);
      const shutdownAndDestroy = async () => {
        if (closing) return;
        closing = true;
        await invoke("begin_aria_shutdown").catch((error) =>
          console.error("Could not mark aria2 shutdown.", error)
        );
        await useStore.getState().shutdown();
        await win.destroy();
      };
      void win
        .onCloseRequested(async (event) => {
          event.preventDefault();
          if (useStore.getState().settings.closeToTray) {
            await win.hide();
            return;
          }
          await shutdownAndDestroy();
        })
        .then((unlisten) => {
          if (disposed) unlisten();
          else unlistenClose = unlisten;
        })
        .catch((error) =>
          console.error("Could not register close handler.", error)
        );
      type OpenRequest = { kind: "link" | "torrent"; value: string };
      type StartupActions = { requests: OpenRequest[]; actions: string[] };
      const consumeOpenRequest = (request: OpenRequest) => {
        if (request.kind === "link") openFromDrop(request.value);
        else openFromDrop(undefined, request.value);
      };
      const consumeTrayAction = async (action: string) => {
        if (action === "pauseAll") await useStore.getState().pauseAll();
        else if (action === "resumeAll") await useStore.getState().resumeAll();
        else if (action === "quit") await shutdownAndDestroy();
      };
      void Promise.all([
        listen<OpenRequest>("helios://open", (event) =>
          consumeOpenRequest(event.payload)
        ),
        listen("helios://pause-all", () => void useStore.getState().pauseAll()),
        listen(
          "helios://resume-all",
          () => void useStore.getState().resumeAll()
        ),
        listen("helios://quit", () => void shutdownAndDestroy()),
        listen("bridge://add", () => void takePendingBridgeAdds()),
        listen<{ name: string }>("bridge://started", (event) =>
          void useStore.getState().notifyAddedDownload(event.payload.name)
        ),
      ])
        .then(async (unlisteners) => {
          if (disposed) {
            unlisteners.forEach((unlisten) => unlisten());
            return;
          }
          unlistenNative = unlisteners;
          await takePendingBridgeAdds();
          const startup = await invoke<StartupActions>("take_open_requests");
          startup.requests.forEach(consumeOpenRequest);
          for (const action of startup.actions) {
            await consumeTrayAction(action);
            if (action === "quit") break;
          }
        })
        .catch((error) =>
          console.error("Could not register native actions.", error)
        );
    }
    const onShortcut = (e: KeyboardEvent) => {
      if (shortcutMatches(e, "newDownload", useStore.getState().settings.keyBindings)) {
        e.preventDefault();
        setAddOpen(true);
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => {
      disposed = true;
      if (paintFrame) cancelAnimationFrame(paintFrame);
      if (updateTimer) window.clearTimeout(updateTimer);
      unlistenClose?.();
      unlistenNative.forEach((unlisten) => unlisten());
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onShortcut);
    };
  }, [openFromBridge, takePendingBridgeAdds]);

  return (
    <div className="win" ref={rootRef}>
      <TitleBar onAdd={() => setAddOpen(true)} />
      <AddDialog
        open={addOpen}
        initialLinks={dropLinks}
        initialPath={dropPath}
        initialBridgeItems={bridgeItems}
        onDropOpen={openFromDrop}
        onSelectFiles={enqueueSelection}
        onClose={closeAdd}
      />
      {selectionQueue[0] && (
        <SelectFilesDialog
          key={selectionQueue[0].gid}
          {...selectionQueue[0]}
          onClose={() => setSelectionQueue((current) => current.slice(1))}
        />
      )}
      <div className="body">
        <Sidebar />
        <main ref={mainContentRef} style={{ minWidth: 0 }}>
          {view === "settings" ? (
            <Settings />
          ) : (
            <>
              <TaskTable />
              <div className="low">
                <div>
                  <div className="ch-h">
                    <div className="lbl">Transfer speed</div>
                    <SeriesToggle />
                  </div>
                  <Chart />
                </div>
                <Stats />
              </div>
            </>
          )}
          {view !== "settings" && <DetailsPanel />}
        </main>
      </div>
      <Toast />
    </div>
  );
}
