import assert from "node:assert/strict";
import test from "node:test";

import { main } from "../src/cli.js";

function capture() {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    io: {
      log: (message: string) => {
        logs.push(message);
      },
      error: (message: string) => {
        errors.push(message);
      },
    },
  };
}

test("prints help and does not look up a port", async () => {
  const cap = capture();
  const code = await main(["--help"], cap.io);
  assert.equal(code, 0);
  assert.match(cap.logs.join("\n"), /Usage: whoport <port>/);
  assert.equal(cap.errors.length, 0);
});

test("rejects a missing port", async () => {
  const cap = capture();
  const code = await main([], cap.io);
  assert.equal(code, 1);
  assert.equal(cap.errors[0], "Usage: whoport <port>");
});

test("rejects an invalid port before spawning a tool", async () => {
  const cap = capture();
  const code = await main(["nope"], cap.io);
  assert.equal(code, 1);
  assert.match(cap.errors.join("\n"), /1 to 65535/);
  assert.equal(cap.logs.length, 0);
});

test("rejects an unknown flag", async () => {
  const cap = capture();
  const code = await main(["--json", "3000"], cap.io);
  assert.equal(code, 1);
  assert.match(cap.errors.join("\n"), /Unknown argument/);
});
