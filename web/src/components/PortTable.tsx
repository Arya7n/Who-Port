import { rowKey } from "../classify.js";
import type { Listener } from "../types.js";
import { PortRow } from "./PortRow.js";

export function PortTable({
  rows,
  hidden,
  pagePort,
  openKey,
  fading,
  copiedKey,
  onToggle,
  onStop,
  onCopy,
}: {
  rows: readonly Listener[];
  hidden: number;
  pagePort: number | null;
  openKey: string | null;
  fading: ReadonlySet<string>;
  copiedKey: string | null;
  onToggle: (key: string) => void;
  onStop: (row: Listener) => void;
  onCopy: (row: Listener) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="px-4 py-8">
        <p>Nothing is listening in this view</p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {hidden === 1 ? "1 row is hidden by the current filter." : `${hidden} rows are hidden by the current filter.`}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">Listening TCP ports</caption>
        <thead className="text-xs tracking-wide text-[var(--muted)]">
          <tr className="border-b border-[var(--line)]">
            <th scope="col" className="py-2 pr-2 pl-3 font-medium">
              PORT
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              PROCESS
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              PROJECT
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              UPTIME
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
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
