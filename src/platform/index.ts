import { ToolError } from "../errors.js";
import type { ListenerQuery } from "./types.js";
import { listWin32Listeners } from "./win32.js";

export async function listListeners(): Promise<ListenerQuery> {
  if (process.platform === "win32") {
    return listWin32Listeners();
  }
  throw new ToolError(
    "unsupported",
    `No adapter for ${process.platform} yet. This build looks up listeners on Windows only.`,
  );
}

export async function listenersOnPort(port: number): Promise<ListenerQuery> {
  const query = await listListeners();
  return {
    listeners: query.listeners.filter((listener) => listener.port === port),
    warnings: query.warnings,
  };
}
