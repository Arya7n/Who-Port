import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { posix, win32 } from "node:path";
import test from "node:test";

import {
  extractPaths,
  findProjectRoot,
  formatPidList,
  formatUptime,
  parseCimOutput,
  resolveProject,
  type ProjectFs,
} from "../src/resolve.js";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

function memoryFs(api: typeof win32, entries: Record<string, string | "dir">): ProjectFs {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  for (const [key, value] of Object.entries(entries)) {
    const normalized = api.normalize(key);
    if (value === "dir") dirs.add(normalized);
    else files.set(normalized, value);
  }
  return {
    isDirectory(path: string): boolean {
      return dirs.has(api.normalize(path));
    },
    exists(path: string): boolean {
      const normalized = api.normalize(path);
      return files.has(normalized) || dirs.has(normalized);
    },
    readFile(path: string): string | null {
      return files.get(api.normalize(path)) ?? null;
    },
  };
}

test("extracts absolute paths and skips relative tokens and switches", () => {
  const paths = extractPaths(
    '"C:\\Program Files\\nodejs\\node.exe" src/main.js .\\rel.js ../up.js /F --watch /usr/bin/node /home/a/app/dist/main.js \\\\server\\share\\app\\server.js',
  );
  assert.deepEqual(paths, [
    "C:\\Program Files\\nodejs\\node.exe",
    "/usr/bin/node",
    "/home/a/app/dist/main.js",
    "\\\\server\\share\\app\\server.js",
  ]);
});

test("extracts the paths from a captured tsserver command line", () => {
  const [record] = parseCimOutput(fixture("win32-cim-node.json"));
  assert.ok(record);
  assert.deepEqual(extractPaths(record.commandLine ?? ""), [
    "c:\\Users\\Aryan\\AppData\\Local\\Programs\\cursor\\resources\\app\\resources\\helpers\\node.exe",
    "c:\\Users\\Aryan\\AppData\\Local\\Programs\\cursor\\resources\\app\\extensions\\node_modules\\typescript\\lib\\tsserver.js",
    "C:\\Users\\Aryan\\AppData\\Local\\Temp\\vscode-typescript\\10e9b891934e200b813e\\tscancellation-0d44f63c32d52a0d7cab.tmp",
  ]);
});

test("returns no paths for an empty command line", () => {
  assert.deepEqual(extractPaths(""), []);
});

test("uses the package.json name at the nearest project root", () => {
  const fs = memoryFs(win32, {
    "C:\\proj": "dir",
    "C:\\proj\\src": "dir",
    "C:\\proj\\package.json": '{"name":"chat-service"}',
    "C:\\proj\\.git": "dir",
  });
  assert.deepEqual(findProjectRoot("C:\\proj\\src\\main.js", fs), {
    name: "chat-service",
    root: "C:\\proj",
  });
});

test("uses the folder name when the marker is .git", () => {
  const fs = memoryFs(win32, {
    "C:\\bare": "dir",
    "C:\\bare\\.git": "dir",
  });
  assert.deepEqual(findProjectRoot("C:\\bare\\index.js", fs), {
    name: "bare",
    root: "C:\\bare",
  });
});

test("returns null when no package.json or .git exists", () => {
  const fs = memoryFs(win32, {});
  assert.equal(findProjectRoot("C:\\tmp\\notes.js", fs), null);
});

test("a nearer package.json wins over a higher .git directory", () => {
  const fs = memoryFs(posix, {
    "/repo": "dir",
    "/repo/.git": "dir",
    "/repo/packages": "dir",
    "/repo/packages/web": "dir",
    "/repo/packages/web/package.json": '{"name":"web"}',
  });
  assert.deepEqual(findProjectRoot("/repo/packages/web/src/main.js", fs), {
    name: "web",
    root: "/repo/packages/web",
  });
});

test("ignores a package.json with no name and keeps walking", () => {
  const fs = memoryFs(posix, {
    "/repo": "dir",
    "/repo/.git": "dir",
    "/repo/app": "dir",
    "/repo/app/package.json": "{}",
  });
  assert.deepEqual(findProjectRoot("/repo/app/main.js", fs), {
    name: "repo",
    root: "/repo",
  });
});

test("prefers the working directory over a deeper dependency package", () => {
  const fs = memoryFs(posix, {
    "/app": "dir",
    "/app/package.json": '{"name":"chat-service"}',
    "/app/node_modules": "dir",
    "/app/node_modules/ts-node": "dir",
    "/app/node_modules/ts-node/package.json": '{"name":"ts-node"}',
  });
  const project = resolveProject(
    {
      cwd: "/app",
      commandLine: "node /app/node_modules/ts-node/dist/bin.js",
      executablePath: null,
    },
    fs,
  );
  assert.deepEqual(project, { name: "chat-service", root: "/app" });
});

test("picks the deepest command-line project when there is no working directory", () => {
  const fs = memoryFs(win32, {
    "C:\\Program Files\\nodejs": "dir",
    "C:\\Program Files\\nodejs\\package.json": '{"name":"node"}',
    "C:\\code\\chat-service": "dir",
    "C:\\code\\chat-service\\package.json": '{"name":"chat-service"}',
  });
  const project = resolveProject(
    {
      cwd: null,
      commandLine: '"C:\\Program Files\\nodejs\\node.exe" C:\\code\\chat-service\\dist\\main.js',
      executablePath: "C:\\Program Files\\nodejs\\node.exe",
    },
    fs,
  );
  assert.deepEqual(project, { name: "chat-service", root: "C:\\code\\chat-service" });
});

test("formats uptime in short units", () => {
  const now = new Date("2026-10-20T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  assert.equal(formatUptime(ago(1000), now), "just now");
  assert.equal(formatUptime(ago(4999), now), "just now");
  assert.equal(formatUptime(ago(5000), now), "5s ago");
  assert.equal(formatUptime(ago(90_000), now), "1m ago");
  assert.equal(formatUptime(ago(2 * 60 * 60 * 1000), now), "2h ago");
  assert.equal(formatUptime(ago(3 * 24 * 60 * 60 * 1000), now), "3d ago");
  assert.equal(formatUptime(ago(21 * 24 * 60 * 60 * 1000), now), "3w ago");
  assert.equal(formatUptime(new Date(now.getTime() + 10_000), now), "just now");
});

test("parses captured CIM JSON, including a system process with null paths", () => {
  const node = parseCimOutput(fixture("win32-cim-node.json"));
  assert.equal(node.length, 1);
  assert.equal(node[0]?.executablePath?.endsWith("node.exe"), true);
  assert.equal(node[0]?.startTime?.getTime(), 1792485803326);

  const system = parseCimOutput(fixture("win32-cim-system.json"));
  assert.deepEqual(system, [
    {
      pid: null,
      commandLine: null,
      executablePath: null,
      startTime: new Date(1792484934428),
    },
  ]);
});

test("parses a CIM array and ignores malformed output", () => {
  const records = parseCimOutput(
    '[{"ProcessId":7,"CommandLine":"node server.js","ExecutablePath":"C:\\\\node.exe","CreationDate":"/Date(10)/"}]',
  );
  assert.equal(records[0]?.pid, 7);
  assert.equal(records[0]?.startTime?.getTime(), 10);
  assert.deepEqual(parseCimOutput(""), []);
  assert.deepEqual(parseCimOutput("not json"), []);
});

test("joins only integer PIDs", () => {
  assert.equal(formatPidList([4, 4, 18]), "4,18");
  assert.throws(() => formatPidList([1.5]), /invalid PID/);
});
