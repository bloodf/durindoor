/**
 * @file connectionCircuitState.js
 * @description In-memory per-connection circuit state machine for routing resilience (#1108).
 *
 * Implements bounded transitions across CLOSED (healthy), OPEN (cooldown active),
 * and HALF_OPEN (cooldown expired, awaiting bounded recovery probe attempt).
 *
 * Design constraints:
 * - Pure transition & recovery lease management without database or provider imports.
 * - Single-flight recovery probe lease per connection and bounded model scope.
 * - Account-wide scope (__all) supersedes and excludes model-specific probes.
 * - Invalidation of stale recovery completions across manual resets, lease timeouts,
 *   or newer provider failure generations.
 * - Abort / cancellation / request-level rejection releases lease without incrementing
 *   failure backoff or falsely closing the circuit.
 * - Safe allowlisted diagnostic projections without leaking credentials or error bodies.
 */

export const CIRCUIT_STATE = Object.freeze({
  CLOSED: "CLOSED",
  OPEN: "OPEN",
  HALF_OPEN: "HALF_OPEN",
});

/** Scope key for account-level locks */
export const SCOPE_ALL = "__all";

/** Default timeout after which an uncompleted half-open probe lease expires */
export const DEFAULT_LEASE_TIMEOUT_MS = 30_000;

function normalizeScope(scope) {
  if (!scope || scope === SCOPE_ALL) return SCOPE_ALL;
  return String(scope);
}

/**
 * Composite key for per-connection, per-scope circuit registration.
 */
function makeKey(connectionId, scope) {
  return JSON.stringify([connectionId, normalizeScope(scope)]);
}

class ConnectionCircuitManager {
  constructor(options = {}) {
    this.leaseTimeoutMs = options.leaseTimeoutMs || DEFAULT_LEASE_TIMEOUT_MS;
    // Map<compositeKey, ScopeCircuitState>
    this._circuits = new Map();
    // Generation counter for monotonic generation fencing
    this._generationCounter = 1;
  }

  _getOrCreateCircuit(connectionId, scope) {
    const key = makeKey(connectionId, scope);
    let state = this._circuits.get(key);
    if (!state) {
      state = {
        connectionId,
        scope: normalizeScope(scope),
        state: CIRCUIT_STATE.CLOSED,
        generation: this._generationCounter++,
        activeLease: null, // { leaseToken, generation, expiresAt, startedAt }
        lastFailureAt: null,
        cooldownUntil: null,
      };
      this._circuits.set(key, state);
    }
    return state;
  }

  /**
   * Determine the current circuit state for a connection and scope given an expiry timestamp.
   *
   * @param {string} connectionId
   * @param {string|null} scope - Model identity or null/__all for account-wide
   * @param {number|string|Date|null} cooldownUntil - Cooldown deadline from connection/fallback locks
   * @param {number} [now]
   * @returns {string} One of CIRCUIT_STATE (CLOSED, OPEN, HALF_OPEN)
   */
  evaluateState(connectionId, scope, cooldownUntil, now = Date.now()) {
    const normScope = normalizeScope(scope);

    // If account-level lock exists and is OPEN, it governs
    if (normScope !== SCOPE_ALL) {
      const accountCircuit = this._circuits.get(makeKey(connectionId, SCOPE_ALL));
      if (accountCircuit) {
        const acctState = this._evaluateCircuit(accountCircuit, accountCircuit.cooldownUntil, now);
        if (acctState === CIRCUIT_STATE.OPEN) {
          return CIRCUIT_STATE.OPEN;
        }
        if (acctState === CIRCUIT_STATE.HALF_OPEN && accountCircuit.activeLease) {
          // Account is under half-open probe, competing models cannot dispatch
          return CIRCUIT_STATE.OPEN;
        }
      }
    }

    const circuit = this._getOrCreateCircuit(connectionId, normScope);
    if (cooldownUntil !== undefined) {
      const ts = cooldownUntil ? new Date(cooldownUntil).getTime() : null;
      const deadline = Number.isFinite(ts) ? ts : null;
      if (deadline !== circuit.cooldownUntil) {
        circuit.generation = this._generationCounter++;
        circuit.activeLease = null;
        if (deadline !== null) circuit.state = CIRCUIT_STATE.OPEN;
        else circuit.state = CIRCUIT_STATE.CLOSED;
      }
      circuit.cooldownUntil = deadline;
    }

    return this._evaluateCircuit(circuit, circuit.cooldownUntil, now);
  }

  _evaluateCircuit(circuit, cooldownUntil, now) {
    if (!cooldownUntil || cooldownUntil <= now) {
      // Cooldown is not active or has expired
      if (circuit.state === CIRCUIT_STATE.OPEN) {
        // Cooldown just expired -> transition to HALF_OPEN
        circuit.state = CIRCUIT_STATE.HALF_OPEN;
        // Expired lease cleanup
        if (circuit.activeLease && circuit.activeLease.expiresAt <= now) {
          circuit.activeLease = null;
        }
      } else if (circuit.state === CIRCUIT_STATE.HALF_OPEN) {
        if (circuit.activeLease && circuit.activeLease.expiresAt <= now) {
          // Expired lease without settlement
          circuit.activeLease = null;
        }
      }
      return circuit.state;
    }

    // Cooldown is in the future
    circuit.state = CIRCUIT_STATE.OPEN;
    if (circuit.activeLease) {
      circuit.activeLease = null;
    }
    return CIRCUIT_STATE.OPEN;
  }

  /**
   * Check whether a request can execute or acquire a recovery lease.
   *
   * @param {string} connectionId
   * @param {string|null} scope
   * @param {number|string|Date|null} cooldownUntil
   * @param {number} [now]
   * @returns {boolean}
   */
  canExecute(connectionId, scope, cooldownUntil, now = Date.now()) {
    const currentState = this.evaluateState(connectionId, scope, cooldownUntil, now);
    if (currentState === CIRCUIT_STATE.CLOSED) return true;
    if (currentState === CIRCUIT_STATE.OPEN) return false;

    // HALF_OPEN: only allowed if no active recovery lease is in flight
    const normScope = normalizeScope(scope);
    const circuit = this._getOrCreateCircuit(connectionId, normScope);
    if (circuit.activeLease && circuit.activeLease.expiresAt > now) {
      return false; // Probe already in flight
    }

    // If checking model scope, check if account-wide probe is already in flight
    if (normScope !== SCOPE_ALL) {
      const accountCircuit = this._circuits.get(makeKey(connectionId, SCOPE_ALL));
      if (accountCircuit?.activeLease && accountCircuit.activeLease.expiresAt > now) {
        return false;
      }
    }

    return true;
  }

  /**
   * Acquire a recovery lease for a half-open connection.
   *
   * @param {string} connectionId
   * @param {string|null} scope
   * @param {number|string|Date|null} cooldownUntil
   * @param {object} [options]
   * @param {number} [options.now]
   * @param {number} [options.timeoutMs]
   * @returns {{ acquired: boolean, leaseToken?: string, generation?: number, reason?: string }}
   */
  acquireRecoveryLease(connectionId, scope, cooldownUntil, options = {}) {
    const now = options.now ?? Date.now();
    const timeoutMs = options.timeoutMs || this.leaseTimeoutMs;
    const currentState = this.evaluateState(connectionId, scope, cooldownUntil, now);

    if (currentState === CIRCUIT_STATE.CLOSED) {
      return { acquired: false, reason: "CIRCUIT_CLOSED" };
    }
    if (currentState === CIRCUIT_STATE.OPEN) {
      return { acquired: false, reason: "CIRCUIT_OPEN" };
    }

    const normScope = normalizeScope(scope);
    if (normScope === SCOPE_ALL) {
      for (const sibling of this._circuits.values()) {
        if (sibling.connectionId === connectionId && sibling.scope !== SCOPE_ALL &&
            sibling.activeLease?.expiresAt > now) {
          return { acquired: false, reason: "MODEL_PROBE_IN_FLIGHT" };
        }
      }
    }

    // If model scope, ensure no account-level probe is holding the account
    if (normScope !== SCOPE_ALL) {
      const accountCircuit = this._circuits.get(makeKey(connectionId, SCOPE_ALL));
      if (accountCircuit?.activeLease && accountCircuit.activeLease.expiresAt > now) {
        return { acquired: false, reason: "ACCOUNT_WIDE_PROBE_IN_FLIGHT" };
      }
    }

    const circuit = this._getOrCreateCircuit(connectionId, normScope);

    // If existing lease is still active, reject competing probe
    if (circuit.activeLease && circuit.activeLease.expiresAt > now) {
      return { acquired: false, reason: "PROBE_IN_FLIGHT" };
    }

    const leaseToken = `lease_${connectionId}_${normScope}_${this._generationCounter++}_${Math.random().toString(36).slice(2, 9)}`;
    const lease = {
      leaseToken,
      generation: circuit.generation,
      startedAt: now,
      expiresAt: now + timeoutMs,
    };

    circuit.activeLease = lease;
    return {
      acquired: true,
      leaseToken,
      generation: lease.generation,
      expiresAt: lease.expiresAt,
    };
  }

  /**
   * Settle an active recovery probe attempt.
   *
   * @param {string} connectionId
   * @param {string|null} scope
   * @param {string} leaseToken
   * @param {object} outcome
   * @param {boolean} outcome.success - Whether the request completed successfully
   * @param {boolean} [outcome.aborted] - Whether request was cancelled / aborted locally
   * @param {boolean} [outcome.requestScoped] - Client error (400, rejected) not at fault of credential
   * @param {number|string|Date|null} [outcome.newCooldownUntil] - New cooldown if provider failed
   * @param {number} [options.now]
   * @returns {{ settled: boolean, state: string, reason?: string }}
   */
  settleRecovery(connectionId, scope, leaseToken, outcome, options = {}) {
    const now = options.now ?? Date.now();
    const normScope = normalizeScope(scope);
    const circuit = this._circuits.get(makeKey(connectionId, normScope));

    if (!circuit) {
      return { settled: false, state: CIRCUIT_STATE.CLOSED, reason: "NO_CIRCUIT" };
    }

    const lease = circuit.activeLease;
    if (!lease || lease.leaseToken !== leaseToken) {
      // Lease does not match (already expired, replaced, or reset)
      return { settled: false, state: circuit.state, reason: "INVALID_LEASE" };
    }

    if (lease.generation !== circuit.generation) {
      circuit.activeLease = null;
      return { settled: false, state: circuit.state, reason: "STALE_GENERATION" };
    }

    if (lease.expiresAt <= now) {
      circuit.activeLease = null;
      return { settled: false, state: circuit.state, reason: "EXPIRED_LEASE" };
    }

    // Lease valid and matching
    circuit.activeLease = null;

    if (outcome.aborted || outcome.requestScoped) {
      // Released without counting failure or claiming recovery
      return { settled: true, state: circuit.state, reason: outcome.aborted ? "ABORTED" : "REQUEST_SCOPED" };
    }

    if (outcome.success) {
      // Recovery confirmed -> close circuit
      circuit.state = CIRCUIT_STATE.CLOSED;
      circuit.cooldownUntil = null;
      circuit.lastFailureAt = null;
      return { settled: true, state: CIRCUIT_STATE.CLOSED, reason: "RECOVERY_SUCCESS" };
    }

    // Provider failed during probe -> reopen circuit
    circuit.state = CIRCUIT_STATE.OPEN;
    circuit.generation = this._generationCounter++;
    circuit.lastFailureAt = now;
    if (outcome.newCooldownUntil) {
      const cd = new Date(outcome.newCooldownUntil).getTime();
      circuit.cooldownUntil = Number.isFinite(cd) ? cd : null;
    }
    return { settled: true, state: CIRCUIT_STATE.OPEN, reason: "PROBE_FAILED" };
  }

  /**
   * Release a recovery lease immediately (e.g. before dispatch, validation error, early abort).
   *
   * @param {string} connectionId
   * @param {string|null} scope
   * @param {string} leaseToken
   * @returns {boolean}
   */
  releaseLease(connectionId, scope, leaseToken) {
    const normScope = normalizeScope(scope);
    const circuit = this._circuits.get(makeKey(connectionId, normScope));
    if (!circuit || !circuit.activeLease) return false;
    if (circuit.activeLease.leaseToken === leaseToken) {
      circuit.activeLease = null;
      return true;
    }
    return false;
  }

  /**
   * Reset the circuit for a connection and optional scope (e.g. manual provider reactivation).
   * Bumps generation so any in-flight completion becomes stale.
   *
   * @param {string} connectionId
   * @param {string|null} [scope] - Specific scope or null for all scopes on connection
   */
  reset(connectionId, scope = null) {
    if (scope !== null && scope !== undefined) {
      const normScope = normalizeScope(scope);
      const circuit = this._circuits.get(makeKey(connectionId, normScope));
      if (circuit) {
        circuit.state = CIRCUIT_STATE.CLOSED;
        circuit.cooldownUntil = null;
        circuit.activeLease = null;
        circuit.generation = this._generationCounter++;
      }
    } else {
      // Clear all circuits for this connectionId
      for (const [key, circuit] of this._circuits.entries()) {
        if (circuit.connectionId === connectionId) {
          circuit.state = CIRCUIT_STATE.CLOSED;
          circuit.cooldownUntil = null;
          circuit.activeLease = null;
          circuit.generation = this._generationCounter++;
        }
      }
    }
  }

  /**
   * Expose allowlisted diagnostic summary without leaking credentials or raw errors.
   *
   * @param {string} connectionId
   * @param {string|null} scope
   * @param {number} [now]
   * @returns {object}
   */
  getDiagnostics(connectionId, scope, now = Date.now()) {
    const normScope = normalizeScope(scope);
    const circuit = this._circuits.get(makeKey(connectionId, normScope));
    if (!circuit) {
      return {
        connectionId,
        scope: normScope,
        state: CIRCUIT_STATE.CLOSED,
        probeInFlight: false,
        retryAfterMs: 0,
      };
    }

    const state = this._evaluateCircuit(circuit, circuit.cooldownUntil, now);
    const probeInFlight = Boolean(circuit.activeLease && circuit.activeLease.expiresAt > now);
    let retryAfterMs = 0;
    if (circuit.cooldownUntil && circuit.cooldownUntil > now) {
      retryAfterMs = circuit.cooldownUntil - now;
    }

    return {
      connectionId,
      scope: normScope,
      state,
      probeInFlight,
      retryAfterMs,
    };
  }
}

/** Global singleton instance for in-process per-connection circuit state */
const globalCircuitManager = new ConnectionCircuitManager();

export { ConnectionCircuitManager, globalCircuitManager };
