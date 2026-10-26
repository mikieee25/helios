import type { Task } from "./store";

const liveStates = new Set<Task["state"]>(["dl", "seed", "pa"]);

/** Keep live rows through polls that do not also fetch aria2's stopped list. */
export function reconcileTaskSnapshot(
  previous: Task[],
  reported: Task[],
  stoppedListIsFresh: boolean
): Task[] {
  if (stoppedListIsFresh) return reported;

  const present = new Set(reported.map((task) => task.gid));
  return [
    ...reported,
    ...previous.filter(
      (task) => liveStates.has(task.state) && !present.has(task.gid)
    ),
  ];
}
