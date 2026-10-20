import { useEffect, useRef } from "react";

import { OTHER_NOTE, processName, projectLabel } from "../classify.js";
import type { Listener } from "../types.js";

export function StopDialog({
  row,
  onCancel,
  onConfirm,
}: {
  row: Listener;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const project = projectLabel(row);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = dialogRef.current;
    const focusable = (): HTMLElement[] => {
      if (!root) return [];
      return [...root.querySelectorAll("button")].filter((element) => !element.disabled);
    };
    focusable()[0]?.focus();

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        onConfirm();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    root?.addEventListener("keydown", onKey);
    return () => {
      root?.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onCancel, onConfirm]);

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stop-title"
        className="w-full max-w-md rounded border border-[var(--line)] bg-[var(--surface)] p-4"
      >
        <h2 id="stop-title" className="text-base font-semibold">
          Stop {processName(row)}
        </h2>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="w-16 text-[var(--muted)]">Process</dt>
            <dd>{processName(row)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-16 text-[var(--muted)]">PID</dt>
            <dd className="font-mono">{row.pid}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-16 text-[var(--muted)]">Project</dt>
            <dd>{project ?? "unknown"}</dd>
          </div>
        </dl>
        {row.kind === "other" ? <p className="mt-3 text-sm font-medium">{OTHER_NOTE}</p> : null}
        <p className="mt-3 text-sm">{row.verdict}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-8 rounded border border-[var(--line)] px-3 text-sm">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="h-8 rounded bg-[var(--ink)] px-3 text-sm text-[var(--bg)]">
            Stop
          </button>
        </div>
      </div>
    </div>
  );
}
