import assert from "node:assert/strict";
import test from "node:test";

import { decodeToolOutput } from "../src/platform/exec.js";

test("decodes ASCII tool output as utf8", () => {
  const text = decodeToolOutput(Buffer.from("TCP    127.0.0.1:3000\r\n", "utf8"));
  assert.equal(text, "TCP    127.0.0.1:3000\r\n");
});

test("decodes a UTF-16 LE BOM the way a piped Windows tool may emit it", () => {
  const body = Buffer.from("node.exe", "utf16le");
  const withBom = Buffer.concat([Buffer.from([0xff, 0xfe]), body]);
  assert.equal(decodeToolOutput(withBom), "node.exe");
});

test("decodes UTF-16 LE without a BOM when ASCII bytes are NUL-padded", () => {
  assert.equal(decodeToolOutput(Buffer.from("LISTENING", "utf16le")), "LISTENING");
});
