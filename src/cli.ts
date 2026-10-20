#!/usr/bin/env node
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";

import { ToolError } from "./errors.js";
import { parsePort, PortError } from "./port.js";
import { listenersOnPort } from "./platform/index.js";
import { formatPortReport } from "./report.js";

const USAGE = "Usage: whoport <port>";

export interface CliIO {
  log: (message: string) => void;
  error: (message: string) => void;
}

const defaultIO: CliIO = {
  log: (message) => {
    console.log(message);
  },
  error: (message) => {
    console.error(message);
  },
};

function helpText(): string {
  return [
    USAGE,
    "",
    "Show which process is listening on a TCP port.",
    "The port must be an integer from 1 to 65535.",
  ].join("\n");
}

export async function main(argv: readonly string[], io: CliIO = defaultIO): Promise<number> {
  let positionals: string[];
  let help = false;

  try {
    const parsed = parseArgs({
      args: [...argv],
      options: {
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
      strict: true,
    });
    positionals = parsed.positionals;
    help = parsed.values.help === true;
  } catch {
    io.error(`Unknown argument.\n${USAGE}`);
    return 1;
  }

  if (help) {
    io.log(helpText());
    return 0;
  }

  const rawPort = positionals[0];
  if (positionals.length !== 1 || rawPort === undefined) {
    io.error(USAGE);
    return 1;
  }

  let port: number;
  try {
    port = parsePort(rawPort);
  } catch (error) {
    const message = error instanceof PortError ? error.message : "Invalid port.";
    io.error(message);
    return 1;
  }

  try {
    const query = await listenersOnPort(port);
    for (const warning of query.warnings) {
      // stderr, so a future machine-readable stdout stays clean.
      io.error(`warning: ${warning}`);
    }
    io.log(formatPortReport(port, query.listeners));
    return 0;
  } catch (error) {
    if (error instanceof ToolError) {
      io.error(error.message);
      return 1;
    }
    throw error;
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
}

if (isDirectRun()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(1);
    });
}
