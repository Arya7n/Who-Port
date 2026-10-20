import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { posix, win32 } from "node:path";

export type Exists = (path: string) => boolean;

/** Starts `file` with `args` and no shell. Resolves true once the process exists. */
export type Spawner = (file: string, args: readonly string[]) => Promise<boolean>;

export interface LaunchDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  exists: Exists;
  spawn: Spawner;
}

export type LaunchResult =
  | { status: "opened"; browser: string }
  | { status: "not-found" }
  | { status: "failed"; browser: string };

const WINDOWS_BROWSERS = [
  ["Microsoft", "Edge", "Application", "msedge.exe"],
  ["Google", "Chrome", "Application", "chrome.exe"],
];

const PATH_BROWSERS = ["google-chrome", "chromium", "microsoft-edge"];

/**
 * Every place a supported browser may live, in the order to try them.
 * Windows: Edge, then Chrome, each under Program Files, Program Files (x86), then LocalAppData.
 * Elsewhere: google-chrome, chromium, then microsoft-edge on PATH.
 */
export function browserCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === "win32") {
    const roots = [
      env.ProgramFiles ?? "C:\\Program Files",
      env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      env.LOCALAPPDATA,
    ].filter((root): root is string => typeof root === "string" && root.length > 0);
    const unique = [...new Set(roots)];
    return WINDOWS_BROWSERS.flatMap((parts) => unique.map((root) => win32.join(root, ...parts)));
  }

  const dirs = (env.PATH ?? "").split(posix.delimiter).filter((dir) => dir.length > 0 && posix.isAbsolute(dir));
  return PATH_BROWSERS.flatMap((name) => dirs.map((dir) => posix.join(dir, name)));
}

/** The first installed browser, or null. Pure: the filesystem check is injected. */
export function chooseLauncher(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, exists: Exists): string | null {
  return browserCandidates(platform, env).find((path) => exists(path)) ?? null;
}

/** A fixed argv. The port is a validated integer, so nothing here can become a second argument. */
export function appWindowArgs(port: number): string[] {
  return [`--app=http://127.0.0.1:${port}`, "--window-size=1000,640"];
}

/** Never throws. A missing browser or a failed launch is a result, not an error. */
export async function openDashboard(port: number, deps: LaunchDeps): Promise<LaunchResult> {
  let browser: string | null;
  try {
    browser = chooseLauncher(deps.platform, deps.env, deps.exists);
  } catch {
    return { status: "not-found" };
  }
  if (browser === null) return { status: "not-found" };
  try {
    const started = await deps.spawn(browser, appWindowArgs(port));
    return started ? { status: "opened", browser } : { status: "failed", browser };
  } catch {
    return { status: "failed", browser };
  }
}

export function fileExists(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform !== "win32") accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * spawn with no shell, detached and with stdio ignored, then unref'd:
 * closing the window cannot stop the server, the server never waits on the browser,
 * and a chatty browser cannot fill a pipe. Ctrl+C in the terminal reaches only whoport.
 */
export const spawnDetached: Spawner = (file, args) =>
  new Promise((resolve) => {
    try {
      const child = spawn(file, [...args], { detached: true, stdio: "ignore", shell: false, windowsHide: false });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });

export const defaultLaunchDeps: LaunchDeps = {
  platform: process.platform,
  env: process.env,
  exists: fileExists,
  spawn: spawnDetached,
};
