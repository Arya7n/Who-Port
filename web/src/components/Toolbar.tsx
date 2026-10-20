import type { ViewFilter } from "../classify.js";

export function Toolbar({
  filter,
  systemCount,
  onChange,
}: {
  filter: ViewFilter;
  systemCount: number;
  onChange: (next: ViewFilter) => void;
}) {
  const toggle = (key: "dev" | "docker" | "system") => {
    onChange({ ...filter, [key]: !filter[key] });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-2">
      <input
        aria-label="Filter ports"
        value={filter.query}
        placeholder="Filter port, process, project"
        onChange={(event) => onChange({ ...filter, query: event.target.value })}
        className="h-8 min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--surface)] px-2 text-sm"
      />
      <Chip pressed={filter.dev} onClick={() => toggle("dev")}>
        Dev
      </Chip>
      <Chip pressed={filter.docker} onClick={() => toggle("docker")}>
        Docker
      </Chip>
      <Chip pressed={filter.system} onClick={() => toggle("system")}>
        {`Show system (${systemCount})`}
      </Chip>
    </div>
  );
}

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={
        pressed
          ? "h-8 rounded border border-[var(--ink)] bg-[var(--ink)] px-2 text-sm text-[var(--bg)]"
          : "h-8 rounded border border-[var(--line)] bg-[var(--surface)] px-2 text-sm"
      }
    >
      {children}
    </button>
  );
}
