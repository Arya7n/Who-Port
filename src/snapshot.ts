import type { ContainerInfo } from "./docker.js";
import { buildViews, type PortView } from "./inspect.js";
import type { ListenerQuery } from "./platform/types.js";
import type { ProcessDetails, ProjectFs } from "./resolve.js";

/** The same lookups `whoport` and `whoport ui` use to describe listeners. */
export interface SnapshotSource {
  listListeners: () => Promise<ListenerQuery>;
  readProcesses: (pids: readonly number[]) => Promise<Map<number, ProcessDetails>>;
  containers: () => Promise<Map<number, ContainerInfo>>;
  projectFs: ProjectFs;
  now: () => Date;
}

export interface PortSnapshot {
  views: PortView[];
  warnings: string[];
}

/**
 * Rows for every listener, or for one port.
 * `port === null` is `whoport --all`.
 */
export async function loadPortViews(source: SnapshotSource, port: number | null): Promise<PortSnapshot> {
  const query = await source.listListeners();
  const listeners = port === null ? query.listeners : query.listeners.filter((listener) => listener.port === port);
  const pids = [...new Set(listeners.map((listener) => listener.pid).filter((pid) => pid > 0))];
  const [details, containers] = await Promise.all([source.readProcesses(pids), source.containers()]);
  return {
    views: buildViews(listeners, details, containers, source.projectFs, source.now()),
    warnings: query.warnings,
  };
}
