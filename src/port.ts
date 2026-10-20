export class PortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortError";
  }
}

const PORT_MESSAGE = "Port must be an integer from 1 to 65535.";

/**
 * Accept only a canonical decimal port.
 * Leading zeros and signs are rejected so a later process argument cannot be smuggled in.
 */
export function parsePort(raw: string): number {
  if (!/^[1-9]\d{0,4}$/.test(raw)) {
    throw new PortError(`${PORT_MESSAGE} Got "${raw}".`);
  }
  const port = Number(raw);
  if (port > 65535) {
    throw new PortError(`${PORT_MESSAGE} Got "${raw}".`);
  }
  return port;
}
