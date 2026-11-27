// deAPI native image generation: one synchronous POST to
// https://oai.deapi.ai/v1/images/generations. Staged for
// /v1/images/generations as a guarded `generate` adapter and not registered
// (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/imageRegistryData.ts (`deapi`, format "openai", native model
// ids only, sizes per model, PNG output) and open-sse/handlers/imageGeneration.ts
// (handleOpenAIImageGeneration for format "openai": body `{ model, prompt }`
// plus `n`, `size`, `quality`, `response_format` and `style` when given;
// `Content-Type: application/json` and `Authorization: Bearer <key>`), via
// handlers/imageGeneration/openAiImageFetch.ts (a 2xx needs a `data[]` item
// with a `url` or `b64_json`, else 502).
//
// Fork deviations: the key goes only to https://oai.deapi.ai; the call is time
// bounded, aborts on the caller's signal and refuses redirects; the answer is
// size bounded and never quoted in an error; the model must be one of the four
// catalog ids and `size` one of that model's sizes (the source left both to
// the gateway); n > 1, streaming, input images, masks and output options other
// than PNG are refused instead of passed through; a requested response_format
// must be the one returned (a URL is never downloaded); result URLs must be
// public https; a send whose outcome is unknown carries `acceptedJob` and is
// never resent.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { MAX_IMAGE_BYTES } from "../../../config/mediaConfig.js";
import { mediaAccounting, returnedImageUnits } from "../../../handlers/mediaAccounting.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  DEAPI_IMAGE_MODELS, DEAPI_IMAGE_SIZES, DEAPI_IMAGE_TIMEOUT_MS, DEAPI_IMAGE_URL, DEAPI_PROVIDER_ID, deapiImageModel,
  deapiImageSizes,
} from "./config.js";
import {
  boundedFetch, deapiJsonHeaders, deapiPublicUrl, deapiSecrets, deapiToken, provenUnsent, readJsonObject,
  redirectState, refusedAnswer, withAcceptedJob,
} from "./http.js";

const MODALITY = "image";
const RESPONSE_FORMATS = Object.freeze(["url", "b64_json"]);
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_PROMPT_CHARS = 32_000;
const OPTION_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
// OpenAI Images fields this subset forwards (source order) or keeps local (`user`).
const ACCEPTED_FIELDS = new Set(["model", "prompt", "n", "size", "quality", "response_format", "style", "user", "output_format", "stream"]);

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const abortedResult = () => createErrorResult(499, "deAPI image request aborted");
const decodedBytes = (b64) => Math.floor(b64.length * 3 / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);

function option(body, field) {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (!isString(value) || !OPTION_RE.test(value)) throw reject(`deAPI image ${field} must be a short lowercase option name`);
  return value;
}

/**
 * The deAPI body for an OpenAI-style image request. Throws a 400 error for an
 * unknown model or an input this subset cannot honor.
 */
export function buildDeapiImageRequest(model, body) {
  if (!deapiImageModel(model)) {
    throw reject(`Unsupported deAPI image model: ${model}. Use one of: ${DEAPI_IMAGE_MODELS.map((m) => m.id).join(", ")}`);
  }
  if (!isRecord(body)) throw reject("deAPI image generation needs a JSON object");
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("deAPI image generation needs a text prompt");
  if (body.prompt.length > MAX_PROMPT_CHARS) throw reject(`deAPI image prompts must not exceed ${MAX_PROMPT_CHARS} characters`);
  if (body.stream) throw reject("deAPI image generation does not support streaming");
  if (body.n !== undefined && body.n !== null && body.n !== 1) throw reject("deAPI image generation returns one image per request (n=1)");
  const unsupported = Object.keys(body).find((field) => !ACCEPTED_FIELDS.has(field) && body[field] !== undefined && body[field] !== null);
  if (unsupported) throw reject(`deAPI image generation does not support ${unsupported}`);
  if (body.output_format !== undefined && body.output_format !== null && body.output_format !== "png") {
    throw reject("deAPI image output is always png");
  }
  if (body.response_format !== undefined && body.response_format !== null && !RESPONSE_FORMATS.includes(body.response_format)) {
    throw reject(`deAPI image supports response_format ${RESPONSE_FORMATS.join(", ")} only`);
  }

  const request = { model, prompt: body.prompt };
  if (body.n === 1) request.n = 1;
  if (body.size !== undefined && body.size !== null) {
    const sizes = deapiImageSizes(model);
    if (!isString(body.size) || !sizes.includes(body.size)) throw reject(`deAPI ${model} size must be one of: ${sizes.join(", ")}`);
    request.size = body.size;
  }
  const quality = option(body, "quality");
  if (quality !== undefined) request.quality = quality;
  if (body.response_format !== undefined && body.response_format !== null) request.response_format = body.response_format;
  const style = option(body, "style");
  if (style !== undefined) request.style = style;
  return request;
}

/**
 * Keep only usable items: a public https `url` or a bounded `b64_json`, plus a
 * short `revised_prompt`. Items of the wrong form for a requested format are
 * not usable either.
 */
function normalizeItems(items, requested) {
  const kept = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!isRecord(item)) continue;
    const out = {};
    if (isString(item.b64_json) && item.b64_json && BASE64_RE.test(item.b64_json) && decodedBytes(item.b64_json) <= MAX_IMAGE_BYTES) {
      out.b64_json = item.b64_json;
    } else if (deapiPublicUrl(item.url)) {
      out.url = deapiPublicUrl(item.url);
    } else {
      continue;
    }
    if (requested === "url" && !out.url) continue;
    if (requested === "b64_json" && !out.b64_json) continue;
    if (isString(item.revised_prompt) && item.revised_prompt.length <= MAX_PROMPT_CHARS) out.revised_prompt = item.revised_prompt;
    kept.push(out);
  }
  return kept;
}

/**
 * @param {object} [options]
 * @param {number} [options.timeoutMs] - bound for the whole call, headers and body
 */
export function createDeapiImageAdapter({ timeoutMs = DEAPI_IMAGE_TIMEOUT_MS, now = Date.now } = {}) {
  return {
    provider: DEAPI_PROVIDER_ID,
    models: DEAPI_IMAGE_MODELS,
    supportedSizes: DEAPI_IMAGE_SIZES,
    responseFormats: RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    /**
     * Generate one image for the selected connection.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ url } | { b64_json }] }`, or an error result that
     * carries `acceptedJob` when deAPI may have run (and billed) the request
     */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      try {
        request = buildDeapiImageRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const token = deapiToken(credentials);
      if (!token) return createErrorResult(401, "deAPI API key is required");
      if (signal?.aborted) return abortedResult();
      const secrets = deapiSecrets(credentials);
      const deadline = now() + timeoutMs;
      const remaining = () => Math.max(1, deadline - now());

      let response;
      try {
        response = await boundedFetch(DEAPI_IMAGE_URL, {
          method: "POST",
          headers: deapiJsonHeaders(token),
          body: JSON.stringify(request),
          redirect: "manual",
          proxyOptions: resolveCredentialProxyOptions(credentials),
        }, { signal, timeoutMs: remaining() });
      } catch (error) {
        const unsent = provenUnsent(error);
        if (signal?.aborted || error?.name === "AbortError") return unsent ? abortedResult() : withAcceptedJob(abortedResult(), MODALITY, "submit-unknown");
        if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "deAPI image request could not connect");
        const timedOut = error?.name === "TimeoutError";
        return withAcceptedJob(createErrorResult(
          timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
          `deAPI image request ${timedOut ? "timed out" : "was interrupted"}; whether it ran is unknown`
        ), MODALITY, "submit-unknown");
      }

      const redirect = redirectState(response);
      if (redirect?.refused) {
        log?.debug?.("DEAPI_IMAGE", "image request redirect refused");
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "deAPI image request redirect refused");
      }
      if (redirect?.foreign) return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "deAPI image request was redirected"), MODALITY, "submit-unknown");
      if (!response.ok) return refusedAnswer(response, { modality: MODALITY, label: "image generation", signal, timeoutMs: remaining(), secrets });

      let answer;
      try {
        answer = await readJsonObject(response, { signal, timeoutMs: remaining(), maxBytes: MAX_RESPONSE_BYTES, what: "image answer" });
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), MODALITY, "completed-unread");
        return withAcceptedJob(createErrorResult(error?.status ?? HTTP_STATUS.BAD_GATEWAY, error.message), MODALITY, "completed-unread");
      }
      const data = normalizeItems(answer.data, request.response_format);
      if (data.length === 0) {
        // A 2xx answer may already be billed even without a usable image.
        return withAcceptedJob(
          createErrorResult(HTTP_STATUS.BAD_GATEWAY, `deAPI returned no usable image${request.response_format ? ` in response_format ${request.response_format}` : ""}`),
          MODALITY,
          "completed-unusable"
        );
      }
      const payload = { created: Number.isInteger(answer.created) ? answer.created : Math.floor(Date.now() / 1000), data };
      // Usage counts the images returned; deAPI balance charges are not converted to a cost.
      const accounting = mediaAccounting(answer, DEAPI_PROVIDER_ID, MODALITY);
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
