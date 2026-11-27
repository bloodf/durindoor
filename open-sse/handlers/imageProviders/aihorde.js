// AI Horde native text-to-image. Registered in IMAGE_ADAPTERS under the
// existing `aihorde` provider (alias `horde`): /v1/images/generations reaches
// it through the selected `aihorde` connection or the public no-auth
// credential. The `aihorde` chat route (OpenAI facade, Bearer sentinel) is a
// separate transport and is unchanged. See docs/providers/free-and-local.mdx.
//
// Ported from cheaper-inference/OmniRoute at
// c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT, Copyright (c) 2026 Cheaper
// Inference - Created by Diego Souza):
// open-sse/handlers/imageGeneration/providers/aihorde.ts and
// open-sse/handlers/imageGeneration/providers/aihordeMapRequest.ts.
//
// Contract: `.generate({ model, body, credentials, signal, log })`, the same
// guarded core path as adobe-firefly-web (imageGenerationCore), returns
// `{ success: true, response, accounting }` or an error result. An error after
// Horde may have taken the job carries `acceptedJob` (cost unknown) and is
// never resubmitted.
//
// Kept from the source: fixed `https://aihorde.net/api` origin, `apikey`
// header with the saved key or the anonymous `0000000000`, `Client-Agent`,
// the submit envelope, POST /v2/generate/async accepting 200/202 with an `id`,
// GET /v2/generate/check/{id} polling (1-8 s, a tenth of `wait_time`), an
// early 504 when `wait_time` exceeds the remaining budget, GET
// /v2/generate/status/{id} for results, DELETE /v2/generate/status/{id} as the
// cancel, a 600 s overall deadline, 30 s per API call and a 25 MiB image cap.
//
// Fork deviations, all refused with 400 before the catalog or submit:
// text-to-image only (no source image / img2img); only `model`, `prompt`, `n`,
// `size`, `response_format` and `user`; `n` is an integer 1-4 instead of being
// capped; `size` must be WIDTHxHEIGHT in multiples of 64 within 64-3072
// instead of being snapped; output is `b64_json` only (omitted means b64_json).
// A cold catalog that could not be fetched refuses with 503 instead of
// submitting unchecked. Result URLs are downloaded over https only, through
// the strict public-only guards, without any credential, redirects refused,
// and with a byte cap, MIME and magic-byte check.
import { createErrorResult } from "../../utils/error.js";
import { mediaAccounting } from "../mediaAccounting.js";
import { sniffImageFormat } from "../../utils/imageSniff.js";
import { fetchPublic } from "../../../src/shared/utils/ssrfGuard.js";
import { guardedProbeFetch } from "../../utils/outboundUrlGuard.js";
import { isNumber, isRecord, isString } from "../../../src/shared/utils/typeChecks.js";
import {
  AI_HORDE_ANONYMOUS_KEY,
  AI_HORDE_API_BASE,
  AI_HORDE_CLIENT_AGENT,
  aiHordeImageCatalog,
  readBoundedBody,
  readBoundedJson,
} from "../../services/catalogs/aihordeImageCatalog.js";

export const AI_HORDE_IMAGE_ID = "aihorde";
export const AI_HORDE_MAX_N = 4;
export const AI_HORDE_MIN_DIM = 64;
export const AI_HORDE_MAX_DIM = 3072;
export const AI_HORDE_DIM_STEP = 64;
export const AI_HORDE_DEFAULT_STEPS = 20;
export const AI_HORDE_GENERATE_TIMEOUT_MS = 600_000;
export const AI_HORDE_API_CALL_TIMEOUT_MS = 30_000;
export const AI_HORDE_CANCEL_TIMEOUT_MS = 30_000;
export const AI_HORDE_DOWNLOAD_TIMEOUT_MS = 60_000;
export const AI_HORDE_MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const POLL_MIN_MS = 1_000;
const POLL_MAX_MS = 8_000;
const MAX_API_BODY_BYTES = 1024 * 1024;
const ALLOWED_FIELDS = new Set(["model", "prompt", "n", "size", "response_format", "user"]);
const JOB_ID = /^[A-Za-z0-9-]{1,128}$/;
const IMAGE_MIME = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
// Definitive refusals keep their status; anything else is a bad gateway.
const KEPT_STATUS = new Set([400, 401, 403, 404, 429, 503]);

const refuse = (message) => ({ ...createErrorResult(400, message), outcome: "refused" });

class Stop extends Error {
  constructor(kind, message, status) {
    super(message);
    this.kind = kind;
    if (status) this.status = status;
  }
}

/** Strip an `aihorde/` or `horde/` prefix, as the source does. */
export function stripHordeModelPrefix(model) {
  const name = model.trim();
  const lower = name.toLowerCase();
  if (lower.startsWith("aihorde/")) return name.slice("aihorde/".length);
  if (lower.startsWith("horde/")) return name.slice("horde/".length);
  return name;
}

/**
 * Validate an OpenAI-style image body and build the Horde submit envelope.
 * Returns `{ error }` for anything this adapter does not implement.
 */
export function mapHordeImageRequest(model, body) {
  if (!isRecord(body)) return { error: "Request body must be an object" };
  const unsupported = Object.keys(body).filter((key) => !ALLOWED_FIELDS.has(key) && body[key] != null);
  if (unsupported.length) return { error: `AI Horde images do not support: ${unsupported.sort().join(", ")}` };
  const hordeModel = isString(model) ? stripHordeModelPrefix(model) : "";
  if (!hordeModel) return { error: "AI Horde images need a model" };
  if (!isString(body.prompt) || !body.prompt.trim()) return { error: "AI Horde images need a text prompt" };
  const n = body.n ?? 1;
  if (!Number.isInteger(n) || n < 1 || n > AI_HORDE_MAX_N) return { error: `n must be an integer from 1 to ${AI_HORDE_MAX_N}` };
  let width = 1024;
  let height = 1024;
  if (body.size != null) {
    const match = isString(body.size) ? /^(\d{2,4})x(\d{2,4})$/.exec(body.size.trim()) : null;
    const dims = match ? [Number(match[1]), Number(match[2])] : [];
    if (!match || !dims.every((d) => d >= AI_HORDE_MIN_DIM && d <= AI_HORDE_MAX_DIM && d % AI_HORDE_DIM_STEP === 0)) {
      return { error: `size must be WIDTHxHEIGHT, multiples of ${AI_HORDE_DIM_STEP} from ${AI_HORDE_MIN_DIM} to ${AI_HORDE_MAX_DIM}` };
    }
    [width, height] = dims;
  }
  const format = body.response_format ?? "b64_json";
  if (format !== "b64_json") return { error: "AI Horde images support response_format b64_json only" };
  return {
    model: hordeModel,
    n,
    payload: {
      prompt: body.prompt,
      models: [hordeModel],
      nsfw: false,
      censor_nsfw: true,
      r2: true,
      shared: false,
      validated_backends: true,
      slow_workers: true,
      allow_downgrade: true,
      params: { n, width, height, steps: AI_HORDE_DEFAULT_STEPS },
    },
  };
}

/** The selected connection's own key, else the anonymous sentinel. Nothing else is read. */
export function resolveHordeApiKey(credentials) {
  const raw = credentials?.apiKey;
  return isString(raw) && raw.trim() ? raw.trim() : AI_HORDE_ANONYMOUS_KEY;
}

const hordeHeaders = (apiKey) => ({
  apikey: apiKey,
  "Client-Agent": AI_HORDE_CLIENT_AGENT,
  Accept: "application/json",
  "Content-Type": "application/json",
});

const numeric = (value) => (isNumber(value) && Number.isFinite(value) ? value : null);

function hordeMessage(payload, fallback) {
  const message = isRecord(payload) && isString(payload.message) ? payload.message.trim() : "";
  return message ? `${fallback}: ${message.slice(0, 200)}` : fallback;
}

// Fixed origin; a redirect is answered, never followed with the key.
const defaultTransport = (url, init) => fetch(url, { ...init, redirect: "manual" });

/**
 * Download one result URL without any credential: https only, the strict
 * public-only URL and connection-time DNS guards, no redirects, a byte cap and
 * an image MIME / magic-byte check. Errors carry fixed messages only.
 */
export async function downloadHordeImage(url, { signal, maxBytes = AI_HORDE_MAX_IMAGE_BYTES, fetcher = fetch } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Stop("download", "AI Horde returned an invalid image URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Stop("download", "AI Horde returned an unsafe image URL");
  }
  let response;
  try {
    response = await fetchPublic(parsed.toString(), {
      method: "GET",
      headers: { Accept: "image/webp,image/png,image/jpeg" },
      signal,
    }, {
      maxRedirects: 0,
      fetchImpl: (target, init) => guardedProbeFetch(target, init, "public-only", fetcher),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Stop("download", "AI Horde image download was refused or failed");
  }
  if (response.status !== 200) {
    await response.body?.cancel?.().catch(() => {});
    throw new Stop("download", `AI Horde image download returned HTTP ${response.status}`);
  }
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type && type !== "application/octet-stream" && !Object.values(IMAGE_MIME).includes(type)) {
    await response.body?.cancel?.().catch(() => {});
    throw new Stop("download", "AI Horde image download is not a supported image type");
  }
  const bytes = await readBoundedBody(response, maxBytes);
  if (signal?.aborted) throw signal.reason;
  if (!bytes) throw new Stop("download", "AI Horde image download was too large or unreadable");
  return checkImageBytes(bytes);
}

function checkImageBytes(bytes) {
  if (bytes.length === 0) throw new Stop("download", "AI Horde returned an empty image");
  const format = sniffImageFormat(bytes);
  if (!IMAGE_MIME[format]) throw new Stop("download", "AI Horde returned bytes that are not a PNG, JPEG or WebP image");
  return { bytes, format };
}

function decodeInlineImage(value, maxBytes) {
  const text = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text) || Math.floor(text.length * 3 / 4) > maxBytes) {
    throw new Stop("download", "AI Horde returned an unreadable inline image");
  }
  return checkImageBytes(Buffer.from(text, "base64"));
}

/**
 * @param {object} [deps] - closed-world seams for tests
 * @param {(url: string, init: RequestInit) => Promise<Response>} [deps.transport] - Horde API calls
 * @param {import("../../services/catalogs/aihordeImageCatalog.js").HordeImageCatalog} [deps.catalog]
 * @param {typeof fetch} [deps.downloadFetch] - socket layer under the download guards
 */
export function createAiHordeImageAdapter({
  transport = defaultTransport,
  catalog = aiHordeImageCatalog,
  downloadFetch = fetch,
  timeoutMs = AI_HORDE_GENERATE_TIMEOUT_MS,
  apiCallTimeoutMs = AI_HORDE_API_CALL_TIMEOUT_MS,
  cancelTimeoutMs = AI_HORDE_CANCEL_TIMEOUT_MS,
  downloadTimeoutMs = AI_HORDE_DOWNLOAD_TIMEOUT_MS,
  maxImageBytes = AI_HORDE_MAX_IMAGE_BYTES,
  pollMinMs = POLL_MIN_MS,
  pollMaxMs = POLL_MAX_MS,
} = {}) {
  async function generate({ model, body, credentials, signal, log } = {}) {
    const request = mapHordeImageRequest(model, body);
    if (request.error) return refuse(request.error);
    const apiKey = resolveHordeApiKey(credentials);
    const fail = (status, message, extra) => ({ ...createErrorResult(status, message, undefined, undefined, null, credentials), ...extra });

    const deadline = Date.now() + timeoutMs;
    const overall = new AbortController();
    const timer = setTimeout(() => overall.abort(new Stop("deadline", "AI Horde image generation timed out")), timeoutMs);
    const onCallerAbort = () => overall.abort(new Stop("abort", "AI Horde image request aborted"));
    if (signal?.aborted) onCallerAbort();
    else signal?.addEventListener("abort", onCallerAbort, { once: true });
    const remaining = () => deadline - Date.now();
    const stopReason = () => (overall.signal.reason instanceof Stop ? overall.signal.reason : new Stop("abort", "AI Horde image request aborted"));
    const callSignal = (capMs) => AbortSignal.any([overall.signal, AbortSignal.timeout(Math.max(1, Math.min(capMs, remaining())))]);
    // Per-call timeouts count as the deadline: the request ran out of budget.
    const asStop = (error, step) => {
      if (error instanceof Stop) return error;
      if (overall.signal.aborted) return stopReason();
      if (error?.name === "TimeoutError" || error?.name === "AbortError") return new Stop("deadline", `AI Horde ${step} timed out`);
      return new Stop("failed", `AI Horde ${step} failed`);
    };
    const statusOf = (stop) => stop.status ?? (stop.kind === "abort" ? 499 : stop.kind === "deadline" ? 504 : 502);
    const api = (path, method, init = {}) => transport(`${AI_HORDE_API_BASE}${path}`, {
      method, headers: hordeHeaders(apiKey), ...init, signal: callSignal(apiCallTimeoutMs),
    });

    try {
      // 1. Catalog: only a model with workers in a real snapshot is submitted.
      try {
        await catalog.ensureFresh(undefined, { signal: overall.signal });
      } catch (error) {
        const stop = asStop(error, "catalog");
        return fail(statusOf(stop), `${stop.message}; nothing was submitted`, { outcome: stop.kind === "abort" ? "aborted" : "timeout" });
      }
      if (!catalog.hasSnapshot()) {
        return fail(503, "AI Horde image catalog is unavailable; nothing was submitted", { outcome: "failed" });
      }
      if (!catalog.isServed(request.model)) {
        return refuse(`No AI Horde workers are currently serving ${request.model}`);
      }

      // 2. Submit once. A lost answer is a possibly accepted job, never replayed.
      if (overall.signal.aborted) {
        const stop = stopReason();
        return fail(statusOf(stop), `${stop.message}; nothing was submitted`, { outcome: stop.kind === "abort" ? "aborted" : "timeout" });
      }
      let submit;
      try {
        submit = await api("/v2/generate/async", "POST", { body: JSON.stringify(request.payload) });
      } catch (error) {
        const stop = asStop(error, "submit");
        return fail(statusOf(stop), `AI Horde submit outcome unknown (${stop.message}); it was not resubmitted`, {
          outcome: "outcome_unknown", acceptedJob: acceptedJob("submit_outcome_unknown"),
        });
      }
      const submitBody = await readBoundedJson(submit, MAX_API_BODY_BYTES);
      if (overall.signal.aborted) {
        const stop = stopReason();
        return fail(statusOf(stop), `AI Horde submit outcome unknown (${stop.message}); it was not resubmitted`, {
          outcome: "outcome_unknown", acceptedJob: acceptedJob("submit_outcome_unknown", { httpStatus: submit.status }),
        });
      }
      if (submit.status !== 200 && submit.status !== 202) {
        if (submit.status >= 300 && submit.status < 400) {
          return fail(502, `AI Horde submit was redirected (HTTP ${submit.status}); the redirect was not followed`, { outcome: "refused" });
        }
        if (submit.status < 300 || (submit.status >= 500 && submit.status !== 503)) {
          return fail(502, `AI Horde submit outcome unknown (HTTP ${submit.status}); it was not resubmitted`, {
            outcome: "outcome_unknown", acceptedJob: acceptedJob("submit_outcome_unknown", { httpStatus: submit.status }),
          });
        }
        const status = KEPT_STATUS.has(submit.status) ? submit.status : 502;
        return fail(status, hordeMessage(submitBody, `AI Horde refused the submit (HTTP ${submit.status})`), { outcome: "refused" });
      }
      const jobId = isRecord(submitBody) ? submitBody.id : undefined;
      if (!isString(jobId) || !JOB_ID.test(jobId)) {
        return fail(502, "AI Horde accepted the submit without a usable job id; it was not resubmitted", {
          outcome: "outcome_unknown", acceptedJob: acceptedJob("accepted_without_id"),
        });
      }
      const submitKudos = isRecord(submitBody) ? numeric(submitBody.kudos) : null;
      log?.info?.("IMAGE", `aihorde/${request.model} | job accepted`);

      // 3. Poll, then read results. Any stop before results cancels the job.
      let finished = false;
      try {
        let delay = pollMinMs;
        let status;
        for (;;) {
          await sleepFor(delay, overall.signal);
          const check = await observe(() => api(`/v2/generate/check/${jobId}`, "GET"), "check");
          if (check.faulted === true) throw new Stop("faulted", "AI Horde marked the job as faulted", 502);
          if (check.is_possible === false) throw new Stop("impossible", "No AI Horde workers can currently fulfil this request", 503);
          if (check.done !== true) {
            const wait = numeric(check.wait_time);
            if (wait !== null && wait * 1_000 > remaining()) {
              throw new Stop("deadline", `AI Horde queue wait (~${Math.round(wait)}s) exceeds the remaining budget`, 504);
            }
            delay = wait === null ? pollMinMs : Math.min(pollMaxMs, Math.max(pollMinMs, Math.round(wait * 100)));
            continue;
          }
          status = await observe(() => api(`/v2/generate/status/${jobId}`, "GET"), "status");
          break;
        }
        finished = true;
        if (status.faulted === true) {
          return fail(502, "AI Horde marked the job as faulted", { outcome: "faulted", acceptedJob: acceptedJob("faulted", { jobId }) });
        }
        const generations = Array.isArray(status.generations) ? status.generations : [];
        const usable = generations.filter((item) => isRecord(item) && isString(item.img) && item.img.trim() && item.censored !== true);
        if (usable.length === 0) {
          return fail(502, "AI Horde finished the job without a usable image", {
            outcome: "completed_without_images", acceptedJob: acceptedJob("completed_without_images", { jobId }),
          });
        }

        // 4. Download each result with no credential.
        const images = [];
        for (const item of usable) {
          const value = item.img.trim();
          try {
            const image = /^[a-z][a-z0-9+.-]*:/i.test(value)
              ? await downloadHordeImage(value, { signal: callSignal(downloadTimeoutMs), maxBytes: maxImageBytes, fetcher: downloadFetch })
              : decodeInlineImage(value, maxImageBytes);
            images.push(image);
          } catch (error) {
            const stop = asStop(error, "image download");
            return fail(statusOf(stop), `${stop.message}; the finished job was not resubmitted`, {
              outcome: "download_failed", acceptedJob: acceptedJob("completed_download_failed", { jobId }),
            });
          }
        }

        const accounting = mediaAccounting(null, AI_HORDE_IMAGE_ID, "image");
        accounting.nativeUnits.images = images.length;
        accounting.meta.nativeUnitsSource = "returned-images";
        accounting.meta.jobId = jobId;
        if (images.length < request.n) accounting.meta.partial = { requested: request.n, returned: images.length };
        // Kudos are Horde's own priority currency; recorded raw, never priced.
        const kudos = numeric(status.kudos) ?? submitKudos;
        if (kudos !== null) accounting.meta.providerKudos = { path: numeric(status.kudos) !== null ? "status.kudos" : "submit.kudos", value: kudos };
        const payload = {
          created: Math.floor(Date.now() / 1000),
          data: images.map(({ bytes, format }) => ({ b64_json: bytes.toString("base64"), mime_type: IMAGE_MIME[format], output_format: format })),
        };
        return {
          success: true,
          accounting,
          response: new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } }),
        };
      } catch (error) {
        const stop = asStop(error, "job");
        const cancel = finished ? "not_needed" : await cancelJob(jobId);
        const state = stop.kind === "faulted" ? "faulted" : stop.kind === "impossible" ? "impossible" : "outcome_unknown";
        return fail(statusOf(stop), `${stop.message}; the job was not resubmitted`, {
          outcome: stop.kind === "abort" ? "aborted" : stop.kind === "deadline" ? "timeout" : state,
          acceptedJob: acceptedJob(state, { jobId, cancel }),
        });
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onCallerAbort);
    }

    // One API read of an accepted job: transport, redirect, HTTP or body failures stop polling.
    async function observe(call, step) {
      let response;
      try {
        response = await call();
      } catch (error) {
        throw asStop(error, step);
      }
      const json = await readBoundedJson(response, MAX_API_BODY_BYTES);
      if (overall.signal.aborted) throw stopReason();
      if (response.status !== 200 || !isRecord(json)) {
        const status = KEPT_STATUS.has(response.status) ? response.status : 502;
        throw new Stop("failed", `AI Horde ${step} failed (HTTP ${response.status})`, status);
      }
      return json;
    }

    // Bounded cleanup, deliberately not tied to the expired or aborted request signal.
    async function cancelJob(jobId) {
      try {
        const response = await transport(`${AI_HORDE_API_BASE}/v2/generate/status/${jobId}`, {
          method: "DELETE", headers: hordeHeaders(apiKey), signal: AbortSignal.timeout(cancelTimeoutMs),
        });
        await response.body?.cancel?.().catch(() => {});
        return response.status === 200 ? "requested" : "failed";
      } catch {
        return "failed";
      }
    }
  }

  return {
    async: true,
    // An omitted response_format means b64_json; the core refuses `url` and
    // `binary` before the catalog or a submit.
    defaultResponseFormat: "b64_json",
    responseFormats: ["b64_json"],
    generate,
  };
}

// Accepted or possibly accepted: Horde may spend kudos; the gateway cost stays unknown.
function acceptedJob(jobState, meta = {}) {
  return { ...mediaAccounting(null, AI_HORDE_IMAGE_ID, "image"), costSource: "accepted-job", meta: { jobState, ...meta } };
}

function sleepFor(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export default createAiHordeImageAdapter();
