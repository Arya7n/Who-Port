import type { Listener, RowKind } from "./types.js";

export type { RowKind };

export const UNIDENTIFIED_TITLE = "Couldn't identify this process. Try again.";
export const OTHER_NOTE = "This is not a recognized dev process.";

export interface ViewFilter {
  dev: boolean;
  docker: boolean;
  other: boolean;
  system: boolean;
  query: string;
}

/** Dev and Docker are on. Other and System are off until the user asks for them. */
export const DEFAULT_FILTER: ViewFilter = { dev: true, docker: true, other: false, system: false, query: "" };

/** A dev row stops in one tap. Anything else that can be stopped asks first. */
export function needsConfirm(row: Pick<Listener, "kind">): boolean {
  return row.kind !== "dev";
}

export function rowKey(row: Pick<Listener, "port" | "pid">): string {
  return `${row.port}:${row.pid}`;
}

/** The server decides the kind, so the CLI and the dashboard agree. */
export function rowKind(row: Pick<Listener, "kind">): RowKind {
  return row.kind;
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

export type Tally = Record<RowKind, number>;

export function counts(rows: readonly Pick<Listener, "kind">[]): Tally {
  const tally: Tally = { dev: 0, docker: 0, other: 0, system: 0, unidentified: 0 };
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

/** An unidentified row may be a dev server or another app, so it shows with either chip. */
function kindSelected(kind: RowKind, filter: ViewFilter): boolean {
  if (kind === "unidentified") return filter.dev || filter.other;
  return filter[kind];
}

/** Visible rows, sorted by port then pid so a poll does not reshuffle the table. */
export function visibleRows(rows: readonly Listener[], filter: ViewFilter): Listener[] {
  return rows
    .filter((row) => kindSelected(rowKind(row), filter) && matchesQuery(row, filter.query))
    .slice()
    .sort((a, b) => a.port - b.port || a.pid - b.pid);
}
