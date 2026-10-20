import { processLabel, projectLabel, type PortView } from "./inspect.js";
import { dim } from "./report.js";

export interface WatchOwner {
  pid: number;
  name: string;
  project: string | null;
}

/** Empty `owners` means nothing is listening. */
export interface WatchState {
  owners: WatchOwner[];
}

export type WatchEvent = { type: "freed" } | { type: "taken"; owners: WatchOwner[] };

const DEFAULT_INTERVAL_MS = 1000;
const MIN_INTERVAL_MS = 500;

function sorted(owners: readonly WatchOwner[]): WatchOwner[] {
  return [...owners].sort(
    (a, b) => a.pid - b.pid || a.name.localeCompare(b.name) || (a.project ?? "").localeCompare(b.project ?? ""),
  );
}

function sameOwner(a: WatchOwner, b: WatchOwner): boolean {
  return a.pid === b.pid && a.name === b.name && a.project === b.project;
}

/**
 * One event per real change. The same owner on the next tick is null,
 * so the poll loop does not print once a second.
 */
export function diffState(prev: WatchState, next: WatchState): WatchEvent | null {
  const before = sorted(prev.owners);
  const after = sorted(next.owners);
  if (before.length === 0 && after.length === 0) return null;
  if (before.length > 0 && after.length === 0) return { type: "freed" };
  if (before.length === after.length && before.every((owner, index) => sameOwner(owner, after[index]!))) return null;
  return { type: "taken", owners: after };
}

export function snapshotFromViews(views: readonly PortView[]): WatchState {
  return {
    owners: views.map((view) => {
      const name = processLabel(view);
      const project = view.docker ? projectLabel(view) : (view.project?.name ?? null);
      return {
        pid: view.pid,
        name,
        // The compose label repeats the container name when there is no project/service.
        project: project === name ? null : project,
      };
    }),
  };
}

export function parseInterval(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_INTERVAL_MS;
  if (!/^\d+$/.test(raw)) throw new Error("Interval must be a whole number of milliseconds.");
  const ms = Number(raw);
  if (ms < MIN_INTERVAL_MS) throw new Error(`Interval must be at least ${MIN_INTERVAL_MS} ms.`);
  return ms;
}

export function parseTimeoutSeconds(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  if (!/^\d+$/.test(raw)) throw new Error("Timeout must be a whole number of seconds.");
  return Number(raw) * 1000;
}

function stamp(time: Date): string {
  const hours = String(time.getHours()).padStart(2, "0");
  const minutes = String(time.getMinutes()).padStart(2, "0");
  const seconds = String(time.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function describeOwners(owners: readonly WatchOwner[]): string {
  return owners
    .map((owner) => {
      const project = owner.project ? `, ${owner.project}` : "";
      return `${owner.name} (pid ${owner.pid}${project})`;
    })
    .join(" and ");
}

export function formatWatchLine(
  time: Date,
  port: number,
  mode: "held" | "free" | "now-free" | "taken",
  owners: readonly WatchOwner[],
  color: boolean,
): string {
  const clock = dim(color, stamp(time));
  const body =
    mode === "free"
      ? `port ${port} is free`
      : mode === "now-free"
        ? `port ${port} is now free`
        : mode === "held"
          ? `port ${port} is held by ${describeOwners(owners)}`
          : `port ${port} taken by ${describeOwners(owners)}`;
  return `${clock}  ${body}`;
}

export interface WatchLoop {
  port: number;
  intervalMs: number;
  untilFree: boolean;
  timeoutMs: number | null;
  color: boolean;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  signal: AbortSignal;
  sample: () => Promise<WatchState | null>;
  log: (line: string) => void;
}

function timedOut(started: number, timeoutMs: number | null, now: () => Date): boolean {
  return timeoutMs !== null && now().getTime() - started >= timeoutMs;
}

/** Poll until the caller aborts, the port frees, or the timeout elapses. */
export async function watchPort(loop: WatchLoop): Promise<number> {
  const started = loop.now().getTime();
  const initial = await loop.sample();
  if (initial === null) return 1;

  const opening = initial.owners.length === 0 ? "free" : "held";
  loop.log(formatWatchLine(loop.now(), loop.port, opening, initial.owners, loop.color));
  if (loop.untilFree && initial.owners.length === 0) return 0;
  if (timedOut(started, loop.timeoutMs, loop.now)) return 1;

  let state = initial;
  while (!loop.signal.aborted) {
    if (timedOut(started, loop.timeoutMs, loop.now)) return 1;
    await loop.sleep(loop.intervalMs);
    if (loop.signal.aborted) return 0;

    const next = await loop.sample();
    if (next === null) return 1;
    const event = diffState(state, next);
    state = next;
    if (event) {
      const mode = event.type === "freed" ? "now-free" : "taken";
      const owners = event.type === "taken" ? event.owners : [];
      loop.log(formatWatchLine(loop.now(), loop.port, mode, owners, loop.color));
      if (loop.untilFree && event.type === "freed") return 0;
    }
    if (timedOut(started, loop.timeoutMs, loop.now)) return 1;
  }
  return 0;
}
