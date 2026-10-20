import assert from "node:assert/strict";
import test from "node:test";

import type { PortView } from "../src/inspect.js";
import { formatPortReport, formatTable, truncateCommand, useColor } from "../src/report.js";

function view(overrides: Partial<PortView> = {}): PortView {
  return {
    port: 3000,
    pid: 18432,
    addresses: ["127.0.0.1"],
    command: "node.exe",
    commandLine: "node dist/main.js",
    executablePath: null,
    startedAt: "2026-10-20T10:00:00.000Z",
    uptime: "2h ago",
    project: { name: "chat-service", root: "C:\\code\\chat-service" },
    docker: null,
    protected: false,
    kind: "dev",
    verdict: "Looks like a stale node.exe from chat-service (2h ago). Safe to stop.",
    ...overrides,
  };
}

test("says when a port is free", () => {
  assert.equal(formatPortReport(3000, [], false), "port 3000 is free");
});

test("prints a dev server as a card", () => {
  const text = formatPortReport(3000, [view()], false);
  assert.match(text, /^port 3000/);
  assert.match(text, /project {3}chat-service/);
  assert.match(text, /started {3}2h ago/);
  assert.match(text, /Safe to stop\.$/);
});

test("prints a docker publish without the proxy command", () => {
  const text = formatPortReport(
    6380,
    [
      view({
        port: 6380,
        pid: 9012,
        addresses: ["0.0.0.0", "::"],
        command: "com.docker.backend.exe",
        commandLine: null,
        project: null,
        uptime: null,
        docker: { name: "patent-dev-redis-1", image: "redis:7-alpine", project: "patent-dev", service: "redis" },
        kind: "docker",
        verdict: "Docker container patent-dev-redis-1 (redis:7-alpine), compose patent-dev/redis. Stop it with docker stop patent-dev-redis-1.",
      }),
    ],
    false,
  );
  assert.match(text, /container patent-dev-redis-1/);
  assert.match(text, /compose {3}patent-dev\/redis/);
  assert.doesNotMatch(text, /com\.docker\.backend/);
});

test("renders the --all table without color", () => {
  const text = formatTable(
    [
      view(),
      view({
        port: 6380,
        pid: 9012,
        command: "com.docker.backend.exe",
        commandLine: null,
        project: null,
        uptime: "unknown",
        docker: { name: "patent-dev-redis-1", image: "redis:7-alpine", project: "patent-dev", service: "redis" },
        kind: "docker",
        verdict: "docker",
      }),
      view({
        port: 445,
        pid: 4,
        addresses: ["0.0.0.0"],
        command: "System",
        commandLine: null,
        project: null,
        uptime: "2w ago",
        protected: true,
        kind: "system",
        verdict: "protected",
      }),
      view({
        port: 50789,
        pid: 11200,
        command: "SpotifyLauncher.exe",
        commandLine: null,
        project: null,
        kind: "other",
        verdict: "other",
      }),
    ],
    { color: false, numbers: false },
  );

  assert.equal(
    text,
    [
      " PORT      PID  PROCESS                 PROJECT               UPTIME    KIND",
      " 3000    18432  node.exe                chat-service          2h ago    DEV",
      " 6380     9012  patent-dev-redis-1      patent-dev/redis      unknown   DOCKER",
      "  445        4  System                  unknown               2w ago    SYSTEM",
      "50789    11200  SpotifyLauncher.exe     unknown               2h ago    OTHER",
    ].join("\n"),
  );
});

test("colors a dev process green and dims the pid", () => {
  const text = formatTable([view()], { color: true, numbers: false });
  assert.match(text, /\x1b\[32m/);
  assert.match(text, /\x1b\[2m/);
  const other = formatTable([view({ command: "AsusSoftwareManager.exe", project: null, kind: "other" })], {
    color: true,
    numbers: false,
  });
  assert.doesNotMatch(other, /\x1b\[3[123]m/);
  assert.match(other, /OTHER$/);
  assert.equal(useColor({ NO_COLOR: "1" }, true), false);
  assert.equal(useColor({}, false), false);
  assert.equal(useColor({}, true), true);
});

test("truncates a long command", () => {
  assert.equal(truncateCommand("x".repeat(200), 16), `${"x".repeat(13)}...`);
  assert.equal(truncateCommand("short"), "short");
});
