import { createErrorResult } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { getExecutor } from "../executors/index.js";
import { mediaAccounting } from "./mediaAccounting.js";
import { isNumber, isString } from "../../src/shared/utils/typeChecks.js";

/** Providers /v1/video/generations can run (async job APIs use /v1/videos). */
export const supportsVideoGeneration = (provider) => provider === "veoaifree-web";

/** Return receipt accounting separately; never bill requested duration or prompt length. */
export async function handleVideoGenerationCore({ provider, model, body, credentials, signal }) {
  if (!body?.prompt) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");
  if (!supportsVideoGeneration(provider)) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Provider '${provider}' does not support video generation`);
  }
  try {
    const proxyOptions = {
      connectionProxyEnabled: credentials?.providerSpecificData?.connectionProxyEnabled === true,
      connectionProxyUrl: credentials?.providerSpecificData?.connectionProxyUrl || "",
      connectionNoProxy: credentials?.providerSpecificData?.connectionNoProxy || "",
      vercelRelayUrl: credentials?.providerSpecificData?.vercelRelayUrl || "",
    };
    const result = await getExecutor(provider).execute({
      model,
      body,
      stream: false,
      credentials: credentials || { apiKey: "public" },
      signal,
      proxyOptions,
    });
    if (!result.response.ok) {
      let message = `Video generation failed (${result.response.status})`;
      try {
        const json = await result.response.clone().json();
        message = json?.error?.message || message;
      } catch {}
      return createErrorResult(result.response.status, message);
    }
    // Read the executor receipt before any response normalization. Keep the
    // original response untouched, including successful opaque payloads.
    let value;
    try { value = await result.response.clone().json(); } catch { /* No reported usage. */ }
    const accounting = mediaAccounting(value, provider, "video");
    const seconds = value?.video?.duration ?? value?.duration ?? value?.seconds;
    const numeric = isString(seconds) && /^\d+(?:\.\d+)?$/.test(seconds) ? Number(seconds) : seconds;
    if (isNumber(numeric) && Number.isFinite(numeric) && numeric >= 0) {
      accounting.nativeUnits.videoSeconds = numeric;
      accounting.meta.nativeUnitsSource = "response-duration";
    }
    return { success: true, response: result.response, accounting };
  } catch (err) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, err?.message || "Video generation failed");
  }
}
