// UC Direct native image generation: one synchronous POST to
// https://api.uncensored.com/api/v1/images/generations. Staged for
// /v1/images/generations as a guarded `generate` adapter and not registered
// (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/imageGeneration/providers/ucImage.ts, surface (B)
// handleUcDirectImage: headers `X-api-key: <uai_ key>` and
// `Content-Type: application/json`; body `{ model, prompt, n }` plus `size`
// when given, `model` with any `uc/` or `uc-direct/` prefix removed and `n`
// at most 4; a 2xx is OpenAI-shaped `{ created, data: [{ url } | { b64_json }] }`
// and needs at least one item; 429 is retryable, 402 funds and 403 moderation
// are not. Model ids from open-sse/config/imageRegistryData.ts (`uc`).
//
// Fork deviations: only the metered REST surface (persona surface (A) is the
// retired `uc` consumer-app path, #1241); the key must be a `uai_` developer
// key and goes only to https://api.uncensored.com; the call is time bounded,
// aborts on the caller's signal and refuses redirects; the model must be one
// of the 22 source ids; `n` outside 1..4 and a `size` that is not `WxH` are
// refused instead of clamped or passed through; persona knobs (aspect_ratio,
// timeout_ms, poll_interval_ms), streaming, input images and unknown fields
// are refused; response_format is not sent (the source never sent it) and,
// when given, only items of that form are returned; result URLs must be
// public https and are never fetched; a send whose outcome is unknown carries
// `acceptedJob` and is never resent; the answer is never quoted in errors.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { MAX_IMAGE_BYTES } from "../../../config/mediaConfig.js";
import { mediaAccounting, returnedImageUnits } from "../../../handlers/mediaAccounting.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { UC_IMAGE_MODELS, UC_IMAGE_N_MAX, UC_IMAGE_TIMEOUT_MS, UC_IMAGE_URL, UC_PROVIDER_ID, ucImageModel } from "./config.js";
import {
  boundedFetch, provenUnsent, readJsonObject, redirectState, refusedAnswer, ucJsonHeaders, ucPublicUrl, ucSecrets, ucToken,
  withAcceptedJob,
} from "./http.js";

const MODALITY = "image";
const RESPONSE_FORMATS = Object.freeze(["url", "b64_json"]);
const MAX_RESPONSE_BYTES = 48 * 1024 * 1024;
const MAX_PROMPT_CHARS = 32_000;
const SIZE_RE = /^([1-9]\d{1,4})x([1-9]\d{1,4})$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const ACCEPTED_FIELDS = new Set(["model", "prompt", "n", "size", "response_format", "user", "stream"]);

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const abortedResult = () => createErrorResult(499, "UC Direct image request aborted");
const decodedBytes = (b64) => Math.floor(b64.length * 3 / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);

/**
 * The UC Direct body for an OpenAI-style image request. Throws a 400 error for
 * an unknown model or an input this subset cannot honor.
 */
export function buildUcImageRequest(model, body) {
  const entry = ucImageModel(model);
  if (!entry) throw reject(`Unsupported UC Direct image model: ${model}. Use one of: ${UC_IMAGE_MODELS.map((m) => m.id).join(", ")}`);
  if (!isRecord(body)) throw reject("UC Direct image generation needs a JSON object");
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("Prompt is required for UC image generation");
  if (body.prompt.length > MAX_PROMPT_CHARS) throw reject(`UC Direct image prompts must not exceed ${MAX_PROMPT_CHARS} characters`);
  if (body.stream) throw reject("UC Direct image generation does not support streaming");
  const unsupported = Object.keys(body).find((field) => !ACCEPTED_FIELDS.has(field) && body[field] !== undefined && body[field] !== null);
  if (unsupported) throw reject(`UC Direct image generation does not support ${unsupported}`);
  if (body.response_format !== undefined && body.response_format !== null && !RESPONSE_FORMATS.includes(body.response_format)) {
    throw reject(`UC Direct image supports response_format ${RESPONSE_FORMATS.join(", ")} only`);
  }
  let n = 1;
  if (body.n !== undefined && body.n !== null) {
    if (!Number.isInteger(body.n) || body.n < 1 || body.n > UC_IMAGE_N_MAX) throw reject(`UC Direct image n must be an integer from 1 to ${UC_IMAGE_N_MAX}`);
    n = body.n;
  }
  const request = { model: entry.id, prompt: body.prompt.trim(), n };
  if (body.size !== undefined && body.size !== null) {
    if (!isString(body.size) || !SIZE_RE.test(body.size.trim())) throw reject("UC Direct image size must look like 1024x1024");
    request.size = body.size.trim();
  }
  return request;
}

/** Keep usable items only: a public https `url` or a bounded base64 `b64_json`, of the requested form. */
function normalizeItems(items, requested) {
  const kept = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!isRecord(item)) continue;
    let out = null;
    const url = ucPublicUrl(item.url);
    if (url) out = { url };
    else if (isString(item.b64_json) && item.b64_json && BASE64_RE.test(item.b64_json) && decodedBytes(item.b64_json) <= MAX_IMAGE_BYTES) {
      out = { b64_json: item.b64_json };
    }
    if (!out) continue;
    if (requested === "url" && !out.url) continue;
    if (requested === "b64_json" && !out.b64_json) continue;
    kept.push(out);
  }
  return kept;
}

/**
 * @param {object} [options]
 * @param {number} [options.timeoutMs] - bound for the whole call, headers and body
 */
export function createUcImageAdapter({ timeoutMs = UC_IMAGE_TIMEOUT_MS, now = Date.now } = {}) {
  return {
    provider: UC_PROVIDER_ID,
    models: UC_IMAGE_MODELS,
    responseFormats: RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    /**
     * Generate up to four images for the selected connection.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ url } | { b64_json }] }`, or an error result that
     * carries `acceptedJob` when UC may have run (and billed) the request
     */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      try {
        request = buildUcImageRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const token = ucToken(credentials);
      if (!token) return createErrorResult(401, "UC Direct image generation needs a uai_ developer API key");
      if (signal?.aborted) return abortedResult();
      const secrets = ucSecrets(credentials);
      const deadline = now() + timeoutMs;
      const remaining = () => Math.max(1, deadline - now());

      let response;
      try {
        response = await boundedFetch(UC_IMAGE_URL, {
          method: "POST",
          headers: ucJsonHeaders(token),
          body: JSON.stringify(request),
          redirect: "manual",
          proxyOptions: resolveCredentialProxyOptions(credentials),
        }, { signal, timeoutMs: remaining() });
      } catch (error) {
        const unsent = provenUnsent(error);
        if (signal?.aborted || error?.name === "AbortError") return unsent ? abortedResult() : withAcceptedJob(abortedResult(), MODALITY, "submit-unknown");
        if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "UC Direct image request could not connect");
        const timedOut = error?.name === "TimeoutError";
        return withAcceptedJob(createErrorResult(
          timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
          `UC Direct image request ${timedOut ? "timed out" : "was interrupted"}; whether it ran is unknown`
        ), MODALITY, "submit-unknown");
      }

      const redirect = redirectState(response);
      if (redirect?.refused) {
        log?.debug?.("UC_IMAGE", "image request redirect refused");
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "UC Direct image request redirect refused");
      }
      if (redirect?.foreign) return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "UC Direct image request was redirected"), MODALITY, "submit-unknown");
      if (!response.ok) return refusedAnswer(response, { modality: MODALITY, label: "image generation", signal, timeoutMs: remaining(), secrets });

      let answer;
      try {
        answer = await readJsonObject(response, { signal, timeoutMs: remaining(), maxBytes: MAX_RESPONSE_BYTES, what: "image answer" });
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), MODALITY, "completed-unread");
        return withAcceptedJob(createErrorResult(error?.status ?? HTTP_STATUS.BAD_GATEWAY, error.message), MODALITY, "completed-unread");
      }
      const requested = body.response_format ?? undefined;
      const data = normalizeItems(answer.data, requested).slice(0, request.n);
      if (data.length === 0) {
        // A 2xx answer may already be billed even without a usable image.
        return withAcceptedJob(
          createErrorResult(HTTP_STATUS.BAD_GATEWAY, `UC Direct returned no usable image${requested ? ` in response_format ${requested}` : ""}`),
          MODALITY,
          "completed-unusable"
        );
      }
      const payload = { created: Number.isInteger(answer.created) ? answer.created : Math.floor(Date.now() / 1000), data };
      // Usage counts the images returned; UC credit charges are not converted to a cost.
      const accounting = mediaAccounting(answer, UC_PROVIDER_ID, MODALITY);
      returnedImageUnits(accounting, payload);
      return {
        success: true,
        accounting,
        response: new Response(JSON.stringify(payload), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }),
      };
    },
  };
}
