// Result URL policy and credential-free download for SYNTX media.
//
// Source (syntxMedia.ts fetchSyntxMediaBytes via openUpstreamMedia): HTTPS,
// public addresses at every hop, at most three redirects, direct connections
// pinned, 50 MiB, 300 s. Here: a returned URL must be https with no userinfo
// and a public literal host; before any connection every hop's hostname is
// resolved and every address must be public (resolution failure refuses);
// the default transport pins connection-time DNS answers through the
// public-only guarded dispatcher; redirects are followed manually (at most
// three) and each target is re-validated; only `accept` is sent, never the
// SYNTX JWT or any cookie, whatever the host.
import { lookup as dnsLookupCallback } from "node:dns";
import { promisify } from "node:util";
import { classifyHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { createGuardedProbeDispatcher } from "../../../utils/outboundUrlGuard.js";
import { SYNTX_DOWNLOAD_TIMEOUT_MS, SYNTX_MAX_DOWNLOAD_REDIRECTS, SYNTX_MEDIA_MAX_BYTES } from "./config.js";
import { abortError, discard, timeoutError } from "./http.js";
import { isString } from "../../../../src/shared/utils/typeChecks.js";

const MAX_URL_CHARS = 4096;
const dnsLookup = promisify(dnsLookupCallback);
let guardedDispatcher = null;

const bareHost = (hostname) => hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase();

/** A public https URL (literal checks only), normalized, or null. */
export function syntxPublicUrl(value) {
  if (!isString(value) || !value || value.length > MAX_URL_CHARS) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return null;
  if (classifyHost(bareHost(url.hostname)) !== "public") return null;
  return url.href;
}

/**
 * Resolve a URL's hostname and require every answer to be public. An IP
 * literal is checked as is. Throws on a blocked, empty or failed resolution.
 */
export async function assertSyntxUrlResolvesPublic(href, lookup = dnsLookup) {
  const host = bareHost(new URL(href).hostname);
  if (classifyHost(host) !== "public") throw new Error("blocked host");
  if (/^[\d.]+$/.test(host) || host.includes(":")) return;
  let records;
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("host did not resolve");
  }
  const list = Array.isArray(records) ? records : [records];
  if (list.length === 0) throw new Error("host did not resolve");
  for (const record of list) {
    const address = isString(record) ? record : record?.address;
    if (!isString(address) || classifyHost(bareHost(address)) !== "public") throw new Error("host resolves to a non-public address");
  }
}

function defaultDownloadFetch(url, init) {
  guardedDispatcher ??= createGuardedProbeDispatcher("public-only");
  return fetch(url, { ...init, dispatcher: guardedDispatcher });
}

async function readBytes(response, { maxBytes, signal }) {
  const declared = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    discard(response);
    return { tooLarge: true };
  }
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.byteLength > maxBytes ? { tooLarge: true } : { bytes };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw signal.reason ?? abortError();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { tooLarge: true };
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return { bytes: Buffer.concat(chunks, total) };
}

/**
 * Download one returned SYNTX media URL.
 *
 * @returns {Promise<{ success: true, bytes: Buffer, contentType: string }
 *   | { success: false, status: number, reason: string }>}
 *   reason is one of: invalid-url, blocked, redirects, http, too-large,
 *   empty, timeout, aborted, network
 */
export async function downloadSyntxMedia(url, {
  signal = null, timeoutMs = SYNTX_DOWNLOAD_TIMEOUT_MS, maxBytes = SYNTX_MEDIA_MAX_BYTES,
  fetchImpl = defaultDownloadFetch, lookup = dnsLookup,
} = {}) {
  let current = syntxPublicUrl(url);
  if (!current) return { success: false, status: 502, reason: "invalid-url" };
  if (signal?.aborted) return { success: false, status: 499, reason: "aborted" };
  const deadline = new AbortController();
  const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  const timer = setTimeout(() => deadline.abort(timeoutError()), Math.max(1, timeoutMs));
  let stopWaiting;
  const bound = new Promise((_, rejectWait) => {
    stopWaiting = () => rejectWait(combined.reason ?? abortError());
    combined.addEventListener("abort", stopWaiting, { once: true });
  });
  bound.catch(() => {});
  const race = (promise) => Promise.race([promise, bound]);
  try {
    for (let hop = 0; ; hop++) {
      try {
        await race(assertSyntxUrlResolvesPublic(current, lookup));
      } catch (error) {
        if (combined.aborted) throw error;
        return { success: false, status: 502, reason: "blocked" };
      }
      const pending = Promise.resolve(fetchImpl(current, { method: "GET", headers: { accept: "*/*" }, redirect: "manual", signal: combined }));
      let response;
      try {
        response = await race(pending);
      } catch (error) {
        pending.then(discard, () => {});
        throw error;
      }
      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        const location = response.headers.get("location");
        discard(response);
        if (!location || hop >= SYNTX_MAX_DOWNLOAD_REDIRECTS) return { success: false, status: 502, reason: "redirects" };
        let next;
        try {
          next = new URL(location, current).href;
        } catch {
          return { success: false, status: 502, reason: "redirects" };
        }
        current = syntxPublicUrl(next);
        if (!current) return { success: false, status: 502, reason: "blocked" };
        continue;
      }
      if (!response.ok) {
        discard(response);
        return { success: false, status: 502, reason: "http" };
      }
      const read = await race(readBytes(response, { maxBytes, signal: combined }));
      if (read.tooLarge) return { success: false, status: 502, reason: "too-large" };
      if (read.bytes.byteLength === 0) return { success: false, status: 502, reason: "empty" };
      return { success: true, bytes: read.bytes, contentType: response.headers.get("content-type") || "application/octet-stream" };
    }
  } catch (error) {
    if (signal?.aborted) return { success: false, status: 499, reason: "aborted" };
    if (deadline.signal.aborted || error?.name === "TimeoutError") return { success: false, status: 504, reason: "timeout" };
    return { success: false, status: 502, reason: "network" };
  } finally {
    clearTimeout(timer);
    combined.removeEventListener("abort", stopWaiting);
  }
}

/** Audio container from magic bytes, or null. */
export function sniffAudioFormat(bytes) {
  if (!bytes || bytes.length < 4) return null;
  const head = bytes.subarray(0, 12);
  const ascii = (start, text) => head.subarray(start, start + text.length).toString("latin1") === text;
  if (ascii(0, "ID3") || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0 && (head[1] & 0x06) !== 0)) return "mp3";
  if (ascii(0, "RIFF") && ascii(8, "WAVE")) return "wav";
  if (ascii(0, "OggS")) return "ogg";
  if (ascii(0, "fLaC")) return "flac";
  if (head[0] === 0xff && (head[1] & 0xf6) === 0xf0) return "aac";
  return null;
}
