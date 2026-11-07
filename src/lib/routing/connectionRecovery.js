import { globalCircuitManager, CIRCUIT_STATE, SCOPE_ALL } from "./connectionCircuitState.js";

// Persisted fallback deadlines remain authoritative. Selection only observes;
// dispatch claims synchronously after ACL/quota admission has selected a row.
// Missing persisted locks may be lazy cleanup by sibling success. Keep pending
// recovery until settlement/expiry; only an explicit manager.reset invalidates it.
function recoveryScopes(connection, model, boundedModel, manager, now = Date.now()) {
  if (!connection?.id) return [];
  return [...new Set([SCOPE_ALL, boundedModel || SCOPE_ALL, model].filter(Boolean))]
    .map((scope) => [scope, connection[`modelLock_${scope}`] ?? undefined])
    .filter(([scope, deadline]) => deadline !== undefined ||
      manager.getDiagnostics(connection.id, scope, now).state !== CIRCUIT_STATE.CLOSED);
}

export function canSelectConnection(connection, model, boundedModel, now = Date.now(), manager = globalCircuitManager) {
  return recoveryScopes(connection, model, boundedModel, manager, now).every(([scope, deadline]) =>
    manager.canExecute(connection.id, scope, deadline, now));
}

/** Run the existing chat core with one process-local recovery claim per scope.
 * Only its successful completion callback confirms recovery. A local rejection,
 * abort, thrown error or cancelled stream releases the claim without cooldown.
 * Existing fallback writers alone decide whether a provider failure opens it.
 */
export async function runWithConnectionRecovery(core, options, connection, model, boundedModel, signal, manager = globalCircuitManager) {
  const leases = [];
  let finished = false;
  const finish = (success = false) => {
    if (finished) return;
    finished = true;
    signal?.removeEventListener("abort", abort);
    for (const [scope, token] of leases) {
      manager.settleRecovery(connection.id, scope, token, success ? { success: true } : { aborted: true });
    }
  };
  const abort = () => finish();
  for (const [scope, deadline] of recoveryScopes(connection, model, boundedModel, manager)) {
    const state = manager.evaluateState(connection.id, scope, deadline);
    if (state === CIRCUIT_STATE.CLOSED) continue;
    const lease = manager.acquireRecoveryLease(connection.id, scope, deadline);
    if (!lease.acquired) {
      finish();
      return { success: false, connectionRecoveryBusy: true, status: 503,
        response: new Response("Connection recovery in progress", { status: 503 }) };
    }
    leases.push([scope, lease.leaseToken]);
    // Account-wide recovery covers this dispatch, including its model scope.
    if (scope === SCOPE_ALL) break;
  }
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) {
    finish();
    return { success: false, status: 499, response: new Response(null, { status: 499 }) };
  }
  try {
    const wrapped = { ...options };
    wrapped.onRequestSuccess = async (...args) => {
      try { await options.onRequestSuccess?.(...args); finish(!signal?.aborted); }
      catch (error) { finish(); throw error; }
    };
    for (const name of ["onEmptyStream", "onUpstreamEmptyExhausted"]) {
      wrapped[name] = async (...args) => {
        try { return await options[name]?.(...args); } finally { finish(); }
      };
    }
    const result = await core(wrapped);
    if (!result.success) finish();
    else if (result.response?.body && !finished) {
      const reader = result.response.body.getReader();
      const body = new ReadableStream({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) { finish(); controller.close(); }
            else controller.enqueue(chunk.value);
          } catch (error) { finish(); controller.error(error); }
        },
        async cancel(reason) { finish(); await reader.cancel(reason); }
      });
      result.response = new Response(body, result.response);
    } else if (!result.response?.body) finish();
    return result;
  } catch (error) { finish(); throw error; }
}
