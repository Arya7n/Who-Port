import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseNetstat, parseTasklist } from "../src/platform/win32.js";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

test("parses IPv4 listeners and ignores established, TIME_WAIT, and UDP rows", () => {
  const listeners = parseNetstat(fixture("win32-netstat.txt"));
  const ipv4 = listeners.filter((listener) => !listener.address.includes(":"));

  assert.deepEqual(
    ipv4.map((listener) => [listener.address, listener.port, listener.pid]),
    [
      ["0.0.0.0", 135, 1524],
      ["0.0.0.0", 445, 4],
      ["0.0.0.0", 6379, 5752],
      ["10.19.209.182", 139, 4],
    ],
  );
  assert.equal(listeners.some((listener) => listener.pid === 10408), false);
  assert.equal(listeners.some((listener) => listener.port === 1900), false);
});

test("parses IPv6 listeners from bracketed addresses", () => {
  const listeners = parseNetstat(fixture("win32-netstat.txt"));
  const ipv6 = listeners.filter((listener) => listener.address.includes(":"));

  assert.deepEqual(
    ipv6.map((listener) => [listener.address, listener.port, listener.pid, listener.protocol]),
    [
      ["::", 135, 1524, "tcp"],
      ["::", 6379, 5752, "tcp"],
      ["::1", 49669, 5504, "tcp"],
    ],
  );
});

test("keeps every listener when one port is bound more than once", () => {
  const listeners = parseNetstat(fixture("win32-netstat-multi.txt"));

  assert.deepEqual(
    listeners.map((listener) => [listener.address, listener.port, listener.pid]),
    [
      ["0.0.0.0", 3000, 22001],
      ["127.0.0.1", 3000, 18432],
      ["::", 3000, 22001],
    ],
  );
});

test("returns no listeners for header-only or empty output", () => {
  assert.deepEqual(parseNetstat(fixture("win32-netstat-empty.txt")), []);
  assert.deepEqual(parseNetstat(""), []);
  assert.deepEqual(parseNetstat("\r\n"), []);
});

test("skips malformed lines and still returns a valid one", () => {
  const listeners = parseNetstat(fixture("win32-netstat-malformed.txt"));
  assert.deepEqual(listeners, [
    {
      port: 3000,
      pid: 42,
      command: "",
      address: "127.0.0.1",
      protocol: "tcp",
    },
  ]);
});

test("parses CRLF netstat lines", () => {
  const listeners = parseNetstat(
    "Active Connections\r\n\r\n  TCP    127.0.0.1:4312         0.0.0.0:0              LISTENING       99\r\n",
  );
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0]?.port, 4312);
  assert.equal(listeners[0]?.pid, 99);
});

test("collapses a duplicated socket into one listener", () => {
  const line = "  TCP    127.0.0.1:9            0.0.0.0:0              LISTENING       7";
  const listeners = parseNetstat(`${line}\n${line}\n`);
  assert.equal(listeners.length, 1);
});

test("maps tasklist CSV rows, including image names with spaces", () => {
  const commands = parseTasklist(fixture("win32-tasklist.csv"));

  assert.equal(commands.get(0), "System Idle Process");
  assert.equal(commands.get(4), "System");
  assert.equal(commands.get(1020), "csrss.exe");
  assert.equal(commands.size, 6);
});

test("skips a tasklist header, blank lines, and rows without a numeric PID", () => {
  const commands = parseTasklist(
    [
      '"Image Name","PID","Session Name","Session#","Mem Usage"',
      "",
      "not a row",
      '"node.exe","nope","Console","1","1 K"',
      '"foo, bar.exe","15","Console","1","1 K"',
      '"say ""hi"".exe","16","Console","1","1 K"',
    ].join("\n"),
  );

  assert.equal(commands.has(0), false);
  assert.equal(commands.get(15), "foo, bar.exe");
  assert.equal(commands.get(16), 'say "hi".exe');
  assert.equal(commands.size, 2);
});

test("returns an empty map for empty tasklist output", () => {
  assert.equal(parseTasklist("").size, 0);
  assert.equal(parseTasklist("\r\n\r\n").size, 0);
});