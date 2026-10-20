import { ToolError } from "../errors.js";
import { runTool } from "./exec.js";
import { splitHostPort } from "./host.js";
import type { Listener, ListenerQuery } from "./types.js";

const TCP_LISTEN_FIELDS = 5;

function parseNetstatLine(line: string): Listener | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length < TCP_LISTEN_FIELDS) return null;

  const proto = parts[0];
  const local = parts[1];
  const state = parts[3];
  const pidText = parts[4];
  if (!proto || !local || !state || !pidText) return null;

  // EADDRINUSE is a TCP bind failure. UDP rows have no LISTENING state, and
  // established or TIME_WAIT rows are not holding the port for a new bind.
  if (proto.toUpperCase() !== "TCP" || state.toUpperCase() !== "LISTENING") return null;
  if (!/^\d+$/.test(pidText)) return null;

  const host = splitHostPort(local);
  if (!host) return null;

  return {
    port: host.port,
    pid: Number(pidText),
    command: "",
    address: host.address,
    protocol: "tcp",
  };
}

/** Parse `netstat -ano`. Malformed lines are skipped so one bad row cannot blank the report. */
export function parseNetstat(output: string): Listener[] {
  const listeners: Listener[] = [];
  const seen = new Set<string>();

  for (const line of output.split(/\r?\n/)) {
    const listener = parseNetstatLine(line);
    if (!listener) continue;
    // The same socket can show up twice if output is concatenated. It is still one owner.
    const key = `${listener.address}\0${listener.port}\0${listener.pid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    listeners.push(listener);
  }

  return listeners;
}

/** Parse one tasklist CSV row. Quoted fields are required because image names contain spaces. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === undefined) break;

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  fields.push(current);
  return fields;
}

/** Parse `tasklist /FO CSV`. Returns PID to image name. Unreadable rows are skipped. */
export function parseTasklist(output: string): Map<number, string> {
  const commands = new Map<number, string>();

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const fields = parseCsvLine(trimmed);
    const image = fields[0]?.trim() ?? "";
    const pidText = fields[1]?.trim() ?? "";
    if (image.length === 0 || image === "Image Name") continue;
    if (!/^\d+$/.test(pidText)) continue;

    commands.set(Number(pidText), image);
  }

  return commands;
}

export function withCommands(listeners: readonly Listener[], commands: ReadonlyMap<number, string>): Listener[] {
  return listeners.map((listener) => ({
    ...listener,
    command: commands.get(listener.pid) ?? "",
  }));
}

/**
 * netstat only. Image names come with the process details (one CIM query for the
 * listening PIDs), which is much faster than `tasklist` listing every process.
 */
export async function listWin32Listeners(): Promise<ListenerQuery> {
  const netstat = await runTool("netstat", ["-ano"]);
  if (!netstat.ok) {
    if (netstat.missing) {
      throw new ToolError(
        "missing",
        "netstat was not found on PATH. It ships with Windows; check that C:\\Windows\\System32 is on PATH.",
      );
    }
    if (netstat.denied) {
      throw new ToolError(
        "failed",
        "Access denied while running netstat. Open the terminal as Administrator and try again.",
      );
    }
    throw new ToolError("failed", `netstat failed: ${netstat.message}`);
  }

  return { listeners: parseNetstat(netstat.stdout), warnings: [] };
}
