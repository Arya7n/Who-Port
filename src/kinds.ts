import type { ContainerInfo } from "./docker.js";
import type { ResolvedProject } from "./resolve.js";

export type RowKind = "dev" | "docker" | "system" | "unidentified";

export const UNIDENTIFIED_MESSAGE = "Couldn't identify this process. Try again.";

/**
 * Docker wins over the forwarder's protected flag. A row with no process name is
 * unidentified: protection is decided by name, so it must never look stoppable.
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
  return "dev";
}
