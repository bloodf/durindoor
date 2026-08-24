import { createHash, randomUUID } from "node:crypto";

// Ported from OmniRoute 8417ace4b37 "feat(codex): add OAuth fingerprint
// convergence modes" — converges Codex OAuth requests onto a stable,
// account-scoped installation/session/thread identity instead of leaking the
// caller's own client identity upstream (reduces account-flagging risk).
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";
const CODEX_INSTALLATION_SALT = "durindoor-codex-installation";
const CODEX_SESSION_SEED_PREFIX = "durindoor:codex-session-id:v1:";
const CODEX_THREAD_SEED_PREFIX = "durindoor:codex-thread-id:v1:";

export const CODEX_FINGERPRINT_MODES = ["off", "device", "session", "full"];
export const CODEX_FINGERPRINT_MODE_KEY = "codexFingerprintMode";

function nonEmptyString(value) {
  if (!isString(value)) return null;
  const normalized = value.trim();
  return normalized || null;
}

function readNamedHeader(headers, name) {
  if (!headers) return "";
  if (headers instanceof Headers) return headers.get(name)?.trim() || "";
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && isString(value) && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

/** RFC4122 v4 derived from SHA-256. Same seed -> same UUID, every process. */
export function deriveStableUUIDv4(seed) {
  const digest = createHash("sha256").update(seed).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = bytes[6] & 0x0f | 0x40;
  bytes[8] = bytes[8] & 0x3f | 0x80;
  return [
  bytes.subarray(0, 4).toString("hex"),
  bytes.subarray(4, 6).toString("hex"),
  bytes.subarray(6, 8).toString("hex"),
  bytes.subarray(8, 10).toString("hex"),
  bytes.subarray(10, 16).toString("hex")].
  join("-");
}

export function accountSeed(providerSpecificData, accountKey) {
  return (
    nonEmptyString(accountKey) ||
    nonEmptyString(providerSpecificData?.connectionId) ||
    nonEmptyString(providerSpecificData?.workspaceId) ||
    nonEmptyString(providerSpecificData?.accountId) ||
    nonEmptyString(providerSpecificData?.email) ||
    "default");

}

export function isCodexOAuthCredentials(credentials) {
  return Boolean(
    nonEmptyString(credentials?.accessToken) || nonEmptyString(credentials?.refreshToken)
  );
}

export function getCodexFingerprintMode(providerSpecificData, isOAuth = true) {
  if (!isOAuth) return "off";
  const raw = (
  nonEmptyString(providerSpecificData?.[CODEX_FINGERPRINT_MODE_KEY]) ||
  nonEmptyString(providerSpecificData?.codex_fingerprint_mode) ||
  "").
  toLowerCase();
  return CODEX_FINGERPRINT_MODES.includes(raw) ? raw : "session";
}

function getCodexInstallationId(providerSpecificData, accountKey) {
  return deriveStableUUIDv4(
    `${CODEX_INSTALLATION_SALT}:${accountSeed(providerSpecificData, accountKey)}`
  );
}

function getCodexConvergedSessionId(providerSpecificData, accountKey) {
  return deriveStableUUIDv4(
    `${CODEX_SESSION_SEED_PREFIX}${accountSeed(providerSpecificData, accountKey)}`
  );
}

function getCodexConvergedThreadId(clientSessionId, providerSpecificData, accountKey) {
  if (!nonEmptyString(clientSessionId)) return "";
  return deriveStableUUIDv4(
    `${CODEX_THREAD_SEED_PREFIX}${accountSeed(providerSpecificData, accountKey)}:${clientSessionId}`
  );
}

function getCodexClientSessionId(headers) {
  return nonEmptyString(readNamedHeader(headers, "session-id")) || nonEmptyString(readNamedHeader(headers, "session_id"));
}

function isCompactRequestEndpoint(path) {
  if (!isString(path)) return false;
  const normalized = path.trim().toLowerCase().replace(/\\/g, "/");
  return normalized === "/compact" || /(?:^|\/)responses\/compact(?:\/|$)/.test(normalized);
}

/**
 * One identity object for every carrier (headers + body metadata) in one
 * upstream turn. accountKey may be the DurinDoor connection id; never sent upstream.
 */
export function createCodexClientIdentity(clientSessionId, providerSpecificData, options = {}) {
  const mode = options.mode ?? getCodexFingerprintMode(providerSpecificData, options.isOAuth ?? true);
  if (mode === "off") return null;

  const installationId = getCodexInstallationId(providerSpecificData, options.accountKey);
  if (mode === "device") {
    return {
      mode,
      installationId,
      sessionId: "",
      threadId: "",
      turnId: "",
      windowId: "",
      turnStartedAtUnixMs: Date.now()
    };
  }

  const sessionId = getCodexConvergedSessionId(providerSpecificData, options.accountKey);
  const threadId =
  mode === "full" ?
  sessionId :
  getCodexConvergedThreadId(clientSessionId, providerSpecificData, options.accountKey) || sessionId;

  return {
    mode,
    installationId,
    sessionId,
    threadId,
    turnId: randomUUID(),
    windowId: `${threadId}:0`,
    turnStartedAtUnixMs: Date.now()
  };
}

const CODEX_IDENTITY_HEADER_NAMES = [
"session-id",
"session_id",
"thread-id",
"thread_id",
"x-client-request-id",
"x-codex-installation-id",
"x-codex-parent-thread-id",
"x-codex-turn-state",
"x-codex-window-id",
"x-codex-turn-metadata"];


function removeCodexIdentityCarriers(target) {
  for (const key of Object.keys(target)) {
    if (CODEX_IDENTITY_HEADER_NAMES.includes(key.toLowerCase())) delete target[key];
  }
}

function withoutTransientCodexIdentity(providerSpecificData) {
  const { codexClientIdentity: _identity, codexOriginalIdentityHeaders: _original, ...rest } = providerSpecificData || {};
  return rest;
}

/** Preserves caller-provided Codex identity only when OAuth convergence is disabled. */
export function resolveCodexOriginalIdentityHeaders({ credentials, clientHeaders } = {}) {
  if (!credentials || isCompactRequestEndpoint(credentials.requestEndpointPath)) return null;
  const providerSpecificData = credentials.providerSpecificData ?? null;
  if (!isCodexOAuthCredentials(credentials) || getCodexFingerprintMode(providerSpecificData, true) !== "off") {
    return null;
  }

  const result = {};
  for (const name of CODEX_IDENTITY_HEADER_NAMES) {
    const value = readNamedHeader(clientHeaders, name);
    if (value) result[name] = value;
  }
  return Object.keys(result).length ? result : null;
}

function mergeTurnMetadata(raw, identity, includeSessionFields) {
  let metadata = {};
  let hadExisting = false;
  if (isString(raw) && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && isObject(parsed) && !Array.isArray(parsed)) {
        metadata = parsed;
        hadExisting = true;
      }
    } catch {

      // Replace malformed metadata when a complete carrier is required.
    }}
  if (!hadExisting && includeSessionFields) {
    metadata.thread_source = "user";
    metadata.sandbox = "none";
  }
  metadata.installation_id = identity.installationId;
  if (includeSessionFields) {
    metadata.session_id = identity.sessionId;
    metadata.thread_id = identity.threadId || identity.sessionId;
    metadata.turn_id = identity.turnId;
    metadata.window_id = identity.windowId;
    metadata.turn_started_at_unix_ms = identity.turnStartedAtUnixMs;
  }
  return JSON.stringify(metadata);
}

/** Applies saved caller identity headers when Codex OAuth convergence is off. */
export function applyCodexOriginalIdentityHeaders(headers, original) {
  if (!original) return headers;
  for (const name of CODEX_IDENTITY_HEADER_NAMES) {
    if (isString(original[name]) && original[name]) headers[name] = original[name];
  }
  return headers;
}

/** One identity for headers, body, and nested metadata. Compact requests are skipped. */
export function resolveCodexFingerprintIdentity({ credentials, clientHeaders, requestEndpointPath } = {}) {
  if (!credentials || isCompactRequestEndpoint(requestEndpointPath ?? credentials.requestEndpointPath)) return null;

  const providerSpecificData = credentials.providerSpecificData ?? null;
  const isOAuth = isCodexOAuthCredentials(credentials);
  if (getCodexFingerprintMode(providerSpecificData, isOAuth) === "off") return null;

  return createCodexClientIdentity(getCodexClientSessionId(clientHeaders), providerSpecificData, {
    accountKey: credentials.connectionId ?? null,
    isOAuth
  });
}

/** Merges resolved or original client identity into request-local credentials. */
export function withCodexFingerprintCredentials(credentials, clientHeaders, requestEndpointPath) {
  const providerSpecificData = withoutTransientCodexIdentity(credentials.providerSpecificData);
  const requestCredentials = {
    ...credentials,
    providerSpecificData,
    ...(requestEndpointPath ? { requestEndpointPath } : null)
  };
  const identity = resolveCodexFingerprintIdentity({
    credentials: requestCredentials,
    clientHeaders,
    requestEndpointPath
  });
  const original = resolveCodexOriginalIdentityHeaders({ credentials: requestCredentials, clientHeaders });
  if (!identity && !original) return requestCredentials;
  return {
    ...requestCredentials,
    providerSpecificData: {
      ...providerSpecificData,
      ...(identity ? { codexClientIdentity: identity } : null),
      ...(original ? { codexOriginalIdentityHeaders: original } : null)
    }
  };
}

/** Applies a resolved identity onto outbound Codex request headers. */
export function applyCodexClientIdentityHeaders(headers, identity) {
  if (!identity) return headers;
  if (identity.mode !== "device") removeCodexIdentityCarriers(headers);
  headers["x-codex-installation-id"] = identity.installationId;
  if (identity.mode === "device") {
    if (headers["x-codex-turn-metadata"] !== undefined) {
      headers["x-codex-turn-metadata"] = mergeTurnMetadata(headers["x-codex-turn-metadata"], identity, false);
    }
    return headers;
  }
  headers["session-id"] = identity.sessionId;
  headers["session_id"] = identity.sessionId;
  headers["thread-id"] = identity.threadId || identity.sessionId;
  headers["x-client-request-id"] = identity.threadId || identity.sessionId;
  headers["x-codex-window-id"] = identity.windowId;
  headers["x-codex-turn-metadata"] = mergeTurnMetadata(undefined, identity, true);
  return headers;
}

/** Applies a resolved identity onto the outbound `client_metadata` body field. */
export function applyCodexClientMetadata(body, identity) {
  if (!identity) return body;
  const existing =
  body.client_metadata && isObject(body.client_metadata) && !Array.isArray(body.client_metadata) ?
  { ...body.client_metadata } :
  {};
  if (identity.mode !== "device") removeCodexIdentityCarriers(existing);
  existing["x-codex-installation-id"] = identity.installationId;
  if (identity.mode === "device") {
    if (existing["x-codex-turn-metadata"] !== undefined) {
      existing["x-codex-turn-metadata"] = mergeTurnMetadata(existing["x-codex-turn-metadata"], identity, false);
    }
  } else {
    existing.session_id = identity.sessionId;
    existing.thread_id = identity.threadId || identity.sessionId;
    existing.turn_id = identity.turnId;
    existing["x-codex-window-id"] = identity.windowId;
  }
  body.client_metadata = existing;
  return body;
}