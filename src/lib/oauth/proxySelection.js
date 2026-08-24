import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy.js";
import { isObject } from "../../shared/utils/typeChecks.js";

export const OAUTH_PROXY_MODE = Object.freeze({
  LEGACY: "legacy",
  DIRECT: "direct",
  STRICT_POOL: "strict-pool"
});

const VALID_MODES = new Set(Object.values(OAUTH_PROXY_MODE));
const NONE_POOL_VALUE = "__none__";

/** Error with a stable code and a message that never includes proxy secrets. */
export class OAuthProxySelectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OAuthProxySelectionError";
    this.code = code;
  }
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizePoolId(value) {
  if (value === undefined || value === null) return "";
  const poolId = String(value).trim();
  if (poolId.length > 128 || /[\u0000-\u001f\u007f]/.test(poolId)) {
    throw new OAuthProxySelectionError(
      "OAUTH_PROXY_SELECTION_INVALID",
      "Invalid OAuth proxy selection"
    );
  }
  return poolId;
}

function freezeSelection(mode, poolId = null) {
  return Object.freeze(poolId ?
  { mode, poolId } :
  { mode });
}

/**
 * Convert request or stored proxy input into one immutable tri-state value.
 * Omission means legacy routing; explicit empty/null/`__none__` means direct.
 */
export function parseOAuthProxySelection(input) {
  if (input === undefined) return freezeSelection(OAUTH_PROXY_MODE.LEGACY);
  if (input === null) return freezeSelection(OAUTH_PROXY_MODE.DIRECT);

  if (!isObject(input)) {
    const poolId = normalizePoolId(input);
    if (!poolId || poolId === NONE_POOL_VALUE) {
      return freezeSelection(OAUTH_PROXY_MODE.DIRECT);
    }
    return freezeSelection(OAUTH_PROXY_MODE.STRICT_POOL, poolId);
  }

  const nested = input.oauthProxy && isObject(input.oauthProxy) ?
  input.oauthProxy :
  null;
  const hasExplicitMode = hasOwn(input, "proxyMode") ||
  hasOwn(input, "mode") ||
  Boolean(nested && hasOwn(nested, "mode"));
  const explicitMode = input.proxyMode ?? input.mode ?? nested?.mode;
  const hasPoolField = hasOwn(input, "proxyPoolId") ||
  hasOwn(input, "poolId") ||
  Boolean(nested && hasOwn(nested, "poolId"));
  const rawPoolId = hasOwn(input, "proxyPoolId") ?
  input.proxyPoolId :
  hasOwn(input, "poolId") ?
  input.poolId :
  nested?.poolId;

  if (hasExplicitMode) {
    const mode = explicitMode === undefined || explicitMode === null ?
    "" :
    String(explicitMode).trim();
    if (!VALID_MODES.has(mode)) {
      throw new OAuthProxySelectionError(
        "OAUTH_PROXY_SELECTION_INVALID",
        "Invalid OAuth proxy selection"
      );
    }
    if (mode === OAUTH_PROXY_MODE.LEGACY || mode === OAUTH_PROXY_MODE.DIRECT) {
      return freezeSelection(mode);
    }
    const poolId = normalizePoolId(rawPoolId);
    if (!poolId || poolId === NONE_POOL_VALUE) {
      throw new OAuthProxySelectionError(
        "OAUTH_PROXY_SELECTION_INVALID",
        "Strict OAuth proxy routing requires a proxy pool"
      );
    }
    return freezeSelection(mode, poolId);
  }

  if (!hasPoolField || rawPoolId === undefined) {
    return freezeSelection(OAUTH_PROXY_MODE.LEGACY);
  }

  const poolId = normalizePoolId(rawPoolId);
  if (!poolId || poolId === NONE_POOL_VALUE) {
    return freezeSelection(OAUTH_PROXY_MODE.DIRECT);
  }
  return freezeSelection(OAUTH_PROXY_MODE.STRICT_POOL, poolId);
}

/**
 * Build the durable metadata patch for a connection. Nulls deliberately clear
 * an older pool when the user switches to legacy or direct routing; the DB's
 * deep merge preserves unrelated provider-specific metadata.
 */
export function buildOAuthProxyMetadataPatch(input) {
  const selection = parseOAuthProxySelection(input);
  const poolId = selection.mode === OAUTH_PROXY_MODE.STRICT_POOL ?
  selection.poolId :
  null;

  return Object.freeze({
    proxyPoolId: poolId,
    oauthProxy: Object.freeze({
      mode: selection.mode,
      poolId
    })
  });
}

/** Resolve a parsed selection into request-local fetch options. */
export async function resolveOAuthProxySelection(input) {
  const selection = parseOAuthProxySelection(input);
  const metadataPatch = buildOAuthProxyMetadataPatch(selection);

  if (selection.mode === OAUTH_PROXY_MODE.LEGACY) {
    return Object.freeze({
      selection,
      metadataPatch,
      proxyOptions: Object.freeze({ disableEnvProxy: false, strictProxy: false })
    });
  }

  if (selection.mode === OAUTH_PROXY_MODE.DIRECT) {
    return Object.freeze({
      selection,
      metadataPatch,
      proxyOptions: Object.freeze({ disableEnvProxy: true, strictProxy: false })
    });
  }

  const config = await resolveConnectionProxyConfig({
    proxyPoolId: selection.poolId,
    oauthProxy: { mode: OAUTH_PROXY_MODE.STRICT_POOL, poolId: selection.poolId }
  });
  const hasRoute = config?.connectionProxyEnabled === true || Boolean(config?.vercelRelayUrl);
  if (config?.source === "error" || !hasRoute) {
    throw new OAuthProxySelectionError(
      "OAUTH_PROXY_POOL_UNAVAILABLE",
      "Selected OAuth proxy pool is unavailable"
    );
  }

  const proxyOptions = Object.freeze({
    connectionProxyEnabled: config.connectionProxyEnabled === true,
    connectionProxyUrl: config.connectionProxyUrl || "",
    connectionNoProxy: config.connectionNoProxy || "",
    vercelRelayUrl: config.vercelRelayUrl || "",
    proxyPoolId: selection.poolId,
    disableEnvProxy: true,
    strictProxy: true
  });

  return Object.freeze({ selection, metadataPatch, proxyOptions });
}