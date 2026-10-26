export function taskActionForAria2Status(
  status: string
): "pause" | "unpause" | undefined {
  if (status === "active" || status === "waiting") return "pause";
  if (status === "paused") return "unpause";
  return undefined;
}
