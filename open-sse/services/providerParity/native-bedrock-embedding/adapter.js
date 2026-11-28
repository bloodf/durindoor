// OmniRoute native InvokeModel port; attribution and supported subset in registration.json.
import { isNumber, isRecord } from "../../../../src/shared/utils/typeChecks.js";
import { createErrorResult, readBoundedResponseText } from "../../../utils/error.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { bedrockUrl, BEDROCK_EMBEDDING_MODELS } from "./config.js";
import { buildBedrockEmbeddingRequest } from "./request.js";
import { boundedFetch, bedrockUnsupportedAuth, bedrockToken, bedrockHeaders, bedrockSecrets, provenUnsent, redirectState, refusedAnswer, withAcceptedJob } from "./http.js";

const error = (status, message) => createErrorResult(status, `Bedrock ${message}`);
const unknown = (status, state = "submit-unknown") => withAcceptedJob(error(status, "embedding outcome unavailable"), state);
const count = value => Number.isSafeInteger(value) && value >= 0;
export function normalizeBedrockEmbeddings(raw, plan, expected) {
  if (!isRecord(raw) || raw.error || raw.message || raw.failureCount > 0) throw new Error("Invalid answer");
  const vectors = plan.cohere ? (Array.isArray(raw.embeddings) ? raw.embeddings : raw.embeddings?.float) : [raw.embedding ?? raw.embeddingsByType?.float];
  if (!Array.isArray(vectors) || vectors.length !== expected || vectors.some(vector => !Array.isArray(vector) || vector.length !== plan.dimensions || vector.some(value => !isNumber(value) || !Number.isFinite(value) || Math.abs(value) > 3.4028234663852886e38))) throw new Error("Invalid vectors");
  return vectors;
}

/** One selected connection, no retries; every batch shares one total deadline. */
export function createBedrockEmbeddingAdapter({ fetch: send, timeoutMs = 60000, now = Date.now } = {}) {
  return {
    provider: "bedrock", models: BEDROCK_EMBEDDING_MODELS,
    buildUrl: bedrockUrl, buildHeaders: credentials => bedrockHeaders(bedrockToken(credentials) ?? ""),
    buildBody: (model, body) => buildBedrockEmbeddingRequest(model, body).bodies,
    async embed({ model, body, credentials, signal }) {
      // Freeze the selected account/region/proxy before any asynchronous dispatch.
      try { credentials = structuredClone(credentials); }
      catch { return error(400, "invalid connection snapshot"); }
      let plan, url;
      try { plan = buildBedrockEmbeddingRequest(model, body); url = bedrockUrl(model, credentials); }
      catch { return error(400, "unsupported embedding input or region"); }
      // Bearer is a separate supported subset; never mistake AWS secrets for bearer tokens.
      if (bedrockUnsupportedAuth(credentials)) return error(400, "native embeddings require a Bedrock bearer API key");
      const token = bedrockToken(credentials);
      if (!token) return error(401, "API key required");
      if (signal?.aborted) return error(499, "request aborted");
      const proxyOptions = { ...resolveCredentialProxyOptions(credentials), disableEnvProxy: true };
      const transport = send ?? ((target, init) => proxyAwareFetch(target, init, proxyOptions));
      const deadline = now() + Math.min(60000, Math.max(1, timeoutMs));
      const vectors = [];
      let tokens = 0, usageKnown = true, submitted = false;
      for (const upstream of plan.bodies) {
        if (signal?.aborted || now() >= deadline) return submitted ? unknown(signal?.aborted ? 499 : 504, "accepted") : error(signal?.aborted ? 499 : 504, "request ended before submission");
        let response;
        try {
          response = await boundedFetch(transport, url, { method: "POST", headers: bedrockHeaders(token), body: JSON.stringify(upstream), redirect: "manual" }, { signal, timeoutMs: deadline - now() });
        } catch (cause) {
          const status = signal?.aborted ? 499 : cause?.name === "TimeoutError" ? 504 : 502;
          return !submitted && provenUnsent(cause) ? error(status, "request could not connect") : unknown(status);
        }
        const redirect = redirectState(response, new URL(url).origin);
        if (redirect) return submitted || redirect.foreign ? unknown(502, "submit-unknown") : error(502, "redirect refused");
        if (!response.ok) {
          const failure = refusedAnswer(response, { secrets: bedrockSecrets(credentials), now });
          return submitted && !failure.acceptedJob ? withAcceptedJob(failure, "partial") : failure;
        }
        submitted = true;
        try {
          const raw = JSON.parse(await readBoundedResponseText(response, { signal, maxBytes: 16 * 1024 * 1024, timeoutMs: Math.max(1, deadline - now()), throwOnTimeout: true }));
          vectors.push(...normalizeBedrockEmbeddings(raw, plan, plan.cohere ? plan.items : 1));
          if (count(raw.inputTextTokenCount)) tokens += raw.inputTextTokenCount;
          else usageKnown = false;
        } catch (cause) { return unknown(signal?.aborted ? 499 : cause?.name === "TimeoutError" ? 504 : 502, "completed-unusable"); }
      }
      const usage = usageKnown ? { prompt_tokens: tokens, total_tokens: tokens } : null;
      const accounting = mediaAccounting(usage ? { usage } : null, "bedrock", "embedding");
      accounting.nativeUnits = { inputs: plan.items };
      if (!usage) accounting.meta.usageMissing = true;
      const data = vectors.map((vector, index) => {
        let embedding = vector;
        if (plan.encodingFormat === "base64") {
          const bytes = Buffer.alloc(vector.length * 4);
          vector.forEach((value, offset) => bytes.writeFloatLE(value, offset * 4));
          embedding = bytes.toString("base64");
        }
        return { object: "embedding", index, embedding };
      });
      return { success: true, accounting, response: new Response(JSON.stringify({ object: "list", model, data, usage: usage ?? { prompt_tokens: 0, total_tokens: 0 } }), { headers: { "Content-Type": "application/json" } }) };
    },
  };
}
