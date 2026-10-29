"use client";

import { invoke } from "@tauri-apps/api/core";
import { attachLogger } from "@tauri-apps/plugin-log";
import { LogLevel } from "@tauri-apps/plugin-log";
import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { parseConsoleEntry, type ConsoleEntry } from "@/lib/developer-log";
import { Button } from "@/components/settings/ui";

type Level = "all" | "info" | "warn" | "error";

export default function DeveloperConsole({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [level, setLevel] = useState<Level>("all");
  const [source, setSource] = useState("all");
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | undefined>(undefined);

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, select, input")) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const bounds = dialog.getBoundingClientRect();
    dialog.style.left = `${bounds.left}px`;
    dialog.style.top = `${bounds.top}px`;
    dialog.style.transform = "none";
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const dialog = dialogRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !dialog) return;
    const margin = 12;
    const left = Math.max(margin, Math.min(event.clientX - drag.offsetX, window.innerWidth - dialog.offsetWidth - margin));
    const top = Math.max(margin, Math.min(event.clientY - drag.offsetY, window.innerHeight - dialog.offsetHeight - margin));
    dialog.style.left = `${left}px`;
    dialog.style.top = `${top}px`;
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  useEffect(() => {
    let active = true;
    let detach: (() => void) | undefined;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    void attachLogger(({ level: logLevel, message }) => {
      if (!active) return;
      const fallbackLevel = logLevel === LogLevel.Error ? "error" : logLevel === LogLevel.Warn ? "warn" : logLevel === LogLevel.Info ? "info" : "debug";
      setEntries((current) => [...current, parseConsoleEntry(message, fallbackLevel)].slice(-3000));
    }).then((unlisten) => {
      if (!active) { unlisten(); return []; }
      detach = unlisten;
      return invoke<string[]>("get_console_logs");
    }).then((lines) => {
      if (active) setEntries((current) => [...lines.map((line) => {
        const jsonStart = line.indexOf("{");
        return parseConsoleEntry(jsonStart >= 0 ? line.slice(jsonStart) : line);
      }), ...current].slice(-3000));
    }).catch(() => { if (active) setError("Could not load saved logs. New logs will still appear here."); });
    return () => { active = false; detach?.(); window.removeEventListener("keydown", onKeyDown); };
  }, [onClose]);

  const sources = useMemo(() => [...new Set(entries.map((entry) => entry.source))].sort(), [entries]);
  const visible = entries.filter((entry) => (level === "all" || entry.level === level) && (source === "all" || entry.source === source));
  const text = entries.map((entry) => `${new Date(Number(entry.time) || entry.time).toISOString()} [${entry.level.toUpperCase()}] [${entry.source}] ${entry.message}`).join("\n");

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setError("Copied logs to clipboard."); }
    catch { setError("Could not copy logs to clipboard."); }
  };
  const exportLogs = async () => {
    try {
      const path = await save({ defaultPath: "Helios-logs.txt", filters: [{ name: "Text file", extensions: ["txt"] }] });
      if (path) { await invoke("export_console_logs", { path, contents: text }); setError("Logs exported."); }
    } catch { setError("Could not export logs."); }
  };
  const clear = async () => {
    try { await invoke("clear_console_logs"); setEntries([]); setError(""); }
    catch { setError("Could not clear saved logs."); }
  };

  return <div className="modal-backdrop developer-console-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="add-dialog developer-console" role="dialog" aria-modal="true" aria-labelledby="developer-console-title">
      <header className="modal-heading developer-console-heading" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}><div><p className="lbl">DIAGNOSTICS</p><h2 id="developer-console-title">Developer console</h2><small>Drag this header to move · Resize from the lower-right corner</small></div><button ref={closeRef} type="button" className="modal-close" aria-label="Close developer console" onClick={onClose}>×</button></header>
      <div className="developer-console-toolbar">
        <label>Level <select value={level} onChange={(event) => setLevel(event.target.value as Level)}><option value="all">All</option><option value="info">Info</option><option value="warn">Warning</option><option value="error">Error</option></select></label>
        <label>Source <select value={source} onChange={(event) => setSource(event.target.value)}><option value="all">All sources</option>{sources.map((item) => <option key={item}>{item}</option>)}</select></label>
        <span>{visible.length} entries</span>
      </div>
      <div className="developer-console-entries" role="log" aria-live="polite">
        {visible.length ? visible.map((entry, index) => <article className={`developer-log-entry level-${entry.level}`} key={`${entry.time}-${index}`}>
          <time>{new Date(Number(entry.time) || entry.time).toLocaleTimeString()}</time><strong>{entry.level.toUpperCase()}</strong><span className="developer-log-source">{entry.source}</span><p>{entry.message}</p>
        </article>) : <p className="developer-console-empty">No log entries match this filter.</p>}
      </div>
      {error && <p className="developer-console-status" role="status">{error}</p>}
      <footer className="developer-console-actions"><Button variant="ghost" onClick={() => void clear()}>Clear logs</Button><div><Button variant="secondary" onClick={() => void copy()}>Copy</Button><Button variant="accent" onClick={() => void exportLogs()}>Export</Button></div></footer>
    </section>
  </div>;
}
