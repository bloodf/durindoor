// Antigravity image adapter - delegates to the executor for correct request
// envelope (project, model, requestType, sessionId) and auth headers.
import { nowSec, resolveImageInput } from "./_base.js";
import { getExecutor } from "../../executors/index.js";

function parseQuotaResetMs(text) {
  try {
    for (const detail of JSON.parse(text)?.error?.details || []) {
      const ms = new Date(detail?.metadata?.quotaResetTimeStamp).getTime();
      if (ms > Date.now()) return ms;
    }
  } catch {
    // Non-JSON error bodies carry no reset time.
  }
  return undefined;
}

export default {
  // Delegate to executor instead of building URL/headers/body manually
  useExecutor: true,

  // Stubs - required by imageGenerationCore interface but unused with useExecutor
  buildUrl: () => "",
  buildHeaders: () => ({}),
  buildBody: () => ({}),

  async executeViaExecutor(model, body, credentials, log, proxyOptions = null, signal = undefined) {
    const executor = getExecutor("antigravity");
    if (!executor) throw new Error("Antigravity executor not found");

    // Build parts: text prompt + optional input image for editing
    const parts = [{ text: body.prompt }];
    const imageInput = body.image || (Array.isArray(body.images) && body.images[0]);
    if (imageInput) {
      const inlineData = resolveImageInput(imageInput);
      if (inlineData) parts.unshift(inlineData);
    }

    const chatBody = {
      contents: [{ role: "user", parts }]
    };

    const result = await executor.execute({
      model,
      body: chatBody,
      stream: false,
      credentials,
      log,
      proxyOptions,
      signal
    });

    if (!result.response.ok) {
      const text = await result.response.text();
      const error = new Error(text || `HTTP ${result.response.status}`);
      // Keep the upstream status and quota reset so image accounts get the real
      // cooldown instead of a flat 502 (upstream 9router 161e3493).
      error.status = result.response.status;
      error.resetsAtMs = parseQuotaResetMs(text);
      throw error;
    }

    return result.response.json();
  },

  normalize: (responseBody, prompt) => {
    const candidates = responseBody.candidates || responseBody.response?.candidates || [];
    const parts = candidates[0]?.content?.parts || [];
    const images = parts.filter((p) => p.inlineData?.data).map((p) => ({
      b64_json: p.inlineData.data
    }));
    return {
      created: nowSec(),
      data: images.length > 0 ? images : [{ b64_json: "", revised_prompt: prompt }]
    };
  }
};