import { ToolError } from "../errors.js";
import { listDarwinListeners } from "./darwin.js";
import { listLinuxListeners } from "./linux.js";
import type { ListenerQuery } from "./types.js";
import { listWin32Listeners } from "./win32.js";

export async function listListeners(): Promise<ListenerQuery> {
  if (process.platform === "win32") return listWin32Listeners();
  if (process.platform === "linux") return listLinuxListeners();
  if (process.platform === "darwin") return listDarwinListeners();
  throw new ToolError("unsupported", `No adapter for ${process.platform}.`);
}

export async function listenersOnPort(port: number): Promise<ListenerQuery> {
  const query = await listListeners();
  return {
    listeners: query.listeners.filter((listener) => listener.port === port),
    warnings: query.warnings,
  };
}
