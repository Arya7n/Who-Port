import { processLabel, projectLabel, type PortView } from "./inspect.js";

export interface ReportStyle {
  color: boolean;
  numbers: boolean;
}

const RESET = "\x1b[0m";

/** NO_COLOR present and non-empty disables color. A pipe is not a terminal, so it stays plain. */
export function useColor(env: NodeJS.ProcessEnv, isTTY: boolean): boolean {
  if (!isTTY) return false;
  const noColor = env.NO_COLOR;
  if (noColor !== undefined && noColor !== "") return false;
  return true;
}

export function truncateCommand(command: string, max = 96): string {
  if (command.length <= max) return command;
  return `${command.slice(0, max - 3)}...`;
}

function paint(enabled: boolean, code: string, text: string): string {
  if (!enabled) return text;
  return `\x1b[${code}m${text}${RESET}`;
}

function tone(view: PortView): string | null {
  if (view.docker) return "33";
  if (view.pid === 0) return null;
  if (view.protected) return "31";
  return "32";
}

function cell(value: string, width: number, align: "left" | "right"): string {
  const text = value.length > width ? `${value.slice(0, Math.max(0, width - 3))}...` : value;
  return align === "right" ? text.padStart(width) : text.padEnd(width);
}

function field(label: string, value: string): string {
  return `${label.padEnd(10)}${value}`;
}

export function formatCard(view: PortView, color: boolean): string {
  const lines = [`port ${view.port}`, field("address", view.addresses.join(", "))];
  if (view.docker) {
    lines.push(field("container", paint(color, "33", view.docker.name)));
    if (view.docker.image.length > 0) lines.push(field("image", view.docker.image));
    const compose = projectLabel(view);
    if (compose !== view.docker.name) lines.push(field("compose", compose));
  } else {
    lines.push(field("pid", String(view.pid)));
    const toneCode = tone(view);
    const name = processLabel(view);
    lines.push(field("process", toneCode ? paint(color, toneCode, name) : name));
    lines.push(field("project", projectLabel(view)));
    lines.push(field("started", view.uptime ?? "unknown"));
    const command = view.commandLine ?? view.executablePath;
    if (command) lines.push(field("command", truncateCommand(command)));
  }
  lines.push("", view.verdict);
  return lines.join("\n");
}

export function formatPortReport(port: number, views: readonly PortView[], color: boolean): string {
  if (views.length === 0) return `port ${port} is free`;
  return views.map((view) => formatCard(view, color)).join("\n\n");
}

function rowText(view: PortView, style: ReportStyle, index: number | null): string {
  const process = cell(processLabel(view), 22, "left");
  const toneCode = tone(view);
  const coloredProcess = toneCode ? paint(style.color, toneCode, process) : process;
  const body = [
    cell(String(view.port), 5, "right"),
    paint(style.color, "2", cell(view.pid === 0 ? "-" : String(view.pid), 7, "right")),
    coloredProcess,
    cell(projectLabel(view), 20, "left"),
    paint(style.color, "2", cell(view.uptime ?? "unknown", 8, "left")),
  ].join("  ");
  if (!style.numbers || index === null) return body;
  return `${cell(String(index), 3, "right")}  ${body}`;
}

function header(style: ReportStyle): string {
  const body = [
    cell("PORT", 5, "right"),
    cell("PID", 7, "right"),
    cell("PROCESS", 22, "left"),
    cell("PROJECT", 20, "left"),
    cell("UPTIME", 8, "left"),
  ].join("  ");
  const line = style.numbers ? `${cell("#", 3, "right")}  ${body}` : body;
  return style.color ? paint(true, "1", line) : line;
}

export function formatTable(views: readonly PortView[], style: ReportStyle): string {
  if (views.length === 0) return "No listening TCP ports.";
  const rows = views.map((view, index) => rowText(view, style, index + 1));
  return [header(style), ...rows].join("\n");
}

export function formatListenersJson(views: readonly PortView[], port?: number): string {
  const body = port === undefined ? { listeners: views } : { port, listeners: views };
  return JSON.stringify(body, null, 2);
}

export function formatKillJson(result: { port: number; ok: boolean; action: string; message: string }): string {
  return JSON.stringify(result, null, 2);
}
