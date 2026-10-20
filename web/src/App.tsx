import { useCallback, useRef, useState } from "react";

import { killPid } from "./api.js";
import { counts, DEFAULT_FILTER, dockerStopCommand, rowKey, visibleRows, type ViewFilter } from "./classify.js";
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
  const { listeners, failed, retry } = usePorts();
  const [filter, setFilter] = useState<ViewFilter>(DEFAULT_FILTER);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [pending, setPending] = useState<Listener | null>(null);
  const pendingRef = useRef<Listener | null>(null);
  pendingRef.current = pending;
  const [fading, setFading] = useState<ReadonlySet<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  const tally = counts(listeners ?? []);
  const rows = visibleRows(listeners ?? [], filter);
  const hidden = (listeners?.length ?? 0) - rows.length;
  const live = listeners !== null && !failed;

  const cancelStop = useCallback(() => setPending(null), []);
  const confirmStop = useCallback(() => {
    const target = pendingRef.current;
    if (!target) return;
    setPending(null);
    void killPid(target.pid).then((result) => {
      if (result.ok) {
        setFading((current) => new Set(current).add(rowKey(target)));
        window.setTimeout(retry, 200);
        return;
      }
      setToast(result.message);
    });
  }, [retry]);

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
      <Header tally={tally} live={live} />
      {failed ? <Banner onRetry={retry} /> : null}
      <Toolbar filter={filter} systemCount={tally.system} onChange={setFilter} />
      {listeners === null ? (
        <Skeleton />
      ) : (
        <PortTable
          rows={rows}
          hidden={hidden}
          pagePort={pagePort()}
          openKey={openKey}
          fading={fading}
          copiedKey={copiedKey}
          onToggle={(key) => setOpenKey((current) => (current === key ? null : key))}
          onStop={setPending}
          onCopy={(row) => {
            void copyStop(row);
          }}
        />
      )}
      {pending ? (
        <StopDialog row={pending} onCancel={cancelStop} onConfirm={confirmStop} />
      ) : null}
      {toast ? <Toast message={toast} onDismiss={dismissToast} /> : null}
    </div>
  );
}
