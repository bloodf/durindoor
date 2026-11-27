// Naver CLOVA Studio native embeddings adapter, staged for /v1/embeddings and
// not registered (see ./registration.json). One sequential POST of `{ text }`
// per input; see ./config.js for the source attribution.
//
// Fork deviations from the source handler: the key goes only to
// https://clovastudio.stream.ntruss.com (connection base URLs are ignored);
// each call has its own deadline and the fan-out has a total deadline, both
// also bounded by the caller's signal; redirects are refused; each answer read
// is size and time bounded; upstream bodies never reach an error message; a
// failure after earlier calls succeeded, or a send whose outcome is unknown
// (timeout or abort after send, 5xx, unreadable or unusable 2xx), carries
// `acceptedJob` with unknown cost and nothing is ever resent; over-long inputs
// are refused instead of cut; each vector is checked (1024 finite numbers)
// before anything is returned; a missing `inputTokens` keeps usage unknown
// instead of counting zero.
import { createErrorResult, readBoundedResponseText } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  CLOVA_CALL_TIMEOUT_MS, CLOVA_EMBEDDINGS_URL, CLOVA_EMBEDDING_MODELS, CLOVA_MAX_RESPONSE_BYTES, CLOVA_PROVIDER_ID,
  CLOVA_SUCCESS_CODE, CLOVA_TOTAL_TIMEOUT_MS,
} from "./config.js";
import {
  boundedFetch, clovaHeaders, clovaSecrets, clovaToken, provenUnsent, redirectState, refusedAnswer, withAcceptedJob,
} from "./http.js";
import { buildClovaEmbeddingRequest } from "./request.js";

const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
});
const aborted = () => createErrorResult(499, "CLOVA Studio embeddings request aborted");

/** Little-endian float32, as the source's packEmbeddingAsBase64. */
export function packFloat32Base64(vector) {
  const bytes = Buffer.alloc(vector.length * 4);
  vector.forEach((value, i) => bytes.writeFloatLE(value, i * 4));
  return bytes.toString("base64");
}

const usageCount = (value) => (isNumber(value) && Number.isInteger(value) && value >= 0 ? value : null);

/**
 * Validate one 2xx v2 answer (source: normalizeClovaEmbeddingV2Response plus
 * flattenSingleRowEmbedding). A non-20000 status is an in-band failure; its
 * message is upstream text and is never used.
 *
 * @returns {{ vector: number[], inputTokens: number|null }}
 * @throws {Error} when the answer is not a usable embedding
 */
export function normalizeClovaEmbedding(answer, { dimensions = 1024 } = {}) {
  if (!isRecord(answer)) throw new Error("not an object");
  const code = isRecord(answer.status) ? answer.status.code : undefined;
  if (String(code) !== CLOVA_SUCCESS_CODE) throw new Error("unsuccessful status");
  if (!isRecord(answer.result)) throw new Error("missing result");
  let vector = answer.result.embedding;
  if (Array.isArray(vector) && vector.length === 1 && Array.isArray(vector[0])) vector = vector[0];
  if (!Array.isArray(vector) || vector.length !== dimensions || !vector.every((v) => isNumber(v) && Number.isFinite(v))) {
    throw new Error("invalid embedding vector");
  }
  return { vector, inputTokens: usageCount(answer.result.inputTokens) };
}

/**
 * @param {object} [options] - { callTimeoutMs, totalTimeoutMs, now, fetch } for
 *   tests; `fetch(url, init)` defaults to proxyAwareFetch with the selected
 *   connection's proxy settings.
 */
export function createClovaEmbeddingAdapter(options = {}) {
  const {
    callTimeoutMs = CLOVA_CALL_TIMEOUT_MS, totalTimeoutMs = CLOVA_TOTAL_TIMEOUT_MS, now = Date.now, fetch: send = null,
  } = options;
  return {
    provider: CLOVA_PROVIDER_ID,
    models: CLOVA_EMBEDDING_MODELS,
    // Plain EMBEDDING_ADAPTERS fields, for introspection. The shared core fetch
    // sends one body per request and cannot fan out, so handleEmbeddingsCore
    // must call `embed` for CLOVA Studio. buildBody returns the first per-call
    // body only.
    buildUrl: () => CLOVA_EMBEDDINGS_URL,
    buildHeaders: (credentials) => clovaHeaders(clovaToken(credentials) ?? ""),
    buildBody: (model, body) => buildClovaEmbeddingRequest(model, body).bodies[0],

    /**
     * One embeddings request, fanned out sequentially with the selected
     * connection's key. Nothing is retried or resent.
     * @returns {Promise<{ success: true, accounting, response } | object>} an
     *   error result from createErrorResult otherwise (with `acceptedJob` when
     *   CLOVA may have done and billed some of the work).
     */
    async embed({ model, body, credentials, signal = null, log = null }) {
      let request;
      try {
        request = buildClovaEmbeddingRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const token = clovaToken(credentials);
      if (!token) return createErrorResult(401, "CLOVA Studio API key is required");
      if (signal?.aborted) return aborted();
      const secrets = clovaSecrets(credentials);
      const totalDeadline = now() + totalTimeoutMs;
      const transport = send ?? ((url, init) => proxyAwareFetch(url, init, resolveCredentialProxyOptions(credentials)));
      const headers = clovaHeaders(token);

      const vectors = [];
      let tokens = 0;
      let tokensKnown = true;
      const progress = () => ({
        completedInputs: vectors.length,
        requestedInputs: request.items,
        usage: vectors.length && tokensKnown ? { prompt_tokens: tokens, total_tokens: tokens } : null,
      });
      // A failure is uncertain on its own (jobState given), or because earlier
      // calls in this fan-out already ran (partial). Otherwise nothing was done.
      const fail = (result, jobState = null) => {
        if (jobState) return withAcceptedJob(result, jobState, progress());
        return vectors.length ? withAcceptedJob(result, "partial", progress()) : result;
      };
      const unusable = (message, status = HTTP_STATUS.BAD_GATEWAY, jobState = "completed-unusable") =>
        fail(createErrorResult(status, `CLOVA Studio ${message}`), jobState);

      for (const [position, callBody] of request.bodies.entries()) {
        if (signal?.aborted) return fail(aborted());
        const left = totalDeadline - now();
        if (left <= 0) return fail(createErrorResult(HTTP_STATUS.GATEWAY_TIMEOUT, "CLOVA Studio embeddings exceeded the total deadline"));
        const callDeadline = now() + Math.min(callTimeoutMs, left);
        const remaining = () => Math.max(1, callDeadline - now());

        let response;
        try {
          response = await boundedFetch(transport, CLOVA_EMBEDDINGS_URL, {
            method: "POST",
            headers,
            body: JSON.stringify(callBody),
            redirect: "manual",
          }, { signal, timeoutMs: remaining() });
        } catch (error) {
          const unsent = provenUnsent(error);
          if (signal?.aborted || error?.name === "AbortError") return unsent ? fail(aborted()) : fail(aborted(), "submit-unknown");
          if (unsent) return fail(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "CLOVA Studio embeddings request could not connect"));
          const timedOut = error?.name === "TimeoutError";
          return unusable(
            `embeddings request ${timedOut ? "timed out" : "was interrupted"}; whether it ran is unknown`,
            timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
            "submit-unknown"
          );
        }

        const redirect = redirectState(response);
        if (redirect?.refused) {
          log?.debug?.("CLOVA", "embeddings redirect refused");
          return fail(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "CLOVA Studio embeddings redirect refused"));
        }
        if (redirect?.foreign) return unusable("embeddings request was redirected", HTTP_STATUS.BAD_GATEWAY, "submit-unknown");
        if (!response.ok) {
          const refused = refusedAnswer(response, { secrets, now });
          return fail(refused.result, refused.uncertain ? "submit-unknown" : null);
        }

        let text;
        try {
          text = await readBoundedResponseText(response, { signal, maxBytes: CLOVA_MAX_RESPONSE_BYTES, timeoutMs: remaining(), throwOnTimeout: true });
        } catch (error) {
          if (signal?.aborted || error?.name === "AbortError") return fail(aborted(), "accepted");
          return unusable("embeddings answer could not be read", error?.name === "TimeoutError" ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY);
        }
        let answer;
        try {
          answer = JSON.parse(text);
        } catch {
          // The parser's message quotes the body, so it is dropped.
        }
        let normalized;
        try {
          normalized = normalizeClovaEmbedding(answer, { dimensions: request.dimensions });
        } catch (error) {
          log?.debug?.("CLOVA", `unusable embeddings answer for input ${position}: ${error.message}`);
          return unusable(error.message === "unsuccessful status"
            ? "returned an unsuccessful embeddings status"
            : "returned no valid embedding vector");
        }
        vectors.push(normalized.vector);
        if (normalized.inputTokens === null) tokensKnown = false;
        else tokens += normalized.inputTokens;
      }

      // Usage comes only from CLOVA's own `inputTokens`; any missing count keeps it unknown.
      const usage = tokensKnown ? { prompt_tokens: tokens, total_tokens: tokens } : null;
      const accounting = mediaAccounting(usage ? { usage } : null, CLOVA_PROVIDER_ID, "embedding");
      accounting.nativeUnits = { inputs: request.items, calls: request.items };
      if (!usage) accounting.meta.usageMissing = true;
      const requested = isString(body.model) ? body.model : null;
      const payload = {
        object: "list",
        data: vectors.map((vector, index) => ({
          object: "embedding",
          index,
          embedding: request.encodingFormat === "base64" ? packFloat32Base64(vector) : vector,
        })),
        // Source rule: echo a bare client model id, otherwise the provider-scoped id.
        model: requested && !requested.includes("/") ? requested : `${CLOVA_PROVIDER_ID}/${request.model.id}`,
        // Source fallback for a missing receipt; accounting above keeps it unknown.
        usage: usage ?? { prompt_tokens: 0, total_tokens: 0 },
      };
      return { success: true, accounting, response: jsonResponse(payload) };
    },
  };
}
