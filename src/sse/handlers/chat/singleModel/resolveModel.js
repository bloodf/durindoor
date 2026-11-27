import { getModelInfo } from "../../../services/model.js";
import { isChatProvider, isNativeOnlyModel } from "open-sse/providers/chatCapability.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { errorResponse } from "open-sse/utils/error.js";
import { LOCAL_REQUEST_ERROR } from "open-sse/services/combo.js";
import * as log from "../../../utils/logger.js";
import { requestAborted } from "../shared.js";
import { terminal, proceed } from "./context.js";

/**
 * Local HTTP 404 `model_not_found` for an unresolvable bare model on chat,
 * messages, and responses inference routes (OmniRoute #21349 / KEA-9627).
 * Marked `LOCAL_REQUEST_ERROR` so combo fallback advances without cooling
 * accounts or penalizing health scores.
 */
export function unknownBareModelResponse(modelStr, message = null) {
  const text = message || `Model '${modelStr}' could not be resolved to a known provider.`;
  log.warn("CHAT", text, { model: modelStr });
  const response = errorResponse(HTTP_STATUS.NOT_FOUND, text);
  response[LOCAL_REQUEST_ERROR] = true;
  return response;
}

/**
 * #6457 / OmniRoute#6525: resolved registry model kind === "image" means the
 * model is image-only and belongs on /v1/images/generations, not the chat
 * endpoint. Forwarding it to a chat upstream yields a confusing raw provider
 * 400 (e.g. HuggingFace: "not a chat model"). Per-model kind is used (not the
 * provider-level serviceKinds) because mixed providers like Cloudflare serve
 * both chat and image models.
 */
export function isImageOnlyModel(provider, model) {
  const entry = REGISTRY.find(
    (e) => e.id === provider || e.alias === provider || e.aliases?.includes(provider)
  );
  const m = entry?.models?.find((x) => x.id === model);
  return (m?.kind ?? m?.type) === "image";
}

/**
 * A model that can never answer a chat request: a System One decision model,
 * or any model of a provider with no chat transport and no `llm` service kind
 * (see open-sse/providers/chatCapability.js).
 */
export function isNonChatModel(provider, model) {
  return isNativeOnlyModel(provider, model) || !isChatProvider(provider);
}

/**
 * Stage 1: resolve the requested model string to a provider/model pair.
 * A string that names no provider is a nested combo, handed back to the caller
 * through ctx.dispatchNestedCombo. Unresolvable bare models on inference routes
 * return HTTP 404 `model_not_found` before credential lookup or upstream
 * dispatch (OmniRoute #21349 / KEA-9627). Ambiguous, malformed, image-only,
 * and non-chat models keep their HTTP 400 rejections.
 */
export async function resolveModel(ctx) {
  const { request, requestSignal, modelStr } = ctx;
  if (requestAborted(request, requestSignal)) return terminal(errorResponse(499, "Request aborted"));
  const resolveInfo = ctx.resolveModelInfo || getModelInfo;
  const modelInfo = await resolveInfo(modelStr);

  if (modelInfo?.errorType === "ambiguous_model") {
    const message = modelInfo.errorMessage || `Model '${modelStr}' is ambiguous. Use provider/model prefix.`;
    log.warn("CHAT", message, { model: modelStr });
    return terminal(errorResponse(HTTP_STATUS.BAD_REQUEST, message));
  }

  if (modelInfo?.errorType === "model_not_found") {
    return terminal(unknownBareModelResponse(modelStr, modelInfo.errorMessage));
  }

  if (!modelInfo?.provider) {
    return terminal(await ctx.dispatchNestedCombo({
      body: ctx.body,
      modelStr,
      clientRawRequest: ctx.clientRawRequest,
      request,
      apiKey: ctx.apiKey,
      tokenSaverCollector: ctx.tokenSaverCollector,
      requestSignal,
      comboRouting: ctx.comboRouting,
      comboPrompts: ctx.comboPrompts,
      comboVisited: ctx.comboVisited,
      planRequest: ctx.planRequest,
      apiKeyName: ctx.apiKeyName,
      apiKeyId: ctx.apiKeyId,
      billingEpoch: ctx.billingEpoch,
      reportComboPolicyRejections: ctx.reportComboPolicyRejections
    }));
  }

  const { provider, model } = modelInfo;
  if (!model) {
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return terminal(errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format"));
  }

  ctx.modelInfo = modelInfo;
  ctx.provider = provider;
  ctx.model = model;
  ctx.privatePlan = provider === "chatgpt-plan";

  // Reject image-only models routed to /v1/chat/completions (#6457 / #6525).
  // getModelInfo already resolved the registry {provider, model}; a kind:"image"
  // entry belongs on /v1/images/generations. Guard fires before credentials /
  // dispatch so the upstream is never called.
  if (isImageOnlyModel(provider, model)) {
    log.warn("CHAT", `Rejecting image-generation model on chat endpoint: ${provider}/${model}`);
    return terminal(errorResponse(
      HTTP_STATUS.BAD_REQUEST,
      `Model '${provider}/${model}' is an image-generation model and cannot be used on /v1/chat/completions. Use POST /v1/images/generations instead.`
    ));
  }

  if (isNonChatModel(provider, model)) {
    log.warn("CHAT", `Rejecting non-chat model on chat endpoint: ${provider}/${model}`);
    return terminal(errorResponse(
      HTTP_STATUS.BAD_REQUEST,
      `Model '${provider}/${model}' is not a chat model and cannot be used on the chat endpoints.`
    ));
  }
  return proceed();
}
