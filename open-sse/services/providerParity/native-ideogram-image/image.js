// Ideogram native image generation: one synchronous POST per image to the
// documented operation for the model (V_2A: https://api.ideogram.ai/generate
// with a JSON `image_request` envelope; V_3:
// https://api.ideogram.ai/v1/ideogram-v3/generate as multipart/form-data),
// then a guarded download of the returned URL. Staged for /v1/images/generations as a guarded `generate` adapter and
// not registered (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/imageRegistryData.ts (`ideogram`, format "ideogram-image"),
// open-sse/handlers/imageGeneration.ts (format dispatch) and
// handlers/imageGeneration/providers/ideogram.ts handleIdeogramImageGeneration:
// headers `Content-Type: application/json` and `Api-Key: <apiKey>`, body
// `{ prompt, aspect_ratio: "ASPECT_16_9", model: model || "V_3" }`, answer
// `data[0].url` downloaded through downloadUpstreamMedia and returned as
// `{ created, data: [{ b64_json }] }`; an answer without images is a 502.
// handlers/imageGeneration/fanOut.ts lists "ideogram-image" in
// SINGLE_IMAGE_FANOUT_FORMATS: `n` becomes n independent single-image calls,
// all-or-nothing, stopping at the first failure.
//
// Fork deviations: the key goes only to the fixed Ideogram origin; every call
// is time bounded (per call and for the whole request), aborts on the
// caller's signal and refuses redirects; the answer is size bounded and the
// upstream body is never quoted in an error; the model must be V_3 or V_2A;
// since the wire aspect ratio is fixed at 16:9, only size 1792x1024 (or none)
// is accepted; fields the source dropped silently (reference images, masks,
// style, quality, seed, negative prompt, output format) are refused, as are
// streaming and url/binary output; `n` above 10 is refused instead of clamped;
// fan-out calls run one after another; the result URL must be public https and
// is fetched with the local pinned-IP, manual-redirect, magic-byte-checked
// image fetch; a send whose outcome is unknown, and any earlier completed
// fan-out call, carries `acceptedJob` and is never resent.
//
// Wire correction (#2034, checked 2026-11-27 against Ideogram's official API
// v1 OpenAPI spec, see ./config.js): the source's flat `/generate` body does
// not match the documented GenerateImageRequest, which requires the fields
// inside `image_request`, and `/generate` does not list V_3. V_2A is sent as
// `{ image_request: { prompt, aspect_ratio: "ASPECT_16_9", model: "V_2A" } }`
// to /generate; V_3 is sent as form fields `prompt` and `aspect_ratio=16x9`
// to /v1/ideogram-v3/generate, which takes no model field.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { MAX_IMAGE_BYTES } from "../../../config/mediaConfig.js";
import { mediaAccounting, returnedImageUnits } from "../../../handlers/mediaAccounting.js";
import { fetchImageAsBase64, parseDataUri } from "../../../translator/concerns/image.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  IDEOGRAM_ASPECT_RATIO, IDEOGRAM_CALL_TIMEOUT_MS, IDEOGRAM_DEFAULT_MODEL, IDEOGRAM_IMAGE_FORMAT,
  IDEOGRAM_IMAGE_MAX_N, IDEOGRAM_IMAGE_MODELS, IDEOGRAM_IMAGE_SIZES, IDEOGRAM_PROVIDER_ID,
  IDEOGRAM_RESPONSE_FORMATS, IDEOGRAM_TOTAL_TIMEOUT_MS, IDEOGRAM_V3_ASPECT_RATIO, IDEOGRAM_WIRE_V3_MULTIPART,
  ideogramImageModel,
} from "./config.js";
import {
  boundedFetch, ideogramHeaders, ideogramPublicUrl, ideogramSecrets, ideogramToken, provenUnsent,
  readJsonObject, redirectState, refusedAnswer, withAcceptedJob,
} from "./http.js";

const MODALITY = "image";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_PROMPT_CHARS = 32_000;
const ASPECT_ALIASES = new Set(["16:9", IDEOGRAM_ASPECT_RATIO, IDEOGRAM_V3_ASPECT_RATIO]);
// Reference-image and edit fields: the source never forwarded them, so
// accepting them would silently generate from the prompt alone.
const IMAGE_INPUT_FIELDS = ["image", "image_url", "imageUrls", "image_urls", "images", "mask", "mask_url", "input_image"];
// Output controls the source dropped silently; the result would not honor them.
const DROPPED_FIELDS = [
  "quality", "style", "style_type", "seed", "negative_prompt", "magic_prompt_option", "color_palette",
  "output_format", "output_compression", "background", "resolution",
];

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const abortedResult = () => createErrorResult(499, "Ideogram image request aborted");
const present = (value) => value !== undefined && value !== null;

function hasChatImagePart(messages) {
  if (!Array.isArray(messages)) return false;
  return messages.some((message) => Array.isArray(message?.content) && message.content.some((part) => part?.type === "image_url"));
}

/**
 * Validate an OpenAI-style image request and build the documented Ideogram
 * request for the model. Throws a 400 error for an unknown model or an input
 * this subset cannot honor.
 *
 * @returns {{
 *   request: { url: string, wire: string, fields: object },
 *   count: number,
 * }} `fields` is the JSON body (`{ image_request }`) for /generate, or the
 *   form fields (`{ prompt, aspect_ratio }`) for /v1/ideogram-v3/generate
 */
export function buildIdeogramImageRequest(model, body) {
  const modelId = model || IDEOGRAM_DEFAULT_MODEL;
  const entry = ideogramImageModel(modelId);
  if (!entry) {
    throw reject(`Unsupported Ideogram image model: ${modelId}. Use one of: ${IDEOGRAM_IMAGE_MODELS.map((m) => m.id).join(", ")}`);
  }
  if (!isRecord(body)) throw reject("Ideogram image generation needs a JSON object");
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("Ideogram image generation needs a text prompt");
  if (body.prompt.length > MAX_PROMPT_CHARS) throw reject(`Ideogram image prompts must not exceed ${MAX_PROMPT_CHARS} characters`);
  if (body.stream) throw reject("Ideogram image generation does not support streaming");
  const input = IMAGE_INPUT_FIELDS.find((field) => present(body[field]));
  if (input || hasChatImagePart(body.messages)) {
    throw reject(`Ideogram image generation is text-to-image only here; ${input ?? "image_url parts"} is not supported`);
  }
  const dropped = DROPPED_FIELDS.find((field) => present(body[field]));
  if (dropped) throw reject(`Ideogram image generation does not support ${dropped} here`);
  if (present(body.n) && !(Number.isInteger(body.n) && body.n >= 1 && body.n <= IDEOGRAM_IMAGE_MAX_N)) {
    throw reject(`n must be an integer from 1 to ${IDEOGRAM_IMAGE_MAX_N}`);
  }
  if (present(body.size) && !IDEOGRAM_IMAGE_SIZES.includes(body.size)) {
    throw reject(`Ideogram image size must be one of: ${IDEOGRAM_IMAGE_SIZES.join(", ")} (the request is always sent as 16:9)`);
  }
  if (present(body.aspect_ratio) && !ASPECT_ALIASES.has(body.aspect_ratio)) {
    throw reject("Ideogram image aspect_ratio must be 16:9");
  }
  if (present(body.response_format) && !IDEOGRAM_RESPONSE_FORMATS.includes(body.response_format)) {
    throw reject(`Ideogram image supports response_format ${IDEOGRAM_RESPONSE_FORMATS.join(", ")} only`);
  }
  const fields = entry.wire === IDEOGRAM_WIRE_V3_MULTIPART
    ? { prompt: body.prompt, aspect_ratio: IDEOGRAM_V3_ASPECT_RATIO }
    : { image_request: { prompt: body.prompt, aspect_ratio: IDEOGRAM_ASPECT_RATIO, model: modelId } };
  return {
    request: { url: entry.url, wire: entry.wire, fields },
    count: present(body.n) ? body.n : 1,
  };
}

/** The fetch body and headers for one call. A fresh body is built per call. */
export function encodeIdeogramImageRequest(request, token) {
  if (request.wire === IDEOGRAM_WIRE_V3_MULTIPART) {
    const form = new FormData();
    for (const [name, value] of Object.entries(request.fields)) form.append(name, value);
    return { body: form, headers: ideogramHeaders(token, { json: false }) };
  }
  return { body: JSON.stringify(request.fields), headers: ideogramHeaders(token) };
}

/**
 * @param {object} [options]
 * @param {number} [options.callTimeoutMs] - bound for one call: headers, body and result download
 * @param {number} [options.totalTimeoutMs] - bound for the whole request, across fanned-out calls
 * @param {(url: string, init: object) => Promise<Response>} [options.imageFetcher] - transport for the
 *   result download (kept behind the local SSRF guard); defaults to the global fetch
 * @param {() => number} [options.now] - clock, for tests
 */
export function createIdeogramImageAdapter({
  callTimeoutMs = IDEOGRAM_CALL_TIMEOUT_MS,
  totalTimeoutMs = IDEOGRAM_TOTAL_TIMEOUT_MS,
  imageFetcher = (target, init) => fetch(target, init),
  now = Date.now,
} = {}) {
  /** One upstream image call. Returns `{ b64 }` or an error result. */
  async function generateOne({ request, token, secrets, credentials, signal, remaining, log }) {
    let response;
    try {
      const { body, headers } = encodeIdeogramImageRequest(request, token);
      response = await boundedFetch(request.url, {
        method: "POST",
        headers,
        body,
        redirect: "manual",
        proxyOptions: resolveCredentialProxyOptions(credentials),
      }, { signal, timeoutMs: remaining() });
    } catch (error) {
      const unsent = provenUnsent(error);
      if (signal?.aborted || error?.name === "AbortError") return unsent ? abortedResult() : withAcceptedJob(abortedResult(), MODALITY, "submit-unknown");
      if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Ideogram image request could not connect");
      const timedOut = error?.name === "TimeoutError";
      return withAcceptedJob(createErrorResult(
        timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
        `Ideogram image request ${timedOut ? "timed out" : "was interrupted"}; whether it ran is unknown`
      ), MODALITY, "submit-unknown");
    }

    const redirect = redirectState(response);
    if (redirect?.refused) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Ideogram image request redirect refused");
    if (redirect?.foreign) return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Ideogram image request was redirected"), MODALITY, "submit-unknown");
    if (!response.ok) return refusedAnswer(response, { modality: MODALITY, label: "image generation", signal, timeoutMs: remaining(), secrets });

    let answer;
    try {
      answer = await readJsonObject(response, { signal, timeoutMs: remaining(), maxBytes: MAX_RESPONSE_BYTES, what: "image answer" });
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), MODALITY, "completed-unread");
      return withAcceptedJob(createErrorResult(error?.status ?? HTTP_STATUS.BAD_GATEWAY, error.message), MODALITY, "completed-unread");
    }
    // The source reads data[0].url only.
    const first = Array.isArray(answer.data) ? answer.data[0] : undefined;
    const url = isRecord(first) ? ideogramPublicUrl(first.url) : null;
    if (!url) {
      // A 2xx answer may already be billed even without a usable image.
      return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Ideogram returned no usable image"), MODALITY, "completed-unusable");
    }
    const image = await fetchImageAsBase64(url, { signal, timeoutMs: remaining(), maxBytes: MAX_IMAGE_BYTES, fetcher: imageFetcher });
    if (signal?.aborted) return withAcceptedJob(abortedResult(), MODALITY, "completed-unread");
    const b64 = image ? parseDataUri(image.url)?.base64 : null;
    if (!b64) {
      log?.debug?.("IDEOGRAM_IMAGE", "result download failed");
      return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Ideogram image could not be downloaded safely"), MODALITY, "completed-unread");
    }
    return { b64 };
  }

  return {
    provider: IDEOGRAM_PROVIDER_ID,
    format: IDEOGRAM_IMAGE_FORMAT,
    models: IDEOGRAM_IMAGE_MODELS,
    supportedSizes: IDEOGRAM_IMAGE_SIZES,
    responseFormats: IDEOGRAM_RESPONSE_FORMATS,
    defaultResponseFormat: "b64_json",
    /**
     * Generate `n` images for the selected connection, one call each.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ b64_json }] }`, or an error result that carries
     * `acceptedJob` when Ideogram may have run (and billed) any call
     */
    async generate({ model, body, credentials, signal, log }) {
      let built;
      try {
        built = buildIdeogramImageRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const token = ideogramToken(credentials);
      if (!token) return createErrorResult(401, "Ideogram API key is required");
      if (signal?.aborted) return abortedResult();
      const secrets = ideogramSecrets(credentials);
      const totalDeadline = now() + totalTimeoutMs;

      const data = [];
      for (let index = 0; index < built.count; index += 1) {
        if (index > 0 && (signal?.aborted || now() >= totalDeadline)) {
          const failed = signal?.aborted ? abortedResult() : createErrorResult(HTTP_STATUS.GATEWAY_TIMEOUT, "Ideogram image request ran out of time");
          return withAcceptedJob(failed, MODALITY, "partial-completed", { completedCalls: index, requestedCalls: built.count });
        }
        const callDeadline = Math.min(totalDeadline, now() + callTimeoutMs);
        const remaining = () => Math.max(1, callDeadline - now());
        const one = await generateOne({ request: built.request, token, secrets, credentials, signal, remaining, log });
        if (!one.b64) {
          if (index === 0) return one;
          // Earlier calls finished and were billed; all-or-nothing like the source, but never silent.
          const jobState = one.acceptedJob?.meta?.jobState ?? "partial-completed";
          return withAcceptedJob(one, MODALITY, jobState, { completedCalls: index, requestedCalls: built.count });
        }
        data.push({ b64_json: one.b64 });
      }

      const payload = { created: Math.floor(now() / 1000), data };
      const accounting = mediaAccounting(null, IDEOGRAM_PROVIDER_ID, MODALITY);
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
