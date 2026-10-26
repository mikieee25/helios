export function redactDiagnostics(value: string, profilePath?: string): string {
  let text = value;
  if (profilePath) {
    const normalized = profilePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[\\/]+/g, "[\\\\/]+");
    text = text.replace(new RegExp(normalized, "gi"), "%USERPROFILE%");
  }
  return text
    .replace(/(["']?(?:cookie|set-cookie|authorization|proxy-authorization|token|password)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,}\r\n]*)/gi, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL]")
    .replace(/\b[A-Z]:\\Users\\[^\\\s]+/gi, "%USERPROFILE%")
    .replace(/\b\/home\/[^/\s]+/gi, "%USERPROFILE%");
}
