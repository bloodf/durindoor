import { getProxyPoolById } from "@/models";

const OAUTH_PROXY_MODES = new Set(["legacy", "direct", "strict-pool"]);

// Safely normalize any value into a trimmed string.
function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function directProxyConfig() {
  return {
    source: "direct",
    proxyPoolId: null,
    proxyPool: null,
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    connectionNoProxy: "",
    vercelRelayUrl: "",
    strictProxy: false,
    disableEnvProxy: true,
  };
}

function failedStrictProxyConfig(proxyPoolId, reason) {
  return {
    source: "error",
    reason,
    proxyPoolId: proxyPoolId || null,
    proxyPool: null,
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    connectionNoProxy: "",
    vercelRelayUrl: "",
    strictProxy: true,
    disableEnvProxy: true,
  };
}

// ─── Proxy pool rotation state (in-memory) ─────────────────────────
const rotateState = new Map(); // providerId → { index }

/**
 * Pick one proxy pool ID from a list based on strategy.
 * round-robin: cycle sequentially (in-memory, resets on restart)
 * random:      uniform random pick
 * none/single: return first entry
 */
export function pickProxyPoolId(poolIds, strategy, providerId) {
  if (!poolIds || poolIds.length === 0) return null;
  if (poolIds.length === 1) return poolIds[0];

  if (strategy === "round-robin") {
    const state = rotateState.get(providerId) || { index: -1 };
    state.index = (state.index + 1) % poolIds.length;
    rotateState.set(providerId, state);
    return poolIds[state.index];
  }

  if (strategy === "random") {
    return poolIds[Math.floor(Math.random() * poolIds.length)];
  }

  return poolIds[0]; // "none" or unknown
}

/**
 * Normalize legacy proxy configuration.
 */
function normalizeLegacyProxy(providerSpecificData = {}) {
  const connectionProxyEnabled =
    providerSpecificData?.connectionProxyEnabled === true;

  const connectionProxyUrl = normalizeString(
    providerSpecificData?.connectionProxyUrl
  );

  const connectionNoProxy = normalizeString(
    providerSpecificData?.connectionNoProxy
  );

  return {
    connectionProxyEnabled,
    connectionProxyUrl,
    connectionNoProxy,
  };
}

/**
 * Resolve final proxy configuration.
 *
 * Nested `oauthProxy` metadata takes precedence over legacy fields. OAuth has
 * three durable modes: legacy (best effort), direct (environment proxies are
 * disabled), and strict-pool (the selected active pool must resolve).
 *
 * Outside OAuth metadata, the historical priority remains proxy pool, legacy
 * proxy, then no configured proxy.
 */
export async function resolveConnectionProxyConfig(
  providerSpecificData = {}
) {
  const oauthProxy = providerSpecificData?.oauthProxy;
  const hasOAuthMode = oauthProxy && typeof oauthProxy === "object" && hasOwn(oauthProxy, "mode");
  const oauthMode = hasOAuthMode ? normalizeString(oauthProxy.mode) : null;

  if (hasOAuthMode && !OAUTH_PROXY_MODES.has(oauthMode)) {
    return failedStrictProxyConfig(null, "invalid_proxy_mode");
  }

  if (oauthMode === "direct") {
    return directProxyConfig();
  }

  try {
    const strictOAuthPool = oauthMode === "strict-pool";
    const proxyPoolIdRaw = strictOAuthPool
      ? normalizeString(oauthProxy?.poolId)
      : oauthMode === "legacy"
        ? ""
        : normalizeString(providerSpecificData?.proxyPoolId);

    if (strictOAuthPool && (!proxyPoolIdRaw || proxyPoolIdRaw === "__none__")) {
      return failedStrictProxyConfig(null, "proxy_pool_unavailable");
    }

    const proxyPoolId = proxyPoolIdRaw === "__none__" ? "" : proxyPoolIdRaw;

    const legacy = normalizeLegacyProxy(providerSpecificData);

    /**
     * -----------------------------
     * Proxy Pool Resolution
     * -----------------------------
     */
    if (proxyPoolId) {
      const proxyPool = await getProxyPoolById(proxyPoolId);

      const proxyUrl = normalizeString(proxyPool?.proxyUrl);
      const noProxy = normalizeString(proxyPool?.noProxy);

      const isValidPool =
        proxyPool &&
        proxyPool.isActive === true &&
        proxyUrl;

      if (isValidPool) {
        /**
         * Vercel/Cloudflare relay proxies use base URL rewriting
         * instead of HTTP_PROXY environment variables.
         */
        if (proxyPool.type === "vercel" || proxyPool.type === "cloudflare") {
          return {
            source: proxyPool.type,

            proxyPoolId,
            proxyPool,

            connectionProxyEnabled: false,
            connectionProxyUrl: "",
            connectionNoProxy: noProxy,

            strictProxy: strictOAuthPool || proxyPool.strictProxy === true,
            disableEnvProxy: strictOAuthPool,

            vercelRelayUrl: proxyUrl, // Still mapped to vercelRelayUrl in the unified payload since they use the exact same header spec
          };
        }

        /**
         * Standard proxy pool
         */
        return {
          source: "pool",

          proxyPoolId,
          proxyPool,

          connectionProxyEnabled: true,
          connectionProxyUrl: proxyUrl,
          connectionNoProxy: noProxy,

          strictProxy: strictOAuthPool || proxyPool.strictProxy === true,
          disableEnvProxy: strictOAuthPool,
        };
      }

      if (strictOAuthPool) {
        return failedStrictProxyConfig(proxyPoolId, "proxy_pool_unavailable");
      }
    }

    /**
     * -----------------------------
     * Legacy Proxy Fallback
     * -----------------------------
     */
    if (oauthMode !== "direct" &&
      legacy.connectionProxyEnabled &&
      legacy.connectionProxyUrl
    ) {
      return {
        source: "legacy",

        proxyPoolId: proxyPoolId || null,
        proxyPool: null,

        ...legacy,
        strictProxy: false,
        disableEnvProxy: false,
      };
    }

    /**
     * -----------------------------
     * No Proxy Config
     * -----------------------------
     */
    return {
      source: "none",

      proxyPoolId: proxyPoolId || null,
      proxyPool: null,

      ...legacy,
      strictProxy: false,
      disableEnvProxy: false,
    };
  } catch {
    if (oauthMode === "strict-pool") {
      return failedStrictProxyConfig(
        normalizeString(oauthProxy?.poolId),
        "proxy_pool_unavailable"
      );
    }

    // Do not log database errors with user-controlled proxy URLs or
    // credentials. Legacy routing remains fail-open for compatibility.
    console.error("[resolveConnectionProxyConfig] Failed to resolve proxy config");

    return {
      source: "error",

      proxyPoolId: null,
      proxyPool: null,

      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",

      strictProxy: false,
      disableEnvProxy: false,
    };
  }
}
