"use client";
import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@/lib/store";
import TitleBar from "@/components/TitleBar";
import Sidebar from "@/components/Sidebar";
import TaskTable from "@/components/TaskTable";
import Chart, { SeriesToggle } from "@/components/Chart";
import Stats from "@/components/Stats";
import Settings from "@/components/Settings";
import AddDialog from "@/components/AddDialog";
import SelectFilesDialog from "@/components/SelectFilesDialog";

type SelectionRequest = {
  gid: string;
  cleanupGids?: string[];
  removeOnCancel: boolean;
  wasActive: boolean;
};

export default function Page() {
  const view = useStore((s) => s.view);
  const [addOpen, setAddOpen] = useState(false);
  const [dropLinks, setDropLinks] = useState<string>();
  const [dropPath, setDropPath] = useState<string>();
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
  }, []);
  const openFromDrop = useCallback((links?: string, path?: string) => {
    setDropLinks(links);
    setDropPath(path);
    setAddOpen(true);
  }, []);
  useEffect(() => {
    void useStore.getState().start();
    // Paste a link (http, ftp or magnet) anywhere to add a download.
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      const t = e.clipboardData?.getData("text").trim() ?? "";
      if (/^(https?|ftp|magnet):/i.test(t)) useStore.getState().add(t);
    };
    window.addEventListener("paste", onPaste);
    let disposed = false;
    let closing = false;
    let unlistenClose: (() => void) | undefined;
    let unlistenNative: (() => void)[] = [];
    if ("__TAURI_INTERNALS__" in window) {
      const win = getCurrentWindow();
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
      ])
        .then(async (unlisteners) => {
          if (disposed) {
            unlisteners.forEach((unlisten) => unlisten());
            return;
          }
          unlistenNative = unlisteners;
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setAddOpen(true);
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => {
      disposed = true;
      unlistenClose?.();
      unlistenNative.forEach((unlisten) => unlisten());
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onShortcut);
    };
  }, []);

  return (
    <div className="win">
      <TitleBar onAdd={() => setAddOpen(true)} />
      <AddDialog
        open={addOpen}
        initialLinks={dropLinks}
        initialPath={dropPath}
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
        <main style={{ minWidth: 0 }}>
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
        </main>
      </div>
    </div>
  );
}
