import { describe, expect, it } from "vitest";
import { clampSettings, DEFAULT_SETTINGS, numberFieldState, optionsFor, validateProxy, type Settings } from "./store";

describe("optionsFor", () => {
  it("maps disk-allocation settings without unsupported DNS options", () => {
    expect(optionsFor(DEFAULT_SETTINGS)["file-allocation"]).toBe("prealloc");
    expect(optionsFor({ ...DEFAULT_SETTINGS, diskAllocation: "falloc" })[
      "file-allocation"
    ]).toBe("falloc");
    expect(Object.hasOwn(optionsFor(DEFAULT_SETTINGS), "async-dns")).toBe(false);
    expect(optionsFor({
      ...DEFAULT_SETTINGS,
      diskAllocation: "none",
    })["file-allocation"]).toBe("none");
  });

  it("maps connect timeout and a custom user agent", () => {
    expect(optionsFor(DEFAULT_SETTINGS)).toMatchObject({ "connect-timeout": "10", "user-agent": "" });
    expect(optionsFor({ ...DEFAULT_SETTINGS, connectTimeoutSeconds: 24, customUserAgent: "Helios test" })).toMatchObject({ "connect-timeout": "24", "user-agent": "Helios test" });
  });

  it("clears proxy options when proxy mode is none and maps default seeding and files", () => {
    const options = optionsFor(DEFAULT_SETTINGS);
    expect(options).toMatchObject({
      "all-proxy": "",
      "all-proxy-user": "",
      "all-proxy-passwd": "",
      "no-proxy": "",
      "seed-ratio": "1",
      "seed-time": "",
      "auto-file-renaming": "true",
      "allow-overwrite": "false",
    });
  });

  it("sets proxy values and clears empty optional fields in manual mode", () => {
    const options = optionsFor({
      ...DEFAULT_SETTINGS,
      proxyMode: "manual",
      proxyUrl: "https://proxy.example:8443",
      proxyUser: "user",
      proxyPassword: "secret",
      noProxy: "localhost,127.0.0.1",
    });
    expect(options).toMatchObject({
      "all-proxy": "https://proxy.example:8443",
      "all-proxy-user": "user",
      "all-proxy-passwd": "secret",
      "no-proxy": "localhost,127.0.0.1",
    });
    expect(
      optionsFor({
        ...DEFAULT_SETTINGS,
        proxyMode: "manual",
        proxyUrl: "proxy.example:3128",
      })
    ).toMatchObject({
      "all-proxy-user": "",
      "all-proxy-passwd": "",
      "no-proxy": "",
    });
    expect(
      optionsFor({ ...DEFAULT_SETTINGS, proxyMode: "manual", proxyUrl: "" })[
        "all-proxy"
      ]
    ).toBe("");
  });

  it.each([
    ["rename", "true", "false"],
    ["overwrite", "false", "true"],
    ["error", "false", "false"],
  ] as const)(
    "maps file conflict mode %s",
    (fileConflict, renaming, overwrite) => {
      expect(optionsFor({ ...DEFAULT_SETTINGS, fileConflict })).toMatchObject({
        "auto-file-renaming": renaming,
        "allow-overwrite": overwrite,
      });
    }
  );

  it("converts seeding hours to minutes and uses zero to disable seeding", () => {
    expect(
      optionsFor({ ...DEFAULT_SETTINGS, seedRatio: 0, seedTimeHours: 1.5 })
    ).toMatchObject({
      "seed-ratio": "0",
      "seed-time": "90",
    });
    expect(
      optionsFor({
        ...DEFAULT_SETTINGS,
        neverSeed: true,
        seedRatio: 2,
        seedTimeHours: 5,
      })
    ).toMatchObject({
      "seed-ratio": "",
      "seed-time": "0",
    });
    expect(
      optionsFor({ ...DEFAULT_SETTINGS, seedTimeHours: "" })
    ).toMatchObject({ "seed-time": "" });
  });
});

describe("settings normalization and number fields", () => {
  it("clamps settings loaded from older or edited preferences", () => {
    expect(clampSettings({ ...DEFAULT_SETTINGS, maxConcurrent: 0, connectionsPerServer: 90, connectTimeoutSeconds: 500, seedTimeHours: 9000 })).toMatchObject({ maxConcurrent: 1, connectionsPerServer: 16, connectTimeoutSeconds: 60, seedTimeHours: 8760 });
    expect(clampSettings({ ...DEFAULT_SETTINGS, diskAllocation: "bad" as Settings["diskAllocation"], theme: "bad" as Settings["theme"] })).toMatchObject({ diskAllocation: "prealloc", theme: "system" });
  });

  it.each([[0, "Unlimited", ""], ["", "No limit", ""], [5, "Unlimited", 5]] as const)("shows placeholder for %s", (value, placeholder, expectedValue) => {
    expect(numberFieldState(value, placeholder)).toEqual({ value: expectedValue, placeholder: value === 5 ? undefined : placeholder });
  });
});

describe("validateProxy", () => {
  it.each([
    "proxy.example:3128",
    "http://proxy.example:3128",
    "https://127.0.0.1:8443",
    "http://[::1]:3128",
  ])("accepts %s", (proxy) => expect(validateProxy(proxy)).toBeUndefined());

  it.each([
    "",
    "proxy.example",
    "http://proxy.example",
    "ftp://proxy.example:3128",
    "proxy.example:70000",
  ])("rejects invalid proxy %s", (proxy) =>
    expect(validateProxy(proxy)).toBeTruthy()
  );
});
