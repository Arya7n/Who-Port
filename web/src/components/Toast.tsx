import { useEffect } from "react";

import { AlertIcon, CheckIcon, XIcon } from "./Icons.js";

export function Toast({
  message,
  tone = "error",
  onDismiss,
}: {
  message: string;
  tone?: "error" | "ok";
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, tone === "ok" ? 2500 : 5000);
    return () => window.clearTimeout(timer);
  }, [message, tone, onDismiss]);

  const iconTone = tone === "ok" ? "bg-dev/10 text-dev" : "bg-danger/10 text-danger";

  return (
    <div
      role="status"
      className="pop-in fixed right-5 bottom-5 z-40 flex max-w-sm items-start gap-3 rounded-xl border border-line bg-surface p-3 pr-2 shadow-xl"
    >
      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${iconTone}`}>
        {tone === "ok" ? <CheckIcon className="h-3.5 w-3.5" /> : <AlertIcon className="h-3.5 w-3.5" />}
      </span>
      <p className="flex-1 text-sm whitespace-pre-wrap">{message}</p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="rounded-md p-1 text-muted hover:bg-subtle hover:text-ink"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
