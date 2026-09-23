import { createHash, randomUUID } from "node:crypto";
import {
  QUOTA_SELECTION_DEFAULTS,
  resolveQuotaLeaseMs,
  resolveQuotaRoutingFloor,
} from "open-sse/config/quotaSelection.js";
import { rankQuotaCandidates } from "open-sse/services/quota/scoring.js";
import { quotaIdentityKey } from "@/shared/utils/quotaSnapshot";
import { QuotaDispatchUnavailableError } from "open-sse/services/quota/dispatch.js";

const OWNER_EPOCH = createHash("sha256")
  .update(`${randomUUID()}:${process.pid}:${Date.now()}`)
  .digest("hex");

function healthOf(connection) {
  if (connection?.testStatus === "unavailable" || connection?.isActive === false) return "unhealthy";
  if (connection?.testStatus === "degraded") return "degraded";
  return "healthy";
}

function isProfileBelowRoutingFloor(profile, config, connectionId, provider) {
  const windows = Array.isArray(profile?.routingWindows) ? profile.routingWindows : [];
  if (windows.length === 0) return { blocked: false, ratio: QUOTA_SELECTION_DEFAULTS.routingFloorRatio };
  const evaluated = windows.map((window) => {
    const floor = resolveQuotaRoutingFloor(config, {
      connectionId,
      provider,
      dimensionKey: window.dimensionKey,
    });
    return {
      blocked: floor.enabled
        && window.ratio <= floor.ratio + QUOTA_SELECTION_DEFAULTS.routingFloorEpsilon,
      ratio: floor.ratio,
    };
  });
  const blocked = profile.gateMode === "any-sufficient"
    ? evaluated.every((window) => window.blocked)
    : evaluated.some((window) => window.blocked);
  return {
    blocked,
    ratio: evaluated.find((window) => window.blocked)?.ratio
      ?? QUOTA_SELECTION_DEFAULTS.routingFloorRatio,
  };
}

function applyReservationDebits(profile, pressureState, connectionId, provider) {
  const alternatives = Array.isArray(profile?.reservationAlternatives)
    ? profile.reservationAlternatives
    : [];
  const debits = pressureState?.debits;
  if (alternatives.length === 0 || !(debits instanceof Map) || debits.size === 0) return profile;

  const ratioByWindow = new Map();
  const alternativeRatios = alternatives.map((bundle) => {
    const ratios = bundle.map((item) => {
      if (!Number.isFinite(item.limitValue) || item.limitValue <= 0 || !Number.isFinite(item.remainingValue)) {
        return null;
      }
      const debit = Number(debits.get(quotaIdentityKey({
        connectionId,
        provider,
        accountKey: item.accountKey,
        resourceKey: item.resourceKey,
        dimensionKey: item.dimensionKey,
      }))) || 0;
      const ratio = Math.max(0, item.remainingValue - debit) / item.limitValue;
      const windowKey = JSON.stringify([item.resourceKey, item.dimensionKey]);
      const previous = ratioByWindow.get(windowKey);
      ratioByWindow.set(windowKey, previous == null ? ratio : Math.min(previous, ratio));
      return ratio;
    }).filter((ratio) => ratio !== null);
    return ratios.length > 0 ? Math.min(...ratios) : null;
  }).filter((ratio) => ratio !== null);
  if (alternativeRatios.length === 0) return profile;

  const reservedRatio = Math.max(...alternativeRatios);
  const effectiveRatio = profile.gateMode === "any-sufficient"
    ? Math.max(reservedRatio, profile.unreservedEffectiveRatio ?? -1)
    : Math.min(profile.effectiveRatio ?? 1, reservedRatio);
  return {
    ...profile,
    effectiveRatio,
    routingWindows: (profile.routingWindows || []).map((window) => {
      const adjusted = ratioByWindow.get(JSON.stringify([window.resourceKey, window.dimensionKey]));
      return adjusted == null ? window : { ...window, ratio: Math.min(window.ratio, adjusted) };
    }),
  };
}

export function rankQuotaConnections(connections, decisions, pressure = new Map(), {
  now = Date.now(),
  config = {},
  provider = null,
} = {}) {
  const candidates = (connections || []).map((connection, index) => {
    const state = pressure.get(connection.id) || {};
    const resolvedProvider = provider || connection.provider;
    const profile = applyReservationDebits(
      decisions?.get(connection.id)?.quotaProfile || null,
      state,
      connection.id,
      resolvedProvider,
    );
    const floorDecision = isProfileBelowRoutingFloor(
      profile,
      config,
      connection.id,
      resolvedProvider,
    );
    return {
      value: connection,
      id: connection.id,
      stableIdentity: `${provider || connection.provider}:${connection.id}`,
      quotaProfile: profile,
      activeCount: state.activeCount || 0,
      lastSelectedAt: state.lastSelectedAt || null,
      health: healthOf(connection),
      priority: connection.priority ?? Number.MAX_SAFE_INTEGER,
      priorityRank: index,
      routingFloorBlocked: floorDecision.blocked,
      routingFloor: { enabled: floorDecision.blocked, ratio: floorDecision.ratio },
    };
  });
  const ranked = rankQuotaCandidates(candidates, {
    now,
    routingFloor: { enabled: false, ratio: QUOTA_SELECTION_DEFAULTS.routingFloorRatio },
  });
  return ranked;
}

/**
 * Weighted draw over positive weights. `r` is expected in `[0, sum(weights))`.
 * The first cumulative weight strictly greater than `r` wins (half-open), so
 * `r === 0` cannot land on a leading zero-weight slot. Zero/negative weights
 * are skipped entirely. Returns null when every weight is non-positive.
 */
export function pickWeightedIndex(weights, r) {
  const positive = [];
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (w > 0) {
      positive.push({ i, w });
      sum += w;
    }
  }
  if (positive.length === 0 || sum === 0) return null;
  let acc = 0;
  for (const entry of positive) {
    acc += entry.w;
    if (acc > r) return entry.i;
  }
  return positive[positive.length - 1].i;
}

/**
 * Weighted-random pick among quota-ranked, eligible connections instead of
 * always taking the top score. `rankQuotaConnections` already excludes empty
 * accounts (an exhausted/cooldown/below-floor connection scores `eligible:
 * false` and never reaches this pool); this function spreads the remaining
 * draw across whatever is left, proportional to leftover quota (effectiveRatio),
 * so concurrent requests don't all converge on the single best-scoring account.
 *
 * `floorPercent` splits comparable candidates into a healthy pool (ratio above
 * the floor) and a thin near-exhausted pool (ratio at or below it, but still
 * > 0). The healthy pool is used whenever it has any members; the floor pool
 * only gets drawn from when every comparable account is already thin, so
 * those accounts still get a small, non-zero share instead of starving.
 *
 * Non-comparable pools (nothing trackable) fall back to the caller's
 * deterministic order, i.e. `ranked[0]`.
 */
export function pickQuotaWeightedConnection(ranked, { floorPercent = 1 } = {}) {
  if (!Array.isArray(ranked) || ranked.length === 0) return null;
  const comparable = ranked.filter(
    (candidate) => candidate.quotaDecision?.comparable === true &&
    Number.isFinite(candidate.quotaDecision.effectiveRatio)
  );
  if (comparable.length === 0) return ranked[0]?.value ?? null;

  const floor = Math.max(0, Math.min(100, Number(floorPercent) || 0)) / 100;
  const healthyPool = comparable.filter((candidate) => candidate.quotaDecision.effectiveRatio > floor);
  const floorPool = comparable.filter((candidate) => candidate.quotaDecision.effectiveRatio > 0 &&
  candidate.quotaDecision.effectiveRatio <= floor);
  const pool = healthyPool.length > 0 ? healthyPool : floorPool.length > 0 ? floorPool : comparable;

  const weights = pool.map((candidate) => Math.max(0, candidate.quotaDecision.effectiveRatio));
  const sum = weights.reduce((acc, w) => acc + w, 0);
  const index = sum > 0 ?
  pickWeightedIndex(weights, Math.random() * sum) :
  Math.floor(Math.random() * pool.length);
  return pool[index ?? 0]?.value ?? ranked[0]?.value ?? null;
}

function decorateAlternatives(profile, config, connectionId, provider) {
  return (profile?.reservationAlternatives || []).map((bundle) => bundle.map((item) => {
    const floor = resolveQuotaRoutingFloor(config, {
      connectionId,
      provider,
      dimensionKey: item.dimensionKey,
    });
    return {
      ...item,
      routingFloorEnabled: floor.enabled,
      routingFloorRatio: floor.ratio,
    };
  }));
}

function noOpLifecycle() {
  const ticket = Object.freeze({
    tracked: false,
    reservationId: null,
    heartbeat: () => {},
    settle: async () => ({ changed: false }),
    release: async () => ({ changed: false }),
  });
  return Object.freeze({
    tracked: false,
    activeCount: 0,
    beginDispatch: async () => ticket,
    heartbeat: () => {},
    settle: async () => ({ changed: false }),
    release: async () => ({ changed: false }),
  });
}

/**
 * Coordinate one reservation ticket per physical quota-bearing dispatch.
 * Retries release their discarded ticket before acquiring another; the request
 * terminal commits/releases every ticket still owned by the final response.
 */
export function createQuotaReservationLifecycle({
  quotaProfile,
  connectionId,
  provider,
  routeKey,
  config = {},
  leaseMs = null,
  now = () => Date.now(),
} = {}) {
  const alternatives = decorateAlternatives(quotaProfile, config, connectionId, provider);
  if (alternatives.length === 0) return noOpLifecycle();
  const routeKeyHash = createHash("sha256").update(String(routeKey || `${provider}:chat`)).digest("hex");
  const effectiveLeaseMs = resolveQuotaLeaseMs(leaseMs);
  const activeTickets = new Set();

  const untrackedTicket = () => Object.freeze({
    tracked: false,
    reservationId: null,
    heartbeat: () => {},
    settle: async () => ({ changed: false }),
    release: async () => ({ changed: false }),
  });

  const beginDispatch = async () => {
    const db = await import("@/lib/localDb");
    let acquired;
    try {
      acquired = await db.acquireQuotaReservation({
        connectionId,
        provider,
        routeKeyHash,
        ownerEpoch: OWNER_EPOCH,
        alternatives,
        leaseMs: effectiveLeaseMs,
      }, { now: now() });
    } catch (error) {
      if (error?.code === "QUOTA_CAPACITY_UNAVAILABLE") {
        throw new QuotaDispatchUnavailableError(error.reason || "driver_unsupported");
      }
      throw new QuotaDispatchUnavailableError("reservation_error");
    }
    if (!acquired?.acquired && acquired?.reason === "untracked") return untrackedTicket();
    if (!acquired?.acquired) {
      throw new QuotaDispatchUnavailableError(acquired?.reason || "capacity_exhausted");
    }

    const reservationId = acquired.reservationId;
    let dispatched;
    try {
      dispatched = await db.markQuotaReservationDispatched(reservationId, {
        ownerEpoch: OWNER_EPOCH,
        now: now(),
      });
    } catch {
      try {
        await db.releaseQuotaReservation(reservationId, "pre_dispatch", {
          ownerEpoch: OWNER_EPOCH,
          now: now(),
        });
      } catch { /* bounded lease remains the backstop */ }
      throw new QuotaDispatchUnavailableError("reservation_error");
    }
    if (!dispatched?.changed) {
      throw new QuotaDispatchUnavailableError("reservation_expired");
    }

    let terminal = false;
    let settling = null;
    let lastHeartbeat = now();
    const ticket = {
      tracked: true,
      reservationId,
      heartbeat() {
        if (terminal) return;
        const timestamp = now();
        if (timestamp - lastHeartbeat < QUOTA_SELECTION_DEFAULTS.heartbeatMs) return;
        lastHeartbeat = timestamp;
        import("@/lib/localDb")
          .then((localDb) => localDb.heartbeatQuotaReservation(reservationId, {
            ownerEpoch: OWNER_EPOCH,
            now: timestamp,
            leaseMs: effectiveLeaseMs,
          }))
          .catch(() => console.error("[QUOTA] reservation heartbeat failed"));
      },
      async settle({ success = false, reason = success ? "success" : "upstream_error" } = {}) {
        if (terminal) return { changed: false };
        if (settling) return settling;
        settling = (async () => {
          const localDb = await import("@/lib/localDb");
          const result = success
            ? await localDb.commitQuotaReservation(reservationId, { ownerEpoch: OWNER_EPOCH, now: now() })
            : await localDb.releaseQuotaReservation(reservationId, reason, { ownerEpoch: OWNER_EPOCH, now: now() });
          terminal = true;
          activeTickets.delete(ticket);
          return result;
        })();
        try {
          return await settling;
        } catch (error) {
          settling = null;
          throw error;
        }
      },
      async release(reason = "fallback") {
        return ticket.settle({ success: false, reason });
      },
    };
    activeTickets.add(ticket);
    return ticket;
  };

  const api = {
    tracked: true,
    get activeCount() { return activeTickets.size; },
    beginDispatch,
    heartbeat() {
      for (const ticket of activeTickets) ticket.heartbeat();
    },
    async settle({ success = false, reason = success ? "success" : "upstream_error" } = {}) {
      const tickets = [...activeTickets];
      if (tickets.length === 0) return { changed: false };
      const results = await Promise.allSettled(tickets.map((ticket) => ticket.settle({ success, reason })));
      const rejected = results.find((result) => result.status === "rejected");
      if (rejected) throw rejected.reason;
      return { changed: results.some((result) => result.value?.changed === true) };
    },
    async release(reason = "pre_dispatch") {
      return api.settle({ success: false, reason });
    },
  };
  return api;
}
