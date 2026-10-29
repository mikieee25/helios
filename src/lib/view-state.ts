import { create } from "zustand";

export type SortKey = "name" | "progress" | "size" | "time" | "seeds" | "peers";
export type SortState = { key: SortKey; dir: "asc" | "desc" } | null;

const SORT_STORAGE_KEY = "helios-task-sort-v1";
const SORT_KEYS: SortKey[] = ["name", "progress", "size", "time", "seeds", "peers"];

export function parseSort(raw: string | null): SortState {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { key?: unknown; dir?: unknown };
    if (
      SORT_KEYS.includes(value.key as SortKey) &&
      (value.dir === "asc" || value.dir === "desc")
    )
      return { key: value.key as SortKey, dir: value.dir };
  } catch {
    // Fall through to "no sort".
  }
  return null;
}

/** none -> ascending -> descending -> none, per column. */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (!current || current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return null;
}

interface ViewState {
  query: string;
  sort: SortState;
  detailsOpen: boolean;
  setQuery(query: string): void;
  cycleSort(key: SortKey): void;
  hydrateSort(): void;
  setDetailsOpen(open: boolean): void;
}

export const useView = create<ViewState>((set, get) => ({
  query: "",
  sort: null,
  detailsOpen: false,
  setQuery: (query) => set({ query }),
  cycleSort: (key) => {
    const sort = nextSort(get().sort, key);
    set({ sort });
    try {
      if (sort) localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort));
      else localStorage.removeItem(SORT_STORAGE_KEY);
    } catch {
      // Sorting still works for this session without storage.
    }
  },
  hydrateSort: () => {
    try {
      set({ sort: parseSort(localStorage.getItem(SORT_STORAGE_KEY)) });
    } catch {
      // Keep the default order.
    }
  },
  setDetailsOpen: (detailsOpen) => set({ detailsOpen }),
}));
