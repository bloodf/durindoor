import { DEFAULT_MAX_PAYLOAD_BYTES, DEFAULT_MAX_SINGLE_PAYLOAD_BYTES } from "open-sse/services/payloadAdmission.js";
import { errorResponse } from "open-sse/utils/error.js";

// Bound both wire and decoded bytes by the existing single-request admission floor.
const MAX_BYTES = Math.min(DEFAULT_MAX_PAYLOAD_BYTES, DEFAULT_MAX_SINGLE_PAYLOAD_BYTES);

/** Decode only the Anthropic entry points before their existing JSON parsing. */
export async function decodeAnthropicRequest(request, { abortedStatus = null } = {}) {
  const encoding = (request.headers.get("content-encoding") || "").trim().toLowerCase();
  if (!encoding || encoding === "identity") return { request };
  if (encoding !== "gzip" && encoding !== "x-gzip") {
    return { response: errorResponse(415, "Unsupported content encoding") };
  }
  const declared = request.headers.get("content-length");
  if (/^\d+$/.test(declared || "") && Number(declared) > MAX_BYTES) {
    return { response: errorResponse(413, "Request body too large") };
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
    const compressed = await readBounded(request.body);
    const chunks = await readBounded(new Blob(compressed).stream().pipeThrough(new DecompressionStream("gzip")));
    const headers = new Headers(request.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    return { request: new Request(request, { headers, body: new Blob(chunks), duplex: "half", signal: request.signal }) };
  } catch (error) {
    if (request.signal.aborted && abortedStatus) return { response: errorResponse(abortedStatus, "Request aborted") };
    const tooLarge = error instanceof RangeError;
    return { response: errorResponse(tooLarge ? 413 : 400, tooLarge ? "Request body too large" : "Invalid JSON body") };
  } finally {
    request.signal.removeEventListener("abort", abort);
  }
}
