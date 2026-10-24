"use client";
import { memo, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useStore, Task, Filter } from "@/lib/store";
import type { HistoryEntry } from "@/lib/history";
import { sz, eta } from "@/lib/format";
import { Ic } from "./Icon";

const show = (t: Task, f: Filter) =>
  f === "all" ? t.state !== "done" : f !== "done" && f === t.state;
type RowProps = {
  t: Task;
  sel: boolean;
  onRemove(task: Task): void;
  onRetry(task: Task): void;
  onReveal(task: Task): void;
  onContext(event: React.MouseEvent, task: Task): void;
};

const Row = memo(function Row({ t, sel, onRemove, onRetry, onReveal, onContext }: RowProps) {
  const time =
    t.state === "dl"
      ? eta((t.size * (1 - t.done)) / t.speed)
      : t.state === "seed"
        ? "Seeding"
        : t.state === "done"
          ? "Completed"
          : t.state === "err"
            ? "Error"
            : t.queued
              ? "Queued"
              : "Paused";
  return (
    <div
      className={`row ${t.state}${sel ? " sel" : ""}`}
      onClick={() => useStore.getState().select(t.gid)}
      onContextMenu={(event) => onContext(event, t)}
    >
      <div className="nm">
        <span title={t.name}>{t.name}</span>
        <span className="row-actions">
          {(t.state === "dl" || t.state === "seed" || t.state === "pa") && <button className="st" aria-label={t.state === "pa" && !t.queued ? "Resume download" : "Pause download"} onClick={(event) => { event.stopPropagation(); useStore.getState().toggle(t); }}><Ic n={t.state === "pa" && !t.queued ? "down" : "pause"} /></button>}
          {t.state === "err" && <button className="st" aria-label="Retry download" onClick={(event) => { event.stopPropagation(); onRetry(t); }}><Ic n="retry" /></button>}
          <button className="st" aria-label={`Remove ${t.name}`} onClick={(event) => { event.stopPropagation(); onRemove(t); }}><Ic n="trash" /></button>
          <button className="st" aria-label={`Show ${t.name} in folder`} disabled={!t.files[0]?.path} onClick={(event) => { event.stopPropagation(); onReveal(t); }}><Ic n="reveal" /></button>
        </span>
      </div>
      <div>
        <div className="trk">
          <i style={{ width: `${(t.done * 100).toFixed(1)}%` }} />
        </div>
      </div>
      <div>{sz(t.size)}</div>
      <div>{time}</div>
      <div>{t.seeds}</div>
      <div>{t.peers}</div>
    </div>
  );
});

const CompletedRow = memo(function CompletedRow({
  entry,
  task,
  onRemove,
  onReveal,
  onContext,
}: {
  entry: HistoryEntry;
  task?: Task;
  onRemove(task: Task): void;
  onReveal(task: Task): void;
  onContext(event: React.MouseEvent, task: Task): void;
}) {
  return (
    <div className="row done" onContextMenu={task ? (event) => onContext(event, task) : undefined}>
      <div className="nm">
        <button
          className="st"
          aria-label={`Remove ${entry.name} from history`}
          onClick={() => void useStore.getState().removeHistory(entry.id)}
        >
          <Ic n="x" />
        </button>
        <span title={entry.name}>{entry.name}</span>
        {task && <span className="row-actions">
          <button className="st" aria-label={`Remove ${task.name}`} onClick={() => onRemove(task)}><Ic n="trash" /></button>
          <button className="st" aria-label={`Show ${task.name} in folder`} disabled={!task.files[0]?.path} onClick={() => onReveal(task)}><Ic n="reveal" /></button>
        </span>}
      </div>
      <div>
        <div className="trk">
          <i style={{ width: "100%" }} />
        </div>
      </div>
      <div>{sz(entry.size)}</div>
      <div>Completed</div>
      <div>—</div>
      <div>—</div>
    </div>
  );
});

export default function TaskTable() {
  const [menu, setMenu] = useState<{ task: Task; x: number; y: number }>();
  const [actionError, setActionError] = useState("");
  const parentRef = useRef<HTMLDivElement>(null);
  const tasks = useStore((s) => s.tasks);
  const history = useStore((s) => s.history);
  const filter = useStore((s) => s.filter);
  const category = useStore((s) => s.category);
  const online = useStore((s) => s.online);
  const rpcUrl = useStore((s) => s.rpcUrl);
  const sel = useStore((s) => s.sel ?? s.tasks[0]?.gid);
  const isHistory = filter === "done";
  useEffect(() => {
    parentRef.current?.scrollTo(0, 0);
  }, [filter, category]);
  const rows = isHistory
    ? history.filter((entry) => !category || entry.category === category)
    : tasks.filter(
        (t) => show(t, filter) && (!category || t.category === category)
      );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    getItemKey: (index) =>
      isHistory ? (rows[index] as HistoryEntry).id : (rows[index] as Task).gid,
    overscan: 6,
  });
  const emptyText = isHistory
    ? "No completed downloads yet."
    : online
      ? "Nothing here yet. Paste a link anywhere to start a download."
      : `Waiting for aria2 at ${rpcUrl}`;

  useEffect(() => {
    const close = () => setMenu(undefined);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, []);

  async function run(action: () => Promise<unknown>) {
    setActionError("");
    try { await action(); }
    catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }
    setMenu(undefined);
  }

  const remove = (task: Task) => void run(() => useStore.getState().removeTask(task));
  const retry = (task: Task) => void run(() => useStore.getState().retryTask(task));
  const reveal = (task: Task) => void run(async () => {
    const path = task.files[0]?.path;
    if (!path) throw new Error("aria2 has not provided a file path for this download.");
    await revealItemInDir(path);
  });
  const context = (event: React.MouseEvent, task: Task) => {
    event.preventDefault();
    setMenu({ task, x: event.clientX, y: event.clientY });
  };

  return (
    <div className="tbl">
      <div className="task-table-toolbar"><span className="lbl">Downloads</span></div>
      <div className="grid">
        <div className="row head">
          <span>NAME</span>
          <span>PROGRESS</span>
          <span>SIZE</span>
          <span>TIME LEFT</span>
          <span>SEEDS</span>
          <span>PEERS</span>
        </div>
        <div className="task-scroll" ref={parentRef}>
          {rows.length ? (
            <div
              className="virtual-list"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index];
                return (
                  <div
                    key={item.key}
                    className="virtual-row"
                    style={{
                      height: item.size,
                      transform: `translateY(${item.start}px)`,
                    }}
                  >
                    {isHistory ? (
                      <CompletedRow entry={row as HistoryEntry} task={tasks.find((task) => task.gid === (row as HistoryEntry).id)} onRemove={remove} onReveal={reveal} onContext={context} />
                    ) : (
                      <Row t={row as Task} sel={(row as Task).gid === sel} onRemove={remove} onRetry={retry} onReveal={reveal} onContext={context} />
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty">{emptyText}</div>
          )}
        </div>
        {isHistory && history.length > 0 && (
          <div className="history-actions">
            <button onClick={() => void useStore.getState().clearHistory()}>
              Clear history
            </button>
          </div>
        )}
      </div>
      {actionError && <div className="table-error" role="alert">{actionError}</div>}
      {menu && <div className="task-context-menu" role="menu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
        {(menu.task.state === "dl" || menu.task.state === "seed" || menu.task.state === "pa") && <button role="menuitem" onClick={() => useStore.getState().toggle(menu.task)}>{menu.task.state === "pa" && !menu.task.queued ? "Resume" : "Pause"}</button>}
        {menu.task.state === "err" && <button role="menuitem" onClick={() => retry(menu.task)}>Retry</button>}
        <button role="menuitem" onClick={() => remove(menu.task)}>Remove</button>
        <button role="menuitem" disabled={!menu.task.files[0]?.path} onClick={() => reveal(menu.task)}>Show in folder</button>
        <button role="menuitem" onClick={() => void run(async () => {
          const uri = (await useStore.getState().taskUris(menu.task.gid))[0];
          if (!uri) throw new Error("No source URL is available to copy.");
          await navigator.clipboard.writeText(uri);
        })}>Copy link</button>
      </div>}
    </div>
  );
}
