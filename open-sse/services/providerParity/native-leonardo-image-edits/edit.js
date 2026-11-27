// Leonardo native reference-image edit: init-image ticket, token-free storage
// upload, then the ordinary image generation with `init_image_id` and the
// source init strength, polled to its result. Staged for /v1/images/edits and
// not registered (see ./registration.json). Source attribution: ./config.js.
//
// Phases and what a failure in each means:
//   init-image  POST {api}/init-image with the selected key. Not billable; a
//               failure here carries no acceptedJob.
//   storage     POST of the pre-encoded form to the validated presigned URL,
//               without the key. Not billable; no acceptedJob.
//   generation  runLeonardoJob (read-only reuse): an uncertain submit or an
//               accepted job not seen to fail carries acceptedJob and is
//               never resent.
// Nothing is retried across phases and nothing is shared between calls.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting, returnedImageUnits } from "../../../handlers/mediaAccounting.js";
import { sleep } from "../../../handlers/imageProviders/_base.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { shouldUseProxyAwareTransport } from "../../../utils/proxyFetch.js";
import {
  LEONARDO_IMAGE_MODELS, LEONARDO_IMAGE_SIZES, LEONARDO_IMAGE_SUBMIT_URL, LEONARDO_JOB_TIMEOUT_MS, LEONARDO_PROVIDER_ID,
} from "../native-leonardo-video-image/config.js";
import {
  boundedFetch, leonardoSecrets, leonardoSubmitHeaders, leonardoToken, readJsonObject, redirectState, refusedAnswer,
} from "../native-leonardo-video-image/http.js";
import { leonardoImageResult } from "../native-leonardo-video-image/image.js";
import { runLeonardoJob } from "../native-leonardo-video-image/job.js";
import {
  LEONARDO_DNS_TIMEOUT_MS, LEONARDO_EDIT_INIT_STRENGTH, LEONARDO_INIT_IMAGE_URL, LEONARDO_INIT_TIMEOUT_MS,
  LEONARDO_STORAGE_TIMEOUT_MS,
} from "./config.js";
import { parseLeonardoEditRequest } from "./request.js";
import { encodeLeonardoStorageForm, parseLeonardoUploadTicket, uploadLeonardoInitImage } from "./storage.js";

const MODALITY = "image";
const LABEL = "image edit";
const RESPONSE_FORMATS = Object.freeze(["url"]);
const MAX_JSON_BYTES = 64 * 1024;
const JOB_OPTIONS = ["submitTimeoutMs", "requestTimeoutMs", "pollIntervalMs", "maxPolls", "wait", "now"];

const phased = (result, phase) => ({ ...result, phase });

/** The source generation body for an edit: the request plus the uploaded init image. */
export function buildLeonardoEditGeneration(generation, initImageId) {
  return { ...generation, init_image_id: initImageId, init_strength: LEONARDO_EDIT_INIT_STRENGTH };
}

// The connection proxy cannot carry the pinned, socket-checked storage upload.
function proxied(proxyOptions) {
  return shouldUseProxyAwareTransport(LEONARDO_INIT_IMAGE_URL, { ...proxyOptions, disableEnvProxy: true });
}

async function requestTicket({ token, extension, proxyOptions, signal, timeoutMs, secrets, log }) {
  const fail = (status, message) => phased(createErrorResult(status, message, undefined, undefined, null, secrets), "init-image");
  let response;
  try {
    response = await boundedFetch(LEONARDO_INIT_IMAGE_URL, {
      method: "POST",
      headers: leonardoSubmitHeaders(token),
      body: JSON.stringify({ extension }),
      redirect: "manual",
      proxyOptions,
    }, { signal, timeoutMs });
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return { failed: fail(499, `Leonardo ${LABEL} request aborted`) };
    if (error?.name === "TimeoutError") return { failed: fail(HTTP_STATUS.GATEWAY_TIMEOUT, "Leonardo init-image request timed out") };
    return { failed: fail(HTTP_STATUS.BAD_GATEWAY, "Leonardo init-image request failed to connect") };
  }
  if (redirectState(response)) {
    log?.debug?.("LEONARDO", "init-image redirect refused");
    return { failed: fail(HTTP_STATUS.BAD_GATEWAY, "Leonardo init-image request redirect refused") };
  }
  if (!response.ok) {
    if (response.status >= 500) {
      response.body?.cancel?.().catch(() => {});
      return { failed: fail(HTTP_STATUS.BAD_GATEWAY, `Leonardo init-image request failed with ${response.status}`) };
    }
    // An init image is not a billable generation: never an accepted job.
    const { acceptedJob: _ignored, ...refused } = await refusedAnswer(response, {
      modality: MODALITY, label: "init-image", signal, timeoutMs, secrets,
    });
    return { failed: phased(refused, "init-image") };
  }
  let answer;
  try {
    answer = await readJsonObject(response, { signal, timeoutMs, maxBytes: MAX_JSON_BYTES, what: "init-image answer" });
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return { failed: fail(499, `Leonardo ${LABEL} request aborted`) };
    return { failed: fail(Number(error?.status) === 504 ? 504 : HTTP_STATUS.BAD_GATEWAY, "Leonardo returned an unreadable init-image answer") };
  }
  try {
    return { ticket: parseLeonardoUploadTicket(answer) };
  } catch (error) {
    return { failed: fail(HTTP_STATUS.BAD_GATEWAY, error.message) };
  }
}

/**
 * @param {object} [options] - bounds and seams for tests: timeoutMs (whole
 * edit), initTimeoutMs, storageTimeoutMs, dnsTimeoutMs, storageFetch,
 * lookup, baseConnect, and the runLeonardoJob options submitTimeoutMs,
 * requestTimeoutMs, pollIntervalMs, maxPolls, wait, now
 */
export function createLeonardoImageEditAdapter(options = {}) {
  const {
    timeoutMs = LEONARDO_JOB_TIMEOUT_MS,
    initTimeoutMs = LEONARDO_INIT_TIMEOUT_MS,
    storageTimeoutMs = LEONARDO_STORAGE_TIMEOUT_MS,
    dnsTimeoutMs = LEONARDO_DNS_TIMEOUT_MS,
    storageFetch,
    lookup,
    baseConnect,
    now = Date.now,
    wait = sleep,
  } = options;
  const jobOptions = Object.fromEntries(JOB_OPTIONS.filter((key) => options[key] !== undefined).map((key) => [key, options[key]]));
  return {
    provider: LEONARDO_PROVIDER_ID,
    models: LEONARDO_IMAGE_MODELS,
    supportedSizes: LEONARDO_IMAGE_SIZES,
    responseFormats: RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    maxReferenceImages: 1,
    supportsMask: false,
    /**
     * Edit one reference image for the selected connection.
     *
     * @param {object} input
     * @param {string} input.model - catalog id or platform-model UUID
     * @param {FormData|null} [input.formData] - multipart edit request
     * @param {object|null} [input.jsonBody] - JSON edit request (data: URI reference)
     * @returns {Promise<object>} `{ success: true, response, accounting, initImageId, generationId }`
     * with `{ created, data: [{ url }] }`, or an error result with `phase`
     * ("request" | "init-image" | "storage" | "generation"); only the
     * generation phase may carry `acceptedJob`
     */
    async edit({ model, formData = null, jsonBody = null, credentials, signal, log }) {
      let parsed;
      try {
        parsed = await parseLeonardoEditRequest({ model, formData, jsonBody });
      } catch (error) {
        return phased(createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message), "request");
      }
      const token = leonardoToken(credentials);
      if (!token) return phased(createErrorResult(401, "Leonardo API key is required"), "request");
      const proxyOptions = resolveCredentialProxyOptions(credentials);
      if (proxied(proxyOptions)) {
        return phased(createErrorResult(HTTP_STATUS.BAD_REQUEST, "Leonardo image edits cannot send the reference upload through a connection proxy"), "request");
      }
      if (signal?.aborted) return phased(createErrorResult(499, `Leonardo ${LABEL} request aborted`), "request");
      const secrets = leonardoSecrets(credentials);
      const deadline = now() + timeoutMs;
      const remaining = () => Math.max(1, deadline - now());

      const { ticket, failed } = await requestTicket({
        token, extension: parsed.reference.extension, proxyOptions, signal,
        timeoutMs: Math.min(initTimeoutMs, remaining()), secrets, log,
      });
      if (failed) return failed;

      try {
        const form = await encodeLeonardoStorageForm(ticket.fields, parsed.reference);
        await uploadLeonardoInitImage({
          url: ticket.url, form, signal, timeoutMs: Math.min(storageTimeoutMs, remaining()), dnsTimeoutMs, storageFetch, lookup, baseConnect,
        });
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") return phased(createErrorResult(499, `Leonardo ${LABEL} request aborted`), "storage");
        const status = error?.storagePhase ? error.status : HTTP_STATUS.BAD_GATEWAY;
        const message = error?.storagePhase ? error.message : "Leonardo init-image upload failed";
        log?.debug?.("LEONARDO", `init-image upload failed (${status})`);
        return phased(createErrorResult(status, message, undefined, undefined, null, secrets), "storage");
      }

      const result = await runLeonardoJob({
        ...jobOptions,
        wait,
        now,
        timeoutMs: remaining(),
        modality: MODALITY,
        label: LABEL,
        submitUrl: LEONARDO_IMAGE_SUBMIT_URL,
        request: buildLeonardoEditGeneration(parsed.generation, ticket.id),
        jobField: "sdGenerationJob",
        extract: leonardoImageResult,
        credentials,
        signal,
        log,
      });
      if (!result.success) return phased(result, "generation");
      const payload = { created: Math.floor(Date.now() / 1000), data: [{ url: result.result }] };
      // Usage counts the one image returned; Leonardo credits are not converted to a cost.
      const accounting = mediaAccounting(null, LEONARDO_PROVIDER_ID, MODALITY);
      returnedImageUnits(accounting, payload);
      return {
        success: true,
        accounting,
        initImageId: ticket.id,
        generationId: result.generationId,
        response: new Response(JSON.stringify(payload), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }),
      };
    },
  };
}
