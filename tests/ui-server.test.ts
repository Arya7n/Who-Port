import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import type { ContainerInfo } from "../src/docker.js";
import { ToolError } from "../src/errors.js";
import { buildViews } from "../src/inspect.js";
import type { ProcessRunner } from "../src/kill.js";
import type { Listener } from "../src/platform/types.js";
import { formatListenersJson } from "../src/report.js";
import type { ProcessDetails, ProjectFs } from "../src/resolve.js";
import type { SnapshotSource } from "../src/snapshot.js";
import {
  isAllowedHost,
  isAllowedOrigin,
  MAX_KILL_BODY_BYTES,
  parseKillRequest,
  planKill,
  runUiServer,
  startUiServer,
  type UiServerOptions,
} from "../src/ui/server.js";

const now = new Date("2026-10-20T12:00:00.000Z");

const fs: ProjectFs = {
  isDirectory: () => false,
  exists: () => false,
  readFile: () => null,
};

function nodeListener(pid = 18432): Listener {
  return { port: 3000, pid, command: "node.exe", address: "127.0.0.1", protocol: "tcp" };
}

function source(listeners: Listener[], containers = new Map<number, ContainerInfo>(), warnings: string[] = []): SnapshotSource & { calls: number } {
  const state = { calls: 0 };
  const api: SnapshotSource & { calls: number } = {
    get calls() {
      return state.calls;
    },
    listListeners: async () => {
      state.calls += 1;
      return { listeners, warnings };
    },
    readProcesses: async () => new Map<number, ProcessDetails>(),
    containers: async () => containers,
    projectFs: fs,
    now: () => now,
  };
  return api;
}

function runner(calls: string[]): ProcessRunner {
  return {
    async terminate(pid: number) {
      calls.push(`term ${pid}`);
      return { ok: true };
    },
    async force(pid: number) {
      calls.push(`force ${pid}`);
      return { ok: true };
    },
    async running() {
      return false;
    },
  };
}

function options(overrides: Partial<UiServerOptions> = {}): UiServerOptions {
  return {
    port: 0,
    source: source([nodeListener()]),
    runner: runner([]),
    html: async () => "<p>whoport</p>",
    logError: () => {},
    logWarning: () => {},
    ...overrides,
  };
}

function request(
  port: number,
  init: { path?: string; method?: string; host?: string; headers?: Record<string, string>; body?: string | Buffer } = {},
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: init.path ?? "/",
        method: init.method ?? "GET",
        headers: {
          ...(init.host ? { host: init.host } : {}),
          ...init.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8"), headers: res.headers }),
        );
      },
    );
    req.on("error", reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

function allowsCrossOrigin(headers: http.IncomingHttpHeaders): boolean {
  return Object.keys(headers).some((name) => name.toLowerCase().startsWith("access-control-allow"));
}

async function withServer(opts: UiServerOptions, fn: (port: number) => Promise<void>): Promise<void> {
  const started = await startUiServer(opts);
  assert.equal(started.ok, true);
  if (!started.ok) return;
  try {
    assert.equal(started.host, "127.0.0.1");
    await fn(started.port);
  } finally {
    await started.close();
  }
}

test("accepts only the bound loopback host", () => {
  assert.equal(isAllowedHost("127.0.0.1:4747", 4747), true);
  assert.equal(isAllowedHost("localhost:4747", 4747), true);
  assert.equal(isAllowedHost("LocalHost:4747", 4747), true);
  assert.equal(isAllowedHost("127.0.0.1:4748", 4747), false);
  assert.equal(isAllowedHost("evil.example", 4747), false);
  assert.equal(isAllowedHost("evil.example:4747", 4747), false);
  assert.equal(isAllowedHost(undefined, 4747), false);
});

test("a POST origin must be this server when the header is present", () => {
  assert.equal(isAllowedOrigin(undefined, 4747), true);
  assert.equal(isAllowedOrigin("http://127.0.0.1:4747", 4747), true);
  assert.equal(isAllowedOrigin("http://localhost:4747", 4747), true);
  assert.equal(isAllowedOrigin("http://evil.example", 4747), false);
  assert.equal(isAllowedOrigin("https://127.0.0.1:4747", 4747), false);
  assert.equal(isAllowedOrigin("http://127.0.0.1:4747/", 4747), false);
});

test("rejects a kill body that is not JSON, too big, or not a positive integer pid", () => {
  assert.equal(parseKillRequest("text/plain", Buffer.from("{}")).ok, false);
  assert.equal(parseKillRequest(undefined, Buffer.from("{}")).status, 415);
  const charset = parseKillRequest("application/json; charset=utf-8", Buffer.from('{"pid":18432}'));
  assert.deepEqual(charset, { ok: true, pid: 18432 });
  assert.equal(parseKillRequest("application/json", Buffer.alloc(MAX_KILL_BODY_BYTES + 1)).status, 413);
  for (const body of ["{}", '{"pid":0}', '{"pid":-3}', '{"pid":1.5}', '{"pid":"12"}', "[]", "null"]) {
    const parsed = parseKillRequest("application/json", Buffer.from(body));
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.status, 400);
  }
});

test("refuses a protected pid and tells the caller to use the CLI", () => {
  const views = buildViews(
    [{ port: 445, pid: 4, command: "System", address: "0.0.0.0", protocol: "tcp" }],
    new Map(),
    new Map(),
    fs,
    now,
  );
  const plan = planKill(views, 4);
  assert.equal(plan.action, "refuse");
  if (plan.action !== "refuse") return;
  assert.equal(plan.status, 403);
  assert.match(plan.body.message, /Handle it from the CLI/);
  assert.equal(plan.body.suggestion, undefined);
});

test("a container forwarder is not a kill, and names docker stop", () => {
  const containers = new Map<number, ContainerInfo>([
    [6380, { name: "patent-dev-redis-1", image: "redis:7-alpine", project: "patent-dev", service: "redis" }],
  ]);
  const views = buildViews(
    [{ port: 6380, pid: 13128, command: "com.docker.backend.exe", address: "0.0.0.0", protocol: "tcp" }],
    new Map(),
    containers,
    fs,
    now,
  );
  const plan = planKill(views, 13128);
  assert.equal(plan.action, "refuse");
  if (plan.action !== "refuse") return;
  assert.deepEqual(plan.body, {
    ok: false,
    message: "PID 13128 is Docker's port forwarder for patent-dev-redis-1.",
    suggestion: "docker stop patent-dev-redis-1",
  });
});

test("a foreign Host is forbidden before any lookup", async () => {
  let listed = 0;
  await withServer(
    options({
      source: {
        ...source([]),
        listListeners: async () => {
          listed += 1;
          return { listeners: [], warnings: [] };
        },
      },
    }),
    async (port) => {
      const response = await request(port, { path: "/api/ports", host: "evil.example" });
      assert.equal(response.status, 403);
      assert.deepEqual(JSON.parse(response.body), { error: "Forbidden." });
      assert.equal(listed, 0);
    },
  );
});

test("GET /api/ports matches whoport --all --json", async () => {
  const listeners = [nodeListener()];
  const origin = source(listeners);
  await withServer(options({ source: origin }), async (port) => {
    const page = await request(port, { path: "/" });
    assert.equal(page.status, 200);
    assert.equal(page.body, "<p>whoport</p>");

    const response = await request(port, { path: "/api/ports" });
    assert.equal(response.status, 200);
    assert.match(response.body, /"listeners"/);
    const expected = buildViews(listeners, new Map(), new Map(), fs, now);
    assert.deepEqual(JSON.parse(response.body), JSON.parse(formatListenersJson(expected)));
  });
});

test("POST /api/kill checks content type, size, and pid on the wire", async () => {
  await withServer(options(), async (port) => {
    const plain = await request(port, { path: "/api/kill", method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
    assert.equal(plain.status, 415);

    const huge = await request(port, {
      path: "/api/kill",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: Buffer.alloc(MAX_KILL_BODY_BYTES + 1, 0x61),
    });
    assert.equal(huge.status, 413);

    const badPid = await request(port, {
      path: "/api/kill",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"pid":-1}',
    });
    assert.equal(badPid.status, 400);
    assert.match(badPid.body, /positive integer/);
  });
});

test("a protected pid is refused and the runner is not called", async () => {
  const calls: string[] = [];
  await withServer(
    options({
      source: source([{ port: 445, pid: 4, command: "System", address: "0.0.0.0", protocol: "tcp" }]),
      runner: runner(calls),
    }),
    async (port) => {
      const response = await request(port, {
        path: "/api/kill",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"pid":4}',
      });
      assert.equal(response.status, 403);
      assert.match(response.body, /Handle it from the CLI/);
      assert.deepEqual(calls, []);
    },
  );
});

test("a container pid returns docker stop and does not taskkill", async () => {
  const calls: string[] = [];
  const containers = new Map<number, ContainerInfo>([
    [6380, { name: "patent-dev-redis-1", image: "redis:7-alpine", project: "patent-dev", service: "redis" }],
  ]);
  await withServer(
    options({
      source: source(
        [{ port: 6380, pid: 13128, command: "com.docker.backend.exe", address: "0.0.0.0", protocol: "tcp" }],
        containers,
      ),
      runner: runner(calls),
    }),
    async (port) => {
      const response = await request(port, {
        path: "/api/kill",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"pid":13128}',
      });
      const body = JSON.parse(response.body) as { ok: boolean; suggestion: string };
      assert.equal(body.ok, false);
      assert.equal(body.suggestion, "docker stop patent-dev-redis-1");
      assert.deepEqual(calls, []);
    },
  );
});

test("does not kill when the pid drops off the port before the stop", async () => {
  const calls: string[] = [];
  let listed = 0;
  await withServer(
    options({
      source: {
        ...source([nodeListener()]),
        listListeners: async () => {
          listed += 1;
          return { listeners: listed === 1 ? [nodeListener()] : [], warnings: [] };
        },
      },
      runner: runner(calls),
    }),
    async (port) => {
      const response = await request(port, {
        path: "/api/kill",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"pid":18432}',
      });
      assert.equal(response.status, 409);
      assert.match(response.body, /not listening/);
      assert.equal(listed, 2);
      assert.deepEqual(calls, []);
    },
  );
});

test("stops a dev pid that is still listening on the second lookup", async () => {
  const calls: string[] = [];
  let listed = 0;
  await withServer(
    options({
      source: {
        ...source([nodeListener()]),
        listListeners: async () => {
          listed += 1;
          return { listeners: [nodeListener()], warnings: [] };
        },
      },
      runner: runner(calls),
    }),
    async (port) => {
      const response = await request(port, {
        path: "/api/kill",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"pid":18432}',
      });
      assert.equal(response.status, 200);
      assert.deepEqual(JSON.parse(response.body), { ok: true, message: "Stopped PID 18432." });
      assert.equal(listed, 2);
      assert.deepEqual(calls, ["term 18432"]);
    },
  );
});

test("POST /api/kill checks Host and Origin before it looks up a pid", async () => {
  let listed = 0;
  await withServer(
    options({
      source: {
        ...source([]),
        listListeners: async () => {
          listed += 1;
          return { listeners: [], warnings: [] };
        },
      },
    }),
    async (port) => {
      const kill = (headers?: Record<string, string>, host?: string) =>
        request(port, {
          path: "/api/kill",
          method: "POST",
          ...(host ? { host } : {}),
          headers: { "content-type": "application/json", ...headers },
          body: '{"pid":99999}',
        });

      const evil = await kill({ origin: "http://evil.example" });
      assert.equal(evil.status, 403);
      assert.deepEqual(JSON.parse(evil.body), { error: "Forbidden." });
      assert.equal(allowsCrossOrigin(evil.headers), false);
      assert.equal(listed, 0);

      const matched = await kill({ origin: `http://127.0.0.1:${port}` });
      assert.equal(matched.status, 409);
      assert.match(matched.body, /PID 99999 is not listening/);
      assert.equal(allowsCrossOrigin(matched.headers), false);
      assert.equal(listed, 1);

      const bare = await kill();
      assert.equal(bare.status, 409);
      assert.match(bare.body, /PID 99999 is not listening/);
      assert.equal(allowsCrossOrigin(bare.headers), false);

      const seen = listed;
      const badHost = await kill({ origin: "http://evil.example" }, "evil.example");
      assert.equal(badHost.status, 403);
      assert.deepEqual(JSON.parse(badHost.body), { error: "Forbidden." });
      assert.equal(allowsCrossOrigin(badHost.headers), false);
      assert.equal(listed, seen);
    },
  );
});

test("a foreign Origin is forbidden and no route sends CORS headers", async () => {
  const calls: string[] = [];
  await withServer(options({ runner: runner(calls) }), async (port) => {
    const foreign = await request(port, {
      path: "/api/kill",
      method: "POST",
      headers: { origin: "http://evil.example", "content-type": "application/json" },
      body: '{"pid":18432}',
    });
    assert.equal(foreign.status, 403);
    assert.deepEqual(JSON.parse(foreign.body), { error: "Forbidden." });
    assert.equal(allowsCrossOrigin(foreign.headers), false);
    assert.deepEqual(calls, []);

    const local = await request(port, {
      path: "/api/kill",
      method: "POST",
      headers: { origin: `http://127.0.0.1:${port}`, "content-type": "application/json" },
      body: '{"pid":18432}',
    });
    assert.equal(local.status, 200);
    assert.equal(allowsCrossOrigin(local.headers), false);

    const page = await request(port, { path: "/" });
    assert.equal(page.status, 200);
    assert.equal(allowsCrossOrigin(page.headers), false);

    const ports = await request(port, { path: "/api/ports", headers: { origin: "http://evil.example" } });
    assert.equal(ports.status, 200);
    assert.equal(allowsCrossOrigin(ports.headers), false);

    const missing = await request(port, { path: "/missing" });
    assert.equal(missing.status, 404);
    assert.equal(allowsCrossOrigin(missing.headers), false);
  });
});

test("unknown routes are JSON 404 and a handler error does not leak its stack", async () => {
  const logged: unknown[] = [];
  await withServer(
    options({
      source: {
        ...source([]),
        listListeners: async () => {
          throw new Error("token secret-stack at handler");
        },
      },
      logError: (error) => {
        logged.push(error);
      },
    }),
    async (port) => {
      const missing = await request(port, { path: "/api/nope" });
      assert.equal(missing.status, 404);
      assert.deepEqual(JSON.parse(missing.body), { error: "Not found." });

      const crashed = await request(port, { path: "/api/ports" });
      assert.equal(crashed.status, 500);
      assert.equal(crashed.body.includes("secret-stack"), false);
      assert.match(String(logged[0]), /secret-stack/);
    },
  );
});

test("a missing tool becomes a 503 without a stack", async () => {
  await withServer(
    options({
      source: {
        ...source([]),
        listListeners: async () => {
          throw new ToolError("missing", "ss is not installed.");
        },
      },
    }),
    async (port) => {
      const response = await request(port, { path: "/api/ports" });
      assert.equal(response.status, 503);
      assert.deepEqual(JSON.parse(response.body), { error: "ss is not installed." });
    },
  );
});

test("a taken port exits 1 with a --port hint", async () => {
  const first = await startUiServer(options());
  assert.equal(first.ok, true);
  if (!first.ok) return;
  try {
    const errors: string[] = [];
    const code = await runUiServer({
      ...options({ port: first.port }),
      log: () => {},
      error: (message) => errors.push(message),
      signals: false,
    });
    assert.equal(code, 1);
    assert.match(errors.join("\n"), /already in use/);
    assert.match(errors.join("\n"), /--port/);
  } finally {
    await first.close();
  }
});

test("Ctrl+C stops the server with code 0", async () => {
  const done = runUiServer({
    ...options(),
    log: () => {},
    error: () => {},
    onListening: () => {
      process.emit("SIGINT");
    },
  });
  assert.equal(await done, 0);
});
