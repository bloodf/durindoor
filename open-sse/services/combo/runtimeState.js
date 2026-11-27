/**
 * Process-local combo routing state (#2266).
 *
 * Next.js can load more than one copy of a server module in one process (route
 * bundles, the instrumentation hook, dev reloads). Like concurrencyGate.js,
 * payloadAdmission.js and operationalMetrics.js, combo state hangs off one
 * `globalThis.__durindoor*` slot, so every module copy reads, writes and resets
 * the same Maps. The state is NOT shared between processes, containers or
 * replicas: each worker keeps its own rotation pointers, sticky pins and smart
 * scores, and a reset clears only the process that received it.
 */

const STATE_KEY = "__durindoorComboRuntime";

function createState() {
  return {
    // comboName -> { index, consecutiveUseCount }
    rotation: new Map(),
    // comboName -> smooth weighted round-robin state
    weightedRotation: new Map(),
    // affinityKey -> { index, lastUsed, scope }; exported for tests
    affinity: new Map(),
    // scope -> Set<affinityKey>, ordered least recently used first
    affinityScopes: new Map(),
    // comboName -> Map<modelStr, { score, lastSuccessMs, lastErrorMs }>
    scoring: new Map(),
  };
}

/**
 * Return the single runtime state object for this process. A copy created by an
 * older module version may lack newer fields, so missing Maps are added in place
 * rather than replacing the object other copies already hold.
 * @returns {ReturnType<typeof createState>}
 */
export function getComboRuntimeState() {
  const state = globalThis[STATE_KEY] ??= createState();
  for (const [field, value] of Object.entries(createState())) state[field] ??= value;
  return state;
}
