import type { HistoryEntry } from "./history";
import type { Task } from "./store";

export type OverviewRow =
  | { kind: "task"; task: Task }
  | { kind: "history"; entry: HistoryEntry };

export function buildOverview(
  tasks: Task[],
  history: HistoryEntry[],
  category?: Task["category"]
): OverviewRow[] {
  const taskRows = (["dl", "pa", "err", "seed"] as const).flatMap((state) =>
    tasks
      .filter((task) => task.state === state && (!category || task.category === category))
      .map((task) => ({ kind: "task" as const, task }))
  );
  const liveGids = new Set(
    tasks.filter((task) => task.state !== "done").map((task) => task.gid)
  );
  const historyRows = history
    .filter((entry) => (!category || entry.category === category) && !liveGids.has(entry.id))
    .map((entry) => ({ kind: "history" as const, entry }));
  return [...taskRows, ...historyRows];
}
