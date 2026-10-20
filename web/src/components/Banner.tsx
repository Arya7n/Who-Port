export function Banner({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-4 border-b border-[var(--system)] bg-[var(--surface)] px-4 py-2">
      <p>Can&apos;t reach whoport server</p>
      <button type="button" onClick={onRetry} className="h-8 rounded border border-[var(--line)] px-2 text-sm">
        Retry
      </button>
    </div>
  );
}
