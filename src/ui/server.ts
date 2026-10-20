import { existsSync, realpathSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { listContainers } from "../docker.js";
import { ToolError } from "../errors.js";
import type { PortView } from "../inspect.js";
import { createPosixRunner, isContainerName, isProtectedProcess, stopProcess, windowsRunner, type ProcessRunner } from "../kill.js";
import { listListeners } from "../platform/index.js";
import { parsePort, PortError } from "../port.js";
import { formatListenersJson } from "../report.js";
import { nodeProjectFs, readProcesses } from "../resolve.js";
import { loadPortViews, type SnapshotSource } from "../snapshot.js";
import { classifyStaticUrl, fileInsideRoot, sameOrInside, staticCacheControl, staticContentType } from "./static.js";

export const DEFAULT_UI_PORT = 4747;
export const UI_HOST = "127.0.0.1";
export const MAX_KILL_BODY_BYTES = 1024;
export const UI_ASSETS_MISSING = "UI assets not built. Run npm run build.";

/** Compiled server sits in dist/ui. The tsx entry lives in src/ui and looks one level up. */
export function defaultUiRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  if (basename(here) === "ui" && basename(dirname(here)) === "dist") return here;
  return resolve(here, "../../dist/ui");
}

export function uiAssetsReady(root: string): boolean {
  return existsSync(join(root, "index.html"));
}

export function isAllowedHost(header: string | undefined, port: number): boolean {
  if (header === undefined) return false;
  const host = header.trim().toLowerCase();
  if (host.length === 0 || /\s/.test(host)) return false;
  // Only the loopback names we bound. A foreign Host is a rebinding attempt.
  return host === `${UI_HOST}:${port}` || host === `localhost:${port}`;
}

/** A missing Origin is a non-browser client. A present Origin must be this exact server URL. */
export function isAllowedOrigin(header: string | string[] | undefined, port: number): boolean {
  if (header === undefined) return true;
  if (typeof header !== "string") return false;
  return header === `http://${UI_HOST}:${port}` || header === `http://localhost:${port}`;
}

function mediaType(header: string | undefined): string {
  return header?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export type KillRequest =
  | { ok: true; pid: number }
  | { ok: false; status: 400 | 413 | 415; error: string };

/** Content-Type, the 1KB cap, then a positive integer pid. No other field is trusted. */
export function parseKillRequest(contentType: string | undefined, body: Buffer): KillRequest {
  if (mediaType(contentType) !== "application/json") {
    return { ok: false, status: 415, error: "Content-Type must be application/json." };
  }
  if (body.length > MAX_KILL_BODY_BYTES) {
    return { ok: false, status: 413, error: "Request body is larger than 1KB." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    return { ok: false, status: 400, error: "Body must be JSON." };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, status: 400, error: "Body must be a JSON object." };
  }

  const pid = (parsed as { pid?: unknown }).pid;
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) {
    return { ok: false, status: 400, error: "pid must be a positive integer." };
  }
  return { ok: true, pid };
}

export interface KillRefusal {
  ok: false;
  message: string;
  suggestion?: string;
}

export type KillPlan = { action: "stop"; pid: number } | { action: "refuse"; status: 403 | 409; body: KillRefusal };

function refuse(status: 403 | 409, message: string, suggestion?: string): KillPlan {
  const body: KillRefusal = suggestion === undefined ? { ok: false, message } : { ok: false, message, suggestion };
  return { action: "refuse", status, body };
}

/**
 * Decide from a fresh snapshot. Docker's forwarder is not a process to taskkill,
 * and a protected pid has no confirm step in the browser.
 */
export function planKill(views: readonly PortView[], pid: number): KillPlan {
  const owned = views.filter((view) => view.pid === pid);
  if (owned.length === 0) {
    return refuse(409, `PID ${pid} is not listening on a TCP port.`);
  }

  const names = [
    ...new Set(owned.flatMap((view) => (view.docker && isContainerName(view.docker.name) ? [view.docker.name] : []))),
  ].sort();
  if (owned.some((view) => view.docker !== null)) {
    if (names.length === 1) {
      const name = names[0];
      if (name !== undefined) {
        return refuse(409, `PID ${pid} is Docker's port forwarder for ${name}.`, `docker stop ${name}`);
      }
    }
    return refuse(409, `PID ${pid} is a container port-forwarder. Handle it from the CLI.`);
  }

  if (owned.some((view) => view.protected || isProtectedProcess(view.pid, view.command, view.executablePath))) {
    const command = owned.find((view) => view.command.length > 0)?.command ?? "This process";
    return refuse(403, `${command} (PID ${pid}) is protected. Handle it from the CLI.`);
  }

  return { action: "stop", pid };
}

export interface UiServerOptions {
  port: number;
  source: SnapshotSource;
  runner: ProcessRunner;
  html?: () => Promise<string | null>;
  staticRoot?: string;
  logError?: (error: unknown) => void;
  logWarning?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export type StartedUi =
  | { ok: true; port: number; host: string; close: () => Promise<void> }
  | { ok: false; message: string };

interface ResolvedUi {
  port: number;
  source: SnapshotSource;
  runner: ProcessRunner;
  html: (() => Promise<string | null>) | null;
  staticRoot: string | null;
  logError: (error: unknown) => void;
  logWarning: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function sendText(res: ServerResponse, status: number, contentType: string, payload: string): void {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | "too-large"> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (value: Buffer | "too-large"): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      total += buf.length;
      if (total > limit) {
        // Stop retaining bytes, but keep reading so the client can take the 413.
        finish("too-large");
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => finish(Buffer.concat(chunks)));
    req.on("error", (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function resolveOptions(options: UiServerOptions): ResolvedUi {
  const html = options.html ?? null;
  const staticRoot = options.staticRoot !== undefined ? options.staticRoot : html ? null : defaultUiRoot();
  return {
    port: options.port,
    source: options.source,
    runner: options.runner,
    html,
    staticRoot,
    logError: options.logError ?? ((error) => console.error(error)),
    logWarning: options.logWarning ?? ((message) => console.error(message)),
    ...(options.sleep ? { sleep: options.sleep } : {}),
  };
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, root: string): Promise<boolean> {
  const decision = classifyStaticUrl(req.url ?? "/");
  if (decision.kind === "pass") return false;
  if (decision.kind === "reject") {
    sendJson(res, 404, { error: "Not found." });
    return true;
  }

  const relativeName = decision.kind === "index" ? "index.html" : `assets/${decision.name}`;
  const lexical = fileInsideRoot(root, relativeName);
  if (!lexical) {
    sendJson(res, 404, { error: "Not found." });
    return true;
  }

  try {
    const rootReal = await realpath(root);
    const fileReal = await realpath(lexical);
    if (!sameOrInside(rootReal, fileReal)) {
      sendJson(res, 404, { error: "Not found." });
      return true;
    }
    const info = await stat(fileReal);
    if (!info.isFile()) {
      sendJson(res, 404, { error: "Not found." });
      return true;
    }
    const body = await readFile(fileReal);
    const kind = decision.kind === "index" ? "index" : "asset";
    res.writeHead(200, {
      "content-type": staticContentType(fileReal),
      "content-length": body.length,
      "cache-control": staticCacheControl(kind),
    });
    if (req.method === "HEAD") res.end();
    else res.end(body);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      sendJson(res, 404, { error: "Not found." });
      return true;
    }
    throw error;
  }
}

async function killResponse(options: ResolvedUi, pid: number): Promise<{ status: number; body: unknown }> {
  const first = await loadPortViews(options.source, null);
  for (const warning of first.warnings) options.logWarning(`warning: ${warning}`);
  const planned = planKill(first.views, pid);
  if (planned.action !== "stop") return { status: planned.status, body: planned.body };

  // The poll that showed this pid can be seconds old, and the pid may have been reused.
  const again = await loadPortViews(options.source, null);
  const current = planKill(again.views, pid);
  if (current.action !== "stop") return { status: current.status, body: current.body };

  const result = await stopProcess(pid, options.runner, options.sleep ? { force: false, sleep: options.sleep } : { force: false });
  if (result.status === "stopped") return { status: 200, body: { ok: true, message: result.message } };
  return { status: 409, body: { ok: false, message: result.message } };
}

async function handle(req: IncomingMessage, res: ServerResponse, options: ResolvedUi, boundPort: () => number): Promise<void> {
  const port = boundPort();
  if (!isAllowedHost(req.headers.host, port)) {
    sendJson(res, 403, { error: "Forbidden." });
    return;
  }
  // Before the body, the pid, or a process lookup. A browser on another origin must not reach kill.
  if (req.method === "POST" && !isAllowedOrigin(req.headers.origin, port)) {
    sendJson(res, 403, { error: "Forbidden." });
    req.resume();
    return;
  }

  const method = req.method ?? "GET";
  if ((method === "GET" || method === "HEAD") && options.staticRoot) {
    const served = await serveStatic(req, res, options.staticRoot);
    if (served) return;
  }

  const pathname = new URL(req.url ?? "/", `http://${UI_HOST}`).pathname;
  if (method === "GET" && pathname === "/" && options.html) {
    const page = await options.html();
    if (page === null) {
      sendJson(res, 404, { error: "Not found." });
      return;
    }
    sendText(res, 200, "text/html; charset=utf-8", page);
    return;
  }

  if (req.method === "GET" && pathname === "/api/ports") {
    try {
      const snapshot = await loadPortViews(options.source, null);
      for (const warning of snapshot.warnings) options.logWarning(`warning: ${warning}`);
      sendText(res, 200, "application/json; charset=utf-8", formatListenersJson(snapshot.views));
    } catch (error) {
      if (error instanceof ToolError) {
        options.logWarning(error.message);
        sendJson(res, 503, { error: error.message });
        return;
      }
      throw error;
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/kill") {
    const contentType = typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : undefined;
    if (mediaType(contentType) !== "application/json") {
      sendJson(res, 415, { error: "Content-Type must be application/json." });
      req.resume();
      return;
    }
    const declared = req.headers["content-length"];
    if (typeof declared === "string" && /^\d+$/.test(declared) && Number(declared) > MAX_KILL_BODY_BYTES) {
      sendJson(res, 413, { error: "Request body is larger than 1KB." });
      req.resume();
      return;
    }
    const body = await readBody(req, MAX_KILL_BODY_BYTES);
    if (body === "too-large") {
      sendJson(res, 413, { error: "Request body is larger than 1KB." });
      req.resume();
      return;
    }
    const request = parseKillRequest(contentType, body);
    if (!request.ok) {
      sendJson(res, request.status, { error: request.error });
      return;
    }
    const outcome = await killResponse(options, request.pid);
    sendJson(res, outcome.status, outcome.body);
    return;
  }

  sendJson(res, 404, { error: "Not found." });
}

/** Bind to loopback. Does not install signal handlers; the caller decides how to stop. */
export async function startUiServer(options: UiServerOptions): Promise<StartedUi> {
  const resolved = resolveOptions(options);
  let boundPort = options.port;
  const server = createServer((req, res) => {
    handle(req, res, resolved, () => boundPort).catch((error: unknown) => {
      resolved.logError(error);
      if (res.headersSent) return;
      sendJson(res, 500, { error: "Something went wrong." });
    });
  });

  const listening = await new Promise<StartedUi>((resolve) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off("listening", onListening);
      const message =
        error.code === "EADDRINUSE"
          ? `Port ${options.port} is already in use. Start the dashboard on another port with --port.`
          : error.message;
      resolve({ ok: false, message });
    };
    const onListening = (): void => {
      server.off("error", onError);
      const address = server.address();
      if (address && typeof address === "object") boundPort = address.port;
      server.on("error", (error) => resolved.logError(error));
      resolve({
        ok: true,
        port: boundPort,
        host: UI_HOST,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          }),
      });
    };
    server.once("error", onError);
    server.listen(options.port, UI_HOST, onListening);
  });
  return listening;
}

export interface RunUiOptions extends UiServerOptions {
  log: (message: string) => void;
  error: (message: string) => void;
  signal?: AbortSignal;
  /** Tests pass false so a SIGINT meant for another server is ignored. */
  signals?: boolean;
  onListening?: (port: number) => void;
}

export async function runUiServer(options: RunUiOptions): Promise<number> {
  const started = await startUiServer(options);
  if (!started.ok) {
    options.error(started.message);
    return 1;
  }

  const code = await new Promise<number>((resolve) => {
    let settled = false;
    const stop = (): void => {
      if (settled) return;
      settled = true;
      if (options.signals !== false) process.off("SIGINT", onSigint);
      options.signal?.removeEventListener("abort", onAbort);
      started.close().then(
        () => resolve(0),
        () => resolve(0),
      );
    };
    const onSigint = (): void => {
      stop();
    };
    const onAbort = (): void => {
      stop();
    };
    if (options.signal?.aborted) {
      stop();
      return;
    }
    options.signal?.addEventListener("abort", onAbort);
    if (options.signals !== false) process.on("SIGINT", onSigint);
    options.log(`whoport ui running at http://${UI_HOST}:${started.port} (Ctrl+C to stop)`);
    options.onListening?.(started.port);
  });
  return code;
}

function defaultSource(): SnapshotSource {
  return {
    listListeners,
    readProcesses,
    containers: listContainers,
    projectFs: nodeProjectFs,
    now: () => new Date(),
  };
}

async function runFromArgv(argv: readonly string[]): Promise<number> {
  let portRaw: string | undefined;
  try {
    const parsed = parseArgs({
      args: [...argv],
      options: { port: { type: "string" } },
      allowPositionals: false,
      strict: true,
    });
    portRaw = parsed.values.port;
  } catch {
    console.error("Usage: tsx src/ui/server.ts [--port N]");
    return 1;
  }

  let port = DEFAULT_UI_PORT;
  if (portRaw !== undefined) {
    try {
      port = parsePort(portRaw);
    } catch (error) {
      console.error(error instanceof PortError ? error.message : "Invalid port.");
      return 1;
    }
  }

  const staticRoot = defaultUiRoot();
  if (!uiAssetsReady(staticRoot)) {
    console.error(UI_ASSETS_MISSING);
    return 1;
  }

  return runUiServer({
    staticRoot,
    port,
    source: defaultSource(),
    runner: process.platform === "win32" ? windowsRunner : createPosixRunner(),
    log: (message) => console.log(message),
    error: (message) => console.error(message),
  });
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
}

if (isDirectRun()) {
  runFromArgv(process.argv.slice(2))
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
