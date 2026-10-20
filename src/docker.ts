import { runTool } from "./platform/exec.js";

export interface ContainerInfo {
  name: string;
  image: string;
  project: string | null;
  service: string | null;
}

const COMPOSE_PROJECT = "com.docker.compose.project";
const COMPOSE_SERVICE = "com.docker.compose.service";

/** A published range wider than this is ignored rather than turned into a huge table. */
const MAX_RANGE = 32;

const PORT_ENTRY =
  /^(?:\[(?<brack>[^\]]+)\]|(?<host>[^:\s]+)):(?<start>\d+)(?:-(?<end>\d+))?->\d+(?:-\d+)?\/(?<proto>tcp|udp)$/i;

function parseLabels(raw: string): Map<string, string> {
  const labels = new Map<string, string>();
  if (raw.length === 0) return labels;
  for (const part of raw.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    if (key.length === 0) continue;
    labels.set(key, part.slice(eq + 1).trim());
  }
  return labels;
}

function label(labels: Map<string, string>, key: string): string | null {
  const value = labels.get(key);
  if (value === undefined || value.length === 0) return null;
  return value;
}

/** Host TCP ports from one Docker `Ports` field. UDP and unparseable entries are skipped. */
export function hostTcpPorts(ports: string): number[] {
  const found: number[] = [];
  for (const raw of ports.split(",")) {
    const entry = raw.trim();
    if (entry.length === 0) continue;
    const match = PORT_ENTRY.exec(entry);
    const groups = match?.groups;
    if (!groups || groups.proto?.toLowerCase() !== "tcp") continue;
    const start = Number(groups.start);
    const end = groups.end === undefined ? start : Number(groups.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 65535 || end < start) continue;
    const count = end - start + 1;
    if (count > MAX_RANGE) continue;
    for (let port = start; port <= end; port += 1) found.push(port);
  }
  return found;
}

/**
 * One JSON object per line, as `docker ps --format '{{json .}}'` prints.
 * The same host port on IPv4 and IPv6 is one container, so the first mapping wins.
 */
export function parseDockerPs(output: string): Map<number, ContainerInfo> {
  const containers = new Map<number, ContainerInfo>();

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    let row: unknown;
    try {
      row = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof row !== "object" || row === null) continue;

    const source = row as Record<string, unknown>;
    const names = typeof source.Names === "string" ? source.Names : "";
    const name = names.split(",")[0]?.trim() ?? "";
    if (name.length === 0) continue;

    const labels = parseLabels(typeof source.Labels === "string" ? source.Labels : "");
    const info: ContainerInfo = {
      name,
      image: typeof source.Image === "string" ? source.Image : "",
      project: label(labels, COMPOSE_PROJECT),
      service: label(labels, COMPOSE_SERVICE),
    };

    const ports = typeof source.Ports === "string" ? source.Ports : "";
    for (const port of hostTcpPorts(ports)) {
      if (!containers.has(port)) containers.set(port, info);
    }
  }

  return containers;
}

/** Missing Docker or a stopped daemon is an empty map, not an error. */
export async function listContainers(): Promise<Map<number, ContainerInfo>> {
  const result = await runTool("docker", ["ps", "--format", "{{json .}}"]);
  if (!result.ok) return new Map();
  return parseDockerPs(result.stdout);
}
