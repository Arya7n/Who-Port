/**
 * One listening TCP socket, independent of which OS produced it.
 * `command` is the process image name, or "" when that lookup failed.
 */
export interface Listener {
  port: number;
  pid: number;
  command: string;
  address: string;
  protocol: "tcp";
}

export interface ListenerQuery {
  listeners: Listener[];
  warnings: string[];
}
