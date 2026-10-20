/** Windows prints IPv6 locals as `[addr]:port`. The port is the suffix after `]`, not the last colon. */
export function splitHostPort(local: string): { address: string; port: number } | null {
  let address: string;
  let portText: string;

  if (local.startsWith("[")) {
    const bracket = local.indexOf("]");
    if (bracket <= 1) return null;
    const rest = local.slice(bracket + 1);
    if (!rest.startsWith(":")) return null;
    address = local.slice(1, bracket);
    portText = rest.slice(1);
  } else {
    const colon = local.lastIndexOf(":");
    if (colon <= 0) return null;
    address = local.slice(0, colon);
    portText = local.slice(colon + 1);
  }

  if (address.length === 0 || !/^\d+$/.test(portText)) return null;
  const port = Number(portText);
  if (port < 1 || port > 65535) return null;
  return { address, port };
}
