import { DEFAULT_FILTER, type ViewFilter } from "./classify.js";

const KEY = "whoport.filter";

function isFilter(value: unknown): value is ViewFilter {
  if (value === null || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.dev === "boolean" &&
    typeof row.docker === "boolean" &&
    typeof row.other === "boolean" &&
    typeof row.system === "boolean" &&
    typeof row.query === "string"
  );
}

export function loadFilter(): ViewFilter {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw === null) return DEFAULT_FILTER;
    const parsed: unknown = JSON.parse(raw);
    if (!isFilter(parsed)) return DEFAULT_FILTER;
    return parsed;
  } catch {
    return DEFAULT_FILTER;
  }
}

export function saveFilter(filter: ViewFilter): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(filter));
  } catch {
    // Private mode or quota — keep the in-memory filter only.
  }
}
