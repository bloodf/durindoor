// Server-safe shared circuit state for the Headroom compression proxy.
// This file is intentionally dependency-free so it can be imported from
// Node (Next.js API routes, server probes) without dragging in browser-only
// or translator code.

const HEADROOM_CIRCUIT = Symbol.for("durindoor.headroomCircuit");

const state = globalThis[HEADROOM_CIRCUIT] ??= { consecutiveFailures: 0 };

const CIRCUIT_FAILURE_THRESHOLD = 3;

/** @returns {{ degraded: boolean, consecutiveFailures: number }} */
export function getHeadroomCircuitState() {
  return { degraded: state.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD, consecutiveFailures: state.consecutiveFailures };
}

export function getHeadroomStatusStats() {
  return { ...getHeadroomCircuitState(), threshold: CIRCUIT_FAILURE_THRESHOLD };
}

export function resetHeadroomCircuit() {
  state.consecutiveFailures = 0;
}

export function incrementHeadroomFailures() {
  state.consecutiveFailures += 1;
}

export function markHeadroomCircuitHealthy() {
  state.consecutiveFailures = 0;
}
