import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseLsof } from "../src/platform/darwin.js";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

// Hand-written. lsof truncates COMMAND, so "com.docke" is that short field, not a resolved name.
test("parses IPv4, IPv6, a wildcard bind, and a second listener on the same port", () => {
  const listeners = parseLsof(fixture("darwin-lsof.txt"));
  assert.deepEqual(
    listeners.map((listener) => [listener.command, listener.pid, listener.address, listener.port]),
    [
      ["node", 1234, "127.0.0.1", 3000],
      ["node", 1234, "::1", 3000],
      ["node", 2222, "*", 3000],
      ["com.docke", 5678, "127.0.0.1", 5432],
    ],
  );
});

test("returns nothing for empty or header-only lsof output", () => {
  assert.deepEqual(parseLsof(""), []);
  assert.deepEqual(parseLsof("COMMAND   PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\n"), []);
});
