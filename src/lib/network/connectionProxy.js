import { getProxyPoolById } from "@/lib/localDb";
import { isObject } from "../../shared/utils/typeChecks.js";

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
    relaySecret: "",
    strictProxy: false,
    disableEnvProxy: true
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
    relaySecret: "",
    strictProxy: true,
    disableEnvProxy: true
  };
}

/**
 * Carry the deploy secret through the existing vercelRelayUrl credential field
 * as URL userinfo so auth/chatCore keep forwarding a single relay URL. proxyFetch
 * strips the userinfo and sends x-relay-secret instead of fetching with it.
 */
function embedRelaySecretInUrl(proxyUrl, relaySecret) {
  const secret = normalizeString(relaySecret);
  if (!secret) return proxyUrl;
  try {
    const url = new URL(proxyUrl);
    url.username = secret;
    url.password = "";
    return url.toString();
  } catch {
    return proxyUrl;
  }
}

/** Drop relaySecret from the pool object returned to callers. */
function publicProxyPool(proxyPool) {
  if (!proxyPool || !Object.prototype.hasOwnProperty.call(proxyPool, "relaySecret")) {
    return proxyPool;
  }
  const rest = { ...proxyPool };
  delete rest.relaySecret;
  return rest;
}

// ─── Proxy pool rotation state (in-memory) ─────────────────────────
const rotateState = new Map(); // providerId → { index }

/**
 * Pick one proxy pool ID from a list based on strategy.
 * round-robin: cycle sequentially (in-memory, resets on restart)
 * random:      uniform random pick
 * session:     rendezvous hash by session and pool ID; round-robin without a session
 * none/single: return first entry
 */
export function pickProxyPoolId(poolIds, strategy, providerId, sessionId) {
  if (!poolIds || poolIds.length === 0) return null;
  if (poolIds.length === 1) return poolIds[0];

  if (strategy === "session" && sessionId) {
    let best = poolIds[0];
    let bestScore = -1;
    for (const id of poolIds) {
      const text = `${sessionId}\0${id}`;
      let h1 = 0xdeadbeef;
      let h2 = 0x41c6ce57;
      for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
      }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      const score = 4294967296 * (2097151 & h2) + (h1 >>> 0);
      if (score > bestScore) {
        best = id;
        bestScore = score;
      }
    }
    return best;
  }

  if (strategy === "round-robin" || strategy === "session") {
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
    connectionNoProxy
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
providerSpecificData = {})
{
  const oauthProxy = providerSpecificData?.oauthProxy;
  const hasOAuthMode = oauthProxy && isObject(oauthProxy) && hasOwn(oauthProxy, "mode");
  const oauthMode = hasOAuthMode ? normalizeString(oauthProxy.mode) : null;

  if (hasOAuthMode && !OAUTH_PROXY_MODES.has(oauthMode)) {
    return failedStrictProxyConfig(null, "invalid_proxy_mode");
  }

  if (oauthMode === "direct") {
    return directProxyConfig();
  }

  try {
    const strictOAuthPool = oauthMode === "strict-pool";
    const proxyPoolIdRaw = strictOAuthPool ?
    normalizeString(oauthProxy?.poolId) :
    oauthMode === "legacy" ?
    "" :
    normalizeString(providerSpecificData?.proxyPoolId);

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
          const relaySecret = normalizeString(proxyPool.relaySecret);
          return {
            source: proxyPool.type,

            proxyPoolId,
            proxyPool: publicProxyPool(proxyPool),

            connectionProxyEnabled: false,
            connectionProxyUrl: "",
            connectionNoProxy: noProxy,

            strictProxy: strictOAuthPool || proxyPool.strictProxy === true,
            disableEnvProxy: strictOAuthPool,

            // Still mapped to vercelRelayUrl in the unified payload since they
            // use the exact same header spec. Secret rides as URL userinfo for
            // credential hops that only forward vercelRelayUrl; proxyFetch strips it.
            vercelRelayUrl: embedRelaySecretInUrl(proxyUrl, relaySecret),
            relaySecret
          };
        }

        /**
         * Standard proxy pool
         */
        return {
          source: "pool",

          proxyPoolId,
          proxyPool: publicProxyPool(proxyPool),

          connectionProxyEnabled: true,
          connectionProxyUrl: proxyUrl,
          connectionNoProxy: noProxy,

          strictProxy: strictOAuthPool || proxyPool.strictProxy === true,
          disableEnvProxy: strictOAuthPool,
          relaySecret: ""
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
    legacy.connectionProxyUrl)
    {
      return {
        source: "legacy",

        proxyPoolId: proxyPoolId || null,
        proxyPool: null,

        ...legacy,
        vercelRelayUrl: "",
        relaySecret: "",
        strictProxy: false,
        disableEnvProxy: false
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
      vercelRelayUrl: "",
      relaySecret: "",
      strictProxy: false,
      disableEnvProxy: false
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
      vercelRelayUrl: "",
      relaySecret: "",

      strictProxy: false,
      disableEnvProxy: false
    };
  }
}
