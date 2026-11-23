import { getSettings } from "@/lib/localDb";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { applyOpenRouterRouting } from "open-sse/services/openrouterRouting.js";
import { errorResponse } from "open-sse/utils/error.js";
import { admit } from "../../services/admission.js";
import { enforceApiKeyModelPolicy } from "../../services/apiKeyPolicy.js";
import { getProviderCredentialsWithQuotaPreflight, markAccountUnavailable } from "../../services/auth.js";
import { getModelInfo } from "../../services/model.js";
import { imageModelKindError } from "../imageModelKind.js";
import { modelKindError } from "../modelKind.js";

/**
 * Admit a parsed image request before endpoint validation and route selection.
 * Each route checks its resolved model before selecting accounts. Pinning is
 * opt-in for endpoints that already honor x-connection-id.
 */
export async function runMediaEndpoint(request, { kind, pinConnection = false, route }) {
  const { error, ...admission } = await admit(request, { kind });
  if (error) return error;

  const connectionId = pinConnection ? request.headers.get("x-connection-id") : null;
  const pinOptions = connectionId ? { preferredConnectionId: connectionId, strictConnectionId: connectionId } : {};
  return route(admission, pinOptions);
}

export async function resolveMediaModel(request, modelStr, body, apiKey, { onPolicyError, checkLifecycle, kindCheck, routingKind } = {}) {
  const { provider, model } = await getModelInfo(modelStr);
  if (!provider) return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format") };

  if (provider === "openrouter") {
    try { applyOpenRouterRouting(body, (await getSettings()).openrouterRouting, routingKind || "image"); }
    catch (error) { return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, error.message) }; }
  }

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
 */
export async function runMediaAccounts({
  provider, model, selectionOptions, runAttempt, buildExhaustedResponse, selectCredentials,
  onAccountFailure, onFallback, buildFailureResponse = (result) => result.response,
}) {
  const excluded = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = selectCredentials
      ? await selectCredentials(excluded, model, selectionOptions)
      : await getProviderCredentialsWithQuotaPreflight(provider, excluded, model, selectionOptions);
    if (!credentials || credentials.allRateLimited || credentials.providerDisabled) {
      return buildExhaustedResponse(credentials, { lastError, lastStatus, attempted: excluded.size });
    }

    const { response, result, dispatch, resetAt = null, failureContext } = await runAttempt(credentials);
    if (!result) return response;

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
