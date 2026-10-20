import { rowKey } from "../classify.js";
import type { Listener } from "../types.js";
import { RadarIcon } from "./Icons.js";
import { PortRow } from "./PortRow.js";

const HEAD = "px-3 py-2.5 text-[11px] font-semibold tracking-wider text-muted";

export function PortTable({
  rows,
  hidden,
  pagePort,
  openKey,
  fading,
  stopping,
  copiedKey,
  onToggle,
  onStop,
  onCopy,
  onShowAll,
}: {
  rows: readonly Listener[];
  hidden: number;
  pagePort: number | null;
  openKey: string | null;
  fading: ReadonlySet<string>;
  stopping: ReadonlySet<string>;
  copiedKey: string | null;
  onToggle: (key: string) => void;
  onStop: (row: Listener) => void;
  onCopy: (row: Listener) => void;
  onShowAll: () => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-subtle text-muted">
          <RadarIcon className="h-6 w-6" />
        </span>
        <p className="font-medium">Nothing is listening in this view</p>
        <p className="mt-1 text-sm text-muted">
          {hidden === 1 ? "1 row is hidden by the current filter." : `${hidden} rows are hidden by the current filter.`}
        </p>
        {hidden > 0 ? (
          <button
            type="button"
            onClick={onShowAll}
            className="mt-4 h-8 rounded-lg border border-line bg-surface px-3 text-sm font-medium hover:bg-subtle"
          >
            Show every kind
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">Listening TCP ports</caption>
        <thead className="border-b border-line bg-subtle/60">
          <tr>
            <th scope="col" className={`${HEAD} w-28 pl-5`}>
              PORT
            </th>
            <th scope="col" className={HEAD}>
              PROCESS
            </th>
            <th scope="col" className={HEAD}>
              PROJECT
            </th>
            <th scope="col" className={`${HEAD} w-28`}>
              UPTIME
            </th>
            <th scope="col" className={`${HEAD} w-44 pr-5 text-right`}>
              ACTION
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <PortRow
                key={key}
                row={row}
                pagePort={pagePort}
                open={openKey === key}
                fading={fading.has(key)}
                stopping={stopping.has(key)}
                copied={copiedKey === key}
                onToggle={() => onToggle(key)}
                onStop={() => onStop(row)}
                onCopy={() => onCopy(row)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
