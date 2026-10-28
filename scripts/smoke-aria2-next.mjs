import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binary = path.resolve(
  process.argv[2] ??
    path.join(
      root,
      "src-tauri",
      "binaries",
      "aria2c-x86_64-pc-windows-msvc.exe"
    )
);
const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), "helios-aria2-next-smoke-")
);
assert.ok(
  temporaryRoot.startsWith(path.resolve(os.tmpdir()) + path.sep),
  "smoke test must use its own temporary directory"
);

const secret = "helios-local-smoke-only";
const payload = Buffer.alloc(2 * 1024 * 1024, 65);
const downloadDir = path.join(temporaryRoot, "downloads");
const stateDir = path.join(temporaryRoot, "state");
const sessionPath = path.join(temporaryRoot, "aria2.session");
await Promise.all([mkdir(downloadDir), mkdir(stateDir), writeFile(sessionPath, "")]);
const legacyPayload = path.join(downloadDir, "legacy-partial.bin");
const legacyControl = `${legacyPayload}.aria2`;
await Promise.all([
  writeFile(legacyPayload, "legacy partial payload"),
  writeFile(legacyControl, "legacy aria2 control marker"),
]);

const fixtureServer = createServer(async (request, response) => {
  if (request.url !== "/fixture.bin") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "accept-ranges": "none",
    "content-length": String(payload.length),
    "content-type": "application/octet-stream",
  });
  for (let offset = 0; offset < payload.length; offset += 32768) {
    response.write(payload.subarray(offset, offset + 32768));
    await delay(30);
  }
  response.end();
});
fixtureServer.listen(0, "127.0.0.1");
await new Promise((resolve, reject) => {
  fixtureServer.once("listening", resolve);
  fixtureServer.once("error", reject);
});
const fixturePort = fixtureServer.address().port;
const fixtureUrl = `http://127.0.0.1:${fixturePort}/fixture.bin`;
await writeFile(
  sessionPath,
  `${fixtureUrl}\n dir=${downloadDir}\n out=fixture.bin\n pause=true\n\n`
);

const rpcPort = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close((error) => (error ? reject(error) : resolve(port)));
  });
});

const engineArgs = [
  "--no-conf",
  "--enable-rpc",
  `--rpc-listen-port=${rpcPort}`,
  `--rpc-secret=${secret}`,
  "--rpc-listen-all=false",
  "--continue=true",
  "--connect-timeout=10",
  "--retry-wait=2",
  "--split=4",
  "--max-connection-per-server=4",
  "--min-split-size=1M",
  `--dir=${downloadDir}`,
  `--input-file=${sessionPath}`,
  `--save-session=${sessionPath}`,
  "--save-session-interval=30",
  `--state-dir=${stateDir}`,
  "--state-save-interval=2",
];
let childError = "";
function startEngine() {
  const process = spawn(binary, engineArgs, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  process.stdout.setEncoding("utf8").on("data", (chunk) => {
    childError = (childError + chunk).slice(-4000);
  });
  process.stderr.setEncoding("utf8").on("data", (chunk) => {
    childError = (childError + chunk).slice(-4000);
  });
  return process;
}
let child = startEngine();

const rpcUrl = `http://127.0.0.1:${rpcPort}/jsonrpc`;
let requestId = 0;
async function httpRpc(method, ...params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++requestId,
      method,
      params: [`token:${secret}`, ...params],
    }),
    signal: AbortSignal.timeout(3000),
  });
  const message = await response.json();
  if (message.error) throw new Error(`${method}: ${message.error.message}`);
  return message.result;
}

async function websocketRpc(method, ...params) {
  const socket = new WebSocket(`ws://127.0.0.1:${rpcPort}/jsonrpc`);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WebSocket open timed out")), 3000);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket connection failed"));
    }, { once: true });
  });
  try {
    const id = ++requestId;
    const reply = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`${method} WebSocket call timed out`)), 3000);
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id !== id) return;
        clearTimeout(timeout);
        if (message.error) reject(new Error(`${method}: ${message.error.message}`));
        else resolve(message.result);
      });
    });
    socket.send(JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: `aria2.${method}`,
      params: [`token:${secret}`, ...params],
    }));
    return await reply;
  } finally {
    socket.close();
  }
}

try {
  let version;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`aria2-next exited before RPC startup: ${childError}`);
    }
    try {
      version = await httpRpc("aria2.getVersion");
      break;
    } catch {
      await delay(100);
    }
  }
  assert.equal(version?.version, "3.0.9");
  assert.ok(
    childError.includes(`RPC: listening on 127.0.0.1 port ${rpcPort}`),
    "aria2-next should emit the RPC readiness line Helios uses"
  );

  const wsVersion = await websocketRpc("getVersion");
  assert.equal(wsVersion.version, version.version);
  const initial = await httpRpc("aria2.getGlobalStat");
  assert.ok(initial.downloadSpeed !== undefined);

  const mappedOptions = {
    "max-overall-download-limit": "1048576",
    "max-overall-upload-limit": "1048576",
    "max-concurrent-downloads": "6",
    "max-connection-per-server": "4",
    split: "4",
    "file-allocation": "none",
    "connect-timeout": "12",
    "user-agent": "Helios smoke",
    "all-proxy": "http://127.0.0.1:9",
    "all-proxy-user": "smoke-user",
    "all-proxy-passwd": "smoke-password",
    "no-proxy": "localhost",
    "seed-ratio": "1",
    "seed-time": "0",
    "auto-file-renaming": "true",
    "allow-overwrite": "false",
    dir: downloadDir,
  };
  await httpRpc("aria2.changeGlobalOption", mappedOptions);
  const globalOptions = await httpRpc("aria2.getGlobalOption");
  assert.equal(globalOptions["connect-timeout"], "12");
  for (const key of Object.keys(mappedOptions)) {
    // aria2 masks proxy credentials from getGlobalOption.
    if (["all-proxy-user", "all-proxy-passwd"].includes(key)) continue;
    assert.ok(Object.hasOwn(globalOptions, key), `aria2-next should expose ${key}`);
  }
  await httpRpc("aria2.changeGlobalOption", {
    "all-proxy": "",
    "all-proxy-user": "",
    "all-proxy-passwd": "",
    "no-proxy": "",
  });
  const multicall = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++requestId,
      method: "system.multicall",
      params: [[
        { methodName: "aria2.tellActive", params: [`token:${secret}`, ["gid", "status"]] },
        { methodName: "aria2.tellWaiting", params: [`token:${secret}`, 0, 10, ["gid", "status"]] },
        { methodName: "aria2.tellStopped", params: [`token:${secret}`, 0, 10, ["gid", "status"]] },
      ]],
    }),
    signal: AbortSignal.timeout(3000),
  }).then((response) => response.json());
  assert.equal(multicall.error, undefined);
  assert.equal(multicall.result.length, 3);

  const unsupportedDns = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++requestId,
      method: "aria2.changeGlobalOption",
      params: [`token:${secret}`, { "async-dns": "false" }],
    }),
    signal: AbortSignal.timeout(3000),
  }).then((response) => response.json());
  assert.equal(unsupportedDns.error, undefined);
  assert.equal(Object.hasOwn(await httpRpc("aria2.getGlobalOption"), "async-dns"), false);

  // This is an aria2-format queue entry in a disposable session fixture.
  // It validates that aria2-next can load the legacy session text format.
  let queued;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const waiting = await httpRpc("aria2.tellWaiting", 0, 10, ["gid", "status"]);
    queued = waiting.find((task) => task.status === "paused");
    if (queued) break;
    await delay(100);
  }
  assert.ok(queued, "aria2-next should load the paused legacy session fixture");
  let gid = queued.gid;
  const paused = await httpRpc("aria2.tellStatus", gid, ["gid", "status", "totalLength"]);
  assert.equal(paused.status, "paused");
  const uris = await httpRpc("aria2.getUris", gid);
  assert.equal(uris[0].uri, fixtureUrl);
  await httpRpc("aria2.unpause", gid);
  await delay(100);
  await httpRpc("aria2.pause", gid);
  assert.equal((await httpRpc("aria2.tellStatus", gid, ["status"])).status, "paused");
  await delay(2200);
  assert.ok((await readdir(stateDir)).length, "aria2-next should checkpoint into state-dir");

  await httpRpc("aria2.shutdown");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5000).then(() => {
      throw new Error("aria2-next did not stop after shutdown RPC");
    }),
  ]);
  childError = "";
  child = startEngine();
  let restartedVersion;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`aria2-next exited during restart: ${childError}`);
    }
    try {
      restartedVersion = await httpRpc("aria2.getVersion");
      break;
    } catch {
      await delay(100);
    }
  }
  assert.equal(restartedVersion?.version, version.version);
  assert.ok(
    childError.includes(`RPC: listening on 127.0.0.1 port ${rpcPort}`),
    "aria2-next should emit the RPC readiness line after restart"
  );
  const restoredTasks = await httpRpc("aria2.tellWaiting", 0, 10, ["gid", "status"]);
  const restored = restoredTasks.find((task) => task.status === "paused");
  assert.ok(restored, "paused session task should survive engine restart");
  gid = restored.gid;
  assert.equal((await httpRpc("aria2.getUris", gid))[0].uri, fixtureUrl);
  await httpRpc("aria2.unpause", gid);

  let completed;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    completed = await httpRpc("aria2.tellStatus", gid, ["gid", "status", "completedLength"]);
    if (completed.status === "complete") break;
    if (completed.status === "error") throw new Error("Fixture download failed in aria2-next.");
    await delay(100);
  }
  assert.equal(completed?.status, "complete");
  await httpRpc("aria2.removeDownloadResult", gid);
  assert.equal(await readFile(legacyPayload, "utf8"), "legacy partial payload");
  assert.equal(await readFile(legacyControl, "utf8"), "legacy aria2 control marker");
  console.log(`aria2-next ${version.version}: HTTP/WebSocket RPC, options, multicall, legacy session loading, state checkpoint, restart recovery and task lifecycle passed`);
} catch (error) {
  throw new Error(`${error instanceof Error ? error.message : String(error)}\n${childError}`);
} finally {
  fixtureServer.close();
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(3000)]);
  }
  if (path.basename(temporaryRoot).startsWith("helios-aria2-next-smoke-")) {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
