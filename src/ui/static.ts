import { extname, isAbsolute, relative, resolve } from "node:path";

export type StaticDecision = { kind: "pass" } | { kind: "reject" } | { kind: "index" } | { kind: "asset"; name: string };

function unsafe(value: string): boolean {
  if (value.includes("\0") || value.includes("\\")) return true;
  return value.split("/").some((part) => part === "..");
}

/** `..`, its encodings, backslashes, and null bytes are rejected before any filesystem call. */
export function classifyStaticUrl(rawUrl: string): StaticDecision {
  const hash = rawUrl.indexOf("#");
  const withoutHash = hash === -1 ? rawUrl : rawUrl.slice(0, hash);
  const question = withoutHash.indexOf("?");
  let current = question === -1 ? withoutHash : withoutHash.slice(0, question);
  if (current.toLowerCase().includes("%00")) return { kind: "reject" };

  for (let layer = 0; layer < 3; layer += 1) {
    if (unsafe(current)) return { kind: "reject" };
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return { kind: "reject" };
    }
    if (decoded === current) break;
    current = decoded;
  }
  if (unsafe(current)) return { kind: "reject" };

  if (current === "/") return { kind: "index" };
  if (!current.startsWith("/assets/")) return { kind: "pass" };
  const name = current.slice("/assets/".length);
  if (name.length === 0 || name.endsWith("/") || name.includes(":") || unsafe(`/${name}`)) return { kind: "reject" };
  return { kind: "asset", name };
}

export function fileInsideRoot(root: string, relativeName: string): string | null {
  if (unsafe(relativeName) || relativeName.includes(":") || isAbsolute(relativeName)) return null;
  const base = resolve(root);
  const target = resolve(base, relativeName);
  const rel = relative(base, target);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return target;
}

/** Compares realpaths, so a symlink cannot leave the root. */
export function sameOrInside(rootReal: string, fileReal: string): boolean {
  const rel = relative(resolve(rootReal), resolve(fileReal));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export function staticContentType(fileName: string): string {
  switch (extname(fileName).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

export function staticCacheControl(kind: "index" | "asset"): string {
  if (kind === "index") return "no-store";
  return "public, max-age=31536000, immutable";
}
