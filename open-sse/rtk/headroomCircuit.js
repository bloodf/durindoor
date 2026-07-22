// Server-safe shared circuit state for the Headroom compression proxy.
// This file is intentionally dependency-free so it can be imported from
// Node (Next.js API routes, server probes) without dragging in browser-only
// or translator code.

const HEADROOM_CIRCUIT = Symbol.for("durindoor.headroomCircuit");

const state = globalThis[HEADROOM_CIRCUIT] ??= { consecutiveFailures: 0, openedAt: 0 };

const CIRCUIT_FAILURE_THRESHOLD = 3;
// After the breaker opens, block calls for this long, then allow ONE probe
// through (half-open). A latching breaker with no recovery — the old behavior —
// stayed degraded until process restart because the early-return in callCompress
// meant a successful call (the only reset path) could never happen again.
const CIRCUIT_COOLDOWN_MS = 60_000;

function now() {
  return Date.now();
}

/**
 * Circuit state. `degraded` (open) is true only while the failure count is at
 * the threshold AND the cooldown window has not elapsed. Once the cooldown
 * passes the circuit is half-open: `degraded` is false so exactly one probe
 * call is allowed; its outcome re-opens (on failure) or closes (on success)
 * the circuit.
 * @returns {{ degraded: boolean, consecutiveFailures: number, halfOpen: boolean }}
 */
export function getHeadroomCircuitState(nowMs = now()) {
  const open = state.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD;
  const cooling = open && (nowMs - state.openedAt) < CIRCUIT_COOLDOWN_MS;
  return {
    degraded: cooling,
    consecutiveFailures: state.consecutiveFailures,
    halfOpen: open && !cooling,
  };
}

export function getHeadroomStatusStats() {
  const s = getHeadroomCircuitState();
  return { ...s, threshold: CIRCUIT_FAILURE_THRESHOLD, cooldownMs: CIRCUIT_COOLDOWN_MS };
}

export function resetHeadroomCircuit() {
  state.consecutiveFailures = 0;
  state.openedAt = 0;
}

export function incrementHeadroomFailures() {
  state.consecutiveFailures += 1;
  // Stamp (or re-stamp) the open time when we reach/exceed the threshold so the
  // cooldown clock restarts on each failure while open — a failing half-open
  // probe re-arms the full cooldown instead of immediately allowing another.
  if (state.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.openedAt = now();
  }
}

export function markHeadroomCircuitHealthy() {
  resetHeadroomCircuit();
}
