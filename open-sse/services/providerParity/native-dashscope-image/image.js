// DashScope native image generation: one synchronous JSON POST to an
// identity's fixed multimodal-generation endpoint with that identity's own
// Bearer key. Staged as guarded `generate` adapters for IMAGE_ADAPTERS, one per
// identity, and not registered.
//
// Source contract (OmniRoute c71f0065 alibabaImage.ts, attribution in
// ./config.js): the model must be in the identity's own allowlist, else 400
// "Unsupported <provider> image model"; key `apiKey || accessToken`, else 401;
// body { model, input: { messages: [{ role: "user", content: [...{ image },
// { text }] }] }, parameters? } with `parameters` holding size ("WxH" sent as
// "W*H"), n, then negative_prompt, prompt_extend, watermark, seed,
// enable_sequential, thinking_mode and color_palette when set; headers
// Authorization Bearer + Content-Type application/json; answer URLs from
// output.choices[].message.content[].image, none is a 502.
//
// Fork deviations, all refusals before anything is sent unless noted (the
// source forwards or drops these): a raw `parameters` object; unknown fields;
// an empty prompt; non-https or private-host input image URLs (data: URIs
// included); input images for a text-only model; a size that is not WxH/W*H;
// n, seed, booleans or color_palette of the wrong shape; response_format other
// than url; streaming; a model prefixed with another identity's id or alias; a
// connection whose region is not global-sg on the default (pinned) adapters;
// the regional adapters (`regional: true`) serve both source regions from the
// finite map in ./regions.js and refuse unknown regions and custom base URLs.
// Either way each key goes only to its identity's fixed host. After the
// send: redirects are refused; the submit is time bounded and follows the
// caller's signal; error text never quotes the upstream body or the key (only
// a vendor code of a safe shape); result URLs must be public https and are
// never fetched; a submit whose outcome is unknown carries `acceptedJob` and
// is never resent.
import { createErrorResult, parseRateLimitEvidence } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting, returnedImageUnits } from "../../../handlers/mediaAccounting.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { alibabaVideoResultUrl } from "../../alibabaVideo/job.js";
import { isBoolean, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  DASHSCOPE_BOOLEAN_PARAMETERS, DASHSCOPE_IMAGE_ERROR_MAX_BYTES, DASHSCOPE_IMAGE_IDENTITIES, DASHSCOPE_IMAGE_MAX_INPUT_IMAGES,
  DASHSCOPE_IMAGE_MAX_N, DASHSCOPE_IMAGE_MAX_PALETTE, DASHSCOPE_IMAGE_MAX_PROMPT_CHARS, DASHSCOPE_IMAGE_MAX_RESULTS,
  DASHSCOPE_IMAGE_MAX_SIDE, DASHSCOPE_IMAGE_MIN_SIDE, DASHSCOPE_IMAGE_RESPONSE_MAX_BYTES, DASHSCOPE_IMAGE_SUBMIT_TIMEOUT_MS,
  DASHSCOPE_IMAGE_PATH, DASHSCOPE_IMAGE_TOTAL_TIMEOUT_MS,
} from "./config.js";
import { boundedFetch, discard, isRedirect, offOrigin, provenUnsent, readText } from "./http.js";
import { DASHSCOPE_REGIONS, dashscopeMediaOrigin, resolveDashscopeConnectionRegion } from "./regions.js";

const MODALITY = "image";
const SIZE_RE = /^(\d{2,5})\s*[x*]\s*(\d{2,5})$/i;
const CODE_RE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
// accountFallback.js DASHSCOPE_UNPAID_CODES (OmniRoute DASHSCOPE_DEAD_ACCOUNT_RE).
const UNPAID_CODES = new Set(["arrearage", "accessdenied.unpurchased"]);
// alibabaProviderRegions.ts normalizeAlibabaProviderRegion spellings of global-sg.
const GLOBAL_REGION_NAMES = new Set(["global-sg", "global", "international", "singapore", "ap-southeast-1"]);
const IMAGE_FIELDS = ["image", "image_url", "imageUrls", "image_urls"];
const PARAMETER_FIELDS = ["negative_prompt", ...DASHSCOPE_BOOLEAN_PARAMETERS, "seed", "color_palette"];
const ALLOWED_FIELDS = new Set(["model", "prompt", "n", "size", "response_format", "user", "stream", ...IMAGE_FIELDS, ...PARAMETER_FIELDS]);
const USAGE_FIELDS = ["input_tokens", "output_tokens", "total_tokens", "image_count", "width", "height"];

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const present = (value) => value !== undefined && value !== null;
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const vendorCode = (value) => (isString(value) && CODE_RE.test(value) ? value : null);

/** The fixed image URL of an identity in a canonical region (./regions.js), or null. */
export function dashscopeImageUrl(providerId, region) {
  const origin = dashscopeMediaOrigin(providerId, region);
  return origin ? `${origin}${DASHSCOPE_IMAGE_PATH}` : null;
}

/** The identity record for a provider id, or null. */
export const dashscopeImageIdentity = (providerId) =>
  (Object.hasOwn(DASHSCOPE_IMAGE_IDENTITIES, providerId) ? DASHSCOPE_IMAGE_IDENTITIES[providerId] : null);

function requireIdentity(providerId) {
  const identity = dashscopeImageIdentity(providerId);
  if (!identity) throw new Error(`Unknown DashScope image identity: ${providerId}`);
  return identity;
}

/** Accounting for a submit DashScope may have run (and may bill) whose outcome is not known. */
export function dashscopeImageAcceptedJob(providerId, jobState = "submit-unknown") {
  return { ...mediaAccounting(null, providerId, MODALITY), costSource: "accepted-job", meta: { jobState } };
}

/** The selected connection's key: source `credentials.apiKey || credentials.accessToken`. */
export function resolveDashscopeImageCredential(credentials) {
  for (const value of [credentials?.apiKey, credentials?.accessToken]) {
    if (isString(value) && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Whether the connection belongs to the global-sg region these fixed hosts
 * serve. No region is the source default (global-sg); anything else is refused.
 */
export function isDashscopeImageRegionSupported(credentials) {
  const region = isRecord(credentials?.providerSpecificData) ? credentials.providerSpecificData.region : undefined;
  if (!present(region) || region === "") return true;
  return isString(region) && GLOBAL_REGION_NAMES.has(region.trim().toLowerCase());
}

/**
 * The upstream model id for an identity, or null. A prefix must be the
 * identity's own id or alias; the bare id must be in its own allowlist.
 */
export function resolveDashscopeImageModel(providerId, model) {
  const identity = dashscopeImageIdentity(providerId);
  if (!identity || !isString(model)) return null;
  let id = model.trim();
  const slash = id.indexOf("/");
  if (slash !== -1) {
    const prefix = id.slice(0, slash);
    if (prefix !== identity.id && prefix !== identity.alias) return null;
    id = id.slice(slash + 1);
  }
  return identity.models.find((entry) => entry.id === id) ?? null;
}

/** An https URL on a public literal host without userinfo, or null. Never fetched here. */
export const dashscopePublicUrl = (raw) => alibabaVideoResultUrl(isString(raw) ? raw.trim() : raw);

// collectImageUrls, strict: an unusable entry is refused, never skipped.
function inputImages(body) {
  const values = IMAGE_FIELDS.flatMap((field) => (Array.isArray(body[field]) ? body[field] : [body[field]])).filter(present);
  const urls = [];
  for (const value of values) {
    let raw = value;
    if (isRecord(value)) raw = present(value.url) ? value.url : value.image_url;
    const url = dashscopePublicUrl(raw);
    if (!url) throw reject("DashScope input images must be https URLs on a public host");
    if (!urls.includes(url)) urls.push(url);
  }
  if (urls.length > DASHSCOPE_IMAGE_MAX_INPUT_IMAGES) throw reject(`DashScope image generation takes at most ${DASHSCOPE_IMAGE_MAX_INPUT_IMAGES} input images here`);
  return urls;
}

function checkSize(size) {
  const match = isString(size) ? SIZE_RE.exec(size.trim()) : null;
  const sides = match ? [Number(match[1]), Number(match[2])] : [];
  if (!match || sides.some((side) => side < DASHSCOPE_IMAGE_MIN_SIDE || side > DASHSCOPE_IMAGE_MAX_SIDE)) {
    throw reject(`DashScope image size must be WIDTHxHEIGHT with sides from ${DASHSCOPE_IMAGE_MIN_SIDE} to ${DASHSCOPE_IMAGE_MAX_SIDE}`);
  }
  return `${sides[0]}*${sides[1]}`;
}

function checkPalette(value) {
  const entryOk = (entry) => isRecord(entry) && Object.keys(entry).length > 0 &&
    Object.values(entry).every((item) => (isString(item) && item.length <= 64) || (isNumber(item) && Number.isFinite(item)));
  if (!Array.isArray(value) || value.length === 0 || value.length > DASHSCOPE_IMAGE_MAX_PALETTE || !value.every(entryOk)) {
    throw reject(`DashScope color_palette must be a list of 1 to ${DASHSCOPE_IMAGE_MAX_PALETTE} objects of strings or numbers`);
  }
  return value.map((entry) => ({ ...entry }));
}

// The source's `parameters`, in its order, without the raw `parameters` copy.
function buildParameters(body) {
  const parameters = {};
  if (present(body.size)) parameters.size = checkSize(body.size);
  if (present(body.n)) {
    if (!Number.isInteger(body.n) || body.n < 1 || body.n > DASHSCOPE_IMAGE_MAX_N) throw reject(`DashScope image generation takes n from 1 to ${DASHSCOPE_IMAGE_MAX_N}`);
    parameters.n = body.n;
  }
  if (present(body.negative_prompt)) {
    if (!isString(body.negative_prompt) || body.negative_prompt.length > DASHSCOPE_IMAGE_MAX_PROMPT_CHARS) throw reject("DashScope negative_prompt must be a string");
    if (body.negative_prompt.trim()) parameters.negative_prompt = body.negative_prompt.trim();
  }
  for (const field of DASHSCOPE_BOOLEAN_PARAMETERS.slice(0, 2)) {
    if (!present(body[field])) continue;
    if (!isBoolean(body[field])) throw reject(`DashScope ${field} must be true or false`);
    parameters[field] = body[field];
  }
  if (present(body.seed)) {
    if (!count(body.seed)) throw reject("DashScope seed must be a non-negative integer");
    parameters.seed = body.seed;
  }
  for (const field of DASHSCOPE_BOOLEAN_PARAMETERS.slice(2)) {
    if (!present(body[field])) continue;
    if (!isBoolean(body[field])) throw reject(`DashScope ${field} must be true or false`);
    parameters[field] = body[field];
  }
  if (present(body.color_palette)) parameters.color_palette = checkPalette(body.color_palette);
  return parameters;
}

/**
 * The exact DashScope request body for an OpenAI-style image request on one
 * identity. Throws a 400 error for anything this subset refuses.
 */
export function buildDashscopeImageRequest(providerId, model, body) {
  const identity = requireIdentity(providerId);
  const entry = resolveDashscopeImageModel(providerId, model);
  if (!entry) throw reject(`Unsupported ${identity.id} image model: ${isString(model) ? model.slice(0, 120) : "(none)"}`);
  if (!isRecord(body)) throw reject("DashScope image generation needs a JSON object");
  if (present(body.parameters)) throw reject("DashScope image parameters are set from named fields; a raw parameters object is not supported");
  for (const [key, value] of Object.entries(body)) {
    if (present(value) && !ALLOWED_FIELDS.has(key)) throw reject(`DashScope image generation does not support ${key}`);
  }
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject(`Prompt is required for ${identity.id} image generation`);
  if (body.prompt.length > DASHSCOPE_IMAGE_MAX_PROMPT_CHARS) throw reject(`DashScope image prompts must not exceed ${DASHSCOPE_IMAGE_MAX_PROMPT_CHARS} characters`);
  if (present(body.stream) && body.stream !== false) throw reject("DashScope image generation does not support streaming");
  if (present(body.response_format) && body.response_format !== "url") throw reject("DashScope image generation returns URLs only; response_format must be url");

  const images = inputImages(body);
  if (images.length && !entry.inputModalities.includes("image")) throw reject(`${entry.id} does not take input images`);
  const content = images.map((image) => ({ image }));
  content.push({ text: body.prompt.trim() });
  const request = { model: entry.id, input: { messages: [{ role: "user", content }] } };
  const parameters = buildParameters(body);
  if (Object.keys(parameters).length > 0) request.parameters = parameters;
  return request;
}

/** getAlibabaImageUrls, kept to public https URLs. Returns `{ items, unsafe }`. */
export function normalizeDashscopeImageItems(answer) {
  const choices = Array.isArray(answer?.output?.choices) ? answer.output.choices : [];
  const items = [];
  const seen = new Set();
  let unsafe = 0;
  for (const choice of choices.slice(0, DASHSCOPE_IMAGE_MAX_RESULTS * 2)) {
    const parts = Array.isArray(choice?.message?.content) ? choice.message.content : [];
    for (const part of parts.slice(0, DASHSCOPE_IMAGE_MAX_RESULTS * 2)) {
      if (!isRecord(part) || !isString(part.image) || !part.image.trim()) continue;
      const url = dashscopePublicUrl(part.image);
      if (!url) unsafe += 1;
      else if (!seen.has(url) && items.length < DASHSCOPE_IMAGE_MAX_RESULTS) {
        seen.add(url);
        items.push({ url });
      }
    }
  }
  return { items, unsafe };
}

/**
 * Usage recorded once per success: token counts (if DashScope reported any) as
 * tokens, the numeric receipt in meta, native units from returned images.
 */
export function dashscopeImageAccounting(providerId, answer, payload) {
  const usage = isRecord(answer?.usage) ? answer.usage : null;
  const receipt = {};
  for (const field of USAGE_FIELDS) if (usage && count(usage[field])) receipt[field] = usage[field];
  const tokens = {};
  for (const field of USAGE_FIELDS.slice(0, 3)) if (present(receipt[field])) tokens[field] = receipt[field];
  const accounting = mediaAccounting(Object.keys(tokens).length ? { usage: tokens } : null, providerId, MODALITY);
  if (Object.keys(receipt).length) accounting.meta.providerUsage = { path: "usage", value: receipt };
  if (present(receipt.image_count)) accounting.meta.providerImageCount = receipt.image_count;
  if (isString(answer?.request_id) && REQUEST_ID_RE.test(answer.request_id)) accounting.meta.providerRequestId = answer.request_id;
  returnedImageUnits(accounting, payload);
  return accounting;
}

async function refusedAnswer(identity, response, { signal, timeoutMs, secrets }) {
  const { status } = response;
  const retryAfter = response.headers.get("retry-after") ?? "";
  let code = null;
  try {
    const body = JSON.parse(await readText(response, { signal, timeoutMs, maxBytes: DASHSCOPE_IMAGE_ERROR_MAX_BYTES }));
    code = vendorCode(body?.code) ?? vendorCode(body?.error?.code);
  } catch {
    discard(response);
  }
  const suffix = code ? ` (${code})` : "";
  const fail = (passed, message) => createErrorResult(passed, `${identity.id} ${message}${suffix}`, undefined, undefined, null, secrets);
  if (status >= 500) {
    const failed = fail(HTTP_STATUS.BAD_GATEWAY, `image generation failed with ${status}; whether it ran is unknown`);
    return { ...failed, acceptedJob: dashscopeImageAcceptedJob(identity.id, "submit-unknown") };
  }
  if (status === 402 || ((status === 400 || status === 403) && code && UNPAID_CODES.has(code.toLowerCase()))) {
    // Unpaid or unpurchased: stays true until the owner pays, on this connection only.
    return { ...fail(HTTP_STATUS.PAYMENT_REQUIRED, "refused image generation for this account"), quotaExhausted: true };
  }
  if (status === 401 || status === 403) return fail(status, "rejected the API key for image generation");
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, `${identity.id} rate limited image generation${suffix}`, usable?.resetAtMs, undefined, usable, secrets);
  }
  if (status === 404) return fail(HTTP_STATUS.NOT_FOUND, "does not serve this image model");
  return fail(status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY, `refused the image request with ${status}`);
}

/**
 * @param {string} providerId - one of DASHSCOPE_IMAGE_PROVIDER_IDS
 * @param {object} [options] - test seams and bounds: { fetchImpl, submitTimeoutMs, timeoutMs, now },
 *   and `regional`: true resolves the connection's region (./regions.js) to that
 *   identity's fixed regional host instead of accepting global-sg only
 */
export function createDashscopeImageAdapter(providerId, options = {}) {
  const identity = requireIdentity(providerId);
  const {
    fetchImpl = (...args) => globalThis.fetch(...args),
    submitTimeoutMs = DASHSCOPE_IMAGE_SUBMIT_TIMEOUT_MS,
    timeoutMs = DASHSCOPE_IMAGE_TOTAL_TIMEOUT_MS,
    now = Date.now,
    regional = false,
  } = options;
  const label = identity.id;
  const aborted = () => createErrorResult(499, `${label} image request aborted`);
  const acceptedJob = (result, jobState) => ({ ...result, acceptedJob: dashscopeImageAcceptedJob(label, jobState) });

  return {
    provider: identity.id,
    aliases: Object.freeze([identity.alias]),
    format: identity.format,
    url: identity.url,
    models: identity.models,
    supportedSizes: identity.supportedSizes,
    responseFormats: Object.freeze(["url"]),
    regions: Object.freeze(regional ? [...DASHSCOPE_REGIONS] : ["global-sg"]),
    /**
     * Generate images on this identity's connection.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ url }] }`, or an error result that carries
     * `acceptedJob` when DashScope may have run the request
     */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      try {
        request = buildDashscopeImageRequest(label, model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const key = resolveDashscopeImageCredential(credentials);
      if (!key) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, `${label} API key is required`);
      let target = { region: "global-sg", origin: identity.origin, url: identity.url };
      if (regional) {
        const bound = resolveDashscopeConnectionRegion(label, credentials);
        if (bound.error) return createErrorResult(HTTP_STATUS.BAD_REQUEST, `${label} image connection ${bound.error}`);
        target = { region: bound.region, origin: bound.origin, url: dashscopeImageUrl(label, bound.region) };
      } else if (!isDashscopeImageRegionSupported(credentials)) {
        return createErrorResult(HTTP_STATUS.BAD_REQUEST, `${label} image generation is staged for the global-sg region only`);
      }
      if (signal?.aborted) return aborted();
      const secrets = { apiKey: key, accessToken: credentials?.accessToken };
      const deadline = now() + timeoutMs;
      const init = {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(request),
        redirect: "manual",
        proxyOptions: resolveCredentialProxyOptions(credentials),
      };
      log?.info?.("IMAGE", `${label}/${request.model} (${identity.format}, ${target.region})`);

      let response;
      try {
        response = await boundedFetch(fetchImpl, target.url, init, { signal, timeoutMs: Math.min(submitTimeoutMs, timeoutMs) });
      } catch (error) {
        const unsent = provenUnsent(error);
        if (signal?.aborted || error?.name === "AbortError") return unsent ? aborted() : acceptedJob(aborted(), "submit-unknown");
        if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${label} image request could not connect`);
        const timedOut = error?.name === "TimeoutError";
        return acceptedJob(createErrorResult(
          timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
          `${label} image request ${timedOut ? "timed out" : "was interrupted"}; whether it ran is unknown`,
        ), "submit-unknown");
      }
      if (isRedirect(response)) {
        // Never followed: the Bearer key stays on the fixed origin.
        discard(response);
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${label} image request redirect refused`);
      }
      if (offOrigin(response, target.origin)) {
        discard(response);
        return acceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${label} image request was answered by another origin`), "submit-unknown");
      }
      if (!response.ok) return refusedAnswer(identity, response, { signal, timeoutMs: Math.max(1, deadline - now()), secrets });

      let answer;
      try {
        answer = JSON.parse(await readText(response, { signal, timeoutMs: Math.max(1, deadline - now()), maxBytes: DASHSCOPE_IMAGE_RESPONSE_MAX_BYTES }));
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") return acceptedJob(aborted(), "accepted");
        return acceptedJob(createErrorResult(
          error?.name === "TimeoutError" ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
          `${label} returned an unreadable image response`,
        ), "accepted");
      }
      const { items, unsafe } = normalizeDashscopeImageItems(answer);
      if (items.length === 0) {
        return acceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${label} image generation returned ${unsafe ? "no safe" : "no"} images`), "accepted");
      }
      const payload = { created: Math.floor(now() / 1000), data: items };
      const accounting = dashscopeImageAccounting(label, answer, payload);
      if (regional) accounting.meta.region = target.region;
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
