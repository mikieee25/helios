"use client";
import { useEffect } from "react";
import { useStore } from "@/lib/store";
import TitleBar from "@/components/TitleBar";
import Sidebar from "@/components/Sidebar";
import TaskTable from "@/components/TaskTable";
import Chart, { SeriesToggle } from "@/components/Chart";
import Stats from "@/components/Stats";
import Settings from "@/components/Settings";

export default function Page() {
  const view = useStore((s) => s.view);
  useEffect(() => {
    void useStore.getState().start();
    // Paste a link (http, ftp or magnet) anywhere to add a download.
    const onPaste = (e: ClipboardEvent) => {
      const t = e.clipboardData?.getData("text").trim() ?? "";
      if (/^(https?|ftp|magnet):/i.test(t)) useStore.getState().add(t);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  return (
    <div className="win">
      <TitleBar />
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
