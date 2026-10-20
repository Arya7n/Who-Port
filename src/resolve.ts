import { readFileSync, realpathSync, statSync } from "node:fs";
import { posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";

import { runTool } from "./platform/exec.js";
import { parseTasklist } from "./platform/win32.js";

export interface ProcessDetails {
  /** Image name. Windows reads it with the details; Linux and macOS take it from the listener tool. */
  name?: string | null;
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
  name: string | null;
  commandLine: string | null;
  executablePath: string | null;
  startTime: Date | null;
}

type PathApi = typeof win32;

/**
 * The -Command script is a constant. PIDs travel in the environment as integers
 * we already parsed, and each one is cast with [int] again before it reaches WQL,
 * so a port or a PID from argv cannot change the query text.
 * One WQL query asks only for the listening PIDs instead of enumerating every process.
 */
const CIM_SCRIPT = [
  "$ids = $env:WHOPORT_PIDS.Split(',') | ForEach-Object { 'ProcessId=' + [int]$_ }",
  "$q = 'SELECT ProcessId,Name,CommandLine,ExecutablePath,CreationDate FROM Win32_Process WHERE ' + ($ids -join ' OR ')",
  "Get-CimInstance -Query $q | Select-Object ProcessId,Name,CommandLine,ExecutablePath,CreationDate | ConvertTo-Json -Compress",
].join("; ");

/** PowerShell starts in about 2 s here and the query adds about 1.3 s. A loaded machine gets 8 s. */
const CIM_TIMEOUT_MS = 8_000;
const TASKLIST_TIMEOUT_MS = 5_000;

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

    const raw = pathFromToken(token);
    if (!isAbsolutePath(raw)) continue;
    // A package.json inside node_modules belongs to the dependency, not the app.
    const path = outsideNodeModules(raw);
    if (path.length === 0 || seen.has(path)) continue;
    seen.add(path);
    found.push(path);
  }

  return found;
}

function pathApi(start: string): PathApi {
  return start.startsWith("/") && !start.startsWith("//") ? posix : win32;
}

function pathFromToken(token: string): string {
  const stripped = stripTrailingJunk(token);
  if (!/^file:/i.test(stripped)) return stripped;
  try {
    const url = new URL(stripped);
    if (url.protocol !== "file:") return stripped;
    return fileURLToPath(url);
  } catch {
    return stripped;
  }
}

function hasNodeModules(dir: string, api: PathApi): boolean {
  return api.normalize(dir).split(api.sep).some((part) => part.toLowerCase() === "node_modules");
}

/** Parent of the first node_modules segment, so the walk starts at the app rather than the dependency. */
function outsideNodeModules(candidate: string): string {
  const api = pathApi(candidate);
  const normalized = api.normalize(candidate);
  const parts = normalized.split(api.sep);
  const at = parts.findIndex((part) => part.toLowerCase() === "node_modules");
  if (at < 0) return normalized;
  const modulesDir = parts.slice(0, at + 1).join(api.sep);
  const parent = api.dirname(modulesDir.length > 0 ? modulesDir : normalized);
  return parent.length > 0 ? parent : normalized;
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
  const searched = outsideNodeModules(start);
  const api = pathApi(searched);
  let current = fs.isDirectory(searched) ? searched : api.dirname(searched);
  const filesystemRoot = api.parse(api.normalize(current)).root;

  while (current.length > 0) {
    const normalized = api.normalize(current);
    if (!hasNodeModules(normalized, api)) {
      const packageName = readPackageName(fs.readFile(api.join(normalized, "package.json")));
      if (packageName) return { name: packageName, root: normalized };

      if (fs.exists(api.join(normalized, ".git"))) {
        const name = api.basename(normalized);
        if (name.length > 0) return { name, root: normalized };
      }
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
    name: asString(source.Name),
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

/** Names only, for when the CIM query fails. Without a name a row is unidentified and cannot be stopped. */
export function detailsFromTasklist(output: string, pids: readonly number[]): Map<number, ProcessDetails> {
  const names = parseTasklist(output);
  const details = new Map<number, ProcessDetails>();
  for (const pid of pids) {
    const name = names.get(pid);
    if (name === undefined) continue;
    details.set(pid, { name, commandLine: null, executablePath: null, startTime: null, cwd: null });
  }
  return details;
}

export async function readWindowsProcesses(pids: readonly number[]): Promise<Map<number, ProcessDetails>> {
  const details = new Map<number, ProcessDetails>();
  if (pids.length === 0) return details;

  const result = await runTool("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", CIM_SCRIPT], {
    env: { ...process.env, WHOPORT_PIDS: formatPidList(pids) },
    timeoutMs: CIM_TIMEOUT_MS,
  });
  if (!result.ok) {
    const tasklist = await runTool("tasklist", ["/FO", "CSV", "/NH"], { timeoutMs: TASKLIST_TIMEOUT_MS });
    return tasklist.ok ? detailsFromTasklist(tasklist.stdout, pids) : details;
  }

  for (const record of parseCimOutput(result.stdout)) {
    if (record.pid === null) continue;
    details.set(record.pid, {
      name: record.name,
      commandLine: record.commandLine,
      executablePath: record.executablePath,
      startTime: record.startTime,
      cwd: null,
    });
  }
  return details;
}

export type ProcessReader = (pids: readonly number[]) => Promise<Map<number, ProcessDetails>>;

/**
 * Reuse a pid's details for `ttlMs` so a poll only queries new pids.
 * A pid that came back without a name is not cached, so the next poll asks again.
 */
export function cacheProcessReads(read: ProcessReader, ttlMs: number, now: () => number = Date.now): ProcessReader {
  const cache = new Map<number, { at: number; details: ProcessDetails }>();
  return async (pids) => {
    const at = now();
    for (const [pid, entry] of cache) {
      if (at - entry.at >= ttlMs) cache.delete(pid);
    }
    const result = new Map<number, ProcessDetails>();
    const missing: number[] = [];
    for (const pid of pids) {
      const entry = cache.get(pid);
      if (entry) result.set(pid, entry.details);
      else missing.push(pid);
    }
    if (missing.length === 0) return result;

    const fresh = await read(missing);
    // Timed from the answer, not the request, so a slow lookup does not eat the ttl.
    const answeredAt = now();
    for (const [pid, details] of fresh) {
      result.set(pid, details);
      if (details.name) cache.set(pid, { at: answeredAt, details });
    }
    return result;
  };
}

export function readCwd(pid: number): string | null {
  if (!Number.isInteger(pid) || pid < 0) return null;
  try {
    return realpathSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

/** `ps -o etimes=` prints elapsed seconds, so uptime does not depend on the locale. */
export function parsePsEtimes(output: string): { elapsedSeconds: number; args: string } | null {
  const match = /^\s*(\d+)\s+([\s\S]*)$/.exec(output.trim());
  const seconds = match?.[1];
  const args = match?.[2];
  if (seconds === undefined || args === undefined) return null;
  return { elapsedSeconds: Number(seconds), args: args.trimEnd() };
}

/** macOS `ps -o etime=` is `[[dd-]hh:]mm:ss`, not a raw second count. */
export function etimeToSeconds(value: string): number | null {
  const withDays = /^(\d+)-(\d+):(\d+):(\d+)$/.exec(value);
  if (withDays?.[1] && withDays[2] && withDays[3] && withDays[4]) {
    return Number(withDays[1]) * 86400 + Number(withDays[2]) * 3600 + Number(withDays[3]) * 60 + Number(withDays[4]);
  }
  const hours = /^(\d+):(\d+):(\d+)$/.exec(value);
  if (hours?.[1] && hours[2] && hours[3]) {
    return Number(hours[1]) * 3600 + Number(hours[2]) * 60 + Number(hours[3]);
  }
  const minutes = /^(\d+):(\d+)$/.exec(value);
  if (minutes?.[1] && minutes[2]) return Number(minutes[1]) * 60 + Number(minutes[2]);
  return null;
}

export function parsePsEtime(output: string): { elapsedSeconds: number; args: string } | null {
  const match = /^\s*(\d+-\d+:\d+:\d+|\d+:\d+:\d+|\d+:\d+)\s+([\s\S]*)$/.exec(output.trim());
  const clock = match?.[1];
  const args = match?.[2];
  if (clock === undefined || args === undefined) return null;
  const elapsedSeconds = etimeToSeconds(clock);
  if (elapsedSeconds === null) return null;
  return { elapsedSeconds, args: args.trimEnd() };
}

/** `lsof -Fn` cwd lines look like `n/path`. */
export function parseLsofCwd(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("n") && line.length > 1) return line.slice(1);
  }
  return null;
}

function fromElapsed(elapsedSeconds: number, now: number): Date {
  return new Date(now - elapsedSeconds * 1000);
}

async function readOneUnix(
  pid: number,
  cwd: string | null,
  ps: { ok: true; stdout: string } | { ok: false },
  parse: (output: string) => { elapsedSeconds: number; args: string } | null,
  now: number,
): Promise<ProcessDetails> {
  const parsed = ps.ok ? parse(ps.stdout) : null;
  return {
    commandLine: parsed?.args ?? null,
    executablePath: null,
    startTime: parsed ? fromElapsed(parsed.elapsedSeconds, now) : null,
    cwd,
  };
}

export async function readLinuxProcesses(pids: readonly number[]): Promise<Map<number, ProcessDetails>> {
  const details = new Map<number, ProcessDetails>();
  const now = Date.now();
  for (const pid of pids) {
    if (!Number.isInteger(pid) || pid < 0) continue;
    const ps = await runTool("ps", ["-ww", "-o", "etimes=", "-o", "args=", "-p", String(pid)]);
    details.set(pid, await readOneUnix(pid, readCwd(pid), ps.ok ? ps : { ok: false }, parsePsEtimes, now));
  }
  return details;
}

export async function readDarwinProcesses(pids: readonly number[]): Promise<Map<number, ProcessDetails>> {
  const details = new Map<number, ProcessDetails>();
  const now = Date.now();
  for (const pid of pids) {
    if (!Number.isInteger(pid) || pid < 0) continue;
    const [cwdResult, ps] = await Promise.all([
      runTool("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]),
      runTool("ps", ["-ww", "-o", "etime=", "-o", "args=", "-p", String(pid)]),
    ]);
    const cwd = cwdResult.ok ? parseLsofCwd(cwdResult.stdout) : null;
    details.set(pid, await readOneUnix(pid, cwd, ps.ok ? ps : { ok: false }, parsePsEtime, now));
  }
  return details;
}

export async function readProcesses(pids: readonly number[]): Promise<Map<number, ProcessDetails>> {
  if (process.platform === "win32") return readWindowsProcesses(pids);
  if (process.platform === "darwin") return readDarwinProcesses(pids);
  if (process.platform === "linux") return readLinuxProcesses(pids);
  return new Map();
}
