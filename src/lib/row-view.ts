import type { OverviewRow } from "./overview";
import type { SortKey, SortState } from "./view-state";

/** Every whitespace-separated term must appear in the name (case-insensitive). */
export function matchesQuery(name: string, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = name.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

const rowName = (row: OverviewRow) =>
  row.kind === "task" ? row.task.name : row.entry.name;

/** null = "no value for this column"; those rows always sort last. */
function sortValue(row: OverviewRow, key: SortKey): string | number | null {
  if (row.kind === "history") {
    const entry = row.entry;
    if (key === "name") return entry.name;
    if (key === "progress") return 1;
    if (key === "size") return entry.size;
    return null;
  }
  const task = row.task;
  switch (key) {
    case "name":
      return task.name;
    case "progress":
      return task.done;
    case "size":
      return task.size;
    case "time": {
      if (task.state !== "dl" || task.speed <= 0) return null;
      const seconds = (task.size * (1 - task.done)) / task.speed;
      return Number.isFinite(seconds) ? seconds : null;
    }
    case "seeds":
      return task.seeds;
    case "peers":
      return task.peers;
  }
}

export function applyRowView(
  rows: OverviewRow[],
  query: string,
  sort: SortState
): OverviewRow[] {
  const filtered = query.trim()
    ? rows.filter((row) => matchesQuery(rowName(row), query))
    : rows;
  if (!sort) return filtered;
  const direction = sort.dir === "asc" ? 1 : -1;
  const keyed = filtered.map((row) => ({ row, value: sortValue(row, sort.key) }));
  keyed.sort((a, b) => {
    if (a.value === null && b.value === null) return 0;
    if (a.value === null) return 1;
    if (b.value === null) return -1;
    if (typeof a.value === "string" || typeof b.value === "string")
      return (
        direction *
        String(a.value).localeCompare(String(b.value), undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );
    return direction * (a.value - b.value);
  });
  return keyed.map((item) => item.row);
}
