import { NextResponse } from "next/server";
import {
  getProviderConnectionById,
  getProxyPoolById,
  updateProviderConnection,
  deleteProviderConnection,
} from "@/models";
import { requiresProviderAccountId } from "@/lib/providerAccountIds";
import { mergeProviderSpecificData } from "@/lib/db/helpers/mergeProviderMetadata.js";
import { buildOAuthProxyMetadataPatch } from "@/lib/oauth/proxySelection.js";
import { normalizeAccountIdPlaceholder } from "open-sse/executors/default.js";
import { notifyQuotaAutoPingSettingChanged } from "@/shared/services/quotaAutoPing";

const SENSITIVE_PROVIDER_SPECIFIC_FIELDS = new Set(["clientSecret"]);

function sanitizeProviderConnection(connection) {
  const providerSpecificData = connection.providerSpecificData
    ? Object.fromEntries(
        Object.entries(connection.providerSpecificData)
          .filter(([key]) => !SENSITIVE_PROVIDER_SPECIFIC_FIELDS.has(key))
      )
    : connection.providerSpecificData;

  const result = {
    ...connection,
    ...(providerSpecificData !== undefined ? { providerSpecificData } : {}),
  };
  delete result.apiKey;
  delete result.accessToken;
  delete result.refreshToken;
  delete result.idToken;
  return result;
}

function normalizeProxyConfig(body = {}) {
  const hasAnyProxyField =
    Object.prototype.hasOwnProperty.call(body, "connectionProxyEnabled") ||
    Object.prototype.hasOwnProperty.call(body, "connectionProxyUrl") ||
    Object.prototype.hasOwnProperty.call(body, "connectionNoProxy");

  if (!hasAnyProxyField) return { hasAnyProxyField: false };

  const enabled = body?.connectionProxyEnabled === true;
  const url = typeof body?.connectionProxyUrl === "string" ? body.connectionProxyUrl.trim() : "";
  const noProxy = typeof body?.connectionNoProxy === "string" ? body.connectionNoProxy.trim() : "";

  if (enabled && !url) {
    return {
      hasAnyProxyField: true,
      error: "Connection proxy URL is required when connection proxy is enabled",
    };
  }

  return {
    hasAnyProxyField: true,
    connectionProxyEnabled: enabled,
    connectionProxyUrl: url,
    connectionNoProxy: noProxy,
  };
}

async function normalizeProxyPoolUpdate(proxyPoolIdInput) {
  if (proxyPoolIdInput === undefined) {
    return { hasProxyPoolField: false, proxyPoolId: null };
  }

  if (proxyPoolIdInput === null || proxyPoolIdInput === "" || proxyPoolIdInput === "__none__") {
    return { hasProxyPoolField: true, proxyPoolId: null };
  }

  const proxyPoolId = String(proxyPoolIdInput).trim();
  if (!proxyPoolId) {
    return { hasProxyPoolField: true, proxyPoolId: null };
  }

  const proxyPool = await getProxyPoolById(proxyPoolId);
  if (!proxyPool) {
    return { hasProxyPoolField: true, error: "Proxy pool not found" };
  }

  return { hasProxyPoolField: true, proxyPoolId };
}

function shouldMergeProviderSpecificData(existing, incoming, hasLegacyProxy, hasProxyPoolField) {
  return existing !== undefined || incoming !== undefined || hasLegacyProxy || hasProxyPoolField;
}

function hasDurableOAuthProxyPolicy(connection) {
  return connection?.authType === "oauth" ||
    connection?.authType === "access_token" ||
    (connection?.providerSpecificData?.oauthProxy &&
      typeof connection.providerSpecificData.oauthProxy === "object");
}

/**
 * Keep the legacy top-level pool binding and the authoritative OAuth policy in
 * sync. A null assignment is persisted (rather than deleting the key) so the
 * DB metadata merge cannot resurrect a previously selected pool.
 */
function applyProxyPoolMetadataUpdate(metadata, proxyPoolId, connection) {
  if (!hasDurableOAuthProxyPolicy(connection)) {
    return { ...metadata, proxyPoolId };
  }

  return mergeProviderSpecificData(
    metadata,
    buildOAuthProxyMetadataPatch(
      proxyPoolId === null
        ? { proxyMode: "direct" }
        : { proxyMode: "strict-pool", proxyPoolId },
    ),
  );
}

// GET /api/providers/[id] - Get single connection
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    // Hide sensitive fields
    const result = sanitizeProviderConnection(connection);

    return NextResponse.json({ connection: result });
  } catch (error) {
    console.log("Error fetching connection:", error);
    return NextResponse.json({ error: "Failed to fetch connection" }, { status: 500 });
  }
}

// PUT /api/providers/[id] - Update connection
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      name,
      priority,
      globalPriority,
      defaultModel,
      isActive,
      apiKey,
      testStatus,
      lastError,
      lastErrorAt,
      providerSpecificData
    } = body;

    const existing = await getProviderConnectionById(id);
    if (!existing) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const proxyConfig = normalizeProxyConfig(body);
    if (proxyConfig.error) {
      return NextResponse.json({ error: proxyConfig.error }, { status: 400 });
    }

    const proxyPoolResult = await normalizeProxyPoolUpdate(body.proxyPoolId);
    if (proxyPoolResult.error) {
      return NextResponse.json({ error: proxyPoolResult.error }, { status: 400 });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (priority !== undefined) updateData.priority = priority;
    if (globalPriority !== undefined) updateData.globalPriority = globalPriority;
    if (defaultModel !== undefined) updateData.defaultModel = defaultModel;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (apiKey && existing.authType === "apikey") updateData.apiKey = apiKey;
    if (testStatus !== undefined) updateData.testStatus = testStatus;
    if (lastError !== undefined) updateData.lastError = lastError;
    if (lastErrorAt !== undefined) updateData.lastErrorAt = lastErrorAt;

    if (
      shouldMergeProviderSpecificData(
        existing.providerSpecificData,
        providerSpecificData,
        proxyConfig.hasAnyProxyField,
        proxyPoolResult.hasProxyPoolField
      )
    ) {
      updateData.providerSpecificData = mergeProviderSpecificData(
        existing.providerSpecificData,
        providerSpecificData,
      );

      if (proxyConfig.hasAnyProxyField) {
        updateData.providerSpecificData.connectionProxyEnabled = proxyConfig.connectionProxyEnabled;
        updateData.providerSpecificData.connectionProxyUrl = proxyConfig.connectionProxyUrl;
        updateData.providerSpecificData.connectionNoProxy = proxyConfig.connectionNoProxy;
      }

      if (proxyPoolResult.hasProxyPoolField) {
        updateData.providerSpecificData = applyProxyPoolMetadataUpdate(
          updateData.providerSpecificData,
          proxyPoolResult.proxyPoolId,
          existing,
        );
      }
    }

    if (requiresProviderAccountId(existing.provider)) {
      const merged = updateData.providerSpecificData || existing.providerSpecificData || {};
      try {
        updateData.providerSpecificData = {
          ...merged,
          accountId: normalizeAccountIdPlaceholder(existing.provider, merged.accountId),
        };
      } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    const updated = await updateProviderConnection(id, updateData);
    if (isActive === false) notifyQuotaAutoPingSettingChanged(existing.provider, id, false);

    // Hide sensitive fields
    const result = sanitizeProviderConnection(updated);

    return NextResponse.json({ connection: result });
  } catch (error) {
    console.log("Error updating connection:", error);
    return NextResponse.json({ error: "Failed to update connection" }, { status: 500 });
  }
}

// DELETE /api/providers/[id] - Delete connection
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const existing = await getProviderConnectionById(id);

    const deleted = await deleteProviderConnection(id);
    if (!deleted) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    if (existing) notifyQuotaAutoPingSettingChanged(existing.provider, id, false);

    return NextResponse.json({ message: "Connection deleted successfully" });
  } catch (error) {
    console.log("Error deleting connection:", error);
    return NextResponse.json({ error: "Failed to delete connection" }, { status: 500 });
  }
}
