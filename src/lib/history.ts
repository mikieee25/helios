import { readValue, writeValue } from "./persistence";
import type { FileCategory } from "./format";

export type HistoryEntry = {
  id: string;
  name: string;
  size: number;
  completedAt: number;
  upTotal: number;
  category: FileCategory;
  filePath?: string;
};

const KEY = "completedHistory";
const LIMIT = 5000;
let mutations: Promise<unknown> = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutations.then(operation);
  mutations = result.catch(() => {});
  return result;
}

export async function load(): Promise<HistoryEntry[]> {
  const entries = await readValue<HistoryEntry[]>(KEY, []);
  const latest = [...entries]
    .sort((a, b) => b.completedAt - a.completedAt)
    .slice(0, LIMIT);
  if (latest.length !== entries.length) await writeValue(KEY, latest);
  return latest;
}

export function add(
  entry: HistoryEntry
): Promise<{ entries: HistoryEntry[]; added: boolean }> {
  return serialize(async () => {
    const entries = await load();
    if (
      entries.some(
        (e) =>
          e.name === entry.name &&
          e.size === entry.size &&
          Math.abs(e.completedAt - entry.completedAt) < 5000
      )
    )
      return { entries, added: false };
    const next = [entry, ...entries.filter((e) => e.id !== entry.id)].slice(
      0,
      LIMIT
    );
    await writeValue(KEY, next);
    return { entries: next, added: true };
  });
}

export function remove(id: string): Promise<HistoryEntry[]> {
  return serialize(async () => {
    const next = (await load()).filter((entry) => entry.id !== id);
    await writeValue(KEY, next);
    return next;
  });
}

export function clear(): Promise<void> {
  return serialize(() => writeValue(KEY, []));
}
