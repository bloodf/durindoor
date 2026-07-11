import { randomBytes } from "crypto";

import { OAUTH_TIMEOUT } from "@/lib/oauth/constants/oauth.js";

const flows = new Map();
const stateAliases = new Map();
const providerIntentGenerations = new Map();
const FLOW_KINDS = new Set(["authorization", "device"]);
const UNSUPPORTED_DISTRIBUTED_RUNTIMES = ["VERCEL", "AWS_LAMBDA_FUNCTION_NAME", "NETLIFY"];

function cloneAndFreeze(value) {
  if (value === undefined) return undefined;
  const cloned = structuredClone(value);
  const seen = new WeakSet();

  function freeze(current) {
    if (!current || typeof current !== "object" || seen.has(current)) return current;
    seen.add(current);
    for (const nested of Object.values(current)) freeze(nested);
    return Object.freeze(current);
  }

  return freeze(cloned);
}

function normalizeRequiredString(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function randomOpaqueId() {
  let id;
  do {
    id = randomBytes(24).toString("base64url");
  } while (flows.has(id));
  return id;
}

function deleteRecord(record) {
  if (!record) return false;
  flows.delete(record.flowId);
  if (record.state && stateAliases.get(record.state) === record.flowId) {
    stateAliases.delete(record.state);
  }
  return true;
}

function sweepExpired(now = Date.now()) {
  for (const record of flows.values()) {
    if (record.expiresAt <= now) deleteRecord(record);
  }
}

function publicDescriptor(record) {
  if (!record) return null;
  return Object.freeze({
    flowId: record.flowId,
    state: record.state,
    provider: record.provider,
    kind: record.kind,
    status: record.status,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  });
}

function resolveRecord(selector, providerArgument = null) {
  sweepExpired();

  const normalized = typeof selector === "string"
    ? { flowId: selector, provider: providerArgument }
    : (selector || {});
  const flowId = normalizeOptionalString(normalized.flowId ?? normalized.id);
  const state = normalizeOptionalString(normalized.state);
  const provider = normalizeOptionalString(normalized.provider ?? providerArgument);
  const idFromState = state ? stateAliases.get(state) : null;

  if (!flowId && !idFromState) return null;
  if (flowId && idFromState && flowId !== idFromState) return null;

  const record = flows.get(flowId || idFromState);
  if (!record || (state && record.state !== state) || (provider && record.provider !== provider)) {
    return null;
  }
  return record;
}

/**
 * Create an expiring server-side OAuth flow. Only the opaque descriptor is
 * returned; verifier, device-code, and token material remain in `payload`.
 */
export function createOAuthFlow({
  provider,
  state = null,
  kind = "authorization",
  payload = {},
  ttlMs = OAUTH_TIMEOUT,
  intent = null,
}) {
  sweepExpired();
  const normalizedProvider = normalizeRequiredString(provider, "provider");
  const intentKey = intent?.ownerId ? `${normalizedProvider}:${intent.ownerId}` : null;
  if (
    intent &&
    (intent.provider !== normalizedProvider ||
      providerIntentGenerations.get(intentKey) !== intent.generation)
  ) {
    throw new Error("OAuth flow was superseded before initialization completed");
  }
  const normalizedState = normalizeOptionalString(state);
  if (!FLOW_KINDS.has(kind)) throw new TypeError("Unsupported OAuth flow kind");
  if (normalizedState && stateAliases.has(normalizedState)) {
    throw new Error("An OAuth flow for this state already exists");
  }

  const requestedTtl = Number(ttlMs);
  const boundedTtl = Number.isFinite(requestedTtl) && requestedTtl > 0
    ? Math.min(requestedTtl, OAUTH_TIMEOUT)
    : OAUTH_TIMEOUT;
  const createdAt = Date.now();
  const record = {
    flowId: randomOpaqueId(),
    state: normalizedState,
    provider: normalizedProvider,
    ownerId: normalizeOptionalString(intent?.ownerId),
    kind,
    status: "active",
    claimToken: null,
    payload: cloneAndFreeze(payload || {}),
    createdAt,
    expiresAt: createdAt + boundedTtl,
  };

  flows.set(record.flowId, record);
  if (record.state) stateAliases.set(record.state, record.flowId);
  return publicDescriptor(record);
}

/**
 * Mark a new login request as the latest provider intent before any upstream
 * work begins. A slower prior request cannot create a flow after this point.
 */
export function beginOAuthFlowIntent(provider, ownerId = null) {
  if (UNSUPPORTED_DISTRIBUTED_RUNTIMES.some((name) => process.env[name])) {
    throw new Error("OAuth login requires the local single-process DurinDoor runtime");
  }
  const normalizedProvider = normalizeRequiredString(provider, "provider");
  const normalizedOwnerId = normalizeOptionalString(ownerId) || randomOpaqueId();
  const intentKey = `${normalizedProvider}:${normalizedOwnerId}`;
  const generation = (providerIntentGenerations.get(intentKey) || 0) + 1;
  providerIntentGenerations.set(intentKey, generation);
  invalidateOAuthFlows({ provider: normalizedProvider, ownerId: normalizedOwnerId });
  return Object.freeze({ provider: normalizedProvider, ownerId: normalizedOwnerId, generation });
}

/** Return non-secret flow status by opaque id and/or state. */
export function getOAuthFlow(selector, provider = null) {
  return publicDescriptor(resolveRecord(selector, provider));
}

/**
 * Atomically claim a flow for one exchange/poll attempt. A second concurrent
 * caller receives null until a device-pending result releases the first claim.
 */
export function claimOAuthFlow(selector, provider = null) {
  const record = resolveRecord(selector, provider);
  if (!record || record.status !== "active") return null;

  record.status = "claimed";
  record.claimToken = randomBytes(24).toString("base64url");
  return Object.freeze({
    ...publicDescriptor(record),
    claimToken: record.claimToken,
    payload: record.payload,
  });
}

/** Return whether a server claim is still current immediately before commit. */
export function isOAuthFlowClaimActive(claim) {
  if (!claim?.flowId || !claim?.claimToken) return false;
  sweepExpired();
  const record = flows.get(claim.flowId);
  return Boolean(
    record &&
    record.status === "claimed" &&
    record.claimToken === claim.claimToken,
  );
}

/** Consume a matching claim permanently. */
export function consumeOAuthFlow(claim) {
  if (!claim?.flowId || !claim?.claimToken) return false;
  const record = flows.get(claim.flowId);
  if (!record || record.status !== "claimed" || record.claimToken !== claim.claimToken) {
    return false;
  }
  return deleteRecord(record);
}

/** Release only a device-flow claim after an upstream pending response. */
export function releaseOAuthFlow(claim) {
  if (!claim?.flowId || !claim?.claimToken) return false;
  const record = flows.get(claim.flowId);
  if (!record || record.kind !== "device" || record.status !== "claimed" ||
      record.claimToken !== claim.claimToken || record.expiresAt <= Date.now()) {
    if (record?.expiresAt <= Date.now()) deleteRecord(record);
    return false;
  }

  record.status = "active";
  record.claimToken = null;
  return true;
}

/** Release a pending device poll; consume every success, error, or auth claim. */
export function settleOAuthFlowClaim(claim, { pending = false } = {}) {
  if (pending && claim?.kind === "device" && releaseOAuthFlow(claim)) {
    return "released";
  }
  return consumeOAuthFlow(claim) ? "consumed" : "ignored";
}

/** Cancel one active or claimed flow. */
export function cancelOAuthFlow(selector, provider = null) {
  return deleteRecord(resolveRecord(selector, provider));
}

/** Invalidate earlier flows for a provider when a new login intent starts. */
export function invalidateOAuthFlows({ provider, ownerId, exceptFlowId = null } = {}) {
  sweepExpired();
  const normalizedProvider = normalizeRequiredString(provider, "provider");
  const normalizedOwnerId = normalizeOptionalString(ownerId);
  if (!normalizedOwnerId) return 0;
  let removed = 0;
  for (const record of [...flows.values()]) {
    if (record.provider === normalizedProvider && record.ownerId === normalizedOwnerId && record.flowId !== exceptFlowId) {
      deleteRecord(record);
      removed += 1;
    }
  }
  return removed;
}

/** Test-only reset for the process-local flow registry. */
export function clearOAuthFlowsForTests() {
  flows.clear();
  stateAliases.clear();
  providerIntentGenerations.clear();
}
