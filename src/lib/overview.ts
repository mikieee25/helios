import type { HistoryEntry } from "./history";
import type { Task } from "./store";

export type OverviewRow =
  { kind: "task"; task: Task } | { kind: "history"; entry: HistoryEntry };

type OverviewTask = Omit<Task, "state"> & { state: string };

function isKnownTask(task: OverviewTask): task is Task {
  return ["dl", "pa", "err", "seed", "done"].includes(task.state);
}

export function buildOverview(
  tasks: OverviewTask[],
  history: HistoryEntry[],
  category?: Task["category"]
): OverviewRow[] {
  const knownTasks = tasks.filter(isKnownTask);
  const taskRows = (["dl", "pa", "err", "seed"] as const).flatMap((state) =>
    knownTasks
      .filter(
        (task) =>
          task.state === state && (!category || task.category === category)
      )
      .map((task) => ({ kind: "task" as const, task }))
  );
  const liveGids = new Set(
    knownTasks.filter((task) => task.state !== "done").map((task) => task.gid)
  );
  const historyRows = history
    .filter(
      (entry) =>
        (!category || entry.category === category) && !liveGids.has(entry.id)
    )
    .map((entry) => ({ kind: "history" as const, entry }));
  return [...taskRows, ...historyRows];
}
