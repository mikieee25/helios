import { describe, expect, it } from "vitest";
import { taskActionForAria2Status } from "./task-actions";

describe("taskActionForAria2Status", () => {
  it.each([
    ["active", "pause"],
    ["waiting", "pause"],
    ["paused", "unpause"],
    ["complete", undefined],
    ["error", undefined],
    ["removed", undefined],
  ] as const)("maps %s to %s", (status, expected) => {
    expect(taskActionForAria2Status(status)).toBe(expected);
  });
});
