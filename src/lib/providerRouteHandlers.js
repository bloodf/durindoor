import { cerebriumBaseUrl } from "open-sse/config/cerebrium.js";
import { LOCAL_CATALOG_WEB_PROVIDERS } from "@/lib/providers/localCatalogProviders.js";
import { NextResponse } from "next/server";
import {
  getProviderConnections,
  createProviderConnection,
  getProviderNodeById,
  getProviderNodes,
  getProxyPoolById } from
"@/models";
import { APIKEY_PROVIDERS } from "@/shared/constants/config";
import { AI_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS, FREE_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider, isSystemoneCompatibleProvider, isHiddenProvider } from "@/shared/constants/providers";
import { normalizeProviderId, normalizeProviderSpecificData } from "@/lib/providerNormalization";
import { requiresProviderAccountId } from "@/lib/providerAccountIds";
import { normalizeAccountIdPlaceholder } from "open-sse/executors/default.js";
import { isFunction, isString } from "@/shared/utils/typeChecks.js";
import { PROVIDER_MODELS_CONFIG } from "@/app/api/providers/[id]/models/modelsConfig.js";
import { resolveOpenCodeServer } from "open-sse/services/opencodeServer.js";
import { isOperatorRequest } from "@/dashboardGuard";
import { sanitizeConnectionProxyUrl } from "@/shared/utils/proxyUrlRedaction.js";
import { checkBedrockProfileInput } from "open-sse/shared/awsCredentials.js";
import { registryAllowsKeylessCredential } from "@/lib/providers/validation/registryCredentials.js";
import {
  compatibleNodeConflictMessage,
  resolveCompatibleNodeIdentity
} from "@/lib/providers/compatibleNodeIdentity";
import {
  encryptedEnvelopeCredentialMessage,
  looksLikeEncryptedEnvelope
} from "@/shared/utils/credentialEnvelope";

const SENSITIVE_PROVIDER_SPECIFIC_FIELDS = new Set([
"chatgptPlanAccount",
"chatgptPlanBindingRevision",
"managementApiKey",
"clientSecret",
"qwenCloudCookie",
"alibabaConsoleCookie",
"cookie",
"QWEN_CLOUD_COOKIE",
// Bedrock STS token as 9router stored it. DurinDoor keeps it in the encrypted top-level field.
"sessionToken",
// Xiaomi account passToken (xiaomi-mimo session login); a long-lived account credential.
"mimoPassToken",
// TinyCMS device UUID imported from site.tinycms.xyz localStorage; it is the whole credential.
"app-config-uuid"]
);

/**
 * The session token to store for a new AWS connection. A client written for 9router may still
 * send it inside providerSpecificData; normalization drops that plaintext copy, so it is lifted
 * into the encrypted field here instead of being lost.
 */
function awsSessionToken(sessionToken, providerSpecificData) {
  const nested = providerSpecificData?.sessionToken;
  const value = isString(sessionToken) && sessionToken.trim() ? sessionToken : nested;
  return isString(value) && value.trim() ? value.trim() : undefined;
}

function sanitizeProviderConnection(connection) {
  const providerSpecificData = connection.providerSpecificData ?
  Object.fromEntries(
    Object.entries(connection.providerSpecificData).
    filter(([key]) => !SENSITIVE_PROVIDER_SPECIFIC_FIELDS.has(key))
  ) :
  connection.providerSpecificData;

  return {
    ...connection,
    managementApiKey: undefined,
    apiKey: undefined,
    accessToken: undefined,
    refreshToken: undefined,
    idToken: undefined,
    firecrawlHeaders: undefined,
    sessionToken: undefined,
    ...(providerSpecificData !== undefined ? { providerSpecificData } : null)
  };
}

// Mirrors src/app/api/providers/[id]/models/route.js branch-for-branch plus
// the per-resolver contracts in open-sse/services/*Models.js so this flag is
// never more permissive than what each resolver actually consumes.
export function canDiscoverModels(connection) {
  const provider = connection.provider;
  if (provider === "cerebrium") return Boolean(cerebriumBaseUrl(connection.providerSpecificData?.baseUrl) && connection.apiKey);
  if (LOCAL_CATALOG_WEB_PROVIDERS.has(provider)) return true; // Curated local catalog.
  if (provider === "reka") return true; // Curated local catalog (OmniRoute #1956).
  // PromptQL lists models through its GraphQL API with the playground JWT, not the session cookie.
  if (provider === "promptql") return Boolean(connection.providerSpecificData?.token || connection.providerSpecificData?.jwt);

  if (isOpenAICompatibleProvider(provider) || isAnthropicCompatibleProvider(provider)) {
    // Compatible servers may expose their catalog without credentials.
    return Boolean(connection.providerSpecificData?.baseUrl);
  }

  const config = PROVIDER_MODELS_CONFIG[provider];
  if (!config) {
    const fetcher = AI_PROVIDERS[provider]?.modelsFetcher;
    if (!fetcher?.url) return false;
    // route.js:99-119 — generic fetcher issues an Authorization header only
    // when `apiKey` exists; without one, upstream 401 surfaces in the
    // browser console. `noAuth` providers can skip auth.
    if (AI_PROVIDERS[provider]?.noAuth === true) return true;
    return Boolean(connection.apiKey);
  }

  if (isFunction(config.customResolver)) {
    // Resolver-specific preconditions — keep in sync with the matching
    // resolve*Models() guard. Returning false here short-circuits the
    // request so the client never spends an HTTP round-trip on a call
    // the resolver would refuse or refuse meaningfully.
    switch (provider) {
      case "opencode-server":
        return !resolveOpenCodeServer(connection).error;
      case "kimchi":
      case "orcarouter":
        return Boolean(connection.accessToken || connection.apiKey);
      case "dothoosh":
        // modelsConfig.js: the listing is read with the connection's key.
        return Boolean(connection.apiKey);
      case "kiro":
        return Boolean(connection.accessToken);
      case "qoder":
      case "qoder-cn":
        return Boolean(connection.accessToken && connection.providerSpecificData?.userId);
      case "github":
        // copilotModels.js:106 — copilotToken OR accessToken; refreshToken
        // alone cannot start refresh.
        return Boolean(connection.providerSpecificData?.copilotToken || connection.accessToken);
      case "gemini-cli":
      case "agy":
        return Boolean(connection.accessToken);
      case "ollama-local":
      case "mlx":
      case "devin-cli-agentic":
        return true;
      default:
        return false;
    }
  }

  if (config.apiKeyOnly) return Boolean(connection.apiKey);

  // route.js:153-156 — plain config path requires a resolvable token.
  return Boolean(connection.providerSpecificData?.copilotToken || connection.accessToken || connection.apiKey);
}

function normalizeProxyConfig(body = {}) {
  const enabled = body?.connectionProxyEnabled === true;
  const url = isString(body?.connectionProxyUrl) ? body.connectionProxyUrl.trim() : "";
  const noProxy = isString(body?.connectionNoProxy) ? body.connectionNoProxy.trim() : "";

  if (enabled && !url) {
    return { error: "Connection proxy URL is required when connection proxy is enabled" };
  }

  return {
    connectionProxyEnabled: enabled,
    connectionProxyUrl: url,
    connectionNoProxy: noProxy
  };
}

async function normalizeProxyPoolId(proxyPoolId) {
  if (proxyPoolId === undefined || proxyPoolId === null || proxyPoolId === "" || proxyPoolId === "__none__") {
    return { proxyPoolId: null };
  }

  const normalizedId = String(proxyPoolId).trim();
  if (!normalizedId) {
    return { proxyPoolId: null };
  }

  const proxyPool = await getProxyPoolById(normalizedId);
  if (!proxyPool) {
    return { error: "Proxy pool not found" };
  }

  return { proxyPoolId: normalizedId };
}

// GET /api/providers - List all connections
export async function GET(request) {
  try {
    const connections = await getProviderConnections();

    // Build nodeNameMap for compatible providers (id → name)
    let nodeNameMap = {};
    try {
      const nodes = await getProviderNodes();
      for (const node of nodes) {
        if (node.id && node.name) nodeNameMap[node.id] = node.name;
      }
    } catch {}

    // Hide sensitive fields, enrich name for compatible providers.
    // connectionProxyUrl may embed `user:password@`; only an operator
    // (dashboard JWT or CLI token) reads it verbatim.
    const privileged = await isOperatorRequest(request);
    const safeConnections = connections.map((c) => {
      const isCompatible = isOpenAICompatibleProvider(c.provider) || isAnthropicCompatibleProvider(c.provider);
      const name = isCompatible ?
      c.name || nodeNameMap[c.provider] || c.providerSpecificData?.nodeName || c.provider :
      c.name;
      return {
        ...sanitizeConnectionProxyUrl(sanitizeProviderConnection({ ...c, name }), privileged),
        canDiscoverModels: canDiscoverModels(c)
      };
    });

    // Keep the original response for callers that do not request filtering.
    const params = new URL(request.url).searchParams;
    const provider = params.get("provider") || "";
    const query = (params.get("q") || "").trim().toLowerCase();
    const paging = params.has("page") || params.has("pageSize");
    if (!provider && !query && !paging) return NextResponse.json({ connections: safeConnections });
    const filtered = safeConnections.filter((c) => (!provider || c.provider === provider) &&
      (!query || [c.email, c.name, c.displayName, c.id].some((v) => String(v || "").toLowerCase().includes(query))));
    const page = Math.max(1, Number.parseInt(params.get("page"), 10) || 1);
    const pageSize = Math.min(200, Math.max(1, Number.parseInt(params.get("pageSize"), 10) || 100));
    return NextResponse.json({ connections: paging ? filtered.slice((page - 1) * pageSize, page * pageSize) : filtered,
      total: filtered.length, page: paging ? page : 1, pageSize: paging ? pageSize : filtered.length });
  } catch (error) {
    console.log("Error fetching providers:", error);
    return NextResponse.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}

// Shared HTTP creation path. Commit guards and import-only policy are internal options.
export async function createProvider(request, { shouldCommit, requireNewCookieName = false } = {}) {
  try {
    const body = await request.json();
    if (body.providerSpecificData && ["chatgptPlanAccount", "chatgptPlanBindingRevision"].some((key) => Object.hasOwn(body.providerSpecificData, key))) return NextResponse.json({ error: "Private account references cannot be supplied" }, { status: 400 });
    const provider = normalizeProviderId(body.provider);
    const { apiKey, sessionToken, name, displayName, priority, globalPriority, defaultModel, testStatus, createOnly } = body;
    const proxyConfig = normalizeProxyConfig(body);
    if (proxyConfig.error) {
      return NextResponse.json({ error: proxyConfig.error }, { status: 400 });
    }

    const proxyPoolResult = await normalizeProxyPoolId(body.proxyPoolId);
    if (proxyPoolResult.error) {
      return NextResponse.json({ error: proxyPoolResult.error }, { status: 400 });
    }
    const proxyPoolId = proxyPoolResult.proxyPoolId;

    // A credential that is already an encrypted envelope would be stored as a
    // ciphertext of a ciphertext and could never decrypt back to a usable key.
    // Reject it here, where the operator can still paste the real key
    // (OmniRoute #15932).
    if (looksLikeEncryptedEnvelope(apiKey)) {
      return NextResponse.json({ error: encryptedEnvelopeCredentialMessage() }, { status: 400 });
    }

    // Validation
    const isNoAuthProvider = AI_PROVIDERS[provider]?.noAuth === true || FREE_PROVIDERS[provider]?.noAuth === true;
    const isWebCookieProvider = !!WEB_COOKIE_PROVIDERS[provider];
    // Dual-auth providers (e.g. codebuddy-cn, xai) live under category "oauth" but also
    // accept an API key via authModes — they aren't in APIKEY_PROVIDERS, so allow them here.
    const supportsApiKeyMode = !!AI_PROVIDERS[provider]?.authModes?.includes("apikey");
    const isValidProvider = APIKEY_PROVIDERS[provider] ||
    FREE_TIER_PROVIDERS[provider] ||
    FREE_PROVIDERS[provider] ||
    supportsApiKeyMode ||
    isWebCookieProvider ||
    isOpenAICompatibleProvider(provider) ||
    isAnthropicCompatibleProvider(provider) ||
    isCustomEmbeddingProvider(provider) ||
    isSystemoneCompatibleProvider(provider);

    if (!provider || !isValidProvider) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }
    if (isHiddenProvider(provider)) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }
    if (provider === "cerebrium") {
      if (!(await isOperatorRequest(request))) return NextResponse.json({ error: "Cerebrium connections require an operator" }, { status: 403 });
      if (!cerebriumBaseUrl(body.providerSpecificData?.baseUrl) || !isString(apiKey) || !apiKey.trim()) return NextResponse.json({ error: "Cerebrium requires a deployment /run URL and project API key" }, { status: 400 });
    }
    if (provider === "devin-cli-agentic") {
      if (!(await isOperatorRequest(request))) {
        return NextResponse.json({ error: "Devin CLI connections require an operator" }, { status: 403 });
      }
      if (apiKey) {
        return NextResponse.json({ error: "Sign in to Devin CLI outside DurinDoor" }, { status: 400 });
      }
    }
    const usesAwsCredentials = AI_PROVIDERS[provider]?.credentialForm === "aws";
    const awsProfile = usesAwsCredentials ? checkBedrockProfileInput(body.providerSpecificData) : { profile: "" };
    if (awsProfile.error) {
      return NextResponse.json({ error: awsProfile.error }, { status: 400 });
    }
    // A stored profile is resolved by the AWS SDK as the server user, which can run a
    // credential_process from ~/.aws/config. Binding one is an operator action, never something
    // an application API key may do.
    if (awsProfile.profile && !(await isOperatorRequest(request))) {
      return NextResponse.json({ error: "AWS profile connections can only be set up from the dashboard or CLI" }, { status: 403 });
    }
    // A provider may declare a providerSpecificData field that stands in for an API key, e.g.
    // Bedrock's `profile`, where the credential lives in the local AWS config and there is no
    // key to paste. Without this, following such a provider's own setup notice returns 400.
    const apiKeySubstitute = AI_PROVIDERS[provider]?.apiKeyOptionalWith;
    const substituteValue = apiKeySubstitute ? body.providerSpecificData?.[apiKeySubstitute] : null;
    const hasApiKeySubstitute = isString(substituteValue) && substituteValue.trim() !== "";
    if (!apiKey && provider !== "ollama-local" && !isNoAuthProvider && !isSystemoneCompatibleProvider(provider) && !isOpenAICompatibleProvider(provider) && !isAnthropicCompatibleProvider(provider) && !isCustomEmbeddingProvider(provider) && !registryAllowsKeylessCredential(provider) && !hasApiKeySubstitute) {
      return NextResponse.json({ error: `${isWebCookieProvider ? "Cookie value" : "API Key"} is required` }, { status: 400 });
    }
    const rawConnectionName = name || displayName || AI_PROVIDERS[provider]?.name;
    const connectionName = isString(rawConnectionName) ? rawConnectionName.trim() : "";
    if (!connectionName) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    let providerSpecificData = normalizeProviderSpecificData(provider, body, body.providerSpecificData);
    if (provider === "opencode-server") {
      if (!(await isOperatorRequest(request))) {
        return NextResponse.json({ error: "OpenCode Server connections require an operator" }, { status: 403 });
      }
      const endpoint = resolveOpenCodeServer({ providerSpecificData, apiKey });
      if (endpoint.error) return NextResponse.json({ error: endpoint.error }, { status: endpoint.status });
      providerSpecificData = { ...providerSpecificData, baseUrl: endpoint.baseUrl };
    }
    if (requiresProviderAccountId(provider)) {
      try {
        providerSpecificData = {
          ...(providerSpecificData || {}),
          accountId: normalizeAccountIdPlaceholder(provider, providerSpecificData?.accountId)
        };
      } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    if (provider === "google-pse" && !providerSpecificData?.cx) {
      return NextResponse.json({ error: "Programmable Search Engine ID (cx) is required" }, { status: 400 });
    }

    // Compatible/embedding nodes — no longer enforce single-connection limit.
    // Multiple API keys per node are allowed; downstream auth logic handles
    // round-robin/fill-first/fallback across connections (src/sse/services/auth.js).
    // A node owns its identity: a connection that carries a different endpoint
    // than its node would send the stored API key to a different host, so a
    // conflicting value is rejected instead of silently overwritten
    // (OmniRoute #15987).
    if (isOpenAICompatibleProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "OpenAI Compatible node not found" }, { status: 404 });
      }
      const identity = resolveCompatibleNodeIdentity(node, providerSpecificData, true);
      if (identity.conflict) {
        return NextResponse.json({ error: compatibleNodeConflictMessage(identity.conflict) }, { status: 400 });
      }
      providerSpecificData = identity.data;
    } else if (isAnthropicCompatibleProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "Anthropic Compatible node not found" }, { status: 404 });
      }
      const identity = resolveCompatibleNodeIdentity(node, providerSpecificData, false);
      if (identity.conflict) {
        return NextResponse.json({ error: compatibleNodeConflictMessage(identity.conflict) }, { status: 400 });
      }
      providerSpecificData = identity.data;
    } else if (isCustomEmbeddingProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "Custom Embedding node not found" }, { status: 404 });
      }
      const identity = resolveCompatibleNodeIdentity(node, providerSpecificData, false);
      if (identity.conflict) {
        return NextResponse.json({ error: compatibleNodeConflictMessage(identity.conflict) }, { status: 400 });
      }
      providerSpecificData = identity.data;
    }
    else if (isSystemoneCompatibleProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node || node.type !== "systemone-compatible") {
        return NextResponse.json({ error: "System One compatible node not found" }, { status: 404 });
      }
      providerSpecificData = {
        prefix: node.prefix,
        baseUrl: node.baseUrl,
        nodeName: node.name
      };
    }

    const mergedProviderSpecificData = {
      ...(providerSpecificData || {}),
      connectionProxyEnabled: proxyConfig.connectionProxyEnabled,
      connectionProxyUrl: proxyConfig.connectionProxyUrl,
      connectionNoProxy: proxyConfig.connectionNoProxy
    };

    if (proxyPoolId !== null) {
      mergedProviderSpecificData.proxyPoolId = proxyPoolId;
    }
    if (provider === "opencode-server" &&
      (proxyPoolId !== null || mergedProviderSpecificData.connectionProxyEnabled || mergedProviderSpecificData.vercelRelayUrl || mergedProviderSpecificData.oauthProxy?.mode === "strict-pool")) {
      return NextResponse.json({ error: "OpenCode Server requires a direct connection" }, { status: 400 });
    }
    if ((provider === "laya" || isSystemoneCompatibleProvider(provider)) &&
      (proxyPoolId !== null || mergedProviderSpecificData.connectionProxyEnabled || mergedProviderSpecificData.vercelRelayUrl || mergedProviderSpecificData.oauthProxy?.mode === "strict-pool")) {
      return NextResponse.json({ error: "Outbound proxies are not supported for guarded System One server URLs" }, { status: 400 });
    }

    // Bulk add sends createOnly so a name collision never silently overwrites
    // an existing key (requireNewName → PROVIDER_CONNECTION_NAME_CONFLICT → 409).
    // #6499 — single dashboard add is always create-only: a duplicate
    // (provider, apikey, name) must NOT silently upsert/overwrite
    // (createOnly → PROVIDER_CONNECTION_ALREADY_EXISTS → 409). The repo throws
    // atomically inside its transaction; the explicit update path is
    // updateProviderConnection (PUT /api/providers/[id]).
    const connectionOptions = createOnly === true ? { requireNewName: true } : { createOnly: true };
    if (requireNewCookieName) connectionOptions.requireNewCookieName = true;
    if (isFunction(shouldCommit)) {
      connectionOptions.shouldCommit = shouldCommit;
    }
    let newConnection;
    try {
      newConnection = await createProviderConnection({
        provider,
        authType: isWebCookieProvider ? "cookie" : "apikey",
        name: connectionName,
        apiKey: apiKey || "",
        managementApiKey: provider === "xai" && isString(body.managementApiKey) ? body.managementApiKey.trim() : undefined,
        sessionToken: usesAwsCredentials ? awsSessionToken(sessionToken, body.providerSpecificData) : undefined,
        priority: priority || 1,
        globalPriority: globalPriority || null,
        defaultModel: defaultModel || null,
        providerSpecificData: mergedProviderSpecificData,
        isActive: true,
        testStatus: testStatus || "unknown"
      }, connectionOptions);
    } catch (error) {
      if (isFunction(shouldCommit) && !shouldCommit()) {
        return NextResponse.json({ error: "Login session expired or was cancelled or replaced" }, { status: 409 });
      }
      if (error?.code === "PROVIDER_CONNECTION_ALREADY_EXISTS" || error?.code === "PROVIDER_CONNECTION_NAME_CONFLICT") {
        return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
      }
      throw error;
    }

    // Hide sensitive fields. Echoing the created connection is a read of a
    // stored proxy credential, so it is redacted like the list route.
    const createPrivileged = await isOperatorRequest(request);
    const result = sanitizeConnectionProxyUrl(
      sanitizeProviderConnection(newConnection),
      createPrivileged
    );

    return NextResponse.json({ connection: result }, { status: 201 });
  } catch (error) {
    if (error?.code === "PROVIDER_CONNECTION_NAME_CONFLICT") {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    console.log("Error creating provider:", error);
    return NextResponse.json({ error: "Failed to create provider" }, { status: 500 });
  }
}
