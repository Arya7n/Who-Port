import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseSs } from "../src/platform/linux.js";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

// Hand-written. `ss` is not installed in this WSL, so the lines follow iproute2's `ss -ltnpH` layout.
test("parses IPv4, IPv6, a second owner, a hidden pid, and a legacy tcp line", () => {
  const listeners = parseSs(fixture("linux-ss.txt"));
  assert.deepEqual(
    listeners.map((listener) => [listener.address, listener.port, listener.pid, listener.command]),
    [
      ["127.0.0.1", 3000, 1234, "node"],
      ["::1", 3000, 1234, "node"],
      ["0.0.0.0", 3000, 2222, "node"],
      ["0.0.0.0", 5432, 0, ""],
      ["127.0.0.1", 80, 99, "nginx"],
    ],
  );
});

test("returns nothing for empty or malformed ss output", () => {
  assert.deepEqual(parseSs(""), []);
  assert.deepEqual(parseSs("not a socket table\nLISTEN\n"), []);
});
