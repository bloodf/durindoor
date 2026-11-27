// Adobe Firefly Services API image generation: async submit + bounded poll.
// STAGED: not in IMAGE_ADAPTERS, so no route reaches it. See
// docs/providers/adobe-firefly-api.md.
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
} from "../../providers/private/adobe-firefly-api.js";
import { defaultAdobeTokenCache, resolveAdobeFireflyAuth } from "../../services/adobeFireflyApi/auth.js";
import { ADOBE_FIREFLY_MAX_IMAGES, awaitAdobeFireflyImages } from "../../services/adobeFireflyApi/job.js";
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
 */
export function createAdobeFireflyApiImageAdapter({ cache = defaultAdobeTokenCache, polling = {}, now = Date.now } = {}) {
  const callCredentials = new WeakMap();
  const requestAuth = new WeakMap();

  return {
    async: true,
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
