import { FIREFLY_WEB, deleteFireflyConnection, saveFireflyConnection } from "@/lib/fireflyWebUiConnection.js";
import { cerebriumBaseUrl } from "open-sse/config/cerebrium.js";
import { globalCircuitManager } from "@/lib/routing/connectionCircuitState.js";
import { resolveOpenCodeServer } from "open-sse/services/opencodeServer.js";
import { NextResponse } from "next/server";
import { isValidGitHubCreditLimit } from "open-sse/services/githubCreditLimit.js";
import {
  getProviderConnectionById,
  getProviderNodeById,
  getProxyPoolById,
  updateProviderConnection,
  deleteProviderConnection } from
"@/lib/localDb";
import { requiresProviderAccountId } from "@/lib/providerAccountIds";
import { mergeProviderSpecificData } from "@/lib/db/helpers/mergeProviderMetadata.js";
import { buildOAuthProxyMetadataPatch } from "@/lib/oauth/proxySelection.js";
import { normalizeAccountIdPlaceholder } from "open-sse/executors/default.js";
import { notifyQuotaAutoPingSettingChanged } from "@/shared/services/quotaAutoPing";
import { missingAzureEndpointError, normalizeProviderSpecificData } from "@/lib/providerNormalization";
import { isObject, isString } from "../../../../shared/utils/typeChecks.js";
import { canManageAccessConfig, isOperatorRequest } from "@/dashboardGuard";
import { omitMaskedProviderSecrets, pickSafeProviderSpecificData, stripConnectionSecrets } from "@/lib/providerRouteHandlers.js";
import { sanitizeConnectionProxyUrl } from "@/shared/utils/proxyUrlRedaction.js";
import { AI_PROVIDERS, isSystemoneCompatibleProvider, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider } from "@/shared/constants/providers";
import { checkBedrockProfileInput } from "open-sse/shared/awsCredentials.js";
import { adobeFireflyCredentialFields } from "open-sse/services/adobeFireflyApi/auth.js";
import {
  compatibleNodeConflictMessage,
  resolveCompatibleNodeIdentity
} from "@/lib/providers/compatibleNodeIdentity";
import {
  encryptedEnvelopeCredentialMessage,
  looksLikeEncryptedEnvelope
} from "@/shared/utils/credentialEnvelope";

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
  const result = stripConnectionSecrets(connection);
  if (connection.providerSpecificData) {
    result.providerSpecificData = pickSafeProviderSpecificData(
      connection.provider,
      normalizeOpenAIStoreSetting(connection.provider, connection.providerSpecificData)
    );
  }
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

// Connection fields that choose where a stored credential is sent: base and
// endpoint URLs, relays, and proxy settings. Changing them needs an operator.
const ROUTING_FIELD = /(url|endpoint)$|proxy|relay/i;
const TOP_LEVEL_ROUTING_FIELDS = ["connectionProxyEnabled", "connectionProxyUrl", "connectionNoProxy", "proxyPoolId"];

function routingValue(key, value) {
  if (key === "proxyPoolId" && (value === "" || value === "__none__")) return null;
  if (isString(value)) return value.trim();
  return value ?? null;
}

function changesUpstreamRouting(body, existing) {
  const stored = existing.providerSpecificData || {};
  const differs = (key, value) =>
    JSON.stringify(routingValue(key, value)) !== JSON.stringify(routingValue(key, stored[key]));
  if (TOP_LEVEL_ROUTING_FIELDS.some((key) => Object.hasOwn(body, key) && differs(key, body[key]))) return true;
  const incoming = isObject(body.providerSpecificData) ? body.providerSpecificData : {};
  return Object.keys(incoming).some((key) => ROUTING_FIELD.test(key) && differs(key, incoming[key]));
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

/**
 * Look up the provider node a connection belongs to.
 *
 * The lookup is best-effort: a connection whose node cannot be resolved has
 * nothing to compare against, so the identity check is skipped rather than
 * failing the edit.
 *
 * @param {string} provider
 * @returns {Promise<object|null>}
 */
async function lookupProviderNode(provider) {
  try {
    return (await getProviderNodeById(provider)) || null;
  } catch {
    return null;
  }
}

/**
 * Reject a connection edit that contradicts the provider node the connection
 * belongs to. Returns an error message, or null when the edit is compatible.
 *
 * Only the fields a node owns are checked, and only when the incoming payload
 * actually carries them: an edit that leaves the node's endpoint alone is
 * always accepted.
 *
 * @param {object} existing - the stored connection
 * @param {unknown} incomingProviderSpecificData - the request's providerSpecificData
 * @returns {Promise<string|null>}
 */
async function compatibleNodeIdentityConflict(existing, incomingProviderSpecificData) {
  const provider = existing?.provider;
  if (!provider) return null;
  if (!isOpenAICompatibleProvider(provider) &&
    !isAnthropicCompatibleProvider(provider) &&
    !isCustomEmbeddingProvider(provider)) return null;

  const node = await lookupProviderNode(provider);
  // A missing node is reported by the create/update flow itself; there is
  // nothing to compare against here.
  if (!node) return null;

  const identity = resolveCompatibleNodeIdentity(
    node,
    isObject(incomingProviderSpecificData) ? incomingProviderSpecificData : null,
    isOpenAICompatibleProvider(provider),
  );
  return identity.conflict ? compatibleNodeConflictMessage(identity.conflict) : null;
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

const filled = (value) => value != null && value !== "";

/**
 * Adobe Firefly Services credential replacement. A new client secret or a new
 * supplied access token replaces the stored credential and clears the other
 * mode's fields, so a stale secret can never shadow a supplied token (or the
 * reverse). A client ID or expiry change alone re-checks the stored credential
 * in its current mode. Only what the caller supplied is stored; nothing is
 * minted and Adobe is never called.
 *
 * @returns {{ fields?: object, error?: string }} fields to merge into the update
 */
function adobeFireflyCredentialUpdate(existing, body, updateData) {
  const incomingClientId = isObject(body.providerSpecificData) && Object.hasOwn(body.providerSpecificData, "clientId") ?
  body.providerSpecificData.clientId :
  undefined;
  const storedMode = filled(existing.apiKey) ? "client_secret" : "access_token";
  const replaces = filled(body.apiKey) || filled(body.accessToken);
  const touches = replaces || body.credentialMode !== undefined || Object.hasOwn(body, "expiresAt") ||
  incomingClientId !== undefined && incomingClientId !== existing.providerSpecificData?.clientId;
  if (!touches) return { fields: {} };
  if (looksLikeEncryptedEnvelope(body.accessToken)) return { error: encryptedEnvelopeCredentialMessage() };
  if (!replaces && body.credentialMode !== undefined && body.credentialMode !== storedMode) {
    return { error: "Supply the credential for the new Adobe Firefly Services mode" };
  }
  const clientId = (updateData.providerSpecificData || existing.providerSpecificData || {}).clientId;
  const supplied = replaces ?
  { credentialMode: body.credentialMode, apiKey: body.apiKey, accessToken: body.accessToken, expiresAt: body.expiresAt } :
  storedMode === "client_secret" ?
  { credentialMode: storedMode, apiKey: existing.apiKey, expiresAt: body.expiresAt } :
  { credentialMode: storedMode, accessToken: existing.accessToken, expiresAt: Object.hasOwn(body, "expiresAt") ? body.expiresAt : existing.expiresAt };
  try {
    const { apiKey, accessToken, expiresAt } = adobeFireflyCredentialFields({ ...supplied, clientId });
    return { fields: { apiKey: apiKey || "", accessToken, expiresAt } };
  } catch (error) {
    return { error: error.message };
  }
}

// PUT /api/providers/[id] - Update connection
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    if (body.providerSpecificData && ["chatgptPlanAccount", "chatgptPlanBindingRevision"].some((key) => Object.hasOwn(body.providerSpecificData, key))) return invalidRequest("providerSpecificData.chatgptPlanAccount");
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
      providerSpecificData,
      rateLimitedUntil
    } = body;

    // "Clear cooldown" is the only supported use of this field here: the
    // persisted 429 bench is DurinDoor's own lesson, not upstream truth, and
    // the dashboard offers a manual way to drop a bench that's gone stale
    // (quota already refreshed upstream). Only accept an explicit `null` —
    // letting a caller PUT an arbitrary future value would turn this into an
    // unaudited way to bench someone else's connection.
    if (rateLimitedUntil !== undefined && rateLimitedUntil !== null) {
      return NextResponse.json(
        { error: "rateLimitedUntil can only be cleared (set to null)" },
        { status: 400 }
      );
    }

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

    if (existing.provider === FIREFLY_WEB) return saveFireflyConnection(request, body, existing);

    if (existing.provider === "devin-cli-agentic" && apiKey) {
      return NextResponse.json({ error: "Sign in to Devin CLI outside DurinDoor" }, { status: 400 });
    }

    // A compatible node owns its identity. A connection whose stored endpoint
    // disagrees with its node would send the stored API key to a different
    // host than the operator configured, so the node's endpoint always wins
    // and a conflicting value is rejected (OmniRoute #15987).
    const nodeIdentityConflict = await compatibleNodeIdentityConflict(existing, providerSpecificData);
    if (nodeIdentityConflict) {
      return NextResponse.json({ error: nodeIdentityConflict }, { status: 400 });
    }

    // A credential that is already an encrypted envelope would be stored as a
    // ciphertext of a ciphertext and could never decrypt back to a usable key
    // (OmniRoute #15932).
    if (looksLikeEncryptedEnvelope(apiKey)) {
      return NextResponse.json({ error: encryptedEnvelopeCredentialMessage() }, { status: 400 });
    }

    if (changesUpstreamRouting(body, existing) && !(await canManageAccessConfig(request))) {
      return NextResponse.json({ error: "Changing a connection's URL or proxy settings requires an operator session" }, { status: 403 });
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

    const normalizedProviderSpecificData = normalizeOpenAIStoreSetting(existing.provider, omitMaskedProviderSecrets(providerSpecificData));
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

    if (existing.provider === "cerebrium" && providerSpecificData && Object.hasOwn(providerSpecificData, "baseUrl")) {
      const next = cerebriumBaseUrl(providerSpecificData.baseUrl);
      if (!next) return NextResponse.json({ error: "Invalid Cerebrium deployment /run URL" }, { status: 400 });
      if (next !== cerebriumBaseUrl(existing.providerSpecificData?.baseUrl)) {
        if (!(await isOperatorRequest(request))) return NextResponse.json({ error: "Changing a Cerebrium deployment requires an operator" }, { status: 403 });
        if (!isString(apiKey) || !apiKey.trim()) return NextResponse.json({ error: "Supply the project API key when changing deployment" }, { status: 400 });
      }
    }
    const updateData = {};
    // A manual schedule does not change the user's isActive setting.
    if (body.quotaLockout !== undefined) {
      if (!(await isOperatorRequest(request))) return NextResponse.json({ error: "Quota scheduling requires an operator" }, { status: 403 });
      const input = body.quotaLockout;
      if (input === null) updateData.quotaLockout = null;
      else {
        if (!isObject(input) || !Object.hasOwn(input, "reactivateAt") || (input.reactivateAt !== null && (!isString(input.reactivateAt) || !Number.isFinite(Date.parse(input.reactivateAt)) || Date.parse(input.reactivateAt) <= Date.now()))) return invalidRequest("quotaLockout.reactivateAt");
        updateData.quotaLockout = { status: "quota_exhausted", source: "manual", message: "Manually scheduled", detectedAt: new Date().toISOString(), reactivateAt: input.reactivateAt === null ? null : new Date(input.reactivateAt).toISOString() };
      }
    }

    if (existing.provider === "xai" && isString(body.managementApiKey)) updateData.managementApiKey = body.managementApiKey.trim();
    if (name !== undefined) updateData.name = name;
    if (priority !== undefined) updateData.priority = coercedPriority;
    if (globalPriority !== undefined) {
      updateData.globalPriority = globalPriority === null ? null : coercedGlobalPriority;
    }
    if (defaultModel !== undefined) updateData.defaultModel = defaultModel;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (apiKey && (existing.authType === "apikey" || existing.authType === "auth_token")) updateData.apiKey = apiKey;
    // Re-importing a web session is how an expired cookie is recovered (#2034): the
    // Edit dialog sends the fresh cookie in `apiKey`, and the connection keeps its
    // identity. Failure state recorded against the old cookie (model cooldowns, 401
    // backoff) is not evidence about the new one, so it is cleared with the swap. The
    // status and error text reset to unknown unless the caller set those fields itself.
    if (isString(apiKey) && apiKey.trim() && existing.authType === "cookie" && apiKey !== existing.apiKey) {
      updateData.apiKey = apiKey;
      if (testStatus === undefined) updateData.testStatus = "unknown";
      if (lastError === undefined) updateData.lastError = null;
      if (lastErrorAt === undefined) updateData.lastErrorAt = null;
      updateData.rateLimitedUntil = null;
      updateData.backoffLevel = 0;
      updateData.errorCode = null;
      for (const field of Object.keys(existing)) {
        if (field.startsWith("modelLock_")) updateData[field] = null;
      }
    }
    // An empty string is meaningful here: it clears a token left over from temporary keys.
    if (usesAwsCredentials && isString(sessionToken)) updateData.sessionToken = sessionToken.trim();
    if (testStatus !== undefined) updateData.testStatus = testStatus;
    if (lastError !== undefined) updateData.lastError = lastError;
    if (lastErrorAt !== undefined) updateData.lastErrorAt = lastErrorAt;
    if (rateLimitedUntil === null) {
      updateData.rateLimitedUntil = null;
      updateData.backoffLevel = 0;
    }

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

    // Validate endpoint edits against the merged data; legacy untouched records remain editable.
    const azureField = existing.provider === "azure" ? "azureEndpoint" : existing.provider === "azure-openai" ? "baseUrl" : null;
    if (azureField && Object.hasOwn(providerSpecificData || {}, azureField) &&
        providerSpecificData[azureField] !== existing.providerSpecificData?.[azureField]) {
      const error = missingAzureEndpointError(existing.provider, updateData.providerSpecificData);
      if (error) return NextResponse.json({ error }, { status: 400 });
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

    if (isSystemoneCompatibleProvider(existing.provider)) {
      const node = await getProviderNodeById(existing.provider);
      if (!node || node.type !== "systemone-compatible") {
        return NextResponse.json({ error: "System One compatible node not found" }, { status: 404 });
      }
      updateData.providerSpecificData = {
        ...(updateData.providerSpecificData || existing.providerSpecificData || {}),
        baseUrl: node.baseUrl,
        prefix: node.prefix,
        nodeName: node.name
      };
    }
    // Compatible nodes own their identity on every write, not only on create:
    // the stored endpoint must stay the node's endpoint even when the edit
    // leaves providerSpecificData untouched (OmniRoute #15987).
    if (
      isOpenAICompatibleProvider(existing.provider) ||
      isAnthropicCompatibleProvider(existing.provider) ||
      isCustomEmbeddingProvider(existing.provider))
    {
      const node = await lookupProviderNode(existing.provider);
      if (node) {
        const identity = resolveCompatibleNodeIdentity(
          node,
          updateData.providerSpecificData || existing.providerSpecificData || {},
          isOpenAICompatibleProvider(existing.provider),
        );
        updateData.providerSpecificData = identity.data;
      }
    }
    if (existing.provider === "laya" || isSystemoneCompatibleProvider(existing.provider)) {
      const metadata = updateData.providerSpecificData || existing.providerSpecificData || {};
      if (metadata.proxyPoolId || metadata.connectionProxyEnabled || metadata.vercelRelayUrl || metadata.oauthProxy?.mode === "strict-pool") {
        return NextResponse.json({ error: "Outbound proxies are not supported for guarded System One server URLs" }, { status: 400 });
      }
    }

    if (existing.provider === "opencode-server") {
      const metadata = updateData.providerSpecificData || existing.providerSpecificData || {};
      if (metadata.proxyPoolId || metadata.connectionProxyEnabled || metadata.vercelRelayUrl || metadata.oauthProxy?.mode === "strict-pool") {
        return NextResponse.json({ error: "OpenCode Server requires a direct connection" }, { status: 400 });
      }
    }
    if (existing.provider === "opencode-server" &&
        (apiKey !== undefined || Object.hasOwn(providerSpecificData || {}, "baseUrl"))) {
      if (!(await isOperatorRequest(request))) {
        return NextResponse.json({ error: "OpenCode Server connections require an operator" }, { status: 403 });
      }
      const endpoint = resolveOpenCodeServer({
        apiKey: updateData.apiKey ?? existing.apiKey,
        providerSpecificData: updateData.providerSpecificData || existing.providerSpecificData,
      });
      if (endpoint.error) return NextResponse.json({ error: endpoint.error }, { status: endpoint.status });
      if (updateData.providerSpecificData) updateData.providerSpecificData.baseUrl = endpoint.baseUrl;
    }

    if (existing.provider === "adobe-firefly-api") {
      const adobe = adobeFireflyCredentialUpdate(existing, body, updateData);
      if (adobe.error) return NextResponse.json({ error: adobe.error }, { status: 400 });
      Object.assign(updateData, adobe.fields);
    }

    const updated = await updateProviderConnection(id, updateData);
    // Activation clears persisted model locks; invalidate any in-flight probe
    // only after that update succeeds. Quota and reauthentication remain separate.
    if (updated && testStatus === "active") globalCircuitManager.reset(id);
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

    if (existing?.provider === FIREFLY_WEB) {
      // Close and await this connection's own setup browser before the row
      // (its ownership record) disappears; refuse the delete otherwise.
      const refused = await deleteFireflyConnection(request, id, () => deleteProviderConnection(id));
      if (refused) return refused;
    } else {
      const deleted = await deleteProviderConnection(id);
      if (!deleted) {
        return NextResponse.json({ error: "Connection not found" }, { status: 404 });
      }
    }

    if (existing) notifyQuotaAutoPingSettingChanged(existing.provider, id, false);

    return NextResponse.json({ message: "Connection deleted successfully" });
  } catch (error) {
    console.log("Error deleting connection:", error);
    const status = error?.code === "API_KEY_SCOPE_WOULD_BROADEN" ? 409 : 500;
    return NextResponse.json({ error: status === 409 ? error.message : "Failed to delete connection" }, { status });
  }
}
