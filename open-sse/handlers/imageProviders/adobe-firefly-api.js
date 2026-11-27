// Adobe Firefly Services API image generation: async submit + bounded poll,
// registered in IMAGE_ADAPTERS. See docs/providers/adobe-firefly-api.md.
//
// Written from Adobe's published contract, AdobeDocs/ffs-firefly-api at
// 1027f559cdb1509a61b34e2f2da9618ec431f2cb (static/firefly-api.json,
// GenerateImagesRequestV3 and the `x-model-version` header of
// POST /v3/images/generate-async). No third-party code was ported.
//
// The image core calls buildUrl, then awaits buildBody, then calls buildHeaders
// synchronously. The IMS token is therefore resolved in buildBody, from the
// credentials buildUrl saw for this same call (keyed by the per-call options
// object), and handed to buildHeaders through the request body object. The
// token is never put into the body or the connection.
import { nowSec } from "./_base.js";
import {
  ADOBE_FIREFLY_API_MODEL_IDS,
  ADOBE_FIREFLY_GENERATE_URL,
} from "../../providers/registry/adobe-firefly-api.js";
import { defaultAdobeTokenCache, refreshAdobeFireflyToken, resolveAdobeFireflyAuth } from "../../services/adobeFireflyApi/auth.js";
import {
  ADOBE_FIREFLY_MAX_IMAGES,
  ADOBE_FIREFLY_REQUEST_TIMEOUT_MS,
  awaitAdobeFireflyImages,
} from "../../services/adobeFireflyApi/job.js";
import { describeAdobeFireflySubmitRefusal } from "../../services/adobeFireflyApi/refusal.js";
import { isNumber, isRecord, isString } from "../../../src/shared/utils/typeChecks.js";

const MODELS = new Set(ADOBE_FIREFLY_API_MODEL_IDS);
const MAX_PROMPT_LENGTH = 1024;
const CONTENT_CLASSES = new Set(["photo", "art"]);
const INPUT_FIELDS = [
  "image", "images", "image_url", "image_urls", "imageUrls", "reference_images", "mask", "style", "structure",
];

const reject = (message, status = 400) => Object.assign(new Error(message), { status });

function variations(n) {
  const count = isNumber(n) && Number.isFinite(n) ? Math.round(n) : 1;
  return Math.min(Math.max(count, 1), ADOBE_FIREFLY_MAX_IMAGES);
}

// An OpenAI-style "WxH" within the documented 1..4096 bounds; otherwise unset,
// so Adobe applies its default. Adobe decides which sizes a model accepts.
function size(value) {
  const match = isString(value) ? /^(\d{1,4})\s*[x×]\s*(\d{1,4})$/i.exec(value.trim()) : null;
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width >= 1 && width <= 4096 && height >= 1 && height <= 4096 ? { width, height } : undefined;
}

function optionalText(value, label) {
  if (value == null || value === "") return undefined;
  if (!isString(value) || value.length > MAX_PROMPT_LENGTH) throw reject(`Adobe Firefly ${label} must be text of at most ${MAX_PROMPT_LENGTH} characters`);
  return value;
}

/**
 * @param {object} [options]
 * @param {object} [options.cache] - IMS token cache; one per process by default
 * @param {object} [options.polling] - poll bounds and clock, for tests; see awaitAdobeFireflyImages
 * @param {function} [options.now] - clock for pasted-token expiry checks
 * @param {number} [options.submitTimeoutMs] - submit bound, for tests
 */
export function createAdobeFireflyApiImageAdapter({
  cache = defaultAdobeTokenCache,
  polling = {},
  now = Date.now,
  submitTimeoutMs = ADOBE_FIREFLY_REQUEST_TIMEOUT_MS,
} = {}) {
  const callCredentials = new WeakMap();
  const requestAuth = new WeakMap();

  return {
    async: true,
    // Submit policy read by imageGenerationCore: a redirect is refused before
    // anything is forwarded, never followed with the token; the submit is
    // bounded and torn down on deadline or caller abort; a transport failure
    // after dispatch is a possibly billed job, so no other account resubmits
    // it; a refused submit's Retry-After reaches account cooldown.
    submitRedirect: "manual",
    submitTimeoutMs,
    submitOutcomeUnknown: true,
    retryAfterResets: true,
    // Read by imageGenerationCore before dispatch: pre-signed URLs only, never
    // downloaded into b64_json or binary output.
    responseFormats: ["url"],
    // A submit 401 drops the token it carried. With `retry`, one new token is
    // minted (client-credentials mode only) so the core may resend the refused,
    // never accepted submit once. The token stays in the in-memory cache only.
    onSubmitAuthRejected: async ({ status, credentials, requestBody, signal, retry }) => {
      const auth = requestAuth.get(requestBody);
      if (!auth || status !== 401) return false;
      return refreshAdobeFireflyToken(auth, { cache, credentials, signal, retry });
    },
    // A refused submit is described from its status and Adobe's documented
    // `x-access-error` / `x-access-rate-limit-level` / `retry-after` headers
    // only; the body is never repeated. A `quota_exhausted` 403 is flagged as
    // resetless quota for the selected connection; other 403s stay ordinary.
    describeSubmitError: (response) => describeAdobeFireflySubmitRefusal(response, "image"),
    // The temporary token is redacted from error text like stored credentials.
    submitSecrets: (requestBody) => {
      const auth = requestAuth.get(requestBody);
      return auth ? { accessToken: auth.token } : null;
    },
    buildUrl: (model, credentials, _body, options) => {
      if (!MODELS.has(model)) throw reject("Unsupported Adobe Firefly Services image model");
      if (isRecord(options)) callCredentials.set(options, credentials);
      return ADOBE_FIREFLY_GENERATE_URL;
    },
    buildBody: async (model, body, options) => {
      if (!MODELS.has(model)) throw reject("Unsupported Adobe Firefly Services image model");
      if (!isString(body.prompt) || !body.prompt.trim()) throw reject("Adobe Firefly needs a text prompt");
      if (body.prompt.length > MAX_PROMPT_LENGTH) throw reject(`Adobe Firefly prompts are limited to ${MAX_PROMPT_LENGTH} characters`);
      if (INPUT_FIELDS.some((field) => body[field] != null && body[field].length !== 0)) {
        throw reject("Adobe Firefly reference images, styles and structure references are not supported yet");
      }
      const contentClass = body.contentClass ?? body.content_class;
      if (contentClass != null && !CONTENT_CLASSES.has(contentClass)) throw reject("Adobe Firefly contentClass must be photo or art");
      const requestBody = {
        prompt: body.prompt,
        numVariations: variations(body.n),
        size: size(body.size),
        contentClass: contentClass ?? undefined,
        negativePrompt: optionalText(body.negativePrompt ?? body.negative_prompt, "negativePrompt"),
      };

      const credentials = options && callCredentials.get(options);
      if (!credentials) throw reject("Adobe Firefly Services needs a connection credential", 401);
      requestAuth.set(requestBody, await resolveAdobeFireflyAuth(credentials, { cache, signal: options.signal, now }));
      return requestBody;
    },
    buildHeaders: (_credentials, requestBody, model) => {
      const auth = requestAuth.get(requestBody);
      if (!auth) throw reject("Adobe Firefly Services needs a connection credential", 401);
      return {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${auth.token}`,
        "x-api-key": auth.clientId,
        "x-model-version": model,
      };
    },
    parseResponse: async (response, { credentials, signal, requestBody }) => ({
      urls: await awaitAdobeFireflyImages(response, {
        ...polling,
        cache,
        auth: requestAuth.get(requestBody),
        credentials,
        count: requestBody.numVariations,
        signal,
      }),
    }),
    // Pre-signed URLs are returned as given and never fetched with credentials.
    normalize: ({ urls }) => ({ created: nowSec(), data: urls.map((url) => ({ url })) }),
  };
}

export default createAdobeFireflyApiImageAdapter();
