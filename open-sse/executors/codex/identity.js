/**
 * Server-only Codex identity helpers.
 *
 * These helpers need `node:crypto`, so they live outside
 * `open-sse/providers/registry/`: registry entries are imported by the client
 * bundle (src/shared/constants/providers.js) and must stay free of Node
 * built-ins. The client-safe half lives in the registry entry and
 * `open-sse/config/codexIdentity.js` re-exports both halves.
 *
 * Ported from OmniRoute 8417ace4b37 "feat(codex): add OAuth fingerprint
 * convergence modes" — converges Codex OAuth requests onto a stable,
 * account-scoped installation/session/thread identity instead of leaking the
 * caller's own client identity upstream (reduces account-flagging risk).
 */
import { createHash, randomUUID } from "node:crypto";
import { isString } from "../../../src/shared/utils/typeChecks.js";
import {
  accountSeed,
  getCodexFingerprintMode,
  isCodexOAuthCredentials,
  isCompactRequestEndpoint,
  readNamedHeader,
  resolveCodexOriginalIdentityHeaders,
} from "../../providers/registry/codex.js";

const CODEX_INSTALLATION_SALT = "durindoor-codex-installation";
const CODEX_SESSION_SEED_PREFIX = "durindoor:codex-session-id:v1:";
const CODEX_THREAD_SEED_PREFIX = "durindoor:codex-thread-id:v1:";

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
    bytes.subarray(10, 16).toString("hex"),
  ].join("-");
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
  if (!isString(clientSessionId) || !clientSessionId.trim()) return "";
  return deriveStableUUIDv4(
    `${CODEX_THREAD_SEED_PREFIX}${accountSeed(providerSpecificData, accountKey)}:${clientSessionId}`
  );
}

function getCodexClientSessionId(headers) {
  return readNamedHeader(headers, "session-id") || readNamedHeader(headers, "session_id");
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
      turnStartedAtUnixMs: Date.now(),
    };
  }

  const sessionId = getCodexConvergedSessionId(providerSpecificData, options.accountKey);
  const threadId =
    mode === "full"
      ? sessionId
      : getCodexConvergedThreadId(clientSessionId, providerSpecificData, options.accountKey) || sessionId;

  return {
    mode,
    installationId,
    sessionId,
    threadId,
    turnId: randomUUID(),
    windowId: `${threadId}:0`,
    turnStartedAtUnixMs: Date.now(),
  };
}

function withoutTransientCodexIdentity(providerSpecificData) {
  const { codexClientIdentity: _identity, codexOriginalIdentityHeaders: _original, ...rest } = providerSpecificData || {};
  return rest;
}

/** One identity for headers, body, and nested metadata. Compact requests are skipped. */
export function resolveCodexFingerprintIdentity({ credentials, clientHeaders, requestEndpointPath } = {}) {
  if (!credentials || isCompactRequestEndpoint(requestEndpointPath ?? credentials.requestEndpointPath)) return null;

  const providerSpecificData = credentials.providerSpecificData ?? null;
  const isOAuth = isCodexOAuthCredentials(credentials);
  if (getCodexFingerprintMode(providerSpecificData, isOAuth) === "off") return null;

  return createCodexClientIdentity(getCodexClientSessionId(clientHeaders), providerSpecificData, {
    accountKey: credentials.connectionId ?? null,
    isOAuth,
  });
}

/** Merges resolved or original client identity into request-local credentials. */
export function withCodexFingerprintCredentials(credentials, clientHeaders, requestEndpointPath) {
  const providerSpecificData = withoutTransientCodexIdentity(credentials.providerSpecificData);
  const requestCredentials = {
    ...credentials,
    providerSpecificData,
    ...(requestEndpointPath ? { requestEndpointPath } : null),
  };
  const identity = resolveCodexFingerprintIdentity({
    credentials: requestCredentials,
    clientHeaders,
    requestEndpointPath,
  });
  const original = resolveCodexOriginalIdentityHeaders({ credentials: requestCredentials, clientHeaders });
  if (!identity && !original) return requestCredentials;
  return {
    ...requestCredentials,
    providerSpecificData: {
      ...providerSpecificData,
      ...(identity ? { codexClientIdentity: identity } : null),
      ...(original ? { codexOriginalIdentityHeaders: original } : null),
    },
  };
}
