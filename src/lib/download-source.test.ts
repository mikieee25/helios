import { describe, expect, it } from "vitest";
import { isSupportedDownloadSource } from "./download-source";

describe("isSupportedDownloadSource", () => {
  it.each([
    "http://example.com/file.zip",
    "https://example.com/file.zip",
    "magnet:?xt=urn:btih:abc",
  ])("accepts supported source %s", (source) => {
    expect(isSupportedDownloadSource(source)).toBe(true);
  });

  it.each([
    "",
    "ftp://example.com/file.zip",
    "file:///tmp/file.zip",
    "javascript:alert(1)",
    "data:text/plain,hello",
    "http:///missing-host",
    "https://",
    "magnet:",
    "magnet:?",
  ])("rejects unsupported or malformed source %s", (source) => {
    expect(isSupportedDownloadSource(source)).toBe(false);
  });
});
