import assert from "node:assert/strict";
import test from "node:test";

import { main } from "../src/cli.js";
import type { PortView } from "../src/inspect.js";
import { diffState, formatWatchLine, snapshotFromViews, watchPort, type WatchOwner, type WatchState } from "../src/watch.js";

function owner(pid: number, name = "node.exe", project: string | null = "chat-service"): WatchOwner {
  return { pid, name, project };
}

function state(owners: WatchOwner[]): WatchState {
  return { owners };
}

const held = state([owner(12292)]);
const other = state([owner(20148)]);
const free = state([]);

test("diffState reports free, held, a new pid, and silence", () => {
  assert.deepEqual(diffState(free, held), { type: "taken", owners: [owner(12292)] });
  assert.deepEqual(diffState(held, free), { type: "freed" });
  assert.deepEqual(diffState(held, other), { type: "taken", owners: [owner(20148)] });
  assert.equal(diffState(held, state([owner(12292)])), null);
  assert.equal(diffState(free, free), null);
});

test("formats the initial line and later changes", () => {
  const time = new Date(2026, 9, 20, 12, 4, 11);
  assert.equal(
    formatWatchLine(time, 3000, "held", [owner(12292)], false),
    "12:04:11  port 3000 is held by node.exe (pid 12292, chat-service)",
  );
  assert.equal(formatWatchLine(new Date(2026, 9, 20, 12, 4, 39), 3000, "now-free", [], false), "12:04:39  port 3000 is now free");
  assert.equal(
    formatWatchLine(new Date(2026, 9, 20, 12, 5, 2), 3000, "taken", [owner(20148)], false),
    "12:05:02  port 3000 taken by node.exe (pid 20148, chat-service)",
  );
  assert.match(formatWatchLine(time, 3000, "held", [owner(1)], true), /\x1b\[2m12:04:11\x1b\[0m/);
  assert.doesNotMatch(formatWatchLine(time, 3000, "free", [], false), /\x1b\[/);
});

test("a docker publish is named by the container", () => {
  const view: PortView = {
    port: 6380,
    pid: 13128,
    addresses: ["0.0.0.0"],
    command: "com.docker.backend.exe",
    commandLine: null,
    executablePath: null,
    startedAt: null,
    uptime: null,
    project: null,
    docker: { name: "patent-dev-redis-1", image: "redis:7-alpine", project: "patent-dev", service: "redis" },
    protected: true,
    kind: "docker",
    verdict: "",
  };
  assert.deepEqual(snapshotFromViews([view]).owners, [
    { pid: 13128, name: "patent-dev-redis-1", project: "patent-dev/redis" },
  ]);
});

function scripted(states: WatchState[]) {
  let index = 0;
  const logs: string[] = [];
  let nowMs = Date.parse("2026-10-20T12:04:11");
  return {
    logs,
    nowMs: () => nowMs,
    advance(ms: number) {
      nowMs += ms;
    },
    loop(extra: Partial<Parameters<typeof watchPort>[0]> = {}) {
      return watchPort({
        port: 3000,
        intervalMs: 1000,
        untilFree: false,
        timeoutMs: null,
        color: false,
        now: () => new Date(nowMs),
        sleep: async (ms) => {
          nowMs += ms;
        },
        signal: new AbortController().signal,
        sample: async () => states[Math.min(index++, states.length - 1)] ?? free,
        log: (line) => {
          logs.push(line);
        },
        ...extra,
      });
    },
  };
}

test("prints the current owner once when nothing changes", async () => {
  const run = scripted([held, held, held]);
  const code = await run.loop({
    timeoutMs: 2500,
    sleep: async (ms) => {
      run.advance(ms);
    },
  });
  assert.equal(code, 1);
  assert.equal(run.logs.length, 1);
  assert.match(run.logs[0] ?? "", /is held by node.exe \(pid 12292, chat-service\)/);
});

test("prints free to held, held to free, and a different pid", async () => {
  const freed = scripted([held, free]);
  const freeCode = await freed.loop({ untilFree: true });
  assert.equal(freeCode, 0);
  assert.match(freed.logs[0] ?? "", /is held by/);
  assert.match(freed.logs[1] ?? "", /is now free/);

  const taken = scripted([free, held]);
  const controller = new AbortController();
  let sleeps = 0;
  const takenCode = await taken.loop({
    sleep: async (ms) => {
      taken.advance(ms);
      sleeps += 1;
      if (sleeps >= 2) controller.abort();
    },
    signal: controller.signal,
  });
  assert.equal(takenCode, 0);
  assert.match(taken.logs[1] ?? "", /taken by node.exe \(pid 12292, chat-service\)/);

  const moved = scripted([held, other]);
  const stop = new AbortController();
  let movedSleeps = 0;
  await moved.loop({
    sleep: async (ms) => {
      moved.advance(ms);
      movedSleeps += 1;
      if (movedSleeps >= 2) stop.abort();
    },
    signal: stop.signal,
  });
  assert.match(moved.logs[1] ?? "", /taken by node.exe \(pid 20148, chat-service\)/);
});

test("--until-free returns immediately when the port is already free", async () => {
  const run = scripted([free]);
  let slept = false;
  const code = await run.loop({
    untilFree: true,
    sleep: async () => {
      slept = true;
    },
  });
  assert.equal(code, 0);
  assert.equal(slept, false);
  assert.match(run.logs[0] ?? "", /port 3000 is free$/);
});

test("Ctrl+C stops the loop with no further output", async () => {
  const run = scripted([held]);
  const controller = new AbortController();
  const code = await run.loop({
    sleep: async () => {
      controller.abort();
    },
    signal: controller.signal,
  });
  assert.equal(code, 0);
  assert.equal(run.logs.length, 1);
});

test("watch --until-free exits 0 without waiting when the port is free", async () => {
  const logs: string[] = [];
  let listed = 0;
  const code = await main(["watch", "3000", "--until-free"], {
    log: (message) => logs.push(message),
    error: () => {},
  }, {
    isTTY: false,
    color: false,
    listListeners: async () => {
      listed += 1;
      return { listeners: [], warnings: [] };
    },
    containers: async () => new Map(),
    readProcesses: async () => new Map(),
  });
  assert.equal(code, 0);
  assert.equal(listed, 1);
  assert.match(logs[0] ?? "", /port 3000 is free/);
});

test("--timeout 0 exits 1 after the current line and does not sleep", async () => {
  const logs: string[] = [];
  let slept = false;
  const code = await main(["watch", "3000", "--timeout", "0"], {
    log: (message) => logs.push(message),
    error: () => {},
  }, {
    color: false,
    listListeners: async () => ({
      listeners: [{ port: 3000, pid: 12292, command: "node.exe", address: "127.0.0.1", protocol: "tcp" }],
      warnings: [],
    }),
    containers: async () => new Map(),
    readProcesses: async () => new Map(),
    sleep: async () => {
      slept = true;
    },
  });
  assert.equal(code, 1);
  assert.equal(slept, false);
  assert.match(logs[0] ?? "", /is held by node.exe \(pid 12292\)/);
});

test("SIGINT during watch returns 0", async () => {
  const code = await main(["watch", "3000"], { log: () => {}, error: () => {} }, {
    color: false,
    listListeners: async () => ({ listeners: [], warnings: [] }),
    containers: async () => new Map(),
    readProcesses: async () => new Map(),
    sleep: (_ms, signal) =>
      new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
        process.emit("SIGINT");
      }),
  });
  assert.equal(code, 0);
});

test("rejects an interval under 500 ms before polling", async () => {
  let listed = 0;
  const errors: string[] = [];
  const code = await main(["watch", "3000", "--interval", "100"], {
    log: () => {},
    error: (message) => errors.push(message),
  }, {
    listListeners: async () => {
      listed += 1;
      return { listeners: [], warnings: [] };
    },
  });
  assert.equal(code, 1);
  assert.equal(listed, 0);
  assert.match(errors.join("\n"), /at least 500/);
});
