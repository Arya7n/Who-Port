#!/usr/bin/env node
import { realpathSync } from "node:fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { listContainers } from "./docker.js";
import { ToolError } from "./errors.js";
import { sharedTarget, type KillTarget, type PortView } from "./inspect.js";
import {
  createPosixRunner,
  dockerStop,
  stopProcess,
  windowsRunner,
  type ControlResult,
  type ProcessRunner,
} from "./kill.js";
import { listListeners } from "./platform/index.js";
import type { ListenerQuery } from "./platform/types.js";
import { parsePort, PortError } from "./port.js";
import { formatKillJson, formatListenersJson, formatPortReport, formatTable, useColor } from "./report.js";
import { nodeProjectFs, readProcesses, type ProcessDetails, type ProjectFs } from "./resolve.js";
import { loadPortViews } from "./snapshot.js";
import { parseInterval, parseTimeoutSeconds, snapshotFromViews, watchPort } from "./watch.js";

const USAGE = "Usage: whoport [port] [--all] [--json] [--kill] [--yes]\n       whoport watch <port> [--interval ms] [--until-free] [--timeout seconds]";

export interface CliIO {
  log: (message: string) => void;
  error: (message: string) => void;
}

export interface CliDeps {
  listListeners: () => Promise<ListenerQuery>;
  readProcesses: (pids: readonly number[]) => Promise<Map<number, ProcessDetails>>;
  containers: () => Promise<Map<number, import("./docker.js").ContainerInfo>>;
  runner: ProcessRunner;
  dockerStop: (name: string) => Promise<ControlResult>;
  now: () => Date;
  isTTY: boolean;
  ask: (prompt: string) => Promise<string>;
  color: boolean;
  projectFs: ProjectFs;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}

const defaultIO: CliIO = {
  log: (message) => {
    console.log(message);
  },
  error: (message) => {
    console.error(message);
  },
};

export function parseYes(answer: string): boolean {
  return /^(y|yes)$/i.test(answer.trim());
}

export function parseRowChoice(answer: string, count: number): number | "quit" | null {
  const text = answer.trim();
  if (/^(q|quit)$/i.test(text)) return "quit";
  if (!/^\d+$/.test(text)) return null;
  const row = Number(text);
  if (row < 1 || row > count) return null;
  return row;
}

export async function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

function helpText(): string {
  return [
    USAGE,
    "",
    "Show which process is listening, which project it belongs to, and whether it is safe to stop.",
    "",
    "  whoport                 list ports and pick a row",
    "  whoport <port>          inspect one port",
    "  whoport <port> --kill   stop it after confirmation",
    "  whoport --all           table of listening TCP ports",
    "  whoport --json          machine-readable output",
    "  whoport watch <port>    print when the owner changes",
    "",
    "The port must be an integer from 1 to 65535.",
  ].join("\n");
}

function makeDeps(overrides: Partial<CliDeps>): CliDeps {
  const isTTY = overrides.isTTY !== undefined ? overrides.isTTY : Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const deps: CliDeps = {
    listListeners,
    readProcesses,
    containers: listContainers,
    runner: process.platform === "win32" ? windowsRunner : createPosixRunner(),
    dockerStop,
    now: () => new Date(),
    isTTY,
    ask,
    color: useColor(process.env, isTTY),
    projectFs: nodeProjectFs,
    sleep: abortableSleep,
  };
  if (overrides.listListeners) deps.listListeners = overrides.listListeners;
  if (overrides.readProcesses) deps.readProcesses = overrides.readProcesses;
  if (overrides.containers) deps.containers = overrides.containers;
  if (overrides.runner) deps.runner = overrides.runner;
  if (overrides.dockerStop) deps.dockerStop = overrides.dockerStop;
  if (overrides.now) deps.now = overrides.now;
  if (overrides.ask) deps.ask = overrides.ask;
  if (overrides.projectFs) deps.projectFs = overrides.projectFs;
  if (overrides.color !== undefined) deps.color = overrides.color;
  if (overrides.sleep) deps.sleep = overrides.sleep;
  return deps;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", finish);
      resolve();
    }, ms);
    const finish = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", finish, { once: true });
  });
}

async function loadViews(deps: CliDeps, port: number | null, io: CliIO): Promise<PortView[] | null> {
  try {
    const snapshot = await loadPortViews(deps, port);
    for (const warning of snapshot.warnings) io.error(`warning: ${warning}`);
    return snapshot.views;
  } catch (error) {
    if (error instanceof ToolError) {
      io.error(error.message);
      return null;
    }
    throw error;
  }
}

type Answer = "yes" | "no" | "mismatch" | "blocked";

async function confirmStop(target: Extract<KillTarget, { kind: "docker" | "process" }>, deps: CliDeps, yes: boolean): Promise<Answer> {
  if (target.kind === "docker") {
    if (yes) return "yes";
    if (!deps.isTTY) return "blocked";
    const answer = await deps.ask(`Stop container ${target.name} with docker stop? [y/N] `);
    return parseYes(answer) ? "yes" : "no";
  }
  if (target.protected) {
    if (!deps.isTTY) return "blocked";
    const typed = (await deps.ask(`PID ${target.pid} (${target.command}) is protected. Type ${target.pid} to confirm: `)).trim();
    return typed === String(target.pid) ? "yes" : "mismatch";
  }
  if (yes) return "yes";
  if (!deps.isTTY) return "blocked";
  const answer = await deps.ask(`Stop PID ${target.pid} (${target.command})? [y/N] `);
  return parseYes(answer) ? "yes" : "no";
}

async function performStop(
  port: number,
  target: Extract<KillTarget, { kind: "docker" | "process" }>,
  deps: CliDeps,
  yes: boolean,
  io: CliIO,
  json: boolean,
): Promise<number> {
  const answer = await confirmStop(target, deps, yes);
  if (answer === "blocked") {
    const message =
      target.kind === "docker"
        ? "Pass --yes to stop a container without a terminal."
        : target.protected
          ? `PID ${target.pid} is protected. whoport will not stop it without a terminal.`
          : "Pass --yes to stop a process without a terminal.";
    return finishKill(port, false, "refused", message, io, json, 1);
  }
  if (answer === "no") return finishKill(port, false, "refused", "Left it alone.", io, json, 0);
  if (answer === "mismatch") {
    return finishKill(port, false, "refused", "Confirmation did not match. Left it alone.", io, json, 1);
  }

  if (target.kind === "docker") {
    const result = await deps.dockerStop(target.name);
    if (result.ok) return finishKill(port, true, "docker-stop", `Stopped container ${target.name}.`, io, json, 0);
    return finishKill(port, false, "docker-stop", result.message, io, json, 1);
  }

  const graceful = await stopProcess(target.pid, deps.runner, { force: yes });
  if (graceful.status === "still-running" && !yes) {
    if (!deps.isTTY) return finishKill(port, false, "stop", graceful.message, io, json, 1);
    const forceAnswer = await deps.ask(`PID ${target.pid} is still running. Force stop? [y/N] `);
    if (!parseYes(forceAnswer)) return finishKill(port, false, "stop", graceful.message, io, json, 0);
    const forced = await deps.runner.force(target.pid);
    if (forced.ok || (!forced.ok && forced.reason === "gone")) {
      return finishKill(port, true, "force", `PID ${target.pid} did not exit. Forced it to stop.`, io, json, 0);
    }
    return finishKill(port, false, "force", forced.message, io, json, 1);
  }

  const ok = graceful.status === "stopped";
  const action = graceful.forced ? "force" : "stop";
  return finishKill(port, ok, action, graceful.message, io, json, ok ? 0 : 1);
}

function finishKill(
  port: number,
  ok: boolean,
  action: string,
  message: string,
  io: CliIO,
  json: boolean,
  code: number,
): number {
  if (json) io.log(formatKillJson({ port, ok, action, message }));
  else if (code === 0) io.log(message);
  else io.error(message);
  return code;
}

async function stopPort(port: number, views: readonly PortView[], deps: CliDeps, yes: boolean, io: CliIO, json: boolean): Promise<number> {
  if (views.length === 0) {
    const message = `port ${port} is free`;
    if (json) io.log(formatListenersJson(views, port));
    else io.log(message);
    return 0;
  }
  const target = sharedTarget(views);
  if (target.kind === "mixed") {
    return finishKill(
      port,
      false,
      "refused",
      `Port ${port} is held by more than one process. Run whoport and pick a row.`,
      io,
      json,
      1,
    );
  }
  if (target.kind === "none") return finishKill(port, false, "refused", `port ${port} is free`, io, json, 0);
  return performStop(port, target, deps, yes, io, json);
}

async function interactive(views: readonly PortView[], deps: CliDeps, io: CliIO): Promise<number> {
  io.log(formatTable(views, { color: deps.color, numbers: true }));
  if (views.length === 0) return 0;
  const answer = await deps.ask("Row to inspect, or q to quit: ");
  const choice = parseRowChoice(answer, views.length);
  if (choice === "quit") return 0;
  if (choice === null) {
    io.error("No row matches that.");
    return 1;
  }
  const view = views[choice - 1];
  if (!view) {
    io.error("No row matches that.");
    return 1;
  }
  io.log("");
  io.log(formatPortReport(view.port, [view], deps.color));
  io.log("");
  return stopPort(view.port, [view], deps, false, io, false);
}

interface WatchFlags {
  kill: boolean;
  yes: boolean;
  all: boolean;
  json: boolean;
  untilFree: boolean;
  intervalRaw: string | undefined;
  timeoutRaw: string | undefined;
}

async function commandWatch(positionals: readonly string[], flags: WatchFlags, deps: CliDeps, io: CliIO): Promise<number> {
  const rawPort = positionals[1];
  if (rawPort === undefined || positionals.length !== 2) {
    io.error("Usage: whoport watch <port>");
    return 1;
  }
  if (flags.kill || flags.yes || flags.all || flags.json) {
    io.error("watch only accepts --interval, --until-free, and --timeout.");
    return 1;
  }

  let port: number;
  try {
    port = parsePort(rawPort);
  } catch (error) {
    io.error(error instanceof PortError ? error.message : "Invalid port.");
    return 1;
  }

  let intervalMs: number;
  let timeoutMs: number | null;
  try {
    intervalMs = parseInterval(flags.intervalRaw);
    timeoutMs = parseTimeoutSeconds(flags.timeoutRaw);
  } catch (error) {
    io.error(error instanceof Error ? error.message : "Invalid watch option.");
    return 1;
  }

  // SIGINT is handled here so Ctrl+C returns 0 instead of a stack trace.
  const controller = new AbortController();
  const onSigint = (): void => {
    controller.abort();
  };
  process.on("SIGINT", onSigint);
  try {
    return await watchPort({
      port,
      intervalMs,
      untilFree: flags.untilFree,
      timeoutMs,
      color: deps.color,
      now: deps.now,
      sleep: (ms) => deps.sleep(ms, controller.signal),
      signal: controller.signal,
      log: (line) => {
        io.log(line);
      },
      sample: async () => {
        const views = await loadViews(deps, port, io);
        if (views === null) return null;
        return snapshotFromViews(views);
      },
    });
  } finally {
    process.off("SIGINT", onSigint);
  }
}

export async function main(argv: readonly string[], io: CliIO = defaultIO, overrides: Partial<CliDeps> = {}): Promise<number> {
  const deps = makeDeps(overrides);
  let help = false;
  let kill = false;
  let yes = false;
  let all = false;
  let json = false;
  let untilFree = false;
  let intervalRaw: string | undefined;
  let timeoutRaw: string | undefined;
  let positionals: string[] = [];

  try {
    const parsed = parseArgs({
      args: [...argv],
      options: {
        help: { type: "boolean", short: "h" },
        kill: { type: "boolean" },
        yes: { type: "boolean" },
        all: { type: "boolean" },
        json: { type: "boolean" },
        interval: { type: "string" },
        "until-free": { type: "boolean" },
        timeout: { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    });
    help = parsed.values.help === true;
    kill = parsed.values.kill === true;
    yes = parsed.values.yes === true;
    all = parsed.values.all === true;
    json = parsed.values.json === true;
    untilFree = parsed.values["until-free"] === true;
    intervalRaw = parsed.values.interval;
    timeoutRaw = parsed.values.timeout;
    positionals = parsed.positionals;
  } catch {
    io.error(`Unknown argument.\n${USAGE}`);
    return 1;
  }

  if (help) {
    io.log(helpText());
    return 0;
  }

  if (positionals[0] === "watch") {
    return commandWatch(positionals, { kill, yes, all, json, untilFree, intervalRaw, timeoutRaw }, deps, io);
  }

  if (intervalRaw !== undefined || untilFree || timeoutRaw !== undefined) {
    io.error(`--interval, --until-free, and --timeout are only for watch.\n${USAGE}`);
    return 1;
  }
  if (yes && !kill) {
    io.error(`--yes only applies to --kill.\n${USAGE}`);
    return 1;
  }
  if (positionals.length > 1) {
    io.error(USAGE);
    return 1;
  }

  const rawPort = positionals[0];
  let port: number | null = null;
  if (rawPort !== undefined) {
    try {
      port = parsePort(rawPort);
    } catch (error) {
      io.error(error instanceof PortError ? error.message : "Invalid port.");
      return 1;
    }
  }

  if (kill && port === null) {
    io.error(`--kill needs a port.\n${USAGE}`);
    return 1;
  }
  if (all && port !== null) {
    io.error(`Pass either a port or --all.\n${USAGE}`);
    return 1;
  }
  if (kill && all) {
    io.error(`--kill needs one port.\n${USAGE}`);
    return 1;
  }

  if (port === null && !kill) {
    const views = await loadViews(deps, null, io);
    if (views === null) return 1;
    if (json || all || !deps.isTTY) {
      io.log(json ? formatListenersJson(views) : formatTable(views, { color: deps.color, numbers: false }));
      return 0;
    }
    return interactive(views, deps, io);
  }

  if (port === null) {
    io.error(USAGE);
    return 1;
  }

  const views = await loadViews(deps, port, io);
  if (views === null) return 1;
  if (kill) return stopPort(port, views, deps, yes, io, json);
  io.log(json ? formatListenersJson(views, port) : formatPortReport(port, views, deps.color));
  return 0;
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
  main(process.argv.slice(2))
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(1);
    });
}
