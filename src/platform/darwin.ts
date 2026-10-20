import { ToolError } from "../errors.js";
import { runTool } from "./exec.js";
import { splitHostPort } from "./host.js";
import type { Listener, ListenerQuery } from "./types.js";

const LISTEN = /\bTCP\s+(\S+)\s+\(LISTEN\)\s*$/;

/** Parse `lsof -iTCP -sTCP:LISTEN -P -n`. The header and non-listen rows are skipped. */
export function parseLsof(output: string): Listener[] {
  const listeners: Listener[] = [];
  const seen = new Set<string>();

  for (const line of output.split(/\r?\n/)) {
    const match = LISTEN.exec(line.trim());
    const endpoint = match?.[1];
    if (!endpoint) continue;
    const host = splitHostPort(endpoint);
    if (!host) continue;

    const parts = line.trim().split(/\s+/);
    const command = parts[0] ?? "";
    const pidText = parts[1] ?? "";
    if (command === "COMMAND" || !/^\d+$/.test(pidText)) continue;

    const pid = Number(pidText);
    const key = `${host.address}\0${host.port}\0${pid}`;
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

  return listeners;
}

export async function listDarwinListeners(): Promise<ListenerQuery> {
  const result = await runTool("lsof", ["-iTCP", "-sTCP:LISTEN", "-P", "-n"]);
  if (!result.ok) {
    if (result.missing) throw new ToolError("missing", "lsof was not found.");
    if (result.denied) throw new ToolError("failed", "Access denied while running lsof. Try sudo.");
    throw new ToolError("failed", `lsof failed: ${result.message}`);
  }
  return { listeners: parseLsof(result.stdout), warnings: [] };
}
