import { NextResponse } from "next/server";
import {
  getProviderConnections,
  createProviderConnection,
  getProviderNodeById,
  getProviderNodes,
  getProxyPoolById,
} from "@/models";
import { APIKEY_PROVIDERS } from "@/shared/constants/config";
import { AI_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS, FREE_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider, isHiddenProvider } from "@/shared/constants/providers";
import { normalizeProviderId, normalizeProviderSpecificData } from "@/lib/providerNormalization";
import { requiresProviderAccountId } from "@/lib/providerAccountIds";
import { normalizeAccountIdPlaceholder } from "open-sse/executors/default.js";

export const dynamic = "force-dynamic";

const SENSITIVE_PROVIDER_SPECIFIC_FIELDS = new Set(["clientSecret"]);

function sanitizeProviderConnection(connection) {
  const providerSpecificData = connection.providerSpecificData
    ? Object.fromEntries(
        Object.entries(connection.providerSpecificData)
          .filter(([key]) => !SENSITIVE_PROVIDER_SPECIFIC_FIELDS.has(key))
      )
    : connection.providerSpecificData;

  return {
    ...connection,
    apiKey: undefined,
    accessToken: undefined,
    refreshToken: undefined,
    idToken: undefined,
    ...(providerSpecificData !== undefined ? { providerSpecificData } : {}),
  };
}

function normalizeProxyConfig(body = {}) {
  const enabled = body?.connectionProxyEnabled === true;
  const url = typeof body?.connectionProxyUrl === "string" ? body.connectionProxyUrl.trim() : "";
  const noProxy = typeof body?.connectionNoProxy === "string" ? body.connectionNoProxy.trim() : "";

  if (enabled && !url) {
    return { error: "Connection proxy URL is required when connection proxy is enabled" };
  }

  return {
    connectionProxyEnabled: enabled,
    connectionProxyUrl: url,
    connectionNoProxy: noProxy,
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
export async function GET() {
  try {
    const connections = await getProviderConnections();

    // Build nodeNameMap for compatible providers (id → name)
    let nodeNameMap = {};
    try {
      const nodes = await getProviderNodes();
      for (const node of nodes) {
        if (node.id && node.name) nodeNameMap[node.id] = node.name;
      }
    } catch { }

    // Hide sensitive fields, enrich name for compatible providers
    const safeConnections = connections.map(c => {
      const isCompatible = isOpenAICompatibleProvider(c.provider) || isAnthropicCompatibleProvider(c.provider);
      const name = isCompatible
        ? (c.name || nodeNameMap[c.provider] || c.providerSpecificData?.nodeName || c.provider)
        : c.name;
      return sanitizeProviderConnection({ ...c, name });
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
    const { apiKey, name, displayName, priority, globalPriority, defaultModel, testStatus, createOnly } = body;
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
    if (!apiKey && provider !== "ollama-local" && !isNoAuthProvider) {
      return NextResponse.json({ error: `${isWebCookieProvider ? "Cookie value" : "API Key"} is required` }, { status: 400 });
    }
    const rawConnectionName = name || displayName || AI_PROVIDERS[provider]?.name;
    const connectionName = typeof rawConnectionName === "string" ? rawConnectionName.trim() : "";
    if (!connectionName) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    let providerSpecificData = normalizeProviderSpecificData(provider, body, body.providerSpecificData);
    if (requiresProviderAccountId(provider)) {
      try {
        providerSpecificData = {
          ...(providerSpecificData || {}),
          accountId: normalizeAccountIdPlaceholder(provider, providerSpecificData?.accountId),
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
        nodeName: node.name,
      };
    } else if (isAnthropicCompatibleProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "Anthropic Compatible node not found" }, { status: 404 });
      }
      providerSpecificData = {
        prefix: node.prefix,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    } else if (isCustomEmbeddingProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "Custom Embedding node not found" }, { status: 404 });
      }
      providerSpecificData = {
        prefix: node.prefix,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    }

    const mergedProviderSpecificData = {
      ...(providerSpecificData || {}),
      connectionProxyEnabled: proxyConfig.connectionProxyEnabled,
      connectionProxyUrl: proxyConfig.connectionProxyUrl,
      connectionNoProxy: proxyConfig.connectionNoProxy,
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
        priority: priority || 1,
        globalPriority: globalPriority || null,
        defaultModel: defaultModel || null,
        providerSpecificData: mergedProviderSpecificData,
        isActive: true,
        testStatus: testStatus || "unknown",
      }, createOnly === true ? { requireNewName: true } : { createOnly: true });
    } catch (error) {
      if (error?.code === "PROVIDER_CONNECTION_ALREADY_EXISTS" || error?.code === "PROVIDER_CONNECTION_NAME_CONFLICT") {
        return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
      }
      throw error;
    }

    // Hide sensitive fields
    const result = sanitizeProviderConnection(newConnection);

    return NextResponse.json({ connection: result }, { status: 201 });
  } catch (error) {
    if (error?.code === "PROVIDER_CONNECTION_NAME_CONFLICT") {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    console.log("Error creating provider:", error);
    return NextResponse.json({ error: "Failed to create provider" }, { status: 500 });
  }
}
