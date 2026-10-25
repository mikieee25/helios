import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function bump(version, kind) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Invalid version: ${version}`);
  }
  if (!["patch", "minor", "major"].includes(kind)) {
    throw new Error(`Invalid bump kind: ${kind}`);
  }

  const parts = version.split(".").map(Number);
  const index = { major: 0, minor: 1, patch: 2 }[kind];
  if (parts[index] === Number.MAX_SAFE_INTEGER) {
    throw new Error(`Version component is too large: ${version}`);
  }
  parts[index] += 1;
  for (let i = index + 1; i < parts.length; i += 1) parts[i] = 0;
  return parts.join(".");
}

export function validateVersions({
  packageVersion,
  lockRootVersion,
  lockPackageVersion,
  tauriVersion,
  cargoVersion,
}) {
  const values = {
    "package.json": packageVersion,
    "package-lock.json root": lockRootVersion,
    'package-lock.json packages[""]': lockPackageVersion,
    "tauri.conf.json": tauriVersion,
    "Cargo.toml [package]": cargoVersion,
  };
  const unique = new Set(Object.values(values));
  if (unique.size !== 1 || Object.values(values).some((version) => !version)) {
    throw new Error(
      `Project versions disagree: ${Object.entries(values)
        .map(([file, version]) => `${file}=${version ?? "missing"}`)
        .join(", ")}`,
    );
  }
  return packageVersion;
}

export function updateCargoTomlVersion(text, version) {
  const sections = [...text.matchAll(/^\[([^\]]+)\]\s*$/gm)];
  const packageSection = sections.find((section) => section[1] === "package");
  if (!packageSection) throw new Error('Cargo.toml is missing [package].');
  const start = packageSection.index + packageSection[0].length;
  const end = sections.find((section) => section.index > packageSection.index)?.index ?? text.length;
  const body = text.slice(start, end);
  const matches = [...body.matchAll(/^version\s*=\s*"[^"]+"\s*$/gm)];
  if (matches.length !== 1) throw new Error('Cargo.toml [package] must have one version.');
  const match = matches[0];
  const updated = `${body.slice(0, match.index)}${match[0].replace(/"[^"]+"/, `"${version}"`)}${body.slice(match.index + match[0].length)}`;
  return `${text.slice(0, start)}${updated}${text.slice(end)}`;
}

export function updateCargoLockVersion(text, version) {
  const packages = [...text.matchAll(/^\[\[package\]\]\s*$/gm)];
  const matches = [];
  for (let i = 0; i < packages.length; i += 1) {
    const start = packages[i].index + packages[i][0].length;
    const end = packages[i + 1]?.index ?? text.length;
    const block = text.slice(start, end);
    if (/^name\s*=\s*"helios"\s*$/m.test(block)) {
      const versionMatch = /^version\s*=\s*"[^"]+"\s*$/m.exec(block);
      if (!versionMatch) throw new Error('Cargo.lock helios entry is missing its version.');
      matches.push({ start, block, versionMatch });
    }
  }
  if (matches.length !== 1) throw new Error(`Expected one helios package in Cargo.lock; found ${matches.length}.`);
  const [{ start, block, versionMatch }] = matches;
  const updated = `${block.slice(0, versionMatch.index)}${versionMatch[0].replace(/"[^"]+"/, `"${version}"`)}${block.slice(versionMatch.index + versionMatch[0].length)}`;
  return `${text.slice(0, start)}${updated}${text.slice(start + block.length)}`;
}

export function cargoLockVersion(text) {
  const matches = [];
  const packages = [...text.matchAll(/^\[\[package\]\]\s*$/gm)];
  for (let i = 0; i < packages.length; i += 1) {
    const start = packages[i].index + packages[i][0].length;
    const end = packages[i + 1]?.index ?? text.length;
    const block = text.slice(start, end);
    if (/^name\s*=\s*"helios"\s*$/m.test(block)) {
      const match = /^version\s*=\s*"([^"]+)"\s*$/m.exec(block);
      if (!match) throw new Error("Cargo.lock helios entry is missing its version.");
      matches.push(match[1]);
    }
  }
  if (matches.length !== 1) throw new Error(`Expected one helios package in Cargo.lock; found ${matches.length}.`);
  return matches[0];
}

function cargoTomlVersion(text) {
  const packageSection = /^\[package\]\s*$([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(text);
  const match = packageSection?.[1].match(/^version\s*=\s*"([^"]+)"\s*$/m);
  if (!match) throw new Error('Cargo.toml [package] version is missing.');
  return match[1];
}

export function bumpProjectFiles(files, kind) {
  const pkg = JSON.parse(files.packageJson);
  const lock = JSON.parse(files.packageLock);
  const tauri = JSON.parse(files.tauriConfig);
  const current = validateVersions({
    packageVersion: pkg.version,
    lockRootVersion: lock.version,
    lockPackageVersion: lock.packages?.[""]?.version,
    tauriVersion: tauri.version,
    cargoVersion: cargoTomlVersion(files.cargoToml),
    cargoLockVersion: cargoLockVersion(files.cargoLock),
  });
  const next = bump(current, kind);
  pkg.version = next;
  lock.version = next;
  if (!lock.packages?.[""]) throw new Error('package-lock.json is missing packages[""].');
  lock.packages[""].version = next;
  tauri.version = next;
  return {
    version: next,
    packageJson: `${JSON.stringify(pkg, null, 2)}\n`,
    packageLock: `${JSON.stringify(lock, null, 2)}\n`,
    tauriConfig: `${JSON.stringify(tauri, null, 2)}\n`,
    cargoToml: updateCargoTomlVersion(files.cargoToml, next),
    cargoLock: updateCargoLockVersion(files.cargoLock, next),
  };
}

function runCli(args) {
  const [kind, flag, ...extra] = args;
  if (!kind || flag !== "--write" || extra.length) {
    throw new Error("Usage: node scripts/bump-version.mjs <patch|minor|major> --write");
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const files = {
    packageJson: readFileSync(path.join(root, "package.json"), "utf8"),
    packageLock: readFileSync(path.join(root, "package-lock.json"), "utf8"),
    tauriConfig: readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"),
    cargoToml: readFileSync(path.join(root, "src-tauri/Cargo.toml"), "utf8"),
    cargoLock: readFileSync(path.join(root, "src-tauri/Cargo.lock"), "utf8"),
  };
  const updated = bumpProjectFiles(files, kind);
  writeFileSync(path.join(root, "package.json"), updated.packageJson);
  writeFileSync(path.join(root, "package-lock.json"), updated.packageLock);
  writeFileSync(path.join(root, "src-tauri/tauri.conf.json"), updated.tauriConfig);
  writeFileSync(path.join(root, "src-tauri/Cargo.toml"), updated.cargoToml);
  writeFileSync(path.join(root, "src-tauri/Cargo.lock"), updated.cargoLock);
  console.log(updated.version);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
