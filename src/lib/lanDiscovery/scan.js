/**
 * Orchestrate LAN discovery probes with concurrency limits (#2025).
 */

import { normalizePorts, resolveScanTargets } from "./cidr.js";
import { mapWithConcurrency, MAX_IN_FLIGHT } from "./concurrency.js";
import { probeEndpoint, PROBE_TIMEOUT_MS } from "./probe.js";

export { DEFAULT_PORTS, MAX_ADDRESSES, MAX_PORTS } from "./cidr.js";
export { MAX_IN_FLIGHT } from "./concurrency.js";
export { PROBE_TIMEOUT_MS } from "./probe.js";

const KINDS = /** @type {const} */ (["ollama", "openai-compatible"]);

/**
 * Validate body and scan named hosts or one CIDR for local LLM endpoints.
 * Does not create connections; returns candidates only.
 *
 * @param {{ hosts?: string[], cidr?: string, ports?: number[] }} body
 * @param {{ fetchImpl?: typeof fetch, maxInFlight?: number, timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: true, candidates: object[] } | { ok: false, error: string }>}
 */
export async function scanLanDiscovery(body, options = {}) {
  const targets = resolveScanTargets(body || {});
  if (!targets.ok) return targets;

  const portsResult = normalizePorts(body?.ports);
  if (!portsResult.ok) return portsResult;

  const { fetchImpl = fetch, maxInFlight = MAX_IN_FLIGHT, timeoutMs = PROBE_TIMEOUT_MS } = options;
  /** @type {Array<() => Promise<object|null>>} */
  const tasks = [];

  for (const host of targets.hosts) {
    for (const port of portsResult.ports) {
      for (const kind of KINDS) {
        tasks.push(() => probeEndpoint({ host, port, kind, fetchImpl, timeoutMs }));
      }
    }
  }

  const results = await mapWithConcurrency(tasks, maxInFlight);
  const candidates = results.filter(Boolean);
  return { ok: true, candidates };
}
