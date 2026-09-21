import { NextResponse } from "next/server";
import { isValidGitHubCreditLimit } from "open-sse/services/githubCreditLimit.js";
import {
  getProviderConnectionById,
  getProxyPoolById,
  updateProviderConnection,
  deleteProviderConnection } from
"@/models";
import { requiresProviderAccountId } from "@/lib/providerAccountIds";
import { mergeProviderSpecificData } from "@/lib/db/helpers/mergeProviderMetadata.js";
import { buildOAuthProxyMetadataPatch } from "@/lib/oauth/proxySelection.js";
import { normalizeAccountIdPlaceholder } from "open-sse/executors/default.js";
import { notifyQuotaAutoPingSettingChanged } from "@/shared/services/quotaAutoPing";
import { normalizeProviderSpecificData } from "@/lib/providerNormalization";
import { isObject, isString } from "../../../../shared/utils/typeChecks.js";
import { isOperatorRequest } from "@/dashboardGuard";
import { sanitizeConnectionProxyUrl } from "@/shared/utils/proxyUrlRedaction.js";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { checkBedrockProfileInput } from "open-sse/shared/awsCredentials.js";

const SENSITIVE_PROVIDER_SPECIFIC_FIELDS = new Set([
"clientSecret",
"qwenCloudCookie",
"alibabaConsoleCookie",
"cookie",
"QWEN_CLOUD_COOKIE",
// Bedrock STS token as 9router stored it. DurinDoor keeps it in the encrypted top-level field.
"sessionToken"]
);

// Port of OmniRoute #6562/#6626: `priority` auto-increments unbounded on
// connection creation (`MAX(priority)+1` per provider in connectionsRepo),
// and the edit UI always round-trips the connection's current priority
// unchanged on save. A UI-only ceiling of 100 therefore rejected re-saving
// already-valid, already-persisted priorities with "Invalid request" on every
// edit once a provider exceeded 100 rotated accounts (e.g. bulk OAuth import).
// The ceiling is now bounded well above any legitimate value instead.
const MAX_CONNECTION_PRIORITY = 100_000;

// Mirrors the source schema (`z.coerce.number().int().min(1).max(100_000)`):
// accepts numeric strings as well as numbers, rejects everything else.
// Returns the coerced integer when valid, `null` otherwise.
function coerceConnectionPriority(value) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1 || num > MAX_CONNECTION_PRIORITY) return null;
  return num;
}

// Mirrors OmniRoute's `validateBody` failure envelope
// (`{ error: { message: "Invalid request", details: [{ field, message }] } }`).
// This is a JS adaptation: durindoor has no Zod, so the nested shape is
// reproduced by hand. The upstream regression only asserts
// `body?.error?.message === "Invalid request"`; the per-issue `details` text is
// Zod-generated upstream and is not imitated here.
function invalidRequest(field) {
  return NextResponse.json(
    { error: { message: "Invalid request", details: [{ field, message: "Invalid value" }] } },
    { status: 400 }
  );
}

function sanitizeProviderConnection(connection) {
  const providerSpecificData = connection.providerSpecificData ?
  Object.fromEntries(
    Object.entries(normalizeOpenAIStoreSetting(connection.provider, connection.providerSpecificData)).
    filter(([key]) => !SENSITIVE_PROVIDER_SPECIFIC_FIELDS.has(key))
  ) :
  connection.providerSpecificData;

  const result = {
    ...connection,
    ...(providerSpecificData !== undefined ? { providerSpecificData } : null)
  };
  delete result.apiKey;
  delete result.accessToken;
  delete result.refreshToken;
  delete result.idToken;
  delete result.firecrawlHeaders;
  delete result.sessionToken;
  return result;
}

function normalizeProxyConfig(body = {}) {
  const hasAnyProxyField =
  Object.prototype.hasOwnProperty.call(body, "connectionProxyEnabled") ||
  Object.prototype.hasOwnProperty.call(body, "connectionProxyUrl") ||
  Object.prototype.hasOwnProperty.call(body, "connectionNoProxy");

  if (!hasAnyProxyField) return { hasAnyProxyField: false };

  const enabled = body?.connectionProxyEnabled === true;
  const url = isString(body?.connectionProxyUrl) ? body.connectionProxyUrl.trim() : "";
  const noProxy = isString(body?.connectionNoProxy) ? body.connectionNoProxy.trim() : "";

  if (enabled && !url) {
    return {
      hasAnyProxyField: true,
      error: "Connection proxy URL is required when connection proxy is enabled"
    };
  }

  return {
    hasAnyProxyField: true,
    connectionProxyEnabled: enabled,
    connectionProxyUrl: url,
    connectionNoProxy: noProxy
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

function normalizeOpenAIStoreSetting(provider, providerSpecificData) {
  if (!providerSpecificData || provider === "openai" || provider?.startsWith("openai-compatible-responses-")) {
    return providerSpecificData;
  }
  const { openaiStoreEnabled: _ignored, ...remaining } = providerSpecificData;
  return remaining;
}

function hasDurableOAuthProxyPolicy(connection) {
  return connection?.authType === "oauth" ||
  connection?.authType === "access_token" ||
  connection?.providerSpecificData?.oauthProxy && isObject(
    connection.providerSpecificData.oauthProxy);
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
      proxyPoolId === null ?
      { proxyMode: "direct" } :
      { proxyMode: "strict-pool", proxyPoolId }
    )
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

    // Hide sensitive fields. connectionProxyUrl may embed `user:password@`;
    // only an operator (dashboard JWT or CLI token) reads it verbatim.
    const privileged = await isOperatorRequest(request);
    const result = sanitizeConnectionProxyUrl(sanitizeProviderConnection(connection), privileged);

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
      sessionToken,
      testStatus,
      lastError,
      lastErrorAt,
      providerSpecificData
    } = body;

    // Body validation runs before any connection lookup or DB write, faithful
    // to the source route: an out-of-range priority must 400 with the source's
    // "Invalid request" envelope regardless of whether the id exists, and must
    // leave the persisted connection untouched.
    let coercedPriority;
    if (priority !== undefined) {
      coercedPriority = coerceConnectionPriority(priority);
      if (coercedPriority === null) {
        return invalidRequest("priority");
      }
    }
    let coercedGlobalPriority;
    if (globalPriority !== undefined && globalPriority !== null) {
      coercedGlobalPriority = coerceConnectionPriority(globalPriority);
      if (coercedGlobalPriority === null) {
        return invalidRequest("globalPriority");
      }
    }

    const existing = await getProviderConnectionById(id);
    if (!existing) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const usesAwsCredentials = AI_PROVIDERS[existing.provider]?.credentialForm === "aws";
    if (usesAwsCredentials) {
      // Same gate as the create route: a stored profile is resolved by the AWS SDK as the server
      // user, so only an operator may point a connection at one.
      const awsProfile = checkBedrockProfileInput(providerSpecificData);
      if (awsProfile.error) {
        return NextResponse.json({ error: awsProfile.error }, { status: 400 });
      }
      if (awsProfile.profile && !(await isOperatorRequest(request))) {
        return NextResponse.json({ error: "AWS profile connections can only be set up from the dashboard or CLI" }, { status: 403 });
      }
    }

    const normalizedProviderSpecificData = normalizeOpenAIStoreSetting(existing.provider, providerSpecificData);
    const normalizedExistingProviderSpecificData = normalizeOpenAIStoreSetting(existing.provider, existing.providerSpecificData);

    // Reject a malformed limit at the trust boundary. The enforcement point
    // fails closed on an invalid value, so persisting one would silently break
    // the connection rather than protect it.
    if (existing.provider === "github" && providerSpecificData?.aiCreditLimit !== undefined &&
    !isValidGitHubCreditLimit(providerSpecificData.aiCreditLimit)) {
      return NextResponse.json(
        { error: "AI Credits limit must be a non-negative number, or null to disable." },
        { status: 400 }
      );
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
    if (priority !== undefined) updateData.priority = coercedPriority;
    if (globalPriority !== undefined) {
      updateData.globalPriority = globalPriority === null ? null : coercedGlobalPriority;
    }
    if (defaultModel !== undefined) updateData.defaultModel = defaultModel;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (apiKey && existing.authType === "apikey") updateData.apiKey = apiKey;
    // An empty string is meaningful here: it clears a token left over from temporary keys.
    if (usesAwsCredentials && isString(sessionToken)) updateData.sessionToken = sessionToken.trim();
    // A row written by 9router keeps the token in plaintext providerSpecificData, which the
    // normalization below drops. Lift it into the encrypted field first unless this edit sets one.
    else if (usesAwsCredentials && !existing.sessionToken && isString(existing.providerSpecificData?.sessionToken)) {
      updateData.sessionToken = existing.providerSpecificData.sessionToken.trim();
    }
    if (testStatus !== undefined) updateData.testStatus = testStatus;
    if (lastError !== undefined) updateData.lastError = lastError;
    if (lastErrorAt !== undefined) updateData.lastErrorAt = lastErrorAt;

    if (
    shouldMergeProviderSpecificData(
      normalizedExistingProviderSpecificData,
      normalizedProviderSpecificData,
      proxyConfig.hasAnyProxyField,
      proxyPoolResult.hasProxyPoolField
    ))
    {
      const merged = mergeProviderSpecificData(
        normalizedExistingProviderSpecificData,
        normalizedProviderSpecificData
      );
      updateData.providerSpecificData = normalizeProviderSpecificData(
        existing.provider,
        body,
        merged
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
          existing
        );
      }
    }

    if (requiresProviderAccountId(existing.provider)) {
      const merged = updateData.providerSpecificData || existing.providerSpecificData || {};
      try {
        updateData.providerSpecificData = {
          ...merged,
          accountId: normalizeAccountIdPlaceholder(existing.provider, merged.accountId)
        };
      } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    const updated = await updateProviderConnection(id, updateData);
    if (isActive === false) notifyQuotaAutoPingSettingChanged(existing.provider, id, false);

    // Hide sensitive fields. Without redacting here, an API-key caller could
    // PUT an unrelated field and read the stored proxy credential back.
    const updatePrivileged = await isOperatorRequest(request);
    const result = sanitizeConnectionProxyUrl(sanitizeProviderConnection(updated), updatePrivileged);

    return NextResponse.json({ connection: result });
  } catch (error) {
    console.log("Error updating connection:", error);
    return NextResponse.json({ error: "Failed to update connection" }, { status: 500 });
  }
}

// PATCH /api/providers/[id] - Update connection (partial)
// The OpenAPI spec and the CLI (`dnd providers rotate`, generated
// api-commands) both use PATCH, but only PUT was implemented — PATCH requests
// 405'd. PATCH and PUT share the same update semantics here (the schema only
// applies provided fields), so delegate to the PUT handler.
export async function PATCH(request, ctx) {
  return PUT(request, ctx);
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
    const status = error?.code === "API_KEY_SCOPE_WOULD_BROADEN" ? 409 : 500;
    return NextResponse.json({ error: status === 409 ? error.message : "Failed to delete connection" }, { status });
  }
}