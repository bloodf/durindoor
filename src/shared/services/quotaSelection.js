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
