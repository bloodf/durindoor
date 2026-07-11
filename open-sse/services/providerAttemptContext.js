import { AsyncLocalStorage } from "node:async_hooks";
import { QuotaDispatchUnavailableError } from "./quota/dispatch.js";

const providerAttemptStorage = new AsyncLocalStorage();
const quotaBearingStorage = new AsyncLocalStorage();
const ticketByTarget = new WeakMap();
const targetsByTicket = new WeakMap();

/** Run one executor invocation with a request-local physical-dispatch clock. */
export function runWithProviderAttemptContext(onProviderAttempt, callback, { beginQuotaDispatch = null } = {}) {
  if (typeof onProviderAttempt !== "function" && typeof beginQuotaDispatch !== "function") return callback();
  return providerAttemptStorage.run({
    onProviderAttempt: typeof onProviderAttempt === "function" ? onProviderAttempt : () => Date.now(),
    beginQuotaDispatch: typeof beginQuotaDispatch === "function" ? beginQuotaDispatch : null,
    prepared: false,
    latest: null,
  }, callback);
}

/**
 * Reserve the next physical dispatch clock for code that performs explicit
 * transport setup before calling proxyAwareFetch (notably BaseExecutor).
 */
export function prepareProviderAttemptDispatch() {
  const state = providerAttemptStorage.getStore();
  if (!state) return null;
  const allocated = state.onProviderAttempt();
  if (Number.isSafeInteger(allocated) && allocated > 0) {
    state.latest = allocated;
    state.prepared = true;
    return allocated;
  }
  return null;
}

/** Stamp an actual proxy-aware network dispatch, consuming a reservation once. */
export function markProviderAttemptDispatch() {
  const state = providerAttemptStorage.getStore();
  if (!state) return null;
  if (state.prepared) {
    state.prepared = false;
    return state.latest;
  }
  const allocated = state.onProviderAttempt();
  if (Number.isSafeInteger(allocated) && allocated > 0) state.latest = allocated;
  return state.latest;
}

export function getCurrentProviderAttemptTimestamp() {
  return providerAttemptStorage.getStore()?.latest || null;
}

/** Explicitly mark a runtime provider request as quota-bearing. */
export async function runQuotaBearingProviderRequest(callback) {
  const state = providerAttemptStorage.getStore();
  if (!state) return callback();
  return quotaBearingStorage.run(true, callback);
}

/** Whether the current lexical call is an explicitly armed provider send. */
export function isQuotaBearingProviderRequest() {
  return quotaBearingStorage.getStore() === true;
}

function transportFailureReason(error) {
  if (error?.name === "AbortError") return "abort";
  return String(error?.message || "").toLowerCase().includes("timeout")
    ? "timeout"
    : "transport_error";
}

/** Wrap exactly one physical transport send. */
export async function runProviderAttemptDispatch(callback) {
  const state = providerAttemptStorage.getStore();
  if (!state) return callback();
  const attemptStartedAt = markProviderAttemptDispatch();
  let ticket = null;
  if (quotaBearingStorage.getStore() === true && state.beginQuotaDispatch) {
    try {
      ticket = await state.beginQuotaDispatch();
    } catch (error) {
      if (error && typeof error === "object" && Number.isSafeInteger(attemptStartedAt)) {
        error.providerAttemptStartedAt = attemptStartedAt;
      }
      throw error;
    }
  }
  try {
    const result = await callback();
    if (ticket?.tracked && result && (typeof result === "object" || typeof result === "function")) {
      const targets = [result];
      ticketByTarget.set(result, ticket);
      if (result.body && (typeof result.body === "object" || typeof result.body === "function")) {
        ticketByTarget.set(result.body, ticket);
        targets.push(result.body);
      }
      targetsByTicket.set(ticket, targets);
    }
    return result;
  } catch (error) {
    try {
      await ticket?.release?.(transportFailureReason(error));
    } catch {
      throw new QuotaDispatchUnavailableError("reservation_error");
    }
    if (error && typeof error === "object" && Number.isSafeInteger(attemptStartedAt)) {
      error.providerAttemptStartedAt = attemptStartedAt;
    }
    throw error;
  }
}

/** Settle the ticket bound to a discarded response/body before retry/fallback. */
export async function settleProviderAttemptDispatch(target, {
  success = false,
  reason = success ? "success" : "fallback",
} = {}) {
  if (!target || (typeof target !== "object" && typeof target !== "function")) return { changed: false };
  const ticket = ticketByTarget.get(target);
  if (!ticket) return { changed: false };
  for (const item of targetsByTicket.get(ticket) || [target]) ticketByTarget.delete(item);
  targetsByTicket.delete(ticket);
  try {
    return await ticket.settle({ success, reason });
  } catch {
    throw new QuotaDispatchUnavailableError("reservation_error");
  }
}
