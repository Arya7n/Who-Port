import { useEffect, useRef } from "react";

import type { Tally, ViewFilter } from "../classify.js";
import { SearchIcon, XIcon } from "./Icons.js";

type ChipKey = "dev" | "docker" | "other" | "system";

const DOT: Record<ChipKey, string> = {
  dev: "bg-dev",
  docker: "bg-docker",
  other: "bg-other",
  system: "bg-system",
};

export function Toolbar({
  filter,
  tally,
  onChange,
}: {
  filter: ViewFilter;
  tally: Tally;
  onChange: (next: ViewFilter) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const toggle = (key: ChipKey) => {
    onChange({ ...filter, [key]: !filter[key] });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
      <div className="relative min-w-56 flex-1">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          ref={inputRef}
          aria-label="Filter ports"
          value={filter.query}
          placeholder="Filter port, process, project"
          onChange={(event) => onChange({ ...filter, query: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Escape" && filter.query.length > 0) {
              event.preventDefault();
              onChange({ ...filter, query: "" });
            }
          }}
          className="h-9 w-full rounded-lg border border-line bg-bg pr-16 pl-9 text-sm transition-colors outline-none placeholder:text-muted hover:border-muted/50 focus-visible:border-[var(--focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]/25"
        />
        <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
          {filter.query.length > 0 ? (
            <button
              type="button"
              aria-label="Clear filter"
              onClick={() => {
                onChange({ ...filter, query: "" });
                inputRef.current?.focus();
              }}
              className="rounded-md p-1 text-muted hover:bg-subtle hover:text-ink"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd aria-hidden="true" className="rounded border border-line bg-surface px-1.5 font-mono text-[11px] text-muted">
              /
            </kbd>
          )}
        </div>
      </div>
      <div role="group" aria-label="Row kinds" className="flex flex-wrap items-center gap-1.5">
        <Chip pressed={filter.dev} dot={DOT.dev} count={tally.dev} onClick={() => toggle("dev")}>
          Dev
        </Chip>
        <Chip pressed={filter.docker} dot={DOT.docker} count={tally.docker} onClick={() => toggle("docker")}>
          Docker
        </Chip>
        <Chip pressed={filter.other} dot={DOT.other} onClick={() => toggle("other")}>
          {`Show other (${tally.other})`}
        </Chip>
        <Chip pressed={filter.system} dot={DOT.system} onClick={() => toggle("system")}>
          {`Show system (${tally.system})`}
        </Chip>
      </div>
    </div>
  );
}

function Chip({
  pressed,
  dot,
  count,
  onClick,
  children,
}: {
  pressed: boolean;
  dot: string;
  count?: number;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] font-medium transition-colors ${
        pressed
          ? "border-ink/15 bg-ink text-bg shadow-sm"
          : "border-line bg-surface text-muted hover:border-muted/40 hover:text-ink"
      }`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot} ${pressed ? "" : "opacity-60"}`} />
      {children}
      {count !== undefined ? (
        <span
          aria-hidden="true"
          className={`rounded-full px-1.5 text-[11px] tabular-nums ${pressed ? "bg-bg/15 text-bg" : "bg-subtle text-muted"}`}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
