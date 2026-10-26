import { describe, expect, it } from "vitest";
import { parseTaskColumnWidths, resizeTaskColumns } from "./task-columns";

describe("task column sizing", () => {
  it("moves width between adjacent columns without changing their total", () => {
    const resized = resizeTaskColumns([1, 1], 0, 30, [200, 100], [100, 60]);

    expect(resized[0]).toBeGreaterThan(1);
    expect(resized[1]).toBeLessThan(1);
    expect(resized[0] + resized[1]).toBeCloseTo(2);
  });

  it("clamps a drag at each column's minimum width", () => {
    const resized = resizeTaskColumns([1, 1], 0, 200, [200, 100], [100, 60]);

    expect(resized).toEqual(resizeTaskColumns([1, 1], 0, 40, [200, 100], [100, 60]));
  });

  it("loads saved widths and falls back for invalid data", () => {
    expect(parseTaskColumnWidths("[1,1,1,1,1,1]")).toHaveLength(6);
    expect(parseTaskColumnWidths("invalid")).toEqual(parseTaskColumnWidths(null));
  });
});
