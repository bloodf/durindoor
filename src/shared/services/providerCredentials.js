import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { getExecutor } from "open-sse/executors/index.js";
import { serializeRefresh } from "open-sse/services/refreshSerializer.js";
import { isUnrecoverableRefreshError } from "open-sse/services/tokenRefresh.js";
import {
  providerRefreshContext,
  providerRefreshContextMatches,
} from "@/shared/utils/providerCredentialContext";

const REFRESH_METADATA_FIELDS = new Set([
  "baseUrl",
  "clientId",
  "authKind",
  "resourceUrl",
  "profileArn",
  "region",
  "authMethod",
  "provider",
  "tokenEndpoint",
  "scope",
]);
const REFRESH_LOG_CATEGORIES = new Set(["AUTH", "KIRO", "TOKEN", "TOKEN_REFRESH", "VERTEX"]);
const MAX_REFRESH_SECRET_LENGTH = 64 * 1024;
const MAX_REFRESH_METADATA_LENGTH = 2048;
const MAX_REFRESH_LIFETIME_MS = 366 * 24 * 60 * 60 * 1000;
const MAX_REFRESH_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_REFRESH_CALLER_TIMEOUT_MS = 15_000;

const credentialRefreshInflight = new Map();

function assertRefreshActive(signal, shouldCommit) {
  if (signal?.aborted) throw new DOMException("Provider credential refresh aborted", "AbortError");
  if (typeof shouldCommit === "function" && !shouldCommit()) {
    const error = new Error("Provider credential refresh superseded");
    error.code = "PROVIDER_CREDENTIAL_REFRESH_SUPERSEDED";
    throw error;
  }
}

function sanitizeRefreshLogValue(value, depth = 0) {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string" || value instanceof Error) return "[redacted]";
  if (depth >= 3) return "[redacted]";
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => sanitizeRefreshLogValue(entry, depth + 1));
  if (typeof value === "object") {
    const output = {};
    for (const [key, entry] of Object.entries(value).slice(0, 30)) {
      output[key] = /(?:authorization|cookie|credential|password|secret|token|api[_-]?key)/i.test(key)
        ? "[redacted]"
        : sanitizeRefreshLogValue(entry, depth + 1);
    }
    return output;
  }
  return "[redacted]";
}

function createRefreshLogger(log) {
  const output = {};
  for (const level of ["debug", "info", "warn", "error"]) {
    output[level] = (...args) => log?.[level]?.(...args.map((value, index) => (
      index === 0 && typeof value === "string" && REFRESH_LOG_CATEGORIES.has(value)
        ? value
        : sanitizeRefreshLogValue(value)
    )));
  }
  return output;
}

function refreshKey(connection) {
  return JSON.stringify([connection.provider, connection.id]);
}

function safeRefreshClock(now) {
  const value = Number(now());
  return Number.isFinite(value) && value >= 0 ? value : Date.now();
}

function callerWait(operation, signal, shouldCommit, timeoutMs) {
  assertRefreshActive(signal, shouldCommit);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, new DOMException("Provider credential refresh aborted", "AbortError"));
    const timeoutId = setTimeout(() => {
      const error = new Error("Provider credential refresh timed out");
      error.name = "TimeoutError";
      error.code = "PROVIDER_CREDENTIAL_REFRESH_TIMEOUT";
      finish(reject, error);
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (result) => {
        try {
          assertRefreshActive(signal, shouldCommit);
          finish(resolve, result);
        } catch (error) {
          finish(reject, error);
        }
      },
      (error) => finish(reject, error),
    );
  });
}

function reauthorizationError() {
  const error = new Error("Failed to refresh credentials. Please re-authorize the connection.");
  error.code = "PROVIDER_REAUTH_REQUIRED";
  return error;
}

function malformedRefreshResult() {
  const error = new Error("Provider returned a malformed credential refresh result.");
  error.code = "PROVIDER_REFRESH_RESULT_MALFORMED";
  return error;
}

function optionalSecret(result, field) {
  if (!Object.hasOwn(result, field) || result[field] === null || result[field] === undefined || result[field] === "") return null;
  const value = result[field];
  if (
    typeof value !== "string"
    || value.length > MAX_REFRESH_SECRET_LENGTH
    || !value.trim()
    || /[\u0000-\u001f\u007f]/.test(value)
  ) throw malformedRefreshResult();
  return value;
}

function positiveExpirySeconds(value) {
  let seconds = value;
  if (typeof value === "string") {
    if (!/^[1-9]\d{0,9}$/.test(value)) throw malformedRefreshResult();
    seconds = Number(value);
  }
  if (typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds <= 0) {
    throw malformedRefreshResult();
  }
  return seconds;
}

function canonicalTimestamp(value) {
  let milliseconds;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    milliseconds = value < 1e12 ? value * 1000 : value;
  } else {
    if (typeof value !== "string" || !value.trim() || value.length > 128) return null;
    milliseconds = new Date(value).getTime();
  }
  if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 8.64e15) return null;
  try {
    return new Date(milliseconds).toISOString();
  } catch {
    return null;
  }
}

function safeMetadataString(value, { maxLength = MAX_REFRESH_METADATA_LENGTH, pattern = null } = {}) {
  if (
    typeof value !== "string"
    || !value.trim()
    || value.length > maxLength
    || /[\u0000-\u001f\u007f]/.test(value)
    || (pattern && !pattern.test(value))
  ) throw malformedRefreshResult();
  return value;
}

function safeMetadataUrl(value, { httpsOnly = false } = {}) {
  safeMetadataString(value);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw malformedRefreshResult();
  }
  if ((httpsOnly ? url.protocol !== "https:" : !["http:", "https:"].includes(url.protocol)) || url.username || url.password) {
    throw malformedRefreshResult();
  }
  return value;
}

function validatedMetadataValue(field, value) {
  if (field === "baseUrl" || field === "resourceUrl") return safeMetadataUrl(value);
  if (field === "tokenEndpoint") return safeMetadataUrl(value, { httpsOnly: true });
  if (field === "region") return safeMetadataString(value, { pattern: /^[a-z]{2}(?:-[a-z0-9]+)+-\d{1,2}$/ });
  if (field === "profileArn") {
    return safeMetadataString(value, {
      pattern: /^arn:aws(?:-[a-z]+)?:codewhisperer:[a-z0-9-]+:[0-9]*:profile\/[A-Za-z0-9._+=,@/-]+$/,
    });
  }
  return safeMetadataString(value);
}

async function persistReauthRequired(connection, expectedRefreshContext, updateProviderConnectionImpl, now) {
  // Mark the connection as needing a fresh OAuth reconnect WITHOUT clearing the
  // (now-dead) access/refresh tokens and WITHOUT deactivating the row. The
  // compare-and-swap fingerprint guarantees we only pin state that still
  // matches the credentials we tried to refresh — a concurrent winner that
  // already rotated the tokens is left untouched. errorCode:"REAUTH" is the
  // sentinel the fallback-state clear guards honour so ordinary request success
  // cannot silently flip it back to "active".
  try {
    await updateProviderConnectionImpl(
      connection.id,
      {
        testStatus: "reauth_required",
        lastError: "OAuth session expired. Reconnect this account.",
        errorCode: "REAUTH",
        lastErrorAt: new Date(safeRefreshClock(now)).toISOString(),
      },
      { expectedRefreshContext },
    );
  } catch {
    // Best-effort: a persistence failure must not mask the reauth signal.
  }
}

async function reconcileConcurrentRotation(
  connection,
  expectedRefreshContext,
  getConnection,
  delays,
  wait,
  { updateProviderConnectionImpl = null, now = Date.now } = {},
) {
  for (const delay of delays) {
    if (delay > 0) await wait(delay);
    const current = await getConnection(connection.id);
    if (current === null) {
      const error = new Error("Provider connection no longer exists");
      error.code = "PROVIDER_CONNECTION_NOT_FOUND";
      throw error;
    }
    if (
      current
      && current.provider === connection.provider
      && !providerRefreshContextMatches(current, expectedRefreshContext)
    ) return { connection: current, refreshed: false };
  }
  // No newer credential won the rotation race: the refresh token is genuinely
  // dead. Pin a durable reauth_required state before surfacing the error.
  if (updateProviderConnectionImpl) {
    await persistReauthRequired(connection, expectedRefreshContext, updateProviderConnectionImpl, now);
  }
  throw reauthorizationError();
}

/**
 * Refresh one provider connection without coupling shared workers to an API
 * route. Stored credentials change only when the provider returns an explicit
 * replacement value; existing secret bytes are otherwise preserved.
 */
export async function refreshAndUpdateCredentials(
  connection,
  force = false,
  proxyOptions = null,
  {
    getExecutorImpl = getExecutor,
    getProviderConnectionByIdImpl = getProviderConnectionById,
    updateProviderConnectionImpl = updateProviderConnection,
    now = Date.now,
    log = console,
    signal = null,
    shouldCommit = null,
    reconcileDelays = [0, 10, 25, 50, 100],
    wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    callerTimeoutMs = DEFAULT_REFRESH_CALLER_TIMEOUT_MS,
  } = {},
) {
  assertRefreshActive(signal, shouldCommit);
  // Capture the exact issuer and credential context before invoking provider
  // code. Executors receive an isolated clone and cannot rewrite the CAS input.
  const expectedRefreshContext = providerRefreshContext(connection);
  const key = refreshKey(connection);
  const shared = credentialRefreshInflight.get(key);
  if (shared) return callerWait(shared, signal, shouldCommit, callerTimeoutMs);


  const executor = getExecutorImpl(connection.provider);
  const providerSpecificData = connection.providerSpecificData && typeof connection.providerSpecificData === "object"
    ? structuredClone(connection.providerSpecificData)
    : connection.providerSpecificData;
  const credentials = {
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    idToken: connection.idToken,
    expiresAt: connection.expiresAt || connection.tokenExpiresAt,
    lastRefreshAt: connection.lastRefreshAt,
    connectionId: connection.id,
    providerSpecificData,
    copilotToken: providerSpecificData?.copilotToken,
    copilotTokenExpiresAt: providerSpecificData?.copilotTokenExpiresAt,
  };

  if (!(force || executor.needsRefresh(credentials))) {
    return { connection, refreshed: false };
  }

  // Once the provider request begins, its result must outlive an individual
  // quota subscriber. OAuth providers can rotate a refresh token even when the
  // caller disconnects; dropping that replacement would brick the connection.
  const operation = (async () => {
    // Front 1 (OmniRoute 697946381d): serialize the network refresh across
    // every connection in the same rotation group (Codex + openai share one
    // Auth0 client_id) so two sibling accounts never POST to /oauth/token
    // concurrently and trip Auth0 refresh_token family revocation
    // (openai/codex#9648). The per-connection inflight dedup above cannot see
    // cross-connection collisions. Non-rotating providers pass through with no
    // locking.
    const refreshResult = await serializeRefresh(connection.provider, () =>
      executor.refreshCredentials(credentials, createRefreshLogger(log), proxyOptions)
    );
    if (isUnrecoverableRefreshError(refreshResult)) {
      return reconcileConcurrentRotation(
        connection,
        expectedRefreshContext,
        getProviderConnectionByIdImpl,
        reconcileDelays,
        wait,
        { updateProviderConnectionImpl, now },
      );
    }
    if (!refreshResult) {
      if (connection.accessToken) return { connection, refreshed: false };
      throw reauthorizationError();
    }

    if (typeof refreshResult !== "object" || Array.isArray(refreshResult)) throw malformedRefreshResult();
    if (Object.hasOwn(refreshResult, "error")) {
      if (connection.accessToken) return { connection, refreshed: false };
      throw reauthorizationError();
    }
    const nowMs = safeRefreshClock(now);
    const accessToken = optionalSecret(refreshResult, "accessToken");
    if (!accessToken) throw malformedRefreshResult();
    const updateData = { accessToken, updatedAt: new Date(nowMs).toISOString() };
    for (const field of ["refreshToken", "idToken"]) {
      const replacement = optionalSecret(refreshResult, field);
      if (replacement) updateData[field] = replacement;
    }
    if (Object.hasOwn(refreshResult, "lastRefreshAt") && refreshResult.lastRefreshAt !== null && refreshResult.lastRefreshAt !== undefined && refreshResult.lastRefreshAt !== "") {
      const lastRefreshAt = canonicalTimestamp(refreshResult.lastRefreshAt);
      if (!lastRefreshAt || new Date(lastRefreshAt).getTime() > nowMs + MAX_REFRESH_CLOCK_SKEW_MS) throw malformedRefreshResult();
      updateData.lastRefreshAt = lastRefreshAt;
    }

    const hasExpiresIn = Object.hasOwn(refreshResult, "expiresIn") && refreshResult.expiresIn !== null && refreshResult.expiresIn !== undefined && refreshResult.expiresIn !== "";
    const hasExpiresAt = Object.hasOwn(refreshResult, "expiresAt") && refreshResult.expiresAt !== null && refreshResult.expiresAt !== undefined && refreshResult.expiresAt !== "";
    const expiresIn = hasExpiresIn ? positiveExpirySeconds(refreshResult.expiresIn) : null;
    const expiresAt = hasExpiresAt ? canonicalTimestamp(refreshResult.expiresAt) : null;
    const expiresInMs = expiresIn === null ? null : expiresIn * 1000;
    if (
      hasExpiresIn
      && (
        !Number.isFinite(expiresInMs)
        || expiresInMs > MAX_REFRESH_LIFETIME_MS
        || !canonicalTimestamp(nowMs + expiresInMs)
      )
    ) {
      throw malformedRefreshResult();
    }
    if (
      hasExpiresAt
      && (!expiresAt || new Date(expiresAt).getTime() > nowMs + MAX_REFRESH_LIFETIME_MS)
    ) throw malformedRefreshResult();
    if (hasExpiresIn) {
      updateData.expiresAt = canonicalTimestamp(nowMs + expiresInMs);
      updateData.expiresIn = expiresIn;
    } else if (hasExpiresAt) {
      updateData.expiresAt = expiresAt;
    }

    const providerSpecificUpdates = {};
    const copilotToken = optionalSecret(refreshResult, "copilotToken");
    if (copilotToken) providerSpecificUpdates.copilotToken = copilotToken;
    if (Object.hasOwn(refreshResult, "copilotTokenExpiresAt") && refreshResult.copilotTokenExpiresAt !== null && refreshResult.copilotTokenExpiresAt !== undefined && refreshResult.copilotTokenExpiresAt !== "") {
      const expiresAt = canonicalTimestamp(refreshResult.copilotTokenExpiresAt);
      if (!expiresAt || new Date(expiresAt).getTime() > nowMs + MAX_REFRESH_LIFETIME_MS) {
        throw malformedRefreshResult();
      }
      providerSpecificUpdates.copilotTokenExpiresAt = expiresAt;
    }
    if (Object.hasOwn(refreshResult, "providerSpecificData") && refreshResult.providerSpecificData !== null && refreshResult.providerSpecificData !== undefined) {
      if (typeof refreshResult.providerSpecificData !== "object" || Array.isArray(refreshResult.providerSpecificData)) {
        throw malformedRefreshResult();
      }
      const originalProviderData = connection.providerSpecificData
        && typeof connection.providerSpecificData === "object"
        && !Array.isArray(connection.providerSpecificData)
        ? connection.providerSpecificData
        : {};
      for (const [field, value] of Object.entries(refreshResult.providerSpecificData)) {
        if (!REFRESH_METADATA_FIELDS.has(field) || value === null || value === undefined || value === "") continue;
        // Some legacy refreshers echo their entire input metadata object. Do
        // not revalidate or rewrite unchanged stored values after an upstream
        // may already have rotated its one-time refresh token.
        if (Object.hasOwn(originalProviderData, field) && originalProviderData[field] === value) continue;
        providerSpecificUpdates[field] = validatedMetadataValue(field, value);
      }
    }
    if (Object.keys(providerSpecificUpdates).length > 0) updateData.providerSpecificData = providerSpecificUpdates;

    if (Object.keys(updateData).length === 1) {
      if (connection.accessToken) return { connection, refreshed: false };
      throw reauthorizationError();
    }

    const commit = await updateProviderConnectionImpl(connection.id, updateData, {
      expectedRefreshContext,
      returnCommitResult: true,
    });
    if (commit === null) {
      const error = new Error("Provider connection no longer exists");
      error.code = "PROVIDER_CONNECTION_NOT_FOUND";
      throw error;
    }
    const structured = commit && typeof commit === "object" && Object.hasOwn(commit, "connection")
      ? commit
      : { applied: true, connection: commit };
    const fallback = {
      ...connection,
      ...updateData,
      providerSpecificData: updateData.providerSpecificData
        ? { ...(connection.providerSpecificData || {}), ...updateData.providerSpecificData }
        : connection.providerSpecificData,
    };
    return {
      connection: structured.connection || fallback,
      refreshed: structured.applied !== false,
    };
  })();
  credentialRefreshInflight.set(key, operation);
  operation.catch(() => {}).finally(() => {
    if (credentialRefreshInflight.get(key) === operation) credentialRefreshInflight.delete(key);
  });
  return callerWait(operation, signal, shouldCommit, callerTimeoutMs);
}
