import { NextResponse } from "next/server";
import { canManageAccessConfig } from "@/dashboardGuard";
import { createProviderNode, getProviderNodes } from "@/models";
import { OPENAI_COMPATIBLE_PREFIX, ANTHROPIC_COMPATIBLE_PREFIX, CUSTOM_EMBEDDING_PREFIX, SYSTEMONE_COMPATIBLE_PREFIX } from "@/shared/constants/providers";
import { normalizeSystemoneBaseUrl } from "open-sse/config/systemone.js";
import REGISTRY from "open-sse/providers/registry/index.js";

import { generateId } from "@/shared/utils";
import { isString } from "@/shared/utils/typeChecks";

import { isValidProviderIconUrl } from "@/shared/utils/providerIcon";
import { assertOutboundUrlAllowed } from "open-sse/utils/outboundUrlGuard.js";

function isAllowedNodeBaseUrl(value) {
  try {
    assertOutboundUrlAllowed(value);
    return true;
  } catch {
    return false;
  }
}

export const dynamic = "force-dynamic";

const OPENAI_COMPATIBLE_DEFAULTS = {
  baseUrl: "https://api.openai.com/v1"
};

const ANTHROPIC_COMPATIBLE_DEFAULTS = {
  baseUrl: "https://api.anthropic.com/v1"
};

const CUSTOM_EMBEDDING_DEFAULTS = {
  baseUrl: "https://api.openai.com/v1"
};
const PROVIDER_ID_SUFFIX_REGEX = /^[a-zA-Z0-9_.-]+$/;

// Optional operator-chosen ID suffix (#4710). Returns "" when absent, null when invalid.
function normalizeProviderIdSuffix(value) {
  if (value == null) return "";
  if (!isString(value)) return null;
  const suffix = value.trim();
  return suffix && !PROVIDER_ID_SUFFIX_REGEX.test(suffix) ? null : suffix;
}

// GET /api/provider-nodes - List all provider nodes
export async function GET() {
  try {
    const nodes = await getProviderNodes();
    return NextResponse.json({ nodes });
  } catch (error) {
    console.log("Error fetching provider nodes:", error);
    return NextResponse.json({ error: "Failed to fetch provider nodes" }, { status: 500 });
  }
}

// POST /api/provider-nodes - Create provider node
export async function POST(request) {
  if (!(await canManageAccessConfig(request))) {
    return NextResponse.json({ error: "Creating a provider node requires an operator session" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { name, prefix, apiType, baseUrl, type, iconUrl, providerIdSuffix } = body;
    if (baseUrl !== undefined && baseUrl !== null && !isString(baseUrl)) {
      return NextResponse.json({ error: "Invalid base URL" }, { status: 400 });
    }

    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (!prefix?.trim()) {
      return NextResponse.json({ error: "Prefix is required" }, { status: 400 });
    }
    if (iconUrl !== undefined && !isValidProviderIconUrl(iconUrl)) {
      return NextResponse.json({ error: "Invalid icon URL" }, { status: 400 });
    }

    // Determine type
    const nodeType = type || "openai-compatible";
    const providerSuffix = nodeType === "openai-compatible" || nodeType === "anthropic-compatible" ?
    normalizeProviderIdSuffix(providerIdSuffix) :
    "";
    if (providerSuffix === null) {
      return NextResponse.json(
        { error: "Provider ID suffix can only contain letters, numbers, -, _ and ." },
        { status: 400 }
      );
    }

    if (nodeType === "openai-compatible") {
      if (!apiType || !["chat", "responses"].includes(apiType)) {
        return NextResponse.json({ error: "Invalid OpenAI compatible API type" }, { status: 400 });
      }
      const nodeBaseUrl = (baseUrl || OPENAI_COMPATIBLE_DEFAULTS.baseUrl).trim();
      if (!isAllowedNodeBaseUrl(nodeBaseUrl)) return NextResponse.json({ error: "Invalid or blocked base URL" }, { status: 400 });

      const node = await createProviderNode({
        id: `${OPENAI_COMPATIBLE_PREFIX}${apiType}-${providerSuffix || generateId()}`,
        type: "openai-compatible",
        prefix: prefix.trim(),
        apiType,
        baseUrl: nodeBaseUrl,
        name: name.trim(),
        ...(iconUrl !== undefined ? { iconUrl: iconUrl.trim() } : null)
      });
      return NextResponse.json({ node }, { status: 201 });
    }

    if (nodeType === "custom-embedding") {
      // Strip trailing slash and /embeddings if user pasted full endpoint
      let sanitizedBaseUrl = (baseUrl || CUSTOM_EMBEDDING_DEFAULTS.baseUrl).trim().replace(/\/$/, "");
      if (sanitizedBaseUrl.endsWith("/embeddings")) {
        sanitizedBaseUrl = sanitizedBaseUrl.slice(0, -"/embeddings".length);
      }
      if (!isAllowedNodeBaseUrl(sanitizedBaseUrl)) return NextResponse.json({ error: "Invalid or blocked base URL" }, { status: 400 });

      const node = await createProviderNode({
        id: `${CUSTOM_EMBEDDING_PREFIX}${generateId()}`,
        type: "custom-embedding",
        prefix: prefix.trim(),
        baseUrl: sanitizedBaseUrl,
        name: name.trim(),
        ...(iconUrl !== undefined ? { iconUrl: iconUrl.trim() } : null)
      });
      return NextResponse.json({ node }, { status: 201 });
    }

    const isReservedPrefix = (value) => REGISTRY.some((provider) => [provider.id, provider.alias, provider.uiAlias, ...(provider.aliases || [])].includes(value));
    if (nodeType === "systemone-compatible" && (isReservedPrefix(prefix.trim()) || (await getProviderNodes()).some((node) => node.prefix === prefix.trim()))) {
      return NextResponse.json({ error: "Provider prefix already exists or is reserved" }, { status: 409 });
    }

    if (nodeType === "systemone-compatible") {
      let normalizedBaseUrl;
      try { normalizedBaseUrl = normalizeSystemoneBaseUrl(baseUrl); } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (!isAllowedNodeBaseUrl(normalizedBaseUrl)) return NextResponse.json({ error: "Invalid or blocked base URL" }, { status: 400 });
      const node = await createProviderNode({
        id: `${SYSTEMONE_COMPATIBLE_PREFIX}${generateId()}`,
        type: "systemone-compatible",
        prefix: prefix.trim(),
        baseUrl: normalizedBaseUrl,
        name: name.trim(),
        ...(iconUrl !== undefined ? { iconUrl: iconUrl.trim() } : null)
      });
      return NextResponse.json({ node }, { status: 201 });
    }

    if (nodeType === "anthropic-compatible") {
      // Sanitize Base URL: remove trailing slash, and remove trailing /messages if user added it
      // This prevents double-appending /messages at runtime
      let sanitizedBaseUrl = (baseUrl || ANTHROPIC_COMPATIBLE_DEFAULTS.baseUrl).trim().replace(/\/$/, "");
      if (sanitizedBaseUrl.endsWith("/messages")) {
        sanitizedBaseUrl = sanitizedBaseUrl.slice(0, -9); // remove /messages
      }
      if (!isAllowedNodeBaseUrl(sanitizedBaseUrl)) return NextResponse.json({ error: "Invalid or blocked base URL" }, { status: 400 });

      const node = await createProviderNode({
        id: `${ANTHROPIC_COMPATIBLE_PREFIX}${providerSuffix || generateId()}`,
        type: "anthropic-compatible",
        prefix: prefix.trim(),
        baseUrl: sanitizedBaseUrl,
        name: name.trim(),
        ...(iconUrl !== undefined ? { iconUrl: iconUrl.trim() } : null)
      });
      return NextResponse.json({ node }, { status: 201 });
    }

    return NextResponse.json({ error: "Invalid provider node type" }, { status: 400 });
  } catch (error) {
    if (error?.code === "PROVIDER_NODE_ID_CONFLICT") {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    console.log("Error creating provider node:", error);
    return NextResponse.json({ error: "Failed to create provider node" }, { status: 500 });
  }
}
