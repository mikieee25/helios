import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, optionsFor, validateProxy } from "./store";

describe("optionsFor", () => {
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
