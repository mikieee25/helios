export function isSupportedDownloadSource(value: string): boolean {
  const source = value.trim();
  if (!source) return false;

  if (/^magnet:/i.test(source)) {
    try {
      const url = new URL(source);
      return url.protocol === "magnet:" && Boolean(url.search);
    } catch {
      return false;
    }
  }

  if (!/^https?:\/\/[^/?#]+/i.test(source)) return false;
  try {
    const url = new URL(source);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      Boolean(url.hostname)
    );
  } catch {
    return false;
  }
}
