// The staged OCR dispatcher (#2034): validate, dispatch to the selected
// provider's adapter, send once under a deadline, poll async jobs on the
// submit origin, and normalize the answer to the source's Mistral OCR shape
// `{ model, pages: [{ index, markdown }], usage_info? }`. See ./config.js for
// the source attribution. Nothing in production imports this module yet.
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { createErrorResult } from "../../../utils/error.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { isBoolean, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  OCR_MAX_ERROR_BYTES, OCR_MAX_MODEL_CHARS, OCR_MAX_PAGES, OCR_MAX_RESPONSE_BYTES, OCR_MODALITY, OCR_TIMEOUT_MS,
} from "./config.js";
import { OCR_POLL_STATES } from "./adapter.js";
import {
  createOcrDeadline, discard, isRedirect, ocrInvalid, ocrLost, ocrRefusal, ocrSleep, provenUnsent, readBoundedText, sendBounded, withAcceptedJob,
} from "./http.js";
import { validateOcrRequest } from "./request.js";

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const USAGE_VALUE = (value) => (isNumber(value) && Number.isFinite(value)) || (isString(value) && value.length <= 256) || isBoolean(value);

/** Credential values the error sanitizer must redact. */
const secretsOf = (credentials) => ({ apiKey: credentials?.apiKey, accessToken: credentials?.accessToken });

/** Headers as a plain record of single-line strings, or null when unusable. */
function cleanHeaders(headers) {
  if (!isRecord(headers)) return null;
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HEADER_NAME_RE.test(name) || !isString(value) || !value.trim() || /[\r\n\0]/.test(value)) return null;
    out[name] = value;
  }
  return out;
}

/** The parsed target when it is an https URL on one of the adapter's origins, else null. */
function allowedTarget(adapter, value) {
  let url;
  try {
    url = isString(value) ? new URL(value) : null;
  } catch {
    url = null;
  }
  if (!url || url.protocol !== "https:" || url.username || url.password || isBlockedHost(url.hostname)) return null;
  return adapter.origins.includes(url.origin) ? url : null;
}

/**
 * The normalized OCR body, or null when the adapter's parse is not the
 * documented shape. Pages keep `index` and `markdown` only, sorted by index;
 * usage_info keeps primitive values only.
 */
export function normalizeOcrResult(parsed, { model }) {
  if (!isRecord(parsed) || !Array.isArray(parsed.pages) || parsed.pages.length > OCR_MAX_PAGES) return null;
  const seen = new Set();
  const pages = [];
  for (const page of parsed.pages) {
    if (!isRecord(page) || !Number.isSafeInteger(page.index) || page.index < 0 || seen.has(page.index) || !isString(page.markdown)) return null;
    seen.add(page.index);
    pages.push({ index: page.index, markdown: page.markdown });
  }
  pages.sort((a, b) => a.index - b.index);
  const body = {
    model: isString(parsed.model) && parsed.model && parsed.model.length <= OCR_MAX_MODEL_CHARS ? parsed.model : model,
    pages,
  };
  if (isRecord(parsed.usage_info)) {
    const usage = Object.fromEntries(Object.entries(parsed.usage_info).filter(([, value]) => USAGE_VALUE(value)));
    if (Object.keys(usage).length) body.usage_info = usage;
  }
  return body;
}

/** Ledger metadata for a delivered OCR result; cost stays unknown (no OCR tariff is staged). */
export function ocrAccounting(provider, body) {
  const accounting = mediaAccounting(null, provider, OCR_MODALITY);
  const processed = body.usage_info?.pages_processed;
  if (body.usage_info) accounting.meta.providerUsage = { path: "usage_info", value: { ...body.usage_info } };
  if (Number.isSafeInteger(processed) && processed >= 0) {
    accounting.nativeUnits.pages = processed;
    accounting.meta.nativeUnitsSource = "usage_info.pages_processed";
  } else {
    accounting.nativeUnits.pages = body.pages.length;
    accounting.meta.nativeUnitsSource = "returned-pages";
  }
  return accounting;
}

/** The input document as reported back: never the inline bytes. */
const describeDocument = (document) => (document.source === "url"
  ? { type: document.type, source: "url", url: document.url }
  : { type: document.type, source: "inline", mediaType: document.mediaType, bytes: document.bytes });

async function readJson(response, { maxBytes, signal }) {
  const text = await readBoundedText(response, { maxBytes, signal });
  return JSON.parse(text);
}

/**
 * Create a dispatcher over a fixed set of adapters.
 *
 * @param {object} options
 * @param {object[]} options.adapters results of defineOcrAdapter
 * @param {Function} [options.fetchImpl] transport; defaults to the proxy-aware fetch
 * @param {Function} [options.sleepImpl] poll sleep; tests inject a fake
 * @param {number} [options.timeoutMs] one deadline for submit and polls
 * @param {number} [options.maxResponseBytes]
 */
export function createOcrDispatcher({
  adapters,
  fetchImpl = proxyAwareFetch,
  sleepImpl = defaultSleep,
  timeoutMs = OCR_TIMEOUT_MS,
  maxResponseBytes = OCR_MAX_RESPONSE_BYTES,
} = {}) {
  if (!Array.isArray(adapters)) throw new TypeError("createOcrDispatcher needs an adapters array");
  const byId = new Map();
  for (const adapter of adapters) {
    if (!adapter || !Object.isFrozen(adapter) || !isString(adapter.id) || !Array.isArray(adapter.origins)) {
      throw new TypeError("OCR adapters must come from defineOcrAdapter");
    }
    if (byId.has(adapter.id)) throw new TypeError(`duplicate OCR adapter ${adapter.id}`);
    byId.set(adapter.id, adapter);
  }

  async function poll(adapter, { pollUrl, authHeaders, deadline, proxyOptions }) {
    const label = adapter.label;
    for (let attempt = 0; attempt < adapter.poll.maxAttempts; attempt++) {
      await ocrSleep(sleepImpl, adapter.poll.intervalMs, deadline.signal);
      // fetch keeps custom auth headers across a cross-origin redirect, so a redirect is refused.
      const response = await sendBounded(fetchImpl, pollUrl, { method: "GET", headers: { ...authHeaders } }, deadline, proxyOptions);
      if (isRedirect(response)) {
        discard(response);
        return { failure: ocrLost(adapter.id, `${label} OCR status URL answered with a redirect; the redirect was not followed`) };
      }
      if (!response.ok) {
        discard(response);
        return { failure: ocrLost(adapter.id, `${label} OCR status check failed with ${response.status}; the job may have been processed`) };
      }
      let json;
      try {
        json = await readJson(response, { maxBytes: maxResponseBytes, signal: deadline.signal });
      } catch (error) {
        if (deadline.signal.aborted) throw error;
        return { failure: ocrLost(adapter.id, `${label} OCR status answer could not be read`) };
      }
      let state;
      try {
        state = adapter.pollState(json);
      } catch {
        state = null;
      }
      if (!OCR_POLL_STATES.includes(state)) return { failure: ocrLost(adapter.id, `${label} OCR status answer was not understood`) };
      if (state === "succeeded") return { raw: json };
      if (state === "failed") return { failure: ocrLost(adapter.id, `${label} OCR analysis failed`) };
    }
    return { failure: ocrLost(adapter.id, `${label} OCR analysis did not finish within ${adapter.poll.maxAttempts} status checks`, HTTP_STATUS.GATEWAY_TIMEOUT) };
  }

  /**
   * Run one OCR request on the selected provider's adapter.
   *
   * @param {object} args
   * @param {string} args.provider the selected provider id (the caller chose the connection)
   * @param {object} args.body client body `{ model, document, ...adapter options }`
   * @param {object} args.credentials the selected connection's credentials
   * @param {AbortSignal} [args.signal]
   * @returns {Promise<object>} `{ success: true, status: 200, provider, model, document, body, accounting, response }`
   *   or a failure result (`local` when nothing was sent; `acceptedJob` when the provider may have done the work)
   */
  async function dispatch({ provider, body, credentials, signal } = {}) {
    const adapter = isString(provider) ? byId.get(provider) : undefined;
    if (!adapter) {
      const named = isString(provider) && /^[a-z0-9][a-z0-9-]{0,63}$/.test(provider) ? ` ${provider}` : "";
      return ocrInvalid(`No OCR provider${named} is available. Available: ${[...byId.keys()].join(", ") || "none"}`);
    }
    const label = adapter.label;

    let request;
    try {
      request = validateOcrRequest(adapter, body);
    } catch (error) {
      if (error?.ocrInput) return ocrInvalid(error.message);
      throw error;
    }

    let authHeaders;
    try {
      authHeaders = adapter.authHeaders(credentials ?? {});
    } catch {
      authHeaders = null;
    }
    authHeaders = authHeaders === null || authHeaders === undefined ? null : cleanHeaders(authHeaders);
    if (!authHeaders || !Object.keys(authHeaders).length) {
      return createErrorResult(401, `No usable credentials for OCR provider: ${adapter.id}`);
    }

    let built;
    try {
      built = adapter.buildRequest({ model: request.model, document: request.document, options: request.options });
    } catch (error) {
      if (error?.ocrInput) return ocrInvalid(error.message);
      return ocrInvalid(`${label} OCR request could not be built`, HTTP_STATUS.SERVER_ERROR);
    }
    const target = isRecord(built) ? allowedTarget(adapter, built.url) : null;
    if (!target) return ocrInvalid(`${label} OCR request target is outside the provider's origins`, HTTP_STATUS.SERVER_ERROR);
    const method = built.method ?? "POST";
    const extraHeaders = built.headers === undefined ? {} : cleanHeaders(built.headers);
    if (!["POST", "PUT"].includes(method) || !extraHeaders) {
      return ocrInvalid(`${label} OCR request could not be built`, HTTP_STATUS.SERVER_ERROR);
    }
    const headers = { ...extraHeaders, ...authHeaders };
    let payload = built.body;
    if (isRecord(payload) || Array.isArray(payload)) {
      payload = JSON.stringify(payload);
      if (!Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) headers["Content-Type"] = "application/json";
    }

    const secrets = secretsOf(credentials);
    const proxyOptions = resolveCredentialProxyOptions(credentials);
    const deadline = createOcrDeadline(signal, timeoutMs);
    const caller = () => signal?.aborted === true;
    let submitted = false;
    try {
      let response;
      try {
        response = await sendBounded(fetchImpl, target.href, { method, headers, body: payload }, deadline, proxyOptions);
      } catch (error) {
        if (provenUnsent(error)) {
          return caller() || error?.notSent
            ? { ...createErrorResult(499, `${label} OCR request aborted; nothing was sent`), local: true }
            : createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${label} OCR could not connect`);
        }
        throw error;
      }
      submitted = true;
      if (isRedirect(response)) {
        discard(response);
        return ocrLost(adapter.id, `${label} OCR was redirected; the redirect was not followed`, HTTP_STATUS.BAD_GATEWAY, "submit-unknown");
      }
      if (!response.ok) {
        const retryAfter = response.headers.get("retry-after");
        await readBoundedText(response, { maxBytes: OCR_MAX_ERROR_BYTES, signal: deadline.signal }).catch(() => discard(response));
        return ocrRefusal(response.status, { provider: adapter.id, label, secrets, retryAfter });
      }

      let raw;
      let pollUrl = null;
      if (adapter.pollUrl) {
        try {
          pollUrl = adapter.pollUrl(response) ?? null;
        } catch {
          pollUrl = undefined;
        }
      }
      if (pollUrl !== null) {
        discard(response);
        let resolved;
        try {
          resolved = isString(pollUrl) ? new URL(pollUrl, target) : null;
        } catch {
          resolved = null;
        }
        // Source rule: only poll the endpoint the request went to.
        if (!resolved || resolved.origin !== target.origin || !allowedTarget(adapter, resolved.href)) {
          return ocrLost(adapter.id, `${label} OCR returned a status URL outside its endpoint`);
        }
        const polled = await poll(adapter, { pollUrl: resolved.href, authHeaders, deadline, proxyOptions });
        if (polled.failure) return polled.failure;
        raw = polled.raw;
      } else {
        try {
          raw = await readJson(response, { maxBytes: maxResponseBytes, signal: deadline.signal });
        } catch (error) {
          if (deadline.signal.aborted) throw error;
          return ocrLost(adapter.id, error?.name === "OcrBodyTooLarge"
            ? `${label} OCR answer exceeded ${maxResponseBytes} bytes`
            : `${label} OCR answer was not JSON`);
        }
      }

      let parsed;
      try {
        parsed = adapter.parseResponse(raw, { model: request.model });
      } catch {
        parsed = null;
      }
      const normalized = normalizeOcrResult(parsed, { model: request.model });
      if (!normalized) return ocrLost(adapter.id, `${label} OCR answer did not match the OCR result shape`);
      return {
        success: true,
        status: 200,
        provider: adapter.id,
        model: request.model,
        document: describeDocument(request.document),
        body: normalized,
        accounting: ocrAccounting(adapter.id, normalized),
        response: new Response(JSON.stringify(normalized), {
          status: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }),
      };
    } catch (error) {
      // The document left the gateway: the provider may have done the work.
      const jobState = submitted ? "accepted" : "submit-unknown";
      if (caller()) return withAcceptedJob(createErrorResult(499, `${label} OCR request aborted after it was sent`), adapter.id, jobState);
      if (deadline.timedOut()) {
        return withAcceptedJob(createErrorResult(HTTP_STATUS.GATEWAY_TIMEOUT, `${label} OCR timed out; whether it was processed is unknown`), adapter.id, jobState);
      }
      return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${label} OCR failed; whether it was processed is unknown`), adapter.id, jobState);
    } finally {
      deadline.clear();
    }
  }

  return Object.freeze({
    dispatch,
    adapter: (id) => byId.get(id) ?? null,
    providers: () => [...byId.keys()],
  });
}
