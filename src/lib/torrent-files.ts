export type TorrentFile = {
  index: number;
  path: string;
  length: number;
  completedLength: number;
  selected: boolean;
};

export function formatFileIndexes(files: TorrentFile[]) {
  return files.map((file) => file.index).join(",");
}

export function selectionTotals(files: TorrentFile[]) {
  return files.reduce(
    (totals, file) =>
      file.selected
        ? {
            size: totals.size + file.length,
            completed: totals.completed + file.completedLength,
          }
        : totals,
    { size: 0, completed: 0 }
  );
}
