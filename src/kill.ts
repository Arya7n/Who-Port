import { runTool } from "./platform/exec.js";
import { parseTasklist } from "./platform/win32.js";

export type ControlReason = "denied" | "gone" | "invalid" | "failed";

export type ControlResult = { ok: true } | { ok: false; reason: ControlReason; message: string };

export interface ProcessRunner {
  terminate(pid: number): Promise<ControlResult>;
  force(pid: number): Promise<ControlResult>;
  running(pid: number): Promise<boolean>;
}

export interface StopResult {
  status: "stopped" | "still-running" | ControlReason;
  forced: boolean;
  message: string;
}

export interface StopOptions {
  force: boolean;
  waitMs: number;
  sleep: (ms: number) => Promise<void>;
}

const PROTECTED_NAMES = new Set([
  "system",
  "svchost.exe",
  "com.docker.backend.exe",
  "wslrelay.exe",
  "docker-proxy",
  "docker-proxy.exe",
]);

const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** System processes and Docker's own forwarders are not safe to taskkill. */
export function isProtectedProcess(pid: number, command: string): boolean {
  if (pid <= 4) return true;
  const base = command.trim().split(/[/\\]/).pop()?.toLowerCase() ?? "";
  return PROTECTED_NAMES.has(base);
}

export function isContainerName(name: string): boolean {
  return CONTAINER_NAME.test(name);
}

export function classifyTaskkill(exitCode: number | null, output: string): ControlResult {
  const text = output.replace(/\r/g, "").trim();
  if (exitCode === 0 && !/^error:/im.test(text)) return { ok: true };
  if (/not found/i.test(text) || exitCode === 128) {
    return { ok: false, reason: "gone", message: "The process was already gone." };
  }
  if (/access is denied/i.test(text)) {
    return {
      ok: false,
      reason: "denied",
      message: "Access denied. Open the terminal as Administrator and try again.",
    };
  }
  if (/invalid/i.test(text)) {
    return { ok: false, reason: "invalid", message: "That PID is not valid." };
  }
  return { ok: false, reason: "failed", message: text.length > 0 ? text : "taskkill failed." };
}

/**
 * Graceful taskkill, then optionally taskkill /F.
 * `running` is polled so a process that needs a moment to exit is not forced early.
 */
export async function stopProcess(pid: number, runner: ProcessRunner, options?: Partial<StopOptions>): Promise<StopResult> {
  const force = options?.force ?? false;
  const waitMs = options?.waitMs ?? 3_000;
  const sleep = options?.sleep ?? defaultSleep;

  const ended = await runner.terminate(pid);
  if (!ended.ok) return { status: ended.reason, forced: false, message: ended.message };

  let alive = await runner.running(pid);
  const deadline = Date.now() + waitMs;
  while (alive && Date.now() < deadline) {
    await sleep(Math.min(200, waitMs));
    alive = await runner.running(pid);
  }

  if (!alive) return { status: "stopped", forced: false, message: `Stopped PID ${pid}.` };
  if (!force) return { status: "still-running", forced: false, message: `PID ${pid} is still running.` };

  const forced = await runner.force(pid);
  if (forced.ok || (!forced.ok && forced.reason === "gone")) {
    return { status: "stopped", forced: true, message: `PID ${pid} did not exit. Forced it to stop.` };
  }
  return { status: forced.reason, forced: false, message: forced.message };
}

function rejectPid(pid: number): ControlResult | null {
  if (Number.isInteger(pid) && pid >= 0) return null;
  return { ok: false, reason: "invalid", message: "That PID is not valid." };
}

async function taskkill(pid: number, force: boolean): Promise<ControlResult> {
  const invalid = rejectPid(pid);
  if (invalid) return invalid;
  // The PID is an integer from netstat, passed as its own argv entry.
  const args = force ? ["/PID", String(pid), "/F"] : ["/PID", String(pid)];
  const result = await runTool("taskkill", args);
  if (result.ok) return classifyTaskkill(0, result.stdout);
  return classifyTaskkill(result.exitCode, result.message);
}

async function windowsRunning(pid: number): Promise<boolean> {
  const invalid = rejectPid(pid);
  if (invalid) return false;
  const result = await runTool("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
  // If we cannot check, assume it is still alive so we do not report a false success.
  if (!result.ok) return true;
  return parseTasklist(result.stdout).has(pid);
}

export const windowsRunner: ProcessRunner = {
  terminate: (pid) => taskkill(pid, false),
  force: (pid) => taskkill(pid, true),
  running: windowsRunning,
};

export async function dockerStop(name: string): Promise<ControlResult> {
  if (!isContainerName(name)) {
    return { ok: false, reason: "invalid", message: `Refusing to stop unexpected container name "${name}".` };
  }
  const result = await runTool("docker", ["stop", name]);
  if (result.ok) return { ok: true };
  if (result.missing) return { ok: false, reason: "failed", message: "docker was not found." };
  if (/no such container/i.test(result.message)) {
    return { ok: false, reason: "gone", message: `Container ${name} is already gone.` };
  }
  if (result.denied) {
    return { ok: false, reason: "denied", message: "Access denied while stopping the container." };
  }
  return { ok: false, reason: "failed", message: result.message };
}
