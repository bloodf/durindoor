import zlib from "node:zlib";
import { promisify } from "node:util";
import { DEFAULT_MAX_PAYLOAD_BYTES, DEFAULT_MAX_SINGLE_PAYLOAD_BYTES } from "open-sse/services/payloadAdmission.js";
import { authErrorResponse, errorResponse } from "open-sse/utils/error.js";
import { keepAbortChain } from "../../shared/utils/abortChain.js";
import { admit } from "../services/admission.js";
import * as log from "./logger.js";
import { getRequestId } from "./requestCorrelation.js";

// Bound both wire and decoded bytes by the existing single-request admission floor.
const MAX_BYTES = Math.min(DEFAULT_MAX_PAYLOAD_BYTES, DEFAULT_MAX_SINGLE_PAYLOAD_BYTES);
// Local mode also admits callers without a stored key; they may expand to half as much.
const MAX_ANONYMOUS_DECODED_BYTES = MAX_BYTES / 2;
// Decoded bytes per wire byte. Bounds what a small body can make the server allocate.
const MAX_EXPANSION_RATIO = 200;

// node:zlib function per single Content-Encoding token. Stacked values are not supported.
const DECODERS = new Map([
  ["gzip", "gunzip"],
  ["x-gzip", "gunzip"],
  ["deflate", "inflate"],
  ["br", "brotliDecompress"],
  ["zstd", "zstdDecompress"],
]);

const parsedBodies = new WeakMap();

/** Parse the JSON body and leave the request readable; readRequestJson reuses the result. */
export async function peekRequestJson(request) {
  const body = await request.clone().json();
  parsedBodies.set(request, body);
  return body;
}

/** request.json(), without a second parse after peekRequestJson. */
export async function readRequestJson(request) {
  if (!parsedBodies.has(request)) return request.json();
  const body = parsedBodies.get(request);
  parsedBodies.delete(request);
  // Drop the unread branch so its buffered bytes do not live as long as the request.
  void request.body?.cancel().catch(() => {});
  return body;
}

/**
 * Decode a compressed JSON request before the entry point parses it. A plain
 * request is returned as is; a decoded one keeps the original request id. The
 * client key is checked from the headers before any compressed byte is read.
 * The name predates the OpenAI entry points, which now share this decoder.
 * @returns {Promise<{ request: Request } | { response: Response }>}
 */
export async function decodeAnthropicRequest(request, { abortedStatus = null } = {}) {
  const encoding = (request.headers.get("content-encoding") || "").trim().toLowerCase();
  if (!encoding || encoding === "identity") return { request };
  const decoder = zlib[DECODERS.get(encoding)];
  if (!decoder) {
    return { response: errorResponse(415, "Unsupported content encoding") };
  }
  const declared = request.headers.get("content-length");
  if (/^\d+$/.test(declared || "") && Number(declared) > MAX_BYTES) {
    return { response: errorResponse(413, "Request body too large") };
  }

  let auth;
  if (!request.signal.aborted) {
    const admission = await admit(request, {
      kind: "chat",
      respond: (_status, message) => authErrorResponse(new URL(request.url).pathname, message),
    });
    if (admission.error) {
      log.warn("AUTH", "Rejected a compressed request before decoding it");
      return { response: admission.error };
    }
    auth = admission.auth;
  }

  let reader;
  const abort = () => { void reader?.cancel(request.signal.reason).catch(() => {}); };
  try {
    if (request.signal.aborted) throw request.signal.reason;
    if (!request.body) throw new Error("Missing body");
    request.signal.addEventListener("abort", abort, { once: true });
    const readBounded = async (stream) => {
      reader = stream.getReader();
      const chunks = [];
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (request.signal.aborted) throw request.signal.reason;
        if (done) return chunks;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) {
          void reader.cancel().catch(() => {});
          throw new RangeError("Request body too large");
        }
        chunks.push(value);
      }
    };
    const compressed = Buffer.concat(await readBounded(request.body));
    const ceiling = auth.stored || auth.operator ? MAX_BYTES : MAX_ANONYMOUS_DECODED_BYTES;
    // maxOutputLength throws a RangeError, which bounds decompression bombs.
    const maxOutputLength = Math.max(1, Math.min(ceiling, compressed.length * MAX_EXPANSION_RATIO));
    const expanded = await promisify(decoder)(compressed, { maxOutputLength });
    if (request.signal.aborted) throw request.signal.reason;
    const headers = new Headers(request.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    const decoded = keepAbortChain(new Request(request, { headers, body: expanded, duplex: "half", signal: request.signal }), request);
    getRequestId(decoded, getRequestId(request));
    return { request: decoded };
  } catch (error) {
    if (request.signal.aborted && abortedStatus) return { response: errorResponse(abortedStatus, "Request aborted") };
    const tooLarge = error instanceof RangeError;
    return { response: errorResponse(tooLarge ? 413 : 400, tooLarge ? "Request body too large" : "Invalid JSON body") };
  } finally {
    request.signal.removeEventListener("abort", abort);
  }
}
