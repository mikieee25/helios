import { error, info, warn } from "@tauri-apps/plugin-log";
import { redactDiagnostics } from "./diagnostics";

export type ConsoleEntry = {
  time: string;
  level: string;
  source: string;
  message: string;
};

export function logDiagnostic(
  level: "info" | "warn" | "error",
  source: string,
  message: string
) {
  const entry: ConsoleEntry = {
    time: String(Date.now()),
    level,
    source,
    message: redactDiagnostics(message),
  };
  const serialized = JSON.stringify(entry);
  const write = level === "error" ? error(serialized) : level === "warn" ? warn(serialized) : info(serialized);
  void write.catch(() => {});
}

export function parseConsoleEntry(message: string, level = "info"): ConsoleEntry {
  try {
    const entry = JSON.parse(message) as Partial<ConsoleEntry>;
    if (entry.time && entry.level && entry.source && typeof entry.message === "string") {
      return entry as ConsoleEntry;
    }
  } catch {
    // Native logger lines use their built-in prefix; keep the full line readable.
  }
  return { time: new Date().toISOString(), level, source: "Helios", message };
}
