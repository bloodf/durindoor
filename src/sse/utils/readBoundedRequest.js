import { keepAbortChain } from "../../shared/utils/abortChain.js";

/** Buffer at most maxBytes before body parsing, retaining the source abort chain. */
export async function readBoundedRequest(request, maxBytes) {
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return keepAbortChain(new Request(request.url, { method: request.method, headers, body: Buffer.concat(chunks), signal: request.signal }), request);
}
