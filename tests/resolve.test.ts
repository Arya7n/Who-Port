import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { posix, win32 } from "node:path";
import test from "node:test";

import {
  cacheProcessReads,
  detailsFromTasklist,
  etimeToSeconds,
  extractPaths,
  findProjectRoot,
  formatPidList,
  formatUptime,
  parseCimOutput,
  parsePsEtime,
  parsePsEtimes,
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
    "c:\\Users\\Aryan\\AppData\\Local\\Programs\\cursor\\resources\\app\\extensions",
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

test("resolves a tsx command line to the app outside node_modules", () => {
  const command =
    '"C:\\Program Files\\nodejs\\node.exe" --require C:\\Users\\Aryan\\code\\Who-Port\\node_modules\\tsx\\dist\\preflight.cjs --import file:///C:/Users/Aryan/code/Who-Port/node_modules/tsx/dist/loader.mjs src/ui/server.ts';
  const fs = memoryFs(win32, {
    "C:\\Program Files\\nodejs": "dir",
    "C:\\Program Files\\nodejs\\package.json": '{"name":"node"}',
    "C:\\Users\\Aryan\\code\\Who-Port": "dir",
    "C:\\Users\\Aryan\\code\\Who-Port\\package.json": '{"name":"whoport"}',
    "C:\\Users\\Aryan\\code\\Who-Port\\node_modules": "dir",
    "C:\\Users\\Aryan\\code\\Who-Port\\node_modules\\tsx": "dir",
    "C:\\Users\\Aryan\\code\\Who-Port\\node_modules\\tsx\\package.json": '{"name":"tsx"}',
  });
  const paths = extractPaths(command);
  assert.equal(paths.some((candidate) => candidate.toLowerCase().includes("node_modules")), false);
  assert.deepEqual(
    resolveProject(
      {
        cwd: null,
        commandLine: command,
        executablePath: "C:\\Program Files\\nodejs\\node.exe",
      },
      fs,
    ),
    { name: "whoport", root: "C:\\Users\\Aryan\\code\\Who-Port" },
  );
});

test("returns null when the only absolute path is inside node_modules", () => {
  const fs = memoryFs(win32, {
    "C:\\lonely\\node_modules\\left-pad": "dir",
    "C:\\lonely\\node_modules\\left-pad\\package.json": '{"name":"left-pad"}',
  });
  assert.equal(
    resolveProject(
      {
        cwd: null,
        commandLine: "node C:\\lonely\\node_modules\\left-pad\\index.js",
        executablePath: null,
      },
      fs,
    ),
    null,
  );
});

test("returns null when the command line has no absolute paths", () => {
  const fs = memoryFs(win32, {
    "C:\\Users\\Aryan\\code\\Who-Port": "dir",
    "C:\\Users\\Aryan\\code\\Who-Port\\package.json": '{"name":"whoport"}',
  });
  assert.equal(
    resolveProject({ cwd: null, commandLine: "node src/ui/server.ts", executablePath: null }, fs),
    null,
  );
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
      name: null,
      commandLine: null,
      executablePath: null,
      startTime: new Date(1792484934428),
    },
  ]);
});

test("reads the image name from the same CIM row", () => {
  const [record] = parseCimOutput(
    '{"ProcessId":4,"Name":"System","CommandLine":null,"ExecutablePath":null,"CreationDate":"/Date(1792484934428)/"}',
  );
  assert.equal(record?.pid, 4);
  assert.equal(record?.name, "System");
});

test("tasklist fallback gives names for the asked PIDs only", () => {
  const output = '"svchost.exe","1524","Services","0","12,000 K"\r\n"node.exe","18432","Console","1","48,000 K"\r\n';
  const details = detailsFromTasklist(output, [18432, 999]);
  assert.deepEqual([...details.keys()], [18432]);
  assert.equal(details.get(18432)?.name, "node.exe");
  assert.equal(details.get(18432)?.commandLine, null);
});

test("caches named details per pid and asks again after the ttl", async () => {
  let clock = 0;
  const asked: number[][] = [];
  const read = cacheProcessReads(
    async (pids) => {
      asked.push([...pids]);
      clock += 3_000;
      return new Map(
        pids.map((pid) => [
          pid,
          {
            name: pid === 7 ? null : "node.exe",
            commandLine: null,
            executablePath: null,
            startTime: pid === 7 ? null : new Date(0),
            cwd: null,
          },
        ]),
      );
    },
    5_000,
    () => clock,
  );

  // A 3 s lookup answers at 3 s. Pid 1 stays cached until 8 s; pid 7 had no name and is asked again.
  await read([1, 7]);
  clock = 5_000;
  const second = await read([1, 7, 9]);
  assert.equal(second.get(1)?.name, "node.exe");
  clock = 8_000;
  await read([1]);
  assert.deepEqual(asked, [[1, 7], [7, 9], [1]]);
});

test("a tasklist-only answer is not cached and does not replace the last full answer", async () => {
  let clock = 0;
  let degraded = false;
  const asked: number[][] = [];
  const read = cacheProcessReads(
    async (pids) => {
      asked.push([...pids]);
      return new Map(
        pids.map((pid) => [
          pid,
          degraded
            ? { name: "node.exe", commandLine: null, executablePath: null, startTime: null, cwd: null }
            : {
                name: "node.exe",
                commandLine: "node C:\\app\\server.js",
                executablePath: "C:\\node.exe",
                startTime: new Date(0),
                cwd: null,
              },
        ]),
      );
    },
    5_000,
    () => clock,
  );

  await read([1]);
  degraded = true;
  clock = 6_000;
  const slow = await read([1]);
  assert.equal(slow.get(1)?.commandLine, "node C:\\app\\server.js");
  assert.equal(slow.get(1)?.startTime?.getTime(), 0);

  // The degraded answer was not cached, so the next poll asks again.
  clock = 7_000;
  await read([1]);
  assert.deepEqual(asked, [[1], [1], [1]]);
});

test("a kept answer is dropped once the pid stops listening or changes name", async () => {
  let clock = 0;
  let name = "node.exe";
  let degraded = false;
  const read = cacheProcessReads(
    async (pids) =>
      new Map(
        pids.map((pid) => [
          pid,
          { name, commandLine: null, executablePath: null, startTime: degraded ? null : new Date(0), cwd: null },
        ]),
      ),
    5_000,
    () => clock,
  );

  await read([1]);
  degraded = true;
  name = "python.exe";
  clock = 6_000;
  assert.equal((await read([1])).get(1)?.startTime, null);

  name = "node.exe";
  degraded = false;
  await read([2]);
  degraded = true;
  await read([3]);
  clock = 12_000;
  assert.equal((await read([2])).get(2)?.startTime, null);
});

test("overlapping reads share one lookup", async () => {
  let calls = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = cacheProcessReads(async (pids) => {
    calls += 1;
    await gate;
    return new Map(
      pids.map((pid) => [
        pid,
        { name: "node.exe", commandLine: null, executablePath: null, startTime: new Date(0), cwd: null },
      ]),
    );
  }, 5_000);

  const first = read([1, 2]);
  const second = read([1, 2]);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(a.get(2)?.name, "node.exe");
  assert.equal(b.get(1)?.name, "node.exe");
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

test("parses linux etimes and macOS etime", () => {
  assert.deepEqual(parsePsEtimes("   120 node /home/a/app/dist/main.js"), {
    elapsedSeconds: 120,
    args: "node /home/a/app/dist/main.js",
  });
  assert.equal(etimeToSeconds("05:09"), 309);
  assert.equal(etimeToSeconds("01:05:09"), 3909);
  assert.equal(etimeToSeconds("2-01:05:09"), 2 * 86400 + 3909);
  assert.equal(parsePsEtime("01:00:00 node server.js")?.elapsedSeconds, 3600);
});
