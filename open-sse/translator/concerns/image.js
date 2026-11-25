// Build a base64 data URI from mime + base64 payload
import { isString } from "../../../src/shared/utils/typeChecks.js";
export function encodeDataUri(mimeType, base64) {
  return `data:${mimeType};base64,${base64}`;
}

// Parse a base64 data URI → { mimeType, base64 }, or null if not a data URI.
// [\s\S] tolerates newlines inside the base64 payload.
const DATA_URI_RE = /^data:([^;]+);base64,([\s\S]+)$/;
export function parseDataUri(url) {
  if (!isString(url)) return null;
  const m = url.match(DATA_URI_RE);
  return m ? { mimeType: m[1], base64: m[2] } : null;
}

import { lookup } from "node:dns/promises";
import { Agent } from "undici";
import { MAX_IMAGE_BYTES, FETCH_TIMEOUT_MS, IMAGE_SIGNATURES } from "../../config/mediaConfig.js";
import { isBlockedHost } from "../../../src/shared/utils/ssrfGuard.js";

// Resolve once, reject any non-public record, and pin the approved connection.
async function resolvePinnedIps(hostname) {
  if (!hostname || isBlockedHost(hostname)) return null;
  try {
    const records = await lookup(hostname.replace(/^\[|\]$/g, ""), { all: true });
    if (!records.length || records.some((r) => !r.address || isBlockedHost(r.address))) return null;
    return records;
  } catch {
    return null;
  }
}

// Verify buffer magic bytes match a known image signature; return its mime or null.
export function detectImageMime(buf) {
  for (const { sig, offset, mime, verifyWebp } of IMAGE_SIGNATURES) {
    if (buf.length < offset + sig.length) continue;
    let match = true;
    for (let i = 0; i < sig.length; i++) {
      if (buf[offset + i] !== sig[i]) {match = false;break;}
    }
    if (!match) continue;
    // WEBP: RIFF....WEBP — bytes 8..11 must be "WEBP".
    if (verifyWebp && !(buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50)) continue;
    return mime;
  }
  return null;
}

/**
 * Fetch a remote image URL and return it as a base64 data URI.
 * Hardened against SSRF (private/metadata IPs), memory DoS (size cap),
 * and disguised non-image payloads (magic-byte verification).
 * The deadline or caller signal also bounds DNS resolution. Returns null on failure.
 *
 * @param {string} imageUrl - HTTP(S) URL of the image
 * @param {object} options - { signal, timeoutMs, maxBytes, fetcher }. `fetcher(url, init)`
 *   replaces the global fetch; keep `init.dispatcher` on any direct connection.
 *   Injected rather than imported: proxyFetch patches the global fetch on import.
 * @returns {Promise<{url: string, mimeType: string}|null>}
 */
export async function fetchImageAsBase64(imageUrl, options = {}) {
  const {
    signal, timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_IMAGE_BYTES,
    fetcher = (target, init) => fetch(target, init)
  } = options;
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
    return null;
  }

  let url;
  try {url = new URL(imageUrl);} catch {return null;}
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const fetchSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  let dispatcher;
  try {
    if (fetchSignal.aborted) return null;
    // DNS lookup itself cannot be cancelled; detach the listener when either side
    // settles, and consume the lookup's eventual result after cancellation.
    const pinnedIps = await new Promise((resolve) => {
      const onAbort = () => {
        fetchSignal.removeEventListener("abort", onAbort);
        resolve(null);
      };
      fetchSignal.addEventListener("abort", onAbort, { once: true });
      resolvePinnedIps(url.hostname).then((records) => {
        fetchSignal.removeEventListener("abort", onAbort);
        resolve(records);
      });
    });
    if (!pinnedIps || fetchSignal.aborted) return null;

    // Pin connect to the validated IP so no second DNS resolution can rebind (TOCTOU fix).
    dispatcher = new Agent({
      connect: { lookup: (_h, _o, cb) => cb(null, [{ address: pinnedIps[0].address, family: pinnedIps[0].family }]) }
    });
    // redirect:"manual" prevents a public URL redirecting to a private one (SSRF bypass).
    const response = await fetcher(imageUrl, { signal: fetchSignal, redirect: "manual", dispatcher });
    if (!response.ok || !response.body) {
      // An unread body would hold a connection in a shared proxy pool.
      response.body?.cancel?.().catch(() => {});
      return null;
    }

    // Stream-read with a hard byte cap to avoid loading huge payloads into memory.
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        return null;
      }
      chunks.push(value);
    }

    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const mimeType = detectImageMime(buf);
    if (!mimeType) return null; // not a recognized image — reject disguised payloads

    return { url: `data:${mimeType};base64,${buf.toString("base64")}`, mimeType };
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
    dispatcher?.close().catch(() => {});
  }
}
