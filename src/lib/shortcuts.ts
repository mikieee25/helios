export const KEYBOARD_SHORTCUTS = [
  { id: "newDownload", label: "New download", binding: "Ctrl+N" },
  { id: "selectAll", label: "Select all downloads", binding: "Ctrl+A" },
  { id: "removeSelected", label: "Remove selected downloads", binding: "Delete" },
  { id: "focusSearch", label: "Focus search", binding: "Ctrl+F" },
  { id: "quickSearch", label: "Quick search", binding: "Shift+/" },
  { id: "undoRemove", label: "Undo remove", binding: "Ctrl+Z" },
  { id: "togglePause", label: "Pause or resume selected", binding: "Space" },
  { id: "showDetails", label: "Show download details", binding: "Enter" },
  { id: "previousDownload", label: "Previous download", binding: "ArrowUp" },
  { id: "nextDownload", label: "Next download", binding: "ArrowDown" },
  { id: "clearSearch", label: "Clear search or selection", binding: "Escape" },
] as const;

export type ShortcutId = (typeof KEYBOARD_SHORTCUTS)[number]["id"];
export type ShortcutBindings = Partial<Record<ShortcutId, string>>;

type ShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
>;

function keyName(key: string) {
  if (key === " ") return "Space";
  if (key === "+") return "Plus";
  return key.length === 1 ? key.toUpperCase() : key;
}

function parseBinding(binding: string) {
  const parts = binding.split("+");
  const key = parts.pop();
  if (!key) return undefined;
  const modifiers = new Set(parts);
  if ([...modifiers].some((part) => !["Ctrl", "Alt", "Shift"].includes(part)))
    return undefined;
  if (modifiers.size !== parts.length) return undefined;
  return { key: keyName(key === "Plus" ? "+" : key), modifiers };
}

export function normalizeShortcut(binding: string): string | undefined {
  const parsed = parseBinding(binding);
  if (!parsed) return undefined;
  const modifiers = ["Ctrl", "Alt", "Shift"].filter((part) =>
    parsed.modifiers.has(part)
  );
  const key = parsed.key;
  if (["Control", "Alt", "Shift", "Meta"].includes(key)) return undefined;
  return [...modifiers, key].join("+");
}

export function shortcutFromEvent(event: ShortcutEvent): string | undefined {
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return undefined;
  const key = keyName(event.key);
  if (!key || key === "Unidentified" || key === "Dead") return undefined;
  const modifiers = [
    ...(event.ctrlKey || event.metaKey ? ["Ctrl"] : []),
    ...(event.altKey ? ["Alt"] : []),
    ...(event.shiftKey ? ["Shift"] : []),
  ];
  return [...modifiers, key === "+" ? "Plus" : key].join("+");
}

export function shortcutLabel(binding: string): string {
  return binding === "Shift+/" ? "/" : binding.split("+").join(" + ");
}

export function getShortcutBinding(
  id: ShortcutId,
  bindings: ShortcutBindings = {}
) {
  return bindings[id] ?? KEYBOARD_SHORTCUTS.find((shortcut) => shortcut.id === id)!.binding;
}

export function shortcutMatches(
  event: ShortcutEvent,
  id: ShortcutId,
  bindings: ShortcutBindings = {}
) {
  const parsed = parseBinding(getShortcutBinding(id, bindings));
  if (!parsed || keyName(event.key) !== parsed.key) return false;
  return (
    parsed.modifiers.has("Ctrl") === (event.ctrlKey || event.metaKey) &&
    parsed.modifiers.has("Alt") === event.altKey &&
    parsed.modifiers.has("Shift") === event.shiftKey
  );
}

export function clampShortcutBindings(value: unknown): ShortcutBindings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const candidates = new Map<ShortcutId, string>();
  const groups = new Map<string, ShortcutId[]>();
  for (const { id, binding: fallback } of KEYBOARD_SHORTCUTS) {
    const binding = source[id];
    const normalized = typeof binding === "string" ? normalizeShortcut(binding) : undefined;
    const candidate = normalized ?? fallback;
    candidates.set(id, candidate);
    groups.set(candidate, [...(groups.get(candidate) ?? []), id]);
  }
  const conflicts = new Set(
    [...groups.values()].filter((ids) => ids.length > 1).flat()
  );
  const result: ShortcutBindings = {};
  for (const { id, binding: fallback } of KEYBOARD_SHORTCUTS) {
    const candidate = candidates.get(id)!;
    if (!conflicts.has(id) && candidate !== fallback) result[id] = candidate;
  }
  return result;
}
