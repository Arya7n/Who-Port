import assert from "node:assert/strict";
import test from "node:test";

import { buildViews, describeVerdict, projectLabel, sharedTarget } from "../src/inspect.js";
import type { Listener } from "../src/platform/types.js";
import type { ProjectFs } from "../src/resolve.js";

const now = new Date("2026-10-20T12:00:00.000Z");

function listener(overrides: Partial<Listener> = {}): Listener {
  return {
    port: 3000,
    pid: 18432,
    command: "node.exe",
    address: "127.0.0.1",
    protocol: "tcp",
    ...overrides,
  };
}

function emptyFs(): ProjectFs {
  return {
    isDirectory: () => false,
    exists: () => false,
    readFile: () => null,
  };
}

test("a published container replaces the proxy as the owner", () => {
  const views = buildViews(
    [
      listener({ port: 6380, pid: 9012, command: "com.docker.backend.exe", address: "0.0.0.0" }),
      listener({ port: 6380, pid: 9012, command: "com.docker.backend.exe", address: "::" }),
    ],
    new Map(),
    new Map([
      [
        6380,
        { name: "patent-dev-redis-1", image: "redis:7-alpine", project: "patent-dev", service: "redis" },
      ],
    ]),
    emptyFs(),
    now,
  );

  assert.equal(views.length, 1);
  assert.equal(projectLabel(views[0]!), "patent-dev/redis");
  assert.equal(
    views[0]!.verdict,
    "Docker container patent-dev-redis-1 (redis:7-alpine), compose patent-dev/redis. Stop it with docker stop patent-dev-redis-1.",
  );
  assert.deepEqual(sharedTarget(views), { kind: "docker", name: "patent-dev-redis-1" });
});

test("a process under SystemRoot is protected and node.exe is not", () => {
  const views = buildViews(
    [listener({ pid: 50, command: "custom.exe", port: 1 }), listener({ pid: 60, command: "node.exe", port: 2 })],
    new Map([
      [50, { commandLine: null, executablePath: "C:\\Windows\\System32\\custom.exe", startTime: null, cwd: null }],
      [60, { commandLine: null, executablePath: "C:\\Program Files\\nodejs\\node.exe", startTime: null, cwd: null }],
    ]),
    new Map(),
    emptyFs(),
    now,
    "C:\\Windows",
  );
  assert.equal(views.find((view) => view.pid === 50)?.protected, true);
  assert.equal(views.find((view) => view.pid === 60)?.protected, false);
});

test("two owners of one port are not stopped together", () => {
  const views = buildViews(
    [listener({ pid: 1, address: "127.0.0.1" }), listener({ pid: 2, address: "0.0.0.0" })],
    new Map(),
    new Map(),
    emptyFs(),
    now,
  );
  assert.equal(sharedTarget(views).kind, "mixed");
});

test("calls a long-running dev server stale", () => {
  const started = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const views = buildViews(
    [listener()],
    new Map([
      [
        18432,
        {
          commandLine: "node C:\\code\\chat-service\\dist\\main.js",
          executablePath: "C:\\Program Files\\nodejs\\node.exe",
          startTime: started,
          cwd: null,
        },
      ],
    ]),
    new Map(),
    {
      isDirectory: (path) => path === "C:\\code\\chat-service" || path === "C:\\code",
      exists: (path) => path === "C:\\code\\chat-service\\package.json",
      readFile: (path) => (path === "C:\\code\\chat-service\\package.json" ? '{"name":"chat-service"}' : null),
    },
    now,
  );
  assert.equal(views[0]?.project?.name, "chat-service");
  assert.match(describeVerdict(views[0]!, now), /stale node.exe from chat-service \(2h ago\)/);
});
