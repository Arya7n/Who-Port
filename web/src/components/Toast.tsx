import { useEffect } from "react";

export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 4000);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <div role="status" className="fixed right-4 bottom-4 max-w-sm rounded border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm whitespace-pre-wrap shadow-sm">
      {message}
    </div>
  );
}
