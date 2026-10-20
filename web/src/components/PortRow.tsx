import type { CSSProperties, ReactNode } from "react";

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
import { CheckIcon, ChevronIcon, CopyIcon, LockIcon, SpinnerIcon, StopIcon } from "./Icons.js";

const EDGE: Record<RowKind, string> = {
  dev: "shadow-[inset_3px_0_0_var(--dev)]",
  docker: "shadow-[inset_3px_0_0_var(--docker)]",
  other: "shadow-[inset_3px_0_0_var(--other)]",
  system: "shadow-[inset_3px_0_0_var(--system)]",
  unidentified: "shadow-[inset_3px_0_0_var(--line)]",
};

const BADGE: Record<RowKind | "own", string> = {
  dev: "var(--dev)",
  docker: "var(--docker)",
  other: "var(--other)",
  system: "var(--system)",
  unidentified: "var(--muted)",
  own: "var(--focus)",
};

export function PortRow({
  row,
  pagePort,
  open,
  fading,
  stopping,
  copied,
  onToggle,
  onStop,
  onCopy,
}: {
  row: Listener;
  pagePort: number | null;
  open: boolean;
  fading: boolean;
  stopping: boolean;
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
        className={`group cursor-pointer border-b border-line transition-[opacity,background-color] duration-200 hover:bg-subtle/70 ${
          open ? "bg-subtle/70" : ""
        } ${fading ? "opacity-0" : ""}`}
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
        <td className={`py-3 pr-3 pl-5 ${EDGE[kind]}`}>
          <span className="flex items-center gap-1.5">
            <ChevronIcon
              className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-150 ${open ? "rotate-90" : ""}`}
            />
            <span className="font-mono text-[13px] font-semibold tabular-nums">{row.port}</span>
          </span>
        </td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-2">
            <span className="badge" style={{ "--badge": BADGE[own ? "own" : kind] } as CSSProperties}>
              {tag}
            </span>
            <span className="truncate font-medium">{processName(row)}</span>
          </div>
          {row.docker ? <div className="mt-0.5 truncate font-mono text-xs text-muted">{row.docker.image}</div> : null}
        </td>
        <td className="px-3 py-3">
          {project ?? (
            <span className="text-muted" title="unknown: Windows did not expose a command line">
              —
            </span>
          )}
        </td>
        <td className="px-3 py-3 text-muted tabular-nums">{row.uptime ?? "unknown"}</td>
        <td className="py-3 pr-5 pl-3 text-right">
          <RowAction
            own={own}
            kind={kind}
            copied={copied}
            stopping={stopping}
            command={command}
            onStop={onStop}
            onCopy={onCopy}
          />
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-line bg-subtle/40">
          <td colSpan={5} className={`px-5 py-4 ${EDGE[kind]}`}>
            <div className="fade-in grid gap-4 pl-5">
              <Detail label="Command line">
                <pre className="max-h-40 overflow-auto rounded-lg border border-line bg-bg p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap select-text">
                  {row.commandLine && row.commandLine.length > 0 ? row.commandLine : "No command line."}
                </pre>
              </Detail>
              <div className="grid grid-cols-3 gap-4">
                <Detail label="PID">
                  <span className="font-mono text-[13px]">{row.pid}</span>
                </Detail>
                <Detail label="Address">
                  <span className="font-mono text-[13px]">{row.addresses.join(", ")}</span>
                </Detail>
                <Detail label="Started">
                  <span className="text-[13px]">{row.startedAt ? new Date(row.startedAt).toLocaleString() : "unknown"}</span>
                </Detail>
              </div>
              <Detail label="Verdict">
                <p className="text-[13px]">{row.verdict}</p>
              </Detail>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">{label}</p>
      {children}
    </div>
  );
}

const BUTTON =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium whitespace-nowrap transition-colors";

/** A disabled button cannot take focus, so the wrapper does, which keeps the tooltip reachable by keyboard. */
function DisabledStop({ reason }: { reason: string }) {
  return (
    <span tabIndex={0} title={reason} className="inline-flex rounded-lg" onClick={(event) => event.stopPropagation()}>
      <button type="button" disabled className={`${BUTTON} cursor-not-allowed border-line text-muted opacity-60`}>
        <LockIcon className="h-3.5 w-3.5" />
        Stop
      </button>
    </span>
  );
}

function RowAction({
  own,
  kind,
  copied,
  stopping,
  command,
  onStop,
  onCopy,
}: {
  own: boolean;
  kind: RowKind;
  copied: boolean;
  stopping: boolean;
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
        className={`${BUTTON} ${
          copied ? "border-dev/40 bg-dev/10 text-dev" : "border-line bg-surface hover:border-docker/40 hover:bg-docker/10 hover:text-docker"
        }`}
      >
        {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
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
      disabled={stopping}
      onClick={(event) => {
        event.stopPropagation();
        onStop();
      }}
      className={`${BUTTON} border-line bg-surface hover:border-danger/40 hover:bg-danger/10 hover:text-danger disabled:cursor-wait disabled:border-line disabled:bg-subtle disabled:text-muted`}
    >
      {stopping ? <SpinnerIcon className="h-3.5 w-3.5" /> : <StopIcon className="h-3.5 w-3.5" />}
      {stopping ? "Stopping…" : "Stop"}
    </button>
  );
}
