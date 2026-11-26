import { NextResponse } from "next/server";
import { canManageAccessConfig } from "@/dashboardGuard";
import { createProviderNode, getProviderNodes } from "@/lib/localDb";
import { OPENAI_COMPATIBLE_PREFIX, ANTHROPIC_COMPATIBLE_PREFIX, CUSTOM_EMBEDDING_PREFIX, SYSTEMONE_COMPATIBLE_PREFIX } from "@/shared/constants/providers";
import REGISTRY from "open-sse/providers/registry/index.js";

import { generateId } from "@/shared/utils";
import { isString } from "@/shared/utils/typeChecks";

import { PROVIDER_NODE_INVALID, validateProviderNode } from "@/lib/providerNodes/validateNode";

export const dynamic = "force-dynamic";

// Node types the create route accepts, with the base URL used when the payload omits one.
// System One has no default: its endpoint is always operator-supplied.
const NODE_TYPE_DEFAULT_BASE_URL = new Map([
  ["openai-compatible", "https://api.openai.com/v1"],
  ["custom-embedding", "https://api.openai.com/v1"],
  ["anthropic-compatible", "https://api.anthropic.com/v1"],
  ["systemone-compatible", undefined]
]);
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
    const { apiType, type, providerIdSuffix } = body;

    // Determine type
    const nodeType = type || "openai-compatible";
    if (!NODE_TYPE_DEFAULT_BASE_URL.has(nodeType)) {
      return NextResponse.json({ error: "Invalid provider node type" }, { status: 400 });
    }

    const checked = validateProviderNode(body, { type: nodeType, strict: true });
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: checked.status });
    const { name: nodeName, prefix: nodePrefix, baseUrl: nodeBaseUrl, iconUrl } = checked.value;
    const iconFields = iconUrl !== undefined ? { iconUrl } : null;

    const providerSuffix = nodeType === "openai-compatible" || nodeType === "anthropic-compatible" ?
    normalizeProviderIdSuffix(providerIdSuffix) :
    "";
    if (providerSuffix === null) {
      return NextResponse.json(
        { error: "Provider ID suffix can only contain letters, numbers, -, _ and ." },
        { status: 400 }
      );
    }

    if (nodeType === "systemone-compatible") {
      const isReservedPrefix = (value) => REGISTRY.some((provider) => [provider.id, provider.alias, provider.uiAlias, ...(provider.aliases || [])].includes(value));
      if (isReservedPrefix(nodePrefix) || (await getProviderNodes()).some((node) => node.prefix === nodePrefix)) {
        return NextResponse.json({ error: "Provider prefix already exists or is reserved" }, { status: 409 });
      }
    }

    const idByType = {
      "openai-compatible": () => `${OPENAI_COMPATIBLE_PREFIX}${apiType}-${providerSuffix || generateId()}`,
      "custom-embedding": () => `${CUSTOM_EMBEDDING_PREFIX}${generateId()}`,
      "systemone-compatible": () => `${SYSTEMONE_COMPATIBLE_PREFIX}${generateId()}`,
      "anthropic-compatible": () => `${ANTHROPIC_COMPATIBLE_PREFIX}${providerSuffix || generateId()}`
    };
    const node = await createProviderNode({
      id: idByType[nodeType](),
      type: nodeType,
      prefix: nodePrefix,
      ...(nodeType === "openai-compatible" ? { apiType } : null),
      baseUrl: nodeBaseUrl,
      name: nodeName,
      ...iconFields
    });
    return NextResponse.json({ node }, { status: 201 });
  } catch (error) {
    if (error?.code === PROVIDER_NODE_INVALID) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error?.code === "PROVIDER_NODE_ID_CONFLICT") {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    console.log("Error creating provider node:", error);
    return NextResponse.json({ error: "Failed to create provider node" }, { status: 500 });
  }
}
