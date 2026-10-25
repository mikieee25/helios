import { describe, expect, it } from "vitest";
import {
  formatFileIndexes,
  selectionTotals,
  type TorrentFile,
} from "./torrent-files";

const files: TorrentFile[] = [
  {
    index: 1,
    path: "one.bin",
    length: 100,
    completedLength: 40,
    selected: true,
  },
  {
    index: 2,
    path: "two.bin",
    length: 300,
    completedLength: 200,
    selected: false,
  },
  {
    index: 3,
    path: "three.bin",
    length: 50,
    completedLength: 10,
    selected: true,
  },
];

describe("torrent file helpers", () => {
  it("formats selected aria2 indexes as a comma-separated list", () => {
    expect(formatFileIndexes(files.filter((file) => file.selected))).toBe(
      "1,3"
    );
  });

  it("totals only selected file size and completed bytes", () => {
    expect(selectionTotals(files)).toEqual({ size: 150, completed: 50 });
  });
});
