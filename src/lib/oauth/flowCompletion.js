import { mergeProviderSpecificData } from "@/lib/db/helpers/mergeProviderMetadata.js";
import { exchangeTokens } from "@/lib/oauth/providers.js";
import {
  buildOAuthProxyMetadataPatch,
  resolveOAuthProxySelection,
} from "@/lib/oauth/proxySelection.js";
import { createProviderConnection } from "@/models";
import { isOAuthFlowClaimActive } from "@/lib/oauth/flowStore.js";

/** Merge durable OAuth routing without erasing provider-owned metadata. */
export function withOAuthProxyMetadata(providerSpecificData, proxySelection) {
  const metadataPatch = proxySelection?.metadataPatch ||
    buildOAuthProxyMetadataPatch(proxySelection);
  return mergeProviderSpecificData(providerSpecificData || {}, metadataPatch);
}

/** Re-resolve an immutable flow selection at the moment it is used. */
export function resolveFlowProxySelection(flowClaim) {
  return resolveOAuthProxySelection(
    flowClaim?.payload?.proxySelection || { mode: "legacy" },
  );
}

/** Persist tokens and their immutable OAuth egress policy as one connection. */
export async function saveOAuthConnection(
  provider,
  tokenData,
  resolvedProxy,
  extra = {},
  flowClaim = null,
) {
  const connectionData = {
    provider,
    authType: "oauth",
    ...tokenData,
    ...extra,
    providerSpecificData: withOAuthProxyMetadata(
      tokenData?.providerSpecificData,
      resolvedProxy,
    ),
    expiresAt: tokenData?.expiresIn
      ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
      : null,
    testStatus: "active",
  };
  return flowClaim
    ? createProviderConnection(connectionData, {
        shouldCommit: () => isOAuthFlowClaimActive(flowClaim),
      })
    : createProviderConnection(connectionData);
}

/**
 * Complete a server-bound authorization-code flow. Redirect URI, verifier,
 * provider metadata, and routing all come from the claimed server record.
 */
export async function exchangeAndSaveAuthorizationCode(provider, code, state, flowClaim) {
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
    );
  } catch (error) {
    if (typeof error?.code === "string" && error.code.startsWith("OAUTH_")) throw error;
    const upstreamError = new Error(
      error?.message || "OAuth provider request failed",
      { cause: error },
    );
    upstreamError.code = "OAUTH_UPSTREAM_FAILURE";
    throw upstreamError;
  }
  const connection = await saveOAuthConnection(
    provider,
    tokenData,
    resolvedProxy,
    {},
    flowClaim,
  );
  return { connection, resolvedProxy };
}
