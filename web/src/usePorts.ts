import { useCallback, useEffect, useState } from "react";

import { fetchPorts } from "./api.js";
import type { Listener } from "./types.js";

const POLL_MS = 2000;

export interface PortsState {
  listeners: Listener[] | null;
  failed: boolean;
  updatedAt: Date | null;
  retry: () => void;
}

export function usePorts(): PortsState {
  const [listeners, setListeners] = useState<Listener[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);

  const retry = useCallback(() => {
    setTick((value) => value + 1);
  }, []);

  useEffect(() => {
    let timer = 0;
    let stopped = false;
    let loading: Promise<void> | null = null;

    // A focus event during a poll joins it instead of starting a second server lookup.
    const load = (): Promise<void> => {
      loading ??= (async () => {
        try {
          const body = await fetchPorts();
          if (stopped) return;
          setListeners(body.listeners);
          setFailed(false);
          setUpdatedAt(new Date());
        } catch {
          if (stopped) return;
          setFailed(true);
        } finally {
          loading = null;
        }
      })();
      return loading;
    };

    const schedule = (): void => {
      window.clearTimeout(timer);
      if (stopped || document.hidden) return;
      timer = window.setTimeout(() => {
        void load().then(schedule);
      }, POLL_MS);
    };

    const resume = (): void => {
      if (document.hidden) {
        window.clearTimeout(timer);
        return;
      }
      void load().then(schedule);
    };

    void load().then(schedule);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [tick]);

  return { listeners, failed, updatedAt, retry };
}
