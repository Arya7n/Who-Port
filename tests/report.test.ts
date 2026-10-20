import assert from "node:assert/strict";
import test from "node:test";

import { formatPortReport } from "../src/report.js";
import type { Listener } from "../src/platform/types.js";

function listener(overrides: Partial<Listener>): Listener {
  return {
    port: 3000,
    pid: 10,
    command: "node.exe",
    address: "127.0.0.1",
    protocol: "tcp",
    ...overrides,
  };
}

test("says when a port is free", () => {
  assert.equal(formatPortReport(3000, []), "port 3000 is free");
});

test("prints one listener as a plain block", () => {
  const text = formatPortReport(3000, [listener({})]);
  assert.equal(
    text,
    ["port 3000", "", "pid       10", "command   node.exe", "address   127.0.0.1", "protocol  tcp"].join("\n"),
  );
});

test("prints unknown commands and every listener on a shared port", () => {
  const text = formatPortReport(3000, [
    listener({ pid: 18432, address: "127.0.0.1", command: "" }),
    listener({ pid: 22001, address: "0.0.0.0", command: "node.exe" }),
  ]);

  assert.match(text, /^port 3000\n2 listeners/);
  assert.match(text, /command   \(unknown\)/);
  assert.ok(text.indexOf("0.0.0.0") < text.indexOf("127.0.0.1"));
});
