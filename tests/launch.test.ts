import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { main } from "../src/cli.js";
import type { ContainerInfo } from "../src/docker.js";
import type { ProcessDetails } from "../src/resolve.js";
import {
  appWindowArgs,
  browserCandidates,
  chooseLauncher,
  openDashboard,
  type LaunchDeps,
  type Spawner,
} from "../src/ui/launch.js";

const winEnv = {
  ProgramFiles: "C:\\Program Files",
  "ProgramFiles(x86)": "C:\\Program Files (x86)",
  LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local",
};

const EDGE = "Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "Google\\Chrome\\Application\\chrome.exe";

test("Windows tries Edge, then Chrome, under Program Files, Program Files (x86), then LocalAppData", () => {
  assert.deepEqual(browserCandidates("win32", winEnv), [
    `C:\\Program Files\\${EDGE}`,
    `C:\\Program Files (x86)\\${EDGE}`,
    `C:\\Users\\dev\\AppData\\Local\\${EDGE}`,
    `C:\\Program Files\\${CHROME}`,
    `C:\\Program Files (x86)\\${CHROME}`,
    `C:\\Users\\dev\\AppData\\Local\\${CHROME}`,
  ]);

  const installed = new Set([`C:\\Users\\dev\\AppData\\Local\\${EDGE}`, `C:\\Program Files\\${CHROME}`]);
  assert.equal(chooseLauncher("win32", winEnv, (path) => installed.has(path)), `C:\\Users\\dev\\AppData\\Local\\${EDGE}`);
  assert.equal(
    chooseLauncher("win32", winEnv, (path) => path === `C:\\Program Files (x86)\\${CHROME}`),
    `C:\\Program Files (x86)\\${CHROME}`,
  );
  assert.equal(chooseLauncher("win32", winEnv, () => false), null);
});

test("Windows falls back to the default Program Files paths when the variables are missing", () => {
  assert.equal(browserCandidates("win32", {})[0], `C:\\Program Files\\${EDGE}`);
  assert.equal(browserCandidates("win32", {}).length, 4);
});

test("macOS and Linux try google-chrome, chromium, then microsoft-edge on PATH", () => {
  const env = { PATH: "/usr/local/bin:relative/bin:/usr/bin" };
  assert.deepEqual(browserCandidates("linux", env), [
    "/usr/local/bin/google-chrome",
    "/usr/bin/google-chrome",
    "/usr/local/bin/chromium",
    "/usr/bin/chromium",
    "/usr/local/bin/microsoft-edge",
    "/usr/bin/microsoft-edge",
  ]);
  const installed = new Set(["/usr/bin/chromium", "/usr/local/bin/microsoft-edge"]);
  assert.equal(chooseLauncher("linux", env, (path) => installed.has(path)), "/usr/bin/chromium");
  assert.equal(chooseLauncher("darwin", env, (path) => path === "/usr/bin/google-chrome"), "/usr/bin/google-chrome");
  assert.equal(chooseLauncher("linux", {}, () => true), null);
});

test("the app window gets a fixed argv", () => {
  assert.deepEqual(appWindowArgs(4747), ["--app=http://127.0.0.1:4747", "--window-size=1000,640"]);
});

function launchDeps(spawn: Spawner, exists: (path: string) => boolean = () => true): LaunchDeps {
  return { platform: "win32", env: winEnv, exists, spawn };
}

test("openDashboard spawns the chosen browser with the app args and never throws", async () => {
  const calls: { file: string; args: readonly string[] }[] = [];
  const opened = await openDashboard(
    4800,
    launchDeps(async (file, args) => {
      calls.push({ file, args });
      return true;
    }),
  );
  assert.deepEqual(opened, { status: "opened", browser: `C:\\Program Files\\${EDGE}` });
  assert.deepEqual(calls, [{ file: `C:\\Program Files\\${EDGE}`, args: ["--app=http://127.0.0.1:4800", "--window-size=1000,640"] }]);

  assert.equal((await openDashboard(4800, launchDeps(async () => false))).status, "failed");
  assert.equal(
    (
      await openDashboard(
        4800,
        launchDeps(async () => {
          throw new Error("EACCES");
        }),
      )
    ).status,
    "failed",
  );

  let spawned = false;
  const none = await openDashboard(
    4800,
    launchDeps(
      async () => {
        spawned = true;
        return true;
      },
      () => false,
    ),
  );
  assert.deepEqual(none, { status: "not-found" });
  assert.equal(spawned, false);

  const broken = await openDashboard(
    4800,
    launchDeps(
      async () => true,
      () => {
        throw new Error("EPERM");
      },
    ),
  );
  assert.deepEqual(broken, { status: "not-found" });
});

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function runUi(args: string[], spawn: Spawner, exists: (path: string) => boolean = () => true) {
  const root = await mkdtemp(join(tmpdir(), "whoport-launch-"));
  await writeFile(join(root, "index.html"), "<!doctype html><div id=\"root\"></div>");
  const port = await freePort();
  const controller = new AbortController();
  const logs: string[] = [];
  const errors: string[] = [];
  try {
    const code = await main(
      ["ui", "--port", String(port), ...args],
      {
        log: (message) => {
          logs.push(message);
          // Stop as soon as the server says it is up, the way Ctrl+C would.
          if (message.includes("running at")) controller.abort();
        },
        error: (message) => errors.push(message),
      },
      {
        isTTY: false,
        staticRoot: root,
        uiSignal: controller.signal,
        launch: { platform: "win32", env: winEnv, exists, spawn },
        listListeners: async () => ({ listeners: [], warnings: [] }),
        readProcesses: async () => new Map<number, ProcessDetails>(),
        containers: async () => new Map<number, ContainerInfo>(),
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    return { code, port, logs, errors };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("whoport ui opens one app window after the server is listening", async () => {
  const calls: { file: string; args: readonly string[] }[] = [];
  const result = await runUi([], async (file, args) => {
    calls.push({ file, args });
    return true;
  });
  assert.equal(result.code, 0);
  assert.deepEqual(result.logs, [`whoport ui running at http://127.0.0.1:${result.port} (Ctrl+C to stop)`]);
  assert.deepEqual(calls, [
    { file: `C:\\Program Files\\${EDGE}`, args: [`--app=http://127.0.0.1:${result.port}`, "--window-size=1000,640"] },
  ]);
  assert.deepEqual(result.errors, []);
});

test("whoport ui --no-open serves without launching anything", async () => {
  let spawned = false;
  const result = await runUi(["--no-open"], async () => {
    spawned = true;
    return true;
  });
  assert.equal(result.code, 0);
  assert.equal(spawned, false);
  assert.deepEqual(result.logs, [`whoport ui running at http://127.0.0.1:${result.port} (Ctrl+C to stop)`]);
});

test("no browser or a failed launch prints the URL and the server still exits cleanly", async () => {
  const missing = await runUi([], async () => true, () => false);
  assert.equal(missing.code, 0);
  assert.equal(missing.logs[1], `No Edge or Chrome found. Open http://127.0.0.1:${missing.port} in a browser.`);

  const failed = await runUi([], async () => false);
  assert.equal(failed.code, 0);
  assert.equal(failed.logs[1], `Could not open a browser window. Open http://127.0.0.1:${failed.port} in a browser.`);
});

test("--no-open is only for ui, and the usage lists it", async () => {
  const errors: string[] = [];
  const code = await main(["--no-open"], { log: () => {}, error: (message) => errors.push(message) }, { isTTY: false });
  assert.equal(code, 1);
  assert.match(errors.join("\n"), /--no-open are only for ui/);
  assert.match(errors.join("\n"), /whoport ui \[--port N\] \[--no-open\]/);
});
