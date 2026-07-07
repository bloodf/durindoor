import { getProviderCredentials, extractApiKey, isValidApiKey } from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { handleVideoGenerationCore } from "open-sse/handlers/videoGenerationCore.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

export async function handleVideoGeneration(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const settings = await getSettings();
  const apiKey = extractApiKey(request);
  if (settings.requireApiKey) {
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    if (!(await isValidApiKey(apiKey))) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  if (!body.model) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  const modelInfo = await getModelInfo(body.model);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  const credentials = await getProviderCredentials(modelInfo.provider, null, modelInfo.model);
  if (!credentials) return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${modelInfo.provider}`);

  const result = await handleVideoGenerationCore({ provider: modelInfo.provider, model: modelInfo.model, body, credentials, signal: request.signal });
  return result.success ? result.response : result.response;
}
