// Envelope mapping adapted from cheaper-inference/OmniRoute (MIT),
// open-sse/executors/deepseek-web.ts at 4265bb2ad5477450a07d3a43ea33a62c6c874878.
// See LICENSE.omniroute. Oversized, stalled or invalid UTF-8 bodies fail closed.
export function envelopeStatus(value) {
  const code = value?.code;
  if (code !== undefined && code !== 0) return code === 40003 ? 401 : code === 40002 ? 429 : 502;
  return null;
}

/** Bound bytes, UTF-8 validity, caller cancellation and elapsed time even for a stalled body. */
export async function readBounded(response, signal, maxBytes = 4 * 1024 * 1024) {
  if (!response.body) throw new Error("Missing DeepSeek response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  let abort;
  const aborted = new Promise((_, reject) => {
    abort = () => reject(new DOMException("Request aborted", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      signal?.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("DeepSeek response exceeds limit");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    signal?.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
