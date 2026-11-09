import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CIRCUIT_STATE,
  ConnectionCircuitManager,
  DEFAULT_LEASE_TIMEOUT_MS,
  SCOPE_ALL,
} from "../../src/lib/routing/connectionCircuitState.js";

const MODEL = "claude-3-7-sonnet";
const SIBLING_MODEL = "claude-3-5-haiku";
const CONN_A = "conn-provider-alpha";
const CONN_B = "conn-provider-beta";
const NOW = new Date("2026-11-07T12:00:00.000Z").getTime();
const EXPIRED = new Date("2026-11-07T11:59:00.000Z").getTime();
const ACTIVE_COOLDOWN = new Date("2026-11-07T12:05:00.000Z").getTime();

describe("ConnectionCircuitManager (#1108)", () => {
  let manager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    manager = new ConnectionCircuitManager({ leaseTimeoutMs: 10_000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Initial & Healthy State", () => {
    it("starts in CLOSED state with no locks or history", () => {
      expect(manager.evaluateState(CONN_A, MODEL, null, NOW)).toBe(CIRCUIT_STATE.CLOSED);
      expect(manager.canExecute(CONN_A, MODEL, null, NOW)).toBe(true);

      const diag = manager.getDiagnostics(CONN_A, MODEL, NOW);
      expect(diag.state).toBe(CIRCUIT_STATE.CLOSED);
      expect(diag.probeInFlight).toBe(false);
      expect(diag.retryAfterMs).toBe(0);
    });

    it("rejects lease acquisition when circuit is CLOSED", () => {
      const lease = manager.acquireRecoveryLease(CONN_A, MODEL, null, { now: NOW });
      expect(lease.acquired).toBe(false);
      expect(lease.reason).toBe("CIRCUIT_CLOSED");
    });
  });

  describe("Open & Cooldown Transitions", () => {
    it("transitions to OPEN when cooldown is active in the future", () => {
      expect(manager.evaluateState(CONN_A, MODEL, ACTIVE_COOLDOWN, NOW)).toBe(CIRCUIT_STATE.OPEN);
      expect(manager.canExecute(CONN_A, MODEL, ACTIVE_COOLDOWN, NOW)).toBe(false);

      const lease = manager.acquireRecoveryLease(CONN_A, MODEL, ACTIVE_COOLDOWN, { now: NOW });
      expect(lease.acquired).toBe(false);
      expect(lease.reason).toBe("CIRCUIT_OPEN");

      const diag = manager.getDiagnostics(CONN_A, MODEL, NOW);
      expect(diag.state).toBe(CIRCUIT_STATE.OPEN);
      expect(diag.retryAfterMs).toBe(ACTIVE_COOLDOWN - NOW);
    });

    it("keeps sibling connection unaffected when connection A is OPEN", () => {
      manager.evaluateState(CONN_A, MODEL, ACTIVE_COOLDOWN, NOW);
      expect(manager.canExecute(CONN_B, MODEL, null, NOW)).toBe(true);
      expect(manager.evaluateState(CONN_B, MODEL, null, NOW)).toBe(CIRCUIT_STATE.CLOSED);
    });
  });

  describe("Half-Open & Recovery Lease Admission", () => {
    it("transitions from OPEN to HALF_OPEN when cooldown expires", () => {
      // First open it
      manager.evaluateState(CONN_A, MODEL, ACTIVE_COOLDOWN, NOW);
      expect(manager.evaluateState(CONN_A, MODEL, ACTIVE_COOLDOWN, NOW)).toBe(CIRCUIT_STATE.OPEN);

      // Advance clock past cooldown
      const afterCooldown = ACTIVE_COOLDOWN + 1000;
      vi.setSystemTime(afterCooldown);

      expect(manager.evaluateState(CONN_A, MODEL, ACTIVE_COOLDOWN, afterCooldown)).toBe(CIRCUIT_STATE.HALF_OPEN);
      expect(manager.canExecute(CONN_A, MODEL, ACTIVE_COOLDOWN, afterCooldown)).toBe(true);
    });

    it("admits exactly one recovery probe and rejects concurrent probes", () => {
      // Setup expired lock
      manager.evaluateState(CONN_A, MODEL, EXPIRED, NOW);

      // First recovery probe request
      const first = manager.acquireRecoveryLease(CONN_A, MODEL, EXPIRED, { now: NOW });
      expect(first.acquired).toBe(true);
      expect(first.leaseToken).toBeDefined();

      // Subsequent concurrent requests while first probe is in flight
      expect(manager.canExecute(CONN_A, MODEL, EXPIRED, NOW)).toBe(false);

      const second = manager.acquireRecoveryLease(CONN_A, MODEL, EXPIRED, { now: NOW });
      expect(second.acquired).toBe(false);
      expect(second.reason).toBe("PROBE_IN_FLIGHT");

      const diag = manager.getDiagnostics(CONN_A, MODEL, NOW);
      expect(diag.state).toBe(CIRCUIT_STATE.HALF_OPEN);
      expect(diag.probeInFlight).toBe(true);
    });

    it("releases lease on local abort without false failure or recovery", () => {
      manager.evaluateState(CONN_A, MODEL, EXPIRED, NOW);
      const lease = manager.acquireRecoveryLease(CONN_A, MODEL, EXPIRED, { now: NOW });
      expect(lease.acquired).toBe(true);

      const settlement = manager.settleRecovery(CONN_A, MODEL, lease.leaseToken, { aborted: true }, { now: NOW });
      expect(settlement.settled).toBe(true);
      expect(settlement.reason).toBe("ABORTED");
      expect(settlement.state).toBe(CIRCUIT_STATE.HALF_OPEN);

      // Now another probe can be admitted
      expect(manager.canExecute(CONN_A, MODEL, EXPIRED, NOW)).toBe(true);
      const nextLease = manager.acquireRecoveryLease(CONN_A, MODEL, EXPIRED, { now: NOW });
      expect(nextLease.acquired).toBe(true);
    });

    it("releases lease on request-scoped client error (e.g. 400 bad request)", () => {
      manager.evaluateState(CONN_A, MODEL, EXPIRED, NOW);
      const lease = manager.acquireRecoveryLease(CONN_A, MODEL, EXPIRED, { now: NOW });
      expect(lease.acquired).toBe(true);

      const settlement = manager.settleRecovery(CONN_A, MODEL, lease.leaseToken, { requestScoped: true }, { now: NOW });
      expect(settlement.settled).toBe(true);
      expect(settlement.reason).toBe("REQUEST_SCOPED");
      expect(settlement.state).toBe(CIRCUIT_STATE.HALF_OPEN);
    });

    it("closes circuit on successful recovery probe", () => {
      manager.evaluateState(CONN_A, MODEL, EXPIRED, NOW);
      const lease = manager.acquireRecoveryLease(CONN_A, MODEL, EXPIRED, { now: NOW });
      expect(lease.acquired).toBe(true);

      const settlement = manager.settleRecovery(CONN_A, MODEL, lease.leaseToken, { success: true }, { now: NOW });
      expect(settlement.settled).toBe(true);
      expect(settlement.state).toBe(CIRCUIT_STATE.CLOSED);
      expect(settlement.reason).toBe("RECOVERY_SUCCESS");

      expect(manager.evaluateState(CONN_A, MODEL, null, NOW)).toBe(CIRCUIT_STATE.CLOSED);
      expect(manager.canExecute(CONN_A, MODEL, null, NOW)).toBe(true);
    });

    it("reopens circuit on failed recovery probe with new cooldown", () => {
      manager.evaluateState(CONN_A, MODEL, EXPIRED, NOW);
      const lease = manager.acquireRecoveryLease(CONN_A, MODEL, EXPIRED, { now: NOW });
      expect(lease.acquired).toBe(true);

      const newCooldown = NOW + 60_000;
      const settlement = manager.settleRecovery(CONN_A, MODEL, lease.leaseToken, {
        success: false,
        newCooldownUntil: newCooldown,
      }, { now: NOW });

      expect(settlement.settled).toBe(true);
      expect(settlement.state).toBe(CIRCUIT_STATE.OPEN);
      expect(settlement.reason).toBe("PROBE_FAILED");

      expect(manager.canExecute(CONN_A, MODEL, newCooldown, NOW)).toBe(false);
    });
  });

  describe("Account-Wide Lock Precedence & Cross-Model Isolation", () => {
    it("account-wide OPEN circuit blocks all models on the connection", () => {
      manager.evaluateState(CONN_A, SCOPE_ALL, ACTIVE_COOLDOWN, NOW);

      expect(manager.evaluateState(CONN_A, MODEL, null, NOW)).toBe(CIRCUIT_STATE.OPEN);
      expect(manager.canExecute(CONN_A, MODEL, null, NOW)).toBe(false);

      expect(manager.evaluateState(CONN_A, SIBLING_MODEL, null, NOW)).toBe(CIRCUIT_STATE.OPEN);
      expect(manager.canExecute(CONN_A, SIBLING_MODEL, null, NOW)).toBe(false);
    });

    it("account-wide in-flight recovery probe excludes competing model probes", () => {
      manager.evaluateState(CONN_A, SCOPE_ALL, EXPIRED, NOW);
      const acctLease = manager.acquireRecoveryLease(CONN_A, SCOPE_ALL, EXPIRED, { now: NOW });
      expect(acctLease.acquired).toBe(true);

      // Model-specific probe cannot be acquired
      const modelLease = manager.acquireRecoveryLease(CONN_A, MODEL, EXPIRED, { now: NOW });
      expect(modelLease.acquired).toBe(false);
      expect(modelLease.reason).toBe("ACCOUNT_WIDE_PROBE_IN_FLIGHT");
      expect(manager.canExecute(CONN_A, MODEL, EXPIRED, NOW)).toBe(false);
    });

    it("model-specific recovery failure does not open sibling model if account lock is not present", () => {
      manager.evaluateState(CONN_A, MODEL, ACTIVE_COOLDOWN, NOW);
      expect(manager.canExecute(CONN_A, MODEL, ACTIVE_COOLDOWN, NOW)).toBe(false);

      // Sibling model has no lock
      expect(manager.canExecute(CONN_A, SIBLING_MODEL, null, NOW)).toBe(true);
      expect(manager.evaluateState(CONN_A, SIBLING_MODEL, null, NOW)).toBe(CIRCUIT_STATE.CLOSED);
    });
  });

  describe("Generation Fencing, Resets, and Lease Expiry", () => {
    it("invalidates in-flight probe when manual reset occurs", () => {
      manager.evaluateState(CONN_A, MODEL, EXPIRED, NOW);
      const lease = manager.acquireRecoveryLease(CONN_A, MODEL, EXPIRED, { now: NOW });
      expect(lease.acquired).toBe(true);

      // Admin or system performs manual reset
      manager.reset(CONN_A, MODEL);

      // Late probe completion from old generation arrives
      const settlement = manager.settleRecovery(CONN_A, MODEL, lease.leaseToken, { success: false, newCooldownUntil: NOW + 10_000 }, { now: NOW });
      expect(settlement.settled).toBe(false);
      expect(settlement.reason).toBe("STALE_GENERATION");

      // Circuit remains CLOSED from the reset
      expect(manager.evaluateState(CONN_A, MODEL, null, NOW)).toBe(CIRCUIT_STATE.CLOSED);
    });

    it("allows new lease after probe lease times out", () => {
      manager.evaluateState(CONN_A, MODEL, EXPIRED, NOW);
      const lease = manager.acquireRecoveryLease(CONN_A, MODEL, EXPIRED, { now: NOW, timeoutMs: 5000 });
      expect(lease.acquired).toBe(true);

      // Advance clock past lease timeout
      const afterTimeout = NOW + 6000;
      vi.setSystemTime(afterTimeout);

      expect(manager.canExecute(CONN_A, MODEL, EXPIRED, afterTimeout)).toBe(true);
      const replacementLease = manager.acquireRecoveryLease(CONN_A, MODEL, EXPIRED, { now: afterTimeout });
      expect(replacementLease.acquired).toBe(true);
      expect(replacementLease.leaseToken).not.toBe(lease.leaseToken);
    });

    it("explicit releaseLease frees the probe immediately", () => {
      manager.evaluateState(CONN_A, MODEL, EXPIRED, NOW);
      const lease = manager.acquireRecoveryLease(CONN_A, MODEL, EXPIRED, { now: NOW });
      expect(lease.acquired).toBe(true);

      const released = manager.releaseLease(CONN_A, MODEL, lease.leaseToken);
      expect(released).toBe(true);

      // Another lease can now be acquired immediately
      expect(manager.canExecute(CONN_A, MODEL, EXPIRED, NOW)).toBe(true);
      const nextLease = manager.acquireRecoveryLease(CONN_A, MODEL, EXPIRED, { now: NOW });
      expect(nextLease.acquired).toBe(true);
    });
  });
});
