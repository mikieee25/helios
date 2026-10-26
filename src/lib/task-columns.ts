export const DEFAULT_TASK_COLUMN_WIDTHS = [2.1, 1.3, 0.8, 0.9, 0.55, 0.55];
export const MIN_TASK_COLUMN_WIDTHS = [140, 72, 52, 72, 40, 40];

export function parseTaskColumnWidths(value: string | null): number[] {
  if (value) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (
        Array.isArray(parsed) &&
        parsed.length === DEFAULT_TASK_COLUMN_WIDTHS.length &&
        parsed.every((item) => Number.isFinite(item) && item > 0 && item <= 100)
      ) {
        const total = parsed.reduce((sum, item) => sum + item, 0);
        const defaultTotal = DEFAULT_TASK_COLUMN_WIDTHS.reduce(
          (sum, item) => sum + item,
          0
        );
        return parsed.map((item) => (item * defaultTotal) / total);
      }
    } catch {
      // Invalid local preferences use the defaults.
    }
  }
  return [...DEFAULT_TASK_COLUMN_WIDTHS];
}

export function resizeTaskColumns(
  widths: number[],
  index: number,
  deltaPx: number,
  trackWidths: number[],
  minWidths = MIN_TASK_COLUMN_WIDTHS
): number[] {
  if (
    index < 0 ||
    index >= widths.length - 1 ||
    trackWidths.length !== widths.length ||
    minWidths.length !== widths.length
  ) return widths;

  const totalPixels = trackWidths.reduce((sum, width) => sum + width, 0);
  const totalWeight = widths.reduce((sum, width) => sum + width, 0);
  if (totalPixels <= 0 || totalWeight <= 0) return widths;

  const delta = Math.max(
    minWidths[index] - trackWidths[index],
    Math.min(deltaPx, trackWidths[index + 1] - minWidths[index + 1])
  );
  const transfer = (delta / totalPixels) * totalWeight;
  const next = [...widths];
  next[index] += transfer;
  next[index + 1] -= transfer;
  return next;
}
