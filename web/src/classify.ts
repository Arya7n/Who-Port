import type { Listener } from "./types.js";

export type RowKind = "dev" | "docker" | "system";

export interface ViewFilter {
  dev: boolean;
  docker: boolean;
  system: boolean;
  query: string;
}

/** Dev and Docker are on. System is off until the user asks for it. */
export const DEFAULT_FILTER: ViewFilter = { dev: true, docker: true, system: false, query: "" };

export function rowKey(row: Pick<Listener, "port" | "pid">): string {
  return `${row.port}:${row.pid}`;
}

/** Docker wins over the forwarder's protected flag. Otherwise protected means system. */
export function rowKind(row: Pick<Listener, "docker" | "protected">): RowKind {
  if (row.docker) return "docker";
  if (row.protected) return "system";
  return "dev";
}

export function processName(row: Pick<Listener, "docker" | "command">): string {
  if (row.docker) return row.docker.name;
  return row.command.length > 0 ? row.command : "(unknown)";
}

/** Compose project/service for a container, otherwise the package or git name. */
export function projectLabel(row: Pick<Listener, "docker" | "project">): string | null {
  if (row.docker) {
    if (row.docker.project && row.docker.service) return `${row.docker.project}/${row.docker.service}`;
    return row.docker.project ?? row.docker.service;
  }
  return row.project?.name ?? null;
}

export function dockerStopCommand(row: Pick<Listener, "docker">): string | null {
  if (!row.docker) return null;
  return `docker stop ${row.docker.name}`;
}

export function isDashboardPort(rowPort: number, pagePort: number | null): boolean {
  return pagePort !== null && rowPort === pagePort;
}

export function counts(rows: readonly Listener[]): { dev: number; docker: number; system: number } {
  const tally = { dev: 0, docker: 0, system: 0 };
  for (const row of rows) tally[rowKind(row)] += 1;
  return tally;
}

function matchesQuery(row: Listener, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  const haystack = [
    String(row.port),
    processName(row),
    row.command,
    projectLabel(row) ?? "",
    row.docker?.name ?? "",
    row.project?.name ?? "",
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(needle);
}

function kindSelected(kind: RowKind, filter: ViewFilter): boolean {
  if (kind === "dev") return filter.dev;
  if (kind === "docker") return filter.docker;
  return filter.system;
}

/** Visible rows, sorted by port then pid so a poll does not reshuffle the table. */
export function visibleRows(rows: readonly Listener[], filter: ViewFilter): Listener[] {
  return rows
    .filter((row) => kindSelected(rowKind(row), filter) && matchesQuery(row, filter.query))
    .slice()
    .sort((a, b) => a.port - b.port || a.pid - b.pid);
}
