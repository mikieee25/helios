"use client";
import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import TitleBar from "@/components/TitleBar";
import Sidebar from "@/components/Sidebar";
import TaskTable from "@/components/TaskTable";
import Chart, { SeriesToggle } from "@/components/Chart";
import Stats from "@/components/Stats";
import Settings from "@/components/Settings";
import AddDialog from "@/components/AddDialog";

export default function Page() {
  const view = useStore((s) => s.view);
  const [addOpen, setAddOpen] = useState(false);
  const [dropLinks, setDropLinks] = useState<string>();
  const [dropPath, setDropPath] = useState<string>();
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
      const t = e.clipboardData?.getData("text").trim() ?? "";
      if (/^(https?|ftp|magnet):/i.test(t)) useStore.getState().add(t);
    };
    window.addEventListener("paste", onPaste);
    const onShortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setAddOpen(true);
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onShortcut);
    };
  }, []);

  return (
    <div className="win">
      <TitleBar />
      <AddDialog
        open={addOpen}
        initialLinks={dropLinks}
        initialPath={dropPath}
        onDropOpen={openFromDrop}
        onClose={closeAdd}
      />
      <div className="body">
        <Sidebar />
        <main style={{ minWidth: 0 }}>
          {view === "settings" ? (
            <Settings />
          ) : (
            <>
              <TaskTable onAdd={() => setAddOpen(true)} />
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
