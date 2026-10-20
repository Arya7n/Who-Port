/** The JSON body of GET /api/ports. Field names match `whoport --all --json`. */

export interface ProjectInfo {
  name: string;
  root: string;
}

export interface DockerInfo {
  name: string;
  image: string;
  project: string | null;
  service: string | null;
}

export type RowKind = "dev" | "docker" | "system" | "unidentified";

export interface Listener {
  port: number;
  pid: number;
  addresses: string[];
  command: string;
  commandLine: string | null;
  executablePath: string | null;
  startedAt: string | null;
  uptime: string | null;
  project: ProjectInfo | null;
  docker: DockerInfo | null;
  protected: boolean;
  kind: RowKind;
  verdict: string;
}

export interface PortsResponse {
  listeners: Listener[];
}

export interface KillResponse {
  ok: boolean;
  message: string;
}
