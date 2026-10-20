import { AlertIcon, RefreshIcon } from "./Icons.js";

export function Banner({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="fade-in flex items-center justify-between gap-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3"
    >
      <div className="flex items-center gap-3">
        <AlertIcon className="h-4 w-4 text-danger" />
        <div>
          <p className="text-sm font-semibold text-danger">Can&apos;t reach whoport server</p>
          <p className="text-xs text-muted">Showing the last list it returned. Start it again with whoport ui.</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium hover:bg-subtle"
      >
        <RefreshIcon className="h-3.5 w-3.5" />
        Retry
      </button>
    </div>
  );
}
