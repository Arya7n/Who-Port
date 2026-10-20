import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyTaskkill,
  createPosixRunner,
  isContainerName,
  isProtectedProcess,
  stopProcess,
  type ControlResult,
  type ProcessRunner,
} from "../src/kill.js";

function runner(behavior: {
  terminate: ControlResult;
  running?: boolean[];
  force?: ControlResult;
}): ProcessRunner & { forced: number } {
  const running = [...(behavior.running ?? [])];
  const state = { forced: 0 };
  return {
    get forced() {
      return state.forced;
    },
    async terminate() {
      return behavior.terminate;
    },
    async force() {
      state.forced += 1;
      return behavior.force ?? { ok: true };
    },
    async running() {
      return running.shift() ?? false;
    },
  };
}

test("stops when the process exits after a graceful taskkill", async () => {
  const fake = runner({ terminate: { ok: true }, running: [false] });
  const result = await stopProcess(18432, fake, { force: true, waitMs: 0, sleep: async () => {} });
  assert.deepEqual(result, { status: "stopped", forced: false, message: "Stopped PID 18432." });
  assert.equal(fake.forced, 0);
});

test("escalates to a forced stop when the process stays up", async () => {
  const fake = runner({ terminate: { ok: true }, running: [true], force: { ok: true } });
  const result = await stopProcess(18432, fake, { force: true, waitMs: 0, sleep: async () => {} });
  assert.equal(result.status, "stopped");
  assert.equal(result.forced, true);
  assert.match(result.message, /Forced it to stop/);
  assert.equal(fake.forced, 1);
});

test("does not force a process that is still running unless asked", async () => {
  const fake = runner({ terminate: { ok: true }, running: [true] });
  const result = await stopProcess(18432, fake, { force: false, waitMs: 0, sleep: async () => {} });
  assert.equal(result.status, "still-running");
  assert.equal(fake.forced, 0);
});

test("reports access denied without forcing", async () => {
  const fake = runner({
    terminate: { ok: false, reason: "denied", message: "Access denied. Open the terminal as Administrator and try again." },
  });
  const result = await stopProcess(4, fake, { force: true, waitMs: 0, sleep: async () => {} });
  assert.equal(result.status, "denied");
  assert.match(result.message, /Administrator/);
  assert.equal(fake.forced, 0);
});

test("reports a process that is already gone", async () => {
  const fake = runner({
    terminate: { ok: false, reason: "gone", message: "The process was already gone." },
  });
  const result = await stopProcess(18432, fake, { force: true, waitMs: 0, sleep: async () => {} });
  assert.equal(result.status, "gone");
  assert.equal(fake.forced, 0);
});

test("classifies taskkill failures", () => {
  assert.equal(classifyTaskkill(0, "SUCCESS: The process with PID 12 has been terminated.").ok, true);
  assert.equal(classifyTaskkill(128, 'ERROR: The process "12" not found.').ok && false, false);
  const missing = classifyTaskkill(128, 'ERROR: The process "12" not found.');
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.reason, "gone");
  const denied = classifyTaskkill(1, "ERROR: Access is denied.");
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.reason, "denied");
  const invalid = classifyTaskkill(1, "ERROR: Invalid argument/option - 'PID'.");
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.reason, "invalid");
});

test("treats Windows system images, Docker forwarders, and SystemRoot binaries as protected", () => {
  const names = [
    "System",
    "Registry",
    "smss.exe",
    "csrss.exe",
    "wininit.exe",
    "winlogon.exe",
    "services.exe",
    "lsass.exe",
    "lsm.exe",
    "svchost.exe",
    "spoolsv.exe",
    "fontdrvhost.exe",
    "dwm.exe",
    "MsMpEng.exe",
    "com.docker.backend.exe",
    "wslrelay.exe",
    "docker-proxy",
    "docker-proxy.exe",
  ];
  for (const name of names) {
    assert.equal(isProtectedProcess(800, name), true, name);
    assert.equal(isProtectedProcess(800, name.toUpperCase()), true, name);
    assert.equal(isProtectedProcess(800, `C:\\Windows\\System32\\${name}`), true, name);
  }
  assert.equal(isProtectedProcess(4, "node.exe"), true);
  assert.equal(isProtectedProcess(0, ""), true);
  assert.equal(isProtectedProcess(18432, "node.exe"), false);
  assert.equal(isProtectedProcess(18432, "node.exe", "C:\\Program Files\\nodejs\\node.exe", "C:\\Windows"), false);
  assert.equal(isProtectedProcess(50, "custom.exe", "C:\\Windows\\System32\\custom.exe", "C:\\Windows"), true);
  assert.equal(isProtectedProcess(50, "custom.exe", "C:\\windows\\system32\\custom.exe", "c:\\Windows"), true);
  assert.equal(isProtectedProcess(50, "custom.exe", "C:\\WindowsOld\\custom.exe", "C:\\Windows"), false);
});

test("accepts docker container names and rejects anything else", () => {
  assert.equal(isContainerName("patent-dev-redis-1"), true);
  assert.equal(isContainerName("postgres.1"), true);
  assert.equal(isContainerName(""), false);
  assert.equal(isContainerName("name with space"), false);
  assert.equal(isContainerName("-bad"), false);
});

test("posix runner sends SIGTERM and escalates to SIGKILL", async () => {
  const signals: Array<NodeJS.Signals | 0> = [];
  let alive = true;
  const posix = createPosixRunner((pid, signal) => {
    if (signal === 0) {
      if (!alive) {
        const error = new Error("gone") as NodeJS.ErrnoException;
        error.code = "ESRCH";
        throw error;
      }
      return;
    }
    signals.push(signal);
    if (signal === "SIGKILL") alive = false;
    void pid;
  });
  const result = await stopProcess(10, posix, { force: true, waitMs: 0, sleep: async () => {} });
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(result.forced, true);
});

test("posix runner reports ESRCH and EPERM", async () => {
  const missing = createPosixRunner(() => {
    const error = new Error("gone") as NodeJS.ErrnoException;
    error.code = "ESRCH";
    throw error;
  });
  const gone = await missing.terminate(10);
  assert.equal(gone.ok, false);
  if (!gone.ok) assert.equal(gone.reason, "gone");

  const deniedRunner = createPosixRunner(() => {
    const error = new Error("nope") as NodeJS.ErrnoException;
    error.code = "EPERM";
    throw error;
  });
  const denied = await deniedRunner.terminate(10);
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.reason, "denied");
});
