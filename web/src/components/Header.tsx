import type { Tally } from "../classify.js";

export function Header({ tally, live }: { tally: Tally; live: boolean }) {
  const unidentified = tally.unidentified > 0 ? `, ${tally.unidentified} unidentified` : "";
  return (
    <header className="flex items-center justify-between gap-4 border-b border-[var(--line)] bg-[var(--surface)] px-4 py-3">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="inline-block h-2 w-2 bg-[var(--ink)]" />
        <span className="text-base font-semibold tracking-tight">whoport</span>
      </div>
      <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
        <p>
          {`${tally.dev} dev, ${tally.docker} docker, ${tally.other} other, ${tally.system} system${unidentified}`}
        </p>
        <span
          className={live ? "inline-block h-2 w-2 rounded-full bg-[var(--dev)]" : "inline-block h-2 w-2 rounded-full bg-[var(--muted)] opacity-40"}
          aria-label={live ? "Polling" : "Last poll failed"}
        />
      </div>
    </header>
  );
}
