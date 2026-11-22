import { mergeProviderSpecificData } from "@/lib/db/helpers/mergeProviderMetadata.js";
import { exchangeTokens } from "@/lib/oauth/providers.js";
import { throwIfOAuthCancelled } from "@/lib/oauth/cancellation.js";
import {
  buildOAuthProxyMetadataPatch,
  resolveOAuthProxySelection } from
"@/lib/oauth/proxySelection.js";
import {
  createProviderConnection,
  getProviderConnectionById,
  updateProviderConnection } from
"@/models";
import { isOAuthFlowClaimActive } from "@/lib/oauth/flowStore.js";
import { isDurableCredentialProvider } from "open-sse/services/accountFallback.js";
import { resetM365RefreshCircuit } from "open-sse/services/tokenRefresh/copilotM365.js";

/** Merge durable OAuth routing without erasing provider-owned metadata. */
import { isObject, isString } from "../../shared/utils/typeChecks.js";
export function withOAuthProxyMetadata(providerSpecificData, proxySelection) {
  const metadataPatch = proxySelection?.metadataPatch ||
  buildOAuthProxyMetadataPatch(proxySelection);
  return mergeProviderSpecificData(providerSpecificData || {}, metadataPatch);
}

/** Re-resolve an immutable flow selection at the moment it is used. */
export function resolveFlowProxySelection(flowClaim) {
  return resolveOAuthProxySelection(
    flowClaim?.payload?.proxySelection || { mode: "legacy" }
  );
}

/**
 * Persist tokens and their immutable OAuth egress policy as one connection.
 *
 * When `extra.connectionId` is provided (the "Reconnect" flow), the tokens
 * replace an existing row IN PLACE instead of creating a duplicate. The target
 * is validated first: it must exist, be the same canonical provider, and be an
 * OAuth row. This clears any durable `reauth_required` state on success.
 */
export async function saveOAuthConnection(
provider,
tokenData,
resolvedProxy,
extra = {},
flowClaim = null)
{
  const { connectionId = null, ...extraFields } = extra || {};
  const providerSpecificData = withOAuthProxyMetadata(
    tokenData?.providerSpecificData,
    resolvedProxy
  );
  const expiresAt = tokenData?.expiresIn ?
  new Date(Date.now() + tokenData.expiresIn * 1000).toISOString() :
  null;
  // A rejected durable key is quarantined with isActive: false. The key from a
  // new sign-in must put the row back in rotation, whether it lands through a
  // reconnect or through the same-user dedup merge.
  const reactivate = isDurableCredentialProvider(provider) ? { isActive: true } : {};

  if (connectionId) {
    const existing = await getProviderConnectionById(connectionId);
    if (!existing) {
      const error = new Error("Reconnect target connection no longer exists");
      error.code = "OAUTH_RECONNECT_TARGET_MISSING";
      throw error;
    }
    if (existing.provider !== provider || existing.authType !== "oauth") {
      const error = new Error("Reconnect target is not the same OAuth provider connection");
      error.code = "OAUTH_RECONNECT_TARGET_MISMATCH";
      throw error;
    }
    // Never let a Microsoft sign-in for another tenant/object replace this account's tokens, even
    // when both accounts share an email address.
    if (provider === "copilot-m365-web" && (
    !isString(providerSpecificData?.chathubPath) ||
    providerSpecificData.chathubPath !== existing.providerSpecificData?.chathubPath)) {
      const error = new Error("Reconnect target is a different Microsoft account");
      error.code = "OAUTH_RECONNECT_TARGET_MISMATCH";
      throw error;
    }
    // Replace credentials + routing metadata and clear the reauth state. The
    // token fields here are explicit non-empty replacements, so the repo merge
    // overwrites the dead tokens rather than preserving them.
    const updateData = {
      ...tokenData,
      ...extraFields,
      providerSpecificData,
      expiresAt,
      ...reactivate,
      testStatus: "active",
      lastError: null,
      errorCode: null,
      lastErrorAt: null
    };
    const commit = flowClaim ?
    await updateProviderConnection(connectionId, updateData, {
      shouldCommit: () => isOAuthFlowClaimActive(flowClaim),
      returnCommitResult: true
    }) :
    await updateProviderConnection(connectionId, updateData, { returnCommitResult: true });
    if (commit === null) {
      const error = new Error("Reconnect target connection no longer exists");
      error.code = "OAUTH_RECONNECT_TARGET_MISSING";
      throw error;
    }
    const connection = commit && isObject(commit) && Object.hasOwn(commit, "connection") ?
      commit.connection :
      commit;
    if (provider === "copilot-m365-web") resetM365RefreshCircuit(connectionId);
    return connection;
  }

  const connectionData = {
    provider,
    authType: "oauth",
    ...tokenData,
    ...extraFields,
    providerSpecificData,
    expiresAt,
    ...reactivate,
    testStatus: "active"
  };
  const connection = flowClaim ?
  await createProviderConnection(connectionData, {
    shouldCommit: () => isOAuthFlowClaimActive(flowClaim)
  }) :
  await createProviderConnection(connectionData);
  if (provider === "copilot-m365-web" && typeof connection?.id === "string") resetM365RefreshCircuit(connection.id);
  return connection;
}

/**
 * Complete a server-bound authorization-code flow. Redirect URI, verifier,
 * provider metadata, and routing all come from the claimed server record.
 * An optional `signal` cancels the exchange; a cancelled flow rejects with
 * `OAUTH_CANCELLED` and nothing is saved.
 */
export async function exchangeAndSaveAuthorizationCode(provider, code, state, flowClaim, signal = null) {
  const resolvedProxy = await resolveFlowProxySelection(flowClaim);
  const payload = flowClaim?.payload || {};
  let tokenData;
  try {
    tokenData = await exchangeTokens(
      provider,
      code,
      payload.redirectUri,
      payload.codeVerifier,
      state,
      payload.meta,
      resolvedProxy.proxyOptions,
      // Only sent when the caller can cancel, so existing call shapes stay as they were.
      ...(signal ? [signal] : [])
    );
  } catch (error) {
    if (isString(error?.code) && error.code.startsWith("OAUTH_")) throw error;
    const upstreamError = new Error(
      error?.message || "OAuth provider request failed",
      { cause: error }
    );
    upstreamError.code = "OAUTH_UPSTREAM_FAILURE";
    throw upstreamError;
  }
  if (provider === "codex" && payload.codexFingerprintMode) {
    tokenData.providerSpecificData = {
      ...tokenData.providerSpecificData,
      codexFingerprintMode: payload.codexFingerprintMode
    };
  }
  // A cancelled sign-in saves nothing, even when the exchange finished first.
  throwIfOAuthCancelled(signal);
  const connection = await saveOAuthConnection(
    provider,
    tokenData,
    resolvedProxy,
    // The Reconnect flow stamps the target connection id into the claimed flow
    // payload; a normal Add flow leaves it absent and creates a fresh row.
    payload.connectionId ? { connectionId: payload.connectionId } : {},
    flowClaim
  );
  return { connection, resolvedProxy };
}
