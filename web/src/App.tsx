import { useCallback, useRef, useState } from "react";

import { killPid } from "./api.js";
import { counts, DEFAULT_FILTER, dockerStopCommand, needsConfirm, rowKey, visibleRows, type ViewFilter } from "./classify.js";
import { Banner } from "./components/Banner.js";
import { Header } from "./components/Header.js";
import { PortTable } from "./components/PortTable.js";
import { Skeleton } from "./components/Skeleton.js";
import { StopDialog } from "./components/StopDialog.js";
import { Toast } from "./components/Toast.js";
import { Toolbar } from "./components/Toolbar.js";
import type { Listener } from "./types.js";
import { usePorts } from "./usePorts.js";

function pagePort(): number | null {
  const raw = window.location.port;
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

export function App() {
  const { listeners, failed, updatedAt, retry } = usePorts();
  const [filter, setFilter] = useState<ViewFilter>(DEFAULT_FILTER);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [pending, setPending] = useState<Listener | null>(null);
  const pendingRef = useRef<Listener | null>(null);
  pendingRef.current = pending;
  const [fading, setFading] = useState<ReadonlySet<string>>(new Set());
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  const tally = counts(listeners ?? []);
  const rows = visibleRows(listeners ?? [], filter);
  const hidden = (listeners?.length ?? 0) - rows.length;
  const connection = failed ? "offline" : listeners === null ? "connecting" : "live";

  const runStop = useCallback(
    (target: Listener) => {
      const key = rowKey(target);
      setStopping((current) => new Set(current).add(key));
      void killPid(target.pid)
        .catch(() => ({ ok: false, message: "Can't reach whoport server." }))
        .then((result) => {
          setStopping((current) => {
            const next = new Set(current);
            next.delete(key);
            return next;
          });
          if (result.ok) {
            setFading((current) => new Set(current).add(key));
            window.setTimeout(retry, 200);
            return;
          }
          setToast(result.message);
        });
    },
    [retry],
  );

  const requestStop = (row: Listener): void => {
    if (needsConfirm(row)) setPending(row);
    else runStop(row);
  };

  const cancelStop = useCallback(() => setPending(null), []);
  const confirmStop = useCallback(() => {
    const target = pendingRef.current;
    if (!target) return;
    setPending(null);
    runStop(target);
  }, [runStop]);

  const copyStop = async (row: Listener): Promise<void> => {
    const command = dockerStopCommand(row);
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopiedKey(rowKey(row));
      window.setTimeout(() => setCopiedKey((current) => (current === rowKey(row) ? null : current)), 2000);
    } catch {
      setToast("Could not copy the docker stop command.");
    }
  };

  return (
    <div className="min-h-screen">
      <Header tally={tally} connection={connection} />
      <main className="mx-auto max-w-6xl space-y-4 px-6 py-6">
        {failed ? <Banner onRetry={retry} /> : null}
        <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
          <Toolbar filter={filter} tally={tally} onChange={setFilter} />
          {listeners === null ? (
            <Skeleton />
          ) : (
            <PortTable
              rows={rows}
              hidden={hidden}
              pagePort={pagePort()}
              openKey={openKey}
              fading={fading}
              stopping={stopping}
              copiedKey={copiedKey}
              onToggle={(key) => setOpenKey((current) => (current === key ? null : key))}
              onStop={requestStop}
              onCopy={(row) => {
                void copyStop(row);
              }}
              onShowAll={() => setFilter({ dev: true, docker: true, other: true, system: true, query: "" })}
            />
          )}
        </section>
        <footer className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted">
          <p className="tabular-nums">
            {listeners === null
              ? "Looking up listening ports…"
              : `Showing ${rows.length} of ${listeners.length} listeners${updatedAt ? ` · updated ${updatedAt.toLocaleTimeString()}` : ""}`}
          </p>
          <p>Polls every 2 s · bound to 127.0.0.1 only · click a row for details</p>
        </footer>
      </main>
      {pending ? (
        <StopDialog row={pending} onCancel={cancelStop} onConfirm={confirmStop} />
      ) : null}
      {toast ? <Toast message={toast} onDismiss={dismissToast} /> : null}
    </div>
  );
}
