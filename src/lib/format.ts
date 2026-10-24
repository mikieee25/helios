export const sz = (b: number) => {
  const m = b / 1048576;
  return m >= 1000 ? `${+(m / 1024).toFixed(2)}GB` : `${Math.round(m)}MB`;
};
export const mb = (b: number) => (b / 1048576).toFixed(1);
export const eta = (s: number) =>
  !isFinite(s)
    ? "—"
    : s < 60
      ? `${Math.max(1, Math.round(s))} sec`
      : s < 3600
        ? `${Math.round(s / 60)}min`
        : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}min`;
export const dur = (s: number) =>
  s < 60
    ? `${s} sec`
    : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} sec`;

export type FileCategory = "documents" | "music" | "videos" | "other";

const EXTENSIONS: Record<Exclude<FileCategory, "other">, Set<string>> = {
  documents: new Set([
    "pdf",
    "doc",
    "docx",
    "txt",
    "epub",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
  ]),
  music: new Set(["mp3", "flac", "wav", "aac", "ogg", "m4a"]),
  videos: new Set(["mp4", "mkv", "avi", "mov", "webm"]),
};

export function fileCategory(name: string): FileCategory {
  const ext = name.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
  return (
    (Object.entries(EXTENSIONS).find(([, extensions]) =>
      extensions.has(ext)
    )?.[0] as FileCategory | undefined) ?? "other"
  );
}

export function dominantCategory(files: string[]): FileCategory {
  const counts = new Map<FileCategory, number>();
  for (const file of files) {
    const category = fileCategory(file);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "other";
}
