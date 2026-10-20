import assert from "node:assert/strict";
import test from "node:test";

import { parsePort, PortError } from "../src/port.js";

test("accepts the ends of the TCP port range", () => {
  assert.equal(parsePort("1"), 1);
  assert.equal(parsePort("80"), 80);
  assert.equal(parsePort("65535"), 65535);
});

test("rejects values that are not a canonical port", () => {
  for (const raw of ["0", "65536", "99999", "", "abc", "3000.5", "-1", "1e3", "08", " 3000", "3000 ", "0x50"]) {
    assert.throws(() => parsePort(raw), PortError);
  }
});
