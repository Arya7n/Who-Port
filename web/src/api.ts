import type { KillResponse, PortsResponse } from "./types.js";

export async function fetchPorts(): Promise<PortsResponse> {
  const response = await fetch("/api/ports", { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Port list failed (${response.status}).`);
  return (await response.json()) as PortsResponse;
}

export async function killPid(pid: number): Promise<KillResponse> {
  const response = await fetch("/api/kill", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ pid }),
  });
  const body = (await response.json()) as { ok?: boolean; message?: string; error?: string };
  const message = body.message ?? body.error ?? `Stop failed (${response.status}).`;
  return { ok: body.ok === true, message };
}
