import { getProviderCredentials, extractApiKey, evaluateApiKeyAuth } from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { handleVideoGenerationCore } from "open-sse/handlers/videoGenerationCore.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { enforceApiKeyModelPolicy, recordApiKeyUsageForResponse } from "../services/apiKeyPolicy.js";

export async function handleVideoGeneration(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const settings = await getSettings();
  const apiKey = extractApiKey(request);
  const apiKeyAuth = await evaluateApiKeyAuth(apiKey, { required: settings.requireApiKey === true });
  if (!apiKeyAuth.ok) return errorResponse(
    HTTP_STATUS.UNAUTHORIZED,
    apiKeyAuth.reason === "missing" ? "Missing API key" : "Invalid API key",
  );

  if (!body.model) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  const modelInfo = await getModelInfo(body.model);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  const policyError = await enforceApiKeyModelPolicy(request, `${modelInfo.provider}/${modelInfo.model}`);
  if (policyError) return policyError;
  const credentials = await getProviderCredentials(modelInfo.provider, null, modelInfo.model);
  if (!credentials) return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${modelInfo.provider}`);

  const result = await handleVideoGenerationCore({ provider: modelInfo.provider, model: modelInfo.model, body, credentials, signal: request.signal });
  if (!result.success) return result.response;
  return recordApiKeyUsageForResponse(apiKey, result.response, {
    tokens: String(body.prompt || "").length / 4,
    cost: 0,
  });
}
