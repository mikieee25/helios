import { describe, expect, it } from "vitest";
import type { OverviewRow } from "./overview";
import type { Task } from "./store";
import { applyRowView, matchesQuery } from "./row-view";
import { nextSort, parseSort } from "./view-state";

const task = (gid: string, patch: Partial<Task>): OverviewRow => ({
  kind: "task",
  task: {
    gid, name: gid, size: 100, done: 0, speed: 0, upSpeed: 0, upTotal: 0,
    seeds: 0, peers: 0, state: "dl", queued: false, since: 0,
    category: "other", dir: "", files: [], torrent: false,
    errorMessage: "", errorCode: "", ...patch,
  },
});
const history = (id: string, name: string, size: number): OverviewRow => ({
  kind: "history",
  entry: { id, name, size, completedAt: 0, upTotal: 0, category: "other" },
});
const names = (rows: OverviewRow[]) =>
  rows.map((r) => (r.kind === "task" ? r.task.gid : r.entry.id));

describe("matchesQuery", () => {
  it("requires every term, ignoring case and order", () => {
    expect(matchesQuery("Ubuntu-24.04-Desktop.iso", "desk ubuntu")).toBe(true);
    expect(matchesQuery("Ubuntu-24.04-Desktop.iso", "fedora")).toBe(false);
    expect(matchesQuery("anything", "   ")).toBe(true);
  });
});

describe("applyRowView", () => {
  const rows = [
    task("b", { name: "file10.zip", size: 300, done: 0.5, seeds: 2 }),
    task("a", { name: "file2.zip", size: 100, done: 0.9, seeds: 9 }),
    history("h", "file1.zip", 200),
    task("c", { name: "movie.mkv", size: 50, done: 0.1, seeds: 0 }),
  ];
  it("filters by query without reordering", () => {
    expect(names(applyRowView(rows, "file", null))).toEqual(["b", "a", "h"]);
  });
  it("sorts names naturally (2 before 10)", () => {
    expect(names(applyRowView(rows, "", { key: "name", dir: "asc" }))).toEqual(["h", "a", "b", "c"]);
  });
  it("sorts numerically and descending", () => {
    expect(names(applyRowView(rows, "", { key: "size", dir: "desc" }))).toEqual(["b", "h", "a", "c"]);
  });
  it("keeps rows with no value last in both directions", () => {
    expect(names(applyRowView(rows, "", { key: "seeds", dir: "asc" })).at(-1)).toBe("h");
    expect(names(applyRowView(rows, "", { key: "seeds", dir: "desc" })).at(-1)).toBe("h");
  });
  it("ranks time left by remaining seconds; stalled tasks go last", () => {
    const eta = [
      task("slow", { size: 1000, done: 0, speed: 10 }),
      task("fast", { size: 1000, done: 0.9, speed: 100 }),
      task("stalled", { size: 1000, done: 0, speed: 0 }),
    ];
    expect(names(applyRowView(eta, "", { key: "time", dir: "asc" }))).toEqual(["fast", "slow", "stalled"]);
    expect(names(applyRowView(eta, "", { key: "time", dir: "desc" }))).toEqual(["slow", "fast", "stalled"]);
  });
  it("combines filter and sort", () => {
    expect(names(applyRowView(rows, "zip", { key: "progress", dir: "desc" }))).toEqual(["h", "a", "b"]);
  });
});

describe("sort state", () => {
  it("cycles asc -> desc -> none and restarts on a new column", () => {
    const a = nextSort(null, "name");
    expect(a).toEqual({ key: "name", dir: "asc" });
    const b = nextSort(a, "name");
    expect(b).toEqual({ key: "name", dir: "desc" });
    expect(nextSort(b, "name")).toBeNull();
    expect(nextSort(b, "size")).toEqual({ key: "size", dir: "asc" });
  });
  it("ignores corrupt stored values", () => {
    expect(parseSort("{nope")).toBeNull();
    expect(parseSort('{"key":"evil","dir":"asc"}')).toBeNull();
    expect(parseSort('{"key":"size","dir":"desc"}')).toEqual({ key: "size", dir: "desc" });
  });
});
