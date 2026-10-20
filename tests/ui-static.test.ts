import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { main } from "../src/cli.js";
import { classifyStaticUrl, fileInsideRoot, staticCacheControl, staticContentType } from "../src/ui/static.js";
import { startUiServer, UI_ASSETS_MISSING } from "../src/ui/server.js";

test("rejects traversal before a file is chosen", () => {
  const attacks = [
    "/assets/../../package.json",
    "/assets/%2e%2e/%2e%2e/package.json",
    "/assets/%252e%252e/%252e%252e/package.json",
    "/assets/..\\..\\package.json",
    "/assets/%5c..%5cpackage.json",
    "/assets/app.js%00.png",
    "/assets/%00",
    "/assets/C:/Windows/notepad.exe",
  ];
  for (const attack of attacks) {
    assert.equal(classifyStaticUrl(attack).kind, "reject", attack);
  }
  assert.equal(classifyStaticUrl("/").kind, "index");
  assert.deepEqual(classifyStaticUrl("/assets/app.js"), { kind: "asset", name: "app.js" });
  assert.equal(classifyStaticUrl("/api/ports").kind, "pass");
  assert.equal(fileInsideRoot("C:\\ui", "assets/../../secret.txt"), null);
});

test("content types and cache headers", () => {
  assert.equal(staticContentType("index.html"), "text/html; charset=utf-8");
  assert.equal(staticContentType("app.js"), "text/javascript; charset=utf-8");
  assert.equal(staticContentType("app.css"), "text/css; charset=utf-8");
  assert.equal(staticCacheControl("index"), "no-store");
  assert.match(staticCacheControl("asset"), /immutable/);
});

function request(
  port: number,
  init: { path: string; method?: string; host?: string },
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: init.path,
        method: init.method ?? "GET",
        headers: init.host ? { host: init.host } : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8"), headers: res.headers }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("serves built files and refuses paths that leave dist/ui", async () => {
  const root = await mkdtemp(join(tmpdir(), "whoport-ui-"));
  const outside = join(tmpdir(), `whoport-secret-${Date.now()}.txt`);
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), "<!doctype html><title>whoport</title>");
  await writeFile(join(root, "assets", "app.js"), "console.log(1)");
  await writeFile(join(root, "assets", "app.css"), "body{}");
  await writeFile(outside, "secret");
  try {
    await symlink(outside, join(root, "assets", "escape.txt"));
  } catch {
    // Some Windows setups refuse symlinks. The lexical checks still run below.
  }

  const started = await startUiServer({
    port: 0,
    staticRoot: root,
    source: {
      listListeners: async () => ({ listeners: [], warnings: [] }),
      readProcesses: async () => new Map(),
      containers: async () => new Map(),
      projectFs: { isDirectory: () => false, exists: () => false, readFile: () => null },
      now: () => new Date(),
    },
    runner: {
      async terminate() {
        return { ok: true };
      },
      async force() {
        return { ok: true };
      },
      async running() {
        return false;
      },
    },
    logError: () => {},
    logWarning: () => {},
  });
  assert.equal(started.ok, true);
  if (!started.ok) return;

  try {
    const page = await request(started.port, { path: "/" });
    assert.equal(page.status, 200);
    assert.match(String(page.headers["content-type"]), /text\/html/);
    assert.equal(page.headers["cache-control"], "no-store");
    assert.match(page.body, /whoport/);

    const script = await request(started.port, { path: "/assets/app.js" });
    assert.equal(script.status, 200);
    assert.match(String(script.headers["content-type"]), /javascript/);
    assert.match(String(script.headers["cache-control"]), /immutable/);

    const style = await request(started.port, { path: "/assets/app.css" });
    assert.match(String(style.headers["content-type"]), /text\/css/);

    const head = await request(started.port, { path: "/", method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.body, "");

    for (const path of [
      "/assets/../../package.json",
      "/assets/%2e%2e/%2e%2e/package.json",
      "/assets/%252e%252e/%252e%252e/package.json",
      "/assets/..\\..\\package.json",
      "/assets/app.js%00.png",
      "/nope",
      "/assets/escape.txt",
    ]) {
      const response = await request(started.port, { path });
      assert.equal(response.status, 404, path);
      assert.equal(response.body.includes("secret"), false, path);
      assert.equal(response.body.includes("<!doctype html>"), false, path);
    }

    const foreign = await request(started.port, { path: "/assets/app.js", host: "evil.example" });
    assert.equal(foreign.status, 403);
  } finally {
    await started.close();
    await rm(root, { recursive: true, force: true });
    await rm(outside, { force: true });
  }
});

test("ui without a build tells you to run npm run build", async () => {
  const errors: string[] = [];
  const code = await main(["ui"], { log: () => {}, error: (message) => errors.push(message) }, {
    staticRoot: join(tmpdir(), "whoport-missing-ui"),
  });
  assert.equal(code, 1);
  assert.equal(errors.join("\n"), UI_ASSETS_MISSING);
});
