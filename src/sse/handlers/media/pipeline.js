import { getSettings } from "@/lib/localDb";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { applyOpenRouterRouting } from "open-sse/services/openrouterRouting.js";
import { errorResponse } from "open-sse/utils/error.js";
import { admit } from "../../services/admission.js";
import { enforceApiKeyModelPolicy } from "../../services/apiKeyPolicy.js";
import { getProviderCredentialsWithQuotaPreflight, markAccountUnavailable } from "../../services/auth.js";
import { getModelInfo } from "../../services/model.js";
import { checkAndRefreshToken, updateProviderCredentials } from "../../services/tokenRefresh.js";
import { imageModelKindError } from "../imageModelKind.js";
import { modelKindError } from "../modelKind.js";

/** 499 for a caller that has already disconnected, otherwise null. */
export function abortedResponse(signal) {
  return signal?.aborted ? errorResponse(499, "Request aborted") : null;
}

/**
 * `true` binds the request to x-connection-id. "preferred" only prefers it.
 * "job" is the strict binding for job polls, which echo x-9router-connection-id.
 */
function connectionPin(request, mode) {
  if (!mode) return {};
  const connectionId = (mode === "job" && request.headers.get("x-9router-connection-id")) || request.headers.get("x-connection-id");
  if (!connectionId) return {};
  if (mode === "preferred") return { preferredConnectionId: connectionId };
  return { preferredConnectionId: connectionId, strictConnectionId: connectionId };
}

/**
 * Admit a media request before endpoint validation and route selection.
 * Each route checks its resolved model before selecting accounts. Pinning and
 * the disconnected-caller rejection are opt-in per endpoint.
 */
export async function runMediaEndpoint(request, { kind, pinConnection = false, rejectAborted = false, onAdmission, route }) {
  const admitted = await admit(request, { kind });
  onAdmission?.(admitted);
  const { error, ...admission } = admitted;
  if (error) return error;
  const aborted = rejectAborted ? abortedResponse(request.signal) : null;
  if (aborted) return aborted;

  return route(admission, connectionPin(request, pinConnection));
}

/** Refresh before dispatch; `persist` stores tokens a core rotates mid-request. */
export async function refreshMediaCredentials(provider, credentials) {
  const refreshed = await checkAndRefreshToken(provider, credentials);
  const persist = async (newCreds) => {
    await updateProviderCredentials(credentials.connectionId, {
      accessToken: newCreds.accessToken,
      refreshToken: newCreds.refreshToken,
      providerSpecificData: newCreds.providerSpecificData,
      testStatus: "active",
    });
  };
  return { refreshed, persist };
}

export async function resolveMediaModel(request, modelStr, body, apiKey, { onPolicyError, checkLifecycle, kindCheck, routingKind, beforePolicy, target } = {}) {
  // `target` is for routes that pick the provider and model themselves.
  const { provider, model } = target || await getModelInfo(modelStr);
  if (!provider) return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format") };

  // Only endpoints that select a routing kind apply their OpenRouter policy here.
  if (provider === "openrouter" && routingKind) {
    try { applyOpenRouterRouting(body, (await getSettings()).openrouterRouting, routingKind); }
    catch (error) { return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, error.message) }; }
  }

  const earlyError = await beforePolicy?.(provider, model);
  if (earlyError) return { error: earlyError };

  const policyError = await enforceApiKeyModelPolicy(request, `${provider}/${model}`, apiKey);
  if (policyError) return { error: onPolicyError ? onPolicyError(policyError) : policyError };
  const lifecycleError = checkLifecycle?.(provider, model);
  if (lifecycleError) return { error: lifecycleError };

  const settings = await getSettings();
  const error = kindCheck ? await kindCheck(provider, model, settings) : await imageModelKindError(provider, model, settings);
  return { provider, model, error };
}

export function resolveImageModel(request, modelStr, body, apiKey, options = {}) {
  return resolveMediaModel(request, modelStr, body, apiKey, { ...options, routingKind: "image" });
}

export async function resolveTypedMediaModel(request, modelStr, body, apiKey, kind, options = {}) {
  return resolveMediaModel(request, modelStr, body, apiKey, {
    ...options,
    kindCheck: (provider, model, settings) => modelKindError(provider, model, settings, kind),
  });
}

/**
 * A terminal attempt returns a response. Other attempts return the provider
 * result and the dispatched credential snapshot for account health tracking.
 * With `signal`, a disconnected caller stops the loop without cooling accounts.
 */
export async function runMediaAccounts({
  provider, model, selectionOptions, runAttempt, buildExhaustedResponse, selectCredentials,
  onAccountFailure, onAttemptResult, onFallback, buildFailureResponse = (result) => result.response, signal,
}) {
  const excluded = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const abortedBeforeAttempt = abortedResponse(signal);
    if (abortedBeforeAttempt) return abortedBeforeAttempt;
    const credentials = selectCredentials
      ? await selectCredentials(excluded, model, selectionOptions)
      : await getProviderCredentialsWithQuotaPreflight(provider, excluded, model, selectionOptions);
    if (!credentials || credentials.allRateLimited || credentials.providerDisabled) {
      return buildExhaustedResponse(credentials, { lastError, lastStatus, attempted: excluded.size });
    }

    const { response, result, dispatch, resetAt = null, failureContext } = await runAttempt(credentials);
    if (!result) return response;
    const abortedAttempt = abortedResponse(signal);
    if (abortedAttempt) return abortedAttempt;

    const terminalAttemptResponse = await onAttemptResult?.(result, credentials);
    if (terminalAttemptResponse) return terminalAttemptResponse;

    const failure = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, resetAt, {
      usedCredential: credentials.accessToken || credentials.apiKey || null,
      ...dispatch,
      ...failureContext,
    });
    const terminalResponse = await onAccountFailure?.(result, credentials);
    if (terminalResponse) return terminalResponse;
    if (!failure.shouldFallback) return buildFailureResponse(result);

    excluded.add(credentials.connectionId);
    lastError = result.error;
    lastStatus = result.status;
    onFallback?.(result, credentials, failure);
  }
}
