"use client";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { gsap } from "gsap";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useStore, Task } from "@/lib/store";
import type { HistoryEntry } from "@/lib/history";
import { buildOverview, type OverviewRow } from "@/lib/overview";
import { sz, eta } from "@/lib/format";
import { Ic } from "./Icon";
import { layoutVirtualRow } from "./virtual-row-layout";
import SelectFilesDialog from "./SelectFilesDialog";

type RowProps = {
  t: Task;
  sel: boolean;
  onRemove(task: Task): void;
  onToggle(task: Task): void;
  onRetry(task: Task): void;
  onReveal(task: Task): void;
  onOpen(task: Task): void;
  onSelectFiles(task: Task): void;
  onSelect(gid: string, event: ReactMouseEvent): void;
  onContext(event: React.MouseEvent, task: Task): void;
  disabled?: boolean;
};

const Row = memo(function Row({
  t,
  sel,
  onRemove,
  onToggle,
  onRetry,
  onReveal,
  onOpen,
  onSelectFiles,
  onSelect,
  onContext,
  disabled = false,
}: RowProps) {
  const time =
    t.state === "dl"
      ? eta((t.size * (1 - t.done)) / t.speed)
      : t.state === "seed"
        ? "Seeding"
        : t.state === "done"
          ? "Completed"
          : t.state === "err"
            ? "Failed"
            : t.queued
              ? "Queued"
              : "Paused";
  return (
    <div
      className={`row ${t.state}${sel ? " sel" : ""}`}
      title={
        t.state === "err"
          ? [t.errorMessage, t.errorCode && `Error ${t.errorCode}`]
              .filter(Boolean)
              .join("\n") || "Download failed"
          : undefined
      }
      onClick={(event) => onSelect(t.gid, event)}
      onDoubleClick={() => !disabled && t.state === "done" && onOpen(t)}
      onContextMenu={(event) => onContext(event, t)}
    >
      <div className="nm">
        <span
          title={
            t.state === "err"
              ? [t.errorMessage, t.errorCode && `Error ${t.errorCode}`]
                  .filter(Boolean)
                  .join("\n") || "Download failed"
              : t.name
          }
        >
          {t.name}
        </span>
        <span className="row-actions">
          {(t.state === "dl" || t.state === "seed" || t.state === "pa") && (
            <button
              className="st"
              disabled={disabled}
              aria-label={
                t.state === "pa" && !t.queued
                  ? "Resume download"
                  : "Pause download"
              }
              onClick={(event) => {
                event.stopPropagation();
                onToggle(t);
              }}
            >
              <Ic n={t.state === "pa" && !t.queued ? "down" : "pause"} />
            </button>
          )}
          {t.state === "err" && (
            <button
              className="st"
              disabled={disabled}
              aria-label="Retry download"
              onClick={(event) => {
                event.stopPropagation();
                onRetry(t);
              }}
            >
              <Ic n="retry" />
            </button>
          )}
          {t.torrent && (t.state === "pa" || t.state === "dl") && (
            <button
              className="st"
              disabled={disabled}
              aria-label={`Select files in ${t.name}`}
              title="Select files"
              onClick={(event) => {
                event.stopPropagation();
                onSelectFiles(t);
              }}
            >
              <Ic n="doc" />
            </button>
          )}
          <button
            className="st"
            disabled={disabled}
            aria-label={`Remove ${t.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onRemove(t);
            }}
          >
            <Ic n="trash" />
          </button>
          <button
            className="st"
            aria-label={`Show ${t.name} in folder`}
            disabled={disabled || !t.files[0]?.path}
            onClick={(event) => {
              event.stopPropagation();
              onReveal(t);
            }}
          >
            <Ic n="reveal" />
          </button>
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
  onOpen,
  onContext,
  online,
}: {
  entry: HistoryEntry;
  task?: Task;
  onRemove(task: Task): void;
  onReveal(task: Task): void;
  onOpen(path: string): void;
  onContext(event: React.MouseEvent, task: Task): void;
  online: boolean;
}) {
  return (
    <div
      className="row done"
      onDoubleClick={() => onOpen(entry.filePath || task?.files[0]?.path || "")}
      onContextMenu={task ? (event) => onContext(event, task) : undefined}
    >
      <div className="nm">
        <button
          className="st"
          aria-label={`Remove ${entry.name} from history`}
          onClick={() => void useStore.getState().removeHistory(entry.id)}
        >
          <Ic n="x" />
        </button>
        <span title={entry.name}>{entry.name}</span>
        {task && (
          <span className="row-actions">
            <button
              className="st"
              aria-label={`Remove ${task.name}`}
              disabled={!online}
              onClick={() => onRemove(task)}
            >
              <Ic n="trash" />
            </button>
            <button
              className="st"
              aria-label={`Show ${task.name} in folder`}
              disabled={!online || !task.files[0]?.path}
              onClick={() => onReveal(task)}
            >
              <Ic n="reveal" />
            </button>
          </span>
        )}
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
  const [fileSelection, setFileSelection] = useState<Task>();
  const [menu, setMenu] = useState<{ task: Task; x: number; y: number }>();
  const [actionError, setActionError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmTasks, setConfirmTasks] = useState<Task[]>([]);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [offlineTimedOut, setOfflineTimedOut] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const parentRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const positions = useRef(new Map<string, number>());
  const previousKeys = useRef(new Set<string>());
  const previousOrder = useRef<string[]>([]);
  const previousLayout = useRef("");
  const laidOut = useRef(false);
  const anchor = useRef<string | undefined>(undefined);
  const tasks = useStore((s) => s.tasks);
  const history = useStore((s) => s.history);
  const filter = useStore((s) => s.filter);
  const category = useStore((s) => s.category);
  const online = useStore((s) => s.online);
  const reduceMotion = useStore((s) => s.settings.reduceMotion);
  const compactList = useStore((s) => s.settings.compactList);
  const confirmBeforeRemoving = useStore((s) => s.settings.confirmBeforeRemoving);
  const deleteFilesByDefault = useStore((s) => s.settings.deleteFilesWhenRemoving);
  const connectedOnce = useStore((s) => s.connectedOnce);
  const ready = useStore((s) => s.ready);
  const rpcUrl = useStore((s) => s.rpcUrl);
  const view = useStore((s) => s.view);
  const sel = useStore((s) => s.sel ?? s.tasks[0]?.gid);
  const isHistory = filter === "done";
  useEffect(() => {
    parentRef.current?.scrollTo(0, 0);
    setSelected(new Set());
    anchor.current = undefined;
  }, [filter, category]);
  const rows: OverviewRow[] =
    filter === "all"
      ? buildOverview(tasks, history, category)
      : isHistory
        ? history
            .filter((entry) => !category || entry.category === category)
            .map((entry) => ({ kind: "history", entry }))
        : tasks
            .filter(
              (task) =>
                task.state === filter &&
                (!category || task.category === category)
            )
            .map((task) => ({ kind: "task", task }));
  const taskRows = rows
    .filter(
      (row): row is Extract<OverviewRow, { kind: "task" }> =>
        row.kind === "task"
    )
    .map((row) => row.task);
  const selectedTasks = taskRows.filter((task) => selected.has(task.gid));
  const taskRowsRef = useRef(taskRows);
  const selectedTasksRef = useRef(selectedTasks);
  taskRowsRef.current = taskRows;
  selectedTasksRef.current = selectedTasks;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => compactList ? 44 : 52,
    getItemKey: (index) => {
      const row = rows[index];
      return row.kind === "task" ? row.task.gid : row.entry.id;
    },
    overscan: 6,
  });
  const layoutSignature = `${filter}\0${category ?? ""}\0${view}`;
  const rowKeys = rows.map((row) =>
    row.kind === "task" ? row.task.gid : row.entry.id
  );
  useLayoutEffect(() => {
    const reset =
      !laidOut.current || previousLayout.current !== layoutSignature;
    const orderChanged =
      !reset &&
      (rowKeys.length !== previousOrder.current.length ||
        rowKeys.some((key, index) => previousOrder.current[index] !== key));
    const isReduced = reduceMotion;
    const currentKeys = new Set(rowKeys);
    if (reset) positions.current.clear();
    for (const item of virtualizer.getVirtualItems()) {
      const row = rows[item.index];
      const key = row.kind === "task" ? row.task.gid : row.entry.id;
      const element = rowRefs.current.get(key);
      if (!element) continue;
      const previous = positions.current.get(key);
      const moved =
        !reset &&
        orderChanged &&
        previous !== undefined &&
        previous !== item.start;
      layoutVirtualRow(
        element,
        item.start,
        moved && !isReduced ? previous : undefined
      );
      if (moved && !isReduced) {
        const rowElement = element.firstElementChild as HTMLElement | null;
        if (rowElement) {
          gsap.fromTo(
            rowElement,
            { backgroundColor: "var(--sel)" },
            {
              backgroundColor: rowElement.classList.contains("sel")
                ? "var(--sel)"
                : "var(--row)",
              duration: 0.6,
              ease: "power2.out",
              overwrite: "auto",
              clearProps: "backgroundColor",
            }
          );
        }
      }
      const inner = element.firstElementChild as HTMLElement | null;
      if (!reset && !previousKeys.current.has(key) && !isReduced) {
        if (inner)
          gsap.fromTo(
            inner,
            { opacity: 0, x: -12 },
            {
              opacity: 1,
              x: 0,
              duration: 0.35,
              overwrite: "auto",
              onComplete: () =>
                gsap.set(inner, { clearProps: "opacity,transform" }),
            }
          );
      } else if (inner) gsap.set(inner, { clearProps: "opacity,transform" });
      positions.current.set(key, item.start);
    }
    const scroller = parentRef.current;
    if (scroller) {
      scroller.scrollTop = Math.min(
        scroller.scrollTop,
        Math.max(0, virtualizer.getTotalSize() - scroller.clientHeight)
      );
    }
    for (const key of positions.current.keys())
      if (!currentKeys.has(key)) positions.current.delete(key);
    previousKeys.current = currentKeys;
    previousOrder.current = rowKeys;
    previousLayout.current = layoutSignature;
    laidOut.current = true;
  });
  useEffect(
    () => () => {
      for (const element of rowRefs.current.values()) {
        gsap.killTweensOf(element);
        if (element.firstElementChild)
          gsap.killTweensOf(element.firstElementChild);
      }
    },
    []
  );
  useEffect(() => {
    setOfflineTimedOut(false);
    if (!ready || online) return;
    const timer = setTimeout(() => setOfflineTimedOut(true), 10_000);
    return () => clearTimeout(timer);
  }, [ready, online, retryVersion]);
  const emptyText = isHistory
    ? "No completed downloads yet."
    : "Nothing here yet. Paste a link anywhere to start a download.";
  const hasOfflineTasks = !online && taskRows.length > 0;
  const showEngineState = !online && !rows.length && !isHistory;

  useEffect(() => {
    const close = () => setMenu(undefined);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, []);
  useEffect(() => {
    if (!online) setMenu(undefined);
  }, [online]);

  async function run(action: () => Promise<unknown>) {
    setActionError("");
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
    setMenu(undefined);
  }

  const requestRemoval = (items: Task[]) => {
    if (!items.length) return;
    if (confirmBeforeRemoving) {
      setConfirmTasks(items);
      setDeleteFiles(deleteFilesByDefault);
      return;
    }
    void run(async () => {
      await Promise.all(items.map((task) => useStore.getState().removeTask(task, deleteFilesByDefault)));
      setSelected(new Set());
    });
  };

  const remove = (task: Task) => requestRemoval([task]);
  const requestRemoveSelection = () => {
    if (!online || !selectedTasks.length) return;
    requestRemoval(selectedTasks);
  };
  const retry = (task: Task) =>
    void run(() => useStore.getState().retryTask(task));
  const toggle = (task: Task) =>
    void run(() => useStore.getState().toggle(task));
  const reveal = (task: Task) =>
    void run(async () => {
      const path = task.files[0]?.path;
      if (!path)
        throw new Error(
          "aria2 has not provided a file path for this download."
        );
      await revealItemInDir(path);
    });
  const openFile = (path: string) =>
    void run(async () => {
      if (!path)
        throw new Error(
          "aria2 has not provided a file path for this download."
        );
      await invoke("open_download_file", { path });
    });
  const open = (task: Task) => openFile(task.files[0]?.path ?? "");
  const selectRow = (gid: string, event: ReactMouseEvent) => {
    const index = taskRows.findIndex((task) => task.gid === gid);
    const anchorIndex = anchor.current
      ? taskRows.findIndex((task) => task.gid === anchor.current)
      : index;
    if (event.shiftKey && index >= 0 && anchorIndex >= 0) {
      const range = taskRows.slice(
        Math.min(index, anchorIndex),
        Math.max(index, anchorIndex) + 1
      );
      setSelected(
        (current) =>
          new Set(
            event.ctrlKey || event.metaKey
              ? [...current, ...range.map((task) => task.gid)]
              : range.map((task) => task.gid)
          )
      );
    } else if (event.ctrlKey || event.metaKey) {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(gid)) next.delete(gid);
        else next.add(gid);
        return next;
      });
      anchor.current = gid;
    } else {
      setSelected(new Set([gid]));
      anchor.current = gid;
    }
    useStore.getState().select(gid);
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          /INPUT|TEXTAREA|SELECT/.test(target.tagName))
      )
        return;
      if (isHistory) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        const visible = taskRowsRef.current;
        setSelected(new Set(visible.map((task) => task.gid)));
        anchor.current = visible[0]?.gid;
      } else if (event.key === "Delete" && selectedTasksRef.current.length) {
        if (!online) return;
        event.preventDefault();
        requestRemoval(selectedTasksRef.current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isHistory, online]);
  const runSelection = (paused: boolean) =>
    void run(async () => {
      await Promise.all(
        selectedTasks
          .filter((task) =>
            paused
              ? task.state === "dl" || task.state === "seed" || task.queued
              : task.state === "pa" && !task.queued
          )
          .map((task) => useStore.getState().toggle(task))
      );
    });
  const confirmRemove = () =>
    void run(async () => {
      const errors: string[] = [];
      for (const task of confirmTasks) {
        try {
          await useStore.getState().removeTask(task, deleteFiles);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      setConfirmTasks([]);
      setSelected(new Set());
      if (errors.length) throw new Error(errors.join("\n"));
    });
  const context = (event: React.MouseEvent, task: Task) => {
    event.preventDefault();
    if (!online) return;
    setMenu({ task, x: event.clientX, y: event.clientY });
  };

  return (
    <div className="tbl">
      <div className="task-table-toolbar">
        <span className="lbl">
          Downloads <span className="download-count">{rows.length}</span>
        </span>
      </div>
      {selectedTasks.length > 0 && !isHistory && (
        <div
          className="selection-bar"
          role="toolbar"
          aria-label={`${selectedTasks.length} downloads selected`}
        >
          <span>{selectedTasks.length} selected</span>
          <button
            className="secondary-button"
            disabled={!online}
            onClick={() => runSelection(true)}
          >
            Pause
          </button>
          <button
            className="secondary-button"
            disabled={!online}
            onClick={() => runSelection(false)}
          >
            Resume
          </button>
          <button
            className="secondary-button"
            disabled={!online}
            onClick={requestRemoveSelection}
          >
            Remove
          </button>
          <button
            className="selection-clear"
            aria-label="Clear selection"
            onClick={() => setSelected(new Set())}
          >
            ×
          </button>
        </div>
      )}
      <div className="grid">
        <div className="row head">
          <span>NAME</span>
          <span>PROGRESS</span>
          <span>SIZE</span>
          <span>TIME LEFT</span>
          <span>SEEDS</span>
          <span>PEERS</span>
        </div>
        {hasOfflineTasks && (
          <div className="connection-banner" role="status">
            {connectedOnce
              ? "Connection lost. Reconnecting..."
              : "Connecting to the download engine..."}
          </div>
        )}
        <div
          className={`task-scroll${hasOfflineTasks ? " connection-lost" : ""}${compactList ? " compact" : ""}`}
          ref={parentRef}
        >
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
                    data-key={row.kind === "task" ? row.task.gid : row.entry.id}
                    ref={(element) => {
                      const key =
                        row.kind === "task" ? row.task.gid : row.entry.id;
                      if (element) rowRefs.current.set(key, element);
                      else rowRefs.current.delete(key);
                    }}
                    style={{ height: item.size }}
                  >
                    {row.kind === "history" ? (
                      <CompletedRow
                        entry={row.entry}
                        task={tasks.find((task) => task.gid === row.entry.id)}
                        online={online}
                        onRemove={remove}
                        onReveal={reveal}
                        onOpen={openFile}
                        onContext={context}
                      />
                    ) : (
                      <Row
                        t={row.task}
                        sel={
                          selected.size
                            ? selected.has(row.task.gid)
                            : row.task.gid === sel
                        }
                        disabled={!online}
                        onRemove={remove}
                        onToggle={toggle}
                        onRetry={retry}
                        onReveal={reveal}
                        onOpen={open}
                        onSelectFiles={setFileSelection}
                        onSelect={selectRow}
                        onContext={context}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : showEngineState ? (
            <div className="engine-state" role="status">
              <span
                className={`engine-spinner${offlineTimedOut ? " failed" : ""}`}
                aria-hidden="true"
              />
              <strong>
                {offlineTimedOut
                  ? "Can't reach the download engine"
                  : "Starting the download engine..."}
              </strong>
              {offlineTimedOut && (
                <>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setOfflineTimedOut(false);
                      setRetryVersion((version) => version + 1);
                      useStore.getState().reconnect();
                    }}
                  >
                    Retry
                  </button>
                  {rpcUrl && (
                    <details>
                      <summary>Details</summary>
                      <code>{rpcUrl}</code>
                    </details>
                  )}
                </>
              )}
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
      {actionError && (
        <div className="table-error" role="alert">
          {actionError}
        </div>
      )}
      {menu && online && (
        <div
          className="task-context-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {(menu.task.state === "dl" ||
            menu.task.state === "seed" ||
            menu.task.state === "pa") && (
            <button
              role="menuitem"
              onClick={() =>
                void run(() => useStore.getState().toggle(menu.task))
              }
            >
              {menu.task.state === "pa" && !menu.task.queued
                ? "Resume"
                : "Pause"}
            </button>
          )}
          {menu.task.state === "err" && (
            <button role="menuitem" onClick={() => retry(menu.task)}>
              Retry
            </button>
          )}
          {menu.task.torrent &&
            (menu.task.state === "pa" || menu.task.state === "dl") && (
              <button
                role="menuitem"
                onClick={() => {
                  setFileSelection(menu.task);
                  setMenu(undefined);
                }}
              >
                Select files
              </button>
            )}
          <button role="menuitem" onClick={() => remove(menu.task)}>
            Remove
          </button>
          <button
            role="menuitem"
            disabled={!menu.task.files[0]?.path}
            onClick={() => reveal(menu.task)}
          >
            Show in folder
          </button>
          <button
            role="menuitem"
            onClick={() =>
              void run(async () => {
                const uri = (
                  await useStore.getState().taskUris(menu.task.gid)
                )[0];
                if (!uri)
                  throw new Error("No source URL is available to copy.");
                await navigator.clipboard.writeText(uri);
              })
            }
          >
            Copy link
          </button>
        </div>
      )}
      {confirmTasks.length > 0 && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirmTasks([]);
          }}
        >
          <section
            className="add-dialog remove-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-title"
          >
            <div className="modal-heading">
              <div>
                <div className="lbl">REMOVE DOWNLOAD</div>
                <h2 id="remove-title">
                  Remove{" "}
                  {confirmTasks.length === 1
                    ? confirmTasks[0].name
                    : `${confirmTasks.length} downloads`}
                  ?
                </h2>
              </div>
              <button
                className="modal-close"
                aria-label="Close"
                onClick={() => setConfirmTasks([])}
              >
                ×
              </button>
            </div>
            {confirmTasks.length > 1 && (
              <div className="remove-list">
                {confirmTasks.slice(0, 5).map((task) => (
                  <div key={task.gid}>{task.name}</div>
                ))}
                {confirmTasks.length > 5 && (
                  <div>and {confirmTasks.length - 5} more</div>
                )}
              </div>
            )}
            <label className="modal-checkbox">
              <input
                type="checkbox"
                checked={deleteFiles}
                onChange={(event) => setDeleteFiles(event.target.checked)}
              />
              Also delete downloaded files
            </label>
            <div className="modal-footer">
              <button
                className="secondary-button"
                onClick={() => setConfirmTasks([])}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={!online}
                onClick={confirmRemove}
              >
                Remove
              </button>
            </div>
          </section>
        </div>
      )}
      {fileSelection && (
        <SelectFilesDialog
          key={fileSelection.gid}
          gid={fileSelection.gid}
          wasActive={fileSelection.state === "dl"}
          onClose={() => setFileSelection(undefined)}
        />
      )}
    </div>
  );
}
