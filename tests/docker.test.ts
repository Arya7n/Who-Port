import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { hostTcpPorts, parseDockerPs } from "../src/docker.js";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

test("maps captured IPv4 and IPv6 publishes onto one container per host port", () => {
  const containers = parseDockerPs(fixture("docker-ps.json"));

  assert.deepEqual(
    [...containers.keys()].sort((a, b) => a - b),
    [5432, 6380],
  );
  assert.deepEqual(containers.get(6380), {
    name: "patent-dev-redis-1",
    image: "redis:7-alpine",
    project: "patent-dev",
    service: "redis",
  });
  assert.deepEqual(containers.get(5432), {
    name: "patent-dev-postgres-1",
    image: "pgvector/pgvector:pg16",
    project: "patent-dev",
    service: "postgres",
  });
});

test("expands a published port range", () => {
  // Hand-written. This machine had no range publish; the Ports syntax is Docker's.
  const line = JSON.stringify({
    Names: "rangebox",
    Image: "example:dev",
    Labels: "com.docker.compose.project=demo,com.docker.compose.service=web",
    Ports: "0.0.0.0:8000-8002->8000-8002/tcp",
  });
  const containers = parseDockerPs(line);
  assert.equal(containers.size, 3);
  assert.equal(containers.get(8000)?.name, "rangebox");
  assert.equal(containers.get(8001)?.service, "web");
  assert.equal(containers.get(8002)?.project, "demo");
});

test("ignores containers that publish no ports, plus empty and malformed lines", () => {
  const output = [
    "not json",
    "",
    JSON.stringify({ Names: "quiet", Image: "example:dev", Labels: "", Ports: "" }),
    JSON.stringify({ Names: "udp-only", Image: "example:dev", Labels: "", Ports: "0.0.0.0:53->53/udp" }),
  ].join("\n");

  assert.equal(parseDockerPs(output).size, 0);
  assert.equal(parseDockerPs("").size, 0);
  assert.deepEqual(hostTcpPorts(""), []);
});
