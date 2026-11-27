// deAPI native embeddings adapter, staged for /v1/embeddings and not
// registered (see ./registration.json). One POST per call; see ./config.js for
// the source attribution.
//
// Fork deviations from the source handler: the key goes only to
// https://oai.deapi.ai (connection base URLs are ignored); the call is bounded
// by one deadline and the caller's signal; redirects are refused; the answer
// read is size and time bounded; upstream bodies never reach an error message;
// a send whose outcome is unknown (timeout or abort after send, 5xx,
// unreadable or unusable 2xx) carries `acceptedJob` with unknown cost and is
// never resent; over-long inputs are refused instead of cut; vectors are
// checked (count, index, width, finite numbers) before anything is returned.
import { createErrorResult, errorEnvelopeMessage, readBoundedResponseText } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  DEAPI_EMBEDDINGS_URL, DEAPI_EMBEDDING_MODELS, DEAPI_EMBEDDING_TIMEOUT_MS, DEAPI_MAX_RESPONSE_BYTES, DEAPI_PROVIDER_ID,
} from "./config.js";
import {
  boundedFetch, deapiHeaders, deapiSecrets, deapiToken, provenUnsent, redirectState, refusedAnswer, withAcceptedJob,
} from "./http.js";
import { buildDeapiEmbeddingRequest } from "./request.js";

const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
});
const aborted = () => createErrorResult(499, "deAPI embeddings request aborted");
const unusable = (message, status = HTTP_STATUS.BAD_GATEWAY, jobState = "completed-unusable") =>
  withAcceptedJob(createErrorResult(status, `deAPI ${message}`), jobState);

/** Little-endian float32, as the source's packEmbeddingAsBase64. */
export function packFloat32Base64(vector) {
  const bytes = Buffer.alloc(vector.length * 4);
  vector.forEach((value, i) => bytes.writeFloatLE(value, i * 4));
  return bytes.toString("base64");
}

const usageCount = (value) => (isNumber(value) && Number.isInteger(value) && value >= 0 ? value : null);

/**
 * Validate and normalize one 2xx answer. Ports the source's per-item fixes
 * (one redundant row unwrapped, missing `index` filled by position) and then
 * requires exactly one finite vector of the model's width per input.
 *
 * @returns {{ data: object[], usage: object|null }}
 * @throws {Error} when the answer is not a usable embedding list
 */
export function normalizeDeapiEmbeddings(answer, { items, dimensions, encodingFormat = "float" }) {
  if (!isRecord(answer) || !Array.isArray(answer.data)) throw new Error("not an embedding list");
  if (answer.data.length !== items) throw new Error(`returned ${answer.data.length} vectors for ${items} inputs`);
  const slots = new Array(items).fill(null);
  answer.data.forEach((item, position) => {
    if (!isRecord(item)) throw new Error("invalid embedding item");
    let vector = item.embedding;
    if (Array.isArray(vector) && vector.length === 1 && Array.isArray(vector[0])) vector = vector[0];
    if (!Array.isArray(vector) || vector.length !== dimensions || !vector.every((v) => isNumber(v) && Number.isFinite(v))) {
      throw new Error("invalid embedding vector");
    }
    const index = item.index === undefined || item.index === null ? position : item.index;
    if (!Number.isInteger(index) || index < 0 || index >= items || slots[index]) throw new Error("invalid embedding index");
    slots[index] = { object: "embedding", index, embedding: encodingFormat === "base64" ? packFloat32Base64(vector) : vector };
  });
  let usage = null;
  if (isRecord(answer.usage)) {
    const prompt = usageCount(answer.usage.prompt_tokens);
    const total = usageCount(answer.usage.total_tokens);
    if (prompt !== null || total !== null) usage = { prompt_tokens: prompt ?? total, total_tokens: total ?? prompt };
  }
  return { data: slots, usage };
}

/**
 * @param {object} [options] - { timeoutMs, now, fetch } for tests; `fetch(url, init)`
 *   defaults to proxyAwareFetch with the selected connection's proxy settings.
 */
export function createDeapiEmbeddingAdapter(options = {}) {
  const { timeoutMs = DEAPI_EMBEDDING_TIMEOUT_MS, now = Date.now, fetch: send = null } = options;
  return {
    provider: DEAPI_PROVIDER_ID,
    models: DEAPI_EMBEDDING_MODELS,
    // Plain EMBEDDING_ADAPTERS fields, for introspection (mediaTransport and
    // the registry). handleEmbeddingsCore must call `embed` for deAPI because
    // its shared fetch path has no deadline, redirect refusal or input checks.
    buildUrl: () => DEAPI_EMBEDDINGS_URL,
    buildHeaders: (credentials) => deapiHeaders(deapiToken(credentials) ?? ""),
    buildBody: (model, body) => buildDeapiEmbeddingRequest(model, body).upstream,

    /**
     * One embedding call with the selected connection's key.
     * @returns {Promise<{ success: true, accounting, response } | object>} an
     *   error result from createErrorResult otherwise (with `acceptedJob` when
     *   deAPI may have done and billed the work).
     */
    async embed({ model, body, credentials, signal = null, log = null }) {
      let request;
      try {
        request = buildDeapiEmbeddingRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const token = deapiToken(credentials);
      if (!token) return createErrorResult(401, "deAPI API key is required");
      if (signal?.aborted) return aborted();
      const secrets = deapiSecrets(credentials);
      const deadline = now() + timeoutMs;
      const remaining = () => Math.max(1, deadline - now());
      const transport = send ?? ((url, init) => proxyAwareFetch(url, init, resolveCredentialProxyOptions(credentials)));

      let response;
      try {
        response = await boundedFetch(transport, DEAPI_EMBEDDINGS_URL, {
          method: "POST",
          headers: deapiHeaders(token),
          body: JSON.stringify(request.upstream),
          redirect: "manual",
        }, { signal, timeoutMs: remaining() });
      } catch (error) {
        const unsent = provenUnsent(error);
        if (signal?.aborted || error?.name === "AbortError") return unsent ? aborted() : withAcceptedJob(aborted(), "submit-unknown");
        if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "deAPI embeddings request could not connect");
        const timedOut = error?.name === "TimeoutError";
        return unusable(
          `embeddings request ${timedOut ? "timed out" : "was interrupted"}; whether it ran is unknown`,
          timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
          "submit-unknown"
        );
      }

      const redirect = redirectState(response);
      if (redirect?.refused) {
        log?.debug?.("DEAPI", "embeddings redirect refused");
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "deAPI embeddings redirect refused");
      }
      if (redirect?.foreign) return unusable("embeddings request was redirected", HTTP_STATUS.BAD_GATEWAY, "submit-unknown");
      if (!response.ok) return refusedAnswer(response, { secrets, now });

      let text;
      try {
        text = await readBoundedResponseText(response, { signal, maxBytes: DEAPI_MAX_RESPONSE_BYTES, timeoutMs: remaining(), throwOnTimeout: true });
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(aborted(), "accepted");
        return unusable("embeddings answer could not be read", error?.name === "TimeoutError" ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY);
      }
      let answer;
      try {
        answer = JSON.parse(text);
      } catch {
        // The parser's message quotes the body, so it is dropped.
      }
      if (!isRecord(answer)) return unusable("returned an unreadable embeddings answer");
      // An in-band error envelope on 2xx: the message is upstream text, so only its presence is used.
      if (errorEnvelopeMessage(answer)) return unusable("returned an error envelope for embeddings");

      let normalized;
      try {
        normalized = normalizeDeapiEmbeddings(answer, { items: request.items, dimensions: request.model.dimensions, encodingFormat: request.encodingFormat });
      } catch (error) {
        log?.debug?.("DEAPI", `unusable embeddings answer: ${error.message}`);
        return unusable("returned no valid embedding vectors");
      }

      // Usage comes only from deAPI's own `usage`; absent usage stays unknown.
      const accounting = mediaAccounting(normalized.usage ? { usage: normalized.usage } : null, DEAPI_PROVIDER_ID, "embedding");
      accounting.nativeUnits = { inputs: request.items };
      if (!normalized.usage) accounting.meta.usageMissing = true;
      const requested = isString(body.model) ? body.model : null;
      const payload = {
        object: "list",
        data: normalized.data,
        // Source rule: echo a bare client model id, otherwise the provider-scoped id.
        model: requested && !requested.includes("/") ? requested : `${DEAPI_PROVIDER_ID}/${request.model.id}`,
        // Source fallback for a missing receipt; accounting above keeps it unknown.
        usage: normalized.usage ?? { prompt_tokens: 0, total_tokens: 0 },
      };
      return { success: true, accounting, response: jsonResponse(payload) };
    },
  };
}
