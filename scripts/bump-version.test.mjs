import { describe, expect, it } from "vitest";
import {
  bump,
  updateCargoLockVersion,
  updateCargoTomlVersion,
  validateVersions,
  cargoLockVersion,
} from "./bump-version.mjs";

describe("bump", () => {
  it.each([
    ["patch", "1.2.3", "1.2.4"],
    ["minor", "1.2.3", "1.3.0"],
    ["major", "1.2.3", "2.0.0"],
  ])("bumps %s from %s to %s", (kind, current, next) => {
    expect(bump(current, kind)).toBe(next);
  });

  it("rejects invalid versions and bump kinds", () => {
    expect(() => bump("1.2", "patch")).toThrow();
    expect(() => bump("1.2.3", "beta")).toThrow();
  });
});

describe("version consistency", () => {
  it("rejects mismatched project versions", () => {
    expect(() =>
      validateVersions({
        packageVersion: "1.2.3",
        lockRootVersion: "1.2.3",
        lockPackageVersion: "1.2.3",
        tauriVersion: "1.2.4",
        cargoVersion: "1.2.3",
        cargoLockVersion: "1.2.3",
      }),
    ).toThrow(/disagree/);
  });
});

describe("Cargo fixture edits", () => {
  it("updates only the package version in Cargo.toml", () => {
    const input = `[package]\nname = "helios"\nversion = "1.2.3"\n\n[dependencies]\nother = { version = "1.2.3" }\n`;
    expect(updateCargoTomlVersion(input, "2.0.0")).toBe(
      `[package]\nname = "helios"\nversion = "2.0.0"\n\n[dependencies]\nother = { version = "1.2.3" }\n`,
    );
  });

  it("updates only the helios package in Cargo.lock", () => {
    const input = `[[package]]\nname = "other"\nversion = "1.2.3"\n\n[[package]]\nname = "helios"\nversion = "1.2.3"\n`;
    expect(updateCargoLockVersion(input, "2.0.0")).toBe(
      `[[package]]\nname = "other"\nversion = "1.2.3"\n\n[[package]]\nname = "helios"\nversion = "2.0.0"\n`,
    );
  });

  it("reads the exact helios Cargo.lock version", () => {
    expect(cargoLockVersion(`[[package]]\nname = "helios"\nversion = "1.2.3"\n`)).toBe("1.2.3");
  });
});
