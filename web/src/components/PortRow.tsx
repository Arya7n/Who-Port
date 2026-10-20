import {
  dockerStopCommand,
  isDashboardPort,
  processName,
  projectLabel,
  rowKind,
  UNIDENTIFIED_TITLE,
  type RowKind,
} from "../classify.js";
import type { Listener } from "../types.js";

const BORDER: Record<RowKind, string> = {
  dev: "border-l-[var(--dev)]",
  docker: "border-l-[var(--docker)]",
  system: "border-l-[var(--system)]",
  unidentified: "border-l-[var(--line)]",
};

const TAG: Record<RowKind, string> = {
  dev: "text-[var(--dev)]",
  docker: "text-[var(--docker)]",
  system: "text-[var(--system)]",
  unidentified: "text-[var(--muted)]",
};

export function PortRow({
  row,
  pagePort,
  open,
  fading,
  copied,
  onToggle,
  onStop,
  onCopy,
}: {
  row: Listener;
  pagePort: number | null;
  open: boolean;
  fading: boolean;
  copied: boolean;
  onToggle: () => void;
  onStop: () => void;
  onCopy: () => void;
}) {
  const kind = rowKind(row);
  const own = isDashboardPort(row.port, pagePort);
  const project = projectLabel(row);
  const command = dockerStopCommand(row);
  const tag = own ? "THIS APP" : kind.toUpperCase();

  return (
    <>
      <tr
        className={`border-b border-[var(--line)] ${fading ? "opacity-0" : ""} transition-opacity duration-200`}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        tabIndex={0}
        aria-expanded={open}
      >
        <td className={`border-l-2 py-2 pr-2 pl-3 font-mono text-sm font-semibold ${BORDER[kind]}`}>{row.port}</td>
        <td className="px-2 py-2">
          <div className="flex items-baseline gap-2">
            <span className={`text-[11px] font-medium tracking-wide ${own ? "text-[var(--muted)]" : TAG[kind]}`}>{tag}</span>
            <span>{processName(row)}</span>
          </div>
          {row.docker ? <div className="text-xs text-[var(--muted)]">{row.docker.image}</div> : null}
        </td>
        <td className="px-2 py-2">
          {project ?? (
            <span className="text-[var(--muted)]" title="unknown: Windows did not expose a command line">
              —
            </span>
          )}
        </td>
        <td className="px-2 py-2 text-[var(--muted)]">{row.uptime ?? "unknown"}</td>
        <td className="px-2 py-2 text-right">
          <RowAction own={own} kind={kind} copied={copied} command={command} onStop={onStop} onCopy={onCopy} />
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={5} className="border-l-2 border-[var(--line)] bg-[var(--bg)] px-4 py-3">
            <p className="font-mono text-xs break-all whitespace-pre-wrap select-text">
              {row.commandLine && row.commandLine.length > 0 ? row.commandLine : "No command line."}
            </p>
            <p className="mt-2 text-sm">{row.verdict}</p>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** The wrapper takes focus so the reason in the tooltip is reachable from the keyboard. */
function DisabledStop({ reason }: { reason: string }) {
  return (
    <span tabIndex={0} title={reason} className="inline-flex" onClick={(event) => event.stopPropagation()}>
      <button type="button" disabled className="h-8 cursor-not-allowed rounded border border-[var(--line)] px-2 text-sm text-[var(--muted)]">
        Stop
      </button>
    </span>
  );
}

function RowAction({
  own,
  kind,
  copied,
  command,
  onStop,
  onCopy,
}: {
  own: boolean;
  kind: RowKind;
  copied: boolean;
  command: string | null;
  onStop: () => void;
  onCopy: () => void;
}) {
  if (kind === "docker" && command) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onCopy();
        }}
        className="h-8 rounded border border-[var(--line)] bg-[var(--surface)] px-2 text-sm"
      >
        {copied ? "Copied" : "Copy docker stop"}
      </button>
    );
  }

  if (own) return <DisabledStop reason="This dashboard" />;
  if (kind === "system") return <DisabledStop reason="System process. Handle from the CLI." />;
  if (kind === "unidentified") return <DisabledStop reason={UNIDENTIFIED_TITLE} />;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onStop();
      }}
      className="h-8 rounded border border-[var(--line)] bg-[var(--surface)] px-2 text-sm"
    >
      Stop
    </button>
  );
}
