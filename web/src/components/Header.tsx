import type { Tally } from "../classify.js";
import { LogoMark } from "./Icons.js";

export type Connection = "connecting" | "live" | "offline";

export function Header({ tally, connection }: { tally: Tally; connection: Connection }) {
  const unidentified = tally.unidentified > 0 ? `, ${tally.unidentified} unidentified` : "";
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-3">
          <LogoMark />
          <div className="leading-tight">
            <p className="text-[15px] font-semibold tracking-tight">whoport</p>
            <p className="text-xs text-muted">Who is listening on this machine</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <p className="text-sm text-muted tabular-nums">
            {`${tally.dev} dev, ${tally.docker} docker, ${tally.other} other, ${tally.system} system${unidentified}`}
          </p>
          <LivePill connection={connection} />
        </div>
      </div>
    </header>
  );
}

const PILL: Record<Connection, { label: string; text: string; tone: string; dot: string }> = {
  connecting: { label: "Connecting", text: "Connecting", tone: "border-line bg-subtle text-muted", dot: "bg-muted" },
  live: { label: "Polling", text: "Live", tone: "border-dev/30 bg-dev/10 text-dev", dot: "bg-dev" },
  offline: { label: "Last poll failed", text: "Offline", tone: "border-line bg-subtle text-muted", dot: "bg-muted opacity-50" },
};

function LivePill({ connection }: { connection: Connection }) {
  const pill = PILL[connection];
  return (
    <span
      aria-label={pill.label}
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${pill.tone}`}
    >
      <span className="relative flex h-2 w-2">
        {connection === "live" ? (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-dev opacity-60" />
        ) : null}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${pill.dot}`} />
      </span>
      <span aria-hidden="true">{pill.text}</span>
    </span>
  );
}
