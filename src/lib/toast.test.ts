import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToast } from "./toast";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  useToast.getState().dismiss();
  vi.useRealTimers();
});

describe("toast", () => {
  it("auto-dismisses after the duration", () => {
    useToast.getState().show({ message: "hi" }, 1000);
    expect(useToast.getState().toast?.message).toBe("hi");
    vi.advanceTimersByTime(1001);
    expect(useToast.getState().toast).toBeUndefined();
  });
  it("replaces the current toast and gives it a new id", () => {
    useToast.getState().show({ message: "one" });
    const first = useToast.getState().toast!.id;
    useToast.getState().show({ message: "two" });
    expect(useToast.getState().toast).toMatchObject({ message: "two" });
    expect(useToast.getState().toast!.id).toBeGreaterThan(first);
  });
  it("pause stops the timer and resume restarts a short one", () => {
    useToast.getState().show({ message: "hold" }, 1000);
    useToast.getState().pause();
    vi.advanceTimersByTime(60_000);
    expect(useToast.getState().toast).toBeDefined();
    useToast.getState().resume();
    vi.advanceTimersByTime(3001);
    expect(useToast.getState().toast).toBeUndefined();
  });
  it("runAction runs the action once and dismisses", async () => {
    const onAction = vi.fn();
    useToast.getState().show({ message: "x", actionLabel: "Undo", onAction });
    await useToast.getState().runAction();
    expect(onAction).toHaveBeenCalledOnce();
    expect(useToast.getState().toast).toBeUndefined();
    await useToast.getState().runAction();
    expect(onAction).toHaveBeenCalledOnce();
  });
  it("shows the error if the action fails", async () => {
    useToast.getState().show({ message: "x", actionLabel: "Undo", onAction: () => { throw new Error("boom"); } });
    await useToast.getState().runAction();
    expect(useToast.getState().toast?.message).toBe("boom");
  });
});
