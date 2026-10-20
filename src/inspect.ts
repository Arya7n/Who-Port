import type { ContainerInfo } from "./docker.js";
import { isProtectedProcess } from "./kill.js";
import type { Listener } from "./platform/types.js";
import {
  formatUptime,
  resolveProject,
  type ProcessDetails,
  type ProjectFs,
  type ResolvedProject,
} from "./resolve.js";

export interface PortView {
  port: number;
  pid: number;
  addresses: string[];
  command: string;
  commandLine: string | null;
  executablePath: string | null;
  startedAt: string | null;
  uptime: string | null;
  project: ResolvedProject | null;
  docker: ContainerInfo | null;
  protected: boolean;
  verdict: string;
}

const STALE_MS = 60 * 60 * 1000;

export function processLabel(view: Pick<PortView, "docker" | "command">): string {
  if (view.docker) return view.docker.name;
  return view.command.length > 0 ? view.command : "(unknown)";
}

export function projectLabel(view: Pick<PortView, "docker" | "project">): string {
  if (view.docker) {
    if (view.docker.project && view.docker.service) return `${view.docker.project}/${view.docker.service}`;
    return view.docker.project ?? view.docker.service ?? view.docker.name;
  }
  return view.project?.name ?? "unknown";
}

export function describeVerdict(view: Omit<PortView, "verdict">, now: Date): string {
  if (view.docker) {
    const compose =
      view.docker.project && view.docker.service
        ? `, compose ${view.docker.project}/${view.docker.service}`
        : view.docker.project
          ? `, compose ${view.docker.project}`
          : view.docker.service
            ? `, compose ${view.docker.service}`
            : "";
    const image = view.docker.image.length > 0 ? ` (${view.docker.image})` : "";
    return `Docker container ${view.docker.name}${image}${compose}. Stop it with docker stop ${view.docker.name}.`;
  }

  if (view.pid === 0) return "The OS did not name the process holding this port.";

  const name = view.command.length > 0 ? view.command : "(unknown)";
  if (view.protected) {
    return `${name} is a system process (PID ${view.pid}). Stopping it can take down the machine.`;
  }

  const age = view.startedAt === null ? Number.NaN : now.getTime() - Date.parse(view.startedAt);
  const when = view.uptime ? ` (${view.uptime})` : "";
  if (view.project) {
    const lead = Number.isFinite(age) && age >= STALE_MS ? "Looks like a stale" : "Looks like";
    return `${lead} ${name} from ${view.project.name}${when}. Safe to stop.`;
  }
  return `Looks like ${name} (PID ${view.pid}). Project unknown. Check the command before stopping.`;
}

function imageName(listener: Listener, info: ProcessDetails | null): string {
  if (listener.command.length > 0) return listener.command;
  const base = info?.executablePath?.split(/[/\\]/).pop();
  return base && base.length > 0 ? base : "";
}

/**
 * One row per owner. IPv4 and IPv6 publishes of the same container are one row,
 * because killing either address is the same `docker stop`.
 */
export function buildViews(
  listeners: readonly Listener[],
  details: ReadonlyMap<number, ProcessDetails>,
  containers: ReadonlyMap<number, ContainerInfo>,
  fs: ProjectFs,
  now: Date,
  systemRoot?: string | null,
): PortView[] {
  const groups = new Map<string, { listener: Listener; addresses: Set<string> }>();

  for (const listener of listeners) {
    const docker = containers.get(listener.port);
    const key = docker ? `docker:${listener.port}:${docker.name}` : `pid:${listener.port}:${listener.pid}`;
    const existing = groups.get(key);
    if (existing) {
      existing.addresses.add(listener.address);
      continue;
    }
    groups.set(key, { listener, addresses: new Set([listener.address]) });
  }

  const views: PortView[] = [];
  for (const group of groups.values()) {
    const listener = group.listener;
    const docker = containers.get(listener.port) ?? null;
    const info = details.get(listener.pid) ?? null;
    const project = docker || info === null ? null : resolveProject(info, fs);
    const command = imageName(listener, info);
    const partial = {
      port: listener.port,
      pid: listener.pid,
      addresses: [...group.addresses].sort(),
      command,
      commandLine: docker ? null : (info?.commandLine ?? null),
      executablePath: docker ? null : (info?.executablePath ?? null),
      startedAt: info?.startTime ? info.startTime.toISOString() : null,
      uptime: info?.startTime ? formatUptime(info.startTime, now) : null,
      project,
      docker,
      protected: isProtectedProcess(listener.pid, command, info?.executablePath ?? null, systemRoot),
    };
    views.push({ ...partial, verdict: describeVerdict(partial, now) });
  }

  views.sort((a, b) => a.port - b.port || a.pid - b.pid);
  return views;
}

export type KillTarget =
  | { kind: "none" }
  | { kind: "mixed" }
  | { kind: "docker"; name: string }
  | { kind: "process"; pid: number; command: string; protected: boolean };

/** One port may be two addresses of one owner, or two owners. Only the first is safe to stop in one step. */
export function sharedTarget(views: readonly PortView[]): KillTarget {
  if (views.length === 0) return { kind: "none" };
  const dockerNames = new Set(views.flatMap((view) => (view.docker ? [view.docker.name] : [])));
  const pids = new Set(views.map((view) => view.pid));
  if (views.every((view) => view.docker !== null) && dockerNames.size === 1) {
    const name = [...dockerNames][0];
    if (name === undefined) return { kind: "mixed" };
    return { kind: "docker", name };
  }
  if (dockerNames.size === 0 && pids.size === 1) {
    const view = views[0];
    if (!view) return { kind: "none" };
    return { kind: "process", pid: view.pid, command: processLabel(view), protected: view.protected };
  }
  return { kind: "mixed" };
}
