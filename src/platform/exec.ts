import { execFile } from "node:child_process";

export interface ToolSuccess {
  ok: true;
  stdout: string;
}

export interface ToolFailure {
  ok: false;
  missing: boolean;
  denied: boolean;
  message: string;
}

export type ToolResult = ToolSuccess | ToolFailure;

/**
 * Windows console tools sometimes write UTF-16 LE when stdout is a pipe.
 * This machine's netstat/tasklist are ASCII, but a NUL-padded buffer would
 * otherwise show up as garbage and break the parser.
 */
export function decodeToolOutput(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString("utf16le");
  }

  const sample = buf.subarray(0, Math.min(buf.length, 64));
  let zeroPairs = 0;
  const pairs = Math.floor(sample.length / 2);
  for (let i = 1; i < sample.length; i += 2) {
    if (sample[i] === 0) zeroPairs += 1;
  }
  if (pairs >= 8 && zeroPairs / pairs > 0.8) {
    return buf.toString("utf16le");
  }
  return buf.toString("utf8");
}

/**
 * execFile, never exec: arguments are passed as an array, so a port or PID
 * cannot be interpreted by a shell.
 */
export function runTool(file: string, args: readonly string[]): Promise<ToolResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      {
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const out = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? "");
        const errText = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr ?? "");
        if (!error) {
          resolve({ ok: true, stdout: decodeToolOutput(out) });
          return;
        }

        const code = (error as NodeJS.ErrnoException).code;
        const missing = code === "ENOENT";
        const denied =
          code === "EPERM" ||
          code === "EACCES" ||
          /access is denied/i.test(errText) ||
          /access is denied/i.test(error.message);

        const detail = errText.trim() || error.message;
        resolve({ ok: false, missing, denied, message: detail });
      },
    );
  });
}
