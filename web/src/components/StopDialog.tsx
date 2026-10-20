import { useEffect, useRef } from "react";

import { OTHER_NOTE, processName, projectLabel } from "../classify.js";
import type { Listener } from "../types.js";
import { AlertIcon, StopIcon } from "./Icons.js";

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
    <div className="fade-in fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stop-title"
        aria-describedby="stop-verdict"
        className="pop-in w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
      >
        <div className="flex gap-4 p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger">
            {row.kind === "other" ? <AlertIcon className="h-5 w-5" /> : <StopIcon className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="stop-title" className="text-base font-semibold">
              Stop {processName(row)}?
            </h2>
            <dl className="mt-3 grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted">Process</dt>
              <dd className="truncate font-medium">{processName(row)}</dd>
              <dt className="text-muted">PID</dt>
              <dd className="font-mono">{row.pid}</dd>
              <dt className="text-muted">Project</dt>
              <dd className="truncate">{project ?? "unknown"}</dd>
            </dl>
            {row.kind === "other" ? (
              <p className="mt-3 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
                {OTHER_NOTE}
              </p>
            ) : null}
            <p id="stop-verdict" className="mt-3 text-sm text-muted">
              {row.verdict}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-subtle/60 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:bg-subtle"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-danger px-4 text-sm font-semibold text-bg shadow-sm hover:brightness-110"
          >
            <StopIcon className="h-3.5 w-3.5" />
            Stop
          </button>
        </div>
      </div>
    </div>
  );
}
