import { describe, expect, it } from "vitest";
import { bridgeItemLabel, bridgeItemOptions, type BridgeAddItem } from "./bridge";

describe("browser bridge mappings", () => {
  it("maps only supported aria2 options", () => {
    const item: BridgeAddItem = {
      url: "https://files.example.test/archive.zip?token=secret",
      referrer: "https://example.test/page",
      userAgent: "Helios extension",
      cookie: "session=secret",
      filename: "archive.zip",
    };
    expect(bridgeItemOptions(item)).toEqual({
      referer: item.referrer,
      "user-agent": item.userAgent,
      header: ["Cookie: session=secret"],
      out: item.filename,
    });
  });

  it("omits absent optional values", () => {
    expect(bridgeItemOptions({ url: "https://example.test/file" })).toEqual({});
  });

  it("chooses a safe notification label", () => {
    expect(bridgeItemLabel({ url: "https://files.example.test/a?token=secret" })).toBe(
      "files.example.test"
    );
    expect(bridgeItemLabel({ url: "magnet:?xt=urn:btih:abc" })).toBe(
      "magnet download"
    );
    expect(bridgeItemLabel({ url: "https://example.test/file", filename: "archive.zip" })).toBe(
      "archive.zip"
    );
  });
});
