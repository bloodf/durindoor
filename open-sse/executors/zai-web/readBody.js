/** Local safety bounds, not a claim about provider proof lifetime or stream limits. */
export async function readZaiBody(response, signal, timeoutMs = 120_000) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty Z.ai response");
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const abort = () => {
    void reader.cancel().catch(() => {});
    rejectAbort(combined.reason);
  };
  combined.addEventListener("abort", abort, { once: true });
  let size = 0;
  let text = "";
  const decoder = new TextDecoder();
  try {
    combined.throwIfAborted();
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      combined.throwIfAborted();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > 16 * 1024 * 1024) throw new Error("Z.ai response too large");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    combined.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
