import { createErrorResult } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { getExecutor } from "../executors/index.js";

export async function handleVideoGenerationCore({ provider, model, body, credentials, signal }) {
  if (!body?.prompt) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");
  if (provider !== "veoaifree-web") {
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
    return { success: true, response: result.response };
  } catch (err) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, err?.message || "Video generation failed");
  }
}
