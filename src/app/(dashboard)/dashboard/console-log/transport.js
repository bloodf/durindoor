import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";

/** Reports confirmed transport state; an empty snapshot is valid only after a successful read. */
export function startConsoleLogTransport({
  onSnapshot,
  onEvent,
  onStatus = () => {},
  fetchImpl = globalThis.fetch,
  EventSourceImpl = globalThis.EventSource,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
  pollIntervalMs = CONSOLE_LOG_CONFIG.pollIntervalMs,
  streamTimeoutMs = CONSOLE_LOG_CONFIG.streamTimeoutMs,
}) {
  let stopped = false;
  let polling = false;
  let source = null;
  let watchdog = null;
  let pollTimer = null;
  let etag = null;
  const report = (state, error = "") => { if (!stopped) onStatus({ state, error }); };
  report("connecting");

  const clearWatchdog = () => {
    if (!watchdog) return;
    clearTimeoutImpl(watchdog);
    watchdog = null;
  };

  const fetchSnapshot = async () => {
    const headers = etag ? { "If-None-Match": etag } : undefined;
    const response = await fetchImpl("/api/translator/console-logs", {
      cache: "no-store",
      headers,
    });
    if (stopped) return;
    if (response.status === 304) { report(polling ? "polling" : "connecting"); return; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (stopped) return;
    etag = response.headers?.get?.("etag") || null;
    if (!data.success || !Array.isArray(data.logs)) throw new Error("Invalid console log snapshot");
    onSnapshot(data.logs);
    report(polling ? "polling" : "connecting");
  };

  const poll = async () => {
    if (stopped || !polling) return;
    try {
      await fetchSnapshot();
    } catch (error) {
      report("unavailable", error.message || "Console logs could not be refreshed");
    }
    if (!stopped && polling) {
      pollTimer = setTimeoutImpl(poll, pollIntervalMs);
    }
  };

  const switchToPolling = () => {
    if (stopped || polling) return Promise.resolve();
    polling = true;
    report("reconnecting");
    clearWatchdog();
    source?.close();
    source = null;
    return poll();
  };

  const startStream = () => {
    if (stopped) return;
    if (!EventSourceImpl) {
      switchToPolling();
      return;
    }

    try {
      source = new EventSourceImpl("/api/translator/console-logs/stream");
    } catch {
      void switchToPolling();
      return;
    }
    source.onopen = () => { clearWatchdog(); report("streaming"); };
    source.onmessage = (event) => {
      if (stopped) return;
      clearWatchdog();
      etag = null;
      try {
        onEvent(JSON.parse(event.data));
        report("streaming");
      } catch (error) {
        report("unavailable", error.message || "Invalid console log event");
      }
    };
    source.onerror = switchToPolling;
    watchdog = setTimeoutImpl(switchToPolling, streamTimeoutMs);
  };

  const ready = Promise.resolve(fetchSnapshot())
    .catch((error) => report("unavailable", error.message || "Console logs could not be loaded"))
    .finally(startStream);

  return {
    ready,
    invalidate() {
      etag = null;
    },
    stop() {
      stopped = true;
      polling = false;
      clearWatchdog();
      if (pollTimer) clearTimeoutImpl(pollTimer);
      source?.close();
    },
  };
}
