import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "./history";
import type { Task } from "./store";
import { buildOverview } from "./overview";

const task = (
  gid: string,
  state: string,
  category: Task["category"] = "other"
) =>
  ({
    gid,
    name: gid,
    size: 1,
    done: 0,
    speed: 0,
    upSpeed: 0,
    upTotal: 0,
    seeds: 0,
    peers: 0,
    state,
    queued: false,
    since: 0,
    category,
    dir: "",
    files: [],
    torrent: false,
    errorMessage: "",
    errorCode: "",
  }) as Task;

const entry = (
  id: string,
  category: HistoryEntry["category"] = "other"
): HistoryEntry => ({
  id,
  name: id,
  size: 1,
  completedAt: 0,
  upTotal: 0,
  category,
});

describe("buildOverview", () => {
  it("excludes removed tasks without hiding their history entry", () => {
    const completed = entry("removed-gid");
    expect(
      buildOverview([task("removed-gid", "removed")], [completed])
    ).toEqual([{ kind: "history", entry: completed }]);
  });

  it("counts a completed but seeding torrent once", () => {
    const completed = entry("seed-gid");
    const rows = buildOverview([task("seed-gid", "seed")], [completed]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "task",
      task: { gid: "seed-gid", state: "seed" },
    });
  });

  it("excludes history entries that still have a live task", () => {
    const old = entry("paused-gid");
    const rows = buildOverview([task("paused-gid", "pa")], [old]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "task",
      task: { gid: "paused-gid" },
    });
  });

  it("applies the category filter to tasks and history", () => {
    const musicTask = task("music-gid", "dl", "music");
    const documentEntry = entry("document-gid", "documents");
    const musicEntry = entry("music-history-gid", "music");
    expect(
      buildOverview([musicTask], [documentEntry, musicEntry], "music")
    ).toEqual([
      { kind: "task", task: musicTask },
      { kind: "history", entry: musicEntry },
    ]);
  });
});
