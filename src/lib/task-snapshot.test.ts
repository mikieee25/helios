import { describe, expect, it } from "vitest";
import type { Task } from "./store";
import { reconcileTaskSnapshot } from "./task-snapshot";

const task = (gid: string, state: Task["state"]): Task =>
  ({ gid, state }) as Task;

describe("reconcileTaskSnapshot", () => {
  it("keeps live rows during a poll that does not include stopped downloads", () => {
    const active = task("active", "dl");
    const paused = task("paused", "pa");

    expect(reconcileTaskSnapshot([active, paused], [], false)).toEqual([
      active,
      paused,
    ]);
  });

  it("drops missing rows when the stopped-download snapshot is refreshed", () => {
    expect(
      reconcileTaskSnapshot([task("removed", "dl")], [], true)
    ).toEqual([]);
  });

  it("uses fresh rows in place of the previous version", () => {
    const oldTask = task("same-gid", "dl");
    const freshTask = task("same-gid", "pa");

    expect(reconcileTaskSnapshot([oldTask], [freshTask], false)).toEqual([
      freshTask,
    ]);
  });
});
