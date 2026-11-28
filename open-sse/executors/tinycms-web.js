// Ported from OmniRoute release/v3.8.55 (4265bb2ad5477450a07d3a43ea33a62c6c874878),
// open-sse/executors/tinycms.ts (MIT). The WASM signer and proof-of-work solver it
// drives are vendored under open-sse/providers/private/tinycms-web/.
//
// Flow per request: public IP -> GET /api/challenge (uuid header) -> sign the
// challenge and solve the proof of work in WASM -> POST the OpenAI-compatible chat
// request with the x-secure-* headers. The upstream answers in OpenAI format (JSON
// or SSE), so a good response is passed through and only failures are mapped.
import { randomUUID } from "node:crypto";
import { WebSessionExecutor } from "./webSessionBase.js";
import { errorResponse } from "../utils/error.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { isRefusedRedirect } from "./sendRequest.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";
import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";
// The vendored signer inlines about 78 KB of WASM; it is loaded on the first request, not with the
// executor map, so every other provider's import path stays as light as before registration.
const loadSigner = () => import("../providers/private/tinycms-web/signer.js");

export const TINYCMS_ORIGIN = "https://gov.freegpt.win";
export const TINYCMS_CHAT_URL = `${TINYCMS_ORIGIN}/api/openai/oneapi/v1/chat/completions`;
export const TINYCMS_CHALLENGE_URL = `${TINYCMS_ORIGIN}/api/challenge`;
const IP_URL = "https://api64.ipify.org?format=json";
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";
const IP_TTL_MS = 5 * 60 * 1000;
// Difficulty is the number of leading zero hex digits. The solver runs synchronously
// inside WASM: 4 takes about 60 ms, 5 about 3 s, 6 would stall the event loop for tens
// of seconds, so anything above 5 fails closed.
const MAX_DIFFICULTY = 5;

const ipCache = new Map();

export function isTinyCmsDeviceUuid(value) {
  return isString(value) && /^R[\x21-\x7e]{3,}$/.test(value.trim());
}

/** The pasted API-key value wins; an import stores the UUID as providerSpecificData["app-config-uuid"]. */
export function tinyCmsDeviceUuid({ apiKey, uuid, providerSpecificData } = {}) {
  for (const value of [apiKey, uuid, providerSpecificData?.["app-config-uuid"]]) {
    if (isString(value) && value.trim()) return value.trim();
  }
  return "";
}

function proxyKey(proxyOptions) {
  try { return JSON.stringify(proxyOptions ?? null); } catch { return "default"; }
}

async function getPublicIp(fetcher, proxyOptions, signal) {
  const key = proxyKey(proxyOptions);
  const cached = ipCache.get(key);
  if (cached && Date.now() - cached.at < IP_TTL_MS) return cached.ip;
  try {
    // No credential travels to the IP service, so its redirects stay allowed.
    const res = await fetcher(IP_URL, { redirect: "follow", signal });
    const ip = (await res.json())?.ip;
    if (isString(ip) && ip) { ipCache.set(key, { ip, at: Date.now() }); return ip; }
  } catch { /* the IP only feeds the signature; fall back like the upstream client */ }
  return cached?.ip || "127.0.0.1";
}

const baseHeaders = (uuid) => ({ uuid, "x-origin": TINYCMS_ORIGIN, "User-Agent": USER_AGENT });

function classify(status) {
  if ((status >= 300 && status < 400) || status === 401 || status === 403) return { status: 401, type: "authentication_error", message: "TinyCMS device UUID was rejected or has expired. Copy app-config-uuid from site.tinycms.xyz again." };
  if (status === 429) return { status: 429, type: "rate_limit_error", message: "TinyCMS quota or rate limit reached" };
  if (status >= 400 && status < 500) return { status, type: "invalid_request_error", message: `TinyCMS rejected the request (HTTP ${status})` };
  return { status: 502, type: "upstream_error", message: `TinyCMS request failed (HTTP ${status})` };
}

function failure(status, message, type, url, body, retryAfter = null) {
  const code = status === 401 ? "invalid_session" : status === 429 ? "quota_exceeded" : `HTTP_${status}`;
  return { response: errorResponse(status, message, { type, code }, retryAfter), url, headers: {}, transformedBody: body };
}

async function upstreamFailure(response, url, body) {
  const retry = Number(response.headers?.get?.("retry-after"));
  await response.text().catch(() => "");
  const mapped = classify(response.status);
  return failure(mapped.status, mapped.message, mapped.type, url, body, Number.isFinite(retry) ? retry : null);
}

/** Validate a device UUID by asking the challenge endpoint for a challenge. */
// A redirect must never carry the custom device UUID header to another origin.
export async function validateTinyCmsSession({ apiKey, providerSpecificData, fetcher = proxyAwareFetch, proxyOptions, signal } = {}) {
  const uuid = tinyCmsDeviceUuid({ apiKey, providerSpecificData });
  if (!isTinyCmsDeviceUuid(uuid)) return { valid: false, status: 401, error: "TinyCMS device UUID must start with R" };
  try {
    const res = await fetcher(TINYCMS_CHALLENGE_URL, { method: "GET", headers: { ...baseHeaders(uuid), Accept: "application/json" }, redirect: "manual", signal: signal ?? AbortSignal.timeout(10000) }, proxyOptions);
    if (!res.ok) return { valid: false, status: res.status, error: classify(res.status).message };
    const challenge = await res.json().catch(() => null);
    return challenge?.challenge && challenge?.challengeId ? { valid: true, status: res.status } : { valid: false, status: 502, error: "TinyCMS returned an unreadable challenge" };
  } catch (error) {
    return { valid: false, status: 502, error: error?.name === "AbortError" ? "TinyCMS validation timed out" : "TinyCMS validation request failed" };
  }
}

export class TinyCmsExecutor extends WebSessionExecutor {
  constructor() { super("tinycms-web", { id: "tinycms-web", baseUrl: TINYCMS_CHAT_URL }, { observePatchedFetch: false }); }

  // The session base owns cancellation, dispatch and quota settlement.
  async runSession(input, transport) {
    const body = isRecord(input.body) ? input.body : {};
    const uuid = tinyCmsDeviceUuid(input.credentials ?? {});
    if (!isTinyCmsDeviceUuid(uuid)) return failure(401, "TinyCMS: invalid or missing device UUID (must start with 'R')", "authentication_error", TINYCMS_CHAT_URL, input.body);
    // The IP lookup and the challenge are not charged; only the chat send is quota-bearing.
    const fetcher = (url, options) => transport.send(url, options);
    try {
      const { initTinyCmsWasm, generateSecurePayload } = await loadSigner();
      await initTinyCmsWasm();
      const ip = await getPublicIp(fetcher, input.proxyOptions, input.signal);
      const challengeResponse = await fetcher(TINYCMS_CHALLENGE_URL, { method: "GET", headers: { ...baseHeaders(uuid), Accept: "application/json" }, redirect: "manual", signal: input.signal });
      if (!challengeResponse.ok) return await upstreamFailure(challengeResponse, TINYCMS_CHALLENGE_URL, input.body);
      const challenge = await challengeResponse.json().catch(() => null);
      const difficulty = Number(challenge?.difficulty);
      if (!isString(challenge?.challenge) || !challenge.challenge || !isString(challenge?.challengeId) || !challenge.challengeId || !Number.isInteger(difficulty) || difficulty < 0) {
        return failure(502, "TinyCMS returned a malformed challenge", "upstream_error", TINYCMS_CHALLENGE_URL, input.body);
      }
      if (difficulty > MAX_DIFFICULTY) return failure(502, "TinyCMS requested a proof-of-work difficulty this gateway will not solve", "upstream_error", TINYCMS_CHALLENGE_URL, input.body);

      const timestamp = Date.now().toString();
      // The nonce is signed into x-secure-signature and reused as the session id.
      const nonce = randomUUID();
      const secure = generateSecurePayload(uuid, timestamp, nonce, challenge.challenge, ip, difficulty);
      const stream = input.stream === true || body.stream === true;
      const model = isString(body.model) ? body.model.split("/").at(-1) : input.model;
      const headers = {
        ...baseHeaders(uuid),
        referer: `${TINYCMS_ORIGIN}/`,
        "x-secure-challenge-id": challenge.challengeId,
        "x-secure-challenge-expires-at": String(challenge.expiresAt),
        "x-secure-challenge-version": String(challenge.version),
        "x-secure-signature": secure.signature,
        "x-secure-fingerprint": secure.fingerprint,
        "x-secure-client-ip": secure.client_ip,
        "x-secure-pow-seed-nonce": String(secure.pow.seed_nonce),
        "x-secure-pow-nonce": String(secure.pow.nonce),
        "x-secure-pow-hash": secure.pow.hash,
        "x-secure-pow-difficulty": String(secure.pow.difficulty),
        "x-secure-timestamp": timestamp,
        "x-secure-nonce": nonce,
        "x-secure-version": secure.v,
        "x-session-id": nonce,
        userid: String(input.credentials?.providerSpecificData?.userid ?? "") || uuid.slice(0, 20),
        Accept: stream ? "text/event-stream" : "application/json",
        "Content-Type": "application/json",
      };
      const chatBody = { ...body, model, stream };
      let upstream;
      try {
        upstream = await transport.sendBillable(TINYCMS_CHAT_URL, { method: "POST", headers, redirect: "manual", body: JSON.stringify(chatBody), signal: input.signal });
      } catch (error) {
        if (!isRefusedRedirect(error)) throw error;
        const mapped = classify(302);
        return failure(mapped.status, mapped.message, mapped.type, TINYCMS_CHAT_URL, chatBody);
      }
      if (!upstream.ok) return await upstreamFailure(upstream, TINYCMS_CHAT_URL, chatBody);
      const type = upstream.headers.get("content-type") || "";
      if (!stream && type.includes("json")) {
        // A 200 that carries an error envelope instead of choices is still a failure.
        const text = await upstream.text();
        let payload = null;
        try { payload = JSON.parse(text); } catch { /* not JSON: hand the text on unchanged */ }
        if (payload?.error && !payload.choices) {
          const status = Number(payload.error.code ?? payload.error.status);
          const mapped = classify(Number.isInteger(status) && status >= 400 ? status : 502);
          return failure(mapped.status, mapped.message, mapped.type, TINYCMS_CHAT_URL, chatBody);
        }
        return { response: new Response(text, { status: 200, headers: { "Content-Type": "application/json" } }), url: TINYCMS_CHAT_URL, headers: { uuid: "[REDACTED]" }, transformedBody: chatBody };
      }
      return { response: upstream, url: TINYCMS_CHAT_URL, headers: { uuid: "[REDACTED]" }, transformedBody: chatBody };
    } catch (error) {
      if (error?.name === "AbortError" || isQuotaDispatchUnavailable(error)) throw error;
      return failure(502, "TinyCMS request failed", "upstream_error", TINYCMS_CHAT_URL, input.body);
    }
  }
}

export default TinyCmsExecutor;
