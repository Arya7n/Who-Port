import { readFileSync, realpathSync, statSync } from "node:fs";
import { posix, win32 } from "node:path";

import { runTool } from "./platform/exec.js";

export interface ProcessDetails {
  commandLine: string | null;
  executablePath: string | null;
  startTime: Date | null;
  /** Set on Linux and macOS from the process working directory. Windows CIM does not expose it. */
  cwd: string | null;
}

export interface ProjectFs {
  isDirectory(path: string): boolean;
  exists(path: string): boolean;
  readFile(path: string): string | null;
}

export interface ResolvedProject {
  name: string;
  root: string;
}

export interface CimRecord {
  pid: number | null;
  commandLine: string | null;
  executablePath: string | null;
  startTime: Date | null;
}

type PathApi = typeof win32;

/**
 * The -Command script is a constant. PIDs travel in the environment as integers
 * we already parsed, so a port or a PID from argv cannot change the script text.
 */
const CIM_SCRIPT = [
  "$want = $env:WHOPORT_PIDS.Split(',') | ForEach-Object { [int]$_ }",
  "Get-CimInstance Win32_Process | Where-Object { $want -contains [int]$_.ProcessId }",
  "| Select-Object ProcessId,CommandLine,ExecutablePath,CreationDate",
  "| ConvertTo-Json -Compress",
].join(" ");

export function formatPidList(pids: readonly number[]): string {
  const unique: number[] = [];
  const seen = new Set<number>();
  for (const pid of pids) {
    if (!Number.isInteger(pid) || pid < 0) {
      throw new Error(`Refusing to query invalid PID ${String(pid)}.`);
    }
    if (seen.has(pid)) continue;
    seen.add(pid);
    unique.push(pid);
  }
  return unique.join(",");
}

function isWindowsAbsolute(token: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(token) || /^\\\\[^\\]/.test(token);
}

function isPosixAbsolute(token: string): boolean {
  // A single slash plus a short letter run is a Windows switch (/F, /PID), not a path.
  if (!token.startsWith("/") || token.startsWith("//")) return false;
  if (/^\/[A-Za-z]{1,3}$/.test(token)) return false;
  return token.includes("/") && token.length > 1;
}

function isAbsolutePath(token: string): boolean {
  return isWindowsAbsolute(token) || isPosixAbsolute(token);
}

/** Drop a trailing glob or punctuation that Windows appends to an otherwise real path. */
function stripTrailingJunk(token: string): string {
  return token.replace(/[*",;]+$/g, "");
}

/**
 * Pull absolute paths out of a command line.
 * Relative tokens are skipped: there is no trustworthy directory to resolve them against.
 * A backslash does not escape quotes, because Windows paths are full of backslashes.
 */
export function extractPaths(commandLine: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const length = commandLine.length;
  let index = 0;

  while (index < length) {
    const ch = commandLine[index];
    if (ch === undefined) break;
    if (ch === " " || ch === "\t") {
      index += 1;
      continue;
    }

    let token = "";
    if (ch === '"') {
      index += 1;
      while (index < length && commandLine[index] !== '"') {
        token += commandLine[index];
        index += 1;
      }
      if (commandLine[index] === '"') index += 1;
    } else {
      while (index < length) {
        const next = commandLine[index];
        if (next === undefined || next === " " || next === "\t" || next === '"') break;
        token += next;
        index += 1;
      }
    }

    if (!isAbsolutePath(token)) continue;
    const path = stripTrailingJunk(token);
    if (path.length === 0 || seen.has(path)) continue;
    seen.add(path);
    found.push(path);
  }

  return found;
}

function pathApi(start: string): PathApi {
  return start.startsWith("/") && !start.startsWith("//") ? posix : win32;
}

function readPackageName(text: string | null): string | null {
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || !("name" in parsed)) return null;
    const name = parsed.name;
    if (typeof name !== "string") return null;
    const trimmed = name.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    // A broken package.json is not a project name. Keep walking.
    return null;
  }
}

/** Walk parents until a package.json with a name, or a .git directory, appears. */
export function findProjectRoot(start: string, fs: ProjectFs): ResolvedProject | null {
  const api = pathApi(start);
  let current = fs.isDirectory(start) ? start : api.dirname(start);
  const filesystemRoot = api.parse(api.normalize(current)).root;

  while (current.length > 0) {
    const normalized = api.normalize(current);
    const packageName = readPackageName(fs.readFile(api.join(normalized, "package.json")));
    if (packageName) return { name: packageName, root: normalized };

    if (fs.exists(api.join(normalized, ".git"))) {
      const name = api.basename(normalized);
      if (name.length > 0) return { name, root: normalized };
    }

    if (normalized === filesystemRoot) break;
    const parent = api.dirname(normalized);
    if (parent === normalized) break;
    current = parent;
  }

  return null;
}

function projectDepth(root: string): number {
  const api = pathApi(root);
  return api
    .normalize(root)
    .split(api.sep)
    .filter((part) => part.length > 0 && !/^[A-Za-z]:$/.test(part)).length;
}

function deepestProject(paths: readonly string[], fs: ProjectFs): ResolvedProject | null {
  let best: ResolvedProject | null = null;
  const seen = new Set<string>();
  for (const candidate of paths) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const found = findProjectRoot(candidate, fs);
    if (!found) continue;
    if (!best || projectDepth(found.root) > projectDepth(best.root)) best = found;
  }
  return best;
}

/**
 * Prefer the working directory when we have one.
 * Otherwise prefer a script path over the runtime binary: node.exe often sits in
 * a directory that itself has a package.json, which is not the app being served.
 */
export function resolveProject(
  input: Pick<ProcessDetails, "commandLine" | "executablePath" | "cwd">,
  fs: ProjectFs,
): ResolvedProject | null {
  if (input.cwd) {
    const fromCwd = findProjectRoot(input.cwd, fs);
    if (fromCwd) return fromCwd;
  }

  const commandPaths = input.commandLine ? extractPaths(input.commandLine) : [];
  const scripts = commandPaths.filter((candidate) => candidate !== input.executablePath);
  const fromCommand = deepestProject(scripts.length > 0 ? scripts : commandPaths, fs);
  if (fromCommand) return fromCommand;
  if (input.executablePath && isAbsolutePath(input.executablePath)) {
    return findProjectRoot(input.executablePath, fs);
  }
  return null;
}

/** Short age for the card. Future timestamps are clock skew, not negative uptime. */
export function formatUptime(startedAt: Date, now: Date): string {
  const elapsed = now.getTime() - startedAt.getTime();
  if (!Number.isFinite(elapsed) || elapsed < 5_000) return "just now";

  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

/** Windows PowerShell 5.1 emits `\/Date(ms)\/`. Newer hosts may emit an ISO string. */
export function parseCimDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const match = /\/Date\((-?\d+)(?:[+-]\d+)?\)\//.exec(value);
  const millis = match?.[1];
  if (millis !== undefined) {
    const parsed = Number(millis);
    if (!Number.isFinite(parsed)) return null;
    return new Date(parsed);
  }
  const iso = Date.parse(value);
  if (Number.isNaN(iso)) return null;
  return new Date(iso);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asPid(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return value;
}

function recordFromRow(row: unknown): CimRecord | null {
  if (typeof row !== "object" || row === null) return null;
  const source = row as Record<string, unknown>;
  return {
    pid: asPid(source.ProcessId),
    commandLine: asString(source.CommandLine),
    executablePath: asString(source.ExecutablePath),
    startTime: parseCimDate(source.CreationDate),
  };
}

export function parseCimOutput(output: string): CimRecord[] {
  const trimmed = output.trim();
  if (trimmed.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const records: CimRecord[] = [];
    for (const row of rows) {
      const record = recordFromRow(row);
      if (record) records.push(record);
    }
    return records;
  } catch {
    return [];
  }
}

export const nodeProjectFs: ProjectFs = {
  isDirectory(path: string): boolean {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  exists(path: string): boolean {
    try {
      statSync(path);
      return true;
    } catch {
      return false;
    }
  },
  readFile(path: string): string | null {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
};

export async function readWindowsProcesses(pids: readonly number[]): Promise<Map<number, ProcessDetails>> {
  const details = new Map<number, ProcessDetails>();
  if (pids.length === 0) return details;

  const result = await runTool("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", CIM_SCRIPT], {
    env: { ...process.env, WHOPORT_PIDS: formatPidList(pids) },
  });
  if (!result.ok) return details;

  for (const record of parseCimOutput(result.stdout)) {
    if (record.pid === null) continue;
    details.set(record.pid, {
      commandLine: record.commandLine,
      executablePath: record.executablePath,
      startTime: record.startTime,
      cwd: null,
    });
  }
  return details;
}

export function readCwd(pid: number): string | null {
  if (!Number.isInteger(pid) || pid < 0) return null;
  try {
    return realpathSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}
