import assert from "node:assert/strict";
import test from "node:test";

import {
  counts,
  DEFAULT_FILTER,
  dockerStopCommand,
  processName,
  projectLabel,
  rowKind,
  visibleRows,
} from "../web/src/classify.ts";
import type { Listener } from "../web/src/types.ts";

function row(overrides: Partial<Listener> = {}): Listener {
  return {
    port: 3000,
    pid: 10,
    addresses: ["127.0.0.1"],
    command: "node.exe",
    commandLine: null,
    executablePath: null,
    startedAt: null,
    uptime: "1m ago",
    project: { name: "whoport", root: "C:\\Users\\Aryan\\code\\Who-Port" },
    docker: null,
    protected: false,
    kind: "dev",
    verdict: "Looks like node.exe from whoport. Safe to stop.",
    ...overrides,
  };
}

const docker = row({
  port: 5432,
  pid: 4,
  command: "com.docker.backend.exe",
  project: null,
  protected: true,
  kind: "docker",
  docker: { name: "patent-dev-postgres-1", image: "pgvector/pgvector:pg16", project: "patent-dev", service: "postgres" },
});

const system = row({
  port: 135,
  pid: 1524,
  command: "svchost.exe",
  project: null,
  protected: true,
  kind: "system",
  commandLine: null,
  verdict: "svchost.exe is a system process.",
});

const nameless = row({ port: 8080, pid: 7000, command: "", project: null, kind: "unidentified" });

test("row kind comes from the server", () => {
  assert.equal(rowKind(docker), "docker");
  assert.equal(rowKind(system), "system");
  assert.equal(rowKind(row()), "dev");
  assert.equal(rowKind(nameless), "unidentified");
});

test("an unidentified row stays visible with Dev and is counted on its own", () => {
  const rows = [row(), nameless, system];
  assert.deepEqual(counts(rows), { dev: 1, docker: 0, system: 1, unidentified: 1 });
  assert.deepEqual(
    visibleRows(rows, DEFAULT_FILTER).map((item) => item.port),
    [3000, 8080],
  );
  assert.equal(processName(nameless), "(unknown)");
});

test("labels name the container and the compose project, never the forwarder", () => {
  assert.equal(processName(docker), "patent-dev-postgres-1");
  assert.equal(projectLabel(docker), "patent-dev/postgres");
  assert.equal(dockerStopCommand(docker), "docker stop patent-dev-postgres-1");
  assert.equal(projectLabel(row()), "whoport");
  assert.equal(projectLabel(system), null);
});

test("default view keeps dev and docker and hides system", () => {
  const rows = [system, row({ port: 4000 }), docker];
  assert.deepEqual(counts(rows), { dev: 1, docker: 1, system: 1, unidentified: 0 });
  assert.deepEqual(
    visibleRows(rows, DEFAULT_FILTER).map((item) => item.port),
    [4000, 5432],
  );
  assert.deepEqual(
    visibleRows(rows, { ...DEFAULT_FILTER, query: "svchost" }).map((item) => item.port),
    [],
  );
  assert.deepEqual(
    visibleRows(rows, { dev: false, docker: true, system: true, query: "135" }).map((item) => item.port),
    [135],
  );
  assert.deepEqual(
    visibleRows(rows, { ...DEFAULT_FILTER, query: "patent-dev-postgres-1" }).map((item) => item.port),
    [5432],
  );
});
