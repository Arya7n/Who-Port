import type { ContainerInfo } from "./docker.js";
import type { ResolvedProject } from "./resolve.js";

export type RowKind = "dev" | "docker" | "other" | "system" | "unidentified";

export const UNIDENTIFIED_MESSAGE = "Couldn't identify this process. Try again.";

/** Matched without `.exe`. */
const DEV_RUNTIMES = new Set([
  "node",
  "deno",
  "bun",
  "python",
  "python3",
  "pythonw",
  "java",
  "javaw",
  "go",
  "ruby",
  "php",
  "dotnet",
  "redis-server",
  "mongod",
  "postgres",
  "mysqld",
]);

export function isDevRuntime(command: string): boolean {
  const base = command.split(/[/\\]/).pop() ?? "";
  const name = base.toLowerCase().replace(/\.exe$/, "");
  return DEV_RUNTIMES.has(name) || /^python3\.\d+$/.test(name);
}

/**
 * Docker wins over the forwarder's protected flag. Protection is decided by name,
 * so a row without one is unidentified and must never look stoppable.
 */
export function rowKind(view: {
  docker: ContainerInfo | null;
  protected: boolean;
  command: string;
  project: ResolvedProject | null;
}): RowKind {
  if (view.docker) return "docker";
  if (view.protected) return "system";
  if (view.command.length === 0) return "unidentified";
  if (view.project || isDevRuntime(view.command)) return "dev";
  return "other";
}
