import assert from "node:assert/strict";
import test from "node:test";

import { isDevRuntime, rowKind } from "../src/kinds.js";

const none = { docker: null, protected: false, project: null };

test("known runtimes and local services are dev without a project", () => {
  for (const command of ["node.exe", "mongod.exe", "redis-server.exe", "python3.12", "java", "postgres.exe", "bun"]) {
    assert.equal(rowKind({ ...none, command }), "dev", command);
  }
  assert.equal(isDevRuntime("C:\\Program Files\\nodejs\\node.exe"), true);
});

test("desktop apps and vendor services are other, not dev", () => {
  for (const command of ["SpotifyLauncher.exe", "Spotify.exe", "AsusSoftwareManager.exe", "jhi_service.exe", "nodemon-helper.exe"]) {
    assert.equal(rowKind({ ...none, command }), "other", command);
  }
});

test("a resolved project makes any process dev", () => {
  assert.equal(rowKind({ ...none, command: "myapp.exe", project: { name: "myapp", root: "C:\\code\\myapp" } }), "dev");
});

test("docker, then system, then unidentified win before dev or other", () => {
  const container = { name: "patent-dev-redis-1", image: "redis:7-alpine", project: "patent-dev", service: "redis" };
  assert.equal(rowKind({ ...none, docker: container, protected: true, command: "com.docker.backend.exe" }), "docker");
  assert.equal(rowKind({ ...none, protected: true, command: "svchost.exe" }), "system");
  assert.equal(rowKind({ ...none, command: "" }), "unidentified");
});
