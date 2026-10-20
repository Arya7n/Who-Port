import assert from "node:assert/strict";
import test from "node:test";

import { main, parseRowChoice, parseYes, type CliDeps } from "../src/cli.js";
import type { ContainerInfo } from "../src/docker.js";
import type { ControlResult, ProcessRunner } from "../src/kill.js";
import type { Listener } from "../src/platform/types.js";
import type { ProcessDetails } from "../src/resolve.js";

const now = new Date("2026-10-20T12:00:00.000Z");

function capture() {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    io: {
      log: (message: string) => {
        logs.push(message);
      },
      error: (message: string) => {
        errors.push(message);
      },
    },
  };
}

function nodeListener(): Listener {
  return { port: 3000, pid: 18432, command: "node.exe", address: "127.0.0.1", protocol: "tcp" };
}

function deps(overrides: Partial<CliDeps> = {}): Partial<CliDeps> {
  const runner: ProcessRunner = {
    async terminate() {
      return { ok: true };
    },
    async force() {
      return { ok: true };
    },
    async running() {
      return false;
    },
  };
  return {
    isTTY: false,
    color: false,
    now: () => now,
    ask: async () => "q",
    listListeners: async () => ({ listeners: [nodeListener()], warnings: [] }),
    readProcesses: async () => new Map<number, ProcessDetails>(),
    containers: async () => new Map<number, ContainerInfo>(),
    runner,
    dockerStop: async () => ({ ok: true }) satisfies ControlResult,
    projectFs: { isDirectory: () => false, exists: () => false, readFile: () => null },
    ...overrides,
  };
}

test("prints help and does not look up a port", async () => {
  const cap = capture();
  const code = await main(["--help"], cap.io, deps());
  assert.equal(code, 0);
  assert.match(cap.logs.join("\n"), /Usage: whoport \[port\]/);
});

test("rejects an invalid port before spawning a tool", async () => {
  const cap = capture();
  const code = await main(["nope"], cap.io, deps());
  assert.equal(code, 1);
  assert.match(cap.errors.join("\n"), /1 to 65535/);
  assert.equal(cap.logs.length, 0);
});

test("rejects an unknown flag", async () => {
  const cap = capture();
  const code = await main(["--nope"], cap.io, deps());
  assert.equal(code, 1);
  assert.match(cap.errors.join("\n"), /Unknown argument/);
});

test("no args outside a terminal prints the table", async () => {
  const cap = capture();
  const code = await main([], cap.io, deps({ isTTY: false }));
  assert.equal(code, 0);
  assert.match(cap.logs.join("\n"), /node\.exe/);
  assert.match(cap.logs.join("\n"), /PORT/);
});

test("--json stays machine readable", async () => {
  const cap = capture();
  const code = await main(["3000", "--json"], cap.io, deps());
  assert.equal(code, 0);
  const parsed = JSON.parse(cap.logs.join("\n")) as { port: number; listeners: { pid: number }[] };
  assert.equal(parsed.port, 3000);
  assert.equal(parsed.listeners[0]?.pid, 18432);
  assert.doesNotMatch(cap.logs.join("\n"), /\x1b\[/);
});

test("--kill --yes stops a dev process", async () => {
  const calls: string[] = [];
  const cap = capture();
  const code = await main(
    ["3000", "--kill", "--yes"],
    cap.io,
    deps({
      runner: {
        async terminate() {
          calls.push("term");
          return { ok: true };
        },
        async force() {
          calls.push("force");
          return { ok: true };
        },
        async running() {
          return false;
        },
      },
    }),
  );
  assert.equal(code, 0);
  assert.deepEqual(calls, ["term"]);
  assert.match(cap.logs.join("\n"), /Stopped PID 18432/);
});

test("a container is stopped with docker stop, not taskkill", async () => {
  let stopped = "";
  let killed = false;
  const cap = capture();
  const code = await main(
    ["6380", "--kill", "--yes"],
    cap.io,
    deps({
      listListeners: async () => ({
        listeners: [{ port: 6380, pid: 9012, command: "com.docker.backend.exe", address: "0.0.0.0", protocol: "tcp" }],
        warnings: [],
      }),
      containers: async () =>
        new Map([[6380, { name: "patent-dev-redis-1", image: "redis:7-alpine", project: "patent-dev", service: "redis" }]]),
      dockerStop: async (name) => {
        stopped = name;
        return { ok: true };
      },
      runner: {
        async terminate() {
          killed = true;
          return { ok: true };
        },
        async force() {
          killed = true;
          return { ok: true };
        },
        async running() {
          return false;
        },
      },
    }),
  );
  assert.equal(code, 0);
  assert.equal(stopped, "patent-dev-redis-1");
  assert.equal(killed, false);
});

test("refuses a protected process when there is no terminal", async () => {
  const cap = capture();
  const code = await main(
    ["445", "--kill", "--yes"],
    cap.io,
    deps({
      isTTY: false,
      listListeners: async () => ({
        listeners: [{ port: 445, pid: 4, command: "System", address: "0.0.0.0", protocol: "tcp" }],
        warnings: [],
      }),
    }),
  );
  assert.equal(code, 1);
  assert.match(cap.errors.join("\n"), /protected/);
});

test("a terminal can inspect a row and leave it alone", async () => {
  const prompts: string[] = [];
  const answers = ["1", "n"];
  const cap = capture();
  const code = await main(
    [],
    cap.io,
    deps({
      isTTY: true,
      ask: async (prompt) => {
        prompts.push(prompt);
        return answers.shift() ?? "q";
      },
    }),
  );
  assert.equal(code, 0);
  assert.match(prompts[0] ?? "", /Row to inspect/);
  assert.match(prompts[1] ?? "", /Stop PID 18432/);
  assert.match(cap.logs.join("\n"), /Left it alone/);
});

test("parses yes and row choices", () => {
  assert.equal(parseYes("y"), true);
  assert.equal(parseYes("no"), false);
  assert.equal(parseRowChoice("q", 3), "quit");
  assert.equal(parseRowChoice("2", 3), 2);
  assert.equal(parseRowChoice("9", 3), null);
});
