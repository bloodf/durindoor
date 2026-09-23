import { NextResponse } from "next/server";
import {
  getProviderConnections,
  createProviderConnection,
  getProviderNodeById,
  getProviderNodes,
  getProxyPoolById } from
"@/models";
import { APIKEY_PROVIDERS } from "@/shared/constants/config";
import { AI_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS, FREE_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider, isHiddenProvider } from "@/shared/constants/providers";
import { normalizeProviderId, normalizeProviderSpecificData } from "@/lib/providerNormalization";
import { requiresProviderAccountId } from "@/lib/providerAccountIds";
import { normalizeAccountIdPlaceholder } from "open-sse/executors/default.js";
import { isFunction, isString } from "../../../shared/utils/typeChecks.js";
import { PROVIDER_MODELS_CONFIG } from "./[id]/models/modelsConfig.js";
import { isOperatorRequest } from "@/dashboardGuard";
import { sanitizeConnectionProxyUrl } from "@/shared/utils/proxyUrlRedaction.js";
import { checkBedrockProfileInput } from "open-sse/shared/awsCredentials.js";

export const dynamic = "force-dynamic";

const SENSITIVE_PROVIDER_SPECIFIC_FIELDS = new Set([
"clientSecret",
"qwenCloudCookie",
"alibabaConsoleCookie",
"cookie",
"QWEN_CLOUD_COOKIE",
// Bedrock STS token as 9router stored it. DurinDoor keeps it in the encrypted top-level field.
"sessionToken",
// Xiaomi account passToken (xiaomi-mimo session login); a long-lived account credential.
"mimoPassToken"]
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

  if (isOpenAICompatibleProvider(provider) || isAnthropicCompatibleProvider(provider)) {
    // route.js:28-36 — needs a configured base URL and a token, else 400/401.
    if (!connection.providerSpecificData?.baseUrl) return false;
    return Boolean(connection.accessToken || connection.apiKey);
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
      case "kimchi":
      case "orcarouter":
        return Boolean(connection.accessToken || connection.apiKey);
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
        return true;
      default:
        return false;
    }
  }

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

    return NextResponse.json({ connections: safeConnections });
  } catch (error) {
    console.log("Error fetching providers:", error);
    return NextResponse.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}

// POST /api/providers - Create new connection (API Key only, OAuth via separate flow)
export async function POST(request) {
  try {
    const body = await request.json();
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
    isCustomEmbeddingProvider(provider);

    if (!provider || !isValidProvider) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }
    if (isHiddenProvider(provider)) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
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
    if (!apiKey && provider !== "ollama-local" && !isNoAuthProvider && !hasApiKeySubstitute) {
      return NextResponse.json({ error: `${isWebCookieProvider ? "Cookie value" : "API Key"} is required` }, { status: 400 });
    }
    const rawConnectionName = name || displayName || AI_PROVIDERS[provider]?.name;
    const connectionName = isString(rawConnectionName) ? rawConnectionName.trim() : "";
    if (!connectionName) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    let providerSpecificData = normalizeProviderSpecificData(provider, body, body.providerSpecificData);
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
    if (isOpenAICompatibleProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "OpenAI Compatible node not found" }, { status: 404 });
      }
      providerSpecificData = {
        prefix: node.prefix,
        apiType: node.apiType,
        baseUrl: node.baseUrl,
        nodeName: node.name
      };
    } else if (isAnthropicCompatibleProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "Anthropic Compatible node not found" }, { status: 404 });
      }
      providerSpecificData = {
        prefix: node.prefix,
        baseUrl: node.baseUrl,
        nodeName: node.name
      };
    } else if (isCustomEmbeddingProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "Custom Embedding node not found" }, { status: 404 });
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

    // Bulk add sends createOnly so a name collision never silently overwrites
    // an existing key (requireNewName → PROVIDER_CONNECTION_NAME_CONFLICT → 409).
    // #6499 — single dashboard add is always create-only: a duplicate
    // (provider, apikey, name) must NOT silently upsert/overwrite
    // (createOnly → PROVIDER_CONNECTION_ALREADY_EXISTS → 409). The repo throws
    // atomically inside its transaction; the explicit update path is
    // updateProviderConnection (PUT /api/providers/[id]).
    let newConnection;
    try {
      newConnection = await createProviderConnection({
        provider,
        authType: isWebCookieProvider ? "cookie" : "apikey",
        name: connectionName,
        apiKey: apiKey || "",
        sessionToken: usesAwsCredentials ? awsSessionToken(sessionToken, body.providerSpecificData) : undefined,
        priority: priority || 1,
        globalPriority: globalPriority || null,
        defaultModel: defaultModel || null,
        providerSpecificData: mergedProviderSpecificData,
        isActive: true,
        testStatus: testStatus || "unknown"
      }, createOnly === true ? { requireNewName: true } : { createOnly: true });
    } catch (error) {
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