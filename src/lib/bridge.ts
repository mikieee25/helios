export type BridgeAddItem = {
  url: string;
  referrer?: string;
  userAgent?: string;
  cookie?: string;
  filename?: string;
};

export function bridgeItemOptions(item: BridgeAddItem): Record<string, string | string[]> {
  return {
    ...(item.referrer ? { referer: item.referrer } : {}),
    ...(item.userAgent ? { "user-agent": item.userAgent } : {}),
    ...(item.cookie ? { header: [`Cookie: ${item.cookie}`] } : {}),
    ...(item.filename ? { out: item.filename } : {}),
  };
}

export function bridgeItemLabel(item: BridgeAddItem): string {
  if (item.filename) return item.filename;
  try {
    return new URL(item.url).hostname || "magnet download";
  } catch {
    return "magnet download";
  }
}
