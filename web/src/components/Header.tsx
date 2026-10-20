import type { counts } from "../classify.js";

type Tally = ReturnType<typeof counts>;

export function Header({ tally, live }: { tally: Tally; live: boolean }) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-[var(--line)] bg-[var(--surface)] px-4 py-3">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="inline-block h-2 w-2 bg-[var(--ink)]" />
        <span className="text-base font-semibold tracking-tight">whoport</span>
      </div>
      <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
        <p>
          {tally.dev} dev, {tally.docker} docker, {tally.system} system
        </p>
        <span
          className={live ? "inline-block h-2 w-2 rounded-full bg-[var(--dev)]" : "inline-block h-2 w-2 rounded-full bg-[var(--muted)] opacity-40"}
          aria-label={live ? "Polling" : "Last poll failed"}
        />
      </div>
    </header>
  );
}
