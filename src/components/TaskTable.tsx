"use client";
import { memo, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useStore, Task, Filter } from "@/lib/store";
import type { HistoryEntry } from "@/lib/history";
import { sz, eta } from "@/lib/format";
import { Ic } from "./Icon";

const show = (t: Task, f: Filter) =>
  f === "all" ? t.state !== "done" : f !== "done" && f === t.state;
const ICON = { dl: "down", seed: "up", done: "check", pa: "pause", err: "x" };

const Row = memo(function Row({ t, sel }: { t: Task; sel: boolean }) {
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
    >
      <div className="nm">
        <button
          className="st"
          aria-label="Pause or resume"
          onClick={(e) => {
            e.stopPropagation();
            useStore.getState().toggle(t);
          }}
        >
          <Ic n={ICON[t.state]} />
        </button>
        <span title={t.name}>{t.name}</span>
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
}: {
  entry: HistoryEntry;
}) {
  return (
    <div className="row done">
      <div className="nm">
        <button
          className="st"
          aria-label={`Remove ${entry.name} from history`}
          onClick={() => void useStore.getState().removeHistory(entry.id)}
        >
          <Ic n="x" />
        </button>
        <span title={entry.name}>{entry.name}</span>
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

  return (
    <div className="tbl">
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
                      <CompletedRow entry={row as HistoryEntry} />
                    ) : (
                      <Row t={row as Task} sel={(row as Task).gid === sel} />
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
    </div>
  );
}
