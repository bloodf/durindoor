// Bounded transport for the staged SYNTX executor: size-capped JSON/error
// reads, an SSE reader with idle, deadline and byte limits, and a guarded
// download for client image URLs.
//
// The source read every body unbounded and fetched any https image URL with
// the platform fetch (default redirect follow). Here a client image URL is
// fetched with no credentials of any kind, only over https, only to hosts that
// classify and resolve as public, with each redirect re-checked and a byte cap.
import dns from "node:dns";
import { classifyHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { isFunction, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  SYNTX_IDLE_TIMEOUT_MS, SYNTX_MAX_ERROR_BYTES, SYNTX_MAX_EVENT_BYTES, SYNTX_MAX_IMAGE_DOWNLOAD_BYTES,
  SYNTX_MAX_IMAGE_REDIRECTS, SYNTX_MAX_JSON_BYTES, SYNTX_MAX_STREAM_BYTES,
} from "./config.js";
import { createSseFrameReader } from "../../../utils/sseFrames.js";
import { applySyntxSseFrame } from "./chat.js";

export class SyntxTransportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SyntxTransportError";
    this.code = code;
  }
}

function cancelBody(response) {
  try {
    const pending = response?.body?.cancel?.();
    if (pending?.catch) pending.catch(() => {});
  } catch {
    // already locked or closed
  }
}

/** Read at most `maxBytes` of a body; a larger body throws `too-large`. */
export async function readBoundedBytes(response, maxBytes) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    cancelBody(response);
    throw new SyntxTransportError("too-large", "response exceeded the size limit");
  }
  const reader = response.body?.getReader?.();
  if (!reader) return new Uint8Array(0);
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => {});
      throw new SyntxTransportError("too-large", "response exceeded the size limit");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)));
}

export async function readBoundedJson(response, maxBytes = SYNTX_MAX_JSON_BYTES) {
  const bytes = await readBoundedBytes(response, maxBytes);
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new SyntxTransportError("bad-json", "response was not JSON");
  }
}

/** First bytes of an error body, for sanitized messages; never throws. */
export async function readErrorText(response, maxBytes = SYNTX_MAX_ERROR_BYTES) {
  try {
    const reader = response.body?.getReader?.();
    if (!reader) return "";
    const chunks = [];
    let total = 0;
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    reader.cancel().catch(() => {});
    return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))).subarray(0, maxBytes).toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Read a SYNTX stream body (source readSyntxSse) with bounds. Never rejects.
 * Resolves `{ outcome, text, usage?, error? }` where outcome is one of
 * complete | truncated | upstream-error | aborted | timeout | idle | too-large | read-error.
 * `complete` needs a `[DONE]` line or a `usage_final` event before the body ends.
 */
export async function readSyntxSse(response, {
  onDelta = () => {}, signal = null, deadline = null, idleMs = SYNTX_IDLE_TIMEOUT_MS,
  maxBytes = SYNTX_MAX_STREAM_BYTES, maxEventBytes = SYNTX_MAX_EVENT_BYTES,
} = {}) {
  const reader = response.body?.getReader?.();
  let text = "";
  let usage;
  let sawDone = false;
  if (!reader) return { outcome: "truncated", text };
  const decoder = new TextDecoder();
  const frames = createSseFrameReader({ maxBytes: maxEventBytes });
  let total = 0;
  let stop = null;
  const halt = (outcome, extra = {}) => {
    if (!stop) stop = { outcome, ...extra };
  };
  const onAbort = () => {
    halt(signal?.aborted ? "aborted" : "timeout");
    reader.cancel().catch(() => {});
  };
  signal?.addEventListener?.("abort", onAbort, { once: true });
  deadline?.addEventListener?.("abort", onAbort, { once: true });
  if (signal?.aborted || deadline?.aborted) onAbort();

  const applyFrames = (list) => {
    for (const frame of list) {
      if (stop || sawDone) return;
      const parsed = applySyntxSseFrame(frame);
      if (parsed.delta) {
        text += parsed.delta;
        onDelta(parsed.delta);
      }
      if (parsed.usage) usage = parsed.usage;
      if (parsed.error) halt("upstream-error", { error: parsed.error });
      if (parsed.done) sawDone = true;
    }
  };
  const feed = (chunk, final = false) => {
    try {
      applyFrames(frames.push(chunk, final));
      if (final && !stop && !sawDone) applyFrames(frames.flush());
    } catch {
      halt("too-large");
    }
  };

  try {
    while (!stop && !sawDone) {
      let timer;
      const idle = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ idle: true }), idleMs);
      });
      let step;
      try {
        step = await Promise.race([reader.read(), idle]);
      } finally {
        clearTimeout(timer);
      }
      if (stop) break;
      if (step.idle) {
        halt("idle");
        break;
      }
      if (step.done) break;
      total += step.value.byteLength;
      if (total > maxBytes) {
        halt("too-large");
        break;
      }
      feed(decoder.decode(step.value, { stream: true }));
    }
    if (!stop && !sawDone) feed(decoder.decode(), true);
  } catch {
    if (signal?.aborted) halt("aborted");
    else if (deadline?.aborted) halt("timeout");
    else halt("read-error");
  } finally {
    signal?.removeEventListener?.("abort", onAbort);
    deadline?.removeEventListener?.("abort", onAbort);
    if (stop || sawDone) reader.cancel().catch(() => {});
  }
  if (stop) return { text, usage, ...stop };
  return { outcome: sawDone || usage ? "complete" : "truncated", text, usage };
}

const defaultLookup = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

/** Whether `rawUrl` is https to a host that classifies, and resolves, as public. Fails closed. */
export async function assertSafeImageUrl(rawUrl, lookup = defaultLookup) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SyntxTransportError("blocked-url", "image URL is not valid");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new SyntxTransportError("blocked-url", "image URL must be plain https");
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (classifyHost(host) !== "public") throw new SyntxTransportError("blocked-url", "image URL targets an internal host");
  const literal = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
  if (literal) return parsed;
  let addresses;
  try {
    addresses = await lookup(host);
  } catch {
    throw new SyntxTransportError("blocked-url", "image host did not resolve");
  }
  const list = Array.isArray(addresses) ? addresses : [addresses];
  if (list.length === 0) throw new SyntxTransportError("blocked-url", "image host did not resolve");
  for (const entry of list) {
    const address = isString(entry) ? entry : entry?.address;
    if (!isString(address) || classifyHost(address) !== "public") {
      throw new SyntxTransportError("blocked-url", "image host resolves to an internal address");
    }
  }
  return parsed;
}

/**
 * Download one client image with no credentials: https only, public hosts
 * only (checked again on every redirect hop), image content types only, and
 * a byte cap. Returns `{ bytes, mime, name }` or throws SyntxTransportError.
 */
export async function fetchGuardedImage(url, {
  request, lookup = defaultLookup, signal, maxBytes = SYNTX_MAX_IMAGE_DOWNLOAD_BYTES, maxRedirects = SYNTX_MAX_IMAGE_REDIRECTS,
} = {}) {
  if (!isFunction(request)) throw new SyntxTransportError("config", "no transport");
  let current = url;
  for (let hop = 0; ; hop++) {
    await assertSafeImageUrl(current, lookup);
    const response = await request(current, { method: "GET", redirect: "manual", headers: { accept: "image/*" }, signal });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      cancelBody(response);
      if (!location) throw new SyntxTransportError("download-failed", "image redirect without a location");
      if (hop >= maxRedirects) throw new SyntxTransportError("download-failed", "too many image redirects");
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) {
      cancelBody(response);
      throw new SyntxTransportError("download-failed", `image download HTTP ${response.status}`);
    }
    const mime = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!/^image\/[a-z0-9.+-]+$/.test(mime)) {
      cancelBody(response);
      throw new SyntxTransportError("download-failed", "image download was not an image");
    }
    const bytes = await readBoundedBytes(response, maxBytes);
    const ext = mime.split("/")[1]?.replace("jpeg", "jpg") || "png";
    return { bytes: new Uint8Array(bytes), mime, name: `image.${ext}` };
  }
}
