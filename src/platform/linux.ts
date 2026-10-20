import { ToolError } from "../errors.js";
import { runTool } from "./exec.js";
import { splitHostPort } from "./host.js";
import type { Listener, ListenerQuery } from "./types.js";

const USER = /\(\("([^"]*)",pid=(\d+),fd=\d+\)\)/g;

/**
 * Parse `ss -ltnpH`.
 * A socket with no `users:` entry is still listening; the pid is 0 because ss hid it.
 * Several processes on one socket become several listeners.
 */
export function parseSs(output: string): Listener[] {
  const listeners: Listener[] = [];
  const seen = new Set<string>();

  for (const line of output.split(/\r?\n/)) {
    if (!/\bLISTEN\b/i.test(line)) continue;
    const local = line
      .trim()
      .split(/\s+/)
      .find((token) => splitHostPort(token) !== null);
    if (!local) continue;
    const host = splitHostPort(local);
    if (!host) continue;

    const users = [...line.matchAll(USER)];
    const owners = users.length > 0 ? users : [null];
    for (const user of owners) {
      const pidText = user?.[2];
      const pid = pidText === undefined ? 0 : Number(pidText);
      const command = user?.[1] ?? "";
      const key = `${host.address}\0${host.port}\0${pid}\0${command}`;
      if (seen.has(key)) continue;
      seen.add(key);
      listeners.push({
        port: host.port,
        pid,
        command,
        address: host.address,
        protocol: "tcp",
      });
    }
  }

  return listeners;
}

export async function listLinuxListeners(): Promise<ListenerQuery> {
  const result = await runTool("ss", ["-ltnpH"]);
  if (!result.ok) {
    if (result.missing) {
      throw new ToolError("missing", "ss was not found. Install iproute2 and try again.");
    }
    if (result.denied) {
      throw new ToolError("failed", "Access denied while running ss. Try sudo.");
    }
    throw new ToolError("failed", `ss failed: ${result.message}`);
  }
  return { listeners: parseSs(result.stdout), warnings: [] };
}
