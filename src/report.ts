import type { Listener } from "./platform/types.js";

function field(label: string, value: string): string {
  return `${label.padEnd(10)}${value}`;
}

function formatListener(listener: Listener): string {
  const command = listener.command.length > 0 ? listener.command : "(unknown)";
  return [
    field("pid", String(listener.pid)),
    field("command", command),
    field("address", listener.address),
    field("protocol", listener.protocol),
  ].join("\n");
}

/** Plain text for one port. Empty means nothing is listening. */
export function formatPortReport(port: number, listeners: readonly Listener[]): string {
  if (listeners.length === 0) {
    return `port ${port} is free`;
  }

  const ordered = [...listeners].sort((a, b) => {
    if (a.address === b.address) return a.pid - b.pid;
    return a.address < b.address ? -1 : 1;
  });

  const blocks = ordered.map((listener) => formatListener(listener));
  const count = listeners.length === 1 ? "" : `\n${listeners.length} listeners`;
  return `port ${port}${count}\n\n${blocks.join("\n\n")}`;
}
