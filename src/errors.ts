export type ToolErrorCode = "missing" | "failed" | "unsupported";

/** A platform tool is missing, refused, or not implemented. Callers print `message` and exit. */
export class ToolError extends Error {
  readonly code: ToolErrorCode;

  constructor(code: ToolErrorCode, message: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}
